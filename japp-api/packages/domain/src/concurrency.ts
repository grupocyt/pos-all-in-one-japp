import { fail } from "./errors.js";
/** Bloqueo optimista: el equipo manda la versión que vio; si no coincide → VERSION_CONFLICT con la actual. */
export function assertVersion(current: number, sent: number | undefined | null): number {
  if (sent == null) {
    fail("VALIDATION", "Falta version", { field: "version" });
  }
  if (sent !== current) {
    fail("VERSION_CONFLICT", "Otro equipo cambió la orden antes", { current, sent });
  }
  return current + 1;
}
