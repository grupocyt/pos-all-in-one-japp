import {
  issueInvoice,
  invoiceType,
  formatInvoiceNumber,
  verifactuQrUrl,
  madridDate,
  seriesGaps,
} from "../src/invoice.js";
import { registerPayment } from "../src/payments.js";
import { preBill } from "../src/lines.js";
import { DomainError } from "../src/errors.js";
import { account, line, ctx } from "./helpers.js";

const CFG = { serieF: "F2026", serieT: "T2026", nif: "B12345678" };
const paidAcc = (over = {}) =>
  registerPayment(
    account({ lines: [line({ unitPrice: 11, taxRate: 10 })], ...over }),
    { method: "card", kind: "card", amount: 11 },
    ctx(),
  ).account;
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).code;
  }
  return "OK";
};

describe("factura", () => {
  it("número con serie y 6 dígitos", () => {
    expect(formatInvoiceNumber("T2026", 1426)).toBe("T2026-001426");
    expect(formatInvoiceNumber("F2026", 1234567)).toBe("F2026-1234567");
  });
  it("sin datos de cliente → F2 simplificada con serie T", () => {
    const a = issueInvoice(paidAcc(), 1426, CFG, ctx());
    expect(a.status).toBe("invoiced");
    expect(a.invoice).toMatchObject({
      type: "F2",
      series: "T2026",
      invoiceNumber: "T2026-001426",
      total: 11,
      taxes: [{ rate: 10, base: 10, tax: 1 }],
    });
  });
  it("con datos de cliente → F1 completa con serie F", () => {
    const cust = { name: "Hostelería Sol SL", taxId: "B87654321" };
    expect(invoiceType({ customerData: cust })).toBe("F1");
    const a = issueInvoice(paidAcc({ customerData: cust }), 319, CFG, ctx());
    expect(a.invoice).toMatchObject({ type: "F1", invoiceNumber: "F2026-000319", customer: cust });
  });
  it("cuenta a 0,00 € → NOTHING_TO_CHARGE al cobrar, facturar y pedir precuenta", () => {
    const zero = account({ lines: [line({ unitPrice: 0, taxRate: 10, status: "printed" })] });
    expect(code(() => registerPayment(zero, { method: "cash", kind: "cash", amount: 0 }, ctx()))).toBe(
      "NOTHING_TO_CHARGE",
    );
    expect(code(() => issueInvoice(zero, 1, CFG, ctx()))).toBe("NOTHING_TO_CHARGE");
    expect(code(() => preBill(zero))).toBe("NOTHING_TO_CHARGE");
    const invited = account({
      lines: [line({ unitPrice: 5, taxRate: 10 })],
      discounts: [
        {
          id: "d1",
          type: "percentage",
          value: 100,
          reason: "Invitación",
          status: "applied",
          amount: 5,
          baseAmount: 5,
        } as any,
      ],
    });
    expect(code(() => issueInvoice(invited, 1, CFG, ctx()))).toBe("NOTHING_TO_CHARGE");
  });
  it("con importe pendiente → PENDING_NOT_ZERO", () => {
    expect(code(() => issueInvoice(account({ lines: [line()] }), 1, CFG, ctx()))).toBe("PENDING_NOT_ZERO");
  });
  it("cuenta vacía → VALIDATION; ya facturada → ACCOUNT_CLOSED", () => {
    expect(code(() => issueInvoice(account(), 1, CFG, ctx()))).toBe("VALIDATION");
    const done = issueInvoice(paidAcc(), 1, CFG, ctx());
    expect(code(() => issueInvoice(done, 2, CFG, ctx()))).toBe("ACCOUNT_CLOSED");
  });
  // Cambio a propósito (15/10/2026, Jeison): una cuenta a 0,00 € no se cobra ni se factura.
  // Antes se permitía facturar una invitación al 100 %; ahora la invitación va por «Eliminar» con motivo Invitación.
  it("cuenta invitada al 100 % (total 0) NO se factura", () => {
    const a = account({
      lines: [line()],
      discounts: [{ id: "d", type: "percentage", value: 100, reason: "Invitación", status: "applied" }],
    });
    expect(code(() => issueInvoice(a, 5, CFG, ctx()))).toBe("NOTHING_TO_CHARGE");
  });
});

describe("QR VeriFactu", () => {
  it("URL de la AEAT con nif, número, fecha dd-mm-aaaa e importe con 2 decimales", () => {
    const u = new URL(verifactuQrUrl("B12345678", "T2026-001426", new Date("2026-10-13T12:00:00Z"), 74.7));
    expect(u.origin + u.pathname).toBe("https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      nif: "B12345678",
      numserie: "T2026-001426",
      fecha: "13-10-2026",
      importe: "74.70",
    });
  });
  it("la fecha es la de España: 23:30 UTC del 13 ya es día 14 en Madrid", () => {
    expect(madridDate(new Date("2026-10-13T23:30:00Z"))).toBe("14-10-2026");
    expect(madridDate(new Date("2026-12-31T22:59:00Z"))).toBe("31-12-2026"); // invierno UTC+1
    expect(madridDate(new Date("2026-12-31T23:00:00Z"))).toBe("01-01-2027");
  });
});

describe("serie sin huecos", () => {
  it("detecta huecos y repetidos", () => {
    expect(seriesGaps([1, 2, 3])).toEqual({ missing: [], repeated: [] });
    expect(seriesGaps([1, 2, 2, 5])).toEqual({ missing: [3, 4], repeated: [2] });
  });
});
