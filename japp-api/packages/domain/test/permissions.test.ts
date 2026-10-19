import {
  can,
  canSettings,
  checkWithManager,
  ALL_PERMISSIONS,
  BASIC_PERMISSIONS,
  PERMISSION_TREE,
} from "../src/permissions.js";
import { PROFILES, MARTA, PABLO, LUCIA, JEISON } from "./helpers.js";

describe("permisos", () => {
  it("árbol completo: 6 grupos, 51 códigos «módulo.tecla» sin repetir, 20 módulos de Ajustes + acceso", () => {
    expect(Object.keys(PERMISSION_TREE)).toEqual([
      "mesas",
      "pedido",
      "cobro",
      "funciones",
      "ajustes",
      "sistema",
    ]);
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
    expect(ALL_PERMISSIONS).toHaveLength(51);
    expect(ALL_PERMISSIONS).toContain("mesas.entrarOcupada");
    expect(ALL_PERMISSIONS).toContain("mesas.orderOnTable");
    expect(ALL_PERMISSIONS.filter((p) => p.startsWith("ajustes."))).toHaveLength(21);
    expect(ALL_PERMISSIONS).toContain("pedido.elimEnviado");
  });
  it("perfil básico: puede enviar y hacer precuenta, no cobrar ni borrar enviado", () => {
    expect(BASIC_PERMISSIONS["pedido.enviar"]).toBe(true);
    expect(can(MARTA, "pedido.enviar", PROFILES)).toBe(true);
    expect(can(MARTA, "cobro.cobrar", PROFILES)).toBe(false);
    expect(can(MARTA, "pedido.elimEnviado", PROFILES)).toBe(false);
  });
  it("la excepción personal manda sobre el perfil (Pablo cobra aunque sea camarero)", () => {
    expect(can(PABLO, "cobro.cobrar", PROFILES)).toBe(true);
    expect(can({ ...LUCIA, overrides: { "cobro.cobrar": false } }, "cobro.cobrar", PROFILES)).toBe(false);
    expect(can({ ...LUCIA, overrides: { "cobro.cobrar": null } }, "cobro.cobrar", PROFILES)).toBe(true);
  });
  it("administrador (Jeison) lo tiene todo", () => {
    expect(ALL_PERMISSIONS.every((p) => can(JEISON, p, PROFILES))).toBe(true);
  });
  it("sin usuario o perfil desconocido → no", () => {
    expect(can(null, "pedido.enviar", PROFILES)).toBe(false);
    expect(can({ id: "x", profileId: "NOPE" }, "pedido.enviar", PROFILES)).toBe(false);
  });
  it("Ajustes: vale el perfil del encargado que autorizó la entrada", () => {
    expect(canSettings(MARTA, "productos", PROFILES)).toBe(false);
    expect(canSettings(MARTA, "productos", PROFILES, "ADMIN")).toBe(true);
    expect(canSettings(MARTA, "productos", PROFILES, "CAJERO")).toBe(false);
  });
  it("checkWithManager", () => {
    expect(checkWithManager(LUCIA, "cobro.descuentos", PROFILES)).toEqual({ ok: true, authorizedBy: null });
    expect(checkWithManager(MARTA, "cobro.descuentos", PROFILES)).toEqual({
      ok: false,
      code: "PERMISSION_REQUIRED",
      permission: "cobro.descuentos",
    });
    expect(checkWithManager(MARTA, "cobro.descuentos", PROFILES, PABLO)).toMatchObject({
      ok: false,
      code: "NOT_ALLOWED",
    });
    expect(checkWithManager(MARTA, "cobro.descuentos", PROFILES, LUCIA)).toEqual({
      ok: true,
      authorizedBy: LUCIA,
    });
  });
});
