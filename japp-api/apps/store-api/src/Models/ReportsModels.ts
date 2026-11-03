import { z } from "zod";

/** Id del periodo en GET /reports/closings/{periodId}. */
export const ClosingIdModel = z.string().uuid();

/** ?periodId de GET /reports/sales y /reports/staff (vacío = el periodo abierto). */
export const PeriodQueryModel = z.object({ periodId: z.string().uuid().optional() });

/** POST /interface/sir/sales/send: el periodo (vacío = el último cerrado). */
export const SirSendModel = z.object({ periodId: z.string().uuid().nullish() }).strict();

/** PUT /reports/week/notes/{date}: el texto (vacío = borrar) y la versión que vio el equipo (0 o nada si no había). */
export const WeekNoteModel = z
  .object({
    note: z.string().max(500),
    version: z.number().int().min(0).nullish(),
    authorization: z.string().nullish(),
  })
  .strict();
