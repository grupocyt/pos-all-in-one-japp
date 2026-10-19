import { ootQrTicket } from "../src/ootTicket.js";
import { renderText, renderEscPos } from "../src/tickets.js";

const ctx = {
  store: { legalName: "DAILY FOOD VENTURES S.L.", tradeName: "Cañas y Tapas" },
  table: { name: "101", area: "TERRAZA" },
  url: "https://pedir.canasytapas.com/t/oot_7KqABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij",
  at: new Date("2026-10-13T16:40:00Z"), // 18:40 en Madrid
};

describe("ticket del QR de Order on Table (ootQr)", () => {
  it("lleva la tienda, la mesa en grande, el QR con la URL y la URL en texto", () => {
    const t = ootQrTicket(ctx);
    expect(t.find((l) => l.k === "qr")).toEqual({ k: "qr", data: ctx.url });
    expect(t).toContainEqual({ k: "text", text: "Mesa 101 TERRAZA", align: "center", size: "wh" });
    expect(t[t.length - 1]).toEqual({ k: "cut" });
    const txt = renderText(t);
    expect(txt).toContain("Cañas y Tapas");
    expect(txt).toContain("PIDE DESDE TU MÓVIL");
    expect(txt).toContain("13/10/2026 18:40");
    // la URL cabe entera aunque sea más larga que el papel (se parte en trozos de 48)
    const urlText = t
      .filter((l) => l.k === "text" && /^(https|[\w-]+$)/.test(l.text))
      .map((l) => (l.k === "text" ? l.text : ""))
      .join("");
    expect(urlText).toBe(ctx.url);
  });

  it("sin nombre comercial usa el nombre fiscal y se puede mandar a la impresora", () => {
    const t = ootQrTicket({ ...ctx, store: { legalName: "DAILY FOOD VENTURES S.L." } });
    expect(renderText(t)).toContain("DAILY FOOD VENTURES S.L.");
    expect(renderEscPos(t).length).toBeGreaterThan(ctx.url.length);
  });
});
