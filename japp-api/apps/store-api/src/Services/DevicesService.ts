import { Inject, Injectable } from "@nestjs/common";
import type { Database, Tx } from "@japp/db";
import { describeDiff, identifyDevice, planClaimMain, stationMethods, type Actor } from "@japp/domain";
import { CLOCK, DATABASE, type Clock } from "../Constants/Injection.js";
import type { Session } from "../Helpers/AuthGuard.js";
import { SessionsService } from "./SessionsService.js";
import { StoreApplication, roleOf } from "../Applications/StoreApplication.js";
import { DevicesApplication } from "../Applications/DevicesApplication.js";
import { ConfigHistoryApplication } from "../Applications/ConfigHistoryApplication.js";
import type { ClaimMainInput, IdentifyDeviceInput } from "../Models/DevicesModels.js";

type StationRow = Awaited<ReturnType<DevicesApplication["lockStations"]>>[number];

/** Lo que se guarda de la estación en el historial de Ajustes y en la cola (lo que cambia aquí). */
const snapOf = (st: StationRow) => ({
  id: st.id,
  name: st.name,
  kind: st.kind,
  isMain: st.isMain,
  deviceUuid: st.deviceUuid ?? null,
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

  async identify(b: IdentifyDeviceInput) {
    const store = await this.stores.store();
    const st = identifyDevice(await this.devices.activeStations(store.id), b.deviceUuid, b.type);
    return { stationId: st.id, name: st.name, kind: st.kind, main: st.isMain, ip: st.ip ?? null };
  }

  async claimMain(b: ClaimMainInput) {
    const store = await this.stores.store();
    // la clave se comprueba antes de bloquear nada: un fallo cuenta para el bloqueo de ESTE equipo y el de la tienda
    const u = await this.sessions.userWithPermission(
      b.pin,
      [`device:${b.deviceUuid}`, `claim-main:${store.id}`],
      "ajustes.estaciones",
    );
    return this.database.withTx(async (tx) => {
      const all = await this.devices.lockStations(tx, store.id);
      const plan = planClaimMain(all, b.deviceUuid);
      const result = {
        stationId: plan.main.id,
        name: plan.main.name,
        main: true,
        previousUuid: plan.previousUuid,
      };
      if (plan.unchanged) {
        return { ...result, configVersion: await this.changes.configVersion(store.id, tx) };
      }
      const now = this.clock();
      const a: Actor = {
        userId: u.id,
        user: u.name,
        role: roleOf(u),
        device: plan.main.name,
        at: now.toISOString(),
      };
      const v = await this.changes.bumpConfigVersion(tx, store.id);
      // el UUID es único entre las estaciones activas (uq_station_device_uuid): primero se quita de las otras, luego se pone
      for (const other of plan.clearFrom) {
        const after = await this.devices.setDeviceUuid(tx, store.id, other.id, null);
        await this.record(tx, store.id, a, v, other, after);
      }
      const after = await this.devices.setDeviceUuid(tx, store.id, plan.main.id, b.deviceUuid);
      await this.record(tx, store.id, a, v, plan.main, after);
      return { ...result, configVersion: v };
    });
  }

  /** Historial de Ajustes y cola hacia el Manager de una estación cambiada (como ConfigService). */
  private async record(tx: Tx, storeId: string, a: Actor, v: number, before: StationRow, after: StationRow) {
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
      diff: describeDiff(b, n, { deviceUuid: "UUID del equipo" }) || "Sin cambios",
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
