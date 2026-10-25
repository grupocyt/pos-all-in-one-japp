import { D, r2, sum } from "./money.js";
import { TZ } from "./invoice.js";
import { isRectificative } from "./credit.js";

/**
 * Interfaz de ventas al SIR (Sistema Integrado de Restaurantes, Grupo KFC) al cerrar el periodo.
 * Equivale a MaxPoint [interface].[USP_InterfaceSistemaGerente] (rama NORMAL): cada bloque es un XML
 * FOR XML RAW(...) convertido a VARBINARY (UTF-16LE con BOM FFFE) y enviado en hexadecimal «0x…».
 * Lo que la tienda aún no tiene (depósitos, caja chica, CxC empleado, consumo recarga, crédito autoconsumo,
 * agregadores, anulación de boletas, cortesías) va como «0x00000000», igual que MaxPoint cuando el bloque viene vacío.
 */

export const SIR_EMPTY = "0x00000000";

export interface SirInvoice {
  id: string;
  type: string;
  /** Con IVA; las rectificativas en negativo. */
  total: number;
  taxBase: number;
  taxTotal: number;
  /** Base al 0 % de IVA (VentaCero). */
  zeroBase: number;
  /** Descuento de la cuenta facturada (positivo). */
  discount: number;
  issuedAt: Date;
  issuedBy: string;
}
export interface SirPayment {
  user: string;
  /** Código de la forma de pago en el SIR (Ajustes › Formas de pago › id de integración) o, si no tiene, su código. */
  method: string;
  amount: number;
}
/** Una pieza vendida: el producto de una línea o una de sus respuestas/modificadores, ya facturada y menos lo abonado. */
export interface SirItem {
  plu: number;
  quantity: number;
  /** Con IVA, antes del descuento de la cuenta. */
  gross: number;
  /** Con IVA, después del descuento de la cuenta. */
  grossAfterDiscount: number;
  taxRate: number;
}
export interface SirSession {
  userId: string;
  user: string;
  start: Date;
  end: Date;
}
export interface SirInput {
  storeCode: string | number;
  businessDate: string; // AAAA-MM-DD
  guests: number;
  invoices: SirInvoice[];
  payments: SirPayment[];
  items: SirItem[];
  sessions: SirSession[];
}
export interface SirXml {
  CierreCajas: string;
  DinTrans: string;
  VentaHora: string;
  PlusTrans: string;
  HorasCajero: string;
}

const esc = (v: string | number) =>
  String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const row = (tag: string, attrs: [string, string | number][]) =>
  `<${tag} ${attrs.map(([k, v]) => `${k}="${esc(v)}"`).join(" ")}/>`;
/** Decimal con n cifras (como DECIMAL(12, n) de SQL Server: 202.0500). */
export const sirNum = (n: number, d = 4) => D(n || 0).toFixed(d);

/** XML → «0x» + UTF-16LE con BOM (lo que da CONVERT(VARBINARY(MAX), @xml) en SQL Server), en mayúsculas. */
export function sirHex(xml: string | null | undefined): string {
  if (!xml) {
    return SIR_EMPTY;
  }
  let out = "FFFE";
  for (let i = 0; i < xml.length; i++) {
    const c = xml.charCodeAt(i);
    out += (c & 0xff).toString(16).padStart(2, "0") + (c >> 8).toString(16).padStart(2, "0");
  }
  return "0x" + out.toUpperCase();
}
/** Al revés, para revisar lo que se manda (Developer). «0x00000000» → "". */
export function sirUnhex(hex: string): string {
  const h = hex.replace(/^0x/i, "");
  if (!h || /^0+$/.test(h)) {
    return "";
  }
  const b = h.startsWith("FFFE") || h.startsWith("fffe") ? h.slice(4) : h;
  let s = "";
  for (let i = 0; i + 3 < b.length; i += 4) {
    s += String.fromCharCode(parseInt(b.slice(i, i + 2), 16) | (parseInt(b.slice(i + 2, i + 4), 16) << 8));
  }
  return s;
}

const madrid = (d: Date) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
};

/** dd/mm/aaaa (lc_fecha, como CONVERT(VARCHAR, fecha, 103)). */
export const sirDate = (isoDate: string) => isoDate.split("-").reverse().join("/");

/**
 * CierreCajas: fila TOTAL (con los comensales) y fila del canal «1» (local; la tienda no tiene agregadores ni kiosko).
 * Venta bruta/neta/IVA = facturas del periodo menos rectificativas; transacciones = facturas (sin rectificativas).
 * neta_sin_terraza … descIvaInt_CierreCajasPiloto: en MaxPoint son constantes 1…7 (campos reservados); se mandan igual.
 */
function cierreCajas(i: SirInput) {
  const inv = i.invoices;
  if (!inv.length) {
    return null;
  }
  const bruta = r2(sum(inv.map((x) => x.total)));
  const neta = r2(sum(inv.map((x) => x.taxBase)));
  const iva = r2(sum(inv.map((x) => x.taxTotal)));
  const cero = r2(sum(inv.map((x) => x.zeroBase)));
  const desc = r2(sum(inv.filter((x) => !isRectificative(x.type)).map((x) => x.discount)));
  const trans = inv.filter((x) => !isRectificative(x.type)).length;
  const fila = (medio: string, clientes: number) =>
    row("CierreCajasDetalle", [
      ["Venta_Bruta", sirNum(bruta)],
      ["Venta_Neta", sirNum(neta)],
      ["Iva", sirNum(iva)],
      ["VentaCero", sirNum(cero)],
      ["Descuento", sirNum(desc)],
      ["Servicios", sirNum(0)],
      ["Transacciones", trans],
      ["Compensacion", sirNum(0)],
      ["TotalClientes", clientes],
      ["tipo_medio", medio],
      ["neta_sin_terraza", 1],
      ["iva_sin_terraza", 2],
      ["anulaciones", 1],
      ["anulacionGer", 2],
      ["errores", 3],
      ["facEmpezadas", 4],
      ["facPagadas", 5],
      ["cancelacion", 6],
      ["descIvaInt_CierreCajasPiloto", 7],
    ]);
  return `<CierreCajas>${fila("TOTAL", i.guests)}${fila("1", 0)}</CierreCajas>`;
}

/** VentasHora: por hora de Madrid de la factura, «18:00 - 18:59», tickets (sin rectificativas) y valor (con rectificativas). */
function ventaHora(i: SirInput) {
  if (!i.invoices.length) {
    return null;
  }
  const m = new Map<number, { n: number; v: number }>();
  for (const x of i.invoices) {
    const h = madrid(x.issuedAt).hour;
    const e = m.get(h) ?? { n: 0, v: 0 };
    if (!isRectificative(x.type)) {
      e.n++;
    }
    e.v = r2(sum([e.v, x.total]));
    m.set(h, e);
  }
  const rows = [...m.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([h, e]) =>
      row("VentasHoraDetalle", [
        ["Tiempo", `${h}:00 - ${h}:59`],
        ["Transacciones", e.n],
        ["Valor", sirNum(e.v)],
      ]),
    );
  return `<VentasHora>${rows.join("")}</VentasHora>`;
}

/**
 * DinTrans: por cajero (quien cobró) y forma de pago, importe y número de cobros; y por cajero la fila
 * Cod_FormaPago = -1 con lo facturado por él (facturas menos rectificativas) y su número de facturas.
 */
function dinTrans(i: SirInput) {
  if (!i.payments.length && !i.invoices.length) {
    return null;
  }
  const byPay = new Map<string, { user: string; method: string; v: number; n: number }>();
  for (const p of i.payments) {
    const k = `${p.user}\u0000${p.method}`;
    const e = byPay.get(k) ?? { user: p.user, method: p.method, v: 0, n: 0 };
    e.v = r2(sum([e.v, p.amount]));
    e.n++;
    byPay.set(k, e);
  }
  const byUser = new Map<string, { v: number; n: number }>();
  for (const x of i.invoices) {
    const e = byUser.get(x.issuedBy) ?? { v: 0, n: 0 };
    e.v = r2(sum([e.v, x.total]));
    if (!isRectificative(x.type)) {
      e.n++;
    }
    byUser.set(x.issuedBy, e);
  }
  const cajero = (user: string, method: string, v: number, n: number) =>
    row("Cajero", [
      ["Cod_Cajero", user],
      ["Cod_FormaPago", method],
      ["Merchant", ""],
      ["Valor", sirNum(v)],
      ["Num_Trans", n],
      ["Recap", 0],
      ["IDDocumento", "-1"],
    ]);
  const rows = [
    ...[...byPay.values()]
      .sort((a, b) => a.user.localeCompare(b.user) || a.method.localeCompare(b.method))
      .map((e) => cajero(e.user, e.method, e.v, e.n)),
    ...[...byUser.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([u, e]) => cajero(u, "-1", e.v, e.n)),
  ];
  return `<DinTrans>${rows.join("")}</DinTrans>`;
}

/**
 * PlusTrans: por PLU (producto o respuesta/modificador con PLU), cantidad e importes con y sin IVA, totales y unitarios,
 * descuento (la parte del descuento de la cuenta) y agregador LOCAL. BaseIva = neta de lo que lleva IVA; BaseCero = neta al 0 %.
 */
function plusTrans(i: SirInput) {
  const m = new Map<
    number,
    { q: number; bruta: number; neta: number; iva: number; cero: number; base: number; desc: number }
  >();
  for (const it of i.items) {
    if (!it.plu || it.quantity <= 0) {
      continue;
    }
    const bruta = r2(it.grossAfterDiscount);
    const neta = r2(D(bruta).div(D(1).plus(D(it.taxRate).div(100))));
    const e = m.get(it.plu) ?? { q: 0, bruta: 0, neta: 0, iva: 0, cero: 0, base: 0, desc: 0 };
    e.q = Number(D(e.q).plus(it.quantity));
    e.bruta = r2(sum([e.bruta, bruta]));
    e.neta = r2(sum([e.neta, neta]));
    e.iva = r2(sum([e.iva, D(bruta).minus(neta)]));
    if (Number(it.taxRate) === 0) {
      e.cero = r2(sum([e.cero, neta]));
    } else {
      e.base = r2(sum([e.base, neta]));
    }
    e.desc = r2(sum([e.desc, D(it.gross).minus(it.grossAfterDiscount)]));
    m.set(it.plu, e);
  }
  if (!m.size) {
    return null;
  }
  const u = (v: number, q: number) => (q ? Number(D(v).div(q)) : 0);
  const rows = [...m.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([plu, e]) =>
      row("Cod_Plu", [
        ["Cod_Plu", plu],
        ["Cantidad", sirNum(e.q)],
        ["BaseIvaTotal", sirNum(e.base, 6)],
        ["BaseCeroTotal", sirNum(e.cero)],
        ["NetaTotal", sirNum(e.neta, 6)],
        ["IvaTotal", sirNum(e.iva, 6)],
        ["BrutaTotal", sirNum(e.bruta, 6)],
        ["BaseIvaUnitaria", sirNum(u(e.base, e.q), 6)],
        ["BaseCeroUnitaria", sirNum(u(e.cero, e.q), 6)],
        ["NetaUnitaria", sirNum(u(e.neta, e.q), 6)],
        ["IvaUnitario", sirNum(u(e.iva, e.q), 6)],
        ["BrutaUnitaria", sirNum(u(e.bruta, e.q), 6)],
        ["Descuento", sirNum(e.desc, 6)],
        ["agregador", "LOCAL"],
      ]),
    );
  return `<PlusTrans>${rows.join("")}</PlusTrans>`;
}

/** HorasCajero: por usuario y día (Madrid) de inicio de sesión, horas conectado redondeadas (como MaxPoint). */
function horasCajero(i: SirInput) {
  const m = new Map<string, { userId: string; user: string; date: string; min: number }>();
  for (const s of i.sessions) {
    const min = Math.max(0, (s.end.getTime() - s.start.getTime()) / 60000);
    const date = madrid(s.start).date;
    const k = `${s.userId}|${date}`;
    const e = m.get(k) ?? { userId: s.userId, user: s.user, date, min: 0 };
    e.min += min;
    m.set(k, e);
  }
  if (!m.size) {
    return null;
  }
  const rows = [...m.values()]
    .sort((a, b) => a.user.localeCompare(b.user) || a.date.localeCompare(b.date))
    .map((e) =>
      row("HorasConectado", [
        ["usuario", e.user],
        ["Fecha", e.date],
        ["IDUsersPos", e.userId.toUpperCase()],
        ["rst_id", i.storeCode],
        ["urs_varchar1", ""],
        ["Horas_Conectado", sirNum(Math.round(e.min / 60), 2)],
      ]),
    );
  return `<HorasCajero>${rows.join("")}</HorasCajero>`;
}

/** Los bloques en XML (null = vacío → 0x00000000). */
export function sirXml(i: SirInput): Record<keyof SirXml, string | null> {
  return {
    CierreCajas: cierreCajas(i),
    DinTrans: dinTrans(i),
    VentaHora: ventaHora(i),
    PlusTrans: plusTrans(i),
    HorasCajero: horasCajero(i),
  };
}

/** Lo que espera el SIR (interfaceVentasAgregadores): cada bloque en hexadecimal; lo que no hay, 0x00000000. */
export function sirSales(i: SirInput) {
  const x = sirXml(i);
  return {
    cod_restaurante: String(i.storeCode),
    lc_fecha: sirDate(i.businessDate),
    CierreCajas: sirHex(x.CierreCajas),
    DinTrans: sirHex(x.DinTrans),
    VentaHora: sirHex(x.VentaHora),
    PlusTrans: sirHex(x.PlusTrans),
    HorasCajero: sirHex(x.HorasCajero),
    Depositos: SIR_EMPTY,
    CajaChica: SIR_EMPTY,
    CxCEmpleado: SIR_EMPTY,
    ConsumoRecarga: SIR_EMPTY,
    CreditoAutoconsumo: SIR_EMPTY,
    Agregadores: SIR_EMPTY,
    AnulacionBoletas: SIR_EMPTY,
    Cortesias: SIR_EMPTY,
    xml: x,
  };
}

/** Orden de los campos en el SOAP interfaceVentasAgregadores (como lo manda MaxPoint y lo espera el SIR). */
export const SIR_SOAP_FIELDS = [
  "cod_restaurante",
  "lc_fecha",
  "CierreCajas",
  "VentaHora",
  "DinTrans",
  "PlusTrans",
  "Depositos",
  "CajaChica",
  "CxCEmpleado",
  "CreditoAutoconsumo",
  "Agregadores",
  "AnulacionBoletas",
  "HorasCajero",
] as const;

/** El sobre SOAP listo para copiar en SoapUI o enviar al SIR. */
export function sirEnvelope(s: Record<(typeof SIR_SOAP_FIELDS)[number], string>): string {
  const body = SIR_SOAP_FIELDS.map((k) => `                    <${k}>${esc(s[k] ?? SIR_EMPTY)}</${k}>`).join(
    "\n",
  );
  return [
    `<Envelope xmlns="http://schemas.xmlsoap.org/soap/envelope/">`,
    `            <Body>`,
    `                <interfaceVentasAgregadores xmlns="">`,
    body,
    `                </interfaceVentasAgregadores>`,
    `            </Body>`,
    `</Envelope>`,
  ].join("\n");
}
