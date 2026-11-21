import { chainLogoRaster } from "./logo.js";
import { accountTotals, discountAmount, lineAmount } from "./totals.js";
import { r2, sum } from "./money.js";
import type { Account, Line, Payment } from "./types.js";

/**
 * Tickets impresos: factura (F1/F2), precuenta y comanda, con el formato de las impresoras de la cadena
 * (papel de 80 mm = 48 columnas con la letra normal; 24 con letra doble ancho).
 *
 * Se construyen como una lista de líneas neutras (TicketLine) y se pintan:
 * - en texto (renderText) para vista previa, pruebas y logs;
 * - en ESC/POS (renderEscPos) para la impresora térmica.
 */

export type Size = "n" | "w" | "h" | "wh"; // normal, doble ancho, doble alto, doble ancho y alto
export type TicketLine =
  | { k: "text"; text: string; align?: "left" | "center" | "right"; size?: Size; bold?: boolean }
  | { k: "rule"; ch: "=" | "-" }
  | { k: "feed"; n?: number }
  | { k: "qr"; data: string }
  | { k: "logo"; raster?: string }
  | { k: "cut" };

export const WIDTH = 48;

/** 1234.5 → «1.234,50 €» */
export function eur(n: number): string {
  const neg = n < 0;
  const [i, d] = Math.abs(n).toFixed(2).split(".");
  return `${neg ? "-" : ""}${i!.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${d} €`;
}
const pct = (n: number) => n.toFixed(2).replace(".", ",");
const padL = (s: string, w: number) => (s.length >= w ? s : " ".repeat(w - s.length) + s);
const padR = (s: string, w: number) => (s.length >= w ? s : s + " ".repeat(w - s.length));
/** Texto a la izquierda y a la derecha en una sola línea; si no cabe, recorta la izquierda. */
export function lr(left: string, right: string, width = WIDTH): string {
  const room = width - right.length - 1;
  const l = left.length > room ? left.slice(0, Math.max(0, room)) : left;
  return l + " ".repeat(Math.max(1, width - l.length - right.length)) + right;
}
/** Parte un texto en trozos de `width` columnas, cortando por espacios cuando se puede. */
export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > width) {
    let cut = rest.lastIndexOf(" ", width);
    if (cut < width * 0.5) {
      cut = width;
    }
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) {
    out.push(rest);
  }
  return out.length ? out : [""];
}
const two = (n: number) => String(n).padStart(2, "0");
/** Fecha y hora en Madrid (los tickets van en hora local de la tienda). */
export function madridParts(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("es-ES", {
      timeZone: "Europe/Madrid",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return {
    date: `${p.day}/${p.month}/${p.year}`,
    hm: `${p.hour}:${p.minute}`,
    hms: `${p.hour}:${p.minute}:${p.second}`,
  };
}

export interface StoreHeader {
  legalName: string;
  /** Nombre comercial en una línea (si no vienen chain/local). */
  tradeName?: string;
  /** Cadena («Cañas y Tapas») y local («Plaza Norte»): una línea «cadena · local», cada parte según el formato. */
  chain?: string;
  local?: string;
  taxId: string;
  address?: string;
  city?: string;
  phone?: string;
  /** Texto de la cabecera del local (Ajustes › Restaurante): sale abajo, grande, como despedida (igual que el TPV). */
  header?: string;
  footer?: string;
  logo?: boolean;
  /** Enlace de reseñas de Google: QR al final si el formato lo pide. */
  reviewsUrl?: string;
  /** 0031 · logo del local para la impresora (GS v 0 en base64, lo prepara el TPV); sin él, el de la cadena */
  logoRaster?: string;
}

/**
 * N1 (04/11, 1.2.268) · Formato de precuenta y factura de Ajustes › Formatos de ticket (store_parameters.ticket_formats).
 * Cada opción apagada (false) quita esa parte; lo que no viene, sale (los mismos valores por defecto que el TPV).
 * En la factura el nombre fiscal y el NIF salen siempre (obligatorios).
 */
export interface TicketFormat {
  logo?: boolean;
  cadena?: boolean;
  local?: boolean;
  razon?: boolean;
  nif?: boolean;
  direccion?: boolean;
  telefono?: boolean;
  mesero?: boolean;
  desglose?: boolean;
  porPersona?: boolean;
  pie?: boolean;
  despedida?: boolean;
  despTxt?: string;
  qrResenas?: boolean;
  qrTxt?: string;
  qrTrib?: boolean;
  cajon?: boolean;
  propina?: boolean;
  /* 1.2.268 · 05/11: cortes X y Z (Ajustes › Formatos, como la precuenta) */
  comensales?: boolean;
  ticketMedio?: boolean;
  /** venta bruta, IVA y venta neta */
  iva?: boolean;
  formasPago?: boolean;
  areas?: boolean;
  camareros?: boolean;
  descuentos?: boolean;
  eliminaciones?: boolean;
  abonos?: boolean;
  propinas?: boolean;
  caja?: boolean;
  /** solo Z: lo contado, la diferencia y el motivo */
  contado?: boolean;
  /* 1.2.268 · 05/11: comanda de anulación */
  /** «*** ANULADO ***» grande arriba */
  dibujo?: boolean;
  /** canal y camarero */
  camarero?: boolean;
  hora?: boolean;
  /** «ELIMINADO TRAS …» */
  momento?: boolean;
  motivo?: boolean;
  autoriza?: boolean;
  /** productos en doble ancho */
  grande?: boolean;
  noPreparar?: boolean;
}
export interface TicketFormats {
  prebill?: TicketFormat;
  invoice?: TicketFormat;
  /** 05/11 · corte X, corte Z y comanda de anulación */
  cutx?: TicketFormat;
  cutz?: TicketFormat;
  void?: TicketFormat;
  /** 11/11 (A8) · comanda: «local» = línea con el código y el nombre del local (para soporte) */
  kitchen?: TicketFormat;
}
/** 11/11 (D2) · partes del corte X que, si no están en el formato, no salen (el corte X normal: ventas, formas de pago y propinas). */
export const CUTX_SHORT_OFF: (keyof TicketFormat)[] = [
  "comensales",
  "ticketMedio",
  "iva",
  "areas",
  "camareros",
  "descuentos",
  "eliminaciones",
  "abonos",
  "caja",
];
export interface TicketContext {
  store: StoreHeader;
  table: { name: string; area: string };
  waiter: string;
  guests?: number;
  at: Date;
  paymentNames?: Record<string, string>; // cash → Efectivo
  /** Imprimir la propina en la factura (Ajustes › Formatos; 0027). La propina nunca es parte de la factura. */
  showTip?: boolean;
  /** N1 · formatos de Ajustes (precuenta y factura). Sin ellos, todo sale. */
  formats?: TicketFormats;
  /** 11/11 (A4) · fast food: nombre del cliente (solo el nombre, para llamarle) */
  customerName?: string | null;
}
const fmtOn = (f: TicketFormat | undefined, k: keyof TicketFormat) => f?.[k] !== false;
export const formatOn = fmtOn;

const T = (text: string, o: Omit<Extract<TicketLine, { k: "text" }>, "k" | "text"> = {}): TicketLine => ({
  k: "text",
  text,
  ...o,
});
const R = (ch: "=" | "-"): TicketLine => ({ k: "rule", ch });

/** Cabecera de la tienda: logo, nombre comercial, nombre fiscal, NIF y dirección; cada línea según el formato (en factura, nombre fiscal y NIF siempre). */
function storeBlock(s: StoreHeader, f?: TicketFormat, invoice = false): TicketLine[] {
  const out: TicketLine[] = [];
  if (s.logo !== false && fmtOn(f, "logo")) {
    out.push(s.logoRaster ? { k: "logo", raster: s.logoRaster } : { k: "logo" });
  }
  let trade = s.tradeName ?? "";
  if (s.chain || s.local) {
    const chain = s.chain && fmtOn(f, "cadena") ? s.chain : "";
    let local = s.local && fmtOn(f, "local") ? s.local : "";
    if (s.chain && local) {
      // «Cañas y Tapas · Plaza Norte» (sin repetir la cadena si el nombre del local ya empieza por ella).
      // 21/11 · con «Cadena» apagada también se quita del nombre del local: si no, salía igual (como en la vista previa del TPV)
      local = local.replace(
        new RegExp("^" + s.chain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*[·\\-–]?\\s*", "i"),
        "",
      );
    }
    trade = [chain, local].filter(Boolean).join(" · ");
  }
  if (trade) {
    wrap(trade, WIDTH).forEach((x) => out.push(T(x, { align: "center", bold: true })));
  }
  if (invoice || fmtOn(f, "razon")) {
    out.push(T(s.legalName, { align: "center" }));
  }
  if (invoice || fmtOn(f, "nif")) {
    out.push(T(`NIF: ${s.taxId}`, { align: "center" }));
  }
  if (s.address && fmtOn(f, "direccion")) {
    wrap(s.address, WIDTH).forEach((x) => out.push(T(x, { align: "center" })));
  }
  const city = fmtOn(f, "direccion") ? s.city : undefined;
  const phone = fmtOn(f, "telefono") ? s.phone : undefined;
  if (city || phone) {
    out.push(T([city, phone && `Tel. ${phone}`].filter(Boolean).join(" · "), { align: "center" }));
  }
  out.push({ k: "feed" });
  return out;
}

/** Final de precuenta y factura (como el TPV): pie, despedida (texto del formato o la cabecera del local) y QR de reseñas. */
function footBlock(s: StoreHeader, f?: TicketFormat): TicketLine[] {
  const out: TicketLine[] = [];
  if (s.footer && fmtOn(f, "pie")) {
    out.push({ k: "feed" });
    wrap(s.footer, WIDTH).forEach((x) => out.push(T(x, { align: "center" })));
  }
  const bye = (f?.despTxt || s.header || "").trim();
  if (bye && fmtOn(f, "despedida")) {
    out.push({ k: "feed" });
    wrap(bye, WIDTH / 2).forEach((x) => out.push(T(x, { align: "center", bold: true, size: "w" })));
  }
  if (s.reviewsUrl && fmtOn(f, "qrResenas")) {
    out.push({ k: "feed" });
    if ((f?.qrTxt ?? "").trim()) {
      wrap(f!.qrTxt!.trim(), WIDTH).forEach((x) => out.push(T(x, { align: "center" })));
    }
    out.push({ k: "qr", data: s.reviewsUrl });
  }
  return out;
}

/**
 * Cuerpo común de factura y precuenta: productos, descuentos, IVA y total.
 * Una línea por producto con su importe total, suplementos de sus respuestas incluidos (lineAmount). Las respuestas y
 * los pases del menú no se listan (decidido tras las pruebas en tienda, 23/10/2026): son desglose interno de cocina y
 * al cliente solo le importa qué paga por cada producto. La comanda (kitchenTicket) sí los sigue mostrando.
 */
function body(acc: Account, f?: TicketFormat, inv = false): TicketLine[] {
  const out: TicketLine[] = [T(lr("Uds.   Producto", "Importe")), R("-")];
  const AMT = 11;
  const NAME = WIDTH - 7 - AMT;
  for (const l of acc.lines) {
    const amount = eur(lineAmount(l));
    const names = wrap(l.name, NAME);
    out.push(T(padL(String(l.quantity), 4) + "   " + padR(names[0]!, NAME) + padL(amount, AMT)));
    names.slice(1).forEach((n) => out.push(T(" ".repeat(7) + n)));
  }
  out.push(R("-"));
  const tt = accountTotals(acc);
  for (const d of acc.discounts.filter((x) => x.status === "applied")) {
    const amt = discountAmount(d, tt.sub);
    // N5 (04/11): un nombre de descuento largo se parte en varias líneas (antes se recortaba); el importe va en la primera
    const right = "-" + eur(amt);
    const parts = wrap(
      `Descuento ${d.type === "percentage" ? pct(d.value) + " % " : ""}${d.reason}`.trim(),
      WIDTH - right.length - 1,
    );
    out.push(T(lr(parts[0]!, right)));
    parts.slice(1).forEach((p) => out.push(T(p)));
    // 1.2.292 · en la factura, lo rellenado en el «Formulario» del descuento (nombre, DNI…); en la precuenta no
    if (inv && d.formData?.length) {
      for (const x of d.formData) {
        wrap(`${x.label}: ${x.value}`, WIDTH - 2).forEach((p, i) => out.push(T((i ? "    " : "  ") + p)));
      }
    }
  }
  if (tt.disc) {
    out.push(R("-"));
  }
  // desglose de IVA: «  10,00 %: Base:      7,27 € Cuota:       0,73 €»
  const base = (rate: string, b: number, c: number, label = "Cuota:") =>
    padL(rate, 16) + padL(eur(b), 12) + " " + label + padL(eur(c), 13);
  if (fmtOn(f, "desglose")) {
    for (const x of tt.taxes) {
      out.push(T(base(`${pct(x.rate)} %: Base:`, x.base, x.tax)));
    }
    const sb = r2(sum(tt.taxes.map((x) => x.base)));
    const sc = r2(sum(tt.taxes.map((x) => x.tax)));
    out.push(T(base("Total:", sb, sc, "Total:"), { bold: true }), R("-"));
  }
  out.push(T(lr("Total (Impuestos Incl.)", eur(tt.total)), { bold: true }), R("="));
  return out;
}

function head(
  title: string,
  opLeft: string,
  opRight: string,
  ctx: TicketContext,
  f?: TicketFormat,
  invoice = false,
): TicketLine[] {
  const when = madridParts(ctx.at);
  return [
    ...storeBlock(ctx.store, f, invoice),
    R("="),
    T(title, { align: "center" }),
    R("-"),
    T(lr(opLeft, opRight), { bold: true }),
    R("-"),
    T(lr(`${when.date} ${when.hm}`, fmtOn(f, "mesero") ? ctx.waiter : "")),
    ...(ctx.customerName?.trim() ? [T(`Cliente: ${ctx.customerName.trim()}`, { bold: true })] : []),
    R("="),
  ];
}

const METHOD: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  bizum: "Bizum",
  voucher: "Vale",
  platform: "Plataforma",
};

/** Factura simplificada (F2) o completa (F1, con datos del cliente), con pagos, cambio y QR VeriFactu. */
export function invoiceTicket(acc: Account, ctx: TicketContext): TicketLine[] {
  const inv = acc.invoice;
  if (!inv) {
    throw new Error("La cuenta no tiene factura");
  }
  const f = ctx.formats?.invoice;
  const out = head(
    inv.type === "F2" ? "FACTURA SIMPLIFICADA" : "FACTURA",
    `Nº Op.:    ${inv.invoiceNumber}`,
    `${ctx.table.area}/${ctx.table.name}`,
    { ...ctx, at: new Date(inv.issuedAt) },
    f,
    true,
  );
  if (inv.type === "F3" && inv.substitutes) {
    // F1 (04/11): factura completa que sustituye a una simplificada (no mueve dinero)
    out.push(T(`Sustituye a la factura simplificada ${inv.substitutes}`, { bold: true }), R("-"));
  }
  if (inv.customer) {
    const c = inv.customer;
    out.push(T("Cliente:", { bold: true }), T(c.name), T(`NIF: ${c.taxId}`));
    const addr = [c.street, [c.postalCode, c.city].filter(Boolean).join(" "), c.province]
      .filter(Boolean)
      .join(", ");
    if (addr) {
      wrap(addr, WIDTH).forEach((x) => out.push(T(x)));
    }
    out.push(R("="));
  }
  out.push(...body(acc, f, true));
  const pays = acc.payments.filter((p: Payment) => p.status === "confirmed");
  const cash = pays.filter((p) => p.kind === "cash");
  if (cash.length) {
    const given = cash.reduce((a, p) => a + (p.cashGiven ?? p.amount), 0);
    const change = cash.reduce((a, p) => a + (p.change ?? 0), 0);
    out.push(
      T("Entregado:" + padL(eur(given), 11) + " Cambio:" + padL(eur(change), WIDTH - 29), { bold: true }),
    );
  }
  for (const p of pays) {
    out.push(
      T(lr(ctx.paymentNames?.[p.method] ?? METHOD[p.method] ?? p.method, eur(p.amount)), { bold: true }),
    );
  }
  const tips = pays.reduce((a, p) => a + p.tip, 0);
  if (tips && ctx.showTip !== false && fmtOn(f, "propina")) {
    out.push(T(lr("Propina", eur(tips))));
  }
  out.push(R("="));
  if (fmtOn(f, "qrTrib")) {
    out.push(
      { k: "feed" },
      { k: "qr", data: inv.verifactuQr },
      T("QR tributario:", { align: "center" }),
      T("Factura verificable en la sede", { align: "center" }),
      T("electrónica de la AEAT", { align: "center" }),
      T("VERI*FACTU", { align: "center", bold: true }),
    );
  }
  out.push(...footBlock(ctx.store, f));
  out.push({ k: "feed", n: 2 }, { k: "cut" });
  return out;
}

/** Abono (factura rectificativa por diferencias): lo que se abona de la factura original, en negativo. */
export interface CreditTicket {
  /** R1 (de una completa) o R5 (de una simplificada). */
  type: string;
  invoiceNumber: string;
  /** Número de la factura que rectifica. */
  rectifies: string;
  issuedAt: string;
  reason?: string | null;
  /** Unidades e importe abonado de cada línea (en positivo, como planCredit). */
  lines: { name: string; quantity: number; amount: number }[];
  /** Total e IVA del abono, ya en negativo (como se guardan). */
  total: number;
  taxes: { rate: number; base: number; tax: number }[];
  verifactuQr: string;
}

/** Ticket del abono: «FACTURA RECTIFICATIVA», a qué factura rectifica, líneas y total en negativo, IVA y QR VeriFactu. */
export function creditTicket(c: CreditTicket, ctx: TicketContext): TicketLine[] {
  const f = ctx.formats?.invoice;
  const out = head(
    "FACTURA RECTIFICATIVA",
    `Nº Op.:    ${c.invoiceNumber}`,
    `${ctx.table.area}/${ctx.table.name}`,
    { ...ctx, at: new Date(c.issuedAt) },
    f,
    true,
  );
  out.push(T(`Rectifica a: ${c.rectifies}`, { bold: true }));
  if (c.reason) {
    wrap(`Motivo: ${c.reason}`, WIDTH).forEach((x) => out.push(T(x)));
  }
  out.push(R("="), T(lr("Uds.   Producto", "Importe")), R("-"));
  const AMT = 11;
  const NAME = WIDTH - 7 - AMT;
  for (const l of c.lines) {
    const names = wrap(l.name, NAME);
    // el importe abonado resta: siempre con signo menos
    const amount = eur(-Math.abs(l.amount));
    out.push(T(padL(String(l.quantity), 4) + "   " + padR(names[0]!, NAME) + padL(amount, AMT)));
    names.slice(1).forEach((n) => out.push(T(" ".repeat(7) + n)));
  }
  out.push(R("-"));
  const base = (rate: string, b: number, q: number, label = "Cuota:") =>
    padL(rate, 16) + padL(eur(b), 12) + " " + label + padL(eur(q), 13);
  for (const x of c.taxes) {
    out.push(T(base(`${pct(x.rate)} %: Base:`, x.base, x.tax)));
  }
  const sb = r2(sum(c.taxes.map((x) => x.base)));
  const sc = r2(sum(c.taxes.map((x) => x.tax)));
  out.push(T(base("Total:", sb, sc, "Total:"), { bold: true }), R("-"));
  out.push(T(lr("Total (Impuestos Incl.)", eur(c.total)), { bold: true }), R("="));
  out.push(
    { k: "feed" },
    { k: "qr", data: c.verifactuQr },
    T("QR tributario:", { align: "center" }),
    T("Factura verificable en la sede", { align: "center" }),
    T("electrónica de la AEAT", { align: "center" }),
    T("VERI*FACTU", { align: "center", bold: true }),
  );
  out.push(...footBlock(ctx.store, f));
  out.push({ k: "feed", n: 2 }, { k: "cut" });
  return out;
}

/** Precuenta: el mismo formato que la factura, sin número ni pagos, y la advertencia de que no es factura. */
export function preBillTicket(acc: Account, ctx: TicketContext): TicketLine[] {
  const f = ctx.formats?.prebill;
  const out = head("PRECUENTA", `${acc.name}`, `${ctx.table.area}/${ctx.table.name}`, ctx, f);
  out.push(...body(acc, f));
  const tt = accountTotals(acc);
  // con cobros a cuenta, el reparto por comensal es de lo que falta
  const total = tt.paid > 0 ? tt.pending : tt.total;
  // 03/11 (1.2.268): con un cobro parcial, lo pagado a cuenta y lo que falta
  const paid = acc.payments.filter((p) => p.status === "confirmed");
  if (paid.length) {
    for (const p of paid) {
      const m = p.kind === "cash" ? "Efectivo" : p.kind === "card" ? "Tarjeta" : p.method;
      out.push(T(lr(`A cuenta · ${m}`, "-" + eur(p.amount))));
    }
    out.push(R("-"), T(lr("PENDIENTE", eur(tt.pending)), { bold: true }), R("="));
  }
  if (ctx.guests && ctx.guests > 1 && fmtOn(f, "porPersona")) {
    out.push(
      T(lr(`Comensales: ${ctx.guests}`, `Por persona: ${eur(Math.round((total / ctx.guests) * 100) / 100)}`)),
    );
  }
  out.push(T("*** NO VÁLIDO COMO FACTURA ***", { align: "center", bold: true }));
  out.push(...footBlock(ctx.store, f));
  out.push({ k: "feed", n: 2 }, { k: "cut" });
  return out;
}

export interface KitchenContext {
  channel: string;
  waiter: string;
  guests: number;
  table: { name: string; area: string };
  at: Date;
  reprint?: boolean;
  voided?: boolean;
  /** 11/11 (A8) · «JC01 · Cañas»: de qué local es la comanda (para soporte); sale si el formato no lo quita */
  store?: string;
  /** 11/11 (A4) · fast food: nombre del cliente, grande debajo de la mesa */
  customer?: string | null;
  format?: TicketFormat;
}

/**
 * Comanda para cocina/barra (formato de las fotos):
 *        2 Comensales
 *     BEBIDA/ miclandeta
 *        15:05:04          ← doble alto
 *     Mesa 19 Barra        ← doble ancho y alto
 *  ----------------------
 *  1  SANGRIA (JARRA)      ← doble ancho, en mayúsculas
 *  **2 COPAS               ← comentario
 *     -- 1 AL PUNTO        ← modificador
 */
export function kitchenTicket(
  lines: (Pick<Line, "quantity" | "name" | "comment" | "modifiers"> & { tag?: string; notes?: string[] })[],
  ctx: KitchenContext,
): TicketLine[] {
  const out: TicketLine[] = [
    T(`${ctx.guests} ${ctx.guests === 1 ? "Comensal" : "Comensales"}`, { align: "center" }),
    T(`${ctx.channel.toUpperCase()}/ ${ctx.waiter}`, { align: "center" }),
    T(madridParts(ctx.at).hms, { align: "center", size: "wh" }), // 1.2.296 · la hora, grande
    // 1.2.296 · en fast food no hay mesa: «Fast food · CAJA1» en letra normal; lo grande es el nombre del cliente
    /^ff-/i.test(ctx.table.name) || /^fast ?food$/i.test(ctx.table.area)
      ? T(
          /^fast ?food$/i.test(ctx.table.name.replace(/^ff-/i, "")) ? "Fast food" : `Fast food · ${ctx.table.name.replace(/^ff-/i, "")}`,
          { align: "center" },
        )
      : T(`Mesa ${ctx.table.name} ${ctx.table.area}`, { align: "center", size: "wh" }),
  ];
  if (ctx.customer?.trim()) {
    out.push(T(ctx.customer.trim().toUpperCase(), { align: "center", size: "wh", bold: true }));
  }
  if (ctx.store?.trim() && fmtOn(ctx.format, "local")) {
    out.unshift(T(ctx.store.trim(), { align: "center" }));
  }
  if (ctx.voided) {
    out.push(T("*** ANULADO ***", { align: "center", size: "wh", bold: true }));
  } else if (ctx.reprint) {
    out.push(T("** REIMPRESIÓN **", { align: "center", bold: true }));
  }
  out.push(R("-"));
  const W2 = WIDTH / 2;
  lines.forEach((l, i) => {
    if (i) {
      out.push({ k: "feed" });
    }
    if (l.tag) {
      out.push(T(`>> ${l.tag}`, { bold: true }));
    }
    const q = String(l.quantity);
    const pre = q + " ".repeat(Math.max(2, 3 - q.length));
    const parts = wrap(l.name.toUpperCase(), W2 - pre.length);
    out.push(T(pre + parts[0], { size: "w" }));
    parts.slice(1).forEach((p) => out.push(T(" ".repeat(pre.length) + p, { size: "w" })));
    if (l.comment?.trim()) {
      wrap("**" + l.comment.trim().toUpperCase(), WIDTH).forEach((x) => out.push(T(x)));
    }
    for (const m of l.modifiers) {
      out.push(T(`   -- ${(m.quantity ?? 1) * l.quantity} ${m.name.toUpperCase()}`));
    }
    for (const n of l.notes ?? []) {
      wrap(`   (${n})`, WIDTH).forEach((x) => out.push(T(x)));
    }
  });
  out.push({ k: "feed", n: 3 }, { k: "cut" });
  return out;
}

/** Lo que lleva el ticket de una anulación (una línea eliminada después de enviarla). */
export interface VoidTicketData {
  table: { name: string; area: string };
  product: string;
  quantity: number;
  /** importe anulado (con los suplementos de sus respuestas), en positivo */
  amount: number;
  reason: string;
  /** quién la eliminó */
  user: string;
  /** quién autorizó (encargado), si hizo falta */
  authorizedBy?: string | null;
  at: Date;
}

/**
 * Ticket de anulación (para el encargado / control): «ANULACIÓN» en grande, mesa, producto y unidades, motivo,
 * quién la eliminó y quién autorizó, e importe anulado en negativo.
 */
export function voidTicket(
  v: VoidTicketData,
  store?: Pick<StoreHeader, "tradeName" | "legalName">,
): TicketLine[] {
  const when = madridParts(v.at);
  const out: TicketLine[] = [];
  if (store) {
    out.push(T(store.tradeName || store.legalName, { align: "center", bold: true }));
  }
  out.push(
    T("ANULACIÓN", { align: "center", size: "wh", bold: true }),
    R("="),
    T(lr(`Mesa ${v.table.name} ${v.table.area}`.trim(), `${when.date} ${when.hm}`), { bold: true }),
    R("-"),
  );
  const AMT = 11;
  const NAME = WIDTH - 7 - AMT;
  const names = wrap(v.product, NAME);
  out.push(
    T(padL(String(v.quantity), 4) + "   " + padR(names[0]!, NAME) + padL(eur(-Math.abs(v.amount)), AMT)),
  );
  names.slice(1).forEach((n) => out.push(T(" ".repeat(7) + n)));
  out.push(R("-"));
  wrap(`Motivo: ${v.reason}`, WIDTH).forEach((x) => out.push(T(x)));
  out.push(T(`Eliminado por: ${v.user}`));
  if (v.authorizedBy) {
    out.push(T(`Autorizado por: ${v.authorizedBy}`));
  }
  out.push(R("="), T(lr("Importe anulado", eur(-Math.abs(v.amount))), { bold: true }));
  out.push({ k: "feed", n: 3 }, { k: "cut" });
  return out;
}

/** Lo que lleva un corte X (lectura sin cerrar) o Z (cierre del periodo). */
export interface CutTicketData {
  kind: "X" | "Z";
  /** cabecera: con logoRaster, chain y local sale como la precuenta (05/11); sin ellos, el nombre comercial */
  store: Pick<StoreHeader, "tradeName" | "legalName" | "taxId"> & Partial<StoreHeader>;
  /** estación o caja del corte */
  station?: string;
  from: Date;
  to: Date;
  /** ventas por forma de pago (nombre como en Ajustes), con cuántos cobros si se sabe */
  byMethod: { name: string; amount: number; count?: number }[];
  tickets: number;
  expectedCash: number;
  /** número de cierre (solo Z), si lo hay */
  closingNumber?: number | null;
  user: string;
  /** 11 (04/11): en el Z, lo contado al cerrar, la diferencia con lo esperado y el motivo */
  counted?: {
    cash: number;
    card?: number | null;
    difference: number;
    note?: string | null;
    /** 11/11 (D2) · lo que marcó cada datáfono */
    cards?: { name: string; amount: number }[] | null;
    /** tarjeta que espera el sistema (para comparar con los datáfonos) */
    expectedCard?: number | null;
    /** fondo que se queda y lo que se deposita (cierre) */
    nextFloat?: number | null;
    deposit?: number | null;
    /** 1.2.292 · cierre: lo contado de cada forma de pago dada de alta y lo que dice el sistema */
    methods?: { name: string; counted: number; expected: number | null }[] | null;
  } | null;
  /** 11/11 (D2) · resumen impreso después del arqueo: todas las partes y el arqueo (cabecera según el corte X) */
  arqueo?: boolean;
  /** N3: propinas en efectivo (están en el cajón, no son venta) */
  cashTips?: number;
  /* 05/11 · el mismo contenido que la vista previa del TPV (cada parte según el formato) */
  guests?: number;
  /** venta bruta (IVA incluido) e IVA */
  gross?: number;
  tax?: number;
  byArea?: { name: string; tickets: number; amount: number }[];
  byWaiter?: { name: string; tickets: number; amount: number }[];
  discounts?: {
    name: string;
    count: number;
    amount: number;
    items?: { at: Date; number: string; table: string; amount: number; by: string; auth?: string | null }[];
  }[];
  voids?: {
    at: Date;
    qty: number;
    name: string;
    amount: number;
    reason: string;
    by: string;
    auth?: string | null;
    table?: string;
    stage?: "printed" | "preBill";
  }[];
  credits?: { number: string; amount: number; ref?: string | null }[];
  tips?: number;
  cash?: {
    float: number;
    cashSales: number;
    withdrawals: number;
    deposits?: number;
    card: number;
    creditsCash?: number;
  };
  /** Ajustes › Formatos › Corte X / Corte Z */
  format?: TicketFormat;
}

/**
 * Corte X / Corte Z (48 columnas), línea a línea igual que la vista previa del TPV (05/11): cabecera con el logo del
 * local, periodo, ventas (tickets, comensales, ticket medio, venta bruta, IVA y neta), formas de pago, áreas y camareros
 * (solo X), descuentos, eliminaciones, abonos, propinas, caja y, en el Z, el arqueo. Cada parte se quita en Ajustes › Formatos.
 */
export function cutTicket(c: CutTicketData): TicketLine[] {
  const f = c.format;
  // 11/11 · el corte X normal: lo que no está en el formato y es de CUTX_SHORT_OFF no sale; el resumen del arqueo lleva todo
  const on = (k: keyof TicketFormat) =>
    c.arqueo
      ? true
      : c.kind === "X" && f?.[k] === undefined && CUTX_SHORT_OFF.includes(k)
        ? false
        : fmtOn(f, k);
  const from = madridParts(c.from);
  const to = madridParts(c.to);
  const z = c.kind === "Z";
  const out: TicketLine[] = [];
  // cabecera: logo, cadena · local (razón social, NIF, dirección y teléfono solo si el formato los pide)
  const hf: TicketFormat = { razon: false, nif: false, direccion: false, telefono: false, ...(f ?? {}) };
  out.push(...storeBlock({ ...c.store, logo: c.store.logo ?? true }, hf).filter((l) => l.k !== "feed"));
  out.push(
    R("="),
    T(z ? "CORTE Z · FIN DE DÍA" : c.arqueo ? "ARQUEO · RESUMEN DE CAJA" : "CORTE X · RESUMEN DE VENTA", {
      align: "center",
      bold: true,
    }),
    T(z ? "(periodo cerrado)" : "(no cierra el periodo) · Lectura sin cierre", { align: "center" }),
  );
  if (z && c.closingNumber != null) {
    out.push(T(`Z nº ${String(c.closingNumber).padStart(4, "0")}`, { align: "center", bold: true }));
  }
  out.push(
    R("-"),
    T(lr(`Desde: ${from.date} ${from.hm}`, `Hasta: ${to.hm}`)),
    T(lr(`Estación: ${c.station ?? ""}`, `Por: ${c.user}`)),
    R("="),
  );
  const H = { bold: true };
  const sec = (title: string) => out.push({ k: "feed" }, T(title, H), R("-"));
  const gross = c.gross ?? r2(sum(c.byMethod.map((m) => m.amount)));
  const tax = c.tax ?? 0;
  const net = r2(gross - tax);
  sec("VENTAS");
  out.push(T(lr("TICKETS", String(c.tickets)), H));
  if (on("comensales") && c.guests != null) {
    out.push(T(lr("COMENSALES", String(c.guests)), H));
  }
  if (on("ticketMedio")) {
    out.push(T(lr("TICKET MEDIO (NETO)", eur(c.tickets ? r2(net / c.tickets) : 0)), H));
  }
  if (on("iva")) {
    out.push(
      R("-"),
      T(lr("VENTA BRUTA", eur(gross))),
      T(lr("- IVA", eur(-tax))),
      T(lr("= VENTA NETA", eur(net)), { size: "h", bold: true }),
    );
  } else {
    out.push(R("-"), T(lr("Total ventas", eur(gross)), H));
  }
  if (on("formasPago") && c.byMethod.length) {
    sec("POR FORMA DE PAGO   (nº · importe)");
    [...c.byMethod]
      .sort((a, b) => b.amount - a.amount)
      .forEach((m) => out.push(T(lr(`${padL(String(m.count ?? ""), 3)}  ${m.name}`, eur(m.amount)), H)));
    out.push(R("-"), T(lr("TOTAL (= venta bruta)", eur(r2(sum(c.byMethod.map((m) => m.amount))))), H));
  }
  if (on("areas") && !z && c.byArea?.length) {
    sec("POR ÁREA   (tickets · importe)");
    c.byArea.forEach((a) => out.push(T(lr(`${padL(String(a.tickets), 4)}  ${a.name}`, eur(a.amount)))));
  }
  if (on("camareros") && !z && c.byWaiter?.length) {
    sec("POR CAMARERO   (tickets · ticket medio)");
    [...c.byWaiter]
      .sort((a, b) => b.amount / (b.tickets || 1) - a.amount / (a.tickets || 1))
      .forEach((w) =>
        out.push(
          T(lr(`${padL(String(w.tickets), 4)}  ${w.name}`, eur(w.tickets ? r2(w.amount / w.tickets) : 0))),
        ),
      );
  }
  if (on("descuentos") && c.discounts?.length) {
    sec("DESCUENTOS");
    for (const d of c.discounts) {
      out.push(T(lr(`${d.name} (${d.count})`, eur(d.amount)), H));
      for (const x of d.items ?? []) {
        out.push(T(lr(`  ${madridParts(x.at).hm}  ${x.number}`, eur(x.amount))));
        wrap(`Mesa ${x.table || "—"} · Aplicó: ${x.by}${x.auth ? ` · Autorizó: ${x.auth}` : ""}`, 40).forEach(
          (y) => out.push(T("        " + y)),
        );
      }
      out.push({ k: "feed" });
    }
  }
  if (on("eliminaciones") && c.voids?.length) {
    sec("ELIMINACIONES");
    const groups: [string, NonNullable<CutTicketData["voids"]>][] = z
      ? [["TRAS LA PRECUENTA", c.voids.filter((v) => v.stage === "preBill")]]
      : [
          ["TRAS ENVIAR A COCINA", c.voids.filter((v) => v.stage !== "preBill")],
          ["TRAS LA PRECUENTA", c.voids.filter((v) => v.stage === "preBill")],
        ];
    for (const [label, L] of groups) {
      if (!L.length) {
        continue;
      }
      out.push(T(lr(`${label} (${sum(L.map((v) => v.qty))} uds.)`, eur(r2(sum(L.map((v) => v.amount))))), H));
      if (z) {
        continue;
      }
      for (const v of L) {
        out.push(T(lr(`  ${madridParts(v.at).hm}  ${v.qty} ${v.name}`, eur(v.amount))));
        out.push(T(`        Mesa ${v.table || "—"} · ${v.reason || "—"}`.slice(0, WIDTH)));
        wrap(`Eliminó: ${v.by || "—"}${v.auth ? ` · Autorizó: ${v.auth}` : ""}`, 40).forEach((y) =>
          out.push(T("        " + y)),
        );
      }
      out.push({ k: "feed" });
    }
  }
  if (on("abonos") && c.credits?.length) {
    sec("ABONOS");
    c.credits.forEach((x) => out.push(T(lr(`${x.number}${x.ref ? " ← " + x.ref : ""}`, eur(x.amount)))));
    out.push(R("-"), T(lr("TOTAL ABONOS", eur(r2(sum(c.credits.map((x) => x.amount))))), H));
  }
  if (on("propinas") && (c.tips || c.cashTips)) {
    sec("PROPINAS (no son venta)");
    if (c.tips) {
      out.push(T(lr("Propinas", eur(c.tips))));
    }
    if (c.cashTips) {
      out.push(T(lr("Propinas en efectivo", eur(c.cashTips))));
    }
  }
  if (on("caja")) {
    sec("CAJA (EFECTIVO)");
    if (c.cash) {
      out.push(
        T(lr("Fondo inicial", eur(c.cash.float))),
        T(lr("+ Ventas en efectivo", eur(c.cash.cashSales))),
      );
      if (c.cashTips) {
        out.push(T(lr("+ Propinas en efectivo", eur(c.cashTips))));
      }
      if (c.cash.creditsCash) {
        out.push(T(lr("- Abonos en efectivo", eur(c.cash.creditsCash))));
      }
      if (c.cash.withdrawals) {
        out.push(T(lr("- Traslados a caja fuerte", eur(c.cash.withdrawals)))); // 1.2.274 · el retiro es solo eso
      }
      if (c.cash.deposits) {
        out.push(T(lr("+ Ingresos", eur(c.cash.deposits))));
      }
    }
    out.push(T(lr("= Efectivo esperado", eur(c.expectedCash)), H));
    if (c.cash) {
      out.push(T(lr("Tarjeta y otros (menos abonos)", eur(c.cash.card))));
    }
  }
  if (c.counted && (c.arqueo || on("contado"))) {
    out.push({ k: "feed" }, T(c.arqueo ? "ARQUEO" : "ARQUEO DE CIERRE", H), R("-"));
    out.push(T(lr("Efectivo esperado", eur(c.expectedCash))), T(lr("Efectivo contado", eur(c.counted.cash))));
    const cards = c.counted.cards ?? [];
    // 1.2.274 · auditoría: cada datáfono con su nombre, aunque sea uno solo
    if (cards.length > 1 || (c.arqueo && cards.length === 1)) {
      cards.forEach((x) => out.push(T(lr(`  ${x.name}`, eur(x.amount)))));
    }
    if (c.counted.card != null) {
      out.push(T(lr(cards.length > 1 ? "Total datáfonos" : "Tarjeta contada", eur(c.counted.card))));
      if (c.counted.expectedCard != null) {
        const dc = r2(c.counted.card - c.counted.expectedCard);
        out.push(T(lr("Tarjeta en el sistema", eur(c.counted.expectedCard))));
        out.push(
          T(lr("Diferencia tarjeta", Math.abs(dc) < 0.005 ? "cuadra" : (dc > 0 ? "+" : "") + eur(dc))),
        );
      }
    }
    const d = c.counted.difference;
    out.push(T(lr("Diferencia", Math.abs(d) < 0.005 ? "cuadra" : (d > 0 ? "+" : "") + eur(d)), H));
    if ((c.counted.note ?? "").trim()) {
      wrap(`Motivo: ${c.counted.note!.trim()}`, WIDTH).forEach((x) => out.push(T(x)));
    }
    if (c.counted.methods?.length) {
      out.push(R("-"), T("CONTADO POR FORMA DE PAGO", H));
      for (const m of c.counted.methods) {
        const d = m.expected == null ? null : r2(m.counted - m.expected);
        const tail = d == null ? "" : Math.abs(d) < 0.005 ? "  cuadra" : `  ${d > 0 ? "+" : ""}${eur(d)}`;
        out.push(T(lr(m.name.slice(0, 20), eur(m.counted) + tail)));
      }
    }
    if (c.counted.nextFloat != null) {
      out.push(R("-"), T(lr("Fondo para el día siguiente", eur(c.counted.nextFloat))));
      out.push(T(lr("A depositar", eur(c.counted.deposit ?? 0)), H));
    }
  }
  out.push(R("="), T(`Impreso ${to.date} ${to.hms}`, { align: "center" }));
  out.push({ k: "feed", n: 3 }, { k: "cut" });
  return out;
}

/** Texto plano (vista previa, pruebas, log). Las líneas de doble ancho ocupan la mitad de columnas. */
export function renderText(lines: TicketLine[], width = WIDTH): string {
  const out: string[] = [];
  for (const l of lines) {
    if (l.k === "rule") {
      out.push(l.ch.repeat(width));
    } else if (l.k === "feed") {
      for (let i = 0; i < (l.n ?? 1); i++) {
        out.push("");
      }
    } else if (l.k === "qr") {
      out.push(" ".repeat((width - 10) / 2) + "[QR " + "·".repeat(2) + "]");
    } else if (l.k === "logo") {
      out.push(" ".repeat((width - 6) / 2) + "[LOGO]");
    } else if (l.k === "cut") {
      out.push("✂" + "-".repeat(width - 1));
    } else {
      const w = l.size === "w" || l.size === "wh" ? width / 2 : width;
      const s = l.text.length > w ? l.text.slice(0, w) : l.text;
      const pad = w - s.length;
      out.push(
        l.align === "center"
          ? " ".repeat(Math.floor(pad / 2)) + s
          : l.align === "right"
            ? " ".repeat(pad) + s
            : s,
      );
    }
  }
  return out.map((x) => x.replace(/\s+$/, "")).join("\n");
}

/* ---------------- ESC/POS ---------------- */

/** Página de códigos 858 (como la 850 pero con €): la que usan las Epson TM con textos en español y catalán. */
const CP858: Record<string, number> = {
  Ç: 0x80,
  ü: 0x81,
  é: 0x82,
  â: 0x83,
  ä: 0x84,
  à: 0x85,
  ç: 0x87,
  ê: 0x88,
  ë: 0x89,
  è: 0x8a,
  ï: 0x8b,
  î: 0x8c,
  ì: 0x8d,
  Ä: 0x8e,
  É: 0x90,
  ô: 0x93,
  ö: 0x94,
  ò: 0x95,
  û: 0x96,
  ù: 0x97,
  Ö: 0x99,
  Ü: 0x9a,
  "×": 0x9e,
  á: 0xa0,
  í: 0xa1,
  ó: 0xa2,
  ú: 0xa3,
  ñ: 0xa4,
  Ñ: 0xa5,
  ª: 0xa6,
  º: 0xa7,
  "¿": 0xa8,
  "¡": 0xad,
  Á: 0xb5,
  Â: 0xb6,
  À: 0xb7,
  "€": 0xd5,
  Ê: 0xd2,
  È: 0xd4,
  Í: 0xd6,
  Ï: 0xd8,
  Ì: 0xde,
  Ó: 0xe0,
  Ò: 0xe3,
  Ú: 0xe9,
  Ù: 0xeb,
  "·": 0xfa,
  "–": 0x2d,
  "—": 0x2d,
  "‘": 0x27,
  "’": 0x27,
  "“": 0x22,
  "”": 0x22,
  "…": 0x2e,
};
export function encodeCp858(s: string): number[] {
  const out: number[] = [];
  for (const ch of s.normalize("NFC")) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x20 && c < 0x7f) {
      out.push(c);
    } else {
      out.push(CP858[ch] ?? 0x3f);
    } // «?» si la impresora no tiene ese carácter
  }
  return out;
}

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;
export interface EscPosOptions {
  width?: number;
  openDrawer?: boolean;
  /** false = sin logo. Por defecto se imprime el logo de la cadena en imagen. */
  logoFromPrinter?: boolean;
  /** Otro logo ya en «GS v 0» (por defecto, el de la cadena). */
  logoRaster?: Uint8Array;
  qrSize?: number;
}

/** Bytes listos para mandar a la impresora (TCP 9100, USB o serie). */
export function renderEscPos(lines: TicketLine[], o: EscPosOptions = {}): Uint8Array {
  const w = o.width ?? WIDTH;
  const b: number[] = [ESC, 0x40, ESC, 0x74, 19]; // inicializar + CP858
  if (o.openDrawer) {
    b.push(ESC, 0x70, 0, 25, 250);
  }
  const align = (a?: string) => b.push(ESC, 0x61, a === "center" ? 1 : a === "right" ? 2 : 0);
  for (const l of lines) {
    if (l.k === "text") {
      align(l.align);
      b.push(GS, 0x21, l.size === "w" ? 0x10 : l.size === "h" ? 0x01 : l.size === "wh" ? 0x11 : 0x00);
      b.push(ESC, 0x45, l.bold ? 1 : 0, ...encodeCp858(l.text), LF);
      b.push(GS, 0x21, 0, ESC, 0x45, 0);
    } else if (l.k === "rule") {
      align("left");
      b.push(...encodeCp858(l.ch.repeat(w)), LF);
    } else if (l.k === "feed") {
      b.push(ESC, 0x64, l.n ?? 1);
    } else if (l.k === "logo") {
      // logo de la cadena en imagen (GS v 0), igual que la vista previa; logoFromPrinter=false → sin logo
      if (o.logoFromPrinter !== false) {
        align("center");
        const own = l.raster ? Uint8Array.from(atob(l.raster), (c) => c.charCodeAt(0)) : null;
        b.push(...(own ?? o.logoRaster ?? chainLogoRaster()), LF);
      }
    } else if (l.k === "qr") {
      const d = encodeCp858(l.data);
      const n = d.length + 3;
      align("center");
      b.push(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0); // modelo 2
      b.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, o.qrSize ?? 5); // tamaño del módulo
      b.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31); // corrección M
      b.push(GS, 0x28, 0x6b, n & 0xff, n >> 8, 0x31, 0x50, 0x30, ...d); // guardar datos
      b.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30, LF); // imprimir
    } else if (l.k === "cut") {
      b.push(GS, 0x56, 66, 3);
    } // avanzar y corte parcial
  }
  return Uint8Array.from(b);
}

/**
 * 0037 (16/11/2026, auditoría) · Ticket corto del corte X contado en pantalla: lo contado (efectivo y cada datáfono),
 * lo esperado, la diferencia, los retiros a caja fuerte y las propinas confirmadas. El detallado (todas las partes del
 * corte) se imprime desde Movimiento de caja (POST /cash/counts/{id}/print).
 */
export interface CutXCountData {
  store: Pick<StoreHeader, "tradeName" | "legalName" | "taxId"> & Partial<StoreHeader>;
  station?: string;
  at: Date;
  user: string;
  /** cortex o auditoria (el título cambia) */
  type: "cortex" | "auditoria" | "arqueo" | "apertura";
  float: number;
  withdrawals: number;
  deposits: number;
  cash: { counted: number; expected: number; difference: number };
  cards: { name: string; amount: number }[];
  card: { counted: number | null; expected: number; difference: number | null };
  tips: { cash: number; card: number; confirmed: boolean };
  note?: string | null;
  threshold?: number;
  /** 21/11 · Ajustes › Formatos › Corte X: cabecera, «Formas de pago» (tarjetas), «Propinas» y «Caja» (detalle del efectivo) */
  format?: TicketFormat;
}
export function cutXCountTicket(c: CutXCountData): TicketLine[] {
  const at = madridParts(c.at);
  const H = { bold: true };
  const st = (d: number | null) => (d == null ? "—" : Math.abs(d) < 0.005 ? "CUADRA" : d > 0 ? `SOBRA ${eur(d)}` : `FALTA ${eur(-d)}`);
  const title =
    c.type === "auditoria" ? "ARQUEO DE AUDITORÍA" : c.type === "apertura" ? "APERTURA · BASE CONTADA" : "CORTE X · ARQUEO";
  const out: TicketLine[] = [];
  // 21/11 · solo sale lo que está activo en Ajustes › Formatos › Corte X (la cabecera como en el resto de tickets)
  const f = c.format;
  const on = (k: keyof TicketFormat) => fmtOn(f, k);
  const hf: TicketFormat = { razon: false, nif: false, direccion: false, telefono: false, ...(f ?? {}) };
  out.push(...storeBlock({ ...c.store, logo: c.store.logo ?? true }, hf).filter((l) => l.k !== "feed"));
  out.push(
    R("="),
    T(title, { align: "center", bold: true }),
    T(lr(`${at.date} ${at.hm}`, `Por: ${c.user}`)),
    ...(c.station ? [T(`Estación: ${c.station}`)] : []),
    R("="),
  );
  out.push(T("EFECTIVO", H), R("-"), T(lr("Contado", eur(c.cash.counted)), H), T(lr("Esperado", eur(c.cash.expected))));
  if (on("caja")) {
    out.push(T(lr("  Base", eur(c.float))));
    if (c.withdrawals) {
      out.push(T(lr("  Traslados a caja fuerte", eur(-c.withdrawals))));
    }
    if (c.deposits) {
      out.push(T(lr("  Ingresos a caja", eur(c.deposits))));
    }
  }
  out.push(T(lr("Diferencia", st(c.cash.difference)), H));
  if (c.type !== "apertura" && on("formasPago")) {
    out.push({ k: "feed" }, T("TARJETAS (DATÁFONOS)", H), R("-"));
    for (const x of c.cards) {
      out.push(T(lr(x.name, eur(x.amount))));
    }
    out.push(
      T(lr("Total contado", c.card.counted == null ? "—" : eur(c.card.counted)), H),
      T(lr("Esperado (ventas + propinas)", eur(c.card.expected))),
      T(lr("Diferencia", st(c.card.difference)), H),
    );
  }
  if (c.type !== "apertura" && on("propinas")) {
    out.push(
      { k: "feed" },
      T("PROPINAS", H),
      R("-"),
      T(lr("En efectivo", eur(c.tips.cash))),
      T(lr("Con tarjeta", eur(c.tips.card))),
      T(lr("Total", eur(r2(c.tips.cash + c.tips.card))), H),
      T(c.tips.confirmed ? `Confirmadas por ${c.user}` : "Sin confirmar"),
    );
  }
  if (c.note) {
    out.push({ k: "feed" }, T(`Motivo: ${c.note}`));
  }
  out.push(R("="), T("Detalle: Gestiones › Caja › Movimientos", { align: "center" }), { k: "feed", n: 2 }, { k: "cut" });
  return out;
}
