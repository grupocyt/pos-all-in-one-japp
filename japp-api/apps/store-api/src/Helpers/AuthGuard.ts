import {
  Inject,
  Injectable,
  SetMetadata,
  createParamDecorator,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { assertActiveSession, assertStationAllowed, can, fail, type Actor } from "@japp/domain";
import { SessionsApplication } from "../Applications/SessionsApplication.js";
import { CONFIG } from "../Constants/Injection.js";
import type { Config } from "../Properties/AppSettings.js";
import { verifyToken, type SessionClaims } from "./TokenHelper.js";
import {
  StoreApplication,
  roleOf,
  toUserLike,
  type UserCtx,
  type StationCtx,
} from "../Applications/StoreApplication.js";

export const PUBLIC = "japp:public";
/** Ruta sin sesión (health, devices/register, sessions). */
export const Public = () => SetMetadata(PUBLIC, true);

export interface Session {
  storeId: string;
  user: UserCtx;
  station: StationCtx;
  role: string;
  origin: "tpv" | "pda";
  jti: string;
  can(perm: string): boolean;
  actor(at: Date): Actor;
}

/** Comprueba el Bearer de sesión y deja req.session con usuario, estación y permisos actuales (se leen de la base en cada petición). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(CONFIG) private readonly cfg: Config,
    @Inject(StoreApplication) private readonly stores: StoreApplication,
    @Inject(SessionsApplication) private readonly active: SessionsApplication,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, [ctx.getHandler(), ctx.getClass()])) {
      return true;
    }
    const req = ctx.switchToHttp().getRequest();
    const raw = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const c = verifyToken<SessionClaims>(this.cfg.sessionSecret, raw, "session");
    if (!c) {
      fail("BAD_PIN", "Sesión caducada o no válida: vuelve a entrar con tu clave");
    }
    const store = await this.stores.store();
    if (c!.store !== store.id) {
      fail("BAD_PIN", "La sesión es de otra tienda");
    }
    // una sesión activa por usuario: un token anterior (entró en otro equipo, o volvió a entrar) → 401 SESSION_REPLACED
    assertActiveSession(await this.active.get(store.id, c!.sub), c!.jti);
    const user = await this.stores.user(store.id, c!.sub);
    if (!user) {
      fail("BAD_PIN", "Usuario desactivado");
    }
    const station = await this.stores.stationById(store.id, c!.station);
    // caja principal: un perfil «solo caja principal» no trabaja en otro equipo (también si se cambió en Ajustes con la sesión abierta)
    assertStationAllowed(user!.allowedStations, station);
    const profiles = await this.stores.profiles(store.id);
    const like = toUserLike(user!);
    const role = roleOf(user!);
    const origin = station.kind === "pda" ? "pda" : "tpv";
    req.session = {
      storeId: store.id,
      user: user!,
      station,
      role,
      origin,
      jti: c!.jti,
      can: (perm: string) => can(like, perm, profiles),
      actor: (at: Date) => ({
        userId: user!.id,
        user: user!.name,
        role,
        device: station.name,
        origin,
        at: at.toISOString(),
      }),
    } satisfies Session;
    return true;
  }
}

export const CurrentSession = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Session => ctx.switchToHttp().getRequest().session,
);
