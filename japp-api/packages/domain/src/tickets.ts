import { accountTotals, lineAmount } from "./totals.js";
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
  | { k: "logo" }
  | { k: "cut" };

export const WIDTH = 48;

/** 1234.5 → «1.234,50 €» */
export function eur(n: number): string {
  const neg = n < 0, [i, d] = Math.abs(n).toFixed(2).split(".");
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
    if (cut < width * 0.5) cut = width;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out.length ? out : [""];
}
const two = (n: number) => String(n).padStart(2, "0");
/** Fecha y hora en Madrid (los tickets van en hora local de la tienda). */
export function madridParts(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.day}/${p.month}/${p.year}`, hm: `${p.hour}:${p.minute}`, hms: `${p.hour}:${p.minute}:${p.second}` };
}

export interface StoreHeader {
  legalName: string; tradeName?: string; taxId: string; address?: string; city?: string; phone?: string;
  header?: string; footer?: string; logo?: boolean;
}
export interface TicketContext {
  store: StoreHeader;
  table: { name: string; area: string };
  waiter: string;
  guests?: number;
  at: Date;
  paymentNames?: Record<string, string>; // cash → Efectivo
}

const T = (text: string, o: Omit<Extract<TicketLine, { k: "text" }>, "k" | "text"> = {}): TicketLine => ({ k: "text", text, ...o });
const R = (ch: "=" | "-"): TicketLine => ({ k: "rule", ch });

/** Cabecera de la tienda: logo, nombre fiscal, NIF y dirección (obligatorio en factura). */
function storeBlock(s: StoreHeader): TicketLine[] {
  const out: TicketLine[] = [];
  if (s.logo !== false) out.push({ k: "logo" });
  if (s.tradeName) out.push(T(s.tradeName, { align: "center", bold: true }));
  out.push(T(s.legalName, { align: "center" }), T(`NIF: ${s.taxId}`, { align: "center" }));
  if (s.address) wrap(s.address, WIDTH).forEach(x => out.push(T(x, { align: "center" })));
  if (s.city || s.phone) out.push(T([s.city, s.phone && `Tel. ${s.phone}`].filter(Boolean).join(" · "), { align: "center" }));
  if (s.header) wrap(s.header, WIDTH).forEach(x => out.push(T(x, { align: "center" })));
  out.push({ k: "feed" });
  return out;
}

/** Cuerpo común de factura y precuenta: productos, descuentos, IVA y total. */
function body(acc: Account): TicketLine[] {
  const out: TicketLine[] = [T(lr("Uds.   Producto", "Importe")), R("-")];
  const AMT = 11, NAME = WIDTH - 7 - AMT;
  for (const l of acc.lines) {
    const amount = eur(lineAmount({ ...l, modifiers: l.modifiers.filter(m => !m.unitPrice) }));
    const names = wrap(l.name, NAME);
    out.push(T(padL(String(l.quantity), 4) + "   " + padR(names[0]!, NAME) + padL(amount, AMT)));
    names.slice(1).forEach(n => out.push(T(" ".repeat(7) + n)));
    for (const m of l.modifiers) {
      const q = (m.quantity ?? 1) * l.quantity;
      const label = " ".repeat(9) + "c. " + (q > 1 && m.unitPrice ? `${q} ` : "") + m.name;
      out.push(T(m.unitPrice ? lr(label, eur(m.unitPrice * q)) : label));
    }
  }
  out.push(R("-"));
  const tt = accountTotals(acc);
  for (const d of acc.discounts.filter(x => x.status === "applied")) {
    const amt = d.type === "percentage" ? Math.round(tt.sub * d.value) / 100 : Math.min(d.value, tt.sub);
    out.push(T(lr(`Descuento ${d.type === "percentage" ? pct(d.value) + " % " : ""}${d.reason}`.trim(), "-" + eur(amt))));
  }
  if (tt.disc) out.push(R("-"));
  // desglose de IVA: «  10,00 %: Base:      7,27 € Cuota:       0,73 €»
  const base = (rate: string, b: number, c: number, label = "Cuota:") => padL(rate, 16) + padL(eur(b), 12) + " " + label + padL(eur(c), 13);
  for (const x of tt.taxes) out.push(T(base(`${pct(x.rate)} %: Base:`, x.base, x.tax)));
  const sb = tt.taxes.reduce((a, x) => a + x.base, 0), sc = tt.taxes.reduce((a, x) => a + x.tax, 0);
  out.push(T(base("Total:", Math.round(sb * 100) / 100, Math.round(sc * 100) / 100, "Total:"), { bold: true }), R("-"));
  out.push(T(lr("Total (Impuestos Incl.)", eur(tt.total)), { bold: true }), R("="));
  return out;
}

function head(title: string, opLeft: string, opRight: string, ctx: TicketContext): TicketLine[] {
  const when = madridParts(ctx.at);
  return [
    ...storeBlock(ctx.store),
    R("="), T(title, { align: "center" }), R("-"),
    T(lr(opLeft, opRight), { bold: true }), R("-"),
    T(lr(`${when.date} ${when.hm}`, ctx.waiter)), R("="),
  ];
}

const METHOD: Record<string, string> = { cash: "Efectivo", card: "Tarjeta", bizum: "Bizum", voucher: "Vale", platform: "Plataforma" };

/** Factura simplificada (F2) o completa (F1, con datos del cliente), con pagos, cambio y QR VeriFactu. */
export function invoiceTicket(acc: Account, ctx: TicketContext): TicketLine[] {
  const inv = acc.invoice;
  if (!inv) throw new Error("La cuenta no tiene factura");
  const out = head(inv.type === "F1" ? "FACTURA" : "FACTURA SIMPLIFICADA", `Nº Op.:    ${inv.invoiceNumber}`, `${ctx.table.area}/${ctx.table.name}`, { ...ctx, at: new Date(inv.issuedAt) });
  if (inv.customer) {
    const c = inv.customer;
    out.push(T("Cliente:", { bold: true }), T(c.name), T(`NIF: ${c.taxId}`));
    const addr = [c.street, [c.postalCode, c.city].filter(Boolean).join(" "), c.province].filter(Boolean).join(", ");
    if (addr) wrap(addr, WIDTH).forEach(x => out.push(T(x)));
    out.push(R("="));
  }
  out.push(...body(acc));
  const pays = acc.payments.filter((p: Payment) => p.status === "confirmed");
  const cash = pays.filter(p => p.kind === "cash");
  if (cash.length) {
    const given = cash.reduce((a, p) => a + (p.cashGiven ?? p.amount), 0), change = cash.reduce((a, p) => a + (p.change ?? 0), 0);
    out.push(T("Entregado:" + padL(eur(given), 11) + " Cambio:" + padL(eur(change), WIDTH - 29), { bold: true }));
  }
  for (const p of pays) out.push(T(lr(ctx.paymentNames?.[p.method] ?? METHOD[p.method] ?? p.method, eur(p.amount)), { bold: true }));
  const tips = pays.reduce((a, p) => a + p.tip, 0);
  if (tips) out.push(T(lr("Propina", eur(tips))));
  out.push(R("="), { k: "feed" }, { k: "qr", data: inv.verifactuQr },
    T("QR tributario:", { align: "center" }), T("Factura verificable en la sede", { align: "center" }), T("electrónica de la AEAT", { align: "center" }),
    T("VERI*FACTU", { align: "center", bold: true }));
  if (ctx.store.footer) { out.push({ k: "feed" }); wrap(ctx.store.footer, WIDTH).forEach(x => out.push(T(x, { align: "center" }))); }
  out.push({ k: "feed", n: 2 }, { k: "cut" });
  return out;
}

/** Precuenta: el mismo formato que la factura, sin número ni pagos, y la advertencia de que no es factura. */
export function preBillTicket(acc: Account, ctx: TicketContext): TicketLine[] {
  const out = head("PRECUENTA", `${acc.name}`, `${ctx.table.area}/${ctx.table.name}`, ctx);
  out.push(...body(acc));
  const total = accountTotals(acc).total;
  if (ctx.guests && ctx.guests > 1) out.push(T(lr(`Comensales: ${ctx.guests}`, `Por persona: ${eur(Math.round((total / ctx.guests) * 100) / 100)}`)));
  out.push(T("*** NO VÁLIDO COMO FACTURA ***", { align: "center", bold: true }));
  if (ctx.store.footer) { out.push({ k: "feed" }); wrap(ctx.store.footer, WIDTH).forEach(x => out.push(T(x, { align: "center" }))); }
  out.push({ k: "feed", n: 2 }, { k: "cut" });
  return out;
}

export interface KitchenContext { channel: string; waiter: string; guests: number; table: { name: string; area: string }; at: Date; reprint?: boolean; voided?: boolean; }

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
export function kitchenTicket(lines: (Pick<Line, "quantity" | "name" | "comment" | "modifiers"> & { tag?: string; notes?: string[] })[], ctx: KitchenContext): TicketLine[] {
  const out: TicketLine[] = [
    T(`${ctx.guests} ${ctx.guests === 1 ? "Comensal" : "Comensales"}`, { align: "center" }),
    T(`${ctx.channel.toUpperCase()}/ ${ctx.waiter}`, { align: "center" }),
    T(madridParts(ctx.at).hms, { align: "center", size: "h" }),
    T(`Mesa ${ctx.table.name} ${ctx.table.area}`, { align: "center", size: "wh" }),
  ];
  if (ctx.voided) out.push(T("*** ANULADO ***", { align: "center", size: "wh", bold: true }));
  else if (ctx.reprint) out.push(T("** REIMPRESIÓN **", { align: "center", bold: true }));
  out.push(R("-"));
  const W2 = WIDTH / 2;
  lines.forEach((l, i) => {
    if (i) out.push({ k: "feed" });
    if (l.tag) out.push(T(`>> ${l.tag}`, { bold: true }));
    const q = String(l.quantity), pre = q + " ".repeat(Math.max(2, 3 - q.length));
    const parts = wrap(l.name.toUpperCase(), W2 - pre.length);
    out.push(T(pre + parts[0], { size: "w" }));
    parts.slice(1).forEach(p => out.push(T(" ".repeat(pre.length) + p, { size: "w" })));
    if (l.comment?.trim()) wrap("**" + l.comment.trim().toUpperCase(), WIDTH).forEach(x => out.push(T(x)));
    for (const m of l.modifiers) out.push(T(`   -- ${(m.quantity ?? 1) * l.quantity} ${m.name.toUpperCase()}`));
    for (const n of l.notes ?? []) wrap(`   (${n})`, WIDTH).forEach(x => out.push(T(x)));
  });
  out.push({ k: "feed", n: 3 }, { k: "cut" });
  return out;
}

/** Texto plano (vista previa, pruebas, log). Las líneas de doble ancho ocupan la mitad de columnas. */
export function renderText(lines: TicketLine[], width = WIDTH): string {
  const out: string[] = [];
  for (const l of lines) {
    if (l.k === "rule") out.push(l.ch.repeat(width));
    else if (l.k === "feed") for (let i = 0; i < (l.n ?? 1); i++) out.push("");
    else if (l.k === "qr") out.push(" ".repeat((width - 10) / 2) + "[QR " + "·".repeat(2) + "]");
    else if (l.k === "logo") out.push(" ".repeat((width - 6) / 2) + "[LOGO]");
    else if (l.k === "cut") out.push("✂" + "-".repeat(width - 1));
    else {
      const w = l.size === "w" || l.size === "wh" ? width / 2 : width;
      const s = l.text.length > w ? l.text.slice(0, w) : l.text;
      const pad = w - s.length;
      out.push(l.align === "center" ? " ".repeat(Math.floor(pad / 2)) + s : l.align === "right" ? " ".repeat(pad) + s : s);
    }
  }
  return out.map(x => x.replace(/\s+$/, "")).join("\n");
}

/* ---------------- ESC/POS ---------------- */

/** Página de códigos 858 (como la 850 pero con €): la que usan las Epson TM con textos en español y catalán. */
const CP858: Record<string, number> = {
  "Ç": 0x80, "ü": 0x81, "é": 0x82, "â": 0x83, "ä": 0x84, "à": 0x85, "ç": 0x87, "ê": 0x88, "ë": 0x89, "è": 0x8a, "ï": 0x8b, "î": 0x8c, "ì": 0x8d,
  "Ä": 0x8e, "É": 0x90, "ô": 0x93, "ö": 0x94, "ò": 0x95, "û": 0x96, "ù": 0x97, "Ö": 0x99, "Ü": 0x9a, "×": 0x9e, "á": 0xa0, "í": 0xa1, "ó": 0xa2,
  "ú": 0xa3, "ñ": 0xa4, "Ñ": 0xa5, "ª": 0xa6, "º": 0xa7, "¿": 0xa8, "¡": 0xad, "Á": 0xb5, "Â": 0xb6, "À": 0xb7, "€": 0xd5, "Ê": 0xd2, "È": 0xd4,
  "Í": 0xd6, "Ï": 0xd8, "Ì": 0xde, "Ó": 0xe0, "Ò": 0xe3, "Ú": 0xe9, "Ù": 0xeb, "·": 0xfa, "–": 0x2d, "—": 0x2d, "‘": 0x27, "’": 0x27, "“": 0x22, "”": 0x22, "…": 0x2e,
};
export function encodeCp858(s: string): number[] {
  const out: number[] = [];
  for (const ch of s.normalize("NFC")) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x20 && c < 0x7f) out.push(c);
    else out.push(CP858[ch] ?? 0x3f); // «?» si la impresora no tiene ese carácter
  }
  return out;
}

const ESC = 0x1b, GS = 0x1d, LF = 0x0a;
export interface EscPosOptions { width?: number; openDrawer?: boolean; logoFromPrinter?: boolean; qrSize?: number; }

/** Bytes listos para mandar a la impresora (TCP 9100, USB o serie). */
export function renderEscPos(lines: TicketLine[], o: EscPosOptions = {}): Uint8Array {
  const w = o.width ?? WIDTH, b: number[] = [ESC, 0x40, ESC, 0x74, 19]; // inicializar + CP858
  if (o.openDrawer) b.push(ESC, 0x70, 0, 25, 250);
  const align = (a?: string) => b.push(ESC, 0x61, a === "center" ? 1 : a === "right" ? 2 : 0);
  for (const l of lines) {
    if (l.k === "text") {
      align(l.align);
      b.push(GS, 0x21, l.size === "w" ? 0x10 : l.size === "h" ? 0x01 : l.size === "wh" ? 0x11 : 0x00);
      b.push(ESC, 0x45, l.bold ? 1 : 0, ...encodeCp858(l.text), LF);
      b.push(GS, 0x21, 0, ESC, 0x45, 0);
    } else if (l.k === "rule") { align("left"); b.push(...encodeCp858(l.ch.repeat(w)), LF); }
    else if (l.k === "feed") b.push(ESC, 0x64, l.n ?? 1);
    else if (l.k === "logo") { if (o.logoFromPrinter !== false) { align("center"); b.push(0x1c, 0x70, 1, 0); } } // logo guardado en la impresora (NV)
    else if (l.k === "qr") {
      const d = encodeCp858(l.data), n = d.length + 3;
      align("center");
      b.push(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0);              // modelo 2
      b.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, o.qrSize ?? 5);         // tamaño del módulo
      b.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31);                  // corrección M
      b.push(GS, 0x28, 0x6b, n & 0xff, n >> 8, 0x31, 0x50, 0x30, ...d); // guardar datos
      b.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30, LF);              // imprimir
    } else if (l.k === "cut") b.push(GS, 0x56, 66, 3);                   // avanzar y corte parcial
  }
  return Uint8Array.from(b);
}
