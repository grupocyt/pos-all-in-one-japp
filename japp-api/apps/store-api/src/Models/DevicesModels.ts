import { z } from "zod";
import { isDeviceUuid } from "@japp/domain";

/** UUID del equipo (sin distinguir mayúsculas). */
const deviceUuid = z
  .string()
  .max(36)
  .refine((v) => isDeviceUuid(v), "UUID del equipo no válido")
  .transform((v) => v.trim());

/** POST /devices/identify: primer arranque, el equipo dice su UUID y su tipo. */
export const IdentifyDeviceModel = z.object({
  deviceUuid,
  type: z.enum(["desktop", "mobile"]),
});
export type IdentifyDeviceInput = z.infer<typeof IdentifyDeviceModel>;

/** POST /devices/claim-main: configurar este equipo como caja principal con la clave de un administrador. */
export const ClaimMainModel = z.object({
  deviceUuid,
  pin: z.string().regex(/^\d{4}$/, "La clave son 4 números"),
});
export type ClaimMainInput = z.infer<typeof ClaimMainModel>;
