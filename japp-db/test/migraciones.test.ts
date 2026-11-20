import { inject } from "vitest";
// @ts-ignore
import { migrate, migrationFiles } from "../scripts/db.mjs";
import { connect, one, all, rollback, uuid, n } from "./db.js";

let c: Awaited<ReturnType<typeof connect>>;
beforeAll(async () => { c = await connect(inject("dbUrl")); });
afterAll(async () => { await c.end(); });

describe("migraciones", () => {
  it("todas las de migrations/ están aplicadas con su checksum", async () => {
    const files = migrationFiles();
    expect(files.length).toBeGreaterThanOrEqual(1);
    const rows = await all(c, "SELECT version, checksum FROM schema_migrations ORDER BY version");
    expect(rows).toEqual(files.map((f: any) => ({ version: f.version, checksum: f.checksum })));
  });
  it("volver a migrar no hace nada", async () => { expect(await migrate(c)).toEqual([]); });
  it("si una migración aplicada se edita, se niega", () => rollback(c, async () => {
    await c.query("UPDATE schema_migrations SET checksum = repeat('0', 64) WHERE version = '0001'");
    await c.query("SAVEPOINT s");
    await expect(migrate(c)).rejects.toThrow(/ha cambiado/);
    await c.query("ROLLBACK TO SAVEPOINT s");
  }));
  it("0001: la misma Idempotency-Key no se guarda dos veces en una tienda", () => rollback(c, async () => {
    const store = (await one(c, "SELECT id FROM store")).id;
    const ins = `INSERT INTO idempotency_key (store_id, key, method, path, request_hash, status_code, response) VALUES ($1,$2,'POST','/x',repeat('a',64),201,'{}')`;
    const k = uuid();
    await c.query(ins, [store, k]);
    await c.query("SAVEPOINT s");
    await expect(c.query(ins, [store, k])).rejects.toMatchObject({ code: "23505" });
    await c.query("ROLLBACK TO SAVEPOINT s");
  }));
  it("0002: bloqueo por usuario opcional (NULL = el de la tienda), entre 0 y 3600 s", () => rollback(c, async () => {
    const u = await one(c, "SELECT id, lock_seconds FROM app_user WHERE name='Mesero'");
    expect(u.lock_seconds).toBeNull();
    await c.query("UPDATE app_user SET lock_seconds=15 WHERE id=$1", [u.id]);
    await c.query("UPDATE app_user SET lock_seconds=0 WHERE id=$1", [u.id]);
    await c.query("SAVEPOINT s");
    await expect(c.query("UPDATE app_user SET lock_seconds=-1 WHERE id=$1", [u.id])).rejects.toMatchObject({ code: "23514" });
    await c.query("ROLLBACK TO SAVEPOINT s");
    const p = await one(c, "SELECT lock_seconds, lock_seconds_pda FROM store_parameters");
    expect([p.lock_seconds, p.lock_seconds_pda]).toEqual([10, 10]); // 0027: 7 s → 10 s (regla 0 o 10–3600);
  }));
  it("0003: orden de las líneas en la cuenta (sort_order ≥ 0, por defecto 0)", () => rollback(c, async () => {
    const col = await one(c, "SELECT data_type, column_default, is_nullable FROM information_schema.columns WHERE table_name='order_line' AND column_name='sort_order'");
    expect([col.data_type, col.column_default, col.is_nullable]).toEqual(["integer", "0", "NO"]);
    const ck = await one(c, "SELECT pg_get_constraintdef(oid) def FROM pg_constraint WHERE conname='ck_order_line_sort_order'");
    expect(ck.def).toBe("CHECK ((sort_order >= 0))");
  }));
  it("0004: pases del menú (question.course 0–9, order_line.courses, order_line_modifier.course)", () => rollback(c, async () => {
    const q = await all(c, "SELECT name, course FROM question WHERE course IS NOT NULL ORDER BY course, name");
    expect(q.map((x: any) => x.course)).toEqual(expect.arrayContaining([0, 1, 2]));
    expect(q.find((x: any) => /Primero Menu del dia \(ciclo 1\)/.test(x.name))?.course).toBe(1);
    expect(q.find((x: any) => /Segundo Menu del dia \(ciclo 1\)/.test(x.name))?.course).toBe(2);
    expect(q.find((x: any) => /Bebida Menu Dia/.test(x.name))?.course).toBe(0);
    const id = (await one(c, "SELECT id FROM question LIMIT 1")).id;
    await c.query("SAVEPOINT s");
    await expect(c.query("UPDATE question SET course=10 WHERE id=$1", [id])).rejects.toMatchObject({ code: "23514" });
    await c.query("ROLLBACK TO SAVEPOINT s");
    const cols = await all(c, "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE (table_name, column_name) IN (('order_line','courses'),('order_line_modifier','course')) ORDER BY table_name");
    expect(cols.map((x: any) => x.data_type)).toEqual(["jsonb", "smallint"]);
  }));
  it("0005: versión por registro en Ajustes y versión global de configuración", () => rollback(c, async () => {
    const t = await all(c, `SELECT table_name FROM information_schema.columns WHERE column_name='version' AND table_schema='public' ORDER BY 1`);
    expect(t.map((x: any) => x.table_name)).toEqual(expect.arrayContaining(["app_user", "area", "category", "product", "question", "station", "printer", "store_parameters", "orders"]));
    const st = await one(c, "SELECT config_version FROM store");
    expect(n(st.config_version)).toBe(1);
    const p = await one(c, "SELECT id, version FROM product LIMIT 1");
    expect(p.version).toBe(1);
  }));
  it("0005: no se repite un número de mesa (línea base) ni un área activa con el mismo nombre", () => rollback(c, async () => {
    const m = await one(c, "SELECT store_id, area_id, number FROM dining_table WHERE active LIMIT 1");
    await c.query("SAVEPOINT s");
    await expect(c.query("INSERT INTO dining_table (id, store_id, area_id, number, capacity) VALUES ($1,$2,$3,$4,4)", [uuid(), m.store_id, m.area_id, m.number])).rejects.toMatchObject({ code: "23505" });
    await c.query("ROLLBACK TO SAVEPOINT s");
    const a = await one(c, "SELECT store_id, name, price_list FROM area WHERE active LIMIT 1");
    await c.query("SAVEPOINT s2");
    await expect(c.query("INSERT INTO area (id, store_id, name, sort_order, price_list, table_number_from) VALUES ($1,$2,lower($3),9,$4,900)", [uuid(), a.store_id, a.name, a.price_list])).rejects.toMatchObject({ code: "23505" });
    await c.query("ROLLBACK TO SAVEPOINT s2");
  }));
  it("0005: cola hacia el Manager con event_id único y apartados", () => rollback(c, async () => {
    const store = (await one(c, "SELECT id FROM store")).id;
    const r = await one(c, "INSERT INTO sync_outbox (store_id, entity, entity_id, payload) VALUES ($1,'invoice',$2,'{}') RETURNING event_id, parked_at", [store, uuid()]);
    expect(r.event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.parked_at).toBeNull();
    await c.query("SAVEPOINT s");
    await expect(c.query("INSERT INTO sync_outbox (store_id, entity, entity_id, payload, event_id) VALUES ($1,'invoice',$2,'{}',$3)", [store, uuid(), r.event_id])).rejects.toMatchObject({ code: "23505" });
    await c.query("ROLLBACK TO SAVEPOINT s");
    const ix = await one(c, "SELECT pg_get_indexdef('ix_sync_outbox_pending'::regclass) d");
    expect(ix.d).toMatch(/WHERE \(\(sent_at IS NULL\) AND \(parked_at IS NULL\)\)/);
    await c.query("INSERT INTO sync_state (store_id, last_error) VALUES ($1, 'sin red')", [store]);
    await c.query("SAVEPOINT s3");
    await expect(c.query("INSERT INTO sync_state (store_id) VALUES ($1)", [store])).rejects.toMatchObject({ code: "23505" });
    await c.query("ROLLBACK TO SAVEPOINT s3");
  }));
  it("0005: un resumen por periodo, objetivo por año/semana y carta programada por versión", () => rollback(c, async () => {
    const store = (await one(c, "SELECT id FROM store")).id;
    const per = uuid();
    await c.query("INSERT INTO sales_period (id, store_id, status, opened_by_user_name, opened_by_at) VALUES ($1,$2,'closed','Sistemas',now())", [per, store]);
    const ins = "INSERT INTO period_summary (id, store_id, period_id, business_date, opened_at, closed_at, gross_sales, tax_base, tax_total, tickets, guests) VALUES ($1,$2,$3,current_date,now(),now(),100,90.91,9.09,4,7)";
    await c.query(ins, [uuid(), store, per]);
    await c.query("SAVEPOINT s");
    await expect(c.query(ins, [uuid(), store, per])).rejects.toMatchObject({ code: "23505" });
    await c.query("ROLLBACK TO SAVEPOINT s");
    await c.query("INSERT INTO sales_target (id, store_id, year, growth_pct) VALUES ($1,$2,2026,5)", [uuid(), store]);
    await c.query("SAVEPOINT s2");
    await expect(c.query("INSERT INTO sales_target (id, store_id, year, week, growth_pct) VALUES ($1,$2,2026,54,5)", [uuid(), store])).rejects.toMatchObject({ code: "23514" });
    await c.query("ROLLBACK TO SAVEPOINT s2");
    const rel = "INSERT INTO catalog_release (id, store_id, kind, release_version, effective_at, payload, checksum) VALUES ($1,$2,$3,7,now(),'{}',repeat('a',64))";
    await c.query(rel, [uuid(), store, "prices"]);
    await c.query("SAVEPOINT s3");
    await expect(c.query(rel, [uuid(), store, "prices"])).rejects.toMatchObject({ code: "23505" });
    await c.query("ROLLBACK TO SAVEPOINT s3");
    await c.query("SAVEPOINT s4");
    await expect(c.query("INSERT INTO catalog_release (id, store_id, kind, release_version, effective_at, payload, checksum) VALUES ($1,$2,'menu',8,now(),'{}',repeat('a',64))", [uuid(), store])).rejects.toMatchObject({ code: "23514" });
    await c.query("ROLLBACK TO SAVEPOINT s4");
  }));
  it("0005: permisos del Gestor de cierres y de Sincronización para quien tenía historial / API", async () => {
    const r = await all(c, `SELECT p.code, count(*) FILTER (WHERE pp.permission_code='ajustes.cierres') cierres, count(*) FILTER (WHERE pp.permission_code='ajustes.historial') hist,
      count(*) FILTER (WHERE pp.permission_code='ajustes.devsync') sync, count(*) FILTER (WHERE pp.permission_code='ajustes.devapi') api
      FROM user_profile p LEFT JOIN profile_permission pp ON pp.profile_id=p.id GROUP BY p.code`);
    for (const x of r) { expect(n(x.cierres)).toBe(n(x.hist)); expect(n(x.sync)).toBe(n(x.api)); }
  });
  it("0006: canales por tipo, impresora por defecto, copias y canal de tickets por área", () => rollback(c, async () => {
    const ch = await all(c, "SELECT name, kind, printer_id FROM print_channel ORDER BY name");
    expect(ch.find((x: any) => x.name === "TICKET")).toMatchObject({ kind: "ticket" });
    expect(ch.find((x: any) => x.name === "TICKET").printer_id).toBeTruthy();
    expect(ch.filter((x: any) => x.kind === "kitchen").every((x: any) => x.printer_id)).toBe(true);
    const areas = await all(c, "SELECT a.name, c.kind FROM area a JOIN print_channel c ON c.id = a.ticket_channel_id");
    expect(areas.length).toBeGreaterThan(0);
    expect(areas.every((x: any) => x.kind === "ticket")).toBe(true);
    const k = await one(c, "SELECT id, store_id FROM print_channel WHERE kind='kitchen' LIMIT 1");
    await c.query("SAVEPOINT s");
    await expect(c.query("UPDATE print_channel SET kind='comanda' WHERE id=$1", [k.id])).rejects.toMatchObject({ code: "23514" });
    await c.query("ROLLBACK TO SAVEPOINT s");
    await c.query("SAVEPOINT s2");
    await expect(c.query("UPDATE print_channel SET copy_of_id=id WHERE id=$1", [k.id])).rejects.toMatchObject({ code: "23514" });
    await c.query("ROLLBACK TO SAVEPOINT s2");
    // 0035: ya no hay copias (solo COMIDA y BEBIDA)
    await c.query("SAVEPOINT s3");
    await expect(c.query("INSERT INTO print_channel (id, store_id, name, kind, copy_of_id) VALUES ($1,$2,'COPIA PRUEBA','kitchen',$3)", [uuid(), k.store_id, k.id])).rejects.toMatchObject({ code: "23514" });
    await c.query("ROLLBACK TO SAVEPOINT s3");
  }));
  it("0007: etapa de la eliminación (sin enviar, impresa o en precuenta)", () => rollback(c, async () => {
    const col = await one(c, "SELECT data_type FROM information_schema.columns WHERE table_name='order_line' AND column_name='deleted_stage'");
    expect(col.data_type).toBe("character varying");
    const ck = await one(c, "SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='ck_order_line_deleted_stage'");
    expect(ck.d).toMatch(/pendingPrint.*printed.*preBill/);
  }));
  it("0008: una sola caja principal y el Cajero solo entra en ella", () => rollback(c, async () => {
    const main = await all(c, "SELECT name FROM station WHERE is_main");
    expect(main.map(r => r.name)).toEqual(["CAJA1"]);
    expect((await one(c, "SELECT allowed_stations FROM user_profile WHERE code='CAJERO'")).allowed_stations).toBe("main");
    expect((await one(c, "SELECT allowed_stations FROM user_profile WHERE code='MESERO'")).allowed_stations).toBe("any");
    await expect(c.query("UPDATE station SET is_main = true WHERE name='PDA1'")).rejects.toMatchObject({ code: "23505" });
  }));
  it("0008: mesas.entrarOcupada solo en los perfiles de administrador", async () => {
    const r = await all(c, "SELECT p.code FROM profile_permission pp JOIN user_profile p ON p.id=pp.profile_id WHERE pp.permission_code='mesas.entrarOcupada' ORDER BY 1");
    expect(r.map(x => x.code)).toEqual(["ADMIN", "ADMIN_LOCAL"]);
  });
  it("0008: las ventas no se borran en cascada", async () => {
    const r = await one(c, `SELECT count(*) FROM pg_constraint WHERE contype='f' AND confdeltype='c'
      AND conrelid::regclass::text IN ('account','order_event','order_line','order_line_modifier','order_line_printer','account_discount','payment','payment_cash_detail','payment_bank_data','invoice_tax')`);
    expect(n(r.count)).toBe(0);
  });
  it("0008: forma de pago con código libre (glovo) y CHECK de formato", () => rollback(c, async () => {
    const ck = await one(c, "SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='ck_payment_method_code'");
    expect(ck.d).toMatch(/a-z0-9_-/);
    expect(await one(c, "SELECT 1 FROM pg_constraint WHERE conname='payment_method_check'")).toBeUndefined();
  }));
  it("0008: una orden abierta por mesa, una factura por cuenta y cadena VeriFactu sin ramas", async () => {
    const ix = (await all(c, "SELECT indexname FROM pg_indexes WHERE indexname IN ('uq_orders_open_table','uq_invoice_account_issued','uq_verifactu_previous','uq_verifactu_genesis') ORDER BY 1")).map(r => r.indexname);
    expect(ix).toEqual(["uq_invoice_account_issued", "uq_orders_open_table", "uq_verifactu_genesis", "uq_verifactu_previous"]);
  });
  it("0008: la serie de Facturación tiene que existir en invoice_series", () => rollback(c, async () => {
    await expect(c.query("UPDATE billing_settings SET series_simplified='NOEXISTE'")).rejects.toMatchObject({ code: "23503" });
  }));
  it("0008: periodo cerrado con marca de abierto → rechazado", () => rollback(c, async () => {
    const st = (await one(c, "SELECT id FROM store")).id;
    await expect(c.query(`INSERT INTO sales_period (id, store_id, status, open_flag, opened_by_user_name, opened_by_at) VALUES ($1,$2,'closed',1,'x',now())`, [uuid(), st])).rejects.toMatchObject({ code: "23514" });
  }));
  it("0009: una sesión vigente por usuario; al sustituirla queda con motivo y quién la sustituyó", () => rollback(c, async () => {
    const u = await one(c, "SELECT id, store_id FROM app_user WHERE name='Mesero'");
    const st = await one(c, "SELECT id, name FROM station WHERE name='CAJA1'");
    const ins = `INSERT INTO app_session (id, store_id, user_id, station_id, station_name, expires_at) VALUES ($1,$2,$3,$4,$5, now() + interval '12 hours')`;
    const a = uuid(), b = uuid();
    await c.query(ins, [a, u.store_id, u.id, st.id, st.name]);
    await c.query("SAVEPOINT s");
    await expect(c.query(ins, [b, u.store_id, u.id, st.id, st.name])).rejects.toMatchObject({ code: "23505" });
    await c.query("ROLLBACK TO SAVEPOINT s");
    // sustituir: primero se cierra la vigente apuntando a la nueva (FK diferida) y luego se inserta la nueva
    await c.query("UPDATE app_session SET ended_at = now(), ended_reason = 'replaced', replaced_by_id = $2 WHERE id = $1", [a, b]);
    await c.query(ins, [b, u.store_id, u.id, st.id, st.name]);
    expect((await all(c, "SELECT id FROM app_session WHERE user_id=$1 AND ended_at IS NULL", [u.id])).map(r => r.id)).toEqual([b]);
    await c.query("SAVEPOINT s2");
    await expect(c.query("UPDATE app_session SET ended_at = now() WHERE id = $1", [b])).rejects.toMatchObject({ code: "23514" });
    await c.query("ROLLBACK TO SAVEPOINT s2");
  }));
  it("0009: fallos de PIN por equipo, sin negativos y con updated_at", () => rollback(c, async () => {
    const st = (await one(c, "SELECT id FROM store")).id;
    await c.query("INSERT INTO pin_attempt (store_id, key, failures) VALUES ($1, 'device:abc', 1)", [st]);
    await c.query("INSERT INTO pin_attempt (store_id, key, failures) VALUES ($1, 'device:abc', 1) ON CONFLICT (store_id, key) DO UPDATE SET failures = pin_attempt.failures + 1", [st]);
    expect(n((await one(c, "SELECT failures FROM pin_attempt WHERE key='device:abc'")).failures)).toBe(2);
    await c.query("SAVEPOINT s");
    await expect(c.query("UPDATE pin_attempt SET failures = -1 WHERE key='device:abc'")).rejects.toMatchObject({ code: "23514" });
    await c.query("ROLLBACK TO SAVEPOINT s");
  }));
  it("0023: marca del sistema, una fila por tienda; nombre obligatorio, imágenes como data URL y paleta con 1–12 colores", () => rollback(c, async () => {
    const st = (await one(c, "SELECT id FROM store")).id;
    await c.query("INSERT INTO system_branding (store_id) VALUES ($1)", [st]);
    const r = await one(c, "SELECT name, palette, colors, version FROM system_branding WHERE store_id=$1", [st]);
    expect([r.name, r.palette, r.colors, r.version]).toEqual(["Japp", [{ hex: "#15616D", name: "Verde", default: true }], {}, 1]);
    for (const bad of ["UPDATE system_branding SET name='  '", "UPDATE system_branding SET logo='http://x/logo.png'", "UPDATE system_branding SET palette='[]'", "UPDATE system_branding SET colors='[]'"]) {
      await c.query("SAVEPOINT s");
      await expect(c.query(bad)).rejects.toMatchObject({ code: "23514" });
      await c.query("ROLLBACK TO SAVEPOINT s");
    }
    await c.query("UPDATE system_branding SET logo='data:image/png;base64,AAAA', updated_by='Sistemas'");
  }));
  it("0024: una observación por día de negocio y tienda; period_summary.by_product es una lista", () => rollback(c, async () => {
    const st = (await one(c, "SELECT id FROM store")).id;
    const ins = "INSERT INTO week_note (id, store_id, business_date, note) VALUES ($1,$2,'2026-11-02',$3)";
    await c.query(ins, [uuid(), st, "Lluvia toda la tarde"]);
    await c.query("SAVEPOINT s");
    await expect(c.query(ins, [uuid(), st, "Otra"])).rejects.toMatchObject({ code: "23505" });
    await c.query("ROLLBACK TO SAVEPOINT s");
    await expect(c.query("UPDATE week_note SET note=' '")).rejects.toMatchObject({ code: "23514" });
    await c.query("ROLLBACK");
    const col = await one(c, "SELECT column_default, is_nullable FROM information_schema.columns WHERE table_name='period_summary' AND column_name='by_product'");
    expect([col.column_default, col.is_nullable]).toEqual(["'[]'::jsonb", "NO"]);
    await c.query("BEGIN");
  }));
  it("0025: delivery — ajustes por tienda (rojo después del ámbar), motorizados sin repetir y pedidos con estados válidos", () => rollback(c, async () => {
    const st = (await one(c, "SELECT id FROM store")).id;
    await c.query("INSERT INTO delivery_settings (store_id) VALUES ($1)", [st]);
    const s = await one(c, "SELECT active, ask_rider, amber_minutes, red_minutes, jsonb_array_length(platforms) n FROM delivery_settings");
    expect([s.active, s.ask_rider, s.amber_minutes, s.red_minutes, s.n]).toEqual([true, true, 15, 30, 4]);
    await c.query("SAVEPOINT s");
    await expect(c.query("UPDATE delivery_settings SET red_minutes=15")).rejects.toMatchObject({ code: "23514" });
    await c.query("ROLLBACK TO SAVEPOINT s");
    const r1 = uuid();
    await c.query("INSERT INTO delivery_rider (id, store_id, name) VALUES ($1,$2,'Carlos M.')", [r1, st]);
    await c.query("SAVEPOINT s2");
    await expect(c.query("INSERT INTO delivery_rider (id, store_id, name) VALUES ($1,$2,' carlos m. ')", [uuid(), st])).rejects.toMatchObject({ code: "23505" });
    await c.query("ROLLBACK TO SAVEPOINT s2");
    const o = uuid();
    await c.query(`INSERT INTO delivery_order (id, store_id, platform, code, external_id, customer_name, total) VALUES ($1,$2,'glovo','GLV-4821','g-1','Marta R.',30.30)`, [o, st]);
    await c.query("INSERT INTO delivery_order_line (id, store_id, delivery_order_id, line_no, name, quantity, unit_price) VALUES ($1,$2,$3,1,'Patatas bravas',2,5.5)", [uuid(), st, o]);
    await c.query("INSERT INTO delivery_order_event (id, store_id, delivery_order_id, status, by_name) VALUES ($1,$2,$3,'pending','Integración')", [uuid(), st, o]);
    for (const [sql, code] of [
      ["INSERT INTO delivery_order (id, store_id, platform, code, external_id, customer_name) VALUES ('" + uuid() + "','" + st + "','glovo','GLV-0000','g-1','Otro')", "23505"],
      ["UPDATE delivery_order SET status='camino'", "23514"],
      ["UPDATE delivery_order SET status='assigned'", "23514"],
      ["UPDATE delivery_order SET status='delivered', rider_name='Carlos M.'", "23514"],
    ] as const) {
      await c.query("SAVEPOINT s3");
      await expect(c.query(sql)).rejects.toMatchObject({ code });
      await c.query("ROLLBACK TO SAVEPOINT s3");
    }
    await c.query("UPDATE delivery_order SET status='assigned', rider_id=$1, rider_name='Carlos M.'", [r1]);
    await c.query("UPDATE delivery_order SET status='delivered', finished_at=now()");
    const perms = (await all(c, "SELECT code FROM permission WHERE code IN ('ajustes.pedidos','funciones.pedidos') ORDER BY 1")).map(r => r.code);
    expect(perms).toEqual(["ajustes.pedidos", "funciones.pedidos"]);
    // 0030 (04/11): el tablero de pedidos ya solo lo tienen cajero y encargado
    const sinTablero = (await all(c, "SELECT p.code FROM user_profile p WHERE NOT EXISTS (SELECT 1 FROM profile_permission x WHERE x.profile_id=p.id AND x.permission_code='funciones.pedidos') ORDER BY 1")).map(r => r.code);
    expect(sinTablero).toEqual(["MESERO"]);
  }));
  it("0026: no hay dos personas con el mismo nombre aunque cambien mayúsculas o espacios; búsqueda de clientes por correo", () => rollback(c, async () => {
    const u = await one(c, "SELECT store_id, profile_id FROM app_user WHERE name='Mesero'");
    await expect(c.query("INSERT INTO app_user (id, store_id, name, profile_id, pin_hash) VALUES ($1,$2,' mesero ',$3,'x')", [uuid(), u.store_id, u.profile_id])).rejects.toMatchObject({ code: "23505" });
    await c.query("ROLLBACK");
    expect(await one(c, "SELECT 1 x FROM pg_indexes WHERE indexname='ix_customer_ref_store_id_email'")).toEqual({ x: 1 });
    await c.query("BEGIN");
  }));
  it("0027: print_tip en store_parameters (por defecto true; solo impresión) y bloqueo de 7 s → 10 s", () => rollback(c, async () => {
    const r = await one(c, "SELECT print_tip FROM store_parameters LIMIT 1");
    expect(r.print_tip).toBe(true);
    // el bloqueo de 7 s de los datos de arranque pasa a 10 (regla 0 o 10–3600 s)
    expect((await one(c, "SELECT lock_seconds FROM store_parameters LIMIT 1")).lock_seconds).toBe(10);
    await c.query("UPDATE store_parameters SET print_tip = false");
    expect((await one(c, "SELECT print_tip FROM store_parameters LIMIT 1")).print_tip).toBe(false);
  }));
  it("0029: ticket_formats en store_parameters (formatos de precuenta y factura; vacío = todo sale)", () => rollback(c, async () => {
    // 0033 · el corte X normal sale corto (ventas, formas de pago y propinas): el resto viene apagado
    expect(Object.keys((await one(c, "SELECT ticket_formats FROM store_parameters LIMIT 1")).ticket_formats)).toEqual(["cutx"]);
    await c.query(`UPDATE store_parameters SET ticket_formats = '{"invoice":{"mesero":false}}'::jsonb`);
    expect((await one(c, "SELECT ticket_formats->'invoice'->>'mesero' m FROM store_parameters LIMIT 1")).m).toBe("false");
  }));
  it("0030: cierre de facturación (tablero de delivery, estado de envío, límite de simplificada, F3, tipo de cuenta, propina, nota del cierre)", () => rollback(c, async () => {
    const tab = (await all(c, "SELECT p.code FROM user_profile p JOIN profile_permission x ON x.profile_id=p.id AND x.permission_code='funciones.pedidos' ORDER BY 1")).map(r => r.code);
    expect(tab).toEqual(["ADMIN", "ADMIN_LOCAL", "CAJERO", "CAPITAN"]);
    expect((await one(c, "SELECT simplified_limit FROM billing_settings LIMIT 1")).simplified_limit).toBe("3000.00");
    expect((await all(c, "SELECT DISTINCT allows_tip FROM payment_method WHERE kind <> 'discount'")).map(r => r.allows_tip)).toEqual([true]);
    expect((await one(c, "SELECT column_default d FROM information_schema.columns WHERE table_name='invoice' AND column_name='email_status'")).d).toMatch(/not_sent/);
    expect((await one(c, "SELECT column_default d FROM information_schema.columns WHERE table_name='account' AND column_name='kind'")).d).toMatch(/normal/);
    expect(await one(c, "SELECT 1 x FROM information_schema.columns WHERE table_name='cash_closing' AND column_name='note'")).toEqual({ x: 1 });
    expect(await one(c, "SELECT 1 x FROM information_schema.columns WHERE table_name='invoice' AND column_name='substituted_invoice_id'")).toEqual({ x: 1 });
  }));
  it("0032: notas de la mesa (jsonb, con la nota de antes), Historial › Developer solo al Administrador y un permiso por botón de Gestiones", () => rollback(c, async () => {
    expect((await one(c, "SELECT column_default FROM information_schema.columns WHERE table_name='orders' AND column_name='notes'")).column_default).toMatch(/\[\]/);
    const bad = await all(c, "SELECT id FROM orders WHERE coalesce(trim(note),'') <> '' AND jsonb_array_length(notes) = 0");
    expect(bad).toEqual([]);
    const dev = await all(c, "SELECT p.code FROM profile_permission pp JOIN user_profile p ON p.id = pp.profile_id WHERE pp.permission_code = 'pedido.historialDev'");
    expect(dev.map((r: any) => r.code)).toEqual(["ADMIN"]);
    for (const code of ["funciones.semana", "funciones.eliminaciones", "funciones.servicio", "funciones.sir"]) {
      expect((await one(c, "SELECT count(*)::int n FROM permission WHERE code=$1", [code])).n, code).toBe(1);
    }
    const of = async (profile: string) => (await all(c, `SELECT pp.permission_code c FROM profile_permission pp JOIN user_profile p ON p.id = pp.profile_id
      WHERE p.code=$1 AND pp.permission_code IN ('funciones.facturas','pedido.reconexiones','funciones.semana','funciones.eliminaciones','funciones.kpi',
      'funciones.servicio','funciones.sir','funciones.abrirCajon','mesas.moverMesas','funciones.caja','funciones.periodo') ORDER BY 1`, [profile])).map((r: any) => r.c);
    expect(await of("ADMIN")).toHaveLength(11);
    expect(await of("ADMIN_LOCAL")).not.toContain("funciones.sir");
    expect(await of("ADMIN_LOCAL")).toHaveLength(10);
    expect(await of("CAJERO")).toEqual(["funciones.abrirCajon", "funciones.caja", "funciones.facturas", "funciones.periodo", "funciones.servicio"]);
    expect(await of("MESERO")).toEqual([]);
  }));
  it("0033: descuentos por perfil, nombre del cliente, calificativos por categoría, mesa entera eliminada, semana pasada con permiso, datáfonos y corte X corto", () => rollback(c, async () => {
    const col = async (t: string, k: string) => (await one(c, "SELECT column_default d FROM information_schema.columns WHERE table_name=$1 AND column_name=$2", [t, k]))?.d ?? null;
    expect(await col("discount", "profiles")).toMatch(/\[\]/);
    expect(await col("category", "qualifiers")).toMatch(/\[\]/);
    expect(await one(c, "SELECT 1 x FROM information_schema.columns WHERE table_name='orders' AND column_name='customer_name'")).toEqual({ x: 1 });
    expect(await one(c, "SELECT 1 x FROM information_schema.columns WHERE table_name='orders' AND column_name='void_close'")).toEqual({ x: 1 });
    expect(await one(c, "SELECT 1 x FROM information_schema.columns WHERE table_name='cash_movement' AND column_name='card_detail'")).toEqual({ x: 1 });
    expect(await one(c, "SELECT 1 x FROM information_schema.columns WHERE table_name='cash_closing' AND column_name='card_detail'")).toEqual({ x: 1 });
    expect((await one(c, "SELECT card_terminals FROM store_parameters LIMIT 1")).card_terminals).toBe(1);
    await expect(c.query("UPDATE store_parameters SET card_terminals = 0")).rejects.toMatchObject({ code: "23514" });
    await c.query("ROLLBACK"); await c.query("BEGIN");
    const sinPerfil = await all(c, "SELECT name FROM discount WHERE needs_authorization AND profiles = '[]'::jsonb");
    expect(sinPerfil).toEqual([]);
    const sem = await all(c, "SELECT p.code FROM profile_permission pp JOIN user_profile p ON p.id = pp.profile_id WHERE pp.permission_code = 'funciones.semanaEditar' ORDER BY 1");
    expect(sem.map((r: any) => r.code)).toEqual(["ADMIN", "ADMIN_LOCAL"]);
    const cx = (await one(c, "SELECT ticket_formats->'cutx' f FROM store_parameters LIMIT 1")).f;
    expect(cx).toMatchObject({ iva: false, areas: false, camareros: false, caja: false });
    expect(cx.formasPago).toBeUndefined();
  }));
  it("0034: pantalla de cada equipo (automática o fija, ancho × alto y escala 70–150 %)", () => rollback(c, async () => {
    expect(await one(c, "SELECT DISTINCT screen_mode, ui_scale FROM station")).toEqual({ screen_mode: "auto", ui_scale: 100 });
    await c.query("UPDATE station SET screen_mode='fixed', screen_width=1920, screen_height=1080, ui_scale=120");
    await expect(c.query("UPDATE station SET ui_scale=200")).rejects.toMatchObject({ code: "23514" });
  }));
  it("0035: carta del Manager (traducciones, preguntas, cargas), solo COMIDA y BEBIDA, y cola de impresión", () => rollback(c, async () => {
    const col = async (t: string, k: string) => (await one(c, "SELECT column_default d FROM information_schema.columns WHERE table_name=$1 AND column_name=$2", [t, k]))?.d ?? null;
    for (const t of ["category", "product", "question", "question_answer"]) expect(await col(t, "translations")).toMatch(/'\{\}'/);
    expect(await col("question", "answer_type")).toMatch(/unica/);
    // las preguntas que ya había: obligatoria si piden alguna respuesta; múltiple si dejan más de una
    expect(await all(c, "SELECT 1 FROM question WHERE required <> (min_answers > 0) OR answer_type <> (CASE WHEN max_answers > 1 THEN 'multiple' ELSE 'unica' END)")).toEqual([]);
    await expect(c.query("UPDATE question SET answer_type='otra'")).rejects.toMatchObject({ code: "23514" });
    await c.query("ROLLBACK"); await c.query("BEGIN");
    // canales de comanda: solo COMIDA y BEBIDA en cada tienda
    const ch = await all(c, "SELECT store_id, array_agg(code ORDER BY code) codes FROM print_channel WHERE kind='kitchen' GROUP BY store_id");
    expect(ch.length).toBeGreaterThan(0);
    for (const r of ch) expect(r.codes).toEqual(["BEBIDA", "COMIDA"]);
    const k = await one(c, "SELECT id, store_id FROM print_channel WHERE code='COMIDA' LIMIT 1");
    await c.query("SAVEPOINT s");
    await expect(c.query("INSERT INTO print_channel (id, store_id, name, kind) VALUES ($1,$2,'POSTRES','kitchen')", [uuid(), k.store_id])).rejects.toMatchObject({ code: "23514" });
    await c.query("ROLLBACK TO SAVEPOINT s");
    const p = await one(c, "SELECT id FROM product WHERE store_id=$1 LIMIT 1", [k.store_id]);
    await c.query("DELETE FROM product_channel WHERE product_id=$1 AND channel_id=$2", [p.id, k.id]);
    await c.query("INSERT INTO product_channel (product_id, channel_id, store_id) VALUES ($1,$2,$3)", [p.id, k.id, k.store_id]);
    await c.query("SAVEPOINT s");
    await expect(c.query("INSERT INTO product_channel (product_id, channel_id, store_id) VALUES ($1,$2,$3)", [p.id, k.id, k.store_id])).rejects.toMatchObject({ code: "23505" });
    await c.query("ROLLBACK TO SAVEPOINT s");
    // cargas: publicación + versión + tienda, una vez
    const ins = "INSERT INTO catalog_release (id, store_id, kind, release_version, effective_at, payload, checksum, publication_id) VALUES ($1,$2,'full',3,now(),'{}',repeat('a',64),'pub_1')";
    await c.query(ins, [uuid(), k.store_id]);
    await c.query("SAVEPOINT s");
    await expect(c.query(ins, [uuid(), k.store_id])).rejects.toMatchObject({ code: "23505" });
    await c.query("ROLLBACK TO SAVEPOINT s");
    await c.query("INSERT INTO catalog_release (id, store_id, kind, release_version, effective_at, payload, checksum, publication_id, status) VALUES ($1,$2,'withdraw',4,now(),'{}',repeat('a',64),'pub_1','confirm')", [uuid(), k.store_id]);
    // cola de impresión
    await c.query("INSERT INTO print_job (id, store_id, kind, title, channel, printer_name, connection, job) VALUES ($1,$2,'kitchen','Mesa 1','COMIDA','LINEA','tcp://10.0.0.1','{}')", [uuid(), k.store_id]);
    expect((await one(c, "SELECT status, attempts FROM print_job LIMIT 1"))).toEqual({ status: "pending", attempts: 0 });
    await c.query("SAVEPOINT s");
    await expect(c.query("UPDATE print_job SET status='lost'")).rejects.toMatchObject({ code: "23514" });
    await c.query("ROLLBACK TO SAVEPOINT s");
  }));
  it("0037: conteos con tipo, lo esperado y propinas; caja chica con su fondo (50 €) y saldo nunca negativo", () => rollback(c, async () => {
    const col = async (t: string, k: string) => (await one(c, "SELECT data_type d FROM information_schema.columns WHERE table_name=$1 AND column_name=$2", [t, k]))?.d ?? null;
    for (const k of ["count_type", "expected_cash", "expected_card", "cash_tips", "card_tips", "tips_confirmed", "difference"]) expect(await col("cash_movement", k)).not.toBeNull();
    expect((await one(c, "SELECT petty_cash_limit::float8 l FROM store_parameters LIMIT 1")).l).toBe(50);
    const st = await one(c, "SELECT id FROM store LIMIT 1");
    await expect(c.query("INSERT INTO petty_cash_movement (id, store_id, kind, amount, reason, balance_after, by_user_name, by_at) VALUES (gen_random_uuid(), $1, 'expense', 10, 'x', -1, 'P', now())", [st.id])).rejects.toMatchObject({ code: "23514" });
    await c.query("ROLLBACK"); await c.query("BEGIN");
    await expect(c.query("INSERT INTO petty_cash_movement (id, store_id, kind, amount, reason, balance_after, by_user_name, by_at) VALUES (gen_random_uuid(), $1, 'otro', 10, 'x', 1, 'P', now())", [st.id])).rejects.toMatchObject({ code: "23514" });
    await c.query("ROLLBACK"); await c.query("BEGIN");
    const codes = (await all(c, "SELECT code FROM permission WHERE code IN ('funciones.arqueoAuditoria','funciones.cajaChica')")).length;
    expect(codes).toBe(2);
    const ck = await one(c, "SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname = 'ck_cash_movement_count_type'");
    expect(ck.d).toContain("auditoria");
  }));
  it("0038: sin la regla «un UUID, una estación» y sin UUID en las estaciones (los equipos van por IP)", () => rollback(c, async () => {
    expect(await one(c, "SELECT 1 x FROM pg_indexes WHERE indexname = 'uq_station_device_uuid'")).toBeFalsy();
    expect((await one(c, "SELECT count(*)::int n FROM station WHERE device_uuid IS NOT NULL")).n).toBe(0);
    const [a, b] = await all(c, "SELECT id FROM station LIMIT 2");
    const u = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await c.query("UPDATE station SET device_uuid = $1, active = TRUE WHERE id IN ($2, $3)", [u, a.id, b.id]); // ya no falla
    expect((await one(c, "SELECT count(*)::int n FROM station WHERE device_uuid = $1", [u])).n).toBe(2);
  }));
  it("0042: funcionalidades desactivadas para todo el sistema (Ajustes › Funcionalidades)", () => rollback(c, async () => {
    const col = await one(c, "SELECT data_type FROM information_schema.columns WHERE table_name = 'store_parameters' AND column_name = 'disabled_features'");
    expect(col?.data_type).toBe("jsonb");
    const p = await one(c, "SELECT store_id, disabled_features FROM store_parameters LIMIT 1");
    expect(p.disabled_features).toEqual([]);
    await c.query(`UPDATE store_parameters SET disabled_features = '["transferir","eliminaciones"]'::jsonb WHERE store_id = $1`, [p.store_id]);
    await c.query("SAVEPOINT s"); let bad = false;
    try{ await c.query(`UPDATE store_parameters SET disabled_features = '{"a":1}'::jsonb WHERE store_id = $1`, [p.store_id]); }catch(e){ bad = true; }
    await c.query("ROLLBACK TO SAVEPOINT s"); expect(bad).toBe(true);
  }));
  it("0041: formulario de los descuentos y permisos de orden de impresión, mi venta y Sistema en el corte X", () => rollback(c, async () => {
    const col = await one(c, "SELECT data_type, column_default FROM information_schema.columns WHERE table_name = 'discount' AND column_name = 'form'");
    expect(col?.data_type).toBe("jsonb");
    const d = await one(c, "SELECT id, form FROM discount LIMIT 1");
    if (d) {
      expect(d.form).toEqual([]);
      await c.query(`UPDATE discount SET form = '[{"label":"DNI","type":"text","req":true}]'::jsonb WHERE id = $1`, [d.id]);
      await c.query("SAVEPOINT s"); let bad = false;
      try{ await c.query(`UPDATE discount SET form = '{"a":1}'::jsonb WHERE id = $1`, [d.id]); }catch(e){ bad = true; }
      await c.query("ROLLBACK TO SAVEPOINT s"); expect(bad).toBe(true);
    }
    const codes = (await all(c, "SELECT code FROM permission WHERE code IN ('pedido.ordenImpresion','funciones.miVenta','funciones.corteVerSistema') ORDER BY code")).map((r: any) => r.code);
    expect(codes).toEqual(["funciones.corteVerSistema", "funciones.miVenta", "pedido.ordenImpresion"]);
    const env = (await one(c, "SELECT count(*)::int n FROM profile_permission WHERE permission_code = 'pedido.enviar'")).n;
    expect((await one(c, "SELECT count(*)::int n FROM profile_permission WHERE permission_code = 'pedido.ordenImpresion'")).n).toBeGreaterThanOrEqual(env);
    expect((await one(c, "SELECT count(*)::int n FROM profile_permission WHERE permission_code = 'funciones.corteVerSistema'")).n).toBe(0);
  }));
  it("0040: apuntes de caja chica anulables e imagen del botón de cada forma de pago", () => rollback(c, async () => {
    const cols = (await all(c, "SELECT table_name || '.' || column_name AS k FROM information_schema.columns WHERE (table_name = 'petty_cash_movement' AND column_name LIKE 'voided%') OR (table_name = 'payment_method' AND column_name = 'image') ORDER BY 1")).map((r: any) => r.k);
    expect(cols).toEqual(["payment_method.image", "petty_cash_movement.voided_at", "petty_cash_movement.voided_by_name"]);
    const pm = await one(c, "SELECT id FROM payment_method LIMIT 1");
    await c.query("UPDATE payment_method SET image = 'data:image/png;base64,AAAA' WHERE id = $1", [pm.id]);
    await c.query("SAVEPOINT s"); let bad = false;
    try{ await c.query("UPDATE payment_method SET image = 'hola' WHERE id = $1", [pm.id]); }catch(e){ bad = true; }
    await c.query("ROLLBACK TO SAVEPOINT s"); expect(bad).toBe(true);
  }));
  it("0039: caja chica con ingresos y foto; cortes anulables (cash_movement.voided_at, voided_by_name)", () => rollback(c, async () => {
    const ck = await one(c, "SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname = 'petty_cash_movement_kind_check'");
    expect(ck?.d ?? "").toContain("deposit");
    const cols = (await all(c, "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'cash_movement' AND column_name LIKE 'voided%' ORDER BY 1")).map((r: any) => `${r.column_name}:${r.data_type}`);
    expect(cols).toEqual(["voided_at:timestamp with time zone", "voided_by_name:character varying"]);
    expect((await one(c, "SELECT count(*)::int n FROM cash_movement WHERE voided_at IS NOT NULL")).n).toBe(0);
  }));
  it("0036: última conexión del equipo (station.last_seen_at, vacía hasta que se identifica)", () => rollback(c, async () => {
    const r = await one(c, "SELECT data_type FROM information_schema.columns WHERE table_name='station' AND column_name='last_seen_at'");
    expect(r?.data_type).toBe("timestamp with time zone");
    const st = await one(c, "SELECT id FROM station LIMIT 1");
    await c.query("UPDATE station SET last_seen_at = now() WHERE id = $1", [st.id]);
    expect((await one(c, "SELECT last_seen_at IS NOT NULL ok FROM station WHERE id = $1", [st.id])).ok).toBe(true);
  }));
  it("0031: ticket_logo en store_parameters (vacío = logo de la cadena)", () => rollback(c, async () => {
    expect((await one(c, "SELECT ticket_logo FROM store_parameters LIMIT 1")).ticket_logo).toBeNull();
  }));
  it("0028: order_reconnection (lo ticado sin conexión, una vez por client_id) y el permiso «Resolver reconexiones» a quien puede autorizar", () => rollback(c, async () => {
    const o = await one(c, "SELECT id, store_id FROM orders LIMIT 1");
    if (o) {
      const ins = "INSERT INTO order_reconnection (id, store_id, order_id, client_id, plu, name, quantity, marked_at) VALUES ($1,$2,$3,'pda1-x',1,'Caña',1,now())";
      await c.query(ins, [uuid(), o.store_id, o.id]);
      expect((await one(c, "SELECT status FROM order_reconnection WHERE client_id='pda1-x'")).status).toBe("pending");
      await expect(c.query(ins, [uuid(), o.store_id, o.id])).rejects.toMatchObject({ code: "23505" });
      await c.query("ROLLBACK"); await c.query("BEGIN");
    }
    expect((await one(c, "SELECT name FROM permission WHERE code='pedido.reconexiones'")).name).toBe("Resolver reconexiones");
    const sin = await all(c, `SELECT DISTINCT a.profile_id::text FROM profile_permission a WHERE a.permission_code='sistema.autorizar'
      AND NOT EXISTS (SELECT 1 FROM profile_permission b WHERE b.profile_id=a.profile_id AND b.permission_code='pedido.reconexiones')`);
    expect(sin).toEqual([]);
  }));
});
