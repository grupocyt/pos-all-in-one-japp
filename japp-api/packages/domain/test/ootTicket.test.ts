import { ootQrTicket } from "../src/ootTicket.js";
import { renderText, renderEscPos } from "../src/tickets.js";
import { chainLogoRaster } from "../src/logo.js";

const ctx = {
  store: { chain: "Cañas y Tapas", name: "Nueva Sucursal Japp", legalName: "DAILY FOOD VENTURES S.L." },
  table: { name: "12", area: "Barra" },
  url: "https://pedir.canasytapas.com/t/oot_7KqABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij",
  token: "oot_7KqABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij",
  waiter: "Sistemas",
  at: new Date("2026-10-25T12:02:00Z"), // 13:02 en Madrid
};

describe("ticket del QR de Order on Table (ootQr), igual que la vista previa del TPV", () => {
  it("logo, cadena · local, PIDE DESDE TU MÓVIL, ÁREA · MESA N, QR, código de mesa y quién lo imprime", () => {
    const t = ootQrTicket(ctx);
    expect(t[0]).toEqual({ k: "logo" });
    expect(t.find((l) => l.k === "qr")).toEqual({ k: "qr", data: ctx.url });
    expect(t).toContainEqual({ k: "text", text: "BARRA · MESA 12", align: "center", bold: true, size: "wh" });
    expect(t).toContainEqual({
      k: "text",
      text: "PIDE DESDE TU MÓVIL",
      align: "center",
      bold: true,
      size: "w",
    });
    expect(t[t.length - 1]).toEqual({ k: "cut" });
    const txt = renderText(t);
    expect(txt).toContain("Cañas y Tapas · Nueva Sucursal Japp");
    expect(txt).toContain("Order on Table");
    expect(txt).toContain("Código de mesa: oot_-ghij");
    expect(txt).toContain("Válido solo para esta mesa mientras esté abierta");
    expect(txt).toMatch(/25\/10\/2026 13:02 +Sistemas/);
    expect(txt).not.toContain("https://"); // como la vista previa: solo el QR
  });

  it("sin cadena ni local usa el nombre fiscal; sin token no hay código de mesa", () => {
    const t = ootQrTicket({ ...ctx, store: { legalName: "DAILY FOOD VENTURES S.L." }, token: null });
    const txt = renderText(t);
    expect(txt).toContain("DAILY FOOD VENTURES S.L.");
    expect(txt).not.toContain("Código de mesa");
  });

  it("el logo sale en imagen (GS v 0) dentro de los bytes de la impresora; con logoFromPrinter=false, no", () => {
    const t = ootQrTicket(ctx);
    const logo = chainLogoRaster();
    expect([...logo.slice(0, 3)]).toEqual([0x1d, 0x76, 0x30]);
    const has = (b: Uint8Array) => {
      outer: for (let i = 0; i + 8 <= b.length; i++) {
        for (let j = 0; j < 8; j++) if (b[i + j] !== logo[j]) continue outer;
        return true;
      }
      return false;
    };
    expect(has(renderEscPos(t))).toBe(true);
    expect(has(renderEscPos(t, { logoFromPrinter: false }))).toBe(false);
  });
});
