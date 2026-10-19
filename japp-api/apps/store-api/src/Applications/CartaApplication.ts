import { Injectable } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { schema as s, type Tx } from "@japp/db";
import type { QuestionRule } from "@japp/domain";

/**
 * Lo que la venta consulta de Ajustes: la carta (productos, preguntas y respuestas), los motivos,
 * los descuentos configurados y las formas de pago. Solo lee; las reglas las decide el servicio con el dominio.
 */
@Injectable()
export class CartaApplication {
  /** Producto activo de la carta por PLU, con su tipo de IVA; undefined si no está. */
  async product(tx: Tx, storeId: string, plu: number) {
    const [p] = await tx
      .select({ p: s.product, rate: s.tax.rate })
      .from(s.product)
      .innerJoin(s.tax, eq(s.tax.id, s.product.taxId))
      .where(and(eq(s.product.storeId, storeId), eq(s.product.plu, plu), eq(s.product.active, true)));
    return p;
  }

  /** Preguntas activas del producto con sus respuestas (PLU), para comprobar las obligatorias. */
  async questionRules(tx: Tx, storeId: string, plu: number): Promise<QuestionRule[]> {
    const qs = await tx
      .select({ q: s.question })
      .from(s.productQuestion)
      .innerJoin(s.product, eq(s.product.id, s.productQuestion.productId))
      .innerJoin(s.question, eq(s.question.id, s.productQuestion.questionId))
      .where(
        and(eq(s.productQuestion.storeId, storeId), eq(s.product.plu, plu), eq(s.question.active, true)),
      );
    if (!qs.length) {
      return [];
    }
    const ans = await tx
      .select({ qid: s.questionAnswer.questionId, plu: s.product.plu })
      .from(s.questionAnswer)
      .innerJoin(s.product, eq(s.product.id, s.questionAnswer.productId))
      .where(
        and(
          eq(s.questionAnswer.storeId, storeId),
          inArray(
            s.questionAnswer.questionId,
            qs.map((x) => x.q.id),
          ),
        ),
      );
    return qs.map(({ q }) => ({
      id: q.id,
      name: q.name,
      min: Number(q.minAnswers ?? 0),
      max: Number(q.maxAnswers ?? 0),
      course: q.course ?? null,
      answers: ans.filter((a) => a.qid === q.id).map((a) => a.plu),
    }));
  }

  /** Respuesta (question_answer + su producto) por PLU, de una pregunta concreta si se indica; undefined si no existe. */
  async answer(tx: Tx, storeId: string, plu: number, questionId?: string | null) {
    const rows = await tx
      .select({ a: s.questionAnswer, p: s.product })
      .from(s.questionAnswer)
      .innerJoin(s.product, eq(s.product.id, s.questionAnswer.productId))
      .where(
        and(
          eq(s.questionAnswer.storeId, storeId),
          eq(s.product.plu, plu),
          ...(questionId ? [eq(s.questionAnswer.questionId, questionId)] : []),
        ),
      );
    return rows[0];
  }

  /** Motivo (Ajustes › Motivos) por id; undefined si no existe. */
  async reason(tx: Tx, storeId: string, reasonId: string) {
    const [r] = await tx
      .select()
      .from(s.reason)
      .where(and(eq(s.reason.storeId, storeId), eq(s.reason.id, reasonId)));
    return r;
  }

  /** Descuento activo de Ajustes › Descuentos por id; undefined si no existe o está desactivado. */
  async activeDiscount(tx: Tx, storeId: string, discountId: string) {
    const [row] = await tx
      .select()
      .from(s.discount)
      .where(
        and(eq(s.discount.storeId, storeId), eq(s.discount.id, discountId), eq(s.discount.active, true)),
      );
    return row;
  }

  /** Forma de pago por código (efectivo, tarjeta, glovo…); undefined si no existe. */
  async paymentMethod(tx: Tx, storeId: string, code: string) {
    const [row] = await tx
      .select()
      .from(s.paymentMethod)
      .where(and(eq(s.paymentMethod.storeId, storeId), eq(s.paymentMethod.code, code)));
    return row;
  }

  /** Ids de las formas de pago configuradas en la estación (vacío = todas). */
  async stationPaymentMethodIds(tx: Tx, storeId: string, stationId: string): Promise<string[]> {
    return (
      await tx
        .select({ id: s.stationPaymentMethod.paymentMethodId })
        .from(s.stationPaymentMethod)
        .where(
          and(eq(s.stationPaymentMethod.storeId, storeId), eq(s.stationPaymentMethod.stationId, stationId)),
        )
    ).map((x) => x.id);
  }

  /** Código → nombre de todas las formas de pago (para los tickets). */
  async paymentMethodNames(tx: Tx, storeId: string): Promise<Record<string, string>> {
    const methods = await tx
      .select({ code: s.paymentMethod.code, name: s.paymentMethod.name })
      .from(s.paymentMethod)
      .where(eq(s.paymentMethod.storeId, storeId));
    return Object.fromEntries(methods.map((m) => [m.code, m.name]));
  }
}
