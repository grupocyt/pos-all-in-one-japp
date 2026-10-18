import { Inject, Injectable, SetMetadata, createParamDecorator, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { can, fail, type Actor } from "@japp/domain";
import { CONFIG } from "./tokens-di.js";
import type { Config } from "../config.js";
import { verifyToken, type SessionClaims } from "./tokens.js";
import { StoreRepo, roleOf, toUserLike, type UserCtx, type StationCtx } from "../repos/store.repo.js";

export const PUBLIC = "japp:public";
/** Ruta sin sesión (health, devices/register, sessions). */
export const Public = () => SetMetadata(PUBLIC, true);

export interface Session {
  storeId: string; user: UserCtx; station: StationCtx; role: string; origin: "tpv" | "pda";
  can(perm: string): boolean; actor(at: Date): Actor;
}

/** Comprueba el Bearer de sesión y deja req.session con usuario, estación y permisos actuales (se leen de la base en cada petición). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(CONFIG) private readonly cfg: Config, @Inject(StoreRepo) private readonly stores: StoreRepo) {}
  async canActivate(ctx: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest();
    const raw = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const c = verifyToken<SessionClaims>(this.cfg.sessionSecret, raw, "session");
    if (!c) fail("BAD_PIN", "Sesión caducada o no válida: vuelve a entrar con tu clave");
    const store = await this.stores.store();
    if (c!.store !== store.id) fail("BAD_PIN", "La sesión es de otra tienda");
    const user = await this.stores.user(store.id, c!.sub);
    if (!user) fail("BAD_PIN", "Usuario desactivado");
    const station = await this.stores.station(store.id, c!.station);
    const profiles = await this.stores.profiles(store.id);
    const like = toUserLike(user!);
    const role = roleOf(user!);
    const origin = station.kind === "pda" ? "pda" : "tpv";
    req.session = {
      storeId: store.id, user: user!, station, role, origin,
      can: (perm: string) => can(like, perm, profiles),
      actor: (at: Date) => ({ userId: user!.id, user: user!.name, role, device: station.name, origin, at: at.toISOString() }),
    } satisfies Session;
    return true;
  }
}

export const CurrentSession = createParamDecorator((_: unknown, ctx: ExecutionContext): Session => ctx.switchToHttp().getRequest().session);
