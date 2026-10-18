import { describe, expect, it } from "vitest";
import { checkAnswers, answersFor, isRequired, type QuestionRule } from "../src/questions.js";
import type { DomainError } from "../src/errors.js";

const LICOR: QuestionRule = { id: "q1", name: "¿Con qué acompaña?", min: 1, max: 1, answers: [5272, 5275] };
const EXTRA: QuestionRule = { id: "q2", name: "Extras", min: 0, max: 3, answers: [9001, 9002] };
const err = (fn: () => unknown) => { try { fn(); } catch (e) { return [(e as DomainError).code, (e as DomainError).details.questionId]; } return "OK"; };

describe("preguntas del producto", () => {
  it("obligatoria = mínimo ≥ 1", () => { expect(isRequired(LICOR)).toBe(true); expect(isRequired(EXTRA)).toBe(false); });
  it("sin responder la obligatoria → VALIDATION con la pregunta", () => {
    expect(err(() => checkAnswers([LICOR, EXTRA], []))).toEqual(["VALIDATION", "q1"]);
    expect(err(() => checkAnswers([LICOR, EXTRA], [{ plu: 9001 }]))).toEqual(["VALIDATION", "q1"]);
  });
  it("respondida → OK; la opcional puede ir vacía", () => {
    expect(err(() => checkAnswers([LICOR, EXTRA], [{ plu: 5275 }]))).toBe("OK");
  });
  it("más respuestas que el máximo → VALIDATION", () => {
    expect(err(() => checkAnswers([LICOR], [{ plu: 5272 }, { plu: 5275 }]))).toEqual(["VALIDATION", "q1"]);
  });
  it("cuenta por questionId si viene, y por cantidad", () => {
    expect(answersFor(EXTRA, [{ plu: 9001, quantity: 2 }, { plu: 5272, questionId: "q2" }])).toBe(3);
  });
});
