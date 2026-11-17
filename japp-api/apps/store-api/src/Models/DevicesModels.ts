import { z } from "zod";
import { isDeviceUuid } from "@japp/domain";

/** UUID del equipo (sin distinguir mayúsculas). */
const deviceUuid = z
  .string()
  .max(36)
  .refine((v) => isDeviceUuid(v), "UUID del equipo no válido")
  .transform((v) => v.trim());

/** POST /devices/identify: primer arranque, el equipo dice su tipo; se reconoce por su IP (1.2.281). El UUID ya no se usa. */
export const IdentifyDeviceModel = z.object({
  deviceUuid: deviceUuid.optional(),
  type: z.enum(["desktop", "mobile"]),
});
export type IdentifyDeviceInput = z.infer<typeof IdentifyDeviceModel>;

/** POST /devices/claim-main: configurar este equipo como caja principal con la clave de un administrador. */
export const ClaimMainModel = z.object({
  deviceUuid: deviceUuid.optional(),
  pin: z.string().regex(/^\d{4}$/, "La clave son 4 números"),
});
export type ClaimMainInput = z.infer<typeof ClaimMainModel>;

/**
 * POST /devices/claim (1.2.271): vincular este equipo a una estación con la clave de quien tenga ajustes.estaciones.
 * Sin stationId solo comprueba la clave y devuelve las estaciones de su tipo para elegir.
 */
export const ClaimStationModel = z.object({
  deviceUuid: deviceUuid.optional(),
  type: z.enum(["desktop", "mobile"]),
  pin: z.string().regex(/^\d{4}$/, "La clave son 4 números"),
  stationId: z.string().uuid().nullish(),
});
export type ClaimStationInput = z.infer<typeof ClaimStationModel>;
