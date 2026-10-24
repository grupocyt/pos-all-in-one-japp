import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { setup, PIN, type T } from "./helpers.js";

/** Incidencias de mesa (migración 0015): se guardan solas y las resuelve una persona. */
let t: T;
let sis: string;
beforeAll(async () => {
  t = await setup();
  sis = await t.login(PIN.sistemas);
});
afterAll(async () => {
  await t.close();
});

describe("incidencias de mesa", () => {
  it("guardar: 201 con equipo y usuario de la sesión; repetir el mismo id no duplica", async () => {
    const id = randomUUID();
    const body = {
      id,
      orderId: randomUUID(),
      tableName: "12",
      kind: "offline",
      detail: { pendientes: [{ name: "Caña", quantity: 2 }] },
      occurredAt: new Date().toISOString(),
    };
    const r = await t.call("POST", "/order-incidents", { token: sis, body });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ id, kind: "offline", status: "open", tableName: "12", resolvedBy: null });
    expect(r.body.openedBy.user).toBe("Sistemas");
    expect(r.body.device).toBeTruthy();
    const again = await t.call("POST", "/order-incidents", {
      token: sis,
      body: { ...body, tableName: "99" },
    });
    expect(again.body.tableName).toBe("12");
    expect(
      Number((await t.sql.query("SELECT count(*) FROM order_incident WHERE id=$1", [id])).rows[0].count),
    ).toBe(1);
  });
  it("con diferencias o error en el detalle (no cuadra / rechazado)", async () => {
    const m = await t.call("POST", "/order-incidents", {
      token: sis,
      body: {
        id: randomUUID(),
        tableName: "3",
        kind: "mismatch",
        detail: { diffs: ["Cuenta 1 · total: TPV 10 ≠ API 9"] },
      },
    });
    expect(m.status).toBe(201);
    const rj = await t.call("POST", "/order-incidents", {
      token: sis,
      body: {
        id: randomUUID(),
        tableName: "3",
        kind: "rejected",
        detail: { error: "Esta cuenta ya está facturada" },
      },
    });
    expect(rj.status).toBe(201);
  });
  it("resolver: discarded con encargado; repetir igual no cambia; de otra forma → 409 INCIDENT_RESOLVED", async () => {
    const id = randomUUID();
    await t.call("POST", "/order-incidents", {
      token: sis,
      body: { id, tableName: "5", kind: "offline", detail: {} },
    });
    const r = await t.call("POST", `/order-incidents/${id}/resolve`, {
      token: sis,
      body: { status: "discarded", authorizedBy: "Lucía" },
    });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("discarded");
    expect(r.body.resolvedBy).toMatchObject({ user: "Sistemas", authorizedBy: "Lucía" });
    expect(
      (await t.call("POST", `/order-incidents/${id}/resolve`, { token: sis, body: { status: "discarded" } }))
        .status,
    ).toBe(200);
    const x = await t.call("POST", `/order-incidents/${id}/resolve`, {
      token: sis,
      body: { status: "retried" },
    });
    expect([x.status, x.error.code]).toEqual([409, "INCIDENT_RESOLVED"]);
  });
  it("listar abiertas por defecto y todas con status=all", async () => {
    const open = await t.call("GET", "/order-incidents", { token: sis });
    expect(open.body.items.every((i: any) => i.status === "open")).toBe(true);
    const all = await t.call("GET", "/order-incidents?status=all", { token: sis });
    expect(all.body.items.length).toBeGreaterThan(open.body.items.length);
  });
  it("datos mal → 422; incidencia que no existe → 404; sin sesión → 401", async () => {
    expect(
      (
        await t.call("POST", "/order-incidents", {
          token: sis,
          body: { id: "x", tableName: "", kind: "otra" },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await t.call("POST", `/order-incidents/${randomUUID()}/resolve`, {
          token: sis,
          body: { status: "retried" },
        })
      ).status,
    ).toBe(404);
    expect((await t.call("GET", "/order-incidents", {})).status).toBe(401);
  });
});
