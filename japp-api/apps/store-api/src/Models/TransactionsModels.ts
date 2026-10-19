import { z } from "zod";

/** POST /sync/transactions: qué día y qué tipo de transacciones se envían al Manager. */
export const SendTransactionsModel = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  type: z.enum(["all", "invoices", "credits", "open", "cancelled"]).default("all"),
});
export type SendTransactionsInput = z.infer<typeof SendTransactionsModel>;
