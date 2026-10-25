import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { schema as s, type Database, type Tx, type Db } from "@japp/db";
import {
  fail,
  pickStore,
  resolveStation,
  type AllowedStations,
  type Profile,
  type UserLike,
} from "@japp/domain";
import { CONFIG, DATABASE } from "../Constants/Injection.js";
import type { Config } from "../Properties/AppSettings.js";

type Q = Db | Tx;
export interface StoreInfo {
  id: string;
  code: string;
  name: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  ticketHeader: string | null;
  ticketFooter: string | null;
  serviceType: "table" | "fastfood";
  nif: string;
  issuerName: string;
  /** Nombre comercial de la cadena (Ajustes › Empresa), p. ej. «Cañas y Tapas». */
  chainName: string | null;
  serieT: string;
  serieF: string;
  duplicateMinutes: number;
  cashFloat: number;
  cashDiffThreshold: number;
  pinAttempts: number;
  pinLockSeconds: number;
  lockTpv: number;
  lockPda: number;
}
export interface UserCtx {
  id: string;
  name: string;
  initials: string;
  profileId: string;
  profileCode: string;
  level: number;
  color: string | null;
  pinHash: string;
  active: boolean;
  lockSeconds: number | null;
  overrides: Record<string, boolean | null>;
  allowedStations: AllowedStations;
}
export interface StationCtx {
  id: string;
  name: string;
  kind: string;
  isMain: boolean;
  deviceUuid: string | null;
}

/** Rol que se guarda en las columnas ACTOR (= who() del prototipo). */
export const roleOf = (u: Pick<UserCtx, "level" | "profileCode">) =>
  u.level >= 100 ? "manager" : u.profileCode === "CAJERO" ? "cashier" : "waiter";

/** Configuración de la tienda, usuarios y permisos. Cacheado solo lo que no cambia en caliente (la tienda). */
@Injectable()
export class StoreApplication {
  private storeCache?: StoreInfo;
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  /** Tras cambiar restaurante, empresa, facturación o parámetros desde Ajustes. */
  invalidate() {
    this.storeCache = undefined;
  }

  async store(q: Q = this.database.db): Promise<StoreInfo> {
    if (this.storeCache) {
      return this.storeCache;
    }
    // Todas las tiendas (normalmente una); cuál es este servidor lo decide pickStore (STORE_CODE opcional).
    const rows = await q
      .select({ st: s.store, p: s.storeParameters, b: s.billingSettings, c: s.company })
      .from(s.store)
      .innerJoin(s.storeParameters, eq(s.storeParameters.storeId, s.store.id))
      .innerJoin(s.billingSettings, eq(s.billingSettings.storeId, s.store.id))
      .innerJoin(s.company, eq(s.company.id, s.store.companyId));
    const picked = pickStore(
      rows.map((x) => ({ id: x.st.id, code: x.st.code, active: x.st.active })),
      this.cfg.storeCode,
    );
    const r = rows.find((x) => x.st.id === picked.id)!;
    this.storeCache = {
      id: r.st.id,
      code: r.st.code,
      name: r.st.name,
      address: r.st.address,
      city: r.st.city,
      phone: r.st.phone,
      ticketHeader: r.st.ticketHeader,
      ticketFooter: r.st.ticketFooter,
      serviceType: r.st.serviceType === "fastfood" ? "fastfood" : "table",
      nif: r.c.taxId,
      issuerName: r.c.legalName,
      chainName: r.c.tradeName ?? null,
      serieT: r.b.seriesSimplified,
      serieF: r.b.seriesFull,
      duplicateMinutes: r.p.duplicateMinutes,
      cashFloat: Number(r.p.cashFloat),
      cashDiffThreshold: Number(r.p.cashDiffThreshold),
      pinAttempts: r.p.pinAttempts,
      pinLockSeconds: r.p.pinLockSeconds,
      lockTpv: r.p.lockSeconds,
      lockPda: r.p.lockSecondsPda,
    };
    return this.storeCache;
  }

  async users(storeId: string, q: Q = this.database.db): Promise<UserCtx[]> {
    const rows = await q
      .select({ u: s.appUser, p: s.userProfile })
      .from(s.appUser)
      .innerJoin(s.userProfile, eq(s.userProfile.id, s.appUser.profileId))
      .where(and(eq(s.appUser.storeId, storeId), eq(s.appUser.active, true)));
    return rows.map(({ u, p }) => ({
      id: u.id,
      name: u.name,
      initials: u.initials ?? u.name.slice(0, 2).toUpperCase(),
      profileId: p.id,
      profileCode: p.code,
      level: p.level,
      color: p.color,
      pinHash: u.pinHash,
      active: u.active,
      lockSeconds: u.lockSeconds ?? null,
      allowedStations: p.allowedStations === "main" ? "main" : "any",
      overrides: {
        "cobro.cobrar": u.canCharge,
        "pedido.elimEnviado": u.canDeletePrinted,
        "pedido.elimPrecuenta": u.canDeletePrebill,
      },
    }));
  }

  async user(storeId: string, id: string, q: Q = this.database.db) {
    return (await this.users(storeId, q)).find((u) => u.id === id) ?? null;
  }

  /** Perfiles con sus permisos, en la forma del dominio. */
  async profiles(storeId: string, q: Q = this.database.db): Promise<Profile[]> {
    const ps = await q.select().from(s.userProfile).where(eq(s.userProfile.storeId, storeId));
    const pp = ps.length
      ? await q
          .select()
          .from(s.profilePermission)
          .where(
            inArray(
              s.profilePermission.profileId,
              ps.map((p) => p.id),
            ),
          )
      : [];
    return ps.map((p) => ({
      id: p.id,
      level: p.level,
      perms: Object.fromEntries(pp.filter((x) => x.profileId === p.id).map((x) => [x.permissionCode, true])),
    }));
  }

  async stations(storeId: string, q: Q = this.database.db): Promise<StationCtx[]> {
    const all = await q
      .select()
      .from(s.station)
      .where(and(eq(s.station.storeId, storeId), eq(s.station.active, true)));
    return all.map((x) => ({
      id: x.id,
      name: x.name,
      kind: x.kind,
      isMain: x.isMain,
      deviceUuid: x.deviceUuid ?? null,
    }));
  }

  /** Estación del equipo según X-Station-Id (regla en @japp/domain → resolveStation: con UUID de equipo, solo por ese UUID). */
  async station(storeId: string, header: string | undefined, q: Q = this.database.db): Promise<StationCtx> {
    const st = resolveStation(await this.stations(storeId, q), header);
    if (!st) {
      fail("NOT_FOUND", "La tienda no tiene estaciones dadas de alta");
    }
    return st!;
  }

  /** Estación de una sesión (la del token, por id); si se desactivó, la primera caja. */
  async stationById(storeId: string, id: string, q: Q = this.database.db): Promise<StationCtx> {
    const all = await this.stations(storeId, q);
    const st = all.find((x) => x.id === id) ?? all.find((x) => x.kind === "station") ?? all[0];
    if (!st) {
      fail("NOT_FOUND", "La tienda no tiene estaciones dadas de alta");
    }
    return st!;
  }
}

export const toUserLike = (u: UserCtx): UserLike => ({
  id: u.id,
  profileId: u.profileId,
  overrides: u.overrides,
});
