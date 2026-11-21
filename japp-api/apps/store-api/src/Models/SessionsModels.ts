import { z } from "zod";
import { ALL_PERMISSIONS } from "@japp/domain";

/** POST /sessions: la clave (de 4 a 8 cifras, 1.2.296). */
export const LoginModel = z.object({ pin: z.string().regex(/^\d{4,8}$/, "De 4 a 8 cifras") });
export type LoginInput = z.infer<typeof LoginModel>;

/** POST /sessions/authorize: clave de encargado para un permiso concreto. */
export const AuthorizeModel = z.object({
  pin: z.string().regex(/^\d{4,8}$/, "De 4 a 8 cifras"),
  permission: z.string().refine((p) => ALL_PERMISSIONS.includes(p), "permiso desconocido"),
});
export type AuthorizeInput = z.infer<typeof AuthorizeModel>;

/** PUT /sessions/current/pin (1.2.272): cambiar MI clave (la actual y la nueva). */
export const ChangePinModel = z.object({
  currentPin: z.string().regex(/^\d{4,8}$/, "De 4 a 8 cifras"),
  newPin: z.string().regex(/^\d{4,8}$/, "De 4 a 8 cifras"),
});
export type ChangePinInput = z.infer<typeof ChangePinModel>;
