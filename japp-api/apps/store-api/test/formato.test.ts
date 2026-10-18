import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, PIN, type T } from "./helpers.js";

/** Formato común de respuesta: { title, type, status, data, errors, traceId, author, mode } en todo /api/v2. */
describe("formato de respuesta", () => {
  let t: T;
  beforeAll(async () => { t = await setup(); });
  afterAll(async () => { await t.close(); });
  const KEYS = ["author", "data", "errors", "mode", "status", "title", "traceId", "type"];

  it("éxito: título del endpoint, data con el resultado, errors vacío y traceId igual a la cabecera", async () => {
    const r = await t.call("POST", "/sessions", { body: { pin: PIN.sistemas } });
    expect(Object.keys(r.env).sort()).toEqual(KEYS);
    expect(r.env).toMatchObject({ title: "Entrar con clave", type: "success", status: 201, errors: [], author: "Api Japp Grupo Cañas y Tapas", mode: "developer" });
    expect(r.env.data.token).toBeTruthy();
    expect(r.env.traceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.headers["x-trace-id"]).toBe(r.env.traceId);
  });

  it("error: type error, data null y errors con code, message, field y details", async () => {
    const r = await t.call("POST", "/sessions", { body: { pin: "9999" } });
    expect(Object.keys(r.env).sort()).toEqual(KEYS);
    expect(r.env).toMatchObject({ type: "error", status: 401, data: null, errors: [{ code: "BAD_PIN", field: null }] });
    expect(r.env.errors[0].message).toBeTruthy();
  });

  it("validación: un error por campo", async () => {
    const tok = await t.login(PIN.sistemas);
    const r = await t.call("POST", "/orders", { token: tok, body: { guests: "dos" } });
    expect(r.status).toBe(422);
    expect(r.env.errors.length).toBeGreaterThan(0);
    expect(r.env.errors.every((e: any) => e.code === "VALIDATION" && e.field)).toBe(true);
  });

  it("acción sin contenido (salir) responde 200 con data null; el traceId del equipo se respeta", async () => {
    const tok = await t.login(PIN.sistemas);
    const r = await t.call("DELETE", "/sessions/current", { token: tok, headers: { "x-trace-id": "caja1-0001-prueba" } });
    expect(r.env).toMatchObject({ type: "success", status: 200, data: null, traceId: "caja1-0001-prueba", title: "Salir" });
  });

  it("JSON mal formado o ruta inexistente también salen con el formato común", async () => {
    const f = t.app.getHttpAdapter().getInstance();
    const bad = await f.inject({ method: "POST", url: "/api/v2/sessions", headers: { "content-type": "application/json" }, payload: "{pin:" });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    expect(JSON.parse(bad.body)).toMatchObject({ type: "error", data: null, author: "Api Japp Grupo Cañas y Tapas" });
    const nf = await f.inject({ method: "GET", url: "/api/v2/no-existe" });
    expect(JSON.parse(nf.body)).toMatchObject({ type: "error", status: 404, errors: [{ code: "NOT_FOUND" }] });
  });

  it("modo producción", async () => {
    const p = await setup({ apiMode: "production" });
    try { expect((await p.call("GET", "/health")).env.mode).toBe("production"); } finally { await p.close(); }
  });
});
