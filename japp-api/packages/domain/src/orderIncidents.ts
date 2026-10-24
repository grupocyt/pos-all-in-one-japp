import { fail } from "./errors.js";

/**
 * Incidencias de mesa (25/10/2026). El equipo las guarda solo (sin aplicar nada); resolverlas lo decide una persona:
 * - retried: se reintentó el envío de lo que se quedó en el equipo;
 * - discarded: se quedó lo del servidor y se descartó lo del equipo;
 * - resolved: volvió a cuadrar sin hacer nada.
 * Una incidencia resuelta no se resuelve otra vez de otra forma (409 INCIDENT_RESOLVED); repetir la misma resolución no hace nada.
 */
export type IncidentKind = "offline" | "mismatch" | "rejected";
export type IncidentStatus = "open" | "retried" | "discarded" | "resolved";
export type IncidentResolution = Exclude<IncidentStatus, "open">;

/** true = hay que guardar la resolución; false = ya estaba resuelta así (repetición). */
export function planIncidentResolution(current: IncidentStatus, next: IncidentResolution): boolean {
  if (current === "open") {
    return true;
  }
  if (current === next) {
    return false;
  }
  return fail("INCIDENT_RESOLVED", "Esta incidencia ya está resuelta", { field: "status", current });
}
