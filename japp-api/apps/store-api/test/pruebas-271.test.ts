import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, PIN, type T } from "./helpers.js";

/**
 * 1.2.271 (16/11/2026): el equipo se vuelve a vincular desde el propio equipo con la clave de un encargado
 * (POST /devices/claim). 1.2.281: lo que se guarda es la IP del equipo (el UUID ya no se usa); última conexión en
 * Ajustes › Estaciones; POST /devices/register ya no existe. La base es compartida: las estaciones quedan como estaban.
 */
let t: T;
let snap: { id: string; device_uuid: string | null; ip: string | null }[];
const U = () => crypto.randomUUID();
const claim = (body: Record<string, unknown>) => t.call("POST", "/devices/claim", { body });
/** 1.2.281 · desde una IP concreta (vincular guarda la IP del equipo) */
const claimFrom = async (ip: string, body: Record<string, unknown>) => {
  const r = await t.app.getHttpAdapter().getInstance().inject({ method: "POST", url: "/api/v2/devices/claim", payload: body, remoteAddress: ip });
  return { status: r.statusCode, body: JSON.parse(r.body).data, error: JSON.parse(r.body).errors?.[0] };
};
const identifyFrom = async (ip: string, type: string) => {
  const r = await t.app.getHttpAdapter().getInstance().inject({ method: "POST", url: "/api/v2/devices/identify", payload: { type }, remoteAddress: ip });
  return { status: r.statusCode, body: JSON.parse(r.body).data };
};
const row = async (id: string) => (await t.sql.query("SELECT device_uuid, ip, last_seen_at FROM station WHERE id = $1", [id])).rows[0];

beforeAll(async () => {
  t = await setup();
  snap = (await t.sql.query("SELECT id::text, device_uuid, ip FROM station")).rows;
  await t.sql.query("DELETE FROM pin_attempt WHERE key LIKE 'claim:%' OR key LIKE 'device:%'");
});
afterAll(async () => {
  await t.sql.query("UPDATE station SET device_uuid = NULL");
  for (const s of snap) await t.sql.query("UPDATE station SET device_uuid = $2, ip = $3 WHERE id = $1", [s.id, s.device_uuid, s.ip]);
  await t.sql.query("DELETE FROM pin_attempt WHERE key LIKE 'claim:%' OR key LIKE 'device:%'");
});

describe("POST /devices/claim · vincular este equipo a su estación", () => {
  it("sin estación: con la clave de un encargado devuelve las estaciones de su tipo (no cambia nada); clave mala o sin permiso → 401", async () => {
    const u = U();
    const bad = await claim({ deviceUuid: u, type: "mobile", pin: "9999" });
    expect([bad.status, bad.error.code]).toEqual([401, "BAD_PIN"]);
    const no = await claim({ deviceUuid: u, type: "mobile", pin: PIN.mesero });
    expect(no.status).toBe(401);
    await t.sql.query("DELETE FROM pin_attempt WHERE key LIKE 'claim:%' OR key LIKE 'device:%'");
    const pda = await claim({ deviceUuid: u, type: "mobile", pin: PIN.sistemas });
    expect(pda.status).toBe(200);
    expect(pda.body.stations.length).toBeGreaterThan(0);
    expect(pda.body.stations.every((s: any) => s.kind === "pda")).toBe(true);
    const desk = await claim({ deviceUuid: u, type: "desktop", pin: PIN.sistemas });
    expect(desk.body.stations.every((s: any) => s.kind !== "pda")).toBe(true);
    expect(desk.body.stations[0].main).toBe(true); // la principal primero
    expect(desk.body.stations[0]).toHaveProperty("lastSeenAt");
  });

  it("con estación: se le pone la IP de este equipo, se quita de otra PDA que la tuviera y queda en el historial; identify la reconoce", async () => {
    const store = (await t.sql.query("SELECT id::text FROM store LIMIT 1")).rows[0].id;
    const extra = crypto.randomUUID();
    await t.sql.query("INSERT INTO station (id, store_id, name, kind, ip) VALUES ($1, $2, 'PDA-T271', 'pda', '10.77.1.5')", [extra, store]); // la tenía otra
    const a = (await t.sql.query("SELECT id::text, name FROM station WHERE active AND kind='pda' AND id <> $1 ORDER BY name LIMIT 1", [extra])).rows[0];
    try {
    await t.sql.query("DELETE FROM pin_attempt WHERE key LIKE 'claim:%' OR key LIKE 'device:%'");
    const r = await claimFrom("10.77.1.5", { type: "mobile", pin: PIN.sistemas, stationId: a.id });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ stationId: a.id, name: a.name, kind: "pda", ip: "10.77.1.5" });
    expect((await row(a.id)).ip).toBe("10.77.1.5");
    expect((await row(extra)).ip).toBeNull();
    expect((await row(a.id)).device_uuid).toBeNull(); // el UUID ya no se guarda
    const h = (await t.sql.query("SELECT diff FROM config_change_log WHERE record_id = $1 ORDER BY at DESC LIMIT 1", [a.id])).rows[0];
    expect(h.diff).toContain("IP");
    const id = await identifyFrom("10.77.1.5", "mobile");
    expect([id.status, id.body.stationId]).toEqual([200, a.id]);
    expect((await row(a.id)).last_seen_at).toBeTruthy();
    const otra = await claimFrom("10.77.1.5", { type: "mobile", pin: PIN.sistemas, stationId: a.id });
    expect(otra.status).toBe(200); // repetir no cambia nada
    } finally {
      await t.sql.query("DELETE FROM config_change_log WHERE record_id = $1", [extra]).catch(() => {});
      await t.sql.query("DELETE FROM sync_outbox WHERE entity_id = $1", [extra]).catch(() => {});
      await t.sql.query("DELETE FROM station WHERE id = $1", [extra]);
    }
  });

  it("el tipo tiene que coincidir (móvil = PDA) y la estación existir", async () => {
    const caja = (await t.sql.query("SELECT id::text FROM station WHERE active AND kind<>'pda' LIMIT 1")).rows[0];
    const r = await claim({ deviceUuid: U(), type: "mobile", pin: PIN.sistemas, stationId: caja.id });
    expect([r.status, r.error.code]).toEqual([409, "DEVICE_TYPE_MISMATCH"]);
    const n = await claim({ deviceUuid: U(), type: "mobile", pin: PIN.sistemas, stationId: U() });
    expect([n.status, n.error.code]).toEqual([404, "NOT_FOUND"]);
  });

  it("Ajustes › Estaciones enseña la última conexión y no deja escribirla", async () => {
    const sis = await t.login(PIN.sistemas);
    const list = (await t.call("GET", "/config/estaciones", { token: sis })).body.items;
    expect(list[0]).toHaveProperty("lastSeenAt");
    const st = list.find((x: any) => x.lastSeenAt) ?? list[0];
    const before = st.lastSeenAt;
    const p = await t.call("PATCH", `/config/estaciones/${st.id}`, { token: sis, body: { lastSeenAt: "2000-01-01T00:00:00Z", version: st.version } });
    expect(p.status).toBe(200);
    const after = (await t.call("GET", "/config/estaciones", { token: sis })).body.items.find((x: any) => x.id === st.id);
    expect(after.lastSeenAt).toBe(before);
  });
});
