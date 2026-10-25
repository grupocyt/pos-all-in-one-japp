import { describe, expect, it } from "vitest";
import { planBatch, BATCH_MAX_COMMANDS, DomainError } from "../src/index.js";

const O = "11111111-1111-4111-8111-111111111111";
const L = "22222222-2222-4222-8222-222222222222";
const err = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as DomainError;
  }
  throw new Error("no falló");
};

describe("tanda de comandos de una mesa (planBatch)", () => {
  it("admite añadir, cambiar, quitar, pasar de cuenta, comensales y abrir esta misma mesa", () => {
    const cmds = planBatch(O, [
      { method: "POST", path: "/orders", body: { id: O, tableId: "t" } },
      { method: "PATCH", path: `/orders/${O}`, body: { guests: 3 } },
      { method: "POST", path: `/orders/${O}/lines`, body: { plu: 1 } },
      { method: "PATCH", path: `/orders/${O}/lines/${L}`, body: { quantity: 2 } },
      { method: "POST", path: `/orders/${O}/lines/${L}/delete`, body: {} },
      { method: "POST", path: `/orders/${O}/lines/move`, body: {} },
      { method: "POST", path: `/orders/${O}/accounts`, body: { name: "Cuenta 2" } },
      { method: "PUT", path: `/orders/${O}/lines/${L}/answers`, body: { course: 1, modifiers: [] } },
    ]);
    expect(cmds).toHaveLength(8);
  });

  it("lo que imprime, cobra o toca la presencia va suelto", () => {
    for (const p of [
      "/send",
      "/save",
      `/lines/${L}/fire`,
      `/accounts/${L}/prebill`,
      `/accounts/${L}/payments`,
      `/accounts/${L}/invoice`,
      "/presence",
      "/close",
      "/batch",
    ]) {
      const e = err(() => planBatch(O, [{ method: "POST", path: `/orders/${O}${p}`, body: {} }]));
      expect([e.code, e.details.field]).toEqual(["VALIDATION", "commands[0].path"]);
    }
  });

  it("cambiar un pase ya marchado (con motivo) reimprime: no entra", () => {
    const e = err(() =>
      planBatch(O, [
        { method: "PUT", path: `/orders/${O}/lines/${L}/answers`, body: { course: 1, reason: "cliente" } },
      ]),
    );
    expect(e.details.field).toBe("commands[0].body");
  });

  it("solo comandos de esta mesa; abrir otra mesa no", () => {
    const otra = "33333333-3333-4333-8333-333333333333";
    expect(
      err(() => planBatch(O, [{ method: "POST", path: `/orders/${otra}/lines`, body: {} }])).details.field,
    ).toBe("commands[0].path");
    expect(
      err(() => planBatch(O, [{ method: "POST", path: "/orders", body: { id: otra } }])).details.field,
    ).toBe("commands[0].body.id");
  });

  it("vacía o demasiado grande → VALIDATION", () => {
    expect(err(() => planBatch(O, [])).code).toBe("VALIDATION");
    const many = Array.from({ length: BATCH_MAX_COMMANDS + 1 }, () => ({
      method: "POST" as const,
      path: `/orders/${O}/lines`,
      body: {},
    }));
    expect(err(() => planBatch(O, many)).code).toBe("VALIDATION");
  });
});
