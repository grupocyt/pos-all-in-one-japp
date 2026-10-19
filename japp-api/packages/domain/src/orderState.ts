import { fail } from "./errors.js";
import type { Order } from "./types.js";

/**
 * Lo que le queda «vivo» a una mesa: productos o cobros confirmados en cuentas sin facturar.
 * Sin nada vivo se puede cerrar sin venta (POST …/close) y «Guardar y salir» (POST …/save) la deja libre.
 * Devuelve la primera cuenta con algo vivo, o null.
 */
export function liveContentOf(
  order: Order,
): { accountId: string; reason: "lines" | "payments"; lines: number } | null {
  for (const a of order.accounts) {
    if (a.status === "invoiced") {
      continue;
    }
    if (a.lines.length) {
      return { accountId: a.id, reason: "lines", lines: a.lines.length };
    }
    if (a.payments.some((p) => p.status === "confirmed")) {
      return { accountId: a.id, reason: "payments", lines: 0 };
    }
  }
  return null;
}

/** Cerrar sin venta: con algo vivo → 409 ORDER_NOT_EMPTY (con productos o con cobros). */
export function assertNothingLive(order: Order): void {
  const live = liveContentOf(order);
  if (!live) {
    return;
  }
  if (live.reason === "lines") {
    fail("ORDER_NOT_EMPTY", "La mesa tiene productos: elimínalos con motivo o cóbralos antes de cerrarla", {
      accountId: live.accountId,
      lines: live.lines,
    });
  }
  fail("ORDER_NOT_EMPTY", "La mesa tiene cobros registrados", { accountId: live.accountId });
}

export const ACCOUNT_NAME_MAX = 40;

/**
 * Renombrar una cuenta: 1–40 caracteres (sin espacios de más), sin repetir en la mesa (sin distinguir mayúsculas)
 * → 409 DUPLICATE; una cuenta facturada no cambia → 409 ACCOUNT_CLOSED. Devuelve la orden nueva (no muta).
 */
export function renameAccount(order: Order, accountId: string, name: string): Order {
  const acc = order.accounts.find((a) => a.id === accountId);
  if (!acc) {
    fail("NOT_FOUND", "La cuenta no existe", { accountId });
  }
  if (acc!.status === "invoiced") {
    fail("ACCOUNT_CLOSED", "La cuenta ya está facturada: no se puede renombrar", { accountId });
  }
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean.length || clean.length > ACCOUNT_NAME_MAX) {
    fail("VALIDATION", `El nombre tiene que tener de 1 a ${ACCOUNT_NAME_MAX} caracteres`, { field: "name" });
  }
  const key = clean.toLocaleLowerCase("es");
  const other = order.accounts.find(
    (a) => a.id !== accountId && a.name.trim().toLocaleLowerCase("es") === key,
  );
  if (other) {
    fail("DUPLICATE", `Ya hay una cuenta «${other.name}» en esta mesa`, {
      field: "name",
      accountId: other.id,
    });
  }
  return {
    ...order,
    accounts: order.accounts.map((a) => (a.id === accountId ? { ...a, name: clean } : a)),
  };
}
