import { inject } from "vitest";
import bcrypt from "bcryptjs";
import { connect, all, one, n } from "./db.js";

/** Datos de arranque de la Sucursal Pruebas (CT 03), sacados de la configuración del prototipo. */
let c: Awaited<ReturnType<typeof connect>>;
beforeAll(async () => { c = await connect(inject("dbUrl")); });
afterAll(async () => { await c.end(); });

describe("datos de arranque", () => {
  it("una tienda CT 03 conectada a japp.grupocyt.com.es", async () => {
    const s = await all(c, "SELECT code, server_url, service_type FROM store");
    expect(s).toEqual([{ code: "CT 03", server_url: "https://japp.grupocyt.com.es/", service_type: "table" }]);
  });
  it("carta: 487 productos, todos con IVA y precio ≥ 0", async () => {
    expect(n((await one(c, "SELECT count(*) FROM product")).count)).toBe(487);
    expect(n((await one(c, "SELECT count(*) FROM product WHERE tax_id IS NULL OR price < 0")).count)).toBe(0);
  });
  it("51 permisos «módulo.tecla» (47 de arranque + 2 de la 0005 + 1 de la 0008 + 1 de la 0012), iguales a los del dominio", async () => {
    const codes = (await all(c, "SELECT code FROM permission ORDER BY sort_order")).map(r => r.code);
    expect(codes).toHaveLength(51);
    expect(codes).toContain("mesas.entrarOcupada");
    expect(codes).toContain("mesas.orderOnTable");
    expect(codes).toEqual(expect.arrayContaining(["ajustes.cierres", "ajustes.devsync"]));
    expect(codes).toContain("pedido.elimEnviado");
    expect(codes).toContain("ajustes.devtx");
    expect(codes).not.toContain("sistema.developer");
  });
  it("el administrador tiene todos los permisos", async () => {
    const r = await one(c, `SELECT count(*) FROM profile_permission pp JOIN user_profile p ON p.id=pp.profile_id WHERE p.code='ADMIN'`);
    expect(n(r.count)).toBe(51);
  });
  it("usuarios con PIN cifrado en bcrypt (nunca en claro); Jeison entra con su PIN de pruebas", async () => {
    const u = await all(c, "SELECT name, pin_hash FROM app_user");
    expect(u.every(x => /^\$2[aby]\$\d\d\$/.test(x.pin_hash))).toBe(true);
    const j = u.find(x => x.name === "Jeison")!;
    expect(bcrypt.compareSync("5845", j.pin_hash)).toBe(true);
    expect(bcrypt.compareSync("0000", j.pin_hash)).toBe(false);
  });
  it("series de factura configuradas", async () => {
    const b = await one(c, "SELECT series_simplified, series_full FROM billing_settings");
    expect(b.series_simplified).toMatch(/^T\d{4}$/);
    expect(b.series_full).toMatch(/^F\d{4}$/);
  });
});
