import { setup, PIN, type T } from "./helpers.js";

let t: T;
beforeAll(async () => {
  t = await setup();
});
afterAll(async () => {
  await t.sql.query("UPDATE pin_attempt SET failures = 0, locked_until = NULL");
  await t.close();
});

describe("sistema y sesiones", () => {
  it("GET /health sin sesión: base ok y cola del outbox", async () => {
    const r = await t.call("GET", "/health");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ db: "ok", outboxPending: expect.any(Number) });
    // 1.2.199: versión de la tienda y si hay periodo abierto (sin sesión: la pantalla de clave lo enseña)
    expect(typeof r.body.version).toBe("string");
    expect(typeof r.body.period.open).toBe("boolean");
  });
  it("C1 (04/11): /health dice si hay internet según la cola hacia el Manager (down si lo pendiente ya falló)", async () => {
    expect((await t.call("GET", "/health")).body.internet.status).toBe("ok");
    const st = (await t.sql.query("SELECT id FROM store LIMIT 1")).rows[0].id;
    const ins = await t.sql.query(
      `INSERT INTO sync_outbox (store_id, entity, entity_id, payload, attempts, last_error) VALUES ($1,'test',gen_random_uuid(),'{}'::jsonb,2,'getaddrinfo ENOTFOUND manager') RETURNING id`,
      [st],
    );
    const r = (await t.call("GET", "/health")).body.internet;
    expect(r).toMatchObject({ status: "down", lastError: "getaddrinfo ENOTFOUND manager" });
    expect(r.failingSince).toBeTruthy();
    await t.sql.query("DELETE FROM sync_outbox WHERE id = $1", [ins.rows[0].id]);
    expect((await t.call("GET", "/health")).body.internet.status).toBe("ok");
  });
  it("entrar con PIN: perfil, permisos efectivos y excepciones", async () => {
    const r = await t.call("POST", "/sessions", { body: { pin: PIN.mesero } });
    expect(r.status).toBe(201);
    expect(r.body.user).toMatchObject({ name: "Mesero", profile: "MESERO" });
    expect(r.body.permissions).toContain("pedido.enviar");
    expect(r.body.permissions).not.toContain("cobro.cobrar");
    expect(r.body.overrides.canCharge).toBe(false);
    const j = await t.call("POST", "/sessions", { body: { pin: PIN.jeison } });
    expect(j.body.permissions).toHaveLength(61); // = ALL_PERMISSIONS (incluye mesas.entrarOcupada, funciones.semanaEditar y funciones.iniciarDia)
  });
  it("PIN mal formado → 422 VALIDATION; incorrecto → 401 BAD_PIN", async () => {
    expect((await t.call("POST", "/sessions", { body: { pin: "12" } })).error.code).toBe("VALIDATION");
    const r = await t.call("POST", "/sessions", {
      body: { pin: "9999" },
      headers: { "x-station-id": "pda-0001-aaaa" },
    });
    expect([r.status, r.error.code]).toEqual([401, "BAD_PIN"]);
  });
  it("tras 3 fallos el teclado se bloquea (423) y se desbloquea pasado el tiempo", async () => {
    const h = { "x-station-id": "CAJA1" };
    for (let i = 0; i < 3; i++) {
      await t.call("POST", "/sessions", { body: { pin: "0000" }, headers: h });
    }
    const locked = await t.call("POST", "/sessions", { body: { pin: PIN.sistemas }, headers: h });
    expect([locked.status, locked.error.code]).toEqual([423, "PIN_LOCKED"]);
    t.clock.now = new Date(Date.now() + 31_000);
    expect((await t.call("POST", "/sessions", { body: { pin: PIN.sistemas }, headers: h })).status).toBe(201);
    t.clock.now = new Date();
  });
  it("sin sesión o con token manipulado → 401", async () => {
    expect((await t.call("GET", "/tables")).status).toBe(401);
    const tok = await t.login(PIN.mesero);
    expect((await t.call("GET", "/tables", { token: tok.slice(0, -2) + "xx" })).status).toBe(401);
    expect((await t.call("GET", "/tables", { token: tok })).status).toBe(200);
  });
  it("sesión caducada → 401", async () => {
    const tok = await t.login(PIN.mesero);
    t.clock.now = new Date(Date.now() + 13 * 3600_000);
    // la caducidad se mira con el reloj real del proceso: simulamos firmando con exp pasado
    t.clock.now = new Date();
    const [body, sig] = tok.split(".");
    const claims = JSON.parse(Buffer.from(body!, "base64url").toString());
    const forged = Buffer.from(JSON.stringify({ ...claims, exp: 1 })).toString("base64url") + "." + sig;
    expect((await t.call("GET", "/tables", { token: forged })).status).toBe(401);
  });
  it("bloqueo de sesión: 7 s en TPV y 10 s en móvil por defecto; el del usuario manda y se ve sin volver a entrar", async () => {
    const tpv = await t.call("POST", "/sessions", {
      body: { pin: PIN.mesero },
      headers: { "x-station-id": "CAJA1" },
    });
    expect(tpv.body.lockSeconds).toBe(10); // 0027: los 7 s de arranque pasan a 10
    try {
      await t.sql.query("UPDATE app_user SET lock_seconds=15 WHERE name='Mesero'");
      expect((await t.call("GET", "/sessions/current", { token: tpv.body.token })).body.lockSeconds).toBe(15);
      await t.sql.query("UPDATE app_user SET lock_seconds=NULL WHERE name='Mesero'");
      await t.sql.query("UPDATE station SET device_uuid='pda-0001-aaaa' WHERE name='PDA1'"); // (1.2.271: sin /devices/register)
      const pda = await t.call("POST", "/sessions", {
        body: { pin: PIN.mesero },
        headers: { "x-station-id": "pda-0001-aaaa" },
      }); // la PDA1 con su UUID de equipo
      expect(pda.body.lockSeconds).toBe(10);
      // una sesión por usuario: la del TPV queda sustituida
      const old = await t.call("GET", "/sessions/current", { token: tpv.body.token });
      expect([old.status, old.error.code, old.error.message, old.error.details]).toEqual([
        401,
        "SESSION_REPLACED",
        "Tu clave se ha abierto en PDA1: vuelve a entrar",
        { station: "PDA1" },
      ]);
      await t.sql.query("UPDATE app_user SET lock_seconds=15 WHERE name='Mesero'");
      expect((await t.call("GET", "/sessions/current", { token: pda.body.token })).body.lockSeconds).toBe(15);
      await t.sql.query("UPDATE app_user SET lock_seconds=0 WHERE name='Mesero'");
      expect((await t.call("POST", "/sessions", { body: { pin: PIN.mesero } })).body.lockSeconds).toBe(0);
      // los demás siguen con el de la tienda
      expect(
        (
          await t.call("POST", "/sessions", {
            body: { pin: PIN.barra },
            headers: { "x-station-id": "CAJA1" },
          })
        ).body.lockSeconds,
      ).toBe(10);
    } finally {
      await t.sql.query("UPDATE app_user SET lock_seconds=NULL WHERE name='Mesero'");
    }
  });
});
