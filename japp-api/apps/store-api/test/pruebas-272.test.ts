import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, PIN, type T } from "./helpers.js";

/**
 * 1.2.272 (16/11/2026): «Cambiar mi clave» se guarda en el servidor (PUT /sessions/current/pin). La base es compartida:
 * Mesero vuelve a su clave al final.
 */
let t: T;
let hash: string;
beforeAll(async () => {
  t = await setup();
  hash = (await t.sql.query("SELECT pin_hash FROM app_user WHERE name='Mesero'")).rows[0].pin_hash;
  await t.sql.query("DELETE FROM pin_attempt WHERE key LIKE 'user:%'");
});
afterAll(async () => {
  await t.sql.query("UPDATE app_user SET pin_hash=$1 WHERE name='Mesero'", [hash]);
  await t.sql.query("DELETE FROM pin_attempt WHERE key LIKE 'user:%'");
});

describe("PUT /sessions/current/pin · cambiar mi clave", () => {
  it("con la actual buena se cambia en el servidor: la nueva entra y la vieja no; queda en el historial sin la clave", async () => {
    const tok = await t.login(PIN.mesero);
    const r = await t.call("PUT", "/sessions/current/pin", { token: tok, body: { currentPin: PIN.mesero, newPin: "2468" } });
    expect([r.status, r.body.changed]).toEqual([200, true]);
    expect((await t.call("POST", "/sessions", { body: { pin: "2468" } })).body.user.name).toBe("Mesero");
    expect((await t.call("POST", "/sessions", { body: { pin: PIN.mesero } })).error.code).toBe("BAD_PIN");
    const h = (await t.sql.query("SELECT diff, after FROM config_change_log WHERE module='usuarios' AND user_name='Mesero' ORDER BY at DESC LIMIT 1")).rows[0];
    expect(h.diff).toBe("Clave cambiada por el propio usuario");
    expect(JSON.stringify(h.after)).not.toContain("2468");
  });
  it("actual mala → 401 BAD_PIN; igual que la actual → 422; la de otra persona → 409 DUPLICATE (field newPin)", async () => {
    await t.sql.query("DELETE FROM pin_attempt WHERE key LIKE 'user:%'");
    const tok = await t.login("2468");
    const bad = await t.call("PUT", "/sessions/current/pin", { token: tok, body: { currentPin: "9999", newPin: "1357" } });
    expect([bad.status, bad.error.code]).toEqual([401, "BAD_PIN"]);
    const same = await t.call("PUT", "/sessions/current/pin", { token: tok, body: { currentPin: "2468", newPin: "2468" } });
    expect([same.status, same.error.field]).toEqual([422, "newPin"]);
    const dup = await t.call("PUT", "/sessions/current/pin", { token: tok, body: { currentPin: "2468", newPin: PIN.sistemas } });
    expect([dup.status, dup.error.code, dup.error.field]).toEqual([409, "DUPLICATE", "newPin"]);
    const otra = await t.call("PUT", "/sessions/current/pin", { token: tok, body: { currentPin: PIN.sistemas, newPin: "1357" } });
    expect(otra.error.code).toBe("BAD_PIN"); // la clave de otra persona no vale como «mi clave actual»
  });
});

describe("GET /config › users (las personas sin clave)", () => {
  it("cualquier sesión (también un camarero) recibe las personas activas con su perfil, nunca la clave", async () => {
    const tok = await t.login(PIN.barra);
    const r = await t.call("GET", "/config", { token: tok });
    const users = r.body.users as any[];
    expect(users.map((u) => u.name)).toEqual(expect.arrayContaining(["Sistemas", "Barra", "Jeison"]));
    const sis = users.find((u) => u.name === "Sistemas");
    expect(sis).toMatchObject({ profile: "ADMIN", active: true });
    expect(JSON.stringify(users)).not.toMatch(/pin/i);
  });
});

