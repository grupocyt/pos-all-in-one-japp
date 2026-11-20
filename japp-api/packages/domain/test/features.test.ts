import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, FEATURES, FEATURE_KEYS, featureOff } from "../src/index.js";

/** 1.2.289 · Ajustes › Funcionalidades (0042) */
describe("funcionalidades", () => {
  it("cada función apaga permisos que existen", () => {
    expect(FEATURE_KEYS).toHaveLength(14);
    for (const k of FEATURE_KEYS) {
      for (const p of FEATURES[k]) {
        expect(ALL_PERMISSIONS).toContain(p);
      }
    }
  });
  it("featureOff: solo lo desactivado y solo sus permisos", () => {
    expect(featureOff("mesas.transferir", [])).toBeNull();
    expect(featureOff("mesas.transferir", ["transferir"])).toBe("transferir");
    expect(featureOff("pedido.elimPrecuenta", ["eliminaciones"])).toBe("eliminaciones");
    expect(featureOff("pedido.enviar", ["transferir", "eliminaciones"])).toBeNull();
    expect(featureOff("mesas.transferir", null)).toBeNull();
  });
});
