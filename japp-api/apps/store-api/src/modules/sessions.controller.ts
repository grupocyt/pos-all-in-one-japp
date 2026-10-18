import { Body, Controller, Get, Headers, HttpCode, Inject, Post } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { type Database, type Tx } from "@japp/db";
import { ALL_PERMISSIONS, assertStationAllowed, effectiveLockSeconds, fail, pinLockKey, releasesStation } from "@japp/domain";
import { ActiveSessions } from "../common/active-sessions.js";
import { CONFIG, CLOCK, DATABASE, type Clock } from "../common/tokens-di.js";
import { CurrentSession, Public, type Session } from "../common/auth.js";
import { parse } from "../common/validate.js";
import { signToken, type AuthClaims, type SessionClaims } from "../common/tokens.js";
import { StoreRepo, roleOf, type UserCtx } from "../repos/store.repo.js";
import type { Config } from "../config.js";

const COLOR: Record<string, string> = { red: "red", amber: "amber", green: "green" };

/**
 * Clave de 4 cifras: sesión del equipo y autorización de encargado.
 * Bloqueo tras N fallos (Parámetros), guardado en pin_attempt (migración 0009; sobrevive a reinicios). Basta una clave bloqueada:
 * - al entrar: por equipo (UUID del equipo si la estación lo tiene; si no, la estación — pinLockKey). Nunca por IP:
 *   detrás de un proxy todas llegan con la misma y se bloquearía toda la tienda;
 * - en la clave de encargado: por el usuario de la sesión y por su equipo.
 */
@Controller("sessions")
export class SessionsController {
  constructor(@Inject(StoreRepo) private readonly stores: StoreRepo, @Inject(CONFIG) private readonly cfg: Config, @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ActiveSessions) private readonly active: ActiveSessions, @Inject(DATABASE) private readonly database: Database) {}

  private async byPin(pin: string, keys: string[]): Promise<UserCtx> {
    const store = await this.stores.store();
    const now = this.clock(), at = now.toISOString(), db = this.database.db;
    const K = sql`ANY(${"{" + keys.map(k => `"${k.replace(/"/g, "")}"`).join(",") + "}"}::text[])`;
    const [locked] = (await db.execute(sql`SELECT max(locked_until) until FROM pin_attempt WHERE store_id = ${store.id} AND key = ${K} AND locked_until > ${at}::timestamptz`)).rows as { until: string | null }[];
    if (locked?.until) fail("PIN_LOCKED", "Teclado bloqueado unos segundos", { retryAfter: Math.ceil((new Date(locked.until).getTime() - now.getTime()) / 1000) });
    const users = await this.stores.users(store.id);
    for (const u of users) if (await bcrypt.compare(pin, u.pinHash)) {
      await db.execute(sql`UPDATE pin_attempt SET failures = 0, locked_until = NULL WHERE store_id = ${store.id} AND key = ${K} AND (failures > 0 OR locked_until IS NOT NULL)`);
      return u;
    }
    let left = store.pinAttempts;
    for (const k of keys) {
      // tras un bloqueo ya pasado se empieza a contar de nuevo
      const [r] = (await db.execute(sql`INSERT INTO pin_attempt (store_id, key, failures) VALUES (${store.id}, ${k}, 1)
        ON CONFLICT (store_id, key) DO UPDATE SET failures = CASE WHEN pin_attempt.locked_until IS NOT NULL THEN 1 ELSE pin_attempt.failures + 1 END, locked_until = NULL
        RETURNING failures`)).rows as { failures: number }[];
      const n = Number(r!.failures);
      if (n >= store.pinAttempts) await db.execute(sql`UPDATE pin_attempt SET failures = 0, locked_until = ${new Date(now.getTime() + store.pinLockSeconds * 1000).toISOString()}::timestamptz WHERE store_id = ${store.id} AND key = ${k}`);
      left = Math.min(left, Math.max(0, store.pinAttempts - n));
    }
    return fail("BAD_PIN", "Clave incorrecta", { attemptsLeft: left });
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
    const u = await this.byPin(b.pin, [pinLockKey(station)]);
    assertStationAllowed(u.allowedStations, station);
    const exp = Math.floor(this.clock().getTime() / 1000) + this.cfg.sessionHours * 3600;
    const jti = randomUUID();
    const token = signToken<SessionClaims>(this.cfg.sessionSecret, { typ: "session", sub: u.id, store: store.id, station: station.id, exp, jti });
    // una sesión activa por usuario (app_session): esta sustituye a la anterior; si era en otro equipo, se sueltan sus mesas
    const cur = { jti, stationId: station.id, stationName: station.name };
    await this.database.withTx(async tx => {
      const prev = await this.active.replace(tx, store.id, u.id, { ...cur, expiresAt: new Date(exp * 1000).toISOString() });
      const old = releasesStation(prev, station.id);
      if (old) await this.releaseTables(tx, store.id, u, old, station.name);
    });
    this.active.remember(store.id, u.id, cur);
    return {
      token, expiresAt: new Date(exp * 1000).toISOString(),
      user: { id: u.id, name: u.name, initials: u.initials, profile: u.profileCode, color: COLOR[u.color ?? ""] ?? u.color ?? null, allowedStations: u.allowedStations },
      station: { id: station.id, name: station.name, kind: station.kind, isMain: station.isMain },
      permissions: await this.permsOf(u, store.id),
      overrides: { canCharge: u.overrides["cobro.cobrar"], canDeletePrinted: u.overrides["pedido.elimEnviado"], canDeletePrebill: u.overrides["pedido.elimPrecuenta"] },
      lockSeconds: await this.lockOf(u, station),
    };
  }

  /** Al entrar en otro equipo: las mesas que tenía desde el anterior quedan libres (y su cobro abierto), con su evento. */
  private async releaseTables(tx: Tx, storeId: string, u: UserCtx, oldStation: string, newStation: string) {
    const a = { at: this.clock().toISOString(), role: roleOf(u) };
    {
      const ids = (await tx.execute(sql`UPDATE orders SET holder_user_id = NULL, holder_user_name = NULL, holder_station_id = NULL, holder_station_name = NULL, holder_until = NULL, charging_until = NULL
        WHERE store_id = ${storeId} AND holder_user_id = ${u.id} AND holder_station_id = ${oldStation} RETURNING id::text`)).rows as { id: string }[];
      for (const o of ids) await tx.execute(sql`INSERT INTO order_event (id, store_id, order_id, type, description, at, user_id, user_name, role, device)
        VALUES (${randomUUID()}, ${storeId}, ${o.id}, 'tableReleased', ${`${u.name} ha entrado en ${newStation}; sale de la mesa`}, ${a.at}, ${u.id}, ${u.name}, ${a.role}, ${newStation})`);
    }
  }

  /** Otro usuario con el permiso escribe su clave: autorización de un solo uso (2 min) para esa acción. */
  @Post("authorize") @HttpCode(201)
  async authorize(@Body() body: unknown, @CurrentSession() session: Session) {
    const b = parse(z.object({ pin: z.string().regex(/^\d{4}$/), permission: z.string().refine(p => ALL_PERMISSIONS.includes(p), "permiso desconocido") }), body);
    // la clave de encargado NO crea ni sustituye la sesión del encargado: solo firma una autorización de un solo uso
    const u = await this.byPin(b.pin, [`user:${session.user.id}`, pinLockKey(session.station)]);
    if (!(await this.permsOf(u, session.storeId)).includes(b.permission)) fail("NOT_ALLOWED", `${u.name} tampoco tiene ese permiso`, { permission: b.permission });
    const exp = Math.floor(this.clock().getTime() / 1000) + 120;
    const token = signToken<AuthClaims>(this.cfg.sessionSecret, { typ: "auth", sub: u.id, store: session.storeId, perm: b.permission, exp });
    return { authorization: { token, user: u.name, role: roleOf(u), expiresAt: new Date(exp * 1000).toISOString() } };
  }

  @Get("current")
  async current(@CurrentSession() session: Session) {
    const u = session.user;
    const st = session.station;
    return { user: { id: u.id, name: u.name, initials: u.initials, profile: u.profileCode, allowedStations: u.allowedStations }, station: { id: st.id, name: st.name, kind: st.kind, isMain: st.isMain }, permissions: await this.permsOf(u, session.storeId), lockSeconds: await this.lockOf(u, session.station) };
  }
}
