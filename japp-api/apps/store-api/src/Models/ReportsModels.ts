import { z } from "zod";

/** Id del periodo en GET /reports/closings/{periodId}. */
export const ClosingIdModel = z.string().uuid();

/** ?periodId de GET /reports/sales y /reports/staff (vacío = el periodo abierto). */
export const PeriodQueryModel = z.object({ periodId: z.string().uuid().optional() });
