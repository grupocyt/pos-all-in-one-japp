import { z } from "zod";

/** POST /periods: abrir periodo (con autorización de encargado si hace falta). */
export const OpenPeriodModel = z.object({ authorization: z.string().nullish() }).passthrough();
export type OpenPeriodInput = z.infer<typeof OpenPeriodModel>;

/** Id del periodo en la ruta. */
export const PeriodIdModel = z.string().uuid();

/** POST /periods/{id}/close: arqueo ciego del cierre. */
export const ClosePeriodModel = z.object({
  countedCash: z.number().min(0),
  countedCard: z.number().min(0).default(0),
  nextFloat: z.number().min(0),
  deposit: z.number().min(0).default(0),
  note: z.string().max(300).nullish(),
  authorization: z.string().nullish(),
});
export type ClosePeriodInput = z.infer<typeof ClosePeriodModel>;
