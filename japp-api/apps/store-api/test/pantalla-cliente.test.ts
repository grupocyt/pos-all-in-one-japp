import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setup, PIN, type T } from "./helpers.js";
import { StoreApplication } from "../src/Applications/StoreApplication.js";

/** Ajustes › Restaurante › Banners: la segunda pantalla del cliente (migración 0021). */
let t: T;
let sis: string;
let mesero: string;
const dir = mkdtempSync(join(tmpdir(), "japp-media-test-"));
const service = async (type: "table" | "fastfood") => {
  await t.sql.query("UPDATE store SET service_type = $1", [type]);
  t.app.get(StoreApplication).invalidate();
};
const raw = (url: string, headers: Record<string, string> = {}) =>
  t.app.getHttpAdapter().getInstance().inject({ method: "GET", url: `/api/v2${url}`, headers });

beforeAll(async () => {
  t = await setup({ mediaDir: dir });
  sis = await t.login(PIN.sistemas);
  mesero = await t.login(PIN.mesero);
  await service("table");
});
afterAll(async () => {
  await service("table");
  await t.sql.query("DELETE FROM display_media");
  await t.sql.query("DELETE FROM customer_display");
  await t.close();
});

describe("segunda pantalla del cliente", () => {
  let v = 1;
  let mediaId = "";
  it("cualquier sesión la lee; en una tienda de mesas solo apagada o facturación", async () => {
    const r = await t.call("GET", "/config/pantalla-cliente", { token: mesero });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ serviceType: "table", allowedModes: ["off", "billing"], effectiveMode: "billing", items: [] });
    v = r.body.version;
  });
  it("PUT: banners solo en fast food (422), permiso, versión y historial", async () => {
    let r = await t.call("PUT", "/config/pantalla-cliente", { token: sis, body: { version: v, config: { mode: "banner" } } });
    expect([r.status, r.error.code, r.error.field]).toEqual([422, "VALIDATION", "config.mode"]);
    r = await t.call("PUT", "/config/pantalla-cliente", { token: mesero, body: { version: v, config: { mode: "billing" } } });
    expect([r.status, r.error.code]).toEqual([403, "PERMISSION_REQUIRED"]);
    const cv0 = Number((await t.sql.query("SELECT config_version FROM store")).rows[0].config_version);
    r = await t.call("PUT", "/config/pantalla-cliente", {
      token: sis,
      body: { version: v, config: { mode: "billing", name: "CyT Pruebas", color: "#7C3AED", tickets: { print: false } } },
    });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.body.config).toMatchObject({ mode: "billing", name: "CyT Pruebas", color: "#7c3aed", tickets: { print: false, email: true } });
    expect(r.body.version).toBe(v + 1);
    expect(r.body.configVersion).toBe(cv0 + 1);
    const log = (await t.sql.query("SELECT action, diff FROM config_change_log WHERE module='pantalla-cliente' ORDER BY at DESC LIMIT 1")).rows[0];
    expect(log.diff).toContain("name");
    r = await t.call("PUT", "/config/pantalla-cliente", { token: sis, body: { version: v, config: {} } });
    expect([r.status, r.error.code]).toEqual([409, "VERSION_CONFLICT"]);
    r = await t.call("PUT", "/config/pantalla-cliente", { token: sis, body: { version: v + 1, config: { color: "azul" } } });
    expect([r.status, r.error.field]).toEqual([422, "config.color"]);
    v = v + 1;
  });
  it("subir un vídeo: al disco con su huella, al final de la lista; el archivo se sirve con Range", async () => {
    const bytes = Buffer.from("0123456789abcdef".repeat(64)); // 1024 bytes
    let r = await t.call("POST", "/config/pantalla-cliente/media", {
      token: sis,
      body: bytes,
      headers: { "content-type": "video/mp4", "x-file-name": encodeURIComponent("Promo verano ñ.mp4"), "x-duration": "30" },
    });
    expect(r.status, JSON.stringify(r.error)).toBe(201);
    expect(r.body).toMatchObject({ kind: "video", name: "Promo verano ñ.mp4", size: 1024, duration: 30, days: [], active: true, sortOrder: 1 });
    mediaId = r.body.id;
    expect(existsSync(join(dir, mediaId))).toBe(true);
    const f = await raw(`/media/${mediaId}`);
    expect([f.statusCode, f.headers["content-type"], f.rawPayload.length]).toEqual([200, "video/mp4", 1024]);
    const part = await raw(`/media/${mediaId}`, { range: "bytes=16-31" });
    expect([part.statusCode, part.headers["content-range"], part.body]).toEqual([206, "bytes 16-31/1024", "0123456789abcdef"]);
    expect((await raw(`/media/${crypto.randomUUID()}`)).statusCode).toBe(404);
    // otro tipo de archivo → 422; sin permiso → 403
    r = await t.call("POST", "/config/pantalla-cliente/media", { token: sis, body: "<b>x</b>", headers: { "content-type": "text/html" } });
    expect([r.status, r.error.field]).toEqual([422, "content-type"]);
    r = await t.call("POST", "/config/pantalla-cliente/media", { token: mesero, body: bytes, headers: { "content-type": "image/png" } });
    expect([r.status, r.error.code]).toEqual([403, "PERMISSION_REQUIRED"]);
    v = (await t.call("GET", "/config/pantalla-cliente", { token: sis })).body.version;
  });
  it("horario y orden de la lista con PUT; tiene que venir la lista entera", async () => {
    const img = await t.call("POST", "/config/pantalla-cliente/media", {
      token: sis,
      body: Buffer.from("PNGDATA"),
      headers: { "content-type": "image/png", "x-file-name": "cartel.png" },
    });
    expect(img.status).toBe(201);
    v = (await t.call("GET", "/config/pantalla-cliente", { token: sis })).body.version;
    let r = await t.call("PUT", "/config/pantalla-cliente", {
      token: sis,
      body: { version: v, config: { mode: "billing" }, items: [{ id: mediaId, days: [1, 2] }] },
    });
    expect([r.status, r.error.field]).toEqual([422, "items"]);
    r = await t.call("PUT", "/config/pantalla-cliente", {
      token: sis,
      body: {
        version: v,
        config: { mode: "billing" },
        items: [
          { id: img.body.id, days: [6, 7], from: "12:00", to: "16:00" },
          { id: mediaId, from: "22:00", to: "02:00", active: false },
        ],
      },
    });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.body.items.map((x: any) => [x.name, x.days, x.from, x.to, x.active, x.sortOrder])).toEqual([
      ["cartel.png", [6, 7], "12:00", "16:00", true, 1],
      ["Promo verano ñ.mp4", [], "22:00", "02:00", false, 2],
    ]);
    r = await t.call("PUT", "/config/pantalla-cliente", {
      token: sis,
      body: { version: r.body.version, config: {}, items: [{ id: mediaId, from: "25:00" }, { id: img.body.id }] },
    });
    expect([r.status, r.error.field]).toEqual([422, "items[0].from"]);
    v = (await t.call("GET", "/config/pantalla-cliente", { token: sis })).body.version;
  });
  it("fast food: los banners se pueden elegir; si la tienda vuelve a mesas, funciona como facturación", async () => {
    await service("fastfood");
    let r = await t.call("PUT", "/config/pantalla-cliente", { token: sis, body: { version: v, config: { mode: "billing_banner" } } });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.body).toMatchObject({ serviceType: "fastfood", effectiveMode: "billing_banner" });
    expect(r.body.allowedModes).toContain("banner");
    v = r.body.version;
    await service("table");
    r = await t.call("GET", "/config/pantalla-cliente", { token: mesero });
    expect(r.body).toMatchObject({ effectiveMode: "billing", config: { mode: "billing_banner" } });
  });
  it("quitar un archivo: sale de la lista, se borra del disco y deja de servirse", async () => {
    let r = await t.call("DELETE", `/config/pantalla-cliente/media/${mediaId}`, { token: mesero });
    expect(r.status).toBe(403);
    r = await t.call("DELETE", `/config/pantalla-cliente/media/${mediaId}`, { token: sis });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.body.items.map((x: any) => x.id)).not.toContain(mediaId);
    expect(existsSync(join(dir, mediaId))).toBe(false);
    expect((await raw(`/media/${mediaId}`)).statusCode).toBe(404);
    r = await t.call("DELETE", `/config/pantalla-cliente/media/${mediaId}`, { token: sis });
    expect([r.status, r.error.code]).toEqual([404, "NOT_FOUND"]);
    const row = (await t.sql.query("SELECT deleted_at FROM display_media WHERE id=$1", [mediaId])).rows[0];
    expect(row.deleted_at).toBeTruthy();
  });
});
