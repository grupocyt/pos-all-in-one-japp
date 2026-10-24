import { z } from "zod";
import { PRESENCE_ACTIONS, type PresenceAction } from "@japp/domain";

/** Modelos de entrada de /orders (cuerpos y consultas). Los ids siempre como UUID. */
export const Uuid = z.string().uuid();
const version = z.number().int().positive().optional();
const auth = z.string().nullish();

export const OpenOrder = z.object({
  id: Uuid.optional(),
  accountId: Uuid.optional(),
  accountName: z.string().max(40).optional(),
  tableId: z.string().min(1),
  guests: z.number().int().min(1).max(99),
  authorization: auth,
});
export const PatchOrder = z.object({
  guests: z.number().int().min(1).max(99).optional(),
  note: z.string().max(300).nullish(),
  version,
});
export const NewAccount = z.object({ id: Uuid.optional(), name: z.string().max(40).optional(), version });
export const AddLine = z.object({
  id: Uuid.optional(),
  accountId: Uuid.nullish(),
  plu: z.number().int().positive(),
  quantity: z.number().int().min(1).max(999).default(1),
  comment: z.string().max(300).nullish(),
  modifiers: z
    .array(
      z.object({
        questionId: z.string().nullish(),
        plu: z.number().int().positive(),
        quantity: z.number().int().min(1).max(99).optional(),
      }),
    )
    .max(30)
    .default([]),
  force: z.boolean().default(false),
  version,
});
export const PatchLine = z.object({
  quantity: z.number().int().min(0).max(999).optional(),
  comment: z.string().max(300).nullish(),
  version,
});
export const DeleteLine = z.object({
  reasonId: Uuid.nullish(),
  reason: z.string().max(120).nullish(),
  quantity: z.number().int().min(1).optional(),
  authorization: auth,
  version,
});
export const MoveLines = z.object({
  lines: z.array(z.object({ lineId: Uuid, quantity: z.number().int().min(1) })).min(1),
  toAccountId: Uuid.nullish(),
  newAccountName: z.string().max(40).nullish(),
  authorization: auth,
  version,
});
export const Send = z.object({ accountId: Uuid.nullish(), version });
export const Discount = z.object({
  discountId: Uuid.nullish(),
  type: z.enum(["percentage", "fixed"]).optional(),
  value: z.number().positive().optional(),
  reason: z.string().max(120).nullish(),
  authorization: auth,
});
export const Customer = z.object({
  type: z.enum(["person", "company"]),
  taxId: z.string().min(5).max(20),
  name: z.string().min(1).max(120),
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
  saveToFile: z.boolean().default(true),
});
/** Cambiar de mesa: la mesa entera (scope table, por defecto) o una cuenta (scope account, con accountId). */
export const Transfer = z.object({
  scope: z.enum(["table", "account"]).default("table"),
  toTableId: Uuid,
  accountId: Uuid.nullish(),
  version,
  authorization: auth,
});
export const Pay = z.object({
  id: Uuid.optional(),
  method: z.string().min(1).max(30),
  amount: z.number().positive().nullish(),
  tip: z.number().min(0).default(0),
  cashGiven: z.number().min(0).nullish(),
  authorization: auth,
});
export const Presence = z.object({
  action: z.enum(PRESENCE_ACTIONS as [PresenceAction, ...PresenceAction[]]),
  /** enter: tomar el control de una mesa que tiene otra persona (mesas.entrarOcupada o clave de encargado). */
  takeOver: z.boolean().optional(),
  authorization: auth,
});
export const ListQuery = z.object({
  status: z.enum(["open", "billing", "closed", "cancelled"]).optional(),
  tableId: Uuid.optional(),
});
export const AuthOnly = z.object({ authorization: auth, print: z.boolean().optional() });

/** Menú por pases: elegir las respuestas de un pase. */
export const ChooseAnswers = z
  .object({
    course: z.number().int().min(0).max(9),
    modifiers: z
      .array(
        z.object({
          plu: z.number().int().positive(),
          quantity: z.number().int().min(1).max(99).optional(),
        }),
      )
      .max(30),
    // cambiar un pase ya marchado (falta de stock): motivo de la lista o en texto, y clave de encargado si hace falta
    reasonId: Uuid.nullish(),
    reason: z.string().max(120).nullish(),
    authorization: auth,
    version,
  })
  .strict();
/** Menú por pases: «Marchar» un pase. */
export const FireCourse = z.object({ course: z.number().int().min(0).max(9), version }).strict();
/** Menú por pases: incluir en el pase una bebida ya pedida. */
export const Absorb = z
  .object({ course: z.number().int().min(0).max(9), sourceLineId: Uuid, version })
  .strict();
export const ReorderLines = z
  .object({ accountId: Uuid.nullish(), lineIds: z.array(Uuid).min(1).max(200), version })
  .strict();
export const CloseOrder = z.object({ version: z.number().int().nullable().optional() }).strict();
export const TransferAccount = z
  .object({ version: z.number().int().positive(), toTableId: Uuid, authorization: auth })
  .strict();
/** «Guardar y salir». */
export const SaveOrder = z.object({ version: z.number().int().positive().nullish() }).strict();
/** Reabrir mesa (con clave de encargado si falta cobro.reabrir). */
export const ReopenOrder = z.object({ authorization: auth }).strict();
/** Renombrar cuenta: el nombre se limpia y se comprueba (1–40, sin repetir) en @japp/domain → renameAccount. */
export const RenameAccount = z.object({ name: z.string().max(80), version }).strict();
/** «Cobrar y facturar»: pagos (las reglas de cada uno, las de POST …/payments) + factura. */
export const Checkout = z
  .object({
    payments: z
      .array(
        z
          .object({
            method: z.string().min(1).max(30),
            amount: z.number().positive().nullish(),
            tip: z.number().min(0).default(0),
            cashGiven: z.number().min(0).nullish(),
          })
          .strict(),
      )
      .max(10)
      .default([]),
    print: z.boolean().default(true),
    version: z.number().int().positive().nullish(),
    authorization: auth,
  })
  .strict();
/** Buscar cliente: NIF o nombre (el mínimo de caracteres lo decide el servicio). */
export const CustomerSearch = z.object({ q: z.string().max(120).optional() });
