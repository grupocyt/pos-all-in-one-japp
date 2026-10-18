import type { z } from "zod";
/** Valida el cuerpo con zod; si falla lanza ZodError → 422 VALIDATION con los campos. */
export const parse = <S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> => schema.parse(data ?? {});
