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
  /** 11/11 (D2) · lo que marcó cada datáfono (countedCard = la suma) */
  cards: z
    .array(
      z.object({ name: z.string().trim().min(1).max(30), amount: z.number().min(0).max(1_000_000) }).strict(),
    )
    .max(9)
    .nullish(),
  /** fondo que se queda en el cajón para el día siguiente; sin él, el del periodo menos retiros más ingresos (D2) */
  nextFloat: z.number().min(0).nullish(),
  /** lo que se deposita; sin él (o distinto), lo calcula la API: contado − fondo para mañana */
  deposit: z.number().min(0).nullish(),
  note: z.string().max(300).nullish(),
  authorization: z.string().nullish(),
});
export type ClosePeriodInput = z.infer<typeof ClosePeriodModel>;
