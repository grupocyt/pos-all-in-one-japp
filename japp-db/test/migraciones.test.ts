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
    const copy = uuid();
    await c.query("INSERT INTO print_channel (id, store_id, name, kind, copy_of_id) VALUES ($1,$2,'COPIA PRUEBA','kitchen',$3)", [copy, k.store_id, k.id]);
    expect((await one(c, "SELECT copy_of_id FROM print_channel WHERE id=$1", [copy])).copy_of_id).toBe(k.id);
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
    expect((await one(c, "SELECT ticket_formats FROM store_parameters LIMIT 1")).ticket_formats).toEqual({});
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
