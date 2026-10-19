import { Inject, Injectable } from "@nestjs/common";
import { can, fail, type Actor, type UserLike } from "@japp/domain";
import { CONFIG } from "../Constants/Injection.js";
import type { Config } from "../Properties/AppSettings.js";
import { verifyToken, type AuthClaims } from "../Helpers/TokenHelper.js";
import { StoreApplication, roleOf, toUserLike } from "../Applications/StoreApplication.js";
import type { Session } from "../Helpers/AuthGuard.js";

export interface Granted {
  authorizer: UserLike | null;
  authorizerActor: Actor | null;
}

/**
 * Permisos con autorización de encargado (= needManager del prototipo).
 * Si quien pulsa no tiene el permiso, vale un token de POST /sessions/authorize para ESE permiso, de un solo uso y con 2 min de vida.
 */
@Injectable()
export class AuthorizationService {
  private used = new Map<string, number>(); // jti → caducidad (memoria: un único proceso por tienda)
  constructor(
    @Inject(CONFIG) private readonly cfg: Config,
    @Inject(StoreApplication) private readonly stores: StoreApplication,
  ) {}

  async require(session: Session, perm: string, token?: string | null, now = new Date()): Promise<Granted> {
    if (session.can(perm)) {
      return { authorizer: null, authorizerActor: null };
    }
    if (!token) {
      fail("PERMISSION_REQUIRED", "Hace falta la clave de un encargado", { permission: perm });
    }
    const c = verifyToken<AuthClaims>(this.cfg.sessionSecret, token, "auth", now.getTime());
    if (!c || c.store !== session.storeId || c.perm !== perm) {
      fail("PERMISSION_REQUIRED", "La autorización no vale para esta acción", { permission: perm });
    }
    this.gc(now);
    if (this.used.has(c!.jti)) {
      fail("PERMISSION_REQUIRED", "Esa autorización ya se usó", { permission: perm });
    }
    const u = await this.stores.user(session.storeId, c!.sub);
    const profiles = await this.stores.profiles(session.storeId);
    if (!u || !can(toUserLike(u), perm, profiles)) {
      fail("NOT_ALLOWED", "Quien autorizó ya no tiene ese permiso", { permission: perm });
    }
    this.used.set(c!.jti, c!.exp);
    return {
      authorizer: toUserLike(u!),
      authorizerActor: {
        userId: u!.id,
        user: u!.name,
        role: roleOf(u!),
        device: session.station.name,
        origin: session.origin,
        at: now.toISOString(),
      },
    };
  }
  /** Vale cualquiera de los permisos (p. ej. pasar a otra cuenta: pedido.pasarCuenta o pedido.separar). Con autorización, la del primero que tenga el encargado. */
  async requireAny(
    session: Session,
    perms: string[],
    token?: string | null,
    now = new Date(),
  ): Promise<Granted> {
    if (perms.some((p) => session.can(p))) {
      return { authorizer: null, authorizerActor: null };
    }
    if (token) {
      const c = verifyToken<AuthClaims>(this.cfg.sessionSecret, token, "auth", now.getTime());
      const perm = c && perms.includes(c.perm) ? c.perm : perms[0]!;
      return this.require(session, perm, token, now);
    }
    return fail("PERMISSION_REQUIRED", "Hace falta la clave de un encargado", {
      permission: perms[0],
      anyOf: perms,
    });
  }
  private gc(now: Date) {
    for (const [k, exp] of this.used) {
      if (exp * 1000 < now.getTime()) {
        this.used.delete(k);
      }
    }
  }
}
