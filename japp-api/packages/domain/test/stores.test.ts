import { pickStore, normalizeStoreCode, StoreSelectionError } from "../src/stores.js";

const S = (id: string, code: string, active = true) => ({ id, code, active });

describe("qué tienda es este servidor", () => {
  it("sin STORE_CODE y una sola tienda activa: esa", () => {
    expect(pickStore([S("a", "CT 03"), S("x", "OLD", false)]).id).toBe("a");
  });
  it("STORE_CODE sin distinguir espacios ni mayúsculas", () => {
    expect(normalizeStoreCode(" ct 03 ")).toBe("CT03");
    expect(pickStore([S("a", "CT 03"), S("b", "CT05")], "CT03").id).toBe("a");
    expect(pickStore([S("a", "CT03"), S("b", "CT05")], "ct 05").id).toBe("b");
  });
  it("varias tiendas sin STORE_CODE, ninguna, o código que no existe → error que lo explica", () => {
    expect(() => pickStore([S("a", "CT03"), S("b", "CT05")])).toThrow(/2 tiendas \(CT03, CT05\)/);
    expect(() => pickStore([])).toThrow(StoreSelectionError);
    expect(() => pickStore([S("a", "CT03")], "CT09")).toThrow(/En la base: CT03/);
    expect(() => pickStore([S("a", "CT03", false)], "CT03")).toThrow(/ninguna tienda activa/);
  });
});
