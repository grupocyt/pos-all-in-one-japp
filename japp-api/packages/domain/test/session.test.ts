import { effectiveLockSeconds, shouldLock, DEFAULT_LOCK } from "../src/session.js";

describe("bloqueo de sesión por usuario", () => {
  it("por defecto 7 s en TPV y 10 s en móvil", () => {
    expect(DEFAULT_LOCK).toEqual({ tpv: 7, pda: 10 });
    expect(effectiveLockSeconds(null)).toBe(7);
    expect(effectiveLockSeconds(undefined, DEFAULT_LOCK, true)).toBe(10);
  });
  it("el del usuario manda sobre el de la tienda, en TPV y en móvil", () => {
    expect(effectiveLockSeconds(15)).toBe(15);
    expect(effectiveLockSeconds(15, DEFAULT_LOCK, true)).toBe(15);
  });
  it("0 = nunca; se acota entre 0 y 3600", () => {
    expect(effectiveLockSeconds(0)).toBe(0);
    expect(effectiveLockSeconds(-5)).toBe(0);
    expect(effectiveLockSeconds(99999)).toBe(3600);
  });
  it("la tienda puede cambiar sus valores (Ajustes › Parámetros)", () => {
    expect(effectiveLockSeconds(null, { tpv: 30, pda: 60 }, true)).toBe(60);
  });
  it("shouldLock: a los N segundos exactos se bloquea; con 0 nunca", () => {
    const t0 = new Date("2026-10-14T19:00:00Z");
    expect(shouldLock(t0, new Date(t0.getTime() + 6999), 7)).toBe(false);
    expect(shouldLock(t0, new Date(t0.getTime() + 7000), 7)).toBe(true);
    expect(shouldLock(t0, new Date(t0.getTime() + 9e9), 0)).toBe(false);
  });
});
