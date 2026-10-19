import { Inject, Injectable } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { type Database, type Tx } from "@japp/db";
import {
  ALL_PERMISSIONS,
  assertStationAllowed,
  effectiveLockSeconds,
  fail,
  pinLockKey,
  releasesStation,
} from "@japp/domain";
import { SessionsApplication } from "../Applications/SessionsApplication.js";
import { CONFIG, CLOCK, DATABASE, type Clock } from "../Constants/Injection.js";
import type { Session } from "../Helpers/AuthGuard.js";
import { signToken, type AuthClaims, type SessionClaims } from "../Helpers/TokenHelper.js";
import { StoreApplication, roleOf, type UserCtx } from "../Applications/StoreApplication.js";
import type { Config } from "../Properties/AppSettings.js";
import type { AuthorizeInput, LoginInput } from "../Models/SessionsModels.js";

const COLOR: Record<string, string> = { red: "red", amber: "amber", green: "green" };

/**
 * Clave de 4 cifras: sesión del equipo y autorización de encargado.
 * Bloqueo tras N fallos (Parámetros), guardado en pin_attempt (migración 0009; sobrevive a reinicios). Basta una clave bloqueada:
 * - al entrar: por equipo (UUID del equipo si la estación lo tiene; si no, la estación — pinLockKey). Nunca por IP:
 *   detrás de un proxy todas llegan con la misma y se bloquearía toda la tienda;
 * - en la clave de encargado: por el usuario de la sesión y por su equipo.
 */
@Injectable()
export class SessionsService {
  constructor(
    @Inject(StoreApplication) private readonly stores: StoreApplication,
    @Inject(CONFIG) private readonly cfg: Config,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(SessionsApplication) private readonly active: SessionsApplication,
    @Inject(DATABASE) private readonly database: Database,
  ) {}

  /**
   * Usuario de esa clave, con el bloqueo por intentos de las claves `keys`. Con `accept`, un usuario que no lo cumple
   * (p. ej. sin el permiso que se pide) cuenta como clave incorrecta: así no se puede averiguar qué claves existen.
   */
  private async byPin(
    pin: string,
    keys: string[],
    accept?: (u: UserCtx) => Promise<boolean>,
  ): Promise<UserCtx> {
    const store = await this.stores.store();
    const now = this.clock();
    const at = now.toISOString();
    const until = await this.active.pinLockedUntil(store.id, keys, at);
    if (until) {
      fail("PIN_LOCKED", "Teclado bloqueado unos segundos", {
        retryAfter: Math.ceil((new Date(until).getTime() - now.getTime()) / 1000),
      });
    }
    const u = await this.userOfPin(store.id, pin);
    if (u && (!accept || (await accept(u)))) {
      await this.active.resetPinFailures(store.id, keys);
      return u;
    }
    let left = store.pinAttempts;
    for (const k of keys) {
      // tras un bloqueo ya pasado se empieza a contar de nuevo
      const n = await this.active.addPinFailure(store.id, k);
      if (n >= store.pinAttempts) {
        await this.active.lockPin(
          store.id,
          k,
          new Date(now.getTime() + store.pinLockSeconds * 1000).toISOString(),
        );
      }
      left = Math.min(left, Math.max(0, store.pinAttempts - n));
    }
    return fail("BAD_PIN", "Clave incorrecta", { attemptsLeft: left });
  }

  /** El usuario activo cuya clave es esa, o undefined. */
  private async userOfPin(storeId: string, pin: string): Promise<UserCtx | undefined> {
    const users = await this.stores.users(storeId);
    for (const u of users) {
      if (await bcrypt.compare(pin, u.pinHash)) {
        return u;
      }
    }
    return undefined;
  }

  /** Segundos de bloqueo vigentes: los del usuario o los de Parámetros según sea TPV o móvil. */
  private async lockOf(u: UserCtx, station: { kind: string }) {
    const store = await this.stores.store();
    return effectiveLockSeconds(
      u.lockSeconds,
      { tpv: store.lockTpv, pda: store.lockPda },
      station.kind === "pda",
    );
  }

  private async permsOf(u: UserCtx, storeId: string) {
    const profiles = await this.stores.profiles(storeId);
    const p = profiles.find((x) => x.id === u.profileId)?.perms ?? {};
    return ALL_PERMISSIONS.filter((code) => (u.overrides[code] ?? p[code]) === true);
  }

  async login(b: LoginInput, stationHeader?: string) {
    const store = await this.stores.store();
    const station = await this.stores.station(store.id, stationHeader);
    const u = await this.byPin(b.pin, [pinLockKey(station)]);
    assertStationAllowed(u.allowedStations, station);
    const exp = Math.floor(this.clock().getTime() / 1000) + this.cfg.sessionHours * 3600;
    const jti = randomUUID();
    const token = signToken<SessionClaims>(this.cfg.sessionSecret, {
      typ: "session",
      sub: u.id,
      store: store.id,
      station: station.id,
      exp,
      jti,
    });
    // una sesión activa por usuario (app_session): esta sustituye a la anterior; si era en otro equipo, se sueltan sus mesas
    const cur = { jti, stationId: station.id, stationName: station.name };
    await this.database.withTx(async (tx) => {
      const prev = await this.active.replace(tx, store.id, u.id, {
        ...cur,
        expiresAt: new Date(exp * 1000).toISOString(),
      });
      const old = releasesStation(prev, station.id);
      if (old) {
        await this.releaseTables(tx, store.id, u, old, station.name);
      }
    });
    this.active.remember(store.id, u.id, cur);
    return {
      token,
      expiresAt: new Date(exp * 1000).toISOString(),
      user: {
        id: u.id,
        name: u.name,
        initials: u.initials,
        profile: u.profileCode,
        color: COLOR[u.color ?? ""] ?? u.color ?? null,
        allowedStations: u.allowedStations,
      },
      station: { id: station.id, name: station.name, kind: station.kind, isMain: station.isMain },
      permissions: await this.permsOf(u, store.id),
      overrides: {
        canCharge: u.overrides["cobro.cobrar"],
        canDeletePrinted: u.overrides["pedido.elimEnviado"],
        canDeletePrebill: u.overrides["pedido.elimPrecuenta"],
      },
      lockSeconds: await this.lockOf(u, station),
    };
  }

  /** Al entrar en otro equipo: las mesas que tenía desde el anterior quedan libres (y su cobro abierto), con su evento. */
  private async releaseTables(tx: Tx, storeId: string, u: UserCtx, oldStation: string, newStation: string) {
    const a = { at: this.clock().toISOString(), role: roleOf(u) };
    const ids = await this.active.releaseTables(tx, storeId, u.id, oldStation);
    for (const id of ids) {
      await this.active.addReleasedEvent(
        tx,
        storeId,
        id,
        `${u.name} ha entrado en ${newStation}; sale de la mesa`,
        {
          at: a.at,
          userId: u.id,
          userName: u.name,
          role: a.role,
          device: newStation,
        },
      );
    }
  }

  /**
   * Clave de un usuario con ese permiso, sin sesión (p. ej. configurar este equipo como caja principal):
   * el bloqueo por intentos de las claves `keys`. Clave que no existe o de alguien sin el permiso → BAD_PIN y cuenta
   * como fallo (sin decir de quién es: no se puede usar para averiguar claves de la tienda).
   */
  async userWithPermission(pin: string, keys: string[], permission: string): Promise<UserCtx> {
    const store = await this.stores.store();
    return this.byPin(pin, keys, async (u) => (await this.permsOf(u, store.id)).includes(permission));
  }

  /** Otro usuario con el permiso escribe su clave: autorización de un solo uso (2 min) para esa acción. */
  async authorize(b: AuthorizeInput, session: Session) {
    // la clave de encargado NO crea ni sustituye la sesión del encargado: solo firma una autorización de un solo uso
    const u = await this.byPin(b.pin, [`user:${session.user.id}`, pinLockKey(session.station)]);
    if (!(await this.permsOf(u, session.storeId)).includes(b.permission)) {
      fail("NOT_ALLOWED", `${u.name} tampoco tiene ese permiso`, { permission: b.permission });
    }
    const exp = Math.floor(this.clock().getTime() / 1000) + 120;
    const token = signToken<AuthClaims>(this.cfg.sessionSecret, {
      typ: "auth",
      sub: u.id,
      store: session.storeId,
      perm: b.permission,
      exp,
    });
    return {
      authorization: { token, user: u.name, role: roleOf(u), expiresAt: new Date(exp * 1000).toISOString() },
    };
  }

  async current(session: Session) {
    const u = session.user;
    const st = session.station;
    return {
      user: {
        id: u.id,
        name: u.name,
        initials: u.initials,
        profile: u.profileCode,
        allowedStations: u.allowedStations,
      },
      station: { id: st.id, name: st.name, kind: st.kind, isMain: st.isMain },
      permissions: await this.permsOf(u, session.storeId),
      lockSeconds: await this.lockOf(u, session.station),
    };
  }

  /** Salir: la sesión deja de valer (app_session.ended_reason = logout). */
  async logout(se: Session) {
    await this.active.end(se.storeId, se.user.id, se.jti);
  }
}
