import { fail } from "./errors.js";

/**
 * Una persona por mesa (decidido 15/10/2026):
 * - Quien entra en la mesa la «tiene» 30 s (holder_until); el equipo lo renueva con «renew» y con cada comando aceptado.
 * - Mesa con otra persona dentro: si se está cobrando (charging_until) nadie entra, ni un administrador (TABLE_CHARGING);
 *   con el permiso mesas.entrarOcupada se toma el control y el anterior sale de la mesa (25/10/2026: ya no puede ni guardar); sin él, TABLE_TAKEN.
 * - Quien tiene la mesa es la pareja (usuario, equipo): el mismo usuario desde otro equipo cuenta como otra persona
 *   (TABLE_TAKEN salvo mesas.entrarOcupada; TABLE_CHARGING mientras se cobra). Cambiado el 15/10/2026 por el product owner.
 * - Quien no tiene la mesa (otra persona u otro equipo) solo puede «Guardar»: añadir líneas y enviar.
 */
export const PRESENCE_LEASE_SECONDS = 30;
export const CHARGING_SECONDS = 60;

export interface TableHolder {
  userId: string;
  userName: string;
  stationId: string;
  stationName: string;
  until: string;
}
export interface PresenceState {
  holder: TableHolder | null;
  chargingUntil: string | null;
}
export interface PresenceCaller {
  userId: string;
  userName: string;
  stationId: string;
  stationName: string;
  canTakeOver?: boolean;
}
export type PresenceAction = "enter" | "renew" | "leave" | "charging" | "chargingEnd";
export const PRESENCE_ACTIONS: PresenceAction[] = ["enter", "renew", "leave", "charging", "chargingEnd"];
/** Lo que se puede hacer sin tener la mesa: Guardar (añadir líneas y enviar). */
/** save = Guardar (añadir y enviar); external = pedidos de fuera (Order on Table); other = el resto. */
export type CommandKind = "save" | "external" | "other";

const at = (now: Date, s: number) => new Date(now.getTime() + s * 1000).toISOString();
export const liveHolder = (s: PresenceState, now: Date): TableHolder | null =>
  s.holder && Date.parse(s.holder.until) > now.getTime() ? s.holder : null;
export const isCharging = (s: PresenceState, now: Date): boolean =>
  !!s.chargingUntil && Date.parse(s.chargingUntil) > now.getTime();
const sameDevice = (h: TableHolder | null, c: Pick<PresenceCaller, "userId" | "stationId">) =>
  !!h && h.userId === c.userId && h.stationId === c.stationId;

function taken(h: TableHolder): never {
  return fail("TABLE_TAKEN", `Mesa ocupada por ${h.userName} · ${h.stationName}`, {
    holder: { userName: h.userName, stationName: h.stationName, until: h.until },
  });
}

/**
 * ¿Puede entrar? Devuelve a quién desplaza (si entra con mesas.entrarOcupada) o null.
 * Cobro abierto por otra persona → TABLE_CHARGING, aunque su equipo haya dejado de renovar.
 */
export function canEnterTable(
  s: PresenceState,
  c: PresenceCaller,
  now: Date,
): { displaced: TableHolder | null } {
  const owner = s.holder;
  if (owner && !sameDevice(owner, c) && isCharging(s, now)) {
    fail("TABLE_CHARGING", "Se está cobrando esta mesa", {
      holder: { userName: owner.userName, stationName: owner.stationName, until: s.chargingUntil },
    });
  }
  const h = liveHolder(s, now);
  if (!h || sameDevice(h, c)) {
    return { displaced: null };
  }
  if (c.canTakeOver) {
    return { displaced: h };
  }
  return taken(h);
}

export function applyPresence(
  s: PresenceState,
  action: PresenceAction,
  c: PresenceCaller,
  now: Date,
): { state: PresenceState; displaced: TableHolder | null } {
  const me = (): TableHolder => ({
    userId: c.userId,
    userName: c.userName,
    stationId: c.stationId,
    stationName: c.stationName,
    until: at(now, PRESENCE_LEASE_SECONDS),
  });
  const live = liveHolder(s, now);
  const mine = sameDevice(live, c);
  const enter = () => {
    const { displaced } = canEnterTable(s, c, now);
    // el mismo usuario en el mismo equipo conserva su cobro abierto; cualquier otro empieza sin cobro
    return {
      state: { holder: me(), chargingUntil: sameDevice(s.holder, c) ? s.chargingUntil : null },
      displaced,
    };
  };
  switch (action) {
    case "enter":
      return enter();
    case "renew":
      if (mine) {
        return { state: { ...s, holder: me() }, displaced: null };
      }
      if (live) {
        return taken(live);
      } // nunca se recupera la mesa renovando: hay que volver a entrar
      return enter();
    case "leave":
      return mine
        ? { state: { holder: null, chargingUntil: null }, displaced: null }
        : { state: s, displaced: null };
    case "charging": {
      if (!mine && live) {
        return taken(live);
      }
      const base = mine ? { ...s, holder: me() } : enter().state;
      return { state: { ...base, chargingUntil: at(now, CHARGING_SECONDS) }, displaced: null };
    }
    case "chargingEnd":
      return mine ? { state: { ...s, chargingUntil: null }, displaced: null } : { state: s, displaced: null };
    default:
      return fail("VALIDATION", "Acción no válida", { field: "action" });
  }
}

/**
 * Guardia de los comandos de la orden: sin presencia viva, todo como siempre. Con otra persona/equipo dentro (25/10/2026):
 * nadie más toca la mesa, tampoco «Guardar»; hay que tomar el control (presence enter, con mesas.entrarOcupada).
 * Solo entran los pedidos de fuera (Order on Table), que no tienen equipo.
 */
export function assertCanCommand(
  s: PresenceState,
  c: Pick<PresenceCaller, "userId" | "stationId">,
  kind: CommandKind,
  now: Date,
): { holds: boolean } {
  const h = liveHolder(s, now);
  if (!h) {
    return { holds: false };
  }
  if (sameDevice(h, c)) {
    return { holds: true };
  }
  if (kind === "external") {
    return { holds: false };
  }
  return taken(h);
}

/** Lo que ve el equipo: quién tiene la mesa (si sigue viva), si se cobra y si es él. */
export function presenceView(s: PresenceState, c: Pick<PresenceCaller, "userId" | "stationId">, now: Date) {
  const h = liveHolder(s, now);
  return { holder: h ? { ...h } : null, charging: isCharging(s, now), youHold: sameDevice(h, c) };
}
