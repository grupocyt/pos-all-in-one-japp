import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, PIN, type T } from "./helpers.js";

/**
 * 1.2.271 (16/11/2026): el equipo no cambia de estación. Si su UUID cambió (navegador borrado, otra dirección…) se
 * vuelve a vincular desde el propio equipo con la clave de un encargado (POST /devices/claim); última conexión en
 * Ajustes › Estaciones; POST /devices/register ya no existe. La base es compartida: las estaciones quedan como estaban.
 */
let t: T;
let snap: { id: string; device_uuid: string | null }[];
const U = () => crypto.randomUUID();
const claim = (body: Record<string, unknown>) => t.call("POST", "/devices/claim", { body });
const row = async (id: string) => (await t.sql.query("SELECT device_uuid, last_seen_at FROM station WHERE id = $1", [id])).rows[0];

beforeAll(async () => {
  t = await setup();
  snap = (await t.sql.query("SELECT id::text, device_uuid FROM station")).rows;
  await t.sql.query("DELETE FROM pin_attempt WHERE key LIKE 'claim:%' OR key LIKE 'device:%'");
});
afterAll(async () => {
  await t.sql.query("UPDATE station SET device_uuid = NULL");
  for (const s of snap) await t.sql.query("UPDATE station SET device_uuid = $2 WHERE id = $1", [s.id, s.device_uuid]);
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

  it("con estación: el UUID nuevo sustituye al viejo, se quita de otra que lo tuviera y queda en el historial; identify la reconoce", async () => {
    const store = (await t.sql.query("SELECT id::text FROM store LIMIT 1")).rows[0].id;
    const extra = crypto.randomUUID();
    await t.sql.query("INSERT INTO station (id, store_id, name, kind) VALUES ($1, $2, 'PDA-T271', 'pda')", [extra, store]);
    const a = (await t.sql.query("SELECT id::text, name FROM station WHERE active AND kind='pda' AND id <> $1 ORDER BY name LIMIT 1", [extra])).rows[0];
    const b = { id: extra };
    try {
    const nuevo = U();
    await t.sql.query("UPDATE station SET device_uuid = $2 WHERE id = $1", [b.id, nuevo]); // lo tenía otra
    const r = await claim({ deviceUuid: nuevo, type: "mobile", pin: PIN.sistemas, stationId: a.id });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ stationId: a.id, name: a.name, kind: "pda" });
    expect((await row(a.id)).device_uuid).toBe(nuevo);
    expect((await row(b.id)).device_uuid).toBeNull();
    const h = (await t.sql.query("SELECT diff FROM config_change_log WHERE record_id = $1 ORDER BY at DESC LIMIT 1", [a.id])).rows[0];
    expect(h.diff).toContain("UUID del equipo");
    const id = await t.call("POST", "/devices/identify", { body: { deviceUuid: nuevo.toUpperCase(), type: "mobile" } });
    expect([id.status, id.body.stationId]).toEqual([200, a.id]);
    expect((await row(a.id)).last_seen_at).toBeTruthy();
    const otra = await claim({ deviceUuid: nuevo, type: "mobile", pin: PIN.sistemas, stationId: a.id });
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
