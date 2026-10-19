import { z } from "zod";
import { parseConnection } from "../Clases/Printers.js";

/** Tickets de ejemplo de la prueba de impresoras. */
export const SAMPLE_KINDS = ["test", "kitchen", "menu", "prebill", "invoice"] as const;
export const Sample = z.object({
  kind: z.enum(SAMPLE_KINDS).default("test"),
  table: z.string().max(20).default("12"),
  area: z.string().max(40).default("Terraza"),
  waiter: z.string().max(40).default("Prueba"),
  channel: z.string().max(40).default("COCINA"),
  guests: z.number().int().min(1).max(99).default(2),
});
export type SampleInput = z.infer<typeof Sample>;

/** Conexión de la impresora: IP, IP:puerto o tcp://IP:puerto. */
export const Conn = z
  .string()
  .trim()
  .min(3)
  .max(120)
  .refine((c) => !!parseConnection(c), "Usa una IP, IP:puerto o tcp://IP:puerto");

/** POST /printers/preview */
export const PreviewPrinter = Sample.extend({ connection: z.string().max(120).optional() });
/** POST /printers/ping */
export const PingPrinter = z.object({ connection: Conn });
/** POST /printers/print */
export const PrintSample = Sample.extend({
  connection: Conn,
  copies: z.number().int().min(1).max(5).default(1),
  drawer: z.boolean().default(false),
  logo: z.boolean().default(false),
});
/** POST /printers/{id}/test */
export const TestPrinter = Sample.extend({ copies: z.number().int().min(1).max(5).default(1) });
