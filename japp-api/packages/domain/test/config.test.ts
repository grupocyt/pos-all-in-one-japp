import { assertCanDeactivate, assertRecordVersion, checkConfigRecord, CONFIG_MODULES, CONFIG_PERMISSION, describeDiff, isConfigModule } from "../src/config.js";
import { ALL_PERMISSIONS } from "../src/permissions.js";

const code = (f: () => unknown) => { try { f(); return null; } catch (e: any) { return [e.code, e.details?.field ?? e.details?.reason]; } };

describe("Ajustes · módulos y permisos", () => {
  it("19 módulos, cada uno con un permiso que existe", () => {
    expect(CONFIG_MODULES).toHaveLength(19);
    for (const m of CONFIG_MODULES) expect(ALL_PERMISSIONS).toContain(CONFIG_PERMISSION[m]);
    expect(isConfigModule("productos")).toBe(true);
    expect(isConfigModule("devtx")).toBe(false);
  });
});

describe("Ajustes · reglas por registro", () => {
  it("usuarios: PIN de 4 números obligatorio al dar de alta; bloqueo 0–3600", () => {
    expect(code(() => checkConfigRecord("usuarios", { name: "Ana" }, { isNew: true }))).toEqual(["VALIDATION", "pin"]);
    expect(code(() => checkConfigRecord("usuarios", { pin: "12a4" }, { isNew: false }))).toEqual(["VALIDATION", "pin"]);
    expect(code(() => checkConfigRecord("usuarios", { pin: "1234", lockSeconds: 4000 }, { isNew: true }))).toEqual(["VALIDATION", "lockSeconds"]);
    expect(code(() => checkConfigRecord("usuarios", { lockSeconds: 0 }, { isNew: false }))).toBeNull();
  });
  it("preguntas: mínimo ≤ máximo; obligatoria con respuestas; pase 0–9", () => {
    const q = { minAnswers: 1, maxAnswers: 1, answers: [{ plu: 1 }], course: null };
    expect(code(() => checkConfigRecord("preguntas", q, { isNew: true }))).toBeNull();
    expect(code(() => checkConfigRecord("preguntas", { ...q, minAnswers: 2 }, { isNew: true }))).toEqual(["VALIDATION", "minAnswers"]);
    expect(code(() => checkConfigRecord("preguntas", { ...q, answers: [] }, { isNew: true }))).toEqual(["VALIDATION", "answers"]);
    expect(code(() => checkConfigRecord("preguntas", { ...q, course: 12 }, { isNew: true }))).toEqual(["VALIDATION", "course"]);
    expect(code(() => checkConfigRecord("preguntas", { ...q, maxAnswers: 3, minAnswers: 2 }, { isNew: true }))).toEqual(["VALIDATION", "minAnswers"]);
  });
  it("descuentos, impuestos, productos, parámetros y objetivos con sus rangos", () => {
    expect(code(() => checkConfigRecord("descuentos", { percent: 0 }, { isNew: true }))).toEqual(["VALIDATION", "percent"]);
    expect(code(() => checkConfigRecord("descuentos", { percent: 10, validFrom: "2026-11-01", validTo: "2026-10-01" }, { isNew: true }))).toEqual(["VALIDATION", "validTo"]);
    expect(code(() => checkConfigRecord("impuestos", { rate: 121 }, { isNew: true }))).toEqual(["VALIDATION", "rate"]);
    expect(code(() => checkConfigRecord("productos", { price: -1 }, { isNew: true }))).toEqual(["VALIDATION", "price"]);
    expect(code(() => checkConfigRecord("parametros", { pinAttempts: 0 }, { isNew: false }))).toEqual(["VALIDATION", "pinAttempts"]);
    expect(code(() => checkConfigRecord("objetivos", { week: 54, growthPct: 5 }, { isNew: true }))).toEqual(["VALIDATION", "week"]);
  });
  it("versión por registro: igual → siguiente; distinta → VERSION_CONFLICT; falta → VALIDATION", () => {
    expect(assertRecordVersion(3, 3)).toBe(4);
    expect(code(() => assertRecordVersion(3, 2))).toEqual(["VERSION_CONFLICT", undefined]);
    expect(code(() => assertRecordVersion(3, null))).toEqual(["VALIDATION", "version"]);
  });
  it("desactivar: nunca a uno mismo, ni algo en uso", () => {
    expect(code(() => assertCanDeactivate("usuarios", { self: true }))).toEqual(["IN_USE", "self"]);
    expect(code(() => assertCanDeactivate("perfiles", { users: 2 }))).toEqual(["IN_USE", "users"]);
    expect(code(() => assertCanDeactivate("areas", { activeChildren: 5 }))).toEqual(["IN_USE", "children"]);
    expect(code(() => assertCanDeactivate("mesas", { openOrders: 1 }))).toEqual(["IN_USE", "openOrders"]);
    expect(code(() => assertCanDeactivate("formas-pago", { base: true }))).toEqual(["IN_USE", "base"]);
    expect(code(() => assertCanDeactivate("parametros", {}))).toEqual(["VALIDATION", "id"]);
    expect(code(() => assertCanDeactivate("motivos", {}))).toBeNull();
  });
  it("historial legible y sin secretos", () => {
    expect(describeDiff(null, { name: "X" })).toBe("Alta");
    expect(describeDiff({ name: "AGUA", priceTerrace: null, version: 1 }, { name: "AGUA", priceTerrace: 2.8, version: 2 }, { priceTerrace: "PVP terraza" })).toBe("PVP terraza: — → 2,80");
    expect(describeDiff({ pin: "1111", active: true }, { pin: "2222", active: false }, { active: "Activo" })).toBe("pin: cambiado · Activo: sí → no");
  });
});
