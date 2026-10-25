import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { Inject, Injectable } from "@nestjs/common";
import type { Database, Tx } from "@japp/db";
import {
  DISPLAY_MAX_BYTES,
  allowedDisplayModes,
  displayMediaKind,
  effectiveDisplayMode,
  fail,
  normalizeDisplayConfig,
  normalizeSchedule,
  readDisplayConfig,
} from "@japp/domain";
import { CLOCK, CONFIG, DATABASE, type Clock } from "../Constants/Injection.js";
import type { Session } from "../Helpers/AuthGuard.js";
import { parse } from "../Helpers/ValidationHelper.js";
import type { Config } from "../Properties/AppSettings.js";
import { DisplayApplication, type MediaRow } from "../Applications/DisplayApplication.js";
import { ConfigHistoryApplication } from "../Applications/ConfigHistoryApplication.js";
import { StoreApplication } from "../Applications/StoreApplication.js";
import { MediaStore } from "../Clases/MediaStore.js";
import { PutDisplayModel } from "../Models/DisplayModels.js";
import { AuthorizationService } from "./AuthorizationService.js";

const PERM = "ajustes.restaurante";
const MODULE = "pantalla-cliente";

/**
 * Ajustes › Restaurante › Banners: la segunda pantalla del cliente.
 * Leer: cualquier sesión (el TPV la necesita para pintar la pantalla). Cambiar: ajustes.restaurante.
 * Cada cambio sube customer_display.version (control de edición a la vez) y store.config_version, deja su fila en el
 * historial de Ajustes y avisa a los equipos (config.changed, por la ruta /config/…).
 */
@Injectable()
export class DisplayService {
  readonly files: MediaStore;
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CONFIG) cfg: Config,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuthorizationService) private readonly auth: AuthorizationService,
    @Inject(DisplayApplication) private readonly display: DisplayApplication,
    @Inject(ConfigHistoryApplication) private readonly history: ConfigHistoryApplication,
    @Inject(StoreApplication) private readonly stores: StoreApplication,
  ) {
    this.files = new MediaStore(cfg.mediaDir);
  }

  private item(m: MediaRow) {
    return {
      id: m.id,
      kind: m.kind,
      name: m.name,
      mime: m.mime,
      size: m.size,
      duration: m.duration,
      days: m.days,
      from: m.from,
      to: m.to,
      active: m.active,
      sortOrder: m.sortOrder,
      url: `/api/v2/media/${m.id}`,
    };
  }

  /** Lo que devuelven GET y PUT. */
  private async view(storeId: string) {
    const store = await this.stores.store();
    const [row, media, configVersion] = await Promise.all([
      this.display.config(storeId),
      this.display.media(storeId),
      this.history.configVersion(storeId),
    ]);
    const config = readDisplayConfig(row?.config);
    return {
      config,
      effectiveMode: effectiveDisplayMode(config.mode, store.serviceType),
      allowedModes: allowedDisplayModes(store.serviceType),
      serviceType: store.serviceType,
      version: row?.version ?? 1,
      configVersion,
      items: media.map((m) => this.item(m)),
    };
  }

  async get(se: Session) {
    return this.view(se.storeId);
  }

  /** Versión, historial y config_version en la transacción del cambio. */
  private async record(tx: Tx, se: Session, action: string, name: string, diff: string, before: unknown, after: unknown) {
    const configVersion = await this.history.bumpConfigVersion(tx, se.storeId);
    await this.history.insertChangeLog(tx, {
      storeId: se.storeId,
      at: this.clock().toISOString(),
      userId: se.user.id,
      userName: se.user.name,
      module: MODULE,
      action,
      recordName: name,
      diff: diff.slice(0, 4000) || "Sin cambios",
      recordId: se.storeId,
      before,
      after,
      configVersion,
      device: se.station.name,
    });
  }

  async put(se: Session, body: unknown) {
    await this.auth.require(se, PERM);
    const b = parse(PutDisplayModel, body);
    const store = await this.stores.store();
    const config = normalizeDisplayConfig(b.config, store.serviceType);
    const sched = (b.items ?? []).map((x, i) => ({ id: x.id, ...normalizeSchedule(x, `items[${i}]`) }));
    await this.database.withTx(async (tx) => {
      const cur = await this.display.lock(tx, se.storeId);
      if (cur.version !== b.version) {
        fail("VERSION_CONFLICT", "Otra persona cambió la segunda pantalla mientras la editabas: vuelve a abrirla", {
          field: "version",
          current: cur.version,
        });
      }
      const before = readDisplayConfig(cur.config);
      if (b.items) {
        const live = await this.display.media(se.storeId, tx);
        const ids = new Set(live.map((m) => m.id));
        const sent = new Set(sched.map((s) => s.id));
        if (sent.size !== sched.length || sent.size !== ids.size || [...sent].some((id) => !ids.has(id))) {
          fail("VALIDATION", "items tiene que traer todos los archivos de la lista, una vez cada uno", {
            field: "items",
            expected: [...ids],
          });
        }
        for (const [i, s] of sched.entries()) {
          await this.display.schedule(tx, se.storeId, s.id, s, i + 1);
        }
      }
      await this.display.save(tx, se.storeId, config, cur.version + 1, se.user.name);
      const changed = Object.keys(config).filter(
        (k) => JSON.stringify((config as any)[k]) !== JSON.stringify((before as any)[k]),
      );
      await this.record(
        tx,
        se,
        "update",
        "Segunda pantalla",
        [changed.length ? `Cambia: ${changed.join(", ")}` : "", b.items ? `Lista: ${sched.length} archivos` : ""]
          .filter(Boolean)
          .join(" · "),
        before,
        config,
      );
    });
    return this.view(se.storeId);
  }

  /** POST /config/pantalla-cliente/media: el cuerpo es el archivo (Content-Type video/* o image/*). */
  async upload(
    se: Session,
    file: Readable | null,
    h: { contentType?: string; fileName?: string; duration?: string },
  ) {
    await this.auth.require(se, PERM);
    const mime = String(h.contentType ?? "").split(";")[0]!.trim().toLowerCase();
    const kind = displayMediaKind(mime);
    if (!file || typeof (file as any).pipe !== "function") {
      fail("VALIDATION", "Falta el archivo en el cuerpo", { field: "body" });
    }
    let name = "archivo";
    try {
      name = decodeURIComponent(h.fileName ?? "").trim() || name;
    } catch {
      name = String(h.fileName ?? name);
    }
    name = name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 200);
    const dur = h.duration == null || h.duration === "" ? null : Math.round(Number(h.duration));
    if (dur !== null && (!Number.isFinite(dur) || dur < 0 || dur > 86400)) {
      fail("VALIDATION", "X-Duration: segundos del vídeo", { field: "x-duration" });
    }
    const id = randomUUID();
    const saved = await this.files.save(id, file!, DISPLAY_MAX_BYTES);
    if (saved.tooLarge) {
      fail("TOO_LARGE", "El archivo pasa de 300 MB", { field: "body", max: DISPLAY_MAX_BYTES });
    }
    if (!saved.size) {
      await this.files.remove(id);
      fail("VALIDATION", "El archivo está vacío", { field: "body" });
    }
    try {
      await this.database.withTx(async (tx) => {
        const cur = await this.display.lock(tx, se.storeId);
        await this.display.insertMedia(tx, se.storeId, {
          id,
          kind,
          name,
          mime,
          size: saved.size,
          duration: kind === "video" ? dur : null,
          sha256: saved.sha256,
          by: se.user.name,
        });
        await this.display.save(tx, se.storeId, readDisplayConfig(cur.config), cur.version + 1, se.user.name);
        await this.record(tx, se, "create", name, `Sube ${kind === "video" ? "el vídeo" : "la imagen"} ${name}`, null, {
          id,
          name,
          size: saved.size,
        });
      });
    } catch (e) {
      await this.files.remove(id);
      throw e;
    }
    return this.item((await this.display.mediaById(se.storeId, id))!);
  }

  async remove(se: Session, id: string) {
    await this.auth.require(se, PERM);
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      fail("VALIDATION", "id no válido", { field: "id" });
    }
    const m = await this.display.mediaById(se.storeId, id);
    if (!m) {
      fail("NOT_FOUND", "Ese archivo no está en la lista");
    }
    await this.database.withTx(async (tx) => {
      const cur = await this.display.lock(tx, se.storeId);
      await this.display.remove(tx, se.storeId, id);
      await this.display.save(tx, se.storeId, readDisplayConfig(cur.config), cur.version + 1, se.user.name);
      await this.record(tx, se, "deactivate", m!.name, `Quita ${m!.name}`, { id, name: m!.name }, null);
    });
    await this.files.remove(id);
    return this.view(se.storeId);
  }

  /** GET /media/{id}: sin sesión (lo pide un <video>); solo archivos vivos de esta tienda. */
  async file(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return null;
    }
    const store = await this.stores.store();
    const m = await this.display.mediaById(store.id, id);
    if (!m) {
      return null;
    }
    const size = await this.files.size(id);
    return size == null ? null : { id, mime: m.mime, size, sha256: m.sha256 };
  }
}
