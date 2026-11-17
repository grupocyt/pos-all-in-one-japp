import { setup, ensurePeriod, PIN, type T } from "./helpers.js";

/**
 * Caja principal (decidido 15/10/2026): el Cajero solo entra en la caja principal; caja, retiros y cierre solo desde ella;
 * la estación con UUID de equipo solo se reconoce por ese UUID; el bloqueo de PIN no se salta cambiando X-Station-Id.
 */
let t: T;
let sis: string;
let storeId: string;
const CAJA2 = "c2c2c2c2-0000-4000-8000-000000000002";
beforeAll(async () => {
  t = await setup();
  sis = await t.login(PIN.sistemas);
  await ensurePeriod(t, sis);
  storeId = (await t.sql.query("SELECT store_id FROM station WHERE name='CAJA1'")).rows[0].store_id;
  await t.sql.query(
    "INSERT INTO station (id, store_id, name, kind, active) VALUES ($1, $2, 'CAJA2', 'station', true) ON CONFLICT DO NOTHING",
    [CAJA2, storeId],
  );
});
afterAll(async () => {
  await t.sql.query("UPDATE pin_attempt SET failures = 0, locked_until = NULL");
  await t.sql.query("UPDATE station SET device_uuid = NULL, active = false WHERE id = $1", [CAJA2]);
  await t.close();
});

describe("caja principal", () => {
  it("la base marca CAJA1 como principal y el Cajero como «solo caja principal»; la sesión lo dice", async () => {
    const r = await t.call("POST", "/sessions", {
      body: { pin: PIN.barra },
      headers: { "x-station-id": "CAJA1" },
    });
    expect(r.status).toBe(201);
    expect(r.body.user).toMatchObject({ profile: "CAJERO", allowedStations: "main" });
    expect(r.body.station).toMatchObject({ name: "CAJA1", isMain: true });
    const cur = await t.call("GET", "/sessions/current", { token: r.body.token });
    expect([cur.body.user.allowedStations, cur.body.station.isMain]).toEqual(["main", true]);
  });

  it("el Cajero en otra estación → 403 STATION_NOT_ALLOWED; el Mesero sí entra", async () => {
    const r = await t.call("POST", "/sessions", {
      body: { pin: PIN.barra },
      headers: { "x-station-id": "CAJA2" },
    });
    expect([r.status, r.error.code, r.error.message, r.error.details]).toEqual([
      403,
      "STATION_NOT_ALLOWED",
      "Este perfil solo puede entrar en la caja principal",
      { allowed: "main", station: "CAJA2" },
    ]);
    const m = await t.call("POST", "/sessions", {
      body: { pin: PIN.mesero },
      headers: { "x-station-id": "CAJA2" },
    });
    expect([m.status, m.body.station.isMain, m.body.user.allowedStations]).toEqual([201, false, "any"]);
  });

  it("si el perfil pasa a «solo caja principal» con la sesión abierta, la siguiente petición se rechaza", async () => {
    const tok = await t.login(PIN.mesero, "CAJA2");
    try {
      await t.sql.query("UPDATE user_profile SET allowed_stations = 'main' WHERE code = 'MESERO'");
      const cur = await t.call("GET", "/sessions/current", { token: tok });
      expect([cur.status, cur.error.code]).toEqual([403, "STATION_NOT_ALLOWED"]);
      expect((await t.call("GET", "/tables", { token: tok })).error.code).toBe("STATION_NOT_ALLOWED");
    } finally {
      await t.sql.query("UPDATE user_profile SET allowed_stations = 'any' WHERE code = 'MESERO'");
    }
    expect((await t.call("GET", "/tables", { token: tok })).status).toBe(200);
  });

  it("caja, retiros y cierre solo desde la caja principal → 403 MAIN_STATION_REQUIRED; abrir otro periodo → 409 PERIOD_ALREADY_OPEN", async () => {
    const enCaja2 = await t.login(PIN.jeison, "CAJA2"); // otro administrador: una sesión por usuario
    const mv = await t.call("POST", "/cash/movements", {
      token: enCaja2,
      body: { kind: "withdrawal", amount: 5, note: "Prueba" },
    });
    expect([mv.status, mv.error.code, mv.error.message]).toEqual([
      403,
      "MAIN_STATION_REQUIRED",
      "Solo desde la caja principal",
    ]);
    const period = await ensurePeriod(t, sis);
    const cl = await t.call("POST", `/periods/${period}/close`, {
      token: enCaja2,
      body: { countedCash: 0, nextFloat: 0 },
    });
    expect([cl.status, cl.error.code]).toEqual([403, "MAIN_STATION_REQUIRED"]);
    // abrir periodo se puede desde cualquier estación: llega a la regla de «uno abierto»
    const op = await t.call("POST", "/periods", { token: enCaja2, body: {} });
    expect([op.status, op.error.code]).toEqual([409, "PERIOD_ALREADY_OPEN"]);
    // desde la principal el retiro va
    expect(
      (
        await t.call("POST", "/cash/movements", {
          token: sis,
          body: { kind: "withdrawal", amount: 1, note: "A caja fuerte" },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await t.call("POST", "/periods/no-es-uuid/close", {
          token: sis,
          body: { countedCash: 0, nextFloat: 0 },
        })
      ).status,
    ).toBe(422);
  });
});

describe("identidad del equipo", () => {
  it("1.2.281: la estación se reconoce por su nombre o id aunque tenga un UUID guardado (ya no se usa)", async () => {
    await t.sql.query("UPDATE station SET device_uuid = 'dev-caja2-0001' WHERE id = $1", [CAJA2]);
    for (const h of ["CAJA2", CAJA2]) {
      const r = await t.call("POST", "/sessions", { body: { pin: PIN.mesero }, headers: { "x-station-id": h } });
      expect([r.status, r.body.station.name]).toEqual([201, "CAJA2"]);
    }
  });
});

describe("bloqueo de PIN (en la base, por equipo)", () => {
  it("se bloquea el equipo, no la tienda; sigue bloqueado tras reiniciar la API; la clave de encargado cuenta por usuario", async () => {
    for (let i = 0; i < 3; i++) {
      await t.call("POST", "/sessions", { body: { pin: "0000" }, headers: { "x-station-id": "CAJA1" } });
    }
    const locked = await t.call("POST", "/sessions", {
      body: { pin: PIN.sistemas },
      headers: { "x-station-id": "CAJA1" },
    });
    expect([locked.status, locked.error.code]).toEqual([423, "PIN_LOCKED"]);
    // otro equipo (mismo origen, como detrás de un proxy) entra sin problema
    expect(
      (
        await t.call("POST", "/sessions", {
          body: { pin: PIN.mesero },
          headers: { "x-station-id": "CAJA2" },
        })
      ).status,
    ).toBe(201);
    const caja1 = (await t.sql.query("SELECT id FROM station WHERE name='CAJA1'")).rows[0].id;
    const row = (
      await t.sql.query("SELECT locked_until FROM pin_attempt WHERE key = $1", [`station:${caja1}`])
    ).rows[0];
    expect(new Date(row.locked_until).getTime()).toBeGreaterThan(Date.now());
    // «reinicio»: otra instancia de la API lee el bloqueo de la base
    const t2 = await setup();
    try {
      expect(
        (
          await t2.call("POST", "/sessions", {
            body: { pin: PIN.sistemas },
            headers: { "x-station-id": "CAJA1" },
          })
        ).error.code,
      ).toBe("PIN_LOCKED");
    } finally {
      await t2.close();
    }
    // clave de encargado: por usuario de la sesión
    const mesero = await t.login(PIN.mesero, "CAJA2");
    for (let i = 0; i < 3; i++) {
      await t.call("POST", "/sessions/authorize", {
        token: mesero,
        body: { pin: "0000", permission: "cobro.cobrar" },
      });
    }
    const auth = await t.call("POST", "/sessions/authorize", {
      token: mesero,
      body: { pin: PIN.sistemas, permission: "cobro.cobrar" },
    });
    expect([auth.status, auth.error.code]).toEqual([423, "PIN_LOCKED"]);
    t.clock.now = new Date(Date.now() + 31_000);
    expect(
      (
        await t.call("POST", "/sessions", {
          body: { pin: PIN.sistemas },
          headers: { "x-station-id": "CAJA1" },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await t.call("POST", "/sessions/authorize", {
          token: mesero,
          body: { pin: PIN.sistemas, permission: "cobro.cobrar" },
        })
      ).status,
    ).toBe(201);
    t.clock.now = new Date();
  });
});

describe("sesiones en la base", () => {
  it("un token sustituido no vuelve a valer tras reiniciar la API; salir cierra la sesión", async () => {
    const a = await t.login(PIN.barra);
    const b = await t.login(PIN.barra);
    const t2 = await setup();
    try {
      expect((await t2.call("GET", "/sessions/current", { token: a })).error.code).toBe("SESSION_REPLACED");
      expect((await t2.call("GET", "/sessions/current", { token: b })).status).toBe(200);
    } finally {
      await t2.close();
    }
    const { rows } = await t.sql.query(
      "SELECT ended_reason FROM app_session s JOIN app_user u ON u.id = s.user_id WHERE u.name='Barra' AND s.ended_at IS NOT NULL",
    );
    expect(rows.some((r) => r.ended_reason === "replaced")).toBe(true);
    expect((await t.call("DELETE", "/sessions/current", { token: b })).status).toBe(200);
    const after = await t.call("GET", "/sessions/current", { token: b });
    expect([after.status, after.error.code]).toEqual([401, "BAD_PIN"]);
  });
});

describe("abrir el periodo con la clave de un encargado", () => {
  it("encargado en CAJA1; el Mesero en la PDA1 abre el periodo con su autorización; el token del encargado sigue valiendo", async () => {
    const encargado = await t.login(PIN.sistemas, "CAJA1");
    await t.sql.query("UPDATE station SET device_uuid = 'pda-0001-aaaa' WHERE name = 'PDA1'");
    const mesero = await t.login(PIN.mesero, "PDA1");
    // sin periodo abierto: GET /periods/current → 409 PERIOD_CLOSED
    await t.sql.query(
      "UPDATE sales_period SET status = 'closed', open_flag = NULL, closed_by_user_name = 'Prueba', closed_by_at = now() WHERE open_flag = 1",
    );
    const none = await t.call("GET", "/periods/current", { token: mesero });
    expect([none.status, none.error.code]).toEqual([409, "PERIOD_CLOSED"]);
    expect((await t.call("POST", "/periods", { token: mesero, body: {} })).error).toMatchObject({
      code: "PERMISSION_REQUIRED",
      details: { permission: "funciones.periodo" },
    });
    const sessions = Number((await t.sql.query("SELECT count(*) n FROM app_session")).rows[0].n);
    const auth = await t.call("POST", "/sessions/authorize", {
      token: mesero,
      body: { pin: PIN.sistemas, permission: "funciones.periodo" },
    });
    expect(auth.status).toBe(201);
    expect(Number((await t.sql.query("SELECT count(*) n FROM app_session")).rows[0].n)).toBe(sessions); // no crea ni sustituye sesiones
    const open = await t.call("POST", "/periods", {
      token: mesero,
      body: { authorization: auth.body.authorization.token },
    });
    expect(open.status).toBe(201);
    expect(open.body.openedBy.device).toBe("PDA1");
    expect((await t.call("GET", "/sessions/current", { token: encargado })).status).toBe(200);
    expect((await t.call("GET", "/periods/current", { token: encargado })).body.id).toBe(open.body.id);
  });
});

describe("arqueo sin cierre (POST /cash/counts)", () => {
  it("lo contado frente a lo esperado; queda como movimiento «count» con el detalle; misma Idempotency-Key → un solo arqueo", async () => {
    const sis2 = await t.login(PIN.sistemas, "CAJA1");
    const sum = (await t.call("GET", "/cash/summary", { token: sis2 })).body;
    const h = { "idempotency-key": crypto.randomUUID() };
    const counted = Math.round((sum.expectedCash - 0.92) * 100) / 100;
    const cents = Math.round(counted * 100);
    const detail: Record<string, number> = { "50": Math.floor(cents / 5000), "0,01": cents % 5000 }; // con coma también vale
    const body = { countedCash: counted, detail, note: "Arqueo de media tarde" };
    const r = await t.call("POST", "/cash/counts", { token: sis2, body, headers: h });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      countedCash: body.countedCash,
      expectedCash: sum.expectedCash,
      difference: -0.92,
      by: { user: "Sistemas", device: "CAJA1" },
    });
    expect(Date.parse(r.body.at)).not.toBeNaN();
    const again = await t.call("POST", "/cash/counts", { token: sis2, body, headers: h });
    expect([again.status, again.body.id, again.headers["idempotent-replayed"]]).toEqual([
      201,
      r.body.id,
      "true",
    ]);
    const { rows } = await t.sql.query(
      "SELECT kind, amount, counted_detail, note FROM cash_movement WHERE id = $1",
      [r.body.id],
    );
    expect(rows).toEqual([
      {
        kind: "count",
        amount: body.countedCash.toFixed(2),
        counted_detail: body.detail,
        note: "Arqueo de media tarde",
      },
    ]);
    expect(
      (
        await t.sql.query(
          "SELECT count(*)::int n FROM cash_movement WHERE kind = 'count' AND note = 'Arqueo de media tarde'",
        )
      ).rows[0].n,
    ).toBe(1);
    // el arqueo no cambia lo esperado
    expect((await t.call("GET", "/cash/summary", { token: sis2 })).body.expectedCash).toBe(sum.expectedCash);
  });
  it("1.2.281 · print:false guarda sin imprimir y el corte sale en los movimientos", async () => {
    const sis2 = await t.login(PIN.sistemas, "CAJA1");
    const r = await t.call("POST", "/cash/counts", { token: sis2, body: { countedCash: 12.34, type: "cortex", print: false, tipsConfirmed: true, note: "Prueba de corte sin imprimir" } });
    expect(r.status).toBe(201);
    expect(r.body.printed).toBeFalsy(); // no se imprime
    const ids = ((await t.call("GET", "/cash/movements?scope=ops", { token: sis2 })).body.items as any[]).map((m) => m.id);
    expect(ids).toContain(r.body.id);
  });
  it("1.2.282 · DELETE /cash/petty/{id}: anula un apunte (no se borra), el saldo se recalcula y no se deja si quedara en negativo", async () => {
    const sis2 = await t.login(PIN.sistemas, "CAJA1");
    const get = async () => (await t.call("GET", "/cash/petty", { token: sis2 })).body;
    const mv = async (body: any) => (await t.call("POST", "/cash/petty", { token: sis2, body, headers: { "idempotency-key": crypto.randomUUID() } })).body.id as string;
    const del = (id: string) => t.call("DELETE", `/cash/petty/${id}`, { token: sis2 });
    const b0 = (await get()).balance as number;
    const dep = await mv({ kind: "deposit", amount: 7.5 });
    const exp = await mv({ kind: "expense", amount: 2.5, reason: "Hielo (prueba 282)" });
    const d1 = await del(exp);
    expect([d1.status, d1.body.voided, d1.body.balance, d1.body.by]).toEqual([200, true, Math.round((b0 + 7.5) * 100) / 100, "Sistemas"]);
    const after = await get();
    expect(after.balance).toBe(Math.round((b0 + 7.5) * 100) / 100);
    expect((after.items as any[]).some((x) => x.id === exp)).toBe(false);
    expect((after.items as any[]).find((x) => x.id === dep).balanceAfter).toBe(Math.round((b0 + 7.5) * 100) / 100);
    const row = (await t.sql.query("SELECT voided_at IS NOT NULL AS v, voided_by_name FROM petty_cash_movement WHERE id = $1", [exp])).rows[0];
    expect(row).toEqual({ v: true, voided_by_name: "Sistemas" });
    expect([(await del(exp)).status]).toEqual([404]);
    // un ingreso que ya se gastó no se puede quitar
    const all = await mv({ kind: "expense", amount: Math.round((b0 + 7.5) * 100) / 100, reason: "Todo (prueba 282)" });
    const neg = await del(dep);
    expect([neg.status, neg.error.code, neg.error.details.balance]).toEqual([422, "VALIDATION", -7.5]);
    expect((await del(all)).status).toBe(200);
    expect((await del(dep)).status).toBe(200);
    expect((await get()).balance).toBe(b0);
  });
  it("422 con datos malos; el Mesero necesita encargado; fuera de la caja principal 403", async () => {
    const sis2 = await t.login(PIN.sistemas, "CAJA1");
    expect((await t.call("POST", "/cash/counts", { token: sis2, body: { countedCash: -1 } })).status).toBe(
      422,
    );
    expect((await t.call("POST", "/cash/counts", { token: sis2, body: {} })).error.field).toBe("countedCash");
    expect(
      (await t.call("POST", "/cash/counts", { token: sis2, body: { countedCash: 1, note: "x".repeat(201) } }))
        .status,
    ).toBe(422);
    const bad = await t.call("POST", "/cash/counts", {
      token: sis2,
      body: { countedCash: 158.92, detail: { "20": 7, "2": 9 } },
    });
    expect([bad.status, bad.error.code, bad.error.field, bad.error.message]).toEqual([
      422,
      "VALIDATION",
      "detail",
      "El desglose suma 158,00 €, no 158,92 €",
    ]);
    expect(
      (
        await t.call("POST", "/cash/counts", {
          token: sis2,
          body: { countedCash: 158.5, detail: { "20": 7, "2": 9, "0,50": 1 } },
        })
      ).status,
    ).toBe(201);
    const mesero = await t.login(PIN.mesero, "CAJA1");
    expect(
      (await t.call("POST", "/cash/counts", { token: mesero, body: { countedCash: 1 } })).error,
    ).toMatchObject({ code: "PERMISSION_REQUIRED", details: { permission: "funciones.caja" } });
    const enCaja2 = await t.login(PIN.jeison, "CAJA2");
    const r = await t.call("POST", "/cash/counts", { token: enCaja2, body: { countedCash: 1 } });
    expect([r.status, r.error.code]).toEqual([403, "MAIN_STATION_REQUIRED"]);
  });
});
