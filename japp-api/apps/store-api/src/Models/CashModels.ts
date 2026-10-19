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
  })
  .strict();
export type CashCountInput = z.infer<typeof CashCountModel>;

/** POST /cash/drawer/open: abrir el cajón sin venta (motivo opcional). */
export const DrawerOpenModel = z.object({
  reasonId: z.string().uuid().nullish(),
  authorization: z.string().nullish(),
});
export type DrawerOpenInput = z.infer<typeof DrawerOpenModel>;
