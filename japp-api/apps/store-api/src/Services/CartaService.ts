import { Inject, Injectable } from "@nestjs/common";
import type { Database, Tx } from "@japp/db";
import { assertRecordVersion, describeDiff, fail, isOotProduct } from "@japp/domain";
import { CLOCK, DATABASE, type Clock } from "../Constants/Injection.js";
import type { Session } from "../Helpers/AuthGuard.js";
import { AuthorizationService } from "./AuthorizationService.js";
import { parse } from "../Helpers/ValidationHelper.js";
import { ConfigHistoryApplication } from "../Applications/ConfigHistoryApplication.js";
import { MODULES, labelsOf } from "../Applications/ConfigRegistry.js";
import { CartaSyncApplication, type PreviewRow } from "../Applications/CartaSyncApplication.js";
import { LayoutModel, OrderModel, PreviewModeModel, SoldOutModel } from "../Models/CartaModels.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un registro que cambia, para el historial de Ajustes. */
interface Logged {
  module: "categorias" | "productos" | "areas";
  action: "update";
  id: string;
  name: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

/**
 * Ajustes › Carta y Sala: carta completa para el Manager, vista previa (TPV u Order on Table), orden de
 * categorías y áreas, agotado, catálogo de permisos, PWA de la PDA y Editar sala.
 * Cada cambio, en una transacción: versión del registro, store.config_version +1, config_change_log y cola (entity 'config').
 */
@Injectable()
export class CartaService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(AuthorizationService) private readonly auth: AuthorizationService,
    @Inject(CartaSyncApplication) private readonly carta: CartaSyncApplication,
    @Inject(ConfigHistoryApplication) private readonly changes: ConfigHistoryApplication,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ───────────────────────── lectura ─────────────────────────
  /** GET /config/carta: lo mismo que se manda en los sync, con id y externalId (active=all incluye los desactivados). */
  async cartaFull(se: Session, active?: string) {
    for (const p of ["ajustes.categorias", "ajustes.productos", "ajustes.preguntas"]) {
      await this.auth.require(se, p);
    }
    if (active !== undefined && active !== "true" && active !== "all") {
      fail("VALIDATION", "active es true o all", { field: "active" });
    }
    const all = active === "all";
    const c = await this.carta.carta(se.storeId);
    const keep = <T extends { active: boolean }>(xs: T[]) => xs.filter((x) => all || x.active);
    return {
      categories: keep(c.categories).map(({ version: _v, ...x }) => x),
      products: keep(c.products).map(({ version: _v, taxId: _t, ...x }) => x),
      questions: keep(c.questions).map(({ version: _v, ...x }) => x),
      configVersion: await this.changes.configVersion(se.storeId),
    };
  }

  /**
   * GET /config/carta/preview: mode=tpv → categorías visibles con sus teclas (sin «solo como respuesta»);
   * mode=oot → solo lo que se puede pedir desde Order on Table (isOotProduct), sin agotados y sin modificadores.
   */
  async preview(se: Session, mode?: string) {
    await this.auth.require(se, "ajustes.productos");
    const r = PreviewModeModel.safeParse(mode);
    if (!r.success) {
      fail("VALIDATION", "mode es tpv u oot", { field: "mode" });
    }
    const m = r.data!;
    const cats = await this.carta.previewCategories(se.storeId);
    const rows = await this.carta.previewRows(se.storeId);
    const questions = await this.carta.productQuestionIds(se.storeId);
    const visible = cats.filter((c) => !c.hidden && (m === "tpv" || c.orderOnTable));
    const shows = (r: PreviewRow) => {
      if (!r.active || r.answerOnly) {
        return false;
      }
      if (m === "tpv") {
        return true;
      }
      return isOotProduct({ ...r, category: r.ownCategory }) && !r.soldOut;
    };
    const categories = visible.map((c) => {
      const products = rows
        .filter((r) => r.categoryId === c.id && shows(r))
        .map((r) => {
          // en Order on Table no hay modificadores: el cliente pide el producto tal cual
          let qs: string[] = [];
          if (m === "tpv") {
            qs = questions.get(r.productId) ?? [];
          }
          return {
            id: r.productId,
            plu: r.plu,
            name: r.name,
            description: r.description,
            price: r.price,
            priceTerrace: r.priceTerrace,
            soldOut: r.soldOut,
            orderOnTable: r.orderOnTable,
            questions: qs,
          };
        });
      return {
        id: c.id,
        name: c.name,
        bgColor: c.bgColor,
        fgColor: c.fgColor,
        orderOnTable: c.orderOnTable,
        products,
      };
    });
    if (m === "tpv") {
      return { mode: m, categories };
    }
    // una categoría de Order on Table sin nada que pedir no se enseña
    return { mode: m, categories: categories.filter((c) => c.products.length > 0) };
  }

  /** GET /config/permisos: para pintar las casillas de un perfil, en el orden de la tabla permission. */
  async permissions(se: Session) {
    await this.auth.require(se, "ajustes.perfiles");
    return { items: await this.carta.permissions() };
  }

  /** GET /config/restaurante/pwa: manifest para instalar la PDA con el nombre del local. Nunca PIN ni tokens. */
  async pwa(se: Session) {
    await this.auth.require(se, "ajustes.restaurante");
    const st = await this.carta.storeName(se.storeId);
    if (!st) {
      fail("NOT_FOUND", "No existe la tienda", {});
    }
    return {
      storeCode: st!.code,
      manifest: {
        name: `Japp PDA · ${st!.code}`,
        short_name: "Japp PDA",
        start_url: "/",
        display: "standalone",
        background_color: "#ffffff",
        // la tienda no guarda un color propio: el de la marca
        theme_color: "#1b5e66",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    };
  }

  // ───────────────────────── escritura ─────────────────────────
  /** PUT /config/categorias/order y /config/areas/order: ids = todos los activos en el orden nuevo. */
  async order(se: Session, what: "category" | "area", body: unknown) {
    let perm = "ajustes.categorias";
    let module: Logged["module"] = "categorias";
    if (what === "area") {
      perm = "mesas.editarPlano";
      module = "areas";
    }
    await this.auth.require(se, perm);
    const b = parse(OrderModel, body);
    return this.database.withTx(async (tx) => {
      const now = await this.carta.activeForOrder(tx, se.storeId, what);
      const ids = new Set(b.ids);
      const missing = now.filter((r) => !ids.has(r.id)).map((r) => r.name);
      const unknown = b.ids.filter((id) => !now.some((r) => r.id === id));
      if (ids.size !== b.ids.length || missing.length || unknown.length) {
        fail("VALIDATION", "Manda todos los activos, una vez cada uno", {
          field: "ids",
          missing,
          unknown,
        });
      }
      const out: Logged[] = [];
      for (const [i, id] of b.ids.entries()) {
        const r = now.find((x) => x.id === id)!;
        const sortOrder = i + 1;
        if (r.sortOrder === sortOrder) {
          continue;
        }
        await this.carta.setSortOrder(tx, se.storeId, what, id, sortOrder);
        out.push({
          module,
          action: "update",
          id,
          name: r.name,
          before: { sortOrder: r.sortOrder },
          after: { sortOrder },
        });
      }
      return { configVersion: await this.record(tx, se, out, { module, action: "order" }) };
    });
  }

  /** POST /config/productos/{id}/sold-out: id = UUID o PLU; avisa a todos los equipos (versión de configuración). */
  async soldOut(se: Session, idOrPlu: string, body: unknown) {
    await this.auth.require(se, "ajustes.productos");
    const b = parse(SoldOutModel, body);
    return this.database.withTx(async (tx) => {
      const p = await this.carta.productForUpdate(tx, se.storeId, idOrPlu);
      if (!p) {
        fail("NOT_FOUND", "No existe ese producto", { id: idOrPlu });
      }
      const out: Logged[] = [];
      if (p!.soldOut !== b.soldOut) {
        await this.carta.setSoldOut(tx, se.storeId, p!.id, b.soldOut, p!.version + 1);
        out.push({
          module: "productos",
          action: "update",
          id: p!.id,
          name: p!.name,
          before: { soldOut: p!.soldOut },
          after: { soldOut: b.soldOut },
        });
      }
      const configVersion = await this.record(tx, se, out, { module: "productos", action: "soldOut" });
      return { id: p!.id, plu: p!.plu, soldOut: b.soldOut, configVersion };
    });
  }

  /**
   * PUT /config/areas/{areaId}/layout: posición y tamaño de las mesas del área y los dibujos (se sustituyen),
   * todo de una vez con la versión del área (409 VERSION_CONFLICT).
   */
  async layout(se: Session, areaId: string, body: unknown) {
    await this.auth.require(se, "mesas.editarPlano");
    if (!UUID.test(areaId)) {
      fail("NOT_FOUND", "No existe esa área", { id: areaId });
    }
    const b = parse(LayoutModel, body);
    return this.database.withTx(async (tx) => {
      const area = await this.carta.areaForUpdate(tx, se.storeId, areaId);
      if (!area) {
        fail("NOT_FOUND", "No existe esa área", { id: areaId });
      }
      const version = assertRecordVersion(area!.version, b.version);
      const tables = await this.carta.areaTables(tx, se.storeId, areaId);
      const seen = new Set<string>();
      b.tables.forEach((t, i) => {
        if (!tables.some((x) => x.id === t.id)) {
          fail("VALIDATION", "Esa mesa no es de esta área", { field: `tables[${i}].id`, id: t.id });
        }
        if (seen.has(t.id)) {
          fail("VALIDATION", "Mesa repetida", { field: `tables[${i}].id`, id: t.id });
        }
        seen.add(t.id);
      });
      const drawingsBefore = await this.carta.drawings(tx, se.storeId, areaId);
      const moved: string[] = [];
      for (const t of b.tables) {
        const cur = tables.find((x) => x.id === t.id)!;
        const next = {
          x: t.x,
          y: t.y,
          // sin tamaño se queda el que tenía
          width: t.width ?? cur.width,
          height: t.height ?? cur.height,
        };
        if (
          cur.posX === next.x &&
          cur.posY === next.y &&
          cur.width === next.width &&
          cur.height === next.height
        ) {
          continue;
        }
        await this.carta.moveTable(tx, se.storeId, t.id, next);
        moved.push(cur.number);
      }
      const drawings = b.drawings.map((d) => ({
        kind: d.kind,
        x1: d.x1,
        y1: d.y1,
        x2: d.x2 ?? null,
        y2: d.y2 ?? null,
        item: d.item ?? null,
        label: d.label ?? null,
      }));
      await this.carta.replaceDrawings(tx, se.storeId, areaId, drawings);
      await this.carta.setAreaVersion(tx, se.storeId, areaId, version);
      const configVersion = await this.record(
        tx,
        se,
        [
          {
            module: "areas",
            action: "update",
            id: areaId,
            name: area!.name,
            before: { tablesMoved: [], drawings: drawingsBefore.length },
            after: { tablesMoved: moved, drawings: drawings.length },
          },
        ],
        { module: "areas", action: "layout" },
      );
      return { version, configVersion };
    });
  }

  /**
   * Historial (una fila por registro que cambia), store.config_version +1 una vez y cola hacia el Manager.
   * Sin cambios, nada: se devuelve la versión actual.
   */
  private async record(
    tx: Tx,
    se: Session,
    out: Logged[],
    summary: { module: string; action: string },
  ): Promise<number> {
    if (!out.length) {
      return this.changes.configVersion(se.storeId, tx);
    }
    const a = se.actor(this.clock());
    const v = await this.changes.bumpConfigVersion(tx, se.storeId);
    for (const c of out) {
      await this.changes.insertChangeLog(tx, {
        storeId: se.storeId,
        at: a.at,
        userId: a.userId,
        userName: a.user,
        module: c.module,
        action: c.action,
        recordName: c.name.slice(0, 120),
        diff: describeDiff(c.before, c.after, {
          ...labelsOf(MODULES[c.module]),
          tablesMoved: "Mesas movidas",
          drawings: "Dibujos",
        }).slice(0, 4000),
        recordId: c.id,
        before: c.before,
        after: c.after,
        configVersion: v,
        device: a.device,
      });
    }
    await this.changes.enqueueConfig(tx, se.storeId, se.storeId, {
      ...summary,
      configVersion: v,
      records: out.map((c) => ({ module: c.module, id: c.id, after: c.after })),
    });
    return v;
  }
}
