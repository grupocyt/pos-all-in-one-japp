import { z } from "zod";

/** GET /incidents?status: pending (por defecto), sent o all. */
export const IncidentsFilterModel = z.object({
  status: z.enum(["pending", "sent", "all"]).default("pending"),
});

/** POST /incidents/send: todas las pendientes o las de ids, con una nota opcional para Marketing. */
export const SendIncidentsModel = z
  .object({
    ids: z.array(z.string().uuid()).max(500).nullish(),
    note: z.string().trim().max(300).nullish(),
  })
  .strict();
export type SendIncidentsInput = z.infer<typeof SendIncidentsModel>;
