import { inject } from "vitest";
import { connect, one, rollback, n } from "./db.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Datos de la tienda nueva (sql/04_datos_tienda_inicial.sql): se aplican sobre la Sucursal Pruebas al crear la base con SEED=1. */
const SQL = readFileSync(fileURLToPath(new URL("../sql/04_datos_tienda_inicial.sql", import.meta.url)), "utf8");
let c: Awaited<ReturnType<typeof connect>>;
beforeAll(async () => { c = await connect(inject("dbUrl")); });
afterAll(async () => { await c.end(); });

const cif = (nif: string) => { const d = nif.slice(1, 8); let s = 0;
  for (let i = 0; i < 7; i++) { const x = Number(d[i]); if (i % 2) s += x; else { const y = x * 2; s += Math.floor(y / 10) + (y % 10); } }
  return String((10 - (s % 10)) % 10) === nif[8]; };

describe("datos de la tienda nueva (04)", () => {
  it("deja la tienda, la empresa con NIF válido, 3 mesas (una por sala) y los canales BEBIDA y COMIDA", () => rollback(c, async () => {
    await c.query(SQL);
    expect((await one(c, "SELECT code FROM store")).code).toBe("LG01"); // 21/11 · Luma Gelateria Italiana · Plaza Mayor
    const nif = (await one(c, "SELECT tax_id FROM company")).tax_id as string;
    expect(cif(nif)).toBe(true);
    expect(n((await one(c, "SELECT count(*) FROM dining_table")).count)).toBe(3);
    const ch = (await c.query("SELECT c.name, count(pc.*)::int AS n FROM print_channel c LEFT JOIN product_channel pc ON pc.channel_id=c.id GROUP BY c.name")).rows;
    expect(ch.find(r => r.name === "COMIDA")?.n).toBeGreaterThan(0);
    expect(ch.find(r => r.name === "BEBIDA")?.n).toBeGreaterThan(0);
    expect(ch.some(r => r.name === "BARRA")).toBe(false);
  }));
  it("21/11 · datos base de LG01: empresa, cadena, series, formas de pago, impresora única, usuarios y descuentos", () => rollback(c, async () => {
    await c.query(SQL);
    expect(await one(c, "SELECT legal_name, trade_name, tax_id, maxpoint_cdn_id FROM company")).toEqual({ legal_name: "GASTORIANA SERVICES, S.L.", trade_name: "Luma Gelateria Italiana", tax_id: "B75298851", maxpoint_cdn_id: 8 });
    expect(await one(c, "SELECT service_type, maxpoint_rst_id, oot_enabled FROM store")).toEqual({ service_type: "fastfood", maxpoint_rst_id: 41, oot_enabled: false });
    expect(await one(c, "SELECT series_simplified, series_full, series_credit, simplified_limit FROM billing_settings")).toEqual({ series_simplified: "T-LG01", series_full: "F-LG01", series_credit: "R-LG01", simplified_limit: "1000.00" });
    expect((await c.query("SELECT code, external_id FROM payment_method WHERE active ORDER BY code")).rows).toEqual([{ code: "card", external_id: "56" }, { code: "cash", external_id: "55" }]);
    expect((await c.query("SELECT name FROM printer WHERE active")).rows).toEqual([{ name: "BARRA" }]);
    expect(n((await one(c, "SELECT count(*) FROM print_channel c JOIN printer p ON p.id = c.printer_id WHERE p.name <> 'BARRA'")).count)).toBe(0);
    expect((await c.query("SELECT name FROM app_user WHERE active ORDER BY name")).rows.map(r => r.name)).toEqual(["Barra", "J", "Mesero", "Sistemas"]);
    expect((await one(c, "SELECT profiles, needs_authorization FROM discount WHERE name = 'DESCUENTO 30% EMPLEADOS'"))).toEqual({ profiles: ["ADMIN", "MANAGER"], needs_authorization: true });
  }));
  it("el Cajero puede abrir el periodo y el Manager (antes ADMIN_LOCAL) entra en Ajustes", () => rollback(c, async () => {
    await c.query(SQL);
    const has = async (perm: string, prof: string) => n((await one(c, "SELECT count(*) FROM profile_permission pp JOIN user_profile p ON p.id=pp.profile_id WHERE pp.permission_code=$1 AND p.code=$2", [perm, prof])).count) === 1;
    expect(await has("funciones.periodo", "CAJERO")).toBe(true);
    expect(await has("ajustes.acceso", "MANAGER")).toBe(true);
    expect(await has("ajustes.devdb", "MANAGER")).toBe(true); // 21/11 · en la matriz del formulario el Manager tiene Developer
    expect(await has("funciones.sir", "MANAGER")).toBe(false);
    // 0030 (04/11): el tablero de pedidos solo para cajero y encargado; Ajustes › Pedidos a quien tiene Restaurante (0025)
    expect(await has("funciones.pedidos", "MESERO")).toBe(false);
    expect(await has("funciones.pedidos", "JEFERANGO")).toBe(false); // 0044 (20/11): solo Cajero y Administrador
    expect(await has("funciones.pedidos", "CAJERO")).toBe(true);
    expect(await has("ajustes.pedidos", "ADMIN")).toBe(true);
  }));
  it("no se aplica a una base con ventas", () => rollback(c, async () => {
    const st = (await one(c, "SELECT id FROM store")).id;
    await c.query(`INSERT INTO orders (id, store_id, table_name, opened_by_user_name, opened_by_at) VALUES (gen_random_uuid(), $1, '1', 'x', now())`, [st]);
    await c.query("SAVEPOINT s");
    await expect(c.query(SQL)).rejects.toThrow(/ya tiene ventas/);
    await c.query("ROLLBACK TO SAVEPOINT s");
  }));
});
