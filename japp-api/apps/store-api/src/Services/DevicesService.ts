import { Inject, Injectable } from "@nestjs/common";
import type { Database, Tx } from "@japp/db";
import { deviceTypeOf, fail, describeDiff, normIp, stationByIp, stationMethods, type Actor } from "@japp/domain";
import { CLOCK, DATABASE, type Clock } from "../Constants/Injection.js";
import type { Session } from "../Helpers/AuthGuard.js";
import { SessionsService } from "./SessionsService.js";
import { StoreApplication, roleOf } from "../Applications/StoreApplication.js";
import { DevicesApplication } from "../Applications/DevicesApplication.js";
import { ConfigHistoryApplication } from "../Applications/ConfigHistoryApplication.js";
import type { ClaimMainInput, ClaimStationInput, IdentifyDeviceInput } from "../Models/DevicesModels.js";

type StationRow = Awaited<ReturnType<DevicesApplication["lockStations"]>>[number];

/** El propio servidor (la caja que abre localhost). */
const isLoopback = (ip: string) => ip === "127.0.0.1" || ip === "::1" || ip === "localhost";

/** Lo que se guarda de la estación en el historial de Ajustes y en la cola (lo que cambia aquí). */
const snapOf = (st: StationRow) => ({
  id: st.id,
  name: st.name,
  kind: st.kind,
  isMain: st.isMain,
  ip: st.ip ?? null,
  version: st.version,
});

/**
 * Equipos (decidido 18/10/2026, reglas en @japp/domain/devices.ts):
 * - identify: el equipo se reconoce por su UUID entre las estaciones activas (sin sesión);
 * - claim-main: la caja principal se configura en cualquier equipo de escritorio con la clave de un administrador
 *   (ajustes.estaciones). Clave incorrecta (o de alguien sin el permiso) → 401 BAD_PIN y cuenta para dos bloqueos:
 *   el del equipo (device:<UUID>) y uno fijo de la tienda (claim-main:<storeId>). El UUID lo manda el llamante, así que
 *   solo con el del equipo bastaría cambiarlo en cada intento para probar claves sin fin; el de la tienda lo impide;
 * - me: la configuración de la estación de la sesión.
 */
@Injectable()
export class DevicesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(StoreApplication) private readonly stores: StoreApplication,
    @Inject(DevicesApplication) private readonly devices: DevicesApplication,
    @Inject(ConfigHistoryApplication) private readonly changes: ConfigHistoryApplication,
    @Inject(SessionsService) private readonly sessions: SessionsService,
  ) {}

  /**
   * 1.2.281 (17/11/2026) · el equipo se reconoce SOLO por su IP: la estación activa de su tipo con esa IP (una sola).
   * La caja que corre en el propio servidor (localhost) es la caja principal. El UUID ya no se usa ni se guarda.
   */
  async identify(b: IdentifyDeviceInput, clientIp?: string) {
    const store = await this.stores.store();
    const ip = normIp(clientIp) || null;
    const all = await this.devices.activeStations(store.id);
    const st = this.byIp(all, ip, b.type);
    if (!st) {
      // la IP del equipo, para enseñarla en la pantalla y ponerla en Ajustes › Equipos
      fail("DEVICE_NOT_REGISTERED", "Este equipo no está dado de alta: pon su IP en Ajustes › Equipos", { clientIp: ip });
    }
    await this.devices.touch(store.id, st!.id); // 0036 · última conexión (Ajustes › Equipos)
    // la tienda (código y nombre) para que el equipo enseñe la suya antes de entrar con una clave (1.2.199)
    return {
      stationId: st!.id,
      name: st!.name,
      kind: st!.kind,
      main: st!.isMain,
      ip: st!.ip ?? null,
      clientIp: ip,
      matchedBy: "ip" as const,
      store: { code: store.code ?? null, name: store.name ?? null },
    };
  }

  /** La estación de esta IP; en el propio servidor (127.0.0.1 / ::1), la caja principal. */
  private byIp<S extends StationRow>(all: S[], ip: string | null, type: "desktop" | "mobile"): S | null {
    if (!ip) {
      return null;
    }
    const st = stationByIp(all, ip, type);
    if (st) {
      return st;
    }
    if (type === "desktop" && isLoopback(ip)) {
      return all.find((x) => x.active && x.isMain) ?? null;
    }
    return null;
  }

  /**
   * Vincular: la estación elegida se queda con la IP de este equipo y la pierde cualquier otra de su tipo que la tuviera
   * (una IP, una estación). En el propio servidor (localhost) no se cambia la IP: ya se reconoce como caja principal.
   */
  private async bindIp(tx: Tx, storeId: string, all: StationRow[], st: StationRow, ip: string | null, a: Actor, why: string) {
    const k = normIp(ip);
    if (!k || isLoopback(k) || normIp(st.ip) === k) {
      return { after: st, changed: false };
    }
    const v = await this.changes.bumpConfigVersion(tx, storeId);
    for (const other of all.filter((x) => x.id !== st.id && x.active && normIp(x.ip) === k && deviceTypeOf(x) === deviceTypeOf(st))) {
      const o = await this.devices.setIp(tx, storeId, other.id, null);
      await this.record(tx, storeId, a, v, other, o, `La IP ${k} pasa a ${st.name}`);
    }
    const after = await this.devices.setIp(tx, storeId, st.id, k);
    await this.record(tx, storeId, a, v, st, after, why);
    return { after, changed: true, v };
  }

  async claimMain(b: ClaimMainInput, clientIp?: string) {
    const store = await this.stores.store();
    const ip = normIp(clientIp) || null;
    // la clave se comprueba antes de bloquear nada: un fallo cuenta para el bloqueo de ESTE equipo y el de la tienda
    const u = await this.sessions.userWithPermission(b.pin, [`device:${ip || "?"}`, `claim-main:${store.id}`], "ajustes.estaciones");
    return this.database.withTx(async (tx) => {
      const all = await this.devices.lockStations(tx, store.id);
      const main = all.find((x) => x.active && x.isMain) ?? fail("NOT_FOUND", "La tienda no tiene caja principal");
      const a: Actor = { userId: u.id, user: u.name, role: roleOf(u), device: main.name, at: this.clock().toISOString() };
      const r = await this.bindIp(tx, store.id, all, main, ip, a, `Caja principal en el equipo ${ip}`);
      return {
        stationId: main.id,
        name: main.name,
        main: true,
        ip: r.after.ip ?? null,
        store: { code: store.code ?? null, name: store.name ?? null },
        configVersion: r.changed ? r.v : await this.changes.configVersion(store.id, tx),
      };
    });
  }

  /**
   * 1.2.271 · vincular este equipo a una estación desde el propio equipo, con la clave de quien tenga
   * ajustes.estaciones. 1.2.281: lo que se guarda es la IP del equipo. Sin stationId → solo la lista para elegir.
   */
  async claim(b: ClaimStationInput, clientIp?: string) {
    const store = await this.stores.store();
    const ip = normIp(clientIp) || null;
    const u = await this.sessions.userWithPermission(b.pin, [`device:${ip || "?"}`, `claim:${store.id}`], "ajustes.estaciones");
    if (!b.stationId) {
      const all = await this.devices.activeStations(store.id);
      return {
        stations: all
          .filter((x) => deviceTypeOf(x) === b.type)
          .sort((x, y) => Number(y.isMain) - Number(x.isMain) || x.name.localeCompare(y.name, "es"))
          .map((x) => ({
            stationId: x.id,
            name: x.name,
            kind: x.kind,
            main: x.isMain,
            ip: x.ip ?? null,
            hasDevice: !!x.ip,
            thisDevice: !!ip && normIp(x.ip) === ip,
            lastSeenAt: x.lastSeenAt ?? null,
          })),
      };
    }
    return this.database.withTx(async (tx) => {
      const all = await this.devices.lockStations(tx, store.id);
      const st = all.find((x) => x.id === b.stationId && x.active) ?? fail("NOT_FOUND", "Esa estación no existe o está desactivada");
      if (deviceTypeOf(st) !== b.type) {
        fail("DEVICE_TYPE_MISMATCH", `${st.name} es ${b.type === "mobile" ? "de escritorio" : "una PDA"}`, { station: st.name });
      }
      const a: Actor = { userId: u.id, user: u.name, role: roleOf(u), device: st.name, at: this.clock().toISOString() };
      const r = await this.bindIp(tx, store.id, all, st, ip, a, `Vinculada al equipo ${ip}`);
      await this.devices.touch(store.id, st.id, tx);
      return {
        stationId: st.id,
        name: st.name,
        kind: st.kind,
        main: st.isMain,
        ip: r.after.ip ?? null,
        store: { code: store.code ?? null, name: store.name ?? null },
        configVersion: r.changed ? r.v : await this.changes.configVersion(store.id, tx),
      };
    });
  }

  /** Historial de Ajustes y cola hacia el Manager de una estación cambiada (como ConfigService). */
  private async record(tx: Tx, storeId: string, a: Actor, v: number, before: StationRow, after: StationRow, why?: string) {
    const b = snapOf(before);
    const n = snapOf(after);
    await this.changes.insertChangeLog(tx, {
      storeId,
      at: a.at,
      userId: a.userId,
      userName: a.user,
      module: "estaciones",
      action: "update",
      recordName: after.name,
      diff: [describeDiff(b, n, { ip: "IP" }) || "Sin cambios", why].filter(Boolean).join(" · "),
      recordId: after.id,
      before: b,
      after: n,
      configVersion: v,
      device: a.device,
    });
    await this.changes.enqueueConfig(tx, storeId, after.id, {
      module: "estaciones",
      action: "update",
      configVersion: v,
      record: n,
    });
  }

  async me(se: Session) {
    const st = await this.devices.station(se.storeId, se.station.id);
    const methods = await this.devices.paymentMethods(se.storeId);
    const methodIds = await this.devices.stationPaymentMethodIds(se.storeId, se.station.id);
    const channels = await this.devices.stationChannels(se.storeId, se.station.id);
    return {
      stationId: se.station.id,
      name: se.station.name,
      kind: se.station.kind,
      main: se.station.isMain,
      opensDrawer: !!st?.opensDrawer,
      ip: st?.ip ?? null,
      paymentMethods: stationMethods(methods, { kind: se.station.kind, methodIds }).map((m) => m.code),
      discounts: await this.devices.stationDiscountIds(se.storeId, se.station.id),
      channels: Object.fromEntries(
        channels.map((c) => [c.channel, { printer: c.printer, connection: c.connection }]),
      ),
    };
  }
}
