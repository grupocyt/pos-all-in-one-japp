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
  it("deja la tienda, la empresa con NIF válido, 301 mesas y los canales BEBIDA y COMIDA", () => rollback(c, async () => {
    await c.query(SQL);
    expect((await one(c, "SELECT code FROM store")).code).toBe("JC01");
    const nif = (await one(c, "SELECT tax_id FROM company")).tax_id as string;
    expect(cif(nif)).toBe(true);
    expect(n((await one(c, "SELECT count(*) FROM dining_table")).count)).toBe(301);
    const ch = (await c.query("SELECT c.name, count(pc.*)::int AS n FROM print_channel c LEFT JOIN product_channel pc ON pc.channel_id=c.id GROUP BY c.name")).rows;
    expect(ch.find(r => r.name === "COMIDA")?.n).toBeGreaterThan(0);
    expect(ch.find(r => r.name === "BEBIDA")?.n).toBeGreaterThan(0);
    expect(ch.some(r => r.name === "BARRA")).toBe(false);
  }));
  it("el Cajero puede abrir el periodo y ADMIN_LOCAL entra en Ajustes", () => rollback(c, async () => {
    await c.query(SQL);
    const has = async (perm: string, prof: string) => n((await one(c, "SELECT count(*) FROM profile_permission pp JOIN user_profile p ON p.id=pp.profile_id WHERE pp.permission_code=$1 AND p.code=$2", [perm, prof])).count) === 1;
    expect(await has("funciones.periodo", "CAJERO")).toBe(true);
    expect(await has("ajustes.acceso", "ADMIN_LOCAL")).toBe(true);
    expect(await has("ajustes.devdb", "ADMIN_LOCAL")).toBe(false);
  }));
  it("no se aplica a una base con ventas", () => rollback(c, async () => {
    const st = (await one(c, "SELECT id FROM store")).id;
    await c.query(`INSERT INTO orders (id, store_id, table_name, opened_by_user_name, opened_by_at) VALUES (gen_random_uuid(), $1, '1', 'x', now())`, [st]);
    await c.query("SAVEPOINT s");
    await expect(c.query(SQL)).rejects.toThrow(/ya tiene ventas/);
    await c.query("ROLLBACK TO SAVEPOINT s");
  }));
});
