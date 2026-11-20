import { z } from "zod";

/** POST /periods: abrir periodo (con autorización de encargado si hace falta). */
export const OpenPeriodModel = z
  .object({
    authorization: z.string().nullish(),
    /** 0037 · la base contada al abrir (billetes y monedas en detail); sin ella abre como antes */
    countedFloat: z.number().min(0).max(100000).nullish(),
    detail: z.record(z.string().max(10), z.number().int().min(0).max(100_000)).nullish(),
    note: z.string().trim().max(200).nullish(),
  })
  .passthrough();
export type OpenPeriodInput = z.infer<typeof OpenPeriodModel>;

/** Id del periodo en la ruta. */
export const PeriodIdModel = z.string().uuid();

/** POST /periods/{id}/close: arqueo ciego del cierre. */
export const ClosePeriodModel = z.object({
  countedCash: z.number().min(0),
  countedCard: z.number().min(0).default(0),
  /** 11/11 (D2) · lo que marcó cada datáfono (countedCard = la suma) */
  cards: z
    .array(
      z.object({ name: z.string().trim().min(1).max(30), amount: z.number().min(0).max(1_000_000) }).strict(),
    )
    .max(9)
    .nullish(),
  /** fondo que se queda en el cajón para el día siguiente; sin él, el del periodo menos retiros más ingresos (D2) */
  nextFloat: z.number().min(0).nullish(),
  /** lo que se deposita; sin él (o distinto), lo calcula la API: contado − fondo para mañana */
  deposit: z.number().min(0).nullish(),
  note: z.string().max(300).nullish(),
  /** 1.2.292 · lo contado de cada forma de pago dada de alta (las que no son efectivo ni tarjeta van aquí; efectivo y
   *  tarjeta pueden venir también, pero cuentan countedCash y countedCard) */
  methods: z
    .array(
      z
        .object({
          method: z.string().trim().min(1).max(30),
          name: z.string().trim().max(40).nullish(),
          counted: z.number().min(0).max(1_000_000),
        })
        .strict(),
    )
    .max(40)
    .nullish(),
  authorization: z.string().nullish(),
});
export type ClosePeriodInput = z.infer<typeof ClosePeriodModel>;
