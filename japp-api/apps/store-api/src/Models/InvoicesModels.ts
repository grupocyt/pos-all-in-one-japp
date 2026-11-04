import { z } from "zod";

/** AAAA-MM-DD (día entero en UTC; «hasta» incluye todo ese día). */
export const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** AAAA-MM-DD o fecha ISO completa. */
const when = z
  .string()
  .refine(
    (v) => (DAY.test(v) || /^\d{4}-\d{2}-\d{2}T/.test(v)) && !Number.isNaN(Date.parse(v)),
    "fecha no válida (AAAA-MM-DD o ISO 8601)",
  );

/** GET /invoices?from&to: filtro por fechas. */
export const InvoicesFilterModel = z.object({ from: when.optional(), to: when.optional() });
export type InvoicesFilter = z.infer<typeof InvoicesFilterModel>;

/** Id de la factura en la ruta. */
export const InvoiceIdModel = z.string().uuid();

/** POST /invoices/{id}/credit: abono de la factura entera (con `lines` → 422, ver assertWholeCredit); motivo por id (kind credit) o texto. */
export const CreditModel = z.object({
  reasonId: z.string().uuid().nullish(),
  reason: z.string().trim().max(200).nullish(),
  lines: z
    .array(z.object({ lineId: z.string().uuid(), quantity: z.number().positive().max(10000) }))
    .max(500)
    .nullish(),
  print: z.boolean().nullish(),
  authorization: z.string().nullish(),
});
export type CreditInput = z.infer<typeof CreditModel>;

/** POST /invoices/{id}/full: factura completa (F3) que sustituye a una simplificada, con los datos del cliente. */
export const SubstituteModel = z
  .object({
    customer: z.object({
      type: z.enum(["person", "company"]).default("company"),
      taxId: z.string().trim().min(5).max(20),
      name: z.string().trim().min(1).max(120),
      email: z.string().email().nullish(),
      address: z
        .object({
          street: z.string().max(120).optional(),
          postalCode: z.string().max(10).optional(),
          city: z.string().max(60).optional(),
          province: z.string().max(60).optional(),
          country: z.string().length(2).optional(),
        })
        .nullish(),
    }),
    print: z.boolean().nullish(),
  })
  .strict();
