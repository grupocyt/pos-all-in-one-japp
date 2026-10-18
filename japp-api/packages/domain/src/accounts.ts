import { clone, type Ctx } from "./context.js";
import { fail } from "./errors.js";
import { accountTotals } from "./totals.js";
import type { Account, CustomerData, Discount, Order } from "./types.js";

const assertOpen = (acc: Account) => { if (acc.status !== "open") fail("ACCOUNT_CLOSED", "La cuenta ya está facturada", { accountId: acc.id }); };

export interface DiscountInput { type: Discount["type"]; value: number; reason: string; }

/**
 * Aplicar descuento a una cuenta:
 * - porcentaje entre 0 y 100, fijo > 0, con motivo;
 * - no con cobros ya hechos (cambiaría lo cobrado);
 * - un solo descuento activo por cuenta (el nuevo sustituye al anterior, como en el TPV).
 */
export function applyDiscount(acc: Account, d: DiscountInput, ctx: Ctx): Account {
  assertOpen(acc);
  if (!d.reason?.trim()) fail("VALIDATION", "Falta el motivo del descuento", { field: "reason" });
  if (d.type === "percentage" && !(d.value > 0 && d.value <= 100)) fail("VALIDATION", "El porcentaje va de 0 a 100", { field: "value" });
  if (d.type === "fixed" && !(d.value > 0)) fail("VALIDATION", "El importe del descuento debe ser mayor que 0", { field: "value" });
  if (acc.payments.some(p => p.status === "confirmed")) fail("VALIDATION", "Ya hay cobros en la cuenta: no se puede aplicar un descuento", { accountId: acc.id });
  if (!acc.lines.length) fail("VALIDATION", "La cuenta está vacía");
  const out = clone(acc);
  out.discounts.forEach(x => { if (x.status === "applied") x.status = "removed"; });
  out.discounts.push({ id: ctx.newId(), type: d.type, value: d.value, reason: d.reason.trim(), status: "applied" });
  return out;
}

export function removeDiscount(acc: Account, discountId: string): Account {
  assertOpen(acc);
  if (acc.payments.some(p => p.status === "confirmed")) fail("VALIDATION", "Ya hay cobros en la cuenta: no se puede quitar el descuento", { accountId: acc.id });
  const out = clone(acc), d = out.discounts.find(x => x.id === discountId && x.status === "applied");
  if (!d) fail("NOT_FOUND", "Ese descuento no está aplicado", { discountId });
  d!.status = "removed";
  return out;
}

/** NIF/CIF/NIE español con su letra o dígito de control. Para clientes extranjeros, cualquier id de 5 a 20 caracteres. */
export function isValidSpanishTaxId(raw: string): boolean {
  const id = raw.toUpperCase().replace(/[\s.-]/g, "");
  const L = "TRWAGMYFPDXBNJZSQVHLCKE";
  if (/^\d{8}[A-Z]$/.test(id)) return L[Number(id.slice(0, 8)) % 23] === id[8];
  if (/^[XYZ]\d{7}[A-Z]$/.test(id)) return L[Number("XYZ".indexOf(id[0]!) + id.slice(1, 8)) % 23] === id[8];
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(id)) {
    const d = id.slice(1, 8).split("").map(Number);
    const even = d[1]! + d[3]! + d[5]!;
    const odd = [d[0]!, d[2]!, d[4]!, d[6]!].reduce((a, n) => a + Math.floor((n * 2) / 10) + ((n * 2) % 10), 0);
    const c = (10 - ((even + odd) % 10)) % 10;
    return id[8] === String(c) || id[8] === "JABCDEFGHI"[c];
  }
  return false;
}

/** Datos del cliente para factura completa (F1). Con NIF español se valida el control; extranjero (country ≠ ES) solo la forma. */
export function setCustomer(acc: Account, c: CustomerData): Account {
  assertOpen(acc);
  if (!c.name?.trim()) fail("VALIDATION", "Falta el nombre o razón social", { field: "name" });
  const foreign = c.country && c.country.toUpperCase() !== "ES";
  if (foreign ? !/^[A-Z0-9-]{5,20}$/i.test(c.taxId) : !isValidSpanishTaxId(c.taxId)) fail("VALIDATION", "NIF no válido", { field: "taxId" });
  return { ...clone(acc), customerData: { ...clone(c), taxId: c.taxId.toUpperCase().replace(/[\s.-]/g, "") } };
}

/** Quitar una cuenta: solo si está vacía, sin cobros ni líneas borradas y no es la única abierta. */
export function removeEmptyAccount(order: Order, accountId: string): Order {
  const acc = order.accounts.find(a => a.id === accountId);
  if (!acc) fail("NOT_FOUND", "La cuenta no existe", { accountId });
  assertOpen(acc!);
  if (acc!.lines.length || acc!.deletedLines.length || acc!.payments.length) fail("VALIDATION", "Solo se quita una cuenta vacía", { accountId });
  if (order.accounts.filter(a => a.status === "open").length < 2) fail("VALIDATION", "La mesa necesita al menos una cuenta abierta", { accountId });
  return { ...clone(order), accounts: order.accounts.filter(a => a.id !== accountId).map(clone) };
}

export { accountTotals };
