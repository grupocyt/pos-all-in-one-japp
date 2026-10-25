import { Inject, Injectable } from "@nestjs/common";
import bcrypt from "bcryptjs";
import type { Database, Tx } from "@japp/db";
import {
  assertCanDeactivate,
  assertRecordVersion,
  checkConfigRecord,
  describeDiff,
  fail,
  CONFIG_PERMISSION,
  SINGLETON_MODULES,
  isConfigModule,
  ALL_PERMISSIONS,
  type ConfigModule,
  type ConfigUsage,
} from "@japp/domain";
import { CLOCK, DATABASE, type Clock } from "../Constants/Injection.js";
import type { Session } from "../Helpers/AuthGuard.js";
import { AuthorizationService } from "./AuthorizationService.js";
import { parse } from "../Helpers/ValidationHelper.js";
import { StoreApplication } from "../Applications/StoreApplication.js";
import { MODULES, labelsOf, type ModuleDef } from "../Applications/ConfigRegistry.js";
import { ConfigApplication, type RefTable, type Row } from "../Applications/ConfigApplication.js";
import { ConfigHistoryApplication } from "../Applications/ConfigHistoryApplication.js";
import { CartaSyncApplication } from "../Applications/CartaSyncApplication.js";
import { schemas, type ConfigHistoryQuery, type ConfigListQuery } from "../Models/ConfigModels.js";

const PG_UNIQUE = "23505";
const PG_FK = "23503";
const PG_CHECK = "23514";
const PG_MAPPED = new Set([PG_UNIQUE, PG_FK, PG_CHECK, "22P02", "22003"]);

/** Acción que se apunta en el historial al cambiar un registro (activar y desactivar se distinguen). */
function updateAction(patch: Row, before: Row) {
  if (patch.active === false && before.active) {
    return "deactivate";
  }
  if (patch.active === true && before.active === false) {
    return "activate";
  }
  return "update";
}

/** Ajustes por API: listar, ver, crear, cambiar (con versión), desactivar e historial. Nada se borra. */
@Injectable()
export class ConfigService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(StoreApplication) private readonly stores: StoreApplication,
    @Inject(AuthorizationService) private readonly auth: AuthorizationService,
    @Inject(ConfigApplication) private readonly config: ConfigApplication,
    @Inject(ConfigHistoryApplication) private readonly changes: ConfigHistoryApplication,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CartaSyncApplication) private readonly carta: CartaSyncApplication,
  ) {}

  // ───────────────────────── utilidades ─────────────────────────
  def(module: string): { m: ConfigModule; d: ModuleDef } {
    if (!isConfigModule(module)) {
      fail("NOT_FOUND", "Ese módulo de Ajustes no existe", { module });
    }
    return { m: module as ConfigModule, d: MODULES[module as ConfigModule] };
  }
  async allow(se: Session, m: ConfigModule, authorization?: string | null) {
    await this.auth.require(se, CONFIG_PERMISSION[m], authorization);
  }

  /** Un cambio = una transacción; los errores de la base salen ya como errores del contrato. */
  private async tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.database.withTx(fn);
    } catch (e: any) {
      throw this.pgError(e);
    }
  }
  /** Lecturas (sin transacción), con la misma traducción de errores. */
  private async ro<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      throw this.pgError(e);
    }
  }
  /** Errores de la base → errores del contrato (nunca un 500 por un dato repetido o una referencia mala). */
  private pgError(ex: any) {
    // Drizzle envuelve el error de pg (DrizzleQueryError): el código está en `cause`
    let e: any = ex;
    for (let i = 0; e && i < 4 && !PG_MAPPED.has(e.code); i++) {
      e = e.cause;
    }
    if (!e || !PG_MAPPED.has(e.code)) {
      return ex;
    }
    if (e.code === PG_UNIQUE && e.constraint === "uq_station_device_uuid") {
      return this.mk("DUPLICATE", "Ese UUID de equipo ya lo tiene otra estación activa: quítaselo primero", {
        field: "deviceUuid",
        constraint: e.constraint,
      });
    }
    if (e.code === PG_UNIQUE) {
      return this.mk("DUPLICATE", "Ya existe un registro con ese nombre o código", {
        constraint: e.constraint,
      });
    }
    if (e.code === PG_FK) {
      return this.mk("VALIDATION", "Hace referencia a algo que no existe", {
        field: this.fkField(e.constraint),
        constraint: e.constraint,
      });
    }
    if (e.code === PG_CHECK) {
      return this.mk("VALIDATION", "Valor fuera de lo permitido", { constraint: e.constraint });
    }
    return this.mk("VALIDATION", "Valor no válido", {});
  }
  private mk(code: any, msg: string, details: Record<string, unknown>) {
    try {
      fail(code, msg, details);
    } catch (x) {
      return x;
    }
  }
  private fkField(constraint = "") {
    const m: Record<string, string> = {
      profile_id: "profileId",
      area_id: "areaId",
      category_id: "categoryId",
      tax_id: "taxId",
      product_id: "answers",
      channel_id: "channels",
      printer_id: "channels",
      payment_method_id: "paymentMethods",
      discount_id: "discounts",
      question_id: "questions",
    };
    return Object.entries(m).find(([k]) => constraint.includes(k))?.[1] ?? null;
  }

  /**
   * Un registro (los módulos de un solo registro se piden con «current»).
   * Con `tx` se lee dentro de la transacción; con `lock`, además, bloqueado para cambiarlo (FOR UPDATE).
   */
  private async one(
    se: Session,
    m: ConfigModule,
    d: ModuleDef,
    id: string,
    tx?: Tx,
    lock = false,
  ): Promise<Row> {
    if (d.singleton && id !== "current" && id !== se.storeId) {
      fail("NOT_FOUND", "Este módulo tiene un solo registro: usa «current»", { id });
    }
    let row: Row | null;
    if (tx && lock) {
      row = await this.config.findOneForUpdate(tx, se.storeId, m, id);
    } else {
      row = await this.config.findOne(se.storeId, m, id, tx);
    }
    if (!row) {
      fail("NOT_FOUND", "No existe", { module: m, id });
    }
    return row!;
  }

  /** Lo que se guarda en el historial (sin secretos ni recuentos). */
  private snap(r: Row | null) {
    if (!r) {
      return null;
    }
    const { users, ...x } = r;
    return x;
  }

  // ───────────────────────── lectura ─────────────────────────
  async list(se: Session, module: string, o: ConfigListQuery) {
    const { m, d } = this.def(module);
    await this.allow(se, m);
    return this.ro(async () => {
      if (d.singleton) {
        return { items: [await this.one(se, m, d, "current")], next: null };
      }
      const limit = [25, 50, 100, 500].includes(Number(o.limit)) ? Number(o.limit) : 100;
      const offset = Math.max(0, Number(o.cursor) || 0);
      let active: boolean | null = null;
      if (!d.noActive && o.active !== "all") {
        active = o.active !== "false";
      }
      const r = await this.config.page(se.storeId, m, {
        active,
        search: o.q?.trim() || null,
        limit,
        offset,
      });
      return { items: r.items, next: r.more ? String(offset + limit) : null };
    });
  }

  async get(se: Session, module: string, id: string) {
    const { m, d } = this.def(module);
    await this.allow(se, m);
    return this.ro(() => this.one(se, m, d, id));
  }

  // ───────────────────────── escritura ─────────────────────────
  async create(se: Session, module: string, body: unknown) {
    const { m, d } = this.def(module);
    if (d.singleton) {
      fail("VALIDATION", "Este módulo tiene un solo registro: cámbialo con PATCH …/current", {
        field: "module",
      });
    }
    const { authorization, ...raw } = (body ?? {}) as Row;
    await this.allow(se, m, authorization);
    const b = parse(schemas(d).create, raw) as Row;
    return this.tx(async (tx) => {
      const rec: Row = {
        ...Object.fromEntries(
          Object.entries(d.fields)
            .filter(([, f]) => f.default !== undefined)
            .map(([k, f]) => [k, f.default]),
        ),
        ...b,
      };
      await this.prepare(tx, se, m, rec, null);
      checkConfigRecord(m, rec, { isNew: true });
      const id = crypto.randomUUID();
      let pinHash: string | undefined;
      if (m === "usuarios") {
        pinHash = await bcrypt.hash(String(rec.pin), 10);
      }
      await this.config.insert(tx, se.storeId, m, id, rec, {
        pinHash,
        inactive: !d.noActive && rec.active === false,
      });
      await this.saveExtra(tx, se, m, id, rec, true);
      const after = await this.one(se, m, d, id, tx);
      const configVersion = await this.record(tx, se, m, d, "create", null, after);
      return { id, version: after.version as number, configVersion, item: after };
    });
  }

  async update(se: Session, module: string, id: string, body: unknown) {
    const { m, d } = this.def(module);
    const { authorization, ...raw } = (body ?? {}) as Row;
    await this.allow(se, m, authorization);
    const b = parse(schemas(d).patch, raw) as Row;
    return this.tx(async (tx) => {
      const before = await this.one(se, m, d, id, tx, true);
      const next = assertRecordVersion(before.version, b.version);
      const { version, ...patch } = b;
      if (m === "usuarios" && patch.active === false && before.id === se.user.id) {
        fail("IN_USE", "No puedes desactivarte a ti mismo", { reason: "self" });
      }
      const rec: Row = { ...before, ...patch };
      await this.prepare(tx, se, m, rec, before);
      checkConfigRecord(m, { ...rec, pin: patch.pin }, { isNew: false });
      // columnas que cambian: lo que viene en el cuerpo y, en productos, el IVA si se resolvió por tipo
      const keys = Object.keys(d.fields).filter(
        (k) => k in patch || (m === "productos" && k === "taxId" && rec.taxId !== before.taxId),
      );
      let pinHash: string | undefined;
      if (m === "usuarios" && patch.pin) {
        pinHash = await bcrypt.hash(String(patch.pin), 10);
      }
      let active: boolean | undefined;
      if (!d.noActive && !d.singleton && patch.active !== undefined) {
        active = patch.active;
      }
      await this.config.update(tx, m, before.id, rec, { keys, pinHash, active, version: next });
      await this.saveExtra(
        tx,
        se,
        m,
        before.id,
        Object.fromEntries(Object.keys(patch).map((k) => [k, rec[k]])),
        false,
      );
      const after = await this.one(se, m, d, before.id, tx);
      const action = updateAction(patch, before);
      const configVersion = await this.record(tx, se, m, d, action, before, after, patch.pin ? ["pin"] : []);
      if (d.singleton) {
        this.stores.invalidate();
      }
      return { id: before.id, version: after.version as number, configVersion, item: after };
    });
  }

  async deactivate(se: Session, module: string, id: string, body: unknown) {
    const { m, d } = this.def(module);
    const { authorization } = (body ?? {}) as Row;
    await this.allow(se, m, authorization);
    if (d.noActive) {
      fail("VALIDATION", "Este módulo no se desactiva: cambia su valor", { field: "id" });
    }
    return this.tx(async (tx) => {
      const before = await this.one(se, m, d, id, tx, true);
      if (!before.active) {
        return { id: before.id, active: false, version: before.version as number };
      }
      assertCanDeactivate(m, await this.usage(tx, se, m, before));
      await this.config.deactivate(tx, m, before.id);
      const after = await this.one(se, m, d, before.id, tx);
      await this.record(tx, se, m, d, "deactivate", before, after);
      return { id: before.id, active: false, version: after.version as number };
    });
  }

  /** Completa y valida lo que depende de otros registros (IVA por tipo, PLU nuevo, PIN repetido, permisos que existen…). */
  private async prepare(tx: Tx, se: Session, m: ConfigModule, rec: Row, before: Row | null) {
    const S = se.storeId;
    if (m === "usuarios") {
      if (!rec.initials && rec.name) {
        rec.initials = String(rec.name)
          .split(/\s+/)
          .map((w: string) => w[0])
          .join("")
          .slice(0, 2)
          .toUpperCase();
      }
      if (rec.pin) {
        const others = (await this.config.activeUserPins(tx, S)).filter((u) => u.id !== before?.id);
        for (const u of others) {
          if (await bcrypt.compare(String(rec.pin), u.pinHash)) {
            fail("DUPLICATE", "Ese PIN ya lo usa otra persona", { field: "pin" });
          }
        }
      }
    }
    if (m === "perfiles" && rec.permissions) {
      const unknown = (rec.permissions as string[]).filter((p) => !ALL_PERMISSIONS.includes(p));
      if (unknown.length) {
        fail("VALIDATION", "Permisos que no existen", { field: "permissions", unknown });
      }
    }
    if (m === "productos") {
      if (rec.taxRate != null && (!before || rec.taxRate !== before.taxRate)) {
        const taxId = await this.config.activeTaxIdByRate(tx, S, rec.taxRate);
        if (!taxId) {
          fail("VALIDATION", "No hay un IVA activo con ese tipo", { field: "taxRate" });
        }
        rec.taxId = taxId;
      }
      if (!rec.taxId) {
        fail("VALIDATION", "Falta el IVA (taxId o taxRate)", { field: "taxId" });
      }
      if (rec.plu == null) {
        // PLU siguiente: uno a la vez por tienda (dos altas a la vez no se llevan el mismo número). Antes, el de carta:
        // el sync de carta toma carta → PLU → filas; si aquí se tomara solo el de PLU, los dos podrían esperarse
        await this.carta.lockCarta(tx, S);
        rec.plu = await this.config.lockAndNextPlu(tx, S);
      }
      if (rec.channels) {
        rec.channels = await this.resolve(tx, se, "print_channel", rec.channels, "channels");
      }
    }
    if (m === "facturacion") {
      // la base exige que las series existan en invoice_series (FK): se crean en la misma transacción si faltan
      for (const [k, kind] of [
        ["seriesSimplified", "F2"],
        ["seriesFull", "F1"],
        ["seriesCredit", "R1"],
      ] as const) {
        if (rec[k]) {
          await this.config.ensureInvoiceSeries(tx, S, rec[k], kind);
        }
      }
    }
    if (m === "estaciones" && rec.isMain === true && !before?.isMain) {
      // una sola caja principal por tienda: la anterior deja de serlo
      await this.config.clearOtherMainStations(tx, S, before?.id ?? "");
    }
    if (m === "estaciones") {
      if (rec.paymentMethods) {
        rec.paymentMethods = await this.resolve(
          tx,
          se,
          "payment_method",
          rec.paymentMethods,
          "paymentMethods",
        );
      }
      if (rec.channels) {
        const chs = await this.resolve(tx, se, "print_channel", Object.keys(rec.channels), "channels");
        const prs = await this.resolve(
          tx,
          se,
          "printer",
          Object.values(rec.channels as Record<string, string | null>).filter(Boolean) as string[],
          "channels",
        );
        let k = 0;
        rec.channels = Object.fromEntries(
          Object.entries(rec.channels as Record<string, string | null>).map(([, p], i) => [
            chs[i],
            p ? prs[k++] : null,
          ]),
        );
      }
    }
    if (m === "canales") {
      if (rec.kind === "ticket" && rec.copyOfId) {
        fail("VALIDATION", "Un canal de tickets no es copia de otro", { field: "copyOfId" });
      }
      if (rec.copyOfId) {
        if (before && rec.copyOfId === before.id) {
          fail("VALIDATION", "Un canal no puede ser copia de sí mismo", { field: "copyOfId" });
        }
        const o = await this.config.channelKind(tx, S, rec.copyOfId);
        if (!o) {
          fail("VALIDATION", "El canal original no existe", { field: "copyOfId" });
        }
        if (o!.kind !== "kitchen" || o!.copyOfId) {
          fail("VALIDATION", "Solo se copia un canal de comanda que no sea a su vez una copia", {
            field: "copyOfId",
          });
        }
      }
      if (before && rec.kind === "ticket" && before.kind !== "ticket") {
        const n =
          (await this.config.countChannelProducts(tx, S, before.id)) +
          (await this.config.countActiveCopiesOfChannel(tx, S, before.id));
        if (n) {
          fail("VALIDATION", "Tiene productos o copias: no puede pasar a canal de tickets", {
            field: "kind",
          });
        }
      }
      if (
        before &&
        rec.kind === "kitchen" &&
        before.kind === "ticket" &&
        (await this.config.countActiveAreasWithTicketChannel(tx, S, before.id))
      ) {
        fail("VALIDATION", "Lo usan áreas para sus tickets: no puede pasar a comanda", { field: "kind" });
      }
    }
    if (m === "areas" && rec.ticketChannelId) {
      const kind = await this.config.activeChannelKind(tx, S, rec.ticketChannelId);
      if (kind !== "ticket") {
        fail("VALIDATION", "Elige un canal de tickets activo", { field: "ticketChannelId" });
      }
    }
    if (m === "productos" && rec.channels?.length) {
      const bad = await this.config.nonKitchenChannelNames(tx, S, rec.channels);
      if (bad.length) {
        fail(
          "VALIDATION",
          `Los productos van a canales de comanda (no a tickets ni a copias): ${bad.join(", ")}`,
          { field: "channels" },
        );
      }
    }
    if (m === "preguntas" && rec.answers) {
      for (const a of rec.answers as Row[]) {
        if (!a.productId) {
          const productId = await this.config.productIdByPlu(tx, S, a.plu);
          if (!productId) {
            fail("VALIDATION", `No existe el producto ${a.plu}`, { field: "answers", plu: a.plu });
          }
          a.productId = productId;
        }
      }
    }
  }
  /** Ids o nombres → ids (los equipos a veces mandan «BARRA» en vez del UUID). */
  private async resolve(
    tx: Tx,
    se: Session,
    table: RefTable,
    refs: string[],
    field: string,
  ): Promise<string[]> {
    if (!refs.length) {
      return [];
    }
    const rows = await this.config.findRefs(tx, se.storeId, table, refs);
    return refs.map((r) => {
      const x = rows.find((y) => y.id === r || y.k === r.toLowerCase());
      if (!x) {
        fail("VALIDATION", `No existe «${r}»`, { field });
      }
      return x!.id;
    });
  }

  private async saveExtra(tx: Tx, se: Session, m: ConfigModule, id: string, rec: Row, isNew: boolean) {
    const S = se.storeId;
    if (m === "perfiles" && rec.permissions) {
      await this.config.replaceProfilePermissions(tx, S, id, rec.permissions);
    }
    if (m === "productos") {
      if (rec.channels) {
        await this.config.replaceProductChannels(tx, S, id, rec.channels);
      }
      if (rec.questions) {
        await this.config.replaceProductQuestions(tx, S, id, rec.questions);
      }
      // botón en la toma de pedido: la categoría del producto (una), con su nombre y colores
      // tecla en la toma de pedido: la categoría del producto, con su texto (buttonLabel; si no, el nombre) y colores
      if (isNew || "categoryId" in rec || "buttonLabel" in rec || "bgColor" in rec || "fgColor" in rec) {
        const { product: p, current: cur } = await this.config.productButton(tx, S, id);
        const label = rec.buttonLabel ?? cur[0]?.label ?? p.name;
        const bg = "bgColor" in rec || !cur[0] ? p.bg_color : cur[0].bg_color;
        const fg = "fgColor" in rec || !cur[0] ? p.fg_color : cur[0].fg_color;
        if (p.category_id && !cur.some((x) => x.category_id === p.category_id)) {
          await this.config.moveProductButton(tx, S, id, { categoryId: p.category_id, label, bg, fg });
        } else {
          await this.config.updateProductButton(tx, S, id, { label, bg, fg });
        }
      }
    }
    if (m === "preguntas" && rec.answers) {
      await this.config.replaceQuestionAnswers(tx, S, id, rec.answers as Row[]);
    }
    if (m === "estaciones") {
      if (rec.channels) {
        await this.config.replaceStationChannels(tx, S, id, rec.channels as Record<string, string | null>);
      }
      if (rec.paymentMethods) {
        await this.config.replaceStationPaymentMethods(tx, S, id, rec.paymentMethods);
      }
      if (rec.discounts) {
        await this.config.replaceStationDiscounts(tx, S, id, rec.discounts);
      }
    }
  }

  /** Qué impide desactivar (lo decide el dominio con estos recuentos). */
  private async usage(tx: Tx, se: Session, m: ConfigModule, r: Row): Promise<ConfigUsage> {
    const S = se.storeId;
    const id = r.id;
    switch (m) {
      case "usuarios":
        return { self: id === se.user.id };
      case "perfiles":
        return { users: await this.config.countActiveUsersOfProfile(tx, S, id) };
      case "areas":
        return { activeChildren: await this.config.countActiveTablesOfArea(tx, S, id) };
      case "mesas":
        return { openOrders: await this.config.countOpenOrdersOfTable(tx, S, id) };
      case "impuestos":
        return { products: await this.config.countActiveProductsWithTax(tx, S, id) };
      case "categorias":
        return { products: await this.config.countActiveProductsInCategory(tx, S, id) };
      case "canales":
        return {
          products: await this.config.countActiveProductsInChannel(tx, S, id),
          activeChildren:
            (await this.config.countActiveCopiesOfChannel(tx, S, id)) +
            (await this.config.countActiveAreasWithTicketChannel(tx, S, id)),
        };
      case "impresoras":
        return {
          stations:
            (await this.config.countActiveStationsWithPrinter(tx, S, id)) +
            (await this.config.countActiveChannelsWithPrinter(tx, S, id)),
        };
      case "preguntas":
        return { products: await this.config.countActiveProductsWithQuestion(tx, S, id) };
      case "formas-pago":
        return { base: ["cash", "card"].includes(r.code) };
      case "estaciones":
        return { self: id === se.station.id };
      default:
        return {};
    }
  }

  /** Historial + versión de configuración + cola hacia el Manager (+ incidencia para Marketing si es un producto). Misma transacción. */
  private async record(
    tx: Tx,
    se: Session,
    m: ConfigModule,
    d: ModuleDef,
    action: string,
    before: Row | null,
    after: Row | null,
    secret: string[] = [],
  ) {
    const a = se.actor(this.clock());
    const diff = [
      describeDiff(this.snap(before), this.snap(after), labelsOf(d)),
      ...secret.map((s) => `${(labelsOf(d) as Record<string, string>)[s] ?? s}: cambiado`),
    ]
      .filter(Boolean)
      .join(" · ");
    const v = await this.changes.bumpConfigVersion(tx, se.storeId);
    const name = String(after?.[d.nameField] ?? before?.[d.nameField] ?? "");
    const rid = String(after?.id ?? before?.id);
    await this.changes.insertChangeLog(tx, {
      storeId: se.storeId,
      at: a.at,
      userId: a.userId,
      userName: a.user,
      module: m,
      action,
      recordName: name.slice(0, 120),
      diff: diff.slice(0, 4000) || "Sin cambios",
      recordId: rid,
      before: this.snap(before),
      after: this.snap(after),
      configVersion: v,
      device: a.device,
    });
    // los módulos de un solo registro no tienen UUID propio: la cola los apunta a la tienda
    await this.changes.enqueueConfig(tx, se.storeId, /^[0-9a-f-]{36}$/.test(rid) ? rid : se.storeId, {
      module: m,
      action,
      configVersion: v,
      record: this.snap(after),
    });
    if (m === "productos") {
      // código correlativo: uno a la vez por tienda (sin repetidos con dos cambios a la vez)
      const n = await this.changes.lockAndNextIncidentNumber(tx, se.storeId);
      await this.changes.insertProductIncident(tx, {
        storeId: se.storeId,
        code: `INC-${String(n).padStart(4, "0")}`,
        at: a.at,
        userName: a.user,
        productId: rid,
        productName: name.slice(0, 80),
        action,
        diff: diff.slice(0, 4000),
      });
    }
    return v;
  }

  // ───────────────────────── historial y paquete ─────────────────────────
  async history(se: Session, o: ConfigHistoryQuery) {
    await this.auth.require(se, "ajustes.historial");
    return this.ro(async () => {
      const limit = Math.min(500, Number(o.limit) || 100);
      const offset = Math.max(0, Number(o.cursor) || 0);
      const r = await this.changes.history(se.storeId, {
        module: o.module,
        recordId: o.recordId,
        limit,
        offset,
      });
      return { items: r.items, next: r.more ? String(offset + limit) : null };
    });
  }

  async configVersion(storeId: string) {
    return this.changes.configVersion(storeId);
  }

  /**
   * GET /config con ETag = versión de configuración: si el equipo ya la tiene (If-None-Match igual),
   * no se arma el paquete y el controlador responde 304.
   */
  async bundleIfChanged(se: Session, ifNoneMatch: string) {
    const v = await this.configVersion(se.storeId);
    const etag = `W/"${v}"`;
    if (ifNoneMatch === etag) {
      return { etag, notModified: true, data: null };
    }
    return { etag, notModified: false, data: await this.bundle(se) };
  }

  /** GET /config: todo lo que el equipo necesita para trabajar (sin permisos de Ajustes: lo usan todos los equipos). */
  async bundle(se: Session) {
    return this.ro(async () => {
      const one = async (m: ConfigModule) => this.one(se, m, MODULES[m], "current");
      const all = async (m: ConfigModule) => this.config.listActive(se.storeId, m);
      const [restaurant, company, billing, parameters] = [
        await one("restaurante"),
        await one("empresa"),
        await one("facturacion"),
        await one("parametros"),
      ];
      const areas = await all("areas");
      const tables = await all("mesas");
      const cats = await all("categorias");
      const products = await all("productos");
      const questions = await all("preguntas");
      const version = await this.changes.configVersion(se.storeId);
      return {
        version,
        restaurant: { ...restaurant, code: restaurant.code, serviceType: restaurant.serviceType },
        company,
        billing,
        parameters,
        areas: areas.map((a) => ({ ...a, tables: tables.filter((t) => t.areaId === a.id) })),
        catalog: { categories: cats, products, questions },
        taxes: await all("impuestos"),
        paymentMethods: await all("formas-pago"),
        discounts: await all("descuentos"),
        reasons: await all("motivos"),
        channels: await all("canales"),
        printers: await all("impresoras"),
        stations: await all("estaciones"),
      };
    });
  }

  static readonly SINGLETONS = SINGLETON_MODULES;
}
