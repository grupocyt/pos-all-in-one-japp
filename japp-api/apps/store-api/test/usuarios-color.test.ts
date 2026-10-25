import { setup, PIN, type T } from "./helpers.js";

/** Ajustes › Usuarios: color de la persona en el TPV (migración 0018). */
let t: T;
let sis: string;
beforeAll(async () => {
  t = await setup();
  sis = await t.login(PIN.sistemas);
});
afterAll(async () => {
  await t.sql.query("UPDATE app_user SET color = NULL");
  await t.close();
});

describe("color del usuario", () => {
  it("se guarda #RRGGBB, vacío vuelve a automático y otro formato → 422", async () => {
    const u = (await t.sql.query("SELECT id::text, version FROM app_user WHERE name='Mesero'")).rows[0];
    const ok = await t.call("PATCH", `/config/usuarios/${u.id}`, {
      token: sis,
      body: { color: "#4a6fb5", version: u.version },
    });
    expect([ok.status, ok.body.item.color]).toEqual([200, "#4a6fb5"]);
    const bad = await t.call("PATCH", `/config/usuarios/${u.id}`, {
      token: sis,
      body: { color: "azul", version: ok.body.version },
    });
    expect([bad.status, bad.error.field]).toEqual([422, "color"]);
    const off = await t.call("PATCH", `/config/usuarios/${u.id}`, {
      token: sis,
      body: { color: null, version: ok.body.version },
    });
    expect([off.status, off.body.item.color]).toEqual([200, null]);
  });
});
