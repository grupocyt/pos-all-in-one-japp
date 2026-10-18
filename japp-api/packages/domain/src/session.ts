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
