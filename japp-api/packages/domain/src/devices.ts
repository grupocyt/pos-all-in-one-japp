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

/** IP tal como llega (IPv4 dentro de IPv6 «::ffff:10.0.0.5» → «10.0.0.5»), sin espacios. */
export const normIp = (ip: string | null | undefined) =>
  String(ip ?? "")
    .trim()
    .replace(/^::ffff:/i, "")
    .toLowerCase();

/**
 * 1.2.273 (16/11/2026) · equipo que llega con un UUID que no está dado de alta: si su IP es la de UNA sola estación
 * activa de su tipo (móvil = PDA), es esa estación (la IP de cada equipo va reservada en el router). Con ninguna o con
 * varias, null: entonces se vincula con la clave de un encargado.
 */
export function stationByIp<S extends DeviceStation & { ip?: string | null }>(
  stations: S[],
  ip: string,
  type: DeviceType,
): S | null {
  const k = normIp(ip);
  if (!k) {
    return null;
  }
  const hits = stations.filter((s) => s.active && normIp(s.ip) === k && deviceTypeOf(s) === type);
  return hits.length === 1 ? hits[0]! : null;
}

export interface ClaimStationPlan<S> {
  station: S;
  previousUuid: string | null;
  clearFrom: S[];
  unchanged: boolean;
}

/**
 * 1.2.271 (16/11/2026) · vincular ESTE equipo a una estación desde el propio equipo (con la clave de quien tenga
 * ajustes.estaciones): la estación tiene que estar activa y ser del tipo del equipo (móvil = PDA). Su UUID anterior se
 * pierde (el equipo viejo deja de ser esa estación) y el nuevo se quita de cualquier otra que lo tuviera.
 */
export function planClaimStation<S extends DeviceStation>(
  stations: S[],
  stationId: string,
  deviceUuid: string,
  type: DeviceType,
): ClaimStationPlan<S> {
  const st = stations.find((s) => s.id === stationId && s.active);
  if (!st) {
    fail("NOT_FOUND", "Esa estación no existe o está desactivada", { field: "stationId" });
  }
  const s = st as S;
  const actual = deviceTypeOf(s);
  if (actual !== type) {
    fail("DEVICE_TYPE_MISMATCH", `${s.name} es ${labelOf(actual)}: este equipo es ${labelOf(type)}`, {
      expected: type,
      actual,
      station: s.name,
    });
  }
  const clearFrom = stations.filter((x) => x.id !== s.id && sameUuid(x.deviceUuid, deviceUuid));
  const unchanged = sameUuid(s.deviceUuid, deviceUuid) && clearFrom.length === 0;
  return { station: s, previousUuid: s.deviceUuid ?? null, clearFrom, unchanged };
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
