import { z } from "zod";
import { BATCH_MAX_COMMANDS } from "@japp/domain";

/** POST /orders/{orderId}/batch: la tanda de comandos de una mesa (las reglas, en @japp/domain → planBatch). */
export const BatchCommandModel = z
  .object({
    method: z.enum(["POST", "PATCH", "PUT", "DELETE"]),
    path: z.string().min(1).max(300),
    body: z.record(z.unknown()).nullish(),
    idempotencyKey: z.string().min(1).max(80).nullish(),
  })
  .strict();
export const BatchModel = z
  .object({ commands: z.array(BatchCommandModel).min(1).max(BATCH_MAX_COMMANDS) })
  .strict();
