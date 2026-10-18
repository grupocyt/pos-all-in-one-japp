import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:net";
import { setup, PIN, type T } from "./helpers.js";

let t: T, sis: string, mesero: string, srv: Server, port: number; const got: Buffer[] = [];
beforeAll(async () => {
  t = await setup(); sis = await t.login(PIN.sistemas); mesero = await t.login(PIN.mesero);
  srv = createServer(s => s.on("data", d => got.push(d))); await new Promise<void>(r => srv.listen(0, "127.0.0.1", r)); port = (srv.address() as any).port;
});
afterAll(async () => { srv.close(); await t.close(); });

describe("Ajustes › Prueba de impresoras (dentro de la API)", () => {
  it("vista previa de cada ticket de ejemplo con el formato real", async () => {
    for (const kind of ["test", "kitchen", "menu", "prebill", "invoice"]) {
      const r = await t.call("POST", "/printers/preview", { token: sis, body: { kind, connection: "192.168.1.50" } });
      expect(r.status, kind).toBe(200);
      expect(r.body.text.length).toBeGreaterThan(50);
    }
    expect((await t.call("POST", "/printers/preview", { token: sis, body: { kind: "prebill" } })).body.text).toMatch(/NO V[AÁ]LIDO COMO FACTURA/i);
    expect((await t.call("POST", "/printers/preview", { token: mesero, body: {} })).error.code).toBe("PERMISSION_REQUIRED");
  });
  it("probar conexión: conecta / rechaza / IP no válida", async () => {
    expect((await t.call("POST", "/printers/ping", { token: sis, body: { connection: `127.0.0.1:${port}` } })).body.ok).toBe(true);
    expect((await t.call("POST", "/printers/ping", { token: sis, body: { connection: "127.0.0.1:1" } })).body.ok).toBe(false);
    expect((await t.call("POST", "/printers/ping", { token: sis, body: { connection: "usb://x" } })).status).toBe(422);
  });
  it("imprimir por IP manda ESC/POS (2 copias); impresora apagada → PRINTER_OFFLINE", async () => {
    got.length = 0;
    const r = await t.call("POST", "/printers/print", { token: sis, body: { kind: "kitchen", connection: `127.0.0.1:${port}`, copies: 2 } });
    expect(r.body).toMatchObject({ ok: true, copies: 2 });
    await new Promise(x => setTimeout(x, 80));
    const b = Buffer.concat(got);
    expect(b.indexOf(Buffer.from([0x1b, 0x40]), 10)).toBeGreaterThan(0); // dos tickets seguidos (dos ESC @)
    const off = await t.call("POST", "/printers/print", { token: sis, body: { kind: "test", connection: "127.0.0.1:1" } });
    expect([off.status, off.error.code]).toEqual([503, "PRINTER_OFFLINE"]);
  });
  it("página de prueba en una impresora de Ajustes y estado de todas", async () => {
    const p = await t.call("POST", "/config/impresoras", { token: sis, body: { name: "PRUEBA LOCAL", connection: `tcp://127.0.0.1:${port}`, kind: "ticket" } });
    got.length = 0;
    const r = await t.call("POST", `/printers/${p.body.id}/test`, { token: sis, body: { kind: "test" } });
    expect(r.body).toMatchObject({ printer: "PRUEBA LOCAL", ok: true });
    const st = await t.call("GET", "/printers/status", { token: sis });
    expect(st.body.items.find((x: any) => x.name === "PRUEBA LOCAL").ok).toBe(true);
    expect(st.body.items.find((x: any) => x.name === "BARRA").ok).toBe(false); // 10.221.11.32 no existe aquí
    await t.call("POST", `/config/impresoras/${p.body.id}/deactivate`, { token: sis, body: {} });
  });
});
