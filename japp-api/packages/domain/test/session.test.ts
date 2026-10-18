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

describe("una sesión activa por usuario", () => {
  it("un token anterior → SESSION_REPLACED con la estación nueva; sin sesión vigente → BAD_PIN", async () => {
    const { assertActiveSession, releasesStation } = await import("../src/session.js");
    const cur = { jti: "nuevo", stationId: "s2", stationName: "PDA2" };
    expect(() => assertActiveSession(cur, "nuevo")).not.toThrow();
    expect(() => assertActiveSession(null, "viejo")).toThrow("Sesión cerrada o no válida: vuelve a entrar con tu clave");
    try { assertActiveSession(cur, "viejo"); throw new Error("no"); } catch (e: any) {
      expect([e.code, e.status, e.message, e.details]).toEqual(["SESSION_REPLACED", 401, "Tu clave se ha abierto en PDA2: vuelve a entrar", { station: "PDA2" }]);
    }
    expect(releasesStation(cur, "s1")).toBe("s2");
    expect(releasesStation(cur, "s2")).toBeNull();
    expect(releasesStation(null, "s2")).toBeNull();
  });
});
