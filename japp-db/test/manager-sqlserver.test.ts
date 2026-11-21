import { inject } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { connect, all } from "./db.js";

/**
 * 21/11/2026 · Tablas del Manager (SQL Server, dbo), una por cada tabla de la tienda: manager/manager-tpv-sqlserver-vN.sql.
 * Regla: la versión 1 está CERRADA (no se toca nunca: su huella no puede cambiar). Cualquier cambio va en una versión nueva
 * (v2, v3…) con ALTER/CREATE sobre lo anterior. Toda tabla de la tienda tiene que estar en alguna versión: si una migración
 * crea una tabla nueva, hay que sacar la siguiente versión del script del Manager.
 */
const DIR = join(__dirname, "..", "manager");
const V1_SHA256 = "0c95ad776f669b0c9afb209b635d31c34d9430c0aaad520b36f9472d8a46155f";
let c: Awaited<ReturnType<typeof connect>>;
beforeAll(async () => { c = await connect(inject("dbUrl")); });
afterAll(async () => { await c.end(); });

describe("script del Manager (SQL Server)", () => {
  const files = readdirSync(DIR).filter(f => /^manager-tpv-sqlserver-v\d+\.sql$/.test(f)).sort();
  it("la versión 1 está cerrada: no ha cambiado", () => {
    const sha = createHash("sha256").update(readFileSync(join(DIR, "manager-tpv-sqlserver-v1.sql"))).digest("hex");
    expect(sha).toBe(V1_SHA256);
  });
  it("cada tabla de la tienda tiene su tpv_<tabla> en alguna versión, con el código de restaurante de integración y el de la tienda", async () => {
    const sql = files.map(f => readFileSync(join(DIR, f), "utf8")).join("\n");
    const tables = (await all(c, "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1")).map(r => r.table_name as string);
    const missing = tables.filter(t => !new RegExp(`CREATE TABLE dbo\\.tpv_${t} \\(\\n    cod_restaurante_integracion INT NOT NULL,[^\\n]*\\n    cod_tienda NVARCHAR\\(20\\) NOT NULL`).test(sql));
    expect(missing).toEqual([]);
  });
});
