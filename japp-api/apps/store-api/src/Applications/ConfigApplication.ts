import { Inject, Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import type { Database, Db, Tx } from "@japp/db";
import type { ConfigModule } from "@japp/domain";
import { DATABASE } from "../Constants/Injection.js";
import { MODULES, type Kind, type ModuleDef } from "./ConfigRegistry.js";

type Q = Db | Tx;
export type Row = Record<string, any>;

/** Tablas en las que se buscan referencias por id o por nombre (o código). Nunca las elige el cliente. */
export type RefTable = "print_channel" | "printer" | "payment_method";

/** Expresión de una columna en el SELECT según su tipo (NUMERIC → número, fecha → AAAA-MM-DD, UUID → texto). */
function colExpr(kind: Kind, c: string) {
  if (kind === "n") {
    return `${c}::float8`;
  }
  if (kind === "d") {
    return `to_char(${c},'YYYY-MM-DD')`;
  }
  if (kind === "u") {
    return `${c}::text`;
  }
  return c;
}

/** Valor que se guarda en la base: vacío → NULL y NUMERIC con dos decimales. */
function toDb(kind: string, v: unknown) {
  if (v === undefined || v === null || v === "") {
    return null;
  }
  if (kind === "n") {
    return Number(v).toFixed(2);
  }
  return v;
}

/** Agrupa filas por una columna (relaciones de cada registro). */
function by(xs: Row[], k: string) {
  const g = new Map<string, Row[]>();
  xs.forEach((x) => g.set(x[k], [...(g.get(x[k]) ?? []), x]));
  return g;
}

/**
 * Ajustes en la base: lectura y escritura de los registros de cada módulo y de sus relaciones.
 * Tabla y columnas salen SOLO de ConfigRegistry (nunca del cliente), así el SQL dinámico es seguro.
 */
@Injectable()
export class ConfigApplication {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  private async rows(q: Q, query: SQL): Promise<Row[]> {
    return (await q.execute(query)).rows as Row[];
  }
  private async count(q: Q, query: SQL): Promise<number> {
    return Number((await this.rows(q, query))[0]!.n);
  }

  private table(d: ModuleDef) {
    return sql.raw(`"${d.table}"`);
  }
  private cols(d: ModuleDef) {
    const out = [
      `t.${d.singleton === "store_id" ? "store_id" : "id"}::text AS "id"`,
      `t.version AS "version"`,
    ];
    if (!d.noActive && !d.singleton) {
      out.push(`t.active AS "active"`);
    }
    for (const [k, f] of Object.entries(d.fields)) {
      out.push(`${colExpr(f.kind, `t.${f.col}`)} AS "${k}"`);
    }
    return sql.raw(out.join(", "));
  }
  private orderBy(d: ModuleDef) {
    return sql.raw(
      d.order
        .split(",")
        .map((x) => x.trim().replace(/^([a-z_]+)/, "t.$1"))
        .join(", "),
    );
  }
  private whereOne(d: ModuleDef, m: ConfigModule, storeId: string, id: string) {
    if (d.singleton === "store_id") {
      return sql`t.store_id = ${storeId}`;
    }
    if (d.singleton === "store") {
      return sql`t.id = ${storeId}`;
    }
    if (d.singleton === "company") {
      return sql`t.id = (SELECT company_id FROM store WHERE id = ${storeId})`;
    }
    if (m === "productos") {
      return sql`t.store_id = ${storeId} AND (t.id::text = ${id} OR t.plu::text = ${id})`;
    }
    return sql`t.store_id = ${storeId} AND t.id::text = ${id}`;
  }

  // ───────────────────────── lectura ─────────────────────────
  /** Un registro con sus relaciones (null si no existe). */
  async findOne(storeId: string, m: ConfigModule, id: string, q: Q = this.database.db): Promise<Row | null> {
    return this.loadOne(q, storeId, m, id, false);
  }

  /** Igual, bloqueando la fila (SELECT … FOR UPDATE) dentro de la transacción del cambio. */
  async findOneForUpdate(tx: Tx, storeId: string, m: ConfigModule, id: string): Promise<Row | null> {
    return this.loadOne(tx, storeId, m, id, true);
  }

  private async loadOne(q: Q, storeId: string, m: ConfigModule, id: string, lock: boolean) {
    const d = MODULES[m];
    const rows = await this.rows(
      q,
      sql`SELECT ${this.cols(d)} FROM ${this.table(d)} t WHERE ${this.whereOne(d, m, storeId, id)}${sql.raw(lock ? " FOR UPDATE" : "")}`,
    );
    if (!rows[0]) {
      return null;
    }
    return (await this.withExtra(q, storeId, m, [rows[0]]))[0]!;
  }

  /**
   * Una página del listado: `active` null = todos; `search` = texto (si el módulo tiene columnas de búsqueda).
   * Se pide una fila de más para saber si hay página siguiente.
   */
  async page(
    storeId: string,
    m: ConfigModule,
    o: { active: boolean | null; search: string | null; limit: number; offset: number },
    q: Q = this.database.db,
  ): Promise<{ items: Row[]; more: boolean }> {
    const d = MODULES[m];
    const where: SQL[] = [sql`t.store_id = ${storeId}`];
    if (o.active !== null) {
      where.push(o.active ? sql`t.active` : sql`NOT t.active`);
    }
    if (o.search && d.search) {
      const like = `%${o.search}%`;
      where.push(
        sql`(${sql.join(
          d.search.map((s) => sql`${sql.raw(`t.${s}`)} ILIKE ${like}`),
          sql` OR `,
        )})`,
      );
    }
    const rows = await this.rows(
      q,
      sql`SELECT ${this.cols(d)} FROM ${this.table(d)} t WHERE ${sql.join(where, sql` AND `)} ORDER BY ${this.orderBy(d)} LIMIT ${sql.raw(String(o.limit + 1))} OFFSET ${sql.raw(String(o.offset))}`,
    );
    const page = rows.slice(0, o.limit);
    return { items: await this.withExtra(q, storeId, m, page), more: rows.length > o.limit };
  }

  /** Todos los activos del módulo (o todos, si no tiene columna active), con sus relaciones: paquete GET /config. */
  async listActive(storeId: string, m: ConfigModule, q: Q = this.database.db): Promise<Row[]> {
    const d = MODULES[m];
    const rows = await this.rows(
      q,
      sql`SELECT ${this.cols(d)} FROM ${this.table(d)} t WHERE t.store_id = ${storeId}${sql.raw(d.noActive ? "" : " AND t.active")} ORDER BY ${this.orderBy(d)}`,
    );
    return this.withExtra(q, storeId, m, rows);
  }

  /** Relaciones de cada módulo (lo que no es columna). */
  private async withExtra(q: Q, storeId: string, m: ConfigModule, rows: Row[]): Promise<Row[]> {
    if (!rows.length) {
      return rows;
    }
    const ids = sql.param(rows.map((r) => r.id));
    if (m === "perfiles") {
      const pp = by(
        await this.rows(
          q,
          sql`SELECT profile_id::text p, permission_code code FROM profile_permission WHERE profile_id::text = ANY(${ids}) ORDER BY permission_code`,
        ),
        "p",
      );
      const us = by(
        await this.rows(
          q,
          sql`SELECT profile_id::text p FROM app_user WHERE store_id = ${storeId} AND active AND profile_id::text = ANY(${ids})`,
        ),
        "p",
      );
      rows.forEach((r) => {
        r.permissions = (pp.get(r.id) ?? []).map((x) => x.code);
        r.users = (us.get(r.id) ?? []).length;
      });
    } else if (m === "productos") {
      const ch = by(
        await this.rows(
          q,
          sql`SELECT pc.product_id::text p, pc.channel_id::text id FROM product_channel pc JOIN print_channel ch ON ch.id = pc.channel_id AND ch.store_id = pc.store_id WHERE pc.store_id = ${storeId} AND pc.product_id::text = ANY(${ids}) ORDER BY ch.name`,
        ),
        "p",
      );
      const qs = by(
        await this.rows(
          q,
          sql`SELECT product_id::text p, question_id::text id FROM product_question WHERE store_id = ${storeId} AND product_id::text = ANY(${ids}) ORDER BY sort_order`,
        ),
        "p",
      );
      const tx = new Map(
        (
          await this.rows(q, sql`SELECT id::text, rate::float8 rate FROM tax WHERE store_id = ${storeId}`)
        ).map((x) => [x.id, x.rate]),
      );
      const lb = new Map(
        (
          await this.rows(
            q,
            sql`SELECT DISTINCT ON (product_id) product_id::text p, label FROM category_product WHERE store_id = ${storeId} AND product_id::text = ANY(${ids}) ORDER BY product_id, category_id`,
          )
        ).map((x) => [x.p, x.label]),
      );
      rows.forEach((r) => {
        r.channels = (ch.get(r.id) ?? []).map((x) => x.id);
        r.questions = (qs.get(r.id) ?? []).map((x) => x.id);
        r.taxRate = tx.get(r.taxId) ?? null;
        r.buttonLabel = lb.get(r.id) ?? r.name;
      });
    } else if (m === "preguntas") {
      const a = by(
        await this.rows(
          q,
          sql`SELECT qa.question_id::text q, qa.product_id::text "productId", p.plu, coalesce(qa.label, p.name) label, qa.extra_price::float8 "extraPrice", qa.bg_color "bgColor", qa.fg_color "fgColor"
        FROM question_answer qa JOIN product p ON p.id = qa.product_id WHERE qa.question_id::text = ANY(${ids}) ORDER BY qa.sort_order`,
        ),
        "q",
      );
      rows.forEach((r) => {
        r.answers = (a.get(r.id) ?? []).map(({ q: _q, ...x }) => x);
      });
    } else if (m === "estaciones") {
      const cp = by(
        await this.rows(
          q,
          sql`SELECT station_id::text s, channel_id::text ch, printer_id::text pr FROM station_channel_printer WHERE station_id::text = ANY(${ids})`,
        ),
        "s",
      );
      const pm = by(
        await this.rows(
          q,
          sql`SELECT station_id::text s, payment_method_id::text id FROM station_payment_method WHERE station_id::text = ANY(${ids})`,
        ),
        "s",
      );
      const dc = by(
        await this.rows(
          q,
          sql`SELECT station_id::text s, discount_id::text id FROM station_discount WHERE station_id::text = ANY(${ids})`,
        ),
        "s",
      );
      rows.forEach((r) => {
        r.channels = Object.fromEntries((cp.get(r.id) ?? []).map((x) => [x.ch, x.pr]));
        r.paymentMethods = (pm.get(r.id) ?? []).map((x) => x.id);
        r.discounts = (dc.get(r.id) ?? []).map((x) => x.id);
      });
    }
    return rows;
  }

  // ───────────────────────── escritura del registro ─────────────────────────
  /** Alta: id, tienda, los campos que vienen, el PIN cifrado (usuarios) y active = false si se crea inactivo. */
  async insert(
    tx: Tx,
    storeId: string,
    m: ConfigModule,
    id: string,
    rec: Row,
    o: { pinHash?: string; inactive: boolean },
  ) {
    const d = MODULES[m];
    const cols = ["id", "store_id"];
    const vals: unknown[] = [id, storeId];
    for (const [k, f] of Object.entries(d.fields)) {
      if (rec[k] !== undefined) {
        cols.push(f.col);
        vals.push(toDb(f.kind, rec[k]));
      }
    }
    if (o.pinHash !== undefined) {
      cols.push("pin_hash");
      vals.push(o.pinHash);
    }
    if (o.inactive) {
      cols.push("active");
      vals.push(false);
    }
    await tx.execute(
      sql`INSERT INTO ${this.table(d)} (${sql.raw(cols.map((x) => `"${x}"`).join(", "))}) VALUES (${sql.join(
        vals.map((v) => sql.param(v)),
        sql`, `,
      )})`,
    );
  }

  /**
   * Cambio: los campos de `keys` (en el orden del registro), el PIN cifrado, active y la versión nueva.
   * El registro se busca por store_id o id según el módulo.
   */
  async update(
    tx: Tx,
    m: ConfigModule,
    recordId: string,
    rec: Row,
    o: { keys: string[]; pinHash?: string; active?: boolean; version: number },
  ) {
    const d = MODULES[m];
    const sets: SQL[] = [];
    for (const [k, f] of Object.entries(d.fields)) {
      if (o.keys.includes(k)) {
        sets.push(sql`${sql.raw(`"${f.col}"`)} = ${sql.param(toDb(f.kind, rec[k]))}`);
      }
    }
    if (o.pinHash !== undefined) {
      sets.push(sql`pin_hash = ${o.pinHash}`);
    }
    if (o.active !== undefined) {
      sets.push(sql`active = ${o.active}`);
    }
    sets.push(sql`version = ${o.version}`);
    const key = d.singleton === "store_id" ? "store_id" : "id";
    await tx.execute(
      sql`UPDATE ${this.table(d)} SET ${sql.join(sets, sql`, `)} WHERE ${sql.raw(key)}::text = ${recordId}`,
    );
  }

  /** Baja: nada se borra, se desactiva y sube la versión. */
  async deactivate(tx: Tx, m: ConfigModule, recordId: string) {
    await tx.execute(
      sql`UPDATE ${this.table(MODULES[m])} SET active = false, version = version + 1 WHERE id::text = ${recordId}`,
    );
  }

  // ───────────────────────── consultas de las reglas (prepare) ─────────────────────────
  /** Usuarios activos de la tienda con su PIN cifrado (para no repetir PIN). */
  async activeUserPins(tx: Tx, storeId: string): Promise<{ id: string; pinHash: string }[]> {
    const rows = await this.rows(
      tx,
      sql`SELECT id::text, pin_hash FROM app_user WHERE store_id = ${storeId} AND active`,
    );
    return rows.map((u) => ({ id: u.id, pinHash: u.pin_hash }));
  }

  /** IVA activo con ese tipo (el primero), o null. */
  async activeTaxIdByRate(tx: Tx, storeId: string, rate: number): Promise<string | null> {
    const t = (
      await this.rows(
        tx,
        sql`SELECT id::text FROM tax WHERE store_id = ${storeId} AND active AND rate = ${rate} LIMIT 1`,
      )
    )[0];
    return t ? t.id : null;
  }

  /**
   * Bloqueo de PLU de la tienda (advisory, hasta el fin de la transacción; volver a pedirlo en la misma no espera).
   * Orden fijo en toda la API: carta (CartaSyncApplication.lockCarta) → PLU → filas FOR UPDATE.
   */
  async lockPlu(tx: Tx, storeId: string) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('plu:' || ${storeId}))`);
  }

  /** PLU siguiente: uno a la vez por tienda (dos altas a la vez no se llevan el mismo número). */
  async lockAndNextPlu(tx: Tx, storeId: string): Promise<number> {
    await this.lockPlu(tx, storeId);
    return this.count(tx, sql`SELECT coalesce(max(plu), 0) + 1 n FROM product WHERE store_id = ${storeId}`);
  }

  /** Ids o nombres (o códigos, en formas de pago) → filas { id, k } que casan; el servicio decide qué falta. */
  async findRefs(
    tx: Tx,
    storeId: string,
    table: RefTable,
    refs: string[],
  ): Promise<{ id: string; k: string }[]> {
    const alt = table === "payment_method" ? "code" : "name";
    const rows = await this.rows(
      tx,
      sql`SELECT id::text, lower(${sql.raw(alt)}) k FROM ${sql.raw(`"${table}"`)} WHERE store_id = ${storeId} AND (id::text = ANY(${sql.param(refs)}) OR lower(${sql.raw(alt)}) = ANY(${sql.param(refs.map((r) => r.toLowerCase()))}))`,
    );
    return rows as { id: string; k: string }[];
  }

  /** La base exige que las series existan en invoice_series (FK): se crea si falta. */
  async ensureInvoiceSeries(tx: Tx, storeId: string, series: string, kind: string) {
    await tx.execute(
      sql`INSERT INTO invoice_series (store_id, series, kind) VALUES (${storeId}, ${series}, ${kind}) ON CONFLICT DO NOTHING`,
    );
  }

  /** Una sola caja principal por tienda: la anterior deja de serlo. */
  async clearOtherMainStations(tx: Tx, storeId: string, exceptId: string) {
    await tx.execute(
      sql`UPDATE station SET is_main = false, version = version + 1 WHERE store_id = ${storeId} AND is_main AND id::text <> ${exceptId}`,
    );
  }

  /** Tipo y original de un canal (para validar «Copia de»), o null si no existe. */
  async channelKind(
    tx: Tx,
    storeId: string,
    id: string,
  ): Promise<{ kind: string; copyOfId: string | null } | null> {
    const o = (
      await this.rows(
        tx,
        sql`SELECT kind, copy_of_id FROM print_channel WHERE store_id = ${storeId} AND id::text = ${id}`,
      )
    )[0];
    return o ? { kind: o.kind, copyOfId: o.copy_of_id } : null;
  }

  /** Tipo de un canal activo, o null. */
  async activeChannelKind(tx: Tx, storeId: string, id: string): Promise<string | null> {
    const k = (
      await this.rows(
        tx,
        sql`SELECT kind FROM print_channel WHERE store_id = ${storeId} AND id::text = ${id} AND active`,
      )
    )[0];
    return k ? k.kind : null;
  }

  /** Productos en el canal (activos o no). */
  async countChannelProducts(tx: Tx, storeId: string, channelId: string) {
    return this.count(
      tx,
      sql`SELECT count(*) n FROM product_channel WHERE store_id = ${storeId} AND channel_id = ${channelId}`,
    );
  }

  /** Nombres de los canales de la lista que no son de comanda o son copias. */
  async nonKitchenChannelNames(tx: Tx, storeId: string, ids: string[]): Promise<string[]> {
    const bad = await this.rows(
      tx,
      sql`SELECT name FROM print_channel WHERE store_id = ${storeId} AND id = ANY(${sql.param(ids)}::uuid[]) AND (kind <> 'kitchen' OR copy_of_id IS NOT NULL)`,
    );
    return bad.map((x) => x.name);
  }

  /** Id del producto con ese PLU, o null. */
  async productIdByPlu(tx: Tx, storeId: string, plu: number): Promise<string | null> {
    const p = (
      await this.rows(tx, sql`SELECT id::text FROM product WHERE store_id = ${storeId} AND plu = ${plu}`)
    )[0];
    return p ? p.id : null;
  }

  // ───────────────────────── relaciones (saveExtra) ─────────────────────────
  async replaceProfilePermissions(tx: Tx, storeId: string, id: string, permissions: string[]) {
    await tx.execute(sql`DELETE FROM profile_permission WHERE profile_id = ${id}`);
    if (permissions.length) {
      await tx.execute(
        sql`INSERT INTO profile_permission (profile_id, permission_code, store_id) SELECT ${id}, unnest(${sql.param(permissions)}::text[]), ${storeId}`,
      );
    }
  }

  async replaceProductChannels(tx: Tx, storeId: string, id: string, channels: string[]) {
    await tx.execute(sql`DELETE FROM product_channel WHERE product_id = ${id}`);
    if (channels.length) {
      await tx.execute(
        sql`INSERT INTO product_channel (product_id, channel_id, store_id) SELECT ${id}, unnest(${sql.param(channels)}::uuid[]), ${storeId}`,
      );
    }
  }

  async replaceProductQuestions(tx: Tx, storeId: string, id: string, questions: string[]) {
    await tx.execute(sql`DELETE FROM product_question WHERE product_id = ${id}`);
    if (questions.length) {
      await tx.execute(
        sql`INSERT INTO product_question (product_id, question_id, store_id, sort_order) SELECT ${id}, q, ${storeId}, o - 1 FROM unnest(${sql.param(questions)}::uuid[]) WITH ORDINALITY AS x(q, o)`,
      );
    }
  }

  /** El producto (categoría, nombre y colores) y sus teclas actuales en category_product. */
  async productButton(tx: Tx, storeId: string, id: string): Promise<{ product: Row; current: Row[] }> {
    const product = (
      await this.rows(
        tx,
        sql`SELECT category_id, name, bg_color, fg_color FROM product WHERE store_id = ${storeId} AND id = ${id}`,
      )
    )[0]!;
    const current = await this.rows(
      tx,
      sql`SELECT category_id, label, bg_color, fg_color FROM category_product WHERE store_id = ${storeId} AND product_id = ${id}`,
    );
    return { product, current };
  }

  /** La tecla pasa a otra categoría: se quita la anterior y va al final de la nueva. */
  async moveProductButton(
    tx: Tx,
    storeId: string,
    id: string,
    b: { categoryId: string; label: string; bg: string | null; fg: string | null },
  ) {
    await tx.execute(sql`DELETE FROM category_product WHERE store_id = ${storeId} AND product_id = ${id}`);
    await tx.execute(
      sql`INSERT INTO category_product (category_id, product_id, store_id, label, bg_color, fg_color, pos_x, pos_y) VALUES (${b.categoryId},${id},${storeId},${b.label},${b.bg},${b.fg},0,(SELECT coalesce(max(pos_y),0)+1 FROM category_product WHERE store_id = ${storeId} AND category_id = ${b.categoryId}))`,
    );
  }

  /** Misma categoría: cambian texto y colores de la tecla. */
  async updateProductButton(
    tx: Tx,
    storeId: string,
    id: string,
    b: { label: string; bg: string | null; fg: string | null },
  ) {
    await tx.execute(
      sql`UPDATE category_product SET label = ${b.label}, bg_color = ${b.bg}, fg_color = ${b.fg} WHERE store_id = ${storeId} AND product_id = ${id}`,
    );
  }

  async replaceQuestionAnswers(tx: Tx, storeId: string, id: string, answers: Row[]) {
    await tx.execute(sql`DELETE FROM question_answer WHERE question_id = ${id}`);
    let i = 0;
    for (const a of answers) {
      await tx.execute(
        sql`INSERT INTO question_answer (id, store_id, question_id, product_id, label, extra_price, bg_color, fg_color, sort_order) VALUES (${crypto.randomUUID()},${storeId},${id},${a.productId},${a.label ?? null},${Number(a.extraPrice ?? 0).toFixed(2)},${a.bgColor ?? null},${a.fgColor ?? null},${i++})`,
      );
    }
  }

  /** Canal → impresora de la estación (sin impresora = no se guarda). */
  async replaceStationChannels(tx: Tx, storeId: string, id: string, channels: Record<string, string | null>) {
    await tx.execute(sql`DELETE FROM station_channel_printer WHERE station_id = ${id}`);
    for (const [ch, pr] of Object.entries(channels)) {
      if (pr) {
        await tx.execute(
          sql`INSERT INTO station_channel_printer (station_id, channel_id, printer_id, store_id) VALUES (${id},${ch},${pr},${storeId})`,
        );
      }
    }
  }

  async replaceStationPaymentMethods(tx: Tx, storeId: string, id: string, methods: string[]) {
    await tx.execute(sql`DELETE FROM station_payment_method WHERE station_id = ${id}`);
    if (methods.length) {
      await tx.execute(
        sql`INSERT INTO station_payment_method (station_id, payment_method_id, store_id) SELECT ${id}, unnest(${sql.param(methods)}::uuid[]), ${storeId}`,
      );
    }
  }

  async replaceStationDiscounts(tx: Tx, storeId: string, id: string, discounts: string[]) {
    await tx.execute(sql`DELETE FROM station_discount WHERE station_id = ${id}`);
    if (discounts.length) {
      await tx.execute(
        sql`INSERT INTO station_discount (station_id, discount_id, store_id) SELECT ${id}, unnest(${sql.param(discounts)}::uuid[]), ${storeId}`,
      );
    }
  }

  // ───────────────────────── recuentos (qué impide desactivar o cambiar) ─────────────────────────
  async countActiveUsersOfProfile(tx: Tx, storeId: string, id: string) {
    return this.count(
      tx,
      sql`SELECT count(*) n FROM app_user WHERE store_id=${storeId} AND active AND profile_id=${id}`,
    );
  }

  async countActiveTablesOfArea(tx: Tx, storeId: string, id: string) {
    return this.count(
      tx,
      sql`SELECT count(*) n FROM dining_table WHERE store_id=${storeId} AND active AND area_id=${id}`,
    );
  }

  async countOpenOrdersOfTable(tx: Tx, storeId: string, id: string) {
    return this.count(
      tx,
      sql`SELECT count(*) n FROM orders WHERE store_id=${storeId} AND table_id=${id} AND status IN ('open','billing')`,
    );
  }

  async countActiveProductsWithTax(tx: Tx, storeId: string, id: string) {
    return this.count(
      tx,
      sql`SELECT count(*) n FROM product WHERE store_id=${storeId} AND active AND tax_id=${id}`,
    );
  }

  async countActiveProductsInCategory(tx: Tx, storeId: string, id: string) {
    return this.count(
      tx,
      sql`SELECT count(*) n FROM product WHERE store_id=${storeId} AND active AND category_id=${id}`,
    );
  }

  async countActiveProductsInChannel(tx: Tx, storeId: string, id: string) {
    return this.count(
      tx,
      sql`SELECT count(*) n FROM product_channel pc JOIN product p ON p.id=pc.product_id WHERE pc.store_id=${storeId} AND p.active AND pc.channel_id=${id}`,
    );
  }

  /** Canales activos que son copia de este. */
  async countActiveCopiesOfChannel(tx: Tx, storeId: string, id: string) {
    return this.count(
      tx,
      sql`SELECT count(*) n FROM print_channel WHERE store_id=${storeId} AND active AND copy_of_id=${id}`,
    );
  }

  /** Áreas activas que usan este canal para sus tickets. */
  async countActiveAreasWithTicketChannel(tx: Tx, storeId: string, id: string) {
    return this.count(
      tx,
      sql`SELECT count(*) n FROM area WHERE store_id=${storeId} AND active AND ticket_channel_id=${id}`,
    );
  }

  async countActiveStationsWithPrinter(tx: Tx, storeId: string, id: string) {
    return this.count(
      tx,
      sql`SELECT count(*) n FROM station_channel_printer scp JOIN station s ON s.id=scp.station_id WHERE scp.store_id=${storeId} AND s.active AND scp.printer_id=${id}`,
    );
  }

  async countActiveChannelsWithPrinter(tx: Tx, storeId: string, id: string) {
    return this.count(
      tx,
      sql`SELECT count(*) n FROM print_channel WHERE store_id=${storeId} AND active AND printer_id=${id}`,
    );
  }

  async countActiveProductsWithQuestion(tx: Tx, storeId: string, id: string) {
    return this.count(
      tx,
      sql`SELECT count(*) n FROM product_question pq JOIN product p ON p.id=pq.product_id WHERE pq.store_id=${storeId} AND p.active AND pq.question_id=${id}`,
    );
  }
}
