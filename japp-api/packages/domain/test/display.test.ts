import { describe, expect, it } from "vitest";
import {
  DomainError,
  allowedDisplayModes,
  displayMediaKind,
  effectiveDisplayMode,
  normalizeDisplayConfig,
  normalizeSchedule,
  readDisplayConfig,
  scheduleOn,
} from "../src/index.js";

const err = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError) {
      return { code: e.code, field: (e.details as any)?.field };
    }
    throw e;
  }
  throw new Error("no falló");
};

describe("segunda pantalla del cliente", () => {
  it("los banners son solo para fast food; en mesas, apagada o solo facturación", () => {
    expect(allowedDisplayModes("table")).toEqual(["off", "billing"]);
    expect(allowedDisplayModes("fastfood")).toEqual(["off", "billing", "billing_banner", "banner"]);
    expect(err(() => normalizeDisplayConfig({ mode: "banner" }, "table"))).toEqual({ code: "VALIDATION", field: "config.mode" });
    expect(normalizeDisplayConfig({ mode: "banner" }, "fastfood").mode).toBe("banner");
    // la tienda pasó de fast food a mesas: lo guardado funciona como solo facturación
    expect(effectiveDisplayMode("billing_banner", "table")).toBe("billing");
    expect(effectiveDisplayMode("off", "table")).toBe("off");
  });
  it("completa lo que no viene y valida color, enlace, segundos y textos", () => {
    const c = normalizeDisplayConfig({ color: "#ABCDEF", tickets: { print: false } }, "table");
    expect(c).toMatchObject({ mode: "billing", color: "#abcdef", imageSeconds: 8, tickets: { email: true, print: false } });
    expect(err(() => normalizeDisplayConfig({ color: "teal" }, "table")).field).toBe("config.color");
    expect(err(() => normalizeDisplayConfig({ reviewUrl: "javascript:alert(1)" }, "table")).field).toBe("config.reviewUrl");
    expect(err(() => normalizeDisplayConfig({ imageSeconds: 1 }, "table")).field).toBe("config.imageSeconds");
    expect(err(() => normalizeDisplayConfig({ greeting: "x".repeat(61) }, "table")).field).toBe("config.greeting");
    expect(err(() => normalizeDisplayConfig({ mode: "tv" }, "fastfood")).field).toBe("config.mode");
    expect(readDisplayConfig({ mode: "raro", name: "CyT" })).toMatchObject({ mode: "billing", name: "CyT", loop: true, theme: { background: "#f4f7f8" } });
    // colores de cada elemento: fondo, textos, botones, pagado y lo recién añadido
    const th = normalizeDisplayConfig({ theme: { background: "#000000", buttonBg: "#FFCC00" } }, "table").theme;
    expect(th).toMatchObject({ background: "#000000", buttonBg: "#ffcc00", text: "#17262b", success: "#1c7a4a" });
    expect(err(() => normalizeDisplayConfig({ theme: { background: "negro" } }, "table")).field).toBe("config.theme.background");
    expect(err(() => normalizeDisplayConfig({ theme: { borde: "#000000" } }, "table")).field).toBe("config.theme.borde");
  });
  it("tipos de archivo admitidos", () => {
    expect(displayMediaKind("video/mp4")).toBe("video");
    expect(displayMediaKind("image/webp; charset=binary")).toBe("image");
    expect(err(() => displayMediaKind("text/html")).field).toBe("content-type");
  });
  it("horario: días, franja y cruce de medianoche", () => {
    const s = normalizeSchedule({ days: [5, 1, 5], from: "17:00", to: "20:00" }, "items[0]");
    expect(s.days).toEqual([1, 5]);
    expect(scheduleOn(s, 1, "18:30")).toBe(true);
    expect(scheduleOn(s, 1, "20:00")).toBe(false);
    expect(scheduleOn(s, 2, "18:30")).toBe(false);
    const night = normalizeSchedule({ from: "22:00", to: "02:00" }, "items[1]");
    expect([scheduleOn(night, 3, "23:10"), scheduleOn(night, 3, "01:59"), scheduleOn(night, 3, "12:00")]).toEqual([true, true, false]);
    expect(scheduleOn({ ...night, active: false }, 3, "23:10")).toBe(false);
    expect(err(() => normalizeSchedule({ days: [8] }, "items[2]")).field).toBe("items[2].days");
    expect(err(() => normalizeSchedule({ from: "25:00" }, "items[2]")).field).toBe("items[2].from");
  });
});
