import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database, Tx } from "@japp/db";
import { DomainError, SYNC_LIMITS, assertSyncSize, fail } from "@japp/domain";
import { CLOCK, DATABASE, EVENTS, type Clock } from "../Constants/Injection.js";
import type { Session } from "../Helpers/AuthGuard.js";
import type { EventsHub } from "../Clases/EventsHub.js";
import { StoreApplication } from "../Applications/StoreApplication.js";
import { CartaSyncApplication, type ReleaseRow } from "../Applications/CartaSyncApplication.js";
import { CartaSyncService, parseRows, sizeOf } from "./CartaSyncService.js";
import {
  PublicationFullModel,
  PublicationNamesModel,
  PublicationPricesModel,
  PublicationWithdrawModel,
  ReleaseModel,
  type Release,
} from "../Models/CartaModels.js";

const HeadModel = z.object({ release: ReleaseModel }).passthrough();
const DecideModel = z.object({ reason: z.string().trim().max(200).nullish() }).strict();
/** Un minuto de margen entre el reloj del Manager y el de la tienda: «ahora» no queda pendiente. */
const SKEW_MS = 60_000;

/** Se aplicó a la vez que se comprobaba (vista previa de una carga programada): se deshace con la transacción. */
class DryRun extends Error {}

/**
 * Publicación de Carta (16/11/2026, API 1.2.270): POST /config/carta/sync con «release» (JSON «Campos del JSON ·
 * Publicación de Carta al TPV»). Cada carga queda en catalog_release:
 * - publicación + versión + tienda = una carga: la misma otra vez → «sin cambios»; con otro contenido → 409;
 *   una versión menor que la última de esa publicación → 409 (no se vuelve atrás).
 * - effectiveAt futura → queda «pending» (ya comprobada entera) y la API la aplica sola a su hora.
 * - withdraw (retirar la carta) → «confirm»: espera a que un encargado la confirme en Ajustes.
 * - el resto se aplica en la misma transacción (todo o nada) y responde con lo que hizo.
 */
@Injectable()
export class CartaReleaseService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CartaSyncService) private readonly sync: CartaSyncService,
    @Inject(CartaSyncApplication) private readonly carta: CartaSyncApplication,
    @Inject(StoreApplication) private readonly stores: StoreApplication,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(EVENTS) private readonly events: EventsHub,
  ) {}

  /** ¿Es una publicación de Carta (trae «release»)? */
  static isPublication(body: unknown) {
    return !!body && typeof body === "object" && "release" in (body as object);
  }

  /** POST /config/carta/sync con «release». */
  async receive(se: Session, body: unknown) {
    await this.sync.requireCarta(se);
    const rel = parseRows(HeadModel, body).release;
    const store = await this.stores.store();
    if (rel.store.trim().toUpperCase() !== store.code.trim().toUpperCase()) {
      fail("VALIDATION", `La carga es de la tienda ${rel.store} y esta tienda es ${store.code}`, {
        field: "release.store",
      });
    }
    this.checkShape(rel, body);
    const checksum = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const now = this.clock();
    const out = await this.database.withTx(async (tx) => {
        await this.carta.lockCarta(tx, se.storeId);
        const dup = await this.carta.releaseByKey(tx, se.storeId, rel.publicationId, rel.releaseVersion);
        if (dup) {
          if (dup.checksum !== checksum) {
            fail("VERSION_CONFLICT", "Esa versión de la publicación ya llegó con otro contenido: sube releaseVersion", {
              field: "release.releaseVersion",
              status: dup.status,
            });
          }
          return { release: this.view(dup), result: dup.result ?? null, repeated: true };
        }
        const last = await this.carta.latestRelease(tx, se.storeId, rel.publicationId);
        if (last && last.releaseVersion > rel.releaseVersion) {
          fail("VERSION_CONFLICT", `Ya hay una versión más nueva de esa publicación (${last.releaseVersion})`, {
            field: "release.releaseVersion",
            current: last.releaseVersion,
          });
        }
        const future = new Date(rel.effectiveAt).getTime() > now.getTime() + SKEW_MS;
        let status = "applied";
        let result: unknown = null;
        if (rel.kind === "withdraw") {
          status = "confirm";
        } else if (future) {
          status = "pending";
          // se comprueba entera ya (referencias, IVA, PLU…) y se deshace: a su hora no fallará por la forma
          await this.dryRun(tx, se, rel, body);
        } else {
          result = await this.apply(tx, se, rel, body);
          if (!(result as { changed?: boolean }).changed) {
            status = "unchanged";
          }
        }
        await this.carta.supersede(tx, se.storeId, rel.publicationId, rel.releaseVersion);
        const id = randomUUID();
        await this.carta.insertRelease(tx, se.storeId, {
          id,
          kind: rel.kind,
          publicationId: rel.publicationId,
          publicationType: rel.publicationType ?? null,
          releaseVersion: rel.releaseVersion,
          effectiveAt: rel.effectiveAt,
          status,
          checksum,
          menu: rel.menu ?? null,
          priceLine: rel.priceLine ?? null,
          storeCode: rel.store,
          note: this.noteOf(body),
          payload: body,
          appliedAt: status === "applied" || status === "unchanged" ? now.toISOString() : null,
          result,
        });
        const saved = (await this.carta.releaseById(tx, se.storeId, id))!;
        return { release: this.view(saved), result, repeated: false };
      });
    if (out.release.status === "applied") {
      this.events.publish(se.storeId, { event: "config.changed", module: "carta" });
    }
    return out;
  }

  /** Estructura de cada tipo de carga y tamaños (sin tocar la base). */
  private checkShape(rel: Release, body: unknown) {
    if (rel.kind === "full") {
      assertSyncSize("categorías", sizeOf(body, "categories"), SYNC_LIMITS.carta.categories);
      assertSyncSize("productos", sizeOf(body, "products"), SYNC_LIMITS.carta.products);
      assertSyncSize("preguntas", sizeOf(body, "questions"), SYNC_LIMITS.carta.questions);
      assertSyncSize("teclas", sizeOf(body, "keys"), SYNC_LIMITS.carta.products * 2);
      parseRows(PublicationFullModel, body);
    } else if (rel.kind === "prices") {
      assertSyncSize("productos", sizeOf(body, "products"), SYNC_LIMITS.carta.products);
      parseRows(PublicationPricesModel, body);
    } else if (rel.kind === "names") {
      assertSyncSize("productos", sizeOf(body, "products"), SYNC_LIMITS.carta.products);
      parseRows(PublicationNamesModel, body);
    } else {
      parseRows(PublicationWithdrawModel, body);
    }
  }

  private noteOf(body: unknown): string | null {
    const n = (body as { note?: unknown }).note;
    return typeof n === "string" ? n.slice(0, 300) : null;
  }

  /** Aplica una carga dentro de la transacción. */
  private async apply(tx: Tx, se: Session, rel: Release, body: unknown) {
    if (rel.kind === "full") {
      const b = parseRows(PublicationFullModel, body);
      return this.sync.applyCarta(tx, se, b, { keys: b.keys });
    }
    if (rel.kind === "prices") {
      return this.sync.applyPrices(tx, se, parseRows(PublicationPricesModel, body).products);
    }
    if (rel.kind === "names") {
      return this.sync.applyNames(tx, se, parseRows(PublicationNamesModel, body).products);
    }
    return this.sync.applyWithdraw(tx, se);
  }

  /** La aplica en un SAVEPOINT y la deshace: así una carga programada se comprueba entera al llegar. */
  private async dryRun(tx: Tx, se: Session, rel: Release, body: unknown) {
    try {
      await tx.transaction(async (sp) => {
        await this.apply(sp as unknown as Tx, se, rel, body);
        throw new DryRun();
      });
    } catch (e) {
      if (!(e instanceof DryRun)) {
        throw e;
      }
    }
  }

  private view(r: ReleaseRow) {
    return {
      id: r.id,
      kind: r.kind,
      publicationId: r.publicationId,
      publicationType: r.publicationType,
      releaseVersion: r.releaseVersion,
      effectiveAt: r.effectiveAt,
      status: r.status,
      menu: r.menu,
      priceLine: r.priceLine,
      store: r.storeCode,
      note: r.note,
      receivedAt: r.receivedAt,
      appliedAt: r.appliedAt,
      error: r.error,
      decidedBy: r.decidedBy,
    };
  }

  // ───────────────────────── Ajustes › Developer › Cargas de la carta ─────────────────────────
  /** GET /config/carta/releases: las últimas cargas (más nuevas primero). */
  async list(se: Session, limit?: string) {
    await this.sync.requireCarta(se);
    const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const rows = await this.carta.releases(se.storeId, n);
    return { items: rows.map((r) => ({ ...this.view(r), result: r.result ?? null })) };
  }

  /** POST /config/carta/releases/{id}/confirm: un encargado confirma «retirar la carta» (o aplica ya una programada). */
  async confirm(se: Session, id: string) {
    await this.sync.requireCarta(se);
    const out = await this.database.withTx(async (tx) => {
      await this.carta.lockCarta(tx, se.storeId);
      const r = await this.carta.releaseById(tx, se.storeId, id, true);
      if (!r) {
        fail("NOT_FOUND", "Esa carga no existe", { id });
      }
      if (r!.status !== "confirm" && r!.status !== "pending") {
        fail("INVALID_TRANSITION", "Esa carga ya no está pendiente", { status: r!.status });
      }
      const rel = ReleaseModel.parse((r!.payload as { release: unknown }).release);
      const result = await this.apply(tx, se, rel, r!.payload);
      const status = (result as { changed?: boolean }).changed ? "applied" : "unchanged";
      await this.carta.setReleaseStatus(tx, se.storeId, r!.id, {
        status,
        appliedAt: this.clock().toISOString(),
        result,
        decidedBy: se.user.name,
        error: null,
      });
      return { release: this.view((await this.carta.releaseById(tx, se.storeId, r!.id))!), result };
    });
    this.events.publish(se.storeId, { event: "config.changed", module: "carta" });
    return out;
  }

  /** POST /config/carta/releases/{id}/cancel: no se aplica (retirar o programada). */
  async cancel(se: Session, id: string, body: unknown) {
    await this.sync.requireCarta(se);
    const b = DecideModel.parse(body ?? {});
    return this.database.withTx(async (tx) => {
      const r = await this.carta.releaseById(tx, se.storeId, id, true);
      if (!r) {
        fail("NOT_FOUND", "Esa carga no existe", { id });
      }
      if (r!.status !== "confirm" && r!.status !== "pending") {
        fail("INVALID_TRANSITION", "Esa carga ya no está pendiente", { status: r!.status });
      }
      await this.carta.setReleaseStatus(tx, se.storeId, r!.id, {
        status: "cancelled",
        decidedBy: se.user.name,
        error: b.reason ? `Cancelada: ${b.reason}` : "Cancelada en la tienda",
      });
      return { release: this.view((await this.carta.releaseById(tx, se.storeId, r!.id))!) };
    });
  }

  // ───────────────────────── a su hora ─────────────────────────
  /** Arranca la comprobación periódica de las cargas programadas (la API; las pruebas llaman a applyDue). */
  start(everyMs = 30_000) {
    if (!this.timer) {
      this.timer = setInterval(() => void this.applyDue().catch(() => undefined), everyMs);
      this.timer.unref?.();
    }
    void this.applyDue().catch(() => undefined);
  }
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Aplica las cargas programadas cuya hora ya llegó, una a una (cada una en su transacción). */
  async applyDue() {
    if (this.busy) {
      return 0;
    }
    this.busy = true;
    let n = 0;
    try {
      const now = this.clock();
      for (const d of await this.carta.dueReleases(now)) {
        const se = this.systemSession(d.storeId);
        try {
          await this.database.withTx(async (tx) => {
            await this.carta.lockCarta(tx, d.storeId);
            const r = await this.carta.releaseById(tx, d.storeId, d.id, true);
            if (!r || r.status !== "pending") {
              return;
            }
            const rel = ReleaseModel.parse((r.payload as { release: unknown }).release);
            const result = await this.apply(tx, se, rel, r.payload);
            await this.carta.setReleaseStatus(tx, d.storeId, r.id, {
              status: (result as { changed?: boolean }).changed ? "applied" : "unchanged",
              appliedAt: this.clock().toISOString(),
              result,
              error: null,
            });
          });
          n += 1;
        } catch (e) {
          const msg = e instanceof DomainError ? `${e.code}: ${e.message}` : String((e as Error)?.message ?? e);
          await this.carta.setReleaseStatus(this.database.db, d.storeId, d.id, { status: "failed", error: msg });
        }
        this.events.publish(d.storeId, { event: "config.changed", module: "carta" });
      }
    } finally {
      this.busy = false;
    }
    return n;
  }

  /** Quien aplica una carga programada: «Manager (programada)», con todos los permisos de la carta. */
  private systemSession(storeId: string): Session {
    return {
      storeId,
      user: { id: null, name: "Manager (programada)" },
      station: { id: null, name: "Manager", kind: "station" },
      role: "admin",
      origin: "tpv",
      jti: "",
      can: () => true,
      actor: (at: Date) => ({ user: "Manager (programada)", role: "admin", device: "Manager", at: at.toISOString() }),
    } as unknown as Session;
  }
}
