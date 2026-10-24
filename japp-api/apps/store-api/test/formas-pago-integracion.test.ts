import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, PIN, type T } from "./helpers.js";

/** Id de integración de las formas de pago (migración 0014): opcional, se guarda y no se repite en la tienda. */
let t: T;
let sis: string;
let mesero: string;
beforeAll(async () => {
  t = await setup();
  sis = await t.login(PIN.sistemas);
  mesero = await t.login(PIN.mesero);
});
afterAll(async () => {
  await t.close();
});

describe("Formas de pago · id de integración", () => {
  it("alta con externalId, se lee y se cambia con la versión", async () => {
    const r = await t.call("POST", "/config/formas-pago", {
      token: sis,
      body: { code: "intticket", name: "Ticket Restaurante", kind: "voucher", externalId: "PAG-TR" },
    });
    expect(r.status).toBe(201);
    expect(r.body.item.externalId).toBe("PAG-TR");
    const row = (await t.sql.query("SELECT external_id FROM payment_method WHERE code='intticket'")).rows[0];
    expect(row.external_id).toBe("PAG-TR");
    const p = await t.call("PATCH", `/config/formas-pago/${r.body.id}`, {
      token: sis,
      body: { externalId: "PAG-TR2", version: r.body.version },
    });
    expect(p.status).toBe(200);
    expect(p.body.item.externalId).toBe("PAG-TR2");
    const cash = (await t.call("GET", "/config/formas-pago", { token: sis })).body.items.find((x: any) => x.code === "cash");
    expect(cash.externalId).toBeNull();
  });
  it("un id repetido en la tienda → 409 DUPLICATE", async () => {
    await t.call("POST", "/config/formas-pago", { token: sis, body: { code: "intx1", name: "Integración X1", kind: "platform", externalId: "PAG-X" } });
    const r = await t.call("POST", "/config/formas-pago", { token: sis, body: { code: "intx2", name: "Integración X2", kind: "platform", externalId: "PAG-X" } });
    expect(r.status).toBe(409);
    expect(r.error.code).toBe("DUPLICATE");
  });
  it("demasiado largo → 422 VALIDATION y sin permiso → 403", async () => {
    const r = await t.call("POST", "/config/formas-pago", { token: sis, body: { code: "largo", name: "Largo", kind: "platform", externalId: "x".repeat(61) } });
    expect(r.status).toBe(422);
    const m = await t.call("POST", "/config/formas-pago", { token: mesero, body: { code: "mes", name: "Mes", kind: "platform", externalId: "PAG-M" } });
    expect(m.status).toBe(403);
  });
});
