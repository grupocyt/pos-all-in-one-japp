import { clone } from "./context.js";
import { fail } from "./errors.js";
import type { Account, Order } from "./types.js";

/**
 * Pasar UNA cuenta a otra mesa (decidido 15/10/2026):
 * - la cuenta tiene que estar viva (sin facturar) y con al menos una línea → si no, 422 NOTHING_TO_TRANSFER;
 * - va entera: líneas (con su estado y las eliminadas), descuentos, cobros parciales, cliente y pases; los precios no cambian;
 * - en el destino es una cuenta más (nunca se juntan líneas); si su nombre ya existe allí pasa a «Cuenta N» (el primer número libre);
 * - el origen se queda sin ella; si no le queda ninguna cuenta viva, la mesa se cierra (sourceLive = false).
 * La mesa de destino libre se abre antes con una orden vacía (to.accounts = []).
 */
export function transferAccount(
  from: Order,
  accountId: string,
  to: Order,
): { from: Order; to: Order; account: Account; renamedFrom: string | null; sourceLive: boolean } {
  if (from.id === to.id) {
    fail("VALIDATION", "La cuenta ya está en esa mesa", { field: "toTableId" });
  }
  const acc = from.accounts.find((a) => a.id === accountId);
  if (!acc) {
    return fail("NOT_FOUND", "La cuenta no existe", { accountId });
  }
  if (acc.status !== "open") {
    fail("NOTHING_TO_TRANSFER", "La cuenta ya está facturada: no se puede pasar a otra mesa", { accountId });
  }
  if (!acc.lines.length) {
    fail("NOTHING_TO_TRANSFER", "La cuenta no tiene productos: no hay nada que pasar", { accountId });
  }
  const used = new Set(to.accounts.map((a) => a.name.trim().toLowerCase()));
  let name = acc.name;
  if (used.has(name.trim().toLowerCase())) {
    let n = 1;
    while (used.has(`cuenta ${n}`)) {
      n++;
    }
    name = `Cuenta ${n}`;
  }
  const moved: Account = { ...clone(acc), name };
  const rest = from.accounts.filter((a) => a.id !== accountId).map((a) => clone(a));
  return {
    from: { ...clone(from), accounts: rest },
    to: { ...clone(to), accounts: [...to.accounts.map((a) => clone(a)), moved] },
    account: moved,
    renamedFrom: name !== acc.name ? acc.name : null,
    sourceLive: rest.some((a) => a.status === "open"),
  };
}
