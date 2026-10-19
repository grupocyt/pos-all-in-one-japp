import { z } from "zod";

/** POST /devices/register: primer arranque del equipo. */
export const RegisterDeviceModel = z.object({
  deviceUuid: z.string().min(8).max(36),
  kind: z.enum(["desktop", "mobile"]),
});
export type RegisterDeviceInput = z.infer<typeof RegisterDeviceModel>;
