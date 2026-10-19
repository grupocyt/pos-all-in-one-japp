import { z } from "zod";
import { ALL_PERMISSIONS } from "@japp/domain";

/** POST /sessions: la clave de 4 cifras del equipo. */
export const LoginModel = z.object({ pin: z.string().regex(/^\d{4}$/, "4 cifras") });
export type LoginInput = z.infer<typeof LoginModel>;

/** POST /sessions/authorize: clave de encargado para un permiso concreto. */
export const AuthorizeModel = z.object({
  pin: z.string().regex(/^\d{4}$/),
  permission: z.string().refine((p) => ALL_PERMISSIONS.includes(p), "permiso desconocido"),
});
export type AuthorizeInput = z.infer<typeof AuthorizeModel>;
