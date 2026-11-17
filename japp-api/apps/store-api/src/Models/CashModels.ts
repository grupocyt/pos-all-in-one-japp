import { z } from "zod";

/** POST /cash/movements: retiro, fondo o depósito. */
export const CashMovementModel = z.object({
  kind: z.enum(["withdrawal", "float", "deposit"]),
  amount: z.number().positive().max(100000),
  reasonId: z.string().nullish(),
  note: z.string().max(300).nullish(),
  authorization: z.string().nullish(),
});
export type CashMovementInput = z.infer<typeof CashMovementModel>;

/** POST /cash/counts: arqueo sin cierre, con el desglose opcional de billetes y monedas. */
export const CashCountModel = z
  .object({
    countedCash: z.number().min(0).max(1_000_000),
    detail: z.record(z.string().max(10), z.number().int().min(0).max(100_000)).nullish(),
    note: z.string().max(200).nullish(),
    authorization: z.string().nullish(),
    /** 11/11 (D2) · lo que marcó cada datáfono (Parámetros › Datáfonos); countedCard = la suma */
    cards: z
      .array(
        z
          .object({ name: z.string().trim().min(1).max(30), amount: z.number().min(0).max(1_000_000) })
          .strict(),
      )
      .max(9)
      .nullish(),
    /** 11/11 (D2) · imprimir el resumen del arqueo al guardarlo */
    print: z.boolean().optional(),
    /** 0037 · arqueo (como antes), cortex (corte X contado: ticket corto) o auditoria (arqueo de auditoría) */
    type: z.enum(["arqueo", "cortex", "auditoria"]).optional(),
    /** 0037 · corte X: el encargado ha visto y confirma las propinas que calcula el sistema */
    tipsConfirmed: z.boolean().optional(),
  })
  .strict();
export type CashCountInput = z.infer<typeof CashCountModel>;

/** POST /cash/drawer/open: abrir el cajón sin venta (motivo opcional). */
export const DrawerOpenModel = z.object({
  reasonId: z.string().uuid().nullish(),
  authorization: z.string().nullish(),
});
export type DrawerOpenInput = z.infer<typeof DrawerOpenModel>;

/** GET /cash/movements: los de la operativa (ops) o los de auditoría (audit). */
export const CashMovementsQueryModel = z.object({
  scope: z.enum(["ops", "audit", "all"]).default("ops"),
  periodId: z.string().uuid().nullish(),
});

/** POST /cash/petty: gasto de la caja chica (con motivo) o reposición. */
export const PettyCashModel = z
  .object({
    kind: z.enum(["expense", "replenish"]),
    amount: z.number().positive().max(10000).nullish(),
    reason: z.string().trim().max(200).nullish(),
    authorization: z.string().nullish(),
  })
  .strict();
export type PettyCashInput = z.infer<typeof PettyCashModel>;
