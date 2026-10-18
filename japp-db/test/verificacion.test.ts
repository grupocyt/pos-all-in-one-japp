import { inject } from "vitest";
// @ts-ignore
import { verificationQueries } from "../scripts/db.mjs";
import { connect, rollback, insertSampleOrder, uuid } from "./db.js";

/**
 * Las consultas de sql/verificacion deben devolver 0 filas con datos sanos
 * y detectar cada tipo de error. Son las mismas que se pasan en tienda con npm run verify.
 */
let c: Awaited<ReturnType<typeof connect>>;
beforeAll(async () => { c = await connect(inject("dbUrl")); });
afterAll(async () => { await c.end(); });

const Q: Record<string, string> = Object.fromEntries(verificationQueries().map((q: any) => [q.name, q.sql]));
const rows = async (name: string) => (await c.query(Q[name]!)).rows;

describe("consultas de verificación", () => {
  it("hay 6 consultas", () => expect(Object.keys(Q)).toHaveLength(6));

  it("con una mesa correcta, todas devuelven 0 filas", () => rollback(c, async () => {
    await insertSampleOrder(c);
    for (const name of Object.keys(Q)) expect(await rows(name), name).toEqual([]);
  }));
  it("detecta un total de cuenta que no cuadra con sus líneas", () => rollback(c, async () => {
    const { acc } = await insertSampleOrder(c, { breakTotal: true });
    const r = await rows("01_cuadre_cuentas");
    expect(r.map(x => x.id)).toEqual([acc]);
    expect(Number(r[0].calc_total)).toBe(16.92);
  }));
  it("detecta una cuenta facturada sin cobrar", () => rollback(c, async () => {
    await insertSampleOrder(c, { unpaid: true });
    expect(await rows("02_cobros_facturadas")).toHaveLength(1);
  }));
  it("detecta un hueco en la serie", () => rollback(c, async () => {
    const { store } = await insertSampleOrder(c);
    await c.query(`INSERT INTO invoice (id, store_id, type, series, sequence, invoice_number, issued_at, issuer_tax_id, issuer_name, tax_base, tax_total, total, issued_by_user_name, issued_by_at)
                   VALUES (gen_random_uuid(),$1,'F2','TEST',3,'TEST-000003',now(),'B1','x',1,0.1,1.1,'x',now())`, [store]);
    expect(await rows("03_huecos_series")).toMatchObject([{ series: "TEST", emitidas: "2", esperadas: 3 }]);
  }));
  it("detecta un desglose de IVA que no suma el total", () => rollback(c, async () => {
    const { inv } = await insertSampleOrder(c);
    await c.query("UPDATE invoice_tax SET tax = 2 WHERE invoice_id=$1", [inv]);
    expect(await rows("04_iva_factura")).toHaveLength(1);
  }));
  it("detecta una línea enviada borrada sin motivo", () => rollback(c, async () => {
    await insertSampleOrder(c, { deleteWithoutReason: true });
    expect(await rows("05_borrados_sin_motivo")).toHaveLength(1);
  }));

  it("detecta un eslabón roto en la cadena VeriFactu", () => rollback(c, async () => {
    const { store, inv } = await insertSampleOrder(c);
    const rec = (id: string, num: string, at: string, hash: string, prevId: string | null, prevHash: string | null) =>
      c.query(`INSERT INTO verifactu_record (id, store_id, invoice_id, issuer_tax_id, invoice_number, issued_on, invoice_type, tax_total, total, hash, generated_at, previous_record_id, previous_hash)
               VALUES ($1,$2,$3,'B12345678',$4,current_date,'F2',1.54,16.92,$5,$6,$7,$8)`, [id, store, inv, num, hash, at, prevId, prevHash]);
    const a = uuid(), b = uuid();
    await rec(a, "TEST-000001", "2026-10-13T10:00:00Z", "H1", null, null);
    await rec(b, "TEST-000002", "2026-10-13T10:05:00Z", "H2", a, "H1");
    expect(await rows("06_cadena_verifactu")).toEqual([]);
    await c.query("UPDATE verifactu_record SET previous_hash='MANIPULADO' WHERE id=$1", [b]);
    expect((await rows("06_cadena_verifactu")).map(r => r.id)).toEqual([b]);
  }));
});
