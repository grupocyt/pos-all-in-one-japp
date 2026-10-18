import { applyPresence, assertCanCommand, canEnterTable, presenceView, PRESENCE_LEASE_SECONDS, type PresenceState } from "../src/presence.js";
import { DomainError } from "../src/errors.js";

const T0 = new Date("2026-10-15T20:00:00Z");
const plus = (s: number) => new Date(T0.getTime() + s * 1000);
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as DomainError).code; } return "OK"; };
const PEDRO = { userId: "u-pedro", userName: "Pedro", stationId: "pda1", stationName: "PDA1" };
const PEDRO_PDA2 = { ...PEDRO, stationId: "pda2", stationName: "PDA2" };
const ANA = { userId: "u-ana", userName: "Ana", stationId: "pda3", stationName: "PDA3" };
const SISTEMAS = { userId: "u-sis", userName: "Sistemas", stationId: "caja1", stationName: "CAJA1", canTakeOver: true };
const FREE: PresenceState = { holder: null, chargingUntil: null };
const held = (who = PEDRO, at = T0) => applyPresence(FREE, "enter", who, at).state;

describe("una persona por mesa", () => {
  it("entrar en una mesa libre: la tiene 30 s", () => {
    const s = held();
    expect(s.holder).toMatchObject({ userName: "Pedro", stationName: "PDA1", until: plus(PRESENCE_LEASE_SECONDS).toISOString() });
    expect(presenceView(s, PEDRO, T0)).toMatchObject({ youHold: true, charging: false });
  });
  it("otra persona sin permiso → TABLE_TAKEN «Mesa ocupada por Pedro · PDA1» con quién y hasta cuándo", () => {
    try { applyPresence(held(), "enter", ANA, plus(5)); throw new Error("no"); } catch (e) {
      expect((e as DomainError).code).toBe("TABLE_TAKEN");
      expect((e as DomainError).message).toBe("Mesa ocupada por Pedro · PDA1");
      expect((e as DomainError).details).toEqual({ holder: { userName: "Pedro", stationName: "PDA1", until: plus(30).toISOString() } });
    }
  });
  it("pasados 30 s sin renovar, la mesa queda libre", () => {
    expect(applyPresence(held(), "enter", ANA, plus(31)).state.holder?.userName).toBe("Ana");
  });
  it("renovar alarga el plazo; otro no la recupera renovando", () => {
    const s = applyPresence(held(), "renew", PEDRO, plus(20)).state;
    expect(s.holder!.until).toBe(plus(50).toISOString());
    expect(code(() => applyPresence(s, "renew", ANA, plus(40)))).toBe("TABLE_TAKEN");
  });
  it("el mismo usuario en otro equipo es otra persona: TABLE_TAKEN mientras dure el plazo", () => {
    expect(code(() => applyPresence(held(), "enter", PEDRO_PDA2, plus(5)))).toBe("TABLE_TAKEN");
    expect(code(() => assertCanCommand(held(), PEDRO_PDA2, "other", plus(5)))).toBe("TABLE_TAKEN");
    expect(applyPresence(held(), "enter", PEDRO_PDA2, plus(31)).state.holder).toMatchObject({ userName: "Pedro", stationName: "PDA2" });
    expect(applyPresence(held(), "enter", { ...PEDRO_PDA2, canTakeOver: true }, plus(5)).displaced?.stationName).toBe("PDA1");
  });
  it("con mesas.entrarOcupada se entra y el anterior queda desplazado", () => {
    const r = applyPresence(held(), "enter", SISTEMAS, plus(5));
    expect(r.state.holder?.userName).toBe("Sistemas");
    expect(r.displaced?.userName).toBe("Pedro");
    expect(canEnterTable(held(), SISTEMAS, plus(5)).displaced?.userName).toBe("Pedro");
  });
  it("mientras se cobra nadie entra, ni un administrador (TABLE_CHARGING), aunque el equipo deje de renovar", () => {
    const s = applyPresence(held(), "charging", PEDRO, plus(1)).state;
    expect(presenceView(s, PEDRO, plus(2)).charging).toBe(true);
    expect(code(() => applyPresence(s, "enter", SISTEMAS, plus(2)))).toBe("TABLE_CHARGING");
    expect(code(() => applyPresence(s, "enter", ANA, plus(45)))).toBe("TABLE_CHARGING");
    expect(applyPresence(s, "enter", ANA, plus(62)).state.holder?.userName).toBe("Ana");
    expect(code(() => applyPresence(s, "enter", PEDRO_PDA2, plus(2)))).toBe("TABLE_CHARGING"); // el mismo usuario desde otro equipo tampoco
    expect(applyPresence(s, "enter", PEDRO, plus(2)).state.chargingUntil).toBe(s.chargingUntil);
  });
  it("cobro: solo quien tiene la mesa; chargingEnd y leave lo quitan", () => {
    expect(code(() => applyPresence(held(), "charging", ANA, plus(1)))).toBe("TABLE_TAKEN");
    const c = applyPresence(held(), "charging", PEDRO, plus(1)).state;
    expect(applyPresence(c, "chargingEnd", PEDRO, plus(2)).state.chargingUntil).toBeNull();
    expect(applyPresence(c, "leave", PEDRO, plus(2)).state).toEqual(FREE);
    expect(applyPresence(c, "leave", ANA, plus(2)).state).toEqual(c); // salir de una mesa que no tienes no cambia nada
  });
});

describe("guardia de los comandos", () => {
  it("sin presencia (o caducada) todo como siempre", () => {
    expect(assertCanCommand(FREE, ANA, "other", T0)).toEqual({ holds: false });
    expect(assertCanCommand(held(), ANA, "other", plus(31))).toEqual({ holds: false });
  });
  it("quien tiene la mesa hace de todo; los demás solo Guardar (añadir y enviar)", () => {
    expect(assertCanCommand(held(), PEDRO, "other", plus(1))).toEqual({ holds: true });
    expect(assertCanCommand(held(), ANA, "save", plus(1))).toEqual({ holds: false });
    expect(code(() => assertCanCommand(held(), ANA, "other", plus(1)))).toBe("TABLE_TAKEN");
    expect(code(() => assertCanCommand(held(), PEDRO_PDA2, "other", plus(1)))).toBe("TABLE_TAKEN"); // mismo usuario, otro equipo: tiene que volver a entrar
  });
});
