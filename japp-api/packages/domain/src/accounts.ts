import { clone, type Ctx } from "./context.js";
import { fail } from "./errors.js";
import { accountTotals } from "./totals.js";
import type { Account, CustomerData, Discount, Order, Payment } from "./types.js";

const assertOpen = (acc: Account) => {
  if (acc.status !== "open") {
    fail("ACCOUNT_CLOSED", "La cuenta ya está facturada", { accountId: acc.id });
  }
};

export interface DiscountInput {
  type: Discount["type"];
  value: number;
  reason: string;
}

/**
 * Aplicar descuento a una cuenta:
 * - porcentaje entre 0 y 100, fijo > 0, con motivo;
 * - no con cobros ya hechos (cambiaría lo cobrado);
 * - un solo descuento activo por cuenta (el nuevo sustituye al anterior, como en el TPV).
 */
export function applyDiscount(acc: Account, d: DiscountInput, ctx: Ctx): Account {
  assertOpen(acc);
  if (!d.reason?.trim()) {
    fail("VALIDATION", "Falta el motivo del descuento", { field: "reason" });
  }
  if (d.type === "percentage" && !(d.value > 0 && d.value <= 100)) {
    fail("VALIDATION", "El porcentaje va de 0 a 100", { field: "value" });
  }
  if (d.type === "fixed" && !(d.value > 0)) {
    fail("VALIDATION", "El importe del descuento debe ser mayor que 0", { field: "value" });
  }
  if (acc.payments.some((p) => p.status === "confirmed")) {
    fail("VALIDATION", "Ya hay cobros en la cuenta: anúlalos antes de poner un descuento", {
      accountId: acc.id,
    });
  }
  if (!acc.lines.length) {
    fail("VALIDATION", "La cuenta está vacía");
  }
  // 03/11: un descuento no deja la cuenta a 0 € (no se podría cobrar, facturar ni cerrar): para regalarlo todo, «Invitación»
  const sub = accountTotals({ ...acc, discounts: [] }).total;
  if ((d.type === "percentage" && d.value >= 100) || (d.type === "fixed" && d.value >= sub)) {
    fail(
      "VALIDATION",
      "El descuento no puede dejar la cuenta a 0,00 €: para invitar, elimina los productos con motivo «Invitación»",
      {
        field: "value",
      },
    );
  }
  const out = clone(acc);
  out.discounts.forEach((x) => {
    if (x.status === "applied") {
      x.status = "removed";
    }
  });
  out.discounts.push({
    id: ctx.newId(),
    type: d.type,
    value: d.value,
    reason: d.reason.trim(),
    status: "applied",
  });
  return out;
}

export function removeDiscount(acc: Account, discountId: string): Account {
  assertOpen(acc);
  if (acc.payments.some((p) => p.status === "confirmed")) {
    fail("VALIDATION", "Ya hay cobros en la cuenta: anúlalos antes de quitar el descuento", {
      accountId: acc.id,
    });
  }
  const out = clone(acc);
  const d = out.discounts.find((x) => x.id === discountId && x.status === "applied");
  if (!d) {
    fail("NOT_FOUND", "Ese descuento no está aplicado", { discountId });
  }
  d!.status = "removed";
  return out;
}

/** NIF/CIF/NIE español con su letra o dígito de control. Para clientes extranjeros, cualquier id de 5 a 20 caracteres. */
export function isValidSpanishTaxId(raw: string): boolean {
  const id = raw.toUpperCase().replace(/[\s.-]/g, "");
  const L = "TRWAGMYFPDXBNJZSQVHLCKE";
  if (/^\d{8}[A-Z]$/.test(id)) {
    return L[Number(id.slice(0, 8)) % 23] === id[8];
  }
  if (/^[XYZ]\d{7}[A-Z]$/.test(id)) {
    return L[Number("XYZ".indexOf(id[0]!) + id.slice(1, 8)) % 23] === id[8];
  }
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(id)) {
    const d = id.slice(1, 8).split("").map(Number);
    const even = d[1]! + d[3]! + d[5]!;
    const odd = [d[0]!, d[2]!, d[4]!, d[6]!].reduce(
      (a, n) => a + Math.floor((n * 2) / 10) + ((n * 2) % 10),
      0,
    );
    const c = (10 - ((even + odd) % 10)) % 10;
    return id[8] === String(c) || id[8] === "JABCDEFGHI"[c];
  }
  return false;
}

/** Datos del cliente para factura completa (F1). Con NIF español se valida el control; extranjero (country ≠ ES) solo la forma. */
export function setCustomer(acc: Account, c: CustomerData): Account {
  assertOpen(acc);
  if (!c.name?.trim()) {
    fail("VALIDATION", "Falta el nombre o razón social", { field: "name" });
  }
  const foreign = c.country && c.country.toUpperCase() !== "ES";
  if (foreign ? !/^[A-Z0-9-]{5,20}$/i.test(c.taxId) : !isValidSpanishTaxId(c.taxId)) {
    fail("VALIDATION", "NIF no válido", { field: "taxId" });
  }
  return {
    ...clone(acc),
    customerData: { ...clone(c), taxId: c.taxId.toUpperCase().replace(/[\s.-]/g, "") },
  };
}

/** Quitar una cuenta: solo si está vacía, sin cobros ni líneas borradas y no es la única abierta. */
export function removeEmptyAccount(order: Order, accountId: string): Order {
  const acc = order.accounts.find((a) => a.id === accountId);
  if (!acc) {
    fail("NOT_FOUND", "La cuenta no existe", { accountId });
  }
  assertOpen(acc!);
  if (acc!.lines.length || acc!.deletedLines.length || acc!.payments.length) {
    fail("VALIDATION", "Solo se quita una cuenta vacía", { accountId });
  }
  if (order.accounts.filter((a) => a.status === "open").length < 2) {
    fail("VALIDATION", "La mesa necesita al menos una cuenta abierta", { accountId });
  }
  return { ...clone(order), accounts: order.accounts.filter((a) => a.id !== accountId).map(clone) };
}

/**
 * Al guardar (decisión del 28/10, TPV 1.2.259): la cuenta que se quedó sin productos porque se eliminó todo desaparece
 * (sin cobros). Queda siempre al menos una cuenta abierta: si se vaciaron todas, se conserva la primera.
 */
export function dropEmptiedAccounts(order: Order): { order: Order; dropped: Account[] } {
  const emptied = (a: Account) =>
    a.status === "open" && !a.lines.length && a.deletedLines.length > 0 && !a.payments.length;
  const open = order.accounts.filter((a) => a.status === "open");
  let drop = order.accounts.filter(emptied);
  if (drop.length && drop.length === open.length) {
    drop = drop.slice(1);
  }
  if (!drop.length) {
    return { order, dropped: [] };
  }
  const ids = new Set(drop.map((a) => a.id));
  return {
    order: { ...clone(order), accounts: order.accounts.filter((a) => !ids.has(a.id)).map(clone) },
    dropped: drop,
  };
}

/**
 * Cuenta con descuento o cobro parcial (reglas del 03/11/2026, por cuenta y no por mesa): se entiende que ya se está cobrando y
 * la cuenta queda CONGELADA. No se tica nada más, no se cambian cantidades, comentarios ni respuestas, no se elimina nada (ni lo
 * por enviar), no se cambia un pase marchado, no se pasan productos a ni desde ella, no se pasa a otra mesa ni se cambia o junta
 * la mesa. Sí: cobrar lo que falta, facturar, datos de cliente, anular cobros y quitar el descuento (sin cobros). Para seguir, se libera antes (releaseAccount: anular sus cobros y quitar el descuento).
 */
export function accountLock(acc: Account): { payments: Payment[]; discount: Discount | null } | null {
  if (acc.status !== "open") {
    return null;
  }
  const payments = acc.payments.filter((p) => p.status === "confirmed");
  const discount = acc.discounts.find((d) => d.status === "applied") ?? null;
  return payments.length || discount ? { payments, discount } : null;
}
export function assertAccountFree(acc: Account, action: string): void {
  const l = accountLock(acc);
  if (!l) {
    return;
  }
  const what = [
    l.payments.length ? `${l.payments.length === 1 ? "un cobro" : `${l.payments.length} cobros`}` : "",
    l.discount ? "descuento" : "",
  ]
    .filter(Boolean)
    .join(" y ");
  fail(
    "ACCOUNT_LOCKED",
    `La ${acc.name} tiene ${what}: para ${action}, libera antes la cuenta (anular cobros y quitar el descuento)`,
    {
      accountId: acc.id,
      accountName: acc.name,
      action,
      payments: l.payments.map((p) => ({
        id: p.id,
        method: p.method,
        kind: p.kind,
        amount: p.amount,
        tip: p.tip,
      })),
      discount: l.discount
        ? { id: l.discount.id, reason: l.discount.reason, type: l.discount.type, value: l.discount.value }
        : null,
    },
  );
}

/**
 * «Liberar la cuenta y continuar» (03/11/2026): en UNA operación se anulan todos sus cobros confirmados y se quita el descuento,
 * para poder seguir con lo que estaba bloqueado. Solo con la cuenta sin facturar y con motivo; nada se borra (cobros cancelled,
 * descuento removed). No se vuelve a poner nada solo.
 */
export function releaseAccount(
  acc: Account,
  reason: string,
): { account: Account; voided: Payment[]; discount: Discount | null } {
  if (acc.status !== "open") {
    fail("ACCOUNT_CLOSED", "La cuenta ya está facturada: para devolver dinero haz un abono", {
      accountId: acc.id,
    });
  }
  if ((reason ?? "").trim().length < 3) {
    fail("VALIDATION", "Escribe el motivo", { field: "reason" });
  }
  const l = accountLock(acc);
  if (!l) {
    fail("VALIDATION", "La cuenta no tiene cobros ni descuento: no hay nada que liberar", {
      accountId: acc.id,
    });
  }
  const out = clone(acc);
  const ids = new Set(l!.payments.map((p) => p.id));
  out.payments.forEach((p) => {
    if (ids.has(p.id)) {
      p.status = "cancelled";
    }
  });
  let discount: Discount | null = null;
  out.discounts.forEach((d) => {
    if (d.status === "applied") {
      d.status = "removed";
      discount = d;
    }
  });
  return { account: out, voided: out.payments.filter((p) => ids.has(p.id)), discount };
}

export { accountTotals };
