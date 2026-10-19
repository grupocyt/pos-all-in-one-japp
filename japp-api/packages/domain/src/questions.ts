import { fail } from "./errors.js";
import type { LineCourse } from "./types.js";

/**
 * Preguntas de un producto (Ajustes › Preguntas): min = 0 opcional, min ≥ 1 obligatoria.
 * answers = PLU de los productos que son respuesta de esa pregunta.
 */
export interface QuestionRule {
  id: string;
  name: string;
  min: number;
  max: number;
  answers: number[];
  course?: number | null;
}
export interface AnswerInput {
  plu: number;
  quantity?: number;
  questionId?: string | null;
}

export const isRequired = (q: Pick<QuestionRule, "min">) => q.min >= 1;

/** Respuestas que cuentan para una pregunta (por questionId si viene; si no, por PLU de respuesta). */
export function answersFor(q: QuestionRule, mods: AnswerInput[]): number {
  return mods
    .filter((m) => (m.questionId ? m.questionId === q.id : q.answers.includes(m.plu)))
    .reduce((a, m) => a + (m.quantity ?? 1), 0);
}

/** No se añade un producto sin responder sus preguntas obligatorias, ni con más respuestas de las permitidas. */
export function checkAnswers(rules: QuestionRule[], mods: AnswerInput[], opts: { only?: string } = {}): void {
  for (const q of rules) {
    if (opts.only && q.id !== opts.only) {
      continue;
    }
    const n = answersFor(q, mods);
    // pases de comida (1.º, 2.º, postre) se pueden dejar «por elegir» al pedir; se exigen antes de cobrar
    if (!opts.only && n === 0 && (q.course ?? -1) >= 1) {
      continue;
    }
    if (n < q.min) {
      fail("VALIDATION", `Falta responder «${q.name}»${q.min > 1 ? ` (mínimo ${q.min})` : ""}`, {
        field: "modifiers",
        questionId: q.id,
        question: q.name,
        min: q.min,
        answered: n,
      });
    }
    if (q.max > 0 && n > q.max) {
      fail("VALIDATION", `«${q.name}» admite como mucho ${q.max}`, {
        field: "modifiers",
        questionId: q.id,
        question: q.name,
        max: q.max,
        answered: n,
      });
    }
  }
}

/** Pases de la línea según sus preguntas: respondida → «ready» (sale al guardar), sin responder → «pending» (por elegir). */
export function planCourses(rules: QuestionRule[], mods: AnswerInput[]): LineCourse[] | undefined {
  const cs = rules
    .filter((q) => q.course != null)
    .map((q) => ({
      course: q.course!,
      questionId: q.id,
      question: q.name,
      state: (answersFor(q, mods) > 0 ? "ready" : "pending") as LineCourse["state"],
      firedAt: null,
    }));
  return cs.length ? cs.sort((a, b) => a.course - b.course) : undefined;
}
/** Pase y pregunta de cada respuesta (por questionId o por PLU de respuesta). */
export function courseOfAnswer(
  rules: QuestionRule[],
  m: AnswerInput,
): { course: number | null; questionId: string | null } {
  const q = rules.find((r) => (m.questionId ? r.id === m.questionId : r.answers.includes(m.plu)));
  return { course: q?.course ?? null, questionId: q?.id ?? null };
}
