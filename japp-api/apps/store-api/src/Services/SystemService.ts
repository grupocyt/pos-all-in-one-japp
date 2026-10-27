import { Inject, Injectable } from "@nestjs/common";
import { fail } from "@japp/domain";
import { CONFIG } from "../Constants/Injection.js";
import { StoreApplication } from "../Applications/StoreApplication.js";
import { SystemApplication } from "../Applications/SystemApplication.js";
import { DevicesApplication } from "../Applications/DevicesApplication.js";
import { PeriodsApplication } from "../Applications/PeriodsApplication.js";
import type { Config } from "../Properties/AppSettings.js";
import type { RegisterDeviceInput } from "../Models/SystemModels.js";

/** Latido y alta de equipos. */
@Injectable()
export class SystemService {
  constructor(
    @Inject(SystemApplication) private readonly system: SystemApplication,
    @Inject(DevicesApplication) private readonly devices: DevicesApplication,
    @Inject(StoreApplication) private readonly stores: StoreApplication,
    @Inject(PeriodsApplication) private readonly periods: PeriodsApplication,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  /** Latido: lo mismo que se envía al Manager. */
  async health() {
    let ok = "ok";
    try {
      await this.system.ping();
    } catch {
      ok = "down";
    }
    const store = await this.stores.store().catch(() => null);
    let outboxPending = 0;
    let lastInvoiceAt: string | null = null;
    let period: { open: boolean; openedAt: string | null; openedBy: string | null } | null = null;
    if (store) {
      outboxPending = await this.system.outboxPending(store.id);
      lastInvoiceAt = await this.system.lastInvoiceAt(store.id);
      // el equipo lo enseña en la pantalla de clave antes de entrar (1.2.199; antes decía «periodo cerrado» sin saberlo)
      const p = await this.periods.current(null, store.id).catch(() => null);
      period = p
        ? { open: true, openedAt: new Date(p.openedByAt).toISOString(), openedBy: p.openedByUserName ?? null }
        : { open: false, openedAt: null, openedBy: null };
    }
    return {
      version: this.cfg.version,
      db: ok,
      printers: {},
      outboxPending,
      lastInvoiceAt,
      period,
      time: new Date().toISOString(),
    };
  }

  /**
   * Primer arranque del equipo: se le asigna estación (CAJA1, PDA1…) por su UUID. Nunca la principal: esa solo se
   * configura con la clave de un administrador (POST /devices/claim-main); si no, cualquier equipo nuevo podría quedársela.
   */
  async register(b: RegisterDeviceInput) {
    const store = await this.stores.store();
    const all = await this.devices.activeStations(store.id);
    let st = all.find((x) => x.deviceUuid === b.deviceUuid);
    if (!st) {
      const kind = b.kind === "mobile" ? "pda" : "station";
      st = all.find((x) => x.kind === kind && !x.deviceUuid && !x.isMain);
      if (!st) {
        fail("NOT_FOUND", "No queda ninguna estación libre de ese tipo: créala en Ajustes › Estaciones", {
          kind,
        });
      }
      await this.devices.assignDevice(store.id, st!.id, b.deviceUuid);
    }
    return { stationId: st!.id, name: st!.name, kind: st!.kind };
  }
}
