import { planIncidentResolution } from "../src/orderIncidents.js";
import { DomainError } from "../src/errors.js";

describe("incidencias de mesa: resolución", () => {
  it("una abierta se resuelve de cualquier forma", () => {
    expect(planIncidentResolution("open", "retried")).toBe(true);
    expect(planIncidentResolution("open", "discarded")).toBe(true);
    expect(planIncidentResolution("open", "resolved")).toBe(true);
  });
  it("repetir la misma resolución no hace nada", () => {
    expect(planIncidentResolution("retried", "retried")).toBe(false);
  });
  it("resuelta de otra forma → INCIDENT_RESOLVED", () => {
    try {
      planIncidentResolution("discarded", "retried");
      throw new Error("no falló");
    } catch (e) {
      expect((e as DomainError).code).toBe("INCIDENT_RESOLVED");
    }
  });
});
