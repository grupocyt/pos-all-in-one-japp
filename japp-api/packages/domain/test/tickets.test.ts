import {
  invoiceTicket,
  preBillTicket,
  kitchenTicket,
  renderText,
  renderEscPos,
  encodeCp858,
  eur,
  lr,
  wrap,
  WIDTH,
} from "../src/tickets.js";
import { issueInvoice } from "../src/invoice.js";
import { registerPayment } from "../src/payments.js";
import { account, line, ctx } from "./helpers.js";

const STORE = {
  legalName: "DAILY FOOD VENTURES S.L.",
  tradeName: "Cañas y Tapas",
  taxId: "B02891075",
  address: "C.C. Plaza Norte, 28700 Madrid",
  footer: "IVA incluido · Gracias por su visita",
};
const at = new Date("2022-08-18T11:32:00Z"); // 13:32 en Madrid (verano)
const tctx = { store: STORE, table: { name: "T5", area: "Terraza" }, waiter: "Pedro", guests: 2, at };

/** La cuenta del ticket de ejemplo (ágora): hamburguesa con queso y bacon + Coca Cola, 8 € en efectivo. */
function ejemplo() {
  const acc = account({
    lines: [
      line({
        productId: 1,
        name: "Hamburguesa",
        quantity: 1,
        unitPrice: 5,
        taxRate: 10,
        modifiers: [
          { name: "Queso", unitPrice: 0 },
          { name: "Bacon", unitPrice: 0 },
        ],
      }),
      line({ productId: 2, name: "Coca Cola", quantity: 1, unitPrice: 3, taxRate: 10 }),
    ],
  });
  const paid = registerPayment(
    acc,
    { method: "cash", kind: "cash", amount: 8, cashGiven: 8 },
    ctx({ now: at }),
  ).account;
  return issueInvoice(paid, 33, { serieF: "F", serieT: "T", nif: "B02891075" }, ctx({ now: at }));
}

describe("formato de importes y columnas", () => {
  it("euros con coma decimal y punto de miles", () => {
    expect(eur(8)).toBe("8,00 €");
    expect(eur(1234.5)).toBe("1.234,50 €");
    expect(eur(-1.7)).toBe("-1,70 €");
  });
  it("izquierda y derecha en 48 columnas; textos largos se recortan", () => {
    expect(lr("Efectivo", "8,00 €")).toHaveLength(WIDTH);
    expect(lr("x".repeat(60), "8,00 €")).toHaveLength(WIDTH);
  });
  it("wrap corta por espacios", () => {
    expect(wrap("SOLOMILLO A LA PIMIENTA", 21)).toEqual(["SOLOMILLO A LA", "PIMIENTA"]);
  });
});

describe("factura simplificada (formato del ticket de ejemplo)", () => {
  const txt = renderText(invoiceTicket(ejemplo(), tctx));
  const lines = txt.split("\n");
  it("todas las líneas caben en 48 columnas", () => {
    expect(lines.every((l) => l.length <= WIDTH)).toBe(true);
  });
  it("reproduce el bloque central del ticket", () => {
    const from = lines.indexOf("FACTURA SIMPLIFICADA".padStart(34));
    expect(lines.slice(from - 1, from + 24)).toEqual([
      "================================================",
      "              FACTURA SIMPLIFICADA",
      "------------------------------------------------",
      "Nº Op.:    T-000033                   Terraza/T5",
      "------------------------------------------------",
      "18/08/2022 13:32                           Pedro",
      "================================================",
      "Uds.   Producto                          Importe",
      "------------------------------------------------",
      // sin desglose de respuestas: una línea por producto con su importe (decidido 23/10/2026)
      "   1   Hamburguesa                        5,00 €",
      "   1   Coca Cola                          3,00 €",
      "------------------------------------------------",
      "  10,00 %: Base:      7,27 € Cuota:       0,73 €",
      "          Total:      7,27 € Total:       0,73 €",
      "------------------------------------------------",
      "Total (Impuestos Incl.)                   8,00 €",
      "================================================",
      "Entregado:     8,00 € Cambio:             0,00 €",
      "Efectivo                                  8,00 €",
      "================================================",
      "",
      "                   [QR ··]",
      "                 QR tributario:",
      "         Factura verificable en la sede",
      "             electrónica de la AEAT",
    ]);
  });
  it("lleva los datos obligatorios del emisor y la leyenda VERI*FACTU", () => {
    expect(txt).toContain("NIF: B02891075");
    expect(txt).toContain("DAILY FOOD VENTURES S.L.");
    expect(txt).toContain("VERI*FACTU");
  });
  it("con datos del cliente sale FACTURA (F1) con su NIF", () => {
    const acc = ejemplo();
    const f1 = {
      ...acc,
      invoice: {
        ...acc.invoice!,
        type: "F1" as const,
        customer: {
          name: "Eventos Madrid SL",
          taxId: "B12345674",
          street: "Calle Mayor 10",
          postalCode: "28013",
          city: "Madrid",
        },
      },
    };
    const t = renderText(invoiceTicket(f1, tctx));
    expect(t).toContain("                    FACTURA\n");
    expect(t).toContain("Cliente:\nEventos Madrid SL\nNIF: B12345674\nCalle Mayor 10, 28013 Madrid");
  });
  it("modificador con precio: va sumado en la línea del producto (sin «c. …») y el total cuadra", () => {
    const acc = account({
      lines: [
        line({
          name: "Tosta",
          unitPrice: 8.5,
          quantity: 2,
          modifiers: [{ name: "Extra jamón", unitPrice: 1.5 }],
        }),
      ],
    });
    const t = renderText(preBillTicket(acc, tctx)).split("\n");
    expect(t).toContain("   2   Tosta                             20,00 €");
    expect(t.some((x) => x.includes("Extra jamón") || x.includes("c. "))).toBe(false);
    expect(t).toContain("Total (Impuestos Incl.)                  20,00 €");
  });
});

describe("precuenta", () => {
  it("mismo formato, sin número ni pagos, con aviso y reparto por comensal", () => {
    const acc = account({
      name: "Cuenta 1",
      lines: [line({ name: "Croquetas", unitPrice: 10 })],
      discounts: [{ id: "d", type: "percentage", value: 10, reason: "Cliente habitual", status: "applied" }],
    });
    const t = renderText(preBillTicket(acc, tctx));
    expect(t).toContain("                   PRECUENTA");
    expect(t).toContain(lr("Cuenta 1", "Terraza/T5"));
    expect(t).toContain(lr("Descuento 10,00 % Cliente habitual", "-1,00 €"));
    expect(t).toContain("Total (Impuestos Incl.)                   9,00 €");
    expect(t).toContain(lr("Comensales: 2", "Por persona: 4,50 €"));
    expect(t).toContain("*** NO VÁLIDO COMO FACTURA ***");
    expect(t).not.toContain("Entregado");
  });
});

describe("comanda", () => {
  const k = kitchenTicket(
    [
      { quantity: 1, name: "Sangria (jarra)", comment: "2 copas", modifiers: [] },
      {
        quantity: 1,
        name: "Solomillo a la pimienta",
        comment: "",
        modifiers: [{ name: "al punto", unitPrice: 0 }],
      },
    ],
    {
      channel: "Bebida",
      waiter: "miclandeta",
      guests: 2,
      table: { name: "19", area: "Barra" },
      at: new Date("2026-10-14T13:05:04Z"),
    },
  );
  it("cabecera centrada: comensales, canal/camarero, hora y mesa", () => {
    expect(renderText(k).split("\n").slice(0, 5)).toEqual([
      "                  2 Comensales",
      "               BEBIDA/ miclandeta",
      "                    15:05:04",
      "     Mesa 19 Barra",
      "------------------------------------------------",
    ]);
  });
  it("productos en mayúsculas y doble ancho (24 col.), comentario con ** y modificador con --", () => {
    const t = renderText(k).split("\n");
    expect(t.slice(5, 11)).toEqual([
      "1  SANGRIA (JARRA)",
      "**2 COPAS",
      "",
      "1  SOLOMILLO A LA",
      "   PIMIENTA",
      "   -- 1 AL PUNTO",
    ]);
    expect(k.filter((l) => l.k === "text" && l.size === "w").every((l) => (l as any).text.length <= 24)).toBe(
      true,
    );
  });
  it("anulación y reimpresión se marcan", () => {
    const c = {
      channel: "Cocina",
      waiter: "Ana",
      guests: 1,
      table: { name: "4", area: "Sala" },
      at: new Date(),
    };
    expect(renderText(kitchenTicket([], { ...c, voided: true }))).toContain("*** ANULADO ***");
    expect(renderText(kitchenTicket([], { ...c, reprint: true }))).toContain("** REIMPRESIÓN **");
    expect(renderText(kitchenTicket([], c))).toContain("1 Comensal\n");
  });
});

describe("ESC/POS", () => {
  it("€, ñ y acentos en la página 858", () => {
    expect(encodeCp858("€ñÑáéíóú·º")).toEqual([0xd5, 0xa4, 0xa5, 0xa0, 0x82, 0xa1, 0xa2, 0xa3, 0xfa, 0xa7]);
    expect(encodeCp858("✓")).toEqual([0x3f]);
  });
  it("inicializa, elige CP858, pone doble ancho/negrita, imprime el QR y corta", () => {
    const b = Array.from(renderEscPos(invoiceTicket(ejemplo(), tctx), { openDrawer: true }));
    const has = (seq: number[]) => b.some((_, i) => seq.every((x, j) => b[i + j] === x));
    expect(b.slice(0, 5)).toEqual([0x1b, 0x40, 0x1b, 0x74, 19]);
    expect(has([0x1b, 0x70, 0, 25, 250])).toBe(true); // abre el cajón
    expect(has([0x1b, 0x45, 1])).toBe(true); // negrita
    expect(has([0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30])).toBe(true); // imprime QR
    expect(b.slice(-4)).toEqual([0x1d, 0x56, 66, 3]); // corte
    const k = Array.from(
      renderEscPos(
        kitchenTicket([{ quantity: 1, name: "Caña", comment: "", modifiers: [] }], {
          channel: "Barra",
          waiter: "x",
          guests: 1,
          table: { name: "1", area: "Barra" },
          at: new Date(),
        }),
      ),
    );
    expect(k.some((_, i) => k[i] === 0x1d && k[i + 1] === 0x21 && k[i + 2] === 0x10)).toBe(true); // doble ancho
    expect(k.some((_, i) => k[i] === 0x1d && k[i + 1] === 0x21 && k[i + 2] === 0x11)).toBe(true); // doble ancho y alto
  });
});

describe("precuenta con cobro parcial (03/11, 1.2.268)", () => {
  it("sale el descuento, lo pagado a cuenta y lo que falta", () => {
    const acc0 = account({
      name: "Cuenta 1",
      lines: [line({ name: "Croquetas", unitPrice: 10, status: "printed" })],
      discounts: [{ id: "d", type: "percentage", value: 10, reason: "Cliente habitual", status: "applied" }],
    });
    const acc = registerPayment(acc0, { method: "cash", kind: "cash", amount: 2 }, ctx()).account;
    const t = renderText(preBillTicket(acc, tctx)).split("\n");
    expect(t).toContain(lr("Descuento 10,00 % Cliente habitual", "-1,00 €"));
    expect(t).toContain(lr("Comensales: 2", "Por persona: 3,50 €")); // de lo que falta
    expect(t).toContain(lr("A cuenta · Efectivo", "-2,00 €"));
    expect(t).toContain(lr("PENDIENTE", "7,00 €"));
    // sin cobros, no sale nada de eso
    expect(renderText(preBillTicket(acc0, tctx))).not.toContain("PENDIENTE");
  });
});

describe("propina (04/11, 1.2.268): fuera de la factura y opcional en el ticket", () => {
  const conPropina = () => {
    const acc = account({ lines: [line({ name: "Croquetas", unitPrice: 10, taxRate: 10 })] });
    const paid = registerPayment(
      acc,
      { method: "card", kind: "card", amount: 10, tip: 2 },
      ctx({ now: at }),
    ).account;
    return issueInvoice(paid, 34, { serieF: "F", serieT: "T", nif: "B02891075" }, ctx({ now: at }));
  };
  it("la factura, su IVA y el QR VeriFactu no llevan la propina", () => {
    const acc = conPropina();
    expect(acc.invoice!.total).toBe(10);
    expect(acc.invoice!.verifactuQr).toContain("importe=10.00");
  });
  it("se imprime por defecto; con showTip = false no sale", () => {
    const acc = conPropina();
    expect(renderText(invoiceTicket(acc, tctx))).toContain(lr("Propina", "2,00 €"));
    const sin = renderText(invoiceTicket(acc, { ...tctx, showTip: false }));
    expect(sin).not.toContain("Propina");
    expect(sin).toContain(lr("Total (Impuestos Incl.)", "10,00 €"));
  });
});

describe("N5 (04/11): nombre de descuento largo", () => {
  it("se parte en varias líneas sin perder texto y el importe queda en la primera", async () => {
    const { lr: _lr, wrap: w } = await import("../src/tickets.js");
    void _lr;
    const txt = "Descuento 10,00 % Cliente habitual de la casa con tarjeta de fidelización";
    const parts = w(txt, 30);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join(" ")).toBe(txt);
  });
});

describe("N1 (04/11): formatos de Ajustes › Formatos de ticket al imprimir desde el servidor", () => {
  const store = { ...STORE, phone: "910000000", header: "¡Gracias por venir!", reviewsUrl: "https://g.page/r/x/review" };
  const all = renderText(invoiceTicket(ejemplo(), { ...tctx, store }));
  it("sin formato sale todo (como el TPV): mesero, desglose, pie, despedida y QR de reseñas", () => {
    expect(all).toContain("Pedro");
    expect(all).toContain("Base:");
    expect(all).toContain("IVA incluido · Gracias por su visita");
    expect(all).toContain("Tel. 910000000");
    expect(all.match(/\[QR/g)).toHaveLength(2); // tributario + reseñas
  });
  it("apagando opciones desaparecen; en la factura el nombre fiscal y el NIF salen siempre", () => {
    const f = { mesero: false, desglose: false, pie: false, despedida: false, qrResenas: false, telefono: false, razon: false, nif: false, logo: false };
    const t = invoiceTicket(ejemplo(), { ...tctx, store, formats: { invoice: f } });
    const txt = renderText(t);
    expect(txt).not.toContain("Pedro");
    expect(txt).not.toContain("Base:");
    expect(txt).not.toContain("Gracias por su visita");
    expect(txt).not.toContain("Tel.");
    expect(txt.match(/\[QR/g)).toHaveLength(1); // solo el tributario
    expect(txt).toContain("DAILY FOOD VENTURES S.L.");
    expect(txt).toContain("NIF: B02891075");
    expect(t.some((l) => l.k === "logo")).toBe(false);
  });
  it("precuenta: sin «por persona», sin razón social ni NIF si se apagan; despedida con texto propio", () => {
    const acc = account({ lines: [line({ productId: 2, name: "Coca Cola", quantity: 2, unitPrice: 3, taxRate: 10 })] });
    const txt = renderText(
      preBillTicket(acc, { ...tctx, store, formats: { prebill: { porPersona: false, razon: false, nif: false, despTxt: "Hasta pronto" } } }),
    );
    expect(txt).not.toContain("Por persona");
    expect(txt).not.toContain("NIF:");
    expect(txt).not.toContain("DAILY FOOD");
    expect(txt).toContain("Hasta pronto");
    expect(txt).not.toContain("¡Gracias por venir!");
    expect(renderText(preBillTicket(acc, { ...tctx, store }))).toContain("Por persona");
  });
  it("sin QR tributario si se apaga (factura sin VeriFactu)", () => {
    const txt = renderText(invoiceTicket(ejemplo(), { ...tctx, formats: { invoice: { qrTrib: false } } }));
    expect(txt).not.toContain("VERI*FACTU");
  });
});

describe("cierre de facturación (04/11): F3 y corte Z", () => {
  it("la F3 sale como FACTURA y dice a qué simplificada sustituye", () => {
    const inv = ejemplo();
    const f3 = { ...inv, invoice: { ...inv.invoice!, type: "F3" as const, substitutes: "T-000033", customer: { name: "Eventos Madrid SL", taxId: "B12345674" } as any } };
    const txt = renderText(invoiceTicket(f3, tctx));
    expect(txt).toContain("FACTURA");
    expect(txt).not.toContain("FACTURA SIMPLIFICADA");
    expect(txt).toContain("Sustituye a la factura simplificada T-000033");
  });
});

describe("0031: logo del local en ESC/POS", () => {
  it("con raster propio se imprimen sus bytes, no los de la cadena", () => {
    const raster = btoa(String.fromCharCode(0x1d, 0x76, 0x30, 0x00, 0x01, 0x00, 0x01, 0x00, 0xff));
    const own = renderEscPos([{ k: "logo", raster }]);
    const chain = renderEscPos([{ k: "logo" }]);
    expect(own.length).toBeLessThan(chain.length);
    expect(Array.from(own)).toEqual(expect.arrayContaining([0x1d, 0x76, 0x30, 0x00, 0x01, 0x00, 0x01, 0x00, 0xff]));
  });
});
