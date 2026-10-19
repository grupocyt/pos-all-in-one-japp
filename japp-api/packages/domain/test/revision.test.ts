import { DomainError, HTTP_STATUS } from "../src/errors.js";

/** Revisión 19/10/2026: la base deshizo la transacción (interbloqueo o serialización) → 409 BUSY_RETRY, se puede repetir. */
describe("BUSY_RETRY", () => {
  it("es un 409 y DomainError lo lleva", () => {
    expect(HTTP_STATUS.BUSY_RETRY).toBe(409);
    expect(
      new DomainError("BUSY_RETRY", "Otro equipo está cambiando lo mismo: vuelve a intentarlo").status,
    ).toBe(409);
  });
});
