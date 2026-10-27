import { clone } from "./context.js";
import { fail } from "./errors.js";
import { nextAccountName } from "./accountNames.js";
import type { Account, Order } from "./types.js";

const key = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase("es");

/**
 * Nombre de una cuenta que llega a otra orden: el suyo si no está ya en el destino; si está, el siguiente «Cuenta N»
 * del destino (nextAccountName: nunca repite un número, tampoco el de una cuenta anulada que esté en knownNames).
 */
function arrivingName(acc: Account, dest: Pick<Order, "accounts">, knownNames: readonly string[]): string {
  const used = new Set(dest.accounts.map((a) => key(a.name)));
  if (!used.has(key(acc.name))) {
    return acc.name;
  }
  return nextAccountName(dest, knownNames);
}

/**
 * Pasar UNA cuenta a otra mesa (decidido 15/10/2026):
 * - la cuenta tiene que estar viva (sin facturar) y con al menos una línea → si no, 422 NOTHING_TO_TRANSFER;
 * - va entera: líneas (con su estado y las eliminadas), descuentos, cobros parciales, cliente y pases; los precios no cambian;
 * - en el destino es una cuenta más (nunca se juntan líneas); si su nombre ya existe allí pasa a la siguiente «Cuenta N»
 *   del destino (nextAccountName; knownNames = nombres de sus cuentas que no se cargan, p. ej. anuladas);
 * - el origen se queda sin ella; si no le queda ninguna cuenta viva, la mesa se cierra (sourceLive = false).
 * La mesa de destino libre se abre antes con una orden vacía (to.accounts = []).
 */
export function transferAccount(
  from: Order,
  accountId: string,
  to: Order,
  knownNames: readonly string[] = [],
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
  const name = arrivingName(acc, to, knownNames);
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

/** Une dos notas de mesa sin repetir: «terraza · alérgico» (vacías fuera). null si no queda ninguna. */
export function joinNotes(a: string | null | undefined, b: string | null | undefined): string | null {
  const parts: string[] = [];
  for (const n of [a, b]) {
    const t = n?.trim();
    if (t && !parts.some((p) => key(p) === key(t))) {
      parts.push(t);
    }
  }
  return parts.length ? parts.join(" · ") : null;
}

export interface MergeResult {
  /** el origen sin las cuentas que se fueron: solo le quedan las facturadas */
  from: Order;
  /** el destino con sus cuentas y, detrás, las que llegan (y los comensales sumados) */
  to: Order;
  /** cada cuenta que pasa, con su nombre en el destino y el que tenía si hubo que cambiarlo */
  moved: { account: Account; renamedFrom: string | null }[];
  /** cuentas vivas del origen totalmente vacías (sin líneas, eliminadas ni cobros): no pasan, se anulan */
  dropped: string[];
  /** cómo queda el origen: cancelled sin facturadas, closed con alguna */
  sourceStatus: "cancelled" | "closed";
  /** la nota de las dos mesas, unida */
  note: string | null;
}

/**
 * Juntar mesas (decidido tras las pruebas en tienda, 23/10/2026): transferir la mesa entera a una mesa OCUPADA.
 * - Cada cuenta viva (sin facturar) del origen pasa al destino con la misma mecánica que transferAccount: entera
 *   (líneas, eliminadas, descuentos, cobros parciales, cliente, pases) y con sus precios; nunca se juntan líneas.
 *   Si su nombre ya existe en el destino → siguiente «Cuenta N» del destino (contando también las que van llegando).
 * - Una cuenta viva completamente vacía no aporta nada: no pasa y se anula con el origen.
 * - Los comensales se suman y las notas se unen.
 * - El origen se queda solo con lo facturado: cancelled si no tenía nada facturado, closed si sí.
 * - Sin productos vivos en el origen → 422 VALIDATION (no hay nada que juntar); misma orden → 422 VALIDATION.
 */
export function mergeOrders(
  from: Order,
  to: Order,
  opts: { knownNames?: readonly string[]; fromNote?: string | null; toNote?: string | null } = {},
): MergeResult {
  if (from.id === to.id) {
    fail("VALIDATION", "La mesa ya está en esa mesa", { field: "toTableId" });
  }
  const live = from.accounts.filter((a) => a.status === "open");
  if (!live.some((a) => a.lines.length)) {
    fail("VALIDATION", "La mesa no tiene productos: no hay nada que transferir", { field: "orderId" });
  }
  const dest: Order = { ...clone(to), accounts: to.accounts.map((a) => clone(a)) };
  const moved: MergeResult["moved"] = [];
  const dropped: string[] = [];
  for (const acc of live) {
    if (!acc.lines.length && !acc.deletedLines.length && !acc.payments.length) {
      dropped.push(acc.id);
      continue;
    }
    const name = arrivingName(acc, dest, opts.knownNames ?? []);
    const account: Account = { ...clone(acc), name };
    dest.accounts.push(account);
    moved.push({ account, renamedFrom: name !== acc.name ? acc.name : null });
  }
  const rest = from.accounts.filter((a) => a.status !== "open").map((a) => clone(a));
  dest.guests = to.guests + from.guests;
  let sourceStatus: MergeResult["sourceStatus"] = "cancelled";
  if (rest.length) {
    sourceStatus = "closed";
  }
  return {
    from: { ...clone(from), accounts: rest },
    to: dest,
    moved,
    dropped,
    sourceStatus,
    note: joinNotes(opts.toNote, opts.fromNote),
  };
}

/**
 * Cambio de mesa (25/10/2026): solo entre zonas con el MISMO precio. Una mesa con precio de terraza no pasa a una con
 * precio general (ni al revés): los productos llevan el precio de su zona. → 422 VALIDATION en toTableId.
 */
export function assertSamePriceList(from: string | null | undefined, to: string | null | undefined): void {
  const f = from === "terrace" ? "terrace" : "general";
  const t = to === "terrace" ? "terrace" : "general";
  if (f !== t) {
    const n = (x: string) => (x === "terrace" ? "precio de terraza" : "precio general");
    fail("VALIDATION", `No se puede pasar de una zona con ${n(f)} a una con ${n(t)}`, {
      field: "toTableId",
      fromPriceList: f,
      toPriceList: t,
    });
  }
}
