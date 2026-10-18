import { setup, ensurePeriod, freeTable, PIN, type T } from "./helpers.js";

/** Lo que necesita el TPV para hablar con la API desde el navegador. */
let t: T, open: T;
beforeAll(async () => { t = await setup({ corsOrigins: ["*"] }); open = await setup(); });
afterAll(async () => { await t.close(); await open.close(); });

describe("TPV en el navegador", () => {
  it("CORS: con CORS_ORIGINS=* responde a la comprobación previa y deja leer la respuesta", async () => {
    const f = t.app.getHttpAdapter().getInstance();
    const pre = await f.inject({ method: "OPTIONS", url: "/api/v2/sessions", headers: { origin: "http://localhost:8081", "access-control-request-method": "POST", "access-control-request-headers": "content-type,idempotency-key,x-station-id" } });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers["access-control-allow-origin"]).toBe("http://localhost:8081");
    expect(String(pre.headers["access-control-allow-headers"])).toContain("idempotency-key");
    const get = await f.inject({ method: "GET", url: "/api/v2/health", headers: { origin: "null" } });
    expect(get.headers["access-control-allow-origin"]).toBe("null");
  });
  it("sin CORS_ORIGINS no se abre a otros orígenes", async () => {
    const f = open.app.getHttpAdapter().getInstance();
    const get = await f.inject({ method: "GET", url: "/api/v2/health", headers: { origin: "http://otro.com" } });
    expect(get.headers["access-control-allow-origin"]).toBeUndefined();
  });
  it("abrir mesa con el id de la orden y de la primera cuenta que pone el TPV", async () => {
    const tok = await t.login(PIN.sistemas);
    await ensurePeriod(t, tok);
    const id = crypto.randomUUID(), accountId = crypto.randomUUID();
    const r = await t.call("POST", "/orders", { token: tok, body: { id, accountId, accountName: "Cuenta 1", tableId: await freeTable(t, "BARRA"), guests: 3 } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body._id).toBe(id);
    expect(r.body.accounts[0]).toMatchObject({ id: accountId, name: "Cuenta 1" });
  });
});
