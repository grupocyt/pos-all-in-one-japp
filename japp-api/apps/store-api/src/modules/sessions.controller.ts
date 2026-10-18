import { Body, Controller, Get, Headers, HttpCode, Inject, Post } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { ALL_PERMISSIONS, effectiveLockSeconds, fail } from "@japp/domain";
import { CONFIG, CLOCK, type Clock } from "../common/tokens-di.js";
import { CurrentSession, Public, type Session } from "../common/auth.js";
import { parse } from "../common/validate.js";
import { signToken, type AuthClaims, type SessionClaims } from "../common/tokens.js";
import { StoreRepo, roleOf, type UserCtx } from "../repos/store.repo.js";
import type { Config } from "../config.js";

const COLOR: Record<string, string> = { red: "red", amber: "amber", green: "green" };

/** Clave de 4 cifras: sesión del equipo y autorización de encargado. Bloqueo tras N fallos por estación. */
@Controller("sessions")
export class SessionsController {
  private fails = new Map<string, { n: number; until: number }>();
  constructor(@Inject(StoreRepo) private readonly stores: StoreRepo, @Inject(CONFIG) private readonly cfg: Config, @Inject(CLOCK) private readonly clock: Clock) {}

  private async byPin(pin: string, stationKey: string): Promise<UserCtx> {
    const store = await this.stores.store();
    const now = this.clock().getTime();
    const f = this.fails.get(stationKey);
    if (f && f.until > now) fail("PIN_LOCKED", "Teclado bloqueado unos segundos", { retryAfter: Math.ceil((f.until - now) / 1000) });
    const users = await this.stores.users(store.id);
    for (const u of users) if (await bcrypt.compare(pin, u.pinHash)) { this.fails.delete(stationKey); return u; }
    const n = (f?.n ?? 0) + 1;
    this.fails.set(stationKey, n >= store.pinAttempts ? { n: 0, until: now + store.pinLockSeconds * 1000 } : { n, until: 0 });
    return fail("BAD_PIN", "Clave incorrecta", { attemptsLeft: Math.max(0, store.pinAttempts - n) });
  }

  /** Segundos de bloqueo vigentes: los del usuario o los de Parámetros según sea TPV o móvil. */
  private async lockOf(u: UserCtx, station: { kind: string }) {
    const store = await this.stores.store();
    return effectiveLockSeconds(u.lockSeconds, { tpv: store.lockTpv, pda: store.lockPda }, station.kind === "pda");
  }

  private async permsOf(u: UserCtx, storeId: string) {
    const profiles = await this.stores.profiles(storeId);
    const p = profiles.find(x => x.id === u.profileId)?.perms ?? {};
    return ALL_PERMISSIONS.filter(code => (u.overrides[code] ?? p[code]) === true);
  }

  @Public() @Post() @HttpCode(201)
  async login(@Body() body: unknown, @Headers("x-station-id") stationHeader?: string) {
    const b = parse(z.object({ pin: z.string().regex(/^\d{4}$/, "4 cifras") }), body);
    const store = await this.stores.store();
    const station = await this.stores.station(store.id, stationHeader);
    const u = await this.byPin(b.pin, station.id);
    const exp = Math.floor(this.clock().getTime() / 1000) + this.cfg.sessionHours * 3600;
    const token = signToken<SessionClaims>(this.cfg.sessionSecret, { typ: "session", sub: u.id, store: store.id, station: station.id, exp });
    return {
      token, expiresAt: new Date(exp * 1000).toISOString(),
      user: { id: u.id, name: u.name, initials: u.initials, profile: u.profileCode, color: COLOR[u.color ?? ""] ?? u.color ?? null },
      station: { id: station.id, name: station.name, kind: station.kind },
      permissions: await this.permsOf(u, store.id),
      overrides: { canCharge: u.overrides["cobro.cobrar"], canDeletePrinted: u.overrides["pedido.elimEnviado"], canDeletePrebill: u.overrides["pedido.elimPrecuenta"] },
      lockSeconds: await this.lockOf(u, station),
    };
  }

  /** Otro usuario con el permiso escribe su clave: autorización de un solo uso (2 min) para esa acción. */
  @Post("authorize") @HttpCode(201)
  async authorize(@Body() body: unknown, @CurrentSession() session: Session) {
    const b = parse(z.object({ pin: z.string().regex(/^\d{4}$/), permission: z.string().refine(p => ALL_PERMISSIONS.includes(p), "permiso desconocido") }), body);
    const u = await this.byPin(b.pin, session.station.id);
    if (!(await this.permsOf(u, session.storeId)).includes(b.permission)) fail("NOT_ALLOWED", `${u.name} tampoco tiene ese permiso`, { permission: b.permission });
    const exp = Math.floor(this.clock().getTime() / 1000) + 120;
    const token = signToken<AuthClaims>(this.cfg.sessionSecret, { typ: "auth", sub: u.id, store: session.storeId, perm: b.permission, exp });
    return { authorization: { token, user: u.name, role: roleOf(u), expiresAt: new Date(exp * 1000).toISOString() } };
  }

  @Get("current")
  async current(@CurrentSession() session: Session) {
    const u = session.user;
    return { user: { id: u.id, name: u.name, initials: u.initials, profile: u.profileCode }, station: session.station, permissions: await this.permsOf(u, session.storeId), lockSeconds: await this.lockOf(u, session.station) };
  }
}
