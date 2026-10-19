import { fail } from "./errors.js";
import type { StationLike } from "./stations.js";

/**
 * Primer arranque de un equipo (decidido 18/10/2026, igual que el prototipo):
 * - El equipo se reconoce por su UUID en Ajustes › Estaciones (comparación sin mayúsculas, solo estaciones activas).
 * - Escritorio («desktop») = cualquier estación que no sea PDA; Móvil («mobile») = PDA.
 * - Sin estación con ese UUID → 404 DEVICE_NOT_REGISTERED; con el otro tipo → 409 DEVICE_TYPE_MISMATCH.
 * - La caja principal (CAJA 1) se puede configurar en cualquier equipo de escritorio con la clave de un administrador
 *   (ajustes.estaciones): se guarda el UUID en la principal y se quita de cualquier otra que lo tuviera.
 */
export type DeviceType = "desktop" | "mobile";

export interface DeviceStation extends StationLike {
  active: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isDeviceUuid = (s: string) => UUID_RE.test(s.trim());

/** El tipo de equipo que corresponde a una estación. */
export function deviceTypeOf(station: Pick<StationLike, "kind">): DeviceType {
  if (station.kind === "pda") {
    return "mobile";
  }
  return "desktop";
}

const sameUuid = (a: string | null | undefined, b: string) =>
  !!a && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Busca la estación de este equipo. Lanza DEVICE_NOT_REGISTERED o DEVICE_TYPE_MISMATCH. */
export function identifyDevice<S extends DeviceStation>(
  stations: S[],
  deviceUuid: string,
  type: DeviceType,
): S {
  const found = stations.find((s) => s.active && sameUuid(s.deviceUuid, deviceUuid));
  if (!found) {
    fail("DEVICE_NOT_REGISTERED", "Este equipo no está dado de alta: añade su UUID en Ajustes › Estaciones", {
      deviceUuid,
    });
  }
  const station = found as S;
  const actual = deviceTypeOf(station);
  if (actual !== type) {
    fail("DEVICE_TYPE_MISMATCH", `Este UUID está dado de alta como ${labelOf(actual)}: ${station.name}`, {
      expected: type,
      actual,
      station: station.name,
    });
  }
  return station;
}

function labelOf(t: DeviceType) {
  if (t === "mobile") {
    return "móvil (PDA)";
  }
  return "escritorio";
}

export interface ClaimMainPlan<S> {
  main: S;
  previousUuid: string | null;
  /** Otras estaciones que tenían ese UUID y lo pierden (el UUID es único por tienda). */
  clearFrom: S[];
  /** Ya estaba configurada con ese UUID: no cambia nada. */
  unchanged: boolean;
}

/** Qué cambia al configurar este equipo como caja principal. */
export function planClaimMain<S extends DeviceStation>(stations: S[], deviceUuid: string): ClaimMainPlan<S> {
  const main = stations.find((s) => s.active && s.isMain);
  if (!main) {
    fail("NOT_FOUND", "No hay caja principal en Ajustes › Estaciones");
  }
  const m = main as S;
  const clearFrom = stations.filter((s) => s.id !== m.id && sameUuid(s.deviceUuid, deviceUuid));
  const unchanged = sameUuid(m.deviceUuid, deviceUuid) && clearFrom.length === 0;
  return { main: m, previousUuid: m.deviceUuid ?? null, clearFrom, unchanged };
}
