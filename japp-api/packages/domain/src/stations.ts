import { fail } from "./errors.js";

/**
 * Caja principal (decidido 15/10/2026):
 * - Cada tienda tiene una estación principal (station.is_main, CAJA1 en la Sucursal Pruebas).
 * - Un perfil con allowed_stations = 'main' (Cajero) solo entra y trabaja en la caja principal.
 * - Arqueo, retiros, fondo y cierre de periodo solo desde la caja principal. Abrir periodo, desde cualquiera.
 * - Identidad del equipo: si la estación tiene device_uuid, la cabecera X-Station-Id debe ser ese UUID
 *   (por nombre o id no vale: otro equipo podría hacerse pasar por ella). Sin device_uuid, vale id o nombre.
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
 * - Coincide con el device_uuid de una estación → esa.
 * - Coincide con el id o el nombre de una estación que tiene device_uuid → 403 STATION_NOT_ALLOWED («Este equipo no es esa estación»).
 * - Coincide con el id o el nombre de una estación sin device_uuid → esa (como hasta ahora).
 * - Sin cabecera o sin coincidencia → la primera caja (kind station) o la primera estación.
 */
export function resolveStation<S extends StationLike>(stations: S[], header?: string | null): S | null {
  const h = header?.trim();
  if (h) {
    const byDevice = stations.find((x) => x.deviceUuid && x.deviceUuid === h);
    if (byDevice) {
      return byDevice;
    }
    const byName = stations.find((x) => x.id === h || x.name === h);
    if (byName) {
      if (byName.deviceUuid) {
        fail("STATION_NOT_ALLOWED", "Este equipo no es esa estación", { station: byName.name });
      }
      return byName;
    }
  }
  return stations.find((x) => x.kind === "station") ?? stations[0] ?? null;
}

/**
 * Identidad del equipo para el bloqueo de PIN: su UUID si la estación lo tiene (el equipo registrado) o, si no, la estación.
 * No se cuenta por dirección IP: detrás de un proxy todas las peticiones llegan con la misma y se bloquearía toda la tienda.
 */
export const pinLockKey = (st: Pick<StationLike, "id" | "deviceUuid">) =>
  st.deviceUuid ? `device:${st.deviceUuid}` : `station:${st.id}`;
