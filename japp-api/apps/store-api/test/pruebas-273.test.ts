import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, type T } from "./helpers.js";

/**
 * 1.2.273 (16/11/2026): el equipo se reconoce por su IP si su UUID no está dado de alta (la IP va reservada en el
 * router). La base es compartida: las estaciones quedan como estaban.
 */
let t: T;
let snap: { id: string; device_uuid: string | null; ip: string | null }[];
let pda: { id: string; name: string };
const identify = (deviceUuid: string, type: string, ip: string) =>
  t.app.getHttpAdapter().getInstance().inject({ method: "POST", url: "/api/v2/devices/identify", payload: { deviceUuid, type }, remoteAddress: ip });

beforeAll(async () => {
  t = await setup();
  snap = (await t.sql.query("SELECT id::text, device_uuid, ip FROM station")).rows;
  pda = (await t.sql.query("SELECT id::text, name FROM station WHERE active AND kind='pda' ORDER BY name LIMIT 1")).rows[0];
});
afterAll(async () => {
  await t.sql.query("UPDATE station SET device_uuid = NULL");
  for (const s of snap) await t.sql.query("UPDATE station SET device_uuid = $2, ip = $3 WHERE id = $1", [s.id, s.device_uuid, s.ip]);
});

describe("POST /devices/identify por IP", () => {
  it("desde la IP de una PDA → es esa PDA (1.2.281: sin guardar ningún UUID ni tocar el historial); desde otra IP ya no", async () => {
    await t.sql.query("UPDATE station SET ip = '10.77.0.15' WHERE id = $1", [pda.id]);
    const logs = (await t.sql.query("SELECT count(*)::int n FROM config_change_log WHERE record_id = $1", [pda.id])).rows[0].n;
    const u = crypto.randomUUID();
    const r = await identify(u, "mobile", "::ffff:10.77.0.15");
    const b = JSON.parse(r.body).data;
    expect([r.statusCode, b.stationId, b.matchedBy, b.clientIp]).toEqual([200, pda.id, "ip", "10.77.0.15"]);
    expect((await t.sql.query("SELECT device_uuid FROM station WHERE id = $1", [pda.id])).rows[0].device_uuid).toBeNull();
    expect((await t.sql.query("SELECT count(*)::int n FROM config_change_log WHERE record_id = $1", [pda.id])).rows[0].n).toBe(logs);
    expect((await identify(u, "mobile", "10.1.1.1")).statusCode).toBe(404); // el UUID ya no sirve desde otra IP
  });
  it("IP que no es de ninguna estación (o de otro tipo) → 404 DEVICE_NOT_REGISTERED con la IP del equipo", async () => {
    const r = await identify(crypto.randomUUID(), "mobile", "10.77.0.99");
    const e = JSON.parse(r.body).errors[0];
    expect([r.statusCode, e.code, e.details.clientIp]).toEqual([404, "DEVICE_NOT_REGISTERED", "10.77.0.99"]);
    const caja = (await t.sql.query("SELECT id::text FROM station WHERE active AND kind<>'pda' LIMIT 1")).rows[0];
    await t.sql.query("UPDATE station SET ip = '10.77.0.21' WHERE id = $1", [caja.id]);
    expect((await identify(crypto.randomUUID(), "mobile", "10.77.0.21")).statusCode).toBe(404);
  });
});
