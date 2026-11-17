import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setup, PIN, type T } from "./helpers.js";

/**
 * 1.2.281 (17/11/2026): los equipos (TPV y PDA) se reconocen SOLO por su IP. El UUID del equipo ya no se usa:
 * ni identifica, ni se guarda al vincular, ni tiene que ser único (adiós a «Ese UUID de equipo ya lo tiene otra
 * estación activa»). La caja que corre en el propio servidor (localhost) es la caja principal.
 * La base es compartida: las estaciones quedan como estaban.
 */
let t: T;
let sis: string;
let snap: { id: string; device_uuid: string | null; ip: string | null; version: number }[];
const inject = async (url: string, payload: unknown, ip: string) => {
  const r: any = await (t.app.getHttpAdapter().getInstance() as any).inject({ method: "POST", url: `/api/v2${url}`, payload, remoteAddress: ip });
  const j = JSON.parse(r.body);
  return { status: r.statusCode, body: j.data, error: j.errors?.[0] };
};
const st = async (name: string) => (await t.sql.query("SELECT id::text, ip, device_uuid, version FROM station WHERE name = $1", [name])).rows[0];

beforeAll(async () => {
  t = await setup();
  sis = await t.login(PIN.sistemas);
  snap = (await t.sql.query("SELECT id::text, device_uuid, ip, version FROM station")).rows;
});
beforeEach(async () => {
  await t.sql.query("DELETE FROM pin_attempt WHERE key LIKE 'claim%' OR key LIKE 'device:%'");
});
afterAll(async () => {
  for (const s of snap) await t.sql.query("UPDATE station SET device_uuid = $2, ip = $3 WHERE id = $1", [s.id, s.device_uuid, s.ip]);
  await t.sql.query("DELETE FROM pin_attempt WHERE key LIKE 'claim%' OR key LIKE 'device:%'");
  await t.close();
});

describe("equipos por IP (sin UUID)", () => {
  it("dos estaciones con el mismo UUID ya no es un error (Ajustes › Equipos guarda)", async () => {
    const u = crypto.randomUUID();
    await t.sql.query("UPDATE station SET device_uuid = $1 WHERE name = 'PDA1'", [u]);
    const caja = await st("CAJA1");
    const r = await t.call("PATCH", `/config/estaciones/${caja.id}`, { token: sis, body: { deviceUuid: u, version: caja.version } });
    expect(r.status).toBe(200);
    await t.sql.query("UPDATE station SET device_uuid = NULL WHERE name IN ('PDA1', 'CAJA1')");
  });

  it("identify: por su IP y su tipo; sin UUID también vale; IP desconocida → 404 con la IP; el UUID no reconoce a nadie", async () => {
    const pda = await st("PDA1");
    await t.sql.query("UPDATE station SET ip = '10.88.0.31' WHERE id = $1", [pda.id]);
    const ok = await inject("/devices/identify", { type: "mobile" }, "10.88.0.31");
    expect([ok.status, ok.body.name, ok.body.matchedBy, ok.body.clientIp]).toEqual([200, "PDA1", "ip", "10.88.0.31"]);
    expect((await inject("/devices/identify", { type: "desktop" }, "10.88.0.31")).status).toBe(404); // otro tipo
    await t.sql.query("UPDATE station SET device_uuid = $2 WHERE id = $1", [pda.id, "2a6c930e-b2a3-4f71-9281-e06f4d425746"]);
    const nf = await inject("/devices/identify", { deviceUuid: "2a6c930e-b2a3-4f71-9281-e06f4d425746", type: "mobile" }, "10.88.0.99");
    expect([nf.status, nf.error.code, nf.error.details.clientIp]).toEqual([404, "DEVICE_NOT_REGISTERED", "10.88.0.99"]);
    expect((await inject("/devices/identify", { type: "tablet" }, "10.88.0.31")).status).toBe(422);
  });

  it("identify: la caja del propio servidor (localhost) es la caja principal", async () => {
    const r = await inject("/devices/identify", { type: "desktop" }, "127.0.0.1");
    expect([r.status, r.body.name, r.body.main]).toEqual([200, "CAJA1", true]);
    expect((await inject("/devices/identify", { type: "mobile" }, "127.0.0.1")).status).toBe(404); // una PDA no
  });

  it("claim-main: con la clave de un administrador la principal se queda con la IP de este equipo y la pierde otra caja que la tuviera", async () => {
    const store = (await t.sql.query("SELECT id::text FROM store LIMIT 1")).rows[0].id;
    const extra = crypto.randomUUID();
    await t.sql.query("INSERT INTO station (id, store_id, name, kind, ip) VALUES ($1, $2, 'CAJA-T281', 'station', '10.88.0.40')", [extra, store]);
    try {
      const before = Number((await t.sql.query("SELECT config_version FROM store")).rows[0].config_version);
      const bad = await inject("/devices/claim-main", { pin: "9999" }, "10.88.0.40");
      expect([bad.status, bad.error.code]).toEqual([401, "BAD_PIN"]);
      expect((await t.sql.query("SELECT failures FROM pin_attempt WHERE key = 'device:10.88.0.40'")).rows[0].failures).toBe(1);
      const r = await inject("/devices/claim-main", { pin: PIN.sistemas }, "10.88.0.40");
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ name: "CAJA1", main: true, ip: "10.88.0.40", configVersion: before + 1 });
      expect((await st("CAJA1")).ip).toBe("10.88.0.40");
      expect((await st("CAJA-T281")).ip).toBeNull();
      expect((await st("CAJA1")).device_uuid).toBeNull();
      const id = await inject("/devices/identify", { type: "desktop" }, "10.88.0.40");
      expect([id.status, id.body.name]).toEqual([200, "CAJA1"]);
      // desde el propio servidor no cambia la IP de la principal
      const local = await inject("/devices/claim-main", { pin: PIN.sistemas }, "127.0.0.1");
      expect([local.status, local.body.ip]).toEqual([200, "10.88.0.40"]);
    } finally {
      await t.sql.query("DELETE FROM config_change_log WHERE record_id = $1", [extra]).catch(() => {});
      await t.sql.query("DELETE FROM sync_outbox WHERE entity_id = $1", [extra]).catch(() => {});
      await t.sql.query("DELETE FROM station WHERE id = $1", [extra]);
    }
  });

  it("la cabecera X-Station-Id con el nombre vale aunque la estación tenga un UUID viejo", async () => {
    await t.sql.query("UPDATE station SET device_uuid = $1 WHERE name = 'PDA1'", [crypto.randomUUID()]);
    const r = await t.call("POST", "/sessions", { body: { pin: PIN.mesero }, headers: { "x-station-id": "PDA1" } });
    expect([r.status, r.body.station.name]).toEqual([201, "PDA1"]);
    await t.sql.query("UPDATE station SET device_uuid = NULL WHERE name = 'PDA1'");
  });
});
