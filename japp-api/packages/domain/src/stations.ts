import { fail } from "./errors.js";

/**
 * Caja principal (decidido 15/10/2026):
 * - Cada tienda tiene una estación principal (station.is_main, CAJA1 en la Sucursal Pruebas).
 * - Un perfil con allowed_stations = 'main' (Cajero) solo entra y trabaja en la caja principal.
 * - Arqueo, retiros, fondo y cierre de periodo solo desde la caja principal. Abrir periodo, desde cualquiera.
 * - Identidad del equipo: desde 1.2.281 el equipo se reconoce por su IP (devices/identify); la cabecera
 *   X-Station-Id lleva el id o el nombre de la estación. El UUID ya no se usa.
 */
export type AllowedStations = "any" | "main";
export interface StationLike {
  id: string;
  name: string;
  kind: string;
  isMain: boolean;
  deviceUuid?: string | null;
}

export function assertStationAllowed(
  allowed: AllowedStations | string | null | undefined,
  station: Pick<StationLike, "name" | "isMain">,
): void {
  if (allowed === "main" && !station.isMain) {
    fail("STATION_NOT_ALLOWED", "Este perfil solo puede entrar en la caja principal", {
      allowed: "main",
      station: station.name,
    });
  }
}

export function assertMainStation(station: Pick<StationLike, "name" | "isMain">): void {
  if (!station.isMain) {
    fail("MAIN_STATION_REQUIRED", "Solo desde la caja principal", { station: station.name });
  }
}

/**
 * Qué estación es este equipo según la cabecera X-Station-Id.
 * - Coincide con el id o el nombre de una estación → esa (1.2.281: ya no se exige el UUID del equipo).
 * - Sin cabecera o sin coincidencia → la primera caja (kind station) o la primera estación.
 */
export function resolveStation<S extends StationLike>(stations: S[], header?: string | null): S | null {
  const h = header?.trim();
  if (h) {
    const byName = stations.find((x) => x.id === h || x.name === h);
    if (byName) {
      return byName;
    }
  }
  return stations.find((x) => x.kind === "station") ?? stations[0] ?? null;
}

/**
 * Identidad del equipo para el bloqueo de PIN: la estación (1.2.281: ya no por UUID).
 * No se cuenta por dirección IP: detrás de un proxy todas las peticiones llegan con la misma y se bloquearía toda la tienda.
 */
export const pinLockKey = (st: Pick<StationLike, "id">) => `station:${st.id}`;
