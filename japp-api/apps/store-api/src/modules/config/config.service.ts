import { Inject, Injectable } from "@nestjs/common";
import bcrypt from "bcryptjs";
import type pg from "pg";
import type { Database } from "@japp/db";
import {
  assertCanDeactivate, assertRecordVersion, checkConfigRecord, describeDiff, fail, CONFIG_PERMISSION, SINGLETON_MODULES, isConfigModule, ALL_PERMISSIONS,
  type ConfigModule, type ConfigUsage,
} from "@japp/domain";
import { CLOCK, DATABASE, type Clock } from "../../common/tokens-di.js";
import type { Session } from "../../common/auth.js";
import { Authorization } from "../../common/authorization.js";
import { parse } from "../../common/validate.js";
import { StoreRepo } from "../../repos/store.repo.js";
import { MODULES, labelsOf, schemas, type ModuleDef } from "./registry.js";

type Row = Record<string, any>;
type C = pg.PoolClient;
const PG_UNIQUE = "23505", PG_FK = "23503", PG_CHECK = "23514";

/** Ajustes por API: listar, ver, crear, cambiar (con versión), desactivar e historial. Nada se borra. */
@Injectable()
export class ConfigService {
  constructor(@Inject(DATABASE) private readonly database: Database, @Inject(StoreRepo) private readonly stores: StoreRepo,
    @Inject(Authorization) private readonly auth: Authorization, @Inject(CLOCK) private readonly clock: Clock) {}

  // ───────────────────────── utilidades ─────────────────────────
  def(module: string): { m: ConfigModule; d: ModuleDef } {
    if (!isConfigModule(module)) fail("NOT_FOUND", "Ese módulo de Ajustes no existe", { module });
    return { m: module as ConfigModule, d: MODULES[module as ConfigModule] };
  }
  async allow(se: Session, m: ConfigModule, authorization?: string | null) { await this.auth.require(se, CONFIG_PERMISSION[m], authorization); }

  private async tx<T>(fn: (c: C) => Promise<T>): Promise<T> {
    const c = await this.database.pool.connect();
    try {
      await c.query("BEGIN");
      const r = await fn(c);
      await c.query("COMMIT");
      return r;
    } catch (e: any) {
      await c.query("ROLLBACK").catch(() => {});
      throw this.pgError(e);
    } finally { c.release(); }
  }
  private async ro<T>(fn: (c: C) => Promise<T>): Promise<T> {
    const c = await this.database.pool.connect();
    try { return await fn(c); } catch (e) { throw this.pgError(e); } finally { c.release(); }
  }
  /** Errores de la base → errores del contrato (nunca un 500 por un dato repetido o una referencia mala). */
  private pgError(e: any) {
    if (e?.code === PG_UNIQUE) return this.mk("DUPLICATE", "Ya existe un registro con ese nombre o código", { constraint: e.constraint });
    if (e?.code === PG_FK) return this.mk("VALIDATION", "Hace referencia a algo que no existe", { field: this.fkField(e.constraint), constraint: e.constraint });
    if (e?.code === PG_CHECK) return this.mk("VALIDATION", "Valor fuera de lo permitido", { constraint: e.constraint });
    if (e?.code === "22P02" || e?.code === "22003") return this.mk("VALIDATION", "Valor no válido", {});
    return e;
  }
  private mk(code: any, msg: string, details: Record<string, unknown>) { try { fail(code, msg, details); } catch (x) { return x; } }
  private fkField(constraint = "") {
    const m: Record<string, string> = { profile_id: "profileId", area_id: "areaId", category_id: "categoryId", tax_id: "taxId", product_id: "answers", channel_id: "channels", printer_id: "channels", payment_method_id: "paymentMethods", discount_id: "discounts", question_id: "questions" };
    return Object.entries(m).find(([k]) => constraint.includes(k))?.[1] ?? null;
  }

  private cols(d: ModuleDef) {
    const out = [`t.${d.singleton === "store_id" ? "store_id" : "id"}::text AS "id"`, `t.version AS "version"`];
    if (!d.noActive && !d.singleton) out.push(`t.active AS "active"`);
    for (const [k, f] of Object.entries(d.fields)) {
      const c = `t.${f.col}`;
      out.push(`${f.kind === "n" ? `${c}::float8` : f.kind === "d" ? `to_char(${c},'YYYY-MM-DD')` : f.kind === "u" ? `${c}::text` : c} AS "${k}"`);
    }
    return out.join(", ");
  }
  private whereOne(d: ModuleDef, m: ConfigModule) {
    if (d.singleton === "store_id") return "t.store_id = $1";
    if (d.singleton === "store") return "t.id = $1";
    if (d.singleton === "company") return "t.id = (SELECT company_id FROM store WHERE id = $1)";
    return m === "productos" ? "t.store_id = $1 AND (t.id::text = $2 OR t.plu::text = $2)" : "t.store_id = $1 AND t.id::text = $2";
  }
  private async one(c: C, se: Session, m: ConfigModule, d: ModuleDef, id: string, lock = false): Promise<Row> {
    if (d.singleton && id !== "current" && id !== se.storeId) fail("NOT_FOUND", "Este módulo tiene un solo registro: usa «current»", { id });
    const { rows } = await c.query(`SELECT ${this.cols(d)} FROM "${d.table}" t WHERE ${this.whereOne(d, m)}${lock ? " FOR UPDATE" : ""}`, d.singleton ? [se.storeId] : [se.storeId, id]);
    if (!rows[0]) fail("NOT_FOUND", "No existe", { module: m, id });
    return (await this.withExtra(c, se, m, [rows[0]]))[0]!;
  }

  /** Relaciones de cada módulo (lo que no es columna). */
  private async withExtra(c: C, se: Session, m: ConfigModule, rows: Row[]): Promise<Row[]> {
    if (!rows.length) return rows;
    const ids = rows.map(r => r.id), by = (xs: Row[], k: string) => { const g = new Map<string, Row[]>(); xs.forEach(x => g.set(x[k], [...(g.get(x[k]) ?? []), x])); return g; };
    if (m === "perfiles") {
      const pp = by((await c.query(`SELECT profile_id::text p, permission_code code FROM profile_permission WHERE profile_id::text = ANY($1) ORDER BY permission_code`, [ids])).rows, "p");
      const us = by((await c.query(`SELECT profile_id::text p FROM app_user WHERE active AND profile_id::text = ANY($1)`, [ids])).rows, "p");
      rows.forEach(r => { r.permissions = (pp.get(r.id) ?? []).map(x => x.code); r.users = (us.get(r.id) ?? []).length; });
    } else if (m === "productos") {
      const ch = by((await c.query(`SELECT pc.product_id::text p, pc.channel_id::text id FROM product_channel pc JOIN print_channel ch ON ch.id = pc.channel_id WHERE pc.product_id::text = ANY($1) ORDER BY ch.name`, [ids])).rows, "p");
      const q = by((await c.query(`SELECT product_id::text p, question_id::text id FROM product_question WHERE product_id::text = ANY($1) ORDER BY sort_order`, [ids])).rows, "p");
      const tx = new Map((await c.query(`SELECT id::text, rate::float8 rate FROM tax WHERE store_id = $1`, [se.storeId])).rows.map(x => [x.id, x.rate]));
      const lb = new Map((await c.query(`SELECT DISTINCT ON (product_id) product_id::text p, label FROM category_product WHERE product_id::text = ANY($1) ORDER BY product_id, category_id`, [ids])).rows.map(x => [x.p, x.label]));
      rows.forEach(r => { r.channels = (ch.get(r.id) ?? []).map(x => x.id); r.questions = (q.get(r.id) ?? []).map(x => x.id); r.taxRate = tx.get(r.taxId) ?? null; r.buttonLabel = lb.get(r.id) ?? r.name; });
    } else if (m === "preguntas") {
      const a = by((await c.query(`SELECT qa.question_id::text q, qa.product_id::text "productId", p.plu, coalesce(qa.label, p.name) label, qa.extra_price::float8 "extraPrice", qa.bg_color "bgColor", qa.fg_color "fgColor"
        FROM question_answer qa JOIN product p ON p.id = qa.product_id WHERE qa.question_id::text = ANY($1) ORDER BY qa.sort_order`, [ids])).rows, "q");
      rows.forEach(r => { r.answers = (a.get(r.id) ?? []).map(({ q, ...x }) => x); });
    } else if (m === "estaciones") {
      const cp = by((await c.query(`SELECT station_id::text s, channel_id::text ch, printer_id::text pr FROM station_channel_printer WHERE station_id::text = ANY($1)`, [ids])).rows, "s");
      const pm = by((await c.query(`SELECT station_id::text s, payment_method_id::text id FROM station_payment_method WHERE station_id::text = ANY($1)`, [ids])).rows, "s");
      const dc = by((await c.query(`SELECT station_id::text s, discount_id::text id FROM station_discount WHERE station_id::text = ANY($1)`, [ids])).rows, "s");
      rows.forEach(r => { r.channels = Object.fromEntries((cp.get(r.id) ?? []).map(x => [x.ch, x.pr])); r.paymentMethods = (pm.get(r.id) ?? []).map(x => x.id); r.discounts = (dc.get(r.id) ?? []).map(x => x.id); });
    }
    return rows;
  }

  /** Lo que se guarda en el historial (sin secretos ni recuentos). */
  private snap(r: Row | null) { if (!r) return null; const { users, ...x } = r; return x; }

  // ───────────────────────── lectura ─────────────────────────
  async list(se: Session, module: string, o: { q?: string; limit?: string; cursor?: string; active?: string }) {
    const { m, d } = this.def(module);
    await this.allow(se, m);
    return this.ro(async c => {
      if (d.singleton) return { items: [await this.one(c, se, m, d, "current")], next: null };
      const limit = [25, 50, 100, 500].includes(Number(o.limit)) ? Number(o.limit) : 100, offset = Math.max(0, Number(o.cursor) || 0);
      const where = ["t.store_id = $1"], params: unknown[] = [se.storeId];
      if (!d.noActive && o.active !== "all") where.push(o.active === "false" ? "NOT t.active" : "t.active");
      if (o.q?.trim() && d.search) { params.push(`%${o.q.trim()}%`); where.push(`(${d.search.map(s => `t.${s} ILIKE $${params.length}`).join(" OR ")})`); }
      const { rows } = await c.query(`SELECT ${this.cols(d)} FROM "${d.table}" t WHERE ${where.join(" AND ")} ORDER BY ${d.order.split(",").map(x => x.trim().replace(/^([a-z_]+)/, "t.$1")).join(", ")} LIMIT ${limit + 1} OFFSET ${offset}`, params);
      const page = rows.slice(0, limit);
      return { items: await this.withExtra(c, se, m, page), next: rows.length > limit ? String(offset + limit) : null };
    });
  }

  async get(se: Session, module: string, id: string) {
    const { m, d } = this.def(module);
    await this.allow(se, m);
    return this.ro(c => this.one(c, se, m, d, id));
  }

  // ───────────────────────── escritura ─────────────────────────
  async create(se: Session, module: string, body: unknown) {
    const { m, d } = this.def(module);
    if (d.singleton) fail("VALIDATION", "Este módulo tiene un solo registro: cámbialo con PATCH …/current", { field: "module" });
    const { authorization, ...raw } = (body ?? {}) as Row;
    await this.allow(se, m, authorization);
    const b = parse(schemas(d).create, raw) as Row;
    return this.tx(async c => {
      const rec: Row = { ...Object.fromEntries(Object.entries(d.fields).filter(([, f]) => f.default !== undefined).map(([k, f]) => [k, f.default])), ...b };
      await this.prepare(c, se, m, rec, null);
      checkConfigRecord(m, rec, { isNew: true });
      const id = crypto.randomUUID(), cols = ["id", "store_id"], vals: unknown[] = [id, se.storeId];
      for (const [k, f] of Object.entries(d.fields)) if (rec[k] !== undefined) { cols.push(f.col); vals.push(this.toDb(f.kind, rec[k])); }
      if (m === "usuarios") { cols.push("pin_hash"); vals.push(await bcrypt.hash(String(rec.pin), 10)); }
      if (!d.noActive && rec.active === false) { cols.push("active"); vals.push(false); }
      await c.query(`INSERT INTO "${d.table}" (${cols.map(x => `"${x}"`).join(", ")}) VALUES (${vals.map((_, i) => `$${i + 1}`).join(", ")})`, vals);
      await this.saveExtra(c, se, m, id, rec, true);
      const after = await this.one(c, se, m, d, id);
      const configVersion = await this.record(c, se, m, d, "create", null, after);
      return { id, version: after.version as number, configVersion, item: after };
    });
  }

  async update(se: Session, module: string, id: string, body: unknown) {
    const { m, d } = this.def(module);
    const { authorization, ...raw } = (body ?? {}) as Row;
    await this.allow(se, m, authorization);
    const b = parse(schemas(d).patch, raw) as Row;
    return this.tx(async c => {
      const before = await this.one(c, se, m, d, id, true);
      const next = assertRecordVersion(before.version, b.version);
      const { version, ...patch } = b;
      if (m === "usuarios" && patch.active === false && before.id === se.user.id) fail("IN_USE", "No puedes desactivarte a ti mismo", { reason: "self" });
      const rec: Row = { ...before, ...patch };
      await this.prepare(c, se, m, rec, before);
      checkConfigRecord(m, { ...rec, pin: patch.pin }, { isNew: false });
      const sets: string[] = [], vals: unknown[] = [];
      for (const [k, f] of Object.entries(d.fields)) if (k in patch || (m === "productos" && k === "taxId" && rec.taxId !== before.taxId)) { vals.push(this.toDb(f.kind, rec[k])); sets.push(`"${f.col}" = $${vals.length}`); }
      if (m === "usuarios" && patch.pin) { vals.push(await bcrypt.hash(String(patch.pin), 10)); sets.push(`pin_hash = $${vals.length}`); }
      if (!d.noActive && !d.singleton && patch.active !== undefined) { vals.push(patch.active); sets.push(`active = $${vals.length}`); }
      vals.push(next); sets.push(`version = $${vals.length}`);
      const key = d.singleton ? (d.singleton === "store_id" ? "store_id" : "id") : "id";
      vals.push(before.id);
      await c.query(`UPDATE "${d.table}" SET ${sets.join(", ")} WHERE ${key}::text = $${vals.length}`, vals);
      await this.saveExtra(c, se, m, before.id, Object.fromEntries(Object.keys(patch).map(k => [k, rec[k]])), false);
      const after = await this.one(c, se, m, d, before.id);
      const action = patch.active === false && before.active ? "deactivate" : patch.active === true && before.active === false ? "activate" : "update";
      const configVersion = await this.record(c, se, m, d, action, before, after, patch.pin ? ["pin"] : []);
      if (d.singleton) this.stores.invalidate();
      return { id: before.id, version: after.version as number, configVersion, item: after };
    });
  }

  async deactivate(se: Session, module: string, id: string, body: unknown) {
    const { m, d } = this.def(module);
    const { authorization } = (body ?? {}) as Row;
    await this.allow(se, m, authorization);
    if (d.noActive) fail("VALIDATION", "Este módulo no se desactiva: cambia su valor", { field: "id" });
    return this.tx(async c => {
      const before = await this.one(c, se, m, d, id, true);
      if (!before.active) return { id: before.id, active: false, version: before.version as number };
      assertCanDeactivate(m, await this.usage(c, se, m, before));
      await c.query(`UPDATE "${d.table}" SET active = false, version = version + 1 WHERE id::text = $1`, [before.id]);
      const after = await this.one(c, se, m, d, before.id);
      await this.record(c, se, m, d, "deactivate", before, after);
      return { id: before.id, active: false, version: after.version as number };
    });
  }

  private toDb(kind: string, v: unknown) {
    if (v === undefined || v === null || v === "") return null;
    if (kind === "n") return Number(v).toFixed(2);
    return v;
  }

  /** Completa y valida lo que depende de otros registros (IVA por tipo, PLU nuevo, PIN repetido, permisos que existen…). */
  private async prepare(c: C, se: Session, m: ConfigModule, rec: Row, before: Row | null) {
    if (m === "usuarios") {
      if (!rec.initials && rec.name) rec.initials = String(rec.name).split(/\s+/).map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
      if (rec.pin) {
        const others = (await c.query(`SELECT id::text, pin_hash FROM app_user WHERE store_id = $1 AND active`, [se.storeId])).rows.filter(u => u.id !== before?.id);
        for (const u of others) if (await bcrypt.compare(String(rec.pin), u.pin_hash)) fail("DUPLICATE", "Ese PIN ya lo usa otra persona", { field: "pin" });
      }
    }
    if (m === "perfiles" && rec.permissions) {
      const unknown = (rec.permissions as string[]).filter(p => !ALL_PERMISSIONS.includes(p));
      if (unknown.length) fail("VALIDATION", "Permisos que no existen", { field: "permissions", unknown });
    }
    if (m === "productos") {
      if (rec.taxRate != null && (!before || rec.taxRate !== before.taxRate)) {
        const t = (await c.query(`SELECT id::text FROM tax WHERE store_id = $1 AND active AND rate = $2 LIMIT 1`, [se.storeId, rec.taxRate])).rows[0];
        if (!t) fail("VALIDATION", "No hay un IVA activo con ese tipo", { field: "taxRate" });
        rec.taxId = t.id;
      }
      if (!rec.taxId) fail("VALIDATION", "Falta el IVA (taxId o taxRate)", { field: "taxId" });
      if (rec.plu == null) {
        // PLU siguiente: uno a la vez por tienda (dos altas a la vez no se llevan el mismo número)
        await c.query(`SELECT pg_advisory_xact_lock(hashtext('plu:' || $1))`, [se.storeId]);
        rec.plu = Number((await c.query(`SELECT coalesce(max(plu), 0) + 1 n FROM product WHERE store_id = $1`, [se.storeId])).rows[0].n);
      }
      if (rec.channels) rec.channels = await this.resolve(c, se, "print_channel", rec.channels, "channels");
    }
    if (m === "facturacion") {
      // la base exige que las series existan en invoice_series (FK): se crean en la misma transacción si faltan
      for (const [k, kind] of [["seriesSimplified", "F2"], ["seriesFull", "F1"], ["seriesCredit", "R1"]] as const)
        if (rec[k]) await c.query(`INSERT INTO invoice_series (store_id, series, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [se.storeId, rec[k], kind]);
    }
    if (m === "estaciones" && rec.isMain === true && !before?.isMain) {
      // una sola caja principal por tienda: la anterior deja de serlo
      await c.query(`UPDATE station SET is_main = false, version = version + 1 WHERE store_id = $1 AND is_main AND id::text <> $2`, [se.storeId, before?.id ?? ""]);
    }
    if (m === "estaciones") {
      if (rec.paymentMethods) rec.paymentMethods = await this.resolve(c, se, "payment_method", rec.paymentMethods, "paymentMethods", "code");
      if (rec.channels) {
        const chs = await this.resolve(c, se, "print_channel", Object.keys(rec.channels), "channels");
        const prs = await this.resolve(c, se, "printer", Object.values(rec.channels as Record<string, string | null>).filter(Boolean) as string[], "channels");
        let k = 0; rec.channels = Object.fromEntries(Object.entries(rec.channels as Record<string, string | null>).map(([, p], i) => [chs[i], p ? prs[k++] : null]));
      }
    }
    if (m === "canales") {
      if (rec.kind === "ticket" && rec.copyOfId) fail("VALIDATION", "Un canal de tickets no es copia de otro", { field: "copyOfId" });
      if (rec.copyOfId) {
        if (before && rec.copyOfId === before.id) fail("VALIDATION", "Un canal no puede ser copia de sí mismo", { field: "copyOfId" });
        const o = (await c.query(`SELECT kind, copy_of_id FROM print_channel WHERE store_id = $1 AND id::text = $2`, [se.storeId, rec.copyOfId])).rows[0];
        if (!o) fail("VALIDATION", "El canal original no existe", { field: "copyOfId" });
        if (o.kind !== "kitchen" || o.copy_of_id) fail("VALIDATION", "Solo se copia un canal de comanda que no sea a su vez una copia", { field: "copyOfId" });
      }
      if (before && rec.kind === "ticket" && before.kind !== "ticket") {
        const n = Number((await c.query(`SELECT count(*) n FROM product_channel WHERE store_id = $1 AND channel_id = $2`, [se.storeId, before.id])).rows[0].n) + Number((await c.query(`SELECT count(*) n FROM print_channel WHERE store_id = $1 AND copy_of_id = $2 AND active`, [se.storeId, before.id])).rows[0].n);
        if (n) fail("VALIDATION", "Tiene productos o copias: no puede pasar a canal de tickets", { field: "kind" });
      }
      if (before && rec.kind === "kitchen" && before.kind === "ticket" && Number((await c.query(`SELECT count(*) n FROM area WHERE store_id = $1 AND ticket_channel_id = $2 AND active`, [se.storeId, before.id])).rows[0].n))
        fail("VALIDATION", "Lo usan áreas para sus tickets: no puede pasar a comanda", { field: "kind" });
    }
    if (m === "areas" && rec.ticketChannelId) {
      const k = (await c.query(`SELECT kind FROM print_channel WHERE store_id = $1 AND id::text = $2 AND active`, [se.storeId, rec.ticketChannelId])).rows[0];
      if (!k || k.kind !== "ticket") fail("VALIDATION", "Elige un canal de tickets activo", { field: "ticketChannelId" });
    }
    if (m === "productos" && rec.channels?.length) {
      const bad = (await c.query(`SELECT name FROM print_channel WHERE store_id = $1 AND id = ANY($2::uuid[]) AND (kind <> 'kitchen' OR copy_of_id IS NOT NULL)`, [se.storeId, rec.channels])).rows;
      if (bad.length) fail("VALIDATION", `Los productos van a canales de comanda (no a tickets ni a copias): ${bad.map(x => x.name).join(", ")}`, { field: "channels" });
    }
    if (m === "preguntas" && rec.answers) {
      for (const a of rec.answers as Row[]) if (!a.productId) {
        const p = (await c.query(`SELECT id::text FROM product WHERE store_id = $1 AND plu = $2`, [se.storeId, a.plu])).rows[0];
        if (!p) fail("VALIDATION", `No existe el producto ${a.plu}`, { field: "answers", plu: a.plu });
        a.productId = p.id;
      }
    }
  }
  /** Ids o nombres → ids (los equipos a veces mandan «BARRA» en vez del UUID). */
  private async resolve(c: C, se: Session, table: string, refs: string[], field: string, alt = "name"): Promise<string[]> {
    if (!refs.length) return [];
    const { rows } = await c.query(`SELECT id::text, lower(${alt}) k FROM "${table}" WHERE store_id = $1 AND (id::text = ANY($2) OR lower(${alt}) = ANY($3))`, [se.storeId, refs, refs.map(r => r.toLowerCase())]);
    return refs.map(r => { const x = rows.find(y => y.id === r || y.k === r.toLowerCase()); if (!x) fail("VALIDATION", `No existe «${r}»`, { field }); return x!.id; });
  }

  private async saveExtra(c: C, se: Session, m: ConfigModule, id: string, rec: Row, isNew: boolean) {
    const S = se.storeId;
    if (m === "perfiles" && rec.permissions) {
      await c.query(`DELETE FROM profile_permission WHERE profile_id = $1`, [id]);
      if (rec.permissions.length) await c.query(`INSERT INTO profile_permission (profile_id, permission_code, store_id) SELECT $1, unnest($2::text[]), $3`, [id, rec.permissions, S]);
    }
    if (m === "productos") {
      if (rec.channels) {
        await c.query(`DELETE FROM product_channel WHERE product_id = $1`, [id]);
        if (rec.channels.length) await c.query(`INSERT INTO product_channel (product_id, channel_id, store_id) SELECT $1, unnest($2::uuid[]), $3`, [id, rec.channels, S]);
      }
      if (rec.questions) {
        await c.query(`DELETE FROM product_question WHERE product_id = $1`, [id]);
        if (rec.questions.length) await c.query(`INSERT INTO product_question (product_id, question_id, store_id, sort_order) SELECT $1, q, $3, o - 1 FROM unnest($2::uuid[]) WITH ORDINALITY AS x(q, o)`, [id, rec.questions, S]);
      }
      // botón en la toma de pedido: la categoría del producto (una), con su nombre y colores
      // tecla en la toma de pedido: la categoría del producto, con su texto (buttonLabel; si no, el nombre) y colores
      if (isNew || "categoryId" in rec || "buttonLabel" in rec || "bgColor" in rec || "fgColor" in rec) {
        const p = (await c.query(`SELECT category_id, name, bg_color, fg_color FROM product WHERE id = $1`, [id])).rows[0];
        const cur = (await c.query(`SELECT category_id, label, bg_color, fg_color FROM category_product WHERE product_id = $1`, [id])).rows;
        const label = rec.buttonLabel ?? cur[0]?.label ?? p.name, bg = "bgColor" in rec || !cur[0] ? p.bg_color : cur[0].bg_color, fg = "fgColor" in rec || !cur[0] ? p.fg_color : cur[0].fg_color;
        if (p.category_id && !cur.some(x => x.category_id === p.category_id)) {
          await c.query(`DELETE FROM category_product WHERE product_id = $1`, [id]);
          await c.query(`INSERT INTO category_product (category_id, product_id, store_id, label, bg_color, fg_color, pos_x, pos_y) VALUES ($1,$2,$3,$4,$5,$6,0,(SELECT coalesce(max(pos_y),0)+1 FROM category_product WHERE category_id = $1))`, [p.category_id, id, S, label, bg, fg]);
        } else await c.query(`UPDATE category_product SET label = $2, bg_color = $3, fg_color = $4 WHERE product_id = $1`, [id, label, bg, fg]);
      }
    }
    if (m === "preguntas" && rec.answers) {
      await c.query(`DELETE FROM question_answer WHERE question_id = $1`, [id]);
      let i = 0;
      for (const a of rec.answers as Row[]) await c.query(`INSERT INTO question_answer (id, store_id, question_id, product_id, label, extra_price, bg_color, fg_color, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [crypto.randomUUID(), S, id, a.productId, a.label ?? null, Number(a.extraPrice ?? 0).toFixed(2), a.bgColor ?? null, a.fgColor ?? null, i++]);
    }
    if (m === "estaciones") {
      if (rec.channels) {
        await c.query(`DELETE FROM station_channel_printer WHERE station_id = $1`, [id]);
        for (const [ch, pr] of Object.entries(rec.channels as Record<string, string | null>)) if (pr) await c.query(`INSERT INTO station_channel_printer (station_id, channel_id, printer_id, store_id) VALUES ($1,$2,$3,$4)`, [id, ch, pr, S]);
      }
      if (rec.paymentMethods) {
        await c.query(`DELETE FROM station_payment_method WHERE station_id = $1`, [id]);
        if (rec.paymentMethods.length) await c.query(`INSERT INTO station_payment_method (station_id, payment_method_id, store_id) SELECT $1, unnest($2::uuid[]), $3`, [id, rec.paymentMethods, S]);
      }
      if (rec.discounts) {
        await c.query(`DELETE FROM station_discount WHERE station_id = $1`, [id]);
        if (rec.discounts.length) await c.query(`INSERT INTO station_discount (station_id, discount_id, store_id) SELECT $1, unnest($2::uuid[]), $3`, [id, rec.discounts, S]);
      }
    }
  }

  /** Qué impide desactivar (lo decide el dominio con estos recuentos). */
  private async usage(c: C, se: Session, m: ConfigModule, r: Row): Promise<ConfigUsage> {
    const n = async (q: string, p: unknown[]) => Number((await c.query(q, p)).rows[0].n);
    const S = se.storeId, id = r.id;
    switch (m) {
      case "usuarios": return { self: id === se.user.id };
      case "perfiles": return { users: await n(`SELECT count(*) n FROM app_user WHERE store_id=$1 AND active AND profile_id=$2`, [S, id]) };
      case "areas": return { activeChildren: await n(`SELECT count(*) n FROM dining_table WHERE store_id=$1 AND active AND area_id=$2`, [S, id]) };
      case "mesas": return { openOrders: await n(`SELECT count(*) n FROM orders WHERE store_id=$1 AND table_id=$2 AND status IN ('open','billing')`, [S, id]) };
      case "impuestos": return { products: await n(`SELECT count(*) n FROM product WHERE store_id=$1 AND active AND tax_id=$2`, [S, id]) };
      case "categorias": return { products: await n(`SELECT count(*) n FROM product WHERE store_id=$1 AND active AND category_id=$2`, [S, id]) };
      case "canales": return { products: await n(`SELECT count(*) n FROM product_channel pc JOIN product p ON p.id=pc.product_id WHERE pc.store_id=$1 AND p.active AND pc.channel_id=$2`, [S, id]),
        activeChildren: await n(`SELECT count(*) n FROM print_channel WHERE store_id=$1 AND active AND copy_of_id=$2`, [S, id]) + await n(`SELECT count(*) n FROM area WHERE store_id=$1 AND active AND ticket_channel_id=$2`, [S, id]) };
      case "impresoras": return { stations: await n(`SELECT count(*) n FROM station_channel_printer scp JOIN station s ON s.id=scp.station_id WHERE scp.store_id=$1 AND s.active AND scp.printer_id=$2`, [S, id])
        + await n(`SELECT count(*) n FROM print_channel WHERE store_id=$1 AND active AND printer_id=$2`, [S, id]) };
      case "preguntas": return { products: await n(`SELECT count(*) n FROM product_question pq JOIN product p ON p.id=pq.product_id WHERE pq.store_id=$1 AND p.active AND pq.question_id=$2`, [S, id]) };
      case "formas-pago": return { base: ["cash", "card"].includes(r.code) };
      case "estaciones": return { self: id === se.station.id };
      default: return {};
    }
  }

  /** Historial + versión de configuración + cola hacia el Manager (+ incidencia para Marketing si es un producto). Misma transacción. */
  private async record(c: C, se: Session, m: ConfigModule, d: ModuleDef, action: string, before: Row | null, after: Row | null, secret: string[] = []) {
    const a = se.actor(this.clock());
    const diff = [describeDiff(this.snap(before), this.snap(after), labelsOf(d)), ...secret.map(s => `${(labelsOf(d) as Record<string, string>)[s] ?? s}: cambiado`)].filter(Boolean).join(" · ");
    const v = Number((await c.query(`UPDATE store SET config_version = config_version + 1 WHERE id = $1 RETURNING config_version`, [se.storeId])).rows[0].config_version);
    const name = String(after?.[d.nameField] ?? before?.[d.nameField] ?? "");
    const rid = String(after?.id ?? before?.id);
    await c.query(`INSERT INTO config_change_log (id, store_id, at, user_id, user_name, module, action, record_name, diff, record_id, before, after, config_version, device) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [crypto.randomUUID(), se.storeId, a.at, a.userId, a.user, m, action, name.slice(0, 120), diff.slice(0, 4000) || "Sin cambios", rid, JSON.stringify(this.snap(before)), JSON.stringify(this.snap(after)), v, a.device]);
    await c.query(`INSERT INTO sync_outbox (store_id, entity, entity_id, operation, payload) VALUES ($1, 'config', $2, 'upsert', $3)`,
      [se.storeId, /^[0-9a-f-]{36}$/.test(rid) ? rid : se.storeId, JSON.stringify({ module: m, action, configVersion: v, record: this.snap(after) })]);
    if (m === "productos") {
      // código correlativo: uno a la vez por tienda (sin repetidos con dos cambios a la vez)
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('incident:' || $1))`, [se.storeId]);
      const code = `INC-${String(Number((await c.query(`SELECT count(*) + 1 n FROM product_incident WHERE store_id = $1`, [se.storeId])).rows[0].n)).padStart(4, "0")}`;
      await c.query(`INSERT INTO product_incident (id, store_id, code, at, user_name, product_id, product_name, action, diff, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')`,
        [crypto.randomUUID(), se.storeId, code, a.at, a.user, rid, name.slice(0, 80), action, diff.slice(0, 4000)]);
    }
    return v;
  }

  // ───────────────────────── historial y paquete ─────────────────────────
  async history(se: Session, o: { module?: string; recordId?: string; limit?: string; cursor?: string }) {
    await this.auth.require(se, "ajustes.historial");
    return this.ro(async c => {
      const limit = Math.min(500, Number(o.limit) || 100), offset = Math.max(0, Number(o.cursor) || 0), p: unknown[] = [se.storeId], w = ["store_id = $1"];
      if (o.module) { p.push(o.module); w.push(`module = $${p.length}`); }
      if (o.recordId) { p.push(o.recordId); w.push(`record_id = $${p.length}`); }
      const { rows } = await c.query(`SELECT id::text, at, user_name, device, module, action, record_name, record_id, diff, config_version, synced_at FROM config_change_log WHERE ${w.join(" AND ")} ORDER BY at DESC, config_version DESC NULLS LAST LIMIT ${limit + 1} OFFSET ${offset}`, p);
      return { items: rows.slice(0, limit).map(r => ({ id: r.id, at: new Date(r.at).toISOString(), user: r.user_name, device: r.device, module: r.module, action: r.action, record: r.record_name, recordId: r.record_id, diff: r.diff, configVersion: r.config_version == null ? null : Number(r.config_version), syncedAt: r.synced_at ? new Date(r.synced_at).toISOString() : null })),
        next: rows.length > limit ? String(offset + limit) : null };
    });
  }

  async configVersion(storeId: string) {
    return Number((await this.database.pool.query(`SELECT config_version FROM store WHERE id = $1`, [storeId])).rows[0].config_version);
  }

  /** GET /config: todo lo que el equipo necesita para trabajar (sin permisos de Ajustes: lo usan todos los equipos). */
  async bundle(se: Session) {
    return this.ro(async c => {
      const one = async (m: ConfigModule) => this.one(c, se, m, MODULES[m], "current");
      const all = async (m: ConfigModule) => { const d = MODULES[m]; const { rows } = await c.query(`SELECT ${this.cols(d)} FROM "${d.table}" t WHERE t.store_id = $1${d.noActive ? "" : " AND t.active"} ORDER BY ${d.order.split(",").map(x => x.trim().replace(/^([a-z_]+)/, "t.$1")).join(", ")}`, [se.storeId]); return this.withExtra(c, se, m, rows); };
      const [restaurant, company, billing, parameters] = [await one("restaurante"), await one("empresa"), await one("facturacion"), await one("parametros")];
      const areas = await all("areas"), tables = await all("mesas");
      const cats = await all("categorias"), products = await all("productos"), questions = await all("preguntas");
      const version = Number((await c.query(`SELECT config_version FROM store WHERE id = $1`, [se.storeId])).rows[0].config_version);
      return {
        version, restaurant: { ...restaurant, code: restaurant.code, serviceType: restaurant.serviceType }, company, billing, parameters,
        areas: areas.map(a => ({ ...a, tables: tables.filter(t => t.areaId === a.id) })),
        catalog: { categories: cats, products, questions },
        taxes: await all("impuestos"), paymentMethods: await all("formas-pago"), discounts: await all("descuentos"), reasons: await all("motivos"),
        channels: await all("canales"), printers: await all("impresoras"), stations: await all("estaciones"),
      };
    });
  }

  static readonly SINGLETONS = SINGLETON_MODULES;
}
