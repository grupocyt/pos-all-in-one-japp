import { assertMainStation, assertStationAllowed, resolveStation } from "../src/stations.js";
import { DomainError } from "../src/errors.js";

const err = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return {
      code: (e as DomainError).code,
      message: (e as DomainError).message,
      details: (e as DomainError).details,
    };
  }
  return null;
};
const CAJA1 = { id: "s1", name: "CAJA1", kind: "station", isMain: true, deviceUuid: null };
const CAJA2 = { id: "s2", name: "CAJA2", kind: "station", isMain: false, deviceUuid: null };
const PDA1 = { id: "s3", name: "PDA1", kind: "pda", isMain: false, deviceUuid: "dev-pda-0001" };

describe("caja principal", () => {
  it("un perfil «main» (Cajero) solo entra en la caja principal → STATION_NOT_ALLOWED", () => {
    expect(err(() => assertStationAllowed("main", CAJA1))).toBeNull();
    expect(err(() => assertStationAllowed("main", PDA1))).toEqual({
      code: "STATION_NOT_ALLOWED",
      message: "Este perfil solo puede entrar en la caja principal",
      details: { allowed: "main", station: "PDA1" },
    });
    expect(err(() => assertStationAllowed("any", PDA1))).toBeNull();
  });
  it("caja, retiros y cierre solo desde la principal → MAIN_STATION_REQUIRED", () => {
    expect(err(() => assertMainStation(CAJA1))).toBeNull();
    expect(err(() => assertMainStation(CAJA2))?.code).toBe("MAIN_STATION_REQUIRED");
    expect(err(() => assertMainStation(CAJA2))?.message).toBe("Solo desde la caja principal");
  });
});

describe("identidad del equipo (X-Station-Id)", () => {
  const all = [CAJA1, CAJA2, PDA1];
  it("por UUID del equipo → su estación", () => expect(resolveStation(all, "dev-pda-0001")).toBe(PDA1));
  it("por nombre o id de una estación que tiene UUID → STATION_NOT_ALLOWED", () => {
    expect(err(() => resolveStation(all, "PDA1"))).toMatchObject({
      code: "STATION_NOT_ALLOWED",
      message: "Este equipo no es esa estación",
    });
    expect(err(() => resolveStation(all, "s3"))?.code).toBe("STATION_NOT_ALLOWED");
  });
  it("estación sin UUID: por nombre o id, como siempre; sin cabecera, la primera caja", () => {
    expect(resolveStation(all, "CAJA2")).toBe(CAJA2);
    expect(resolveStation(all, "s1")).toBe(CAJA1);
    expect(resolveStation([PDA1, CAJA2], undefined)).toBe(CAJA2);
    expect(resolveStation(all, "no-existe")).toBe(CAJA1);
  });
});

describe("bloqueo de PIN por equipo", () => {
  it("UUID del equipo si lo tiene; si no, la estación", async () => {
    const { pinLockKey } = await import("../src/stations.js");
    expect(pinLockKey(PDA1)).toBe("device:dev-pda-0001");
    expect(pinLockKey(CAJA1)).toBe("station:s1");
  });
});
