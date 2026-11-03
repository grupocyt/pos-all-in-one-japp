import { Inject, Injectable } from "@nestjs/common";
import type { Database } from "@japp/db";
import { DEFAULT_BRANDING, describeDiff, fail, normalizeBranding } from "@japp/domain";
import { CLOCK, DATABASE, type Clock } from "../Constants/Injection.js";
import type { Session } from "../Helpers/AuthGuard.js";
import { parse } from "../Helpers/ValidationHelper.js";
import { StoreApplication } from "../Applications/StoreApplication.js";
import { BrandingApplication, type BrandingRow } from "../Applications/BrandingApplication.js";
import { ConfigHistoryApplication } from "../Applications/ConfigHistoryApplication.js";
import { AuthorizationService } from "./AuthorizationService.js";
import { BrandingModel } from "../Models/BrandingModels.js";

const LABELS = {
  name: "Nombre",
  subtitle: "Subtítulo",
  loginGroup: "Grupo en el acceso",
  logo: "Logo",
  noImage: "Icono «Sin imagen»",
  palette: "Paleta",
  colors: "Colores del sistema",
};

/** Ajustes › Administración › Sistema: nombre, textos del acceso, logos y colores (GET sin sesión, PUT con ajustes.restaurante). */
@Injectable()
export class BrandingService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(StoreApplication) private readonly stores: StoreApplication,
    @Inject(BrandingApplication) private readonly branding: BrandingApplication,
    @Inject(ConfigHistoryApplication) private readonly changes: ConfigHistoryApplication,
    @Inject(AuthorizationService) private readonly auth: AuthorizationService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Lo que ve el TPV: los textos que faltan como "" (el TPV los trata como vacíos) y la versión (0 = los originales). */
  private out(r: BrandingRow | null) {
    const b = r ?? { ...DEFAULT_BRANDING, version: 0, updatedAt: null, updatedBy: null };
    return {
      name: b.name,
      subtitle: b.subtitle ?? "",
      loginGroup: b.loginGroup ?? "",
      logo: b.logo ?? "",
      noImage: b.noImage,
      palette: b.palette,
      colors: b.colors,
      version: b.version,
      ...(b.updatedAt ? { updatedAt: b.updatedAt } : {}),
      ...(b.updatedBy ? { updatedBy: b.updatedBy } : {}),
    };
  }

  /** GET /config/sistema: sin sesión (la pantalla de acceso lo enseña antes de entrar). */
  async get() {
    const store = await this.stores.store();
    return this.out(await this.branding.find(store.id));
  }

  /** PUT /config/sistema: todo el registro con version; historial, versión de configuración y cola hacia el Manager. */
  async put(se: Session, body: unknown) {
    const b = parse(BrandingModel, body);
    await this.auth.require(se, "ajustes.restaurante", b.authorization);
    const next = normalizeBranding(b);
    return this.database.withTx(async (tx) => {
      const before = await this.branding.find(se.storeId, tx, true);
      const current = before?.version ?? 0;
      if (b.version !== current) {
        fail("VERSION_CONFLICT", "Otro equipo cambió el Sistema antes", {
          current: this.out(before),
          sent: b.version,
        });
      }
      const a = se.actor(this.clock());
      const version = current + 1;
      await this.branding.save(tx, se.storeId, next, version, a.user.slice(0, 80));
      const after = await this.branding.find(se.storeId, tx);
      const snap = (x: BrandingRow | null) => {
        if (!x) {
          return null;
        }
        const { version: _v, updatedAt: _u, updatedBy: _b, logo, noImage, ...rest } = x;
        // los logos no se copian enteros al historial: solo si hay o no y su tamaño
        return {
          ...rest,
          logo: logo ? `imagen (${logo.length} caracteres)` : null,
          noImage: noImage ? `imagen (${noImage.length} caracteres)` : null,
        };
      };
      const configVersion = await this.changes.bumpConfigVersion(tx, se.storeId);
      const diff = describeDiff(
        snap(before ?? { ...DEFAULT_BRANDING, version: 0, updatedAt: null, updatedBy: null }),
        snap(after),
        LABELS,
      );
      await this.changes.insertChangeLog(tx, {
        storeId: se.storeId,
        at: a.at,
        userId: a.userId,
        userName: a.user,
        module: "sistema",
        action: before ? "update" : "create",
        recordName: next.name.slice(0, 120),
        diff: (diff || "Sin cambios").slice(0, 4000),
        recordId: se.storeId,
        before: snap(before),
        after: snap(after),
        configVersion,
        device: a.device,
      });
      await this.changes.enqueueConfig(tx, se.storeId, se.storeId, {
        module: "sistema",
        action: before ? "update" : "create",
        configVersion,
        record: this.out(after),
      });
      return { ...this.out(after), configVersion };
    });
  }
}
