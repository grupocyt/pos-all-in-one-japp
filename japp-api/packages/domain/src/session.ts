import { fail } from "./errors.js";

/**
 * Bloqueo de sesión por inactividad (= inactSec del prototipo).
 * - Cada usuario puede tener su propio valor (Ajustes › Usuarios); null/undefined = el de la tienda.
 * - El de la tienda depende del equipo: TPV (7 s por defecto) o móvil/PDA (10 s).
 * - 0 = nunca se bloquea. Tope 3600 s.
 */
export interface StoreLock { tpv: number; pda: number; }
export const DEFAULT_LOCK: StoreLock = { tpv: 7, pda: 10 };

export function effectiveLockSeconds(userLock: number | null | undefined, store: StoreLock = DEFAULT_LOCK, isPda = false): number {
  const v = userLock ?? (isPda ? store.pda : store.tpv);
  return Math.max(0, Math.min(3600, Math.trunc(v)));
}

/** ¿Hay que pedir la clave ya? (0 = nunca). */
export const shouldLock = (lastActivity: Date, now: Date, seconds: number) => seconds > 0 && now.getTime() - lastActivity.getTime() >= seconds * 1000;

/**
 * Una sesión activa por usuario (decidido 15/10/2026): entrar con la clave en un equipo sustituye la sesión anterior
 * del mismo usuario (en otro equipo o en el mismo). La vigente se guarda en la base (app_session, migración 0009).
 * - token cuyo jti es la sesión vigente → vale;
 * - hay otra vigente → 401 SESSION_REPLACED «Tu clave se ha abierto en {estación}: vuelve a entrar»;
 * - no hay ninguna vigente (salió, o token anterior a la 0009) → 401 BAD_PIN «Sesión cerrada…».
 */
export interface ActiveSession { jti: string; stationId: string; stationName: string; }
export function assertActiveSession(current: ActiveSession | null | undefined, jti: string): void {
  if (!current) fail("BAD_PIN", "Sesión cerrada o no válida: vuelve a entrar con tu clave");
  if (current!.jti !== jti) fail("SESSION_REPLACED", `Tu clave se ha abierto en ${current!.stationName}: vuelve a entrar`, { station: current!.stationName });
}
/** ¿Hay que soltar las mesas del equipo anterior? Solo si la nueva sesión es en otro equipo. */
export const releasesStation = (prev: ActiveSession | null | undefined, stationId: string): string | null => (prev && prev.stationId !== stationId ? prev.stationId : null);
