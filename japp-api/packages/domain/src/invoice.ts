import { clone, type Ctx } from "./context.js";
import { assertNoPendingCourses } from "./courses.js";
import { fail } from "./errors.js";
import { accountTotals } from "./totals.js";
import type { Account, Invoice } from "./types.js";

export const AEAT_QR_URL = "https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR";
export const TZ = "Europe/Madrid";

/** F1 = factura completa (con datos del cliente); F2 = simplificada (ticket). */
export const invoiceType = (acc: Pick<Account, "customerData">): "F1" | "F2" =>
  acc.customerData ? "F1" : "F2";

/** Número: SERIE-000123 (6 dígitos). */
export const formatInvoiceNumber = (series: string, seq: number) =>
  `${series}-${String(seq).padStart(6, "0")}`;

/** Fecha dd-mm-aaaa en hora de España (no en UTC ni en la del servidor). */
export function madridDate(d: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("es-ES", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.day}-${p.month}-${p.year}`;
}

export function verifactuQrUrl(nif: string, invoiceNumber: string, issuedAt: Date, total: number): string {
  const q = new URLSearchParams({
    nif,
    numserie: invoiceNumber,
    fecha: madridDate(issuedAt),
    importe: total.toFixed(2),
  });
  return `${AEAT_QR_URL}?${q.toString()}`;
}

export interface SeriesConfig {
  serieF: string;
  serieT: string;
}

/**
 * Emitir factura. El número (seq) lo reserva la base de datos con SELECT … FOR UPDATE sobre invoice_series;
 * aquí solo se recibe. Solo con pendiente 0.
 */
export function issueInvoice(
  acc: Account,
  seq: number,
  cfg: SeriesConfig & { nif: string },
  ctx: Ctx,
): Account {
  if (acc.status !== "open") {
    fail("ACCOUNT_CLOSED", "La cuenta ya está facturada", { accountId: acc.id });
  }
  const T = accountTotals(acc);
  if (!acc.lines.length) {
    fail("VALIDATION", "No se puede facturar una cuenta vacía");
  }
  assertNoPendingCourses(acc);
  if (!(T.total > 0)) {
    fail("NOTHING_TO_CHARGE", "La cuenta está a 0,00 €: no hay nada que cobrar ni facturar", {
      total: T.total,
    });
  }
  if (T.pending > 0) {
    fail("PENDING_NOT_ZERO", "Queda importe pendiente", { pending: T.pending });
  }
  const type = invoiceType(acc);
  const series = type === "F1" ? cfg.serieF : cfg.serieT;
  const invoiceNumber = formatInvoiceNumber(series, seq);
  const invoice: Invoice = {
    type,
    series,
    sequence: seq,
    invoiceNumber,
    issuedAt: ctx.now.toISOString(),
    total: T.total,
    taxes: T.taxes,
    customer: acc.customerData ? clone(acc.customerData) : null,
    verifactuQr: verifactuQrUrl(cfg.nif, invoiceNumber, ctx.now, T.total),
  };
  return { ...clone(acc), status: "invoiced", invoice };
}

/** Comprueba que una serie no tiene huecos ni repetidos (lo que exige VeriFactu). */
export function seriesGaps(seqs: number[]): { missing: number[]; repeated: number[] } {
  const s = [...seqs].sort((a, b) => a - b);
  const seen = new Set<number>();
  const repeated: number[] = [];
  const missing: number[] = [];
  for (const n of s) {
    if (seen.has(n)) {
      repeated.push(n);
    }
    seen.add(n);
  }
  if (s.length) {
    for (let n = s[0]!; n <= s[s.length - 1]!; n++) {
      if (!seen.has(n)) {
        missing.push(n);
      }
    }
  }
  return { missing, repeated };
}
