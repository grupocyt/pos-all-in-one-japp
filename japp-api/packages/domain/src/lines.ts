import { clone, type Ctx } from "./context.js";
import { fail } from "./errors.js";
import { checkWithManager, type Profile, type UserLike } from "./permissions.js";
import { priceFor } from "./pricing.js";
import { accountTotals, assertTotalCoversPaid } from "./totals.js";
import { sendWithCourses, type KitchenItem } from "./courses.js";
import type { Account, Area, DeletedLine, Line, LineCourse, Modifier, Order, Product } from "./types.js";

export const DUPLICATE_WINDOW_MIN = 3; // Parámetros › dupMin

const assertOpen = (acc: Account) => {
  if (acc.status !== "open") {
    fail("ACCOUNT_CLOSED", "La cuenta ya está facturada", { accountId: acc.id });
  }
};

export interface AddProductInput {
  product: Product;
  area: Area | null;
  quantity?: number;
  modifiers?: Modifier[];
  comment?: string;
  courses?: LineCourse[];
  /** El camarero confirma que no es un duplicado. */
  force?: boolean;
  dupWindowMin?: number;
}

/**
 * Busca el mismo producto marcado por OTRA persona hace menos de dupMin minutos en la cuenta.
 * Devuelve la línea sospechosa o null.
 */
export function findSuspectedDuplicate(
  acc: Account,
  productId: number,
  actorUser: string,
  now: Date,
  windowMin = DUPLICATE_WINDOW_MIN,
): Line | null {
  const limit = now.getTime() - windowMin * 60_000;
  return (
    acc.lines.find(
      (l) =>
        l.productId === productId && l.createdBy.user !== actorUser && Date.parse(l.createdBy.at) >= limit,
    ) ?? null
  );
}

/**
 * Añadir producto (= addProduct del prototipo):
 * - no en cuentas facturadas;
 * - aviso de duplicado salvo force;
 * - si hay una línea «Por enviar» del mismo producto sin modificadores ni comentario, suma cantidad;
 * - si no, línea nueva con el precio de la zona.
 */
/** Firma de las respuestas de una línea (nombre, cantidad y precio), sin importar el orden. */
export const modKey = (ms: Modifier[]) =>
  JSON.stringify(ms.map((m) => [m.name, m.quantity ?? 1, m.unitPrice]).sort());

export function addProduct(acc: Account, input: AddProductInput, ctx: Ctx): Account {
  assertOpen(acc);
  const qty = input.quantity ?? 1;
  if (!Number.isInteger(qty) || qty <= 0) {
    fail("VALIDATION", "Cantidad no válida", { field: "quantity" });
  }
  if (!input.force) {
    const dup = findSuspectedDuplicate(acc, input.product.plu, ctx.actor.user, ctx.now, input.dupWindowMin);
    if (dup) {
      fail("DUPLICATE_SUSPECTED", "Mismo producto marcado por otra persona hace poco", {
        lineId: dup.id,
        by: dup.createdBy.user,
      });
    }
  }
  const out = clone(acc);
  const mods = input.modifiers ?? [];
  const comment = (input.comment ?? "").trim();
  // se juntan las líneas «Por enviar» iguales: mismo producto, mismo comentario y mismas respuestas (también con preguntas)
  const merge = out.lines.find(
    (l) =>
      l.productId === input.product.plu &&
      l.status === "pendingPrint" &&
      (l.comment ?? "") === comment &&
      modKey(l.modifiers) === modKey(mods) &&
      JSON.stringify(l.courses ?? null) === JSON.stringify(input.courses ?? null),
  );
  if (merge) {
    merge.quantity += qty;
    return out;
  }
  out.lines.push({
    id: ctx.newId(),
    productId: input.product.plu,
    name: input.product.name,
    quantity: qty,
    unitPrice: priceFor(input.product, input.area),
    taxRate: input.product.taxRate,
    comment,
    modifiers: clone(mods),
    status: "pendingPrint",
    createdBy: { ...ctx.actor, at: ctx.now.toISOString() },
    ...(input.courses?.length ? { courses: clone(input.courses) } : {}),
  });
  return out;
}

/** Cambiar cantidad: solo líneas «Por enviar». 0 o menos la quita. */
export function changeQuantity(acc: Account, lineId: string, delta: number): Account {
  assertOpen(acc);
  const out = clone(acc);
  const l = out.lines.find((x) => x.id === lineId) ?? fail("NOT_FOUND", "Línea no encontrada", { lineId });
  if (l.status !== "pendingPrint") {
    fail("VALIDATION", "Solo se cambia la cantidad de lo que no se ha enviado", { lineId, status: l.status });
  }
  l.quantity += delta;
  if (l.quantity <= 0) {
    out.lines.splice(out.lines.indexOf(l), 1);
  }
  if (delta < 0) {
    assertTotalCoversPaid(out);
  }
  return out;
}

/** Qué permiso exige borrar una línea según su estado (null = libre). */
export const deletePermissionFor = (
  l: Pick<Line, "status">,
): "pedido.elimEnviado" | "pedido.elimPrecuenta" | null =>
  l.status === "pendingPrint" ? null : l.status === "printed" ? "pedido.elimEnviado" : "pedido.elimPrecuenta";

export interface DeleteLineInput {
  lineId: string;
  reason?: string;
  /** Unidades a quitar (por defecto, toda la línea). Si son menos, la línea se queda con el resto. */
  quantity?: number;
  actor: UserLike;
  authorizer?: UserLike | null;
  authorizerActor?: Ctx["actor"] | null;
  profiles: Profile[];
}

/**
 * Eliminar línea:
 * - «Por enviar» → se quita sin más (no deja rastro en deletedLines);
 * - con cobros: la cuenta no puede quedar por debajo de lo cobrado (TOTAL_BELOW_PAID);
 * - enviada o en precuenta → motivo obligatorio + permiso (pedido.elimEnviado / pedido.elimPrecuenta), si no lo tiene, clave de encargado.
 *   Pasa a deletedLines con motivo, quién la quitó y quién autorizó. Nunca se borra de verdad.
 */
export function deleteLine(acc: Account, input: DeleteLineInput, ctx: Ctx): Account {
  assertOpen(acc);
  const out = clone(acc);
  const l =
    out.lines.find((x) => x.id === input.lineId) ??
    fail("NOT_FOUND", "Línea no encontrada", { lineId: input.lineId });
  const perm = deletePermissionFor(l);
  const q = input.quantity ?? l.quantity;
  if (!Number.isInteger(q) || q <= 0 || q > l.quantity) {
    fail("VALIDATION", "Cantidad a eliminar no válida", { field: "quantity", max: l.quantity });
  }
  const partial = q < l.quantity;
  if (!perm) {
    if (partial) {
      l.quantity -= q;
    } else {
      out.lines.splice(out.lines.indexOf(l), 1);
    }
    assertTotalCoversPaid(out);
    return out;
  }
  if (!input.reason?.trim()) {
    fail("VALIDATION", "Falta el motivo", { field: "reason" });
  }
  const chk = checkWithManager(input.actor, perm, input.profiles, input.authorizer);
  if (!chk.ok) {
    fail(chk.code, "Falta permiso para eliminar", { permission: chk.permission });
  }
  if (partial) {
    l.quantity -= q;
  } else {
    out.lines.splice(out.lines.indexOf(l), 1);
  }
  const del: DeletedLine = {
    ...clone(l),
    id: partial ? ctx.newId() : l.id,
    quantity: q,
    reason: input.reason!.trim(),
    removedBy: { ...ctx.actor, at: ctx.now.toISOString() },
    authorizedBy: chk.ok && chk.authorizedBy ? (input.authorizerActor ?? null) : null,
    removedAt: ctx.now.toISOString(),
  };
  out.deletedLines.push(del);
  assertTotalCoversPaid(out);
  return out;
}

/** Enviar a cocina: «Por enviar» → «Enviado». Devuelve la cuenta y las líneas que hay que imprimir. */
export function sendOrder(
  acc: Account,
  opts: { now?: Date } = {},
): { account: Account; sent: Line[]; items: KitchenItem[] } {
  assertOpen(acc);
  return sendWithCourses(acc, opts); // líneas normales: todo lo «Por enviar»; menús: por pases (courses.ts)
}

/** Precuenta: lo enviado pasa a «Precuenta». Lo pendiente de enviar se queda como está. */
export function preBill(acc: Account): Account {
  assertOpen(acc);
  if (!(accountTotals(acc).total > 0)) {
    fail("NOTHING_TO_CHARGE", "La cuenta está a 0,00 €: no hay precuenta que imprimir", {
      total: accountTotals(acc).total,
    });
  }
  const out = clone(acc);
  out.lines.forEach((l) => {
    if (l.status === "printed") {
      l.status = "preBill";
    }
  });
  return out;
}

/**
 * Ordenar lo «Por enviar» (lo que sale primero en la comanda). ids = TODAS las líneas por enviar de la cuenta, en el orden nuevo.
 * Lo ya enviado no se mueve: las líneas por enviar ocupan sus mismos huecos en el orden pedido.
 */
export function reorderPending(acc: Account, ids: string[]): Account {
  assertOpen(acc);
  const out = clone(acc);
  const pend = out.lines.filter((l) => l.status === "pendingPrint");
  if (
    ids.length !== pend.length ||
    new Set(ids).size !== ids.length ||
    !ids.every((id) => pend.some((l) => l.id === id))
  ) {
    fail("VALIDATION", "Hay que mandar todas las líneas «Por enviar» de la cuenta, cada una una vez", {
      field: "lineIds",
      pending: pend.map((l) => l.id),
    });
  }
  const sorted = ids.map((id) => pend.find((l) => l.id === id)!);
  let k = 0;
  out.lines = out.lines.map((l) => (l.status === "pendingPrint" ? sorted[k++]! : l));
  return out;
}

/** Clave para juntar unidades iguales al pasar entre cuentas (producto, estado, comentario y modificadores). */
export const sameKey = (l: Line) =>
  [l.productId, l.status, l.comment, JSON.stringify(l.modifiers.map((m) => m.name))].join("|");

/** Una cuenta se puede tocar al separar si está abierta y no tiene cobros. */
export const isMovable = (a: Account) => a.status === "open" && a.payments.length === 0;

/**
 * Pasar unidades entre cuentas (= «Separar cuenta»):
 * - origen y destino abiertos y sin cobros;
 * - target "new" crea «Cuenta N+1»;
 * - si en destino hay una línea igual (sameKey) suma, si no copia la línea con id nuevo;
 * - el origen se queda sin la línea al llegar a 0; si queda vacío (y sin borradas) y hay más cuentas, desaparece.
 */
export function moveUnits(
  order: Order,
  fromId: string,
  target: string | "new",
  pick: Record<string, number>,
  ctx: Ctx,
): { order: Order; destId: string } {
  const out = clone(order);
  const src =
    out.accounts.find((a) => a.id === fromId) ??
    fail("NOT_FOUND", "Cuenta no encontrada", { accountId: fromId });
  if (!isMovable(src)) {
    fail("ACCOUNT_CLOSED", "La cuenta de origen ya tiene cobros o está facturada", { accountId: fromId });
  }
  let dest: Account;
  if (target === "new") {
    dest = {
      id: ctx.newId(),
      name: `Cuenta ${out.accounts.length + 1}`,
      status: "open",
      lines: [],
      deletedLines: [],
      discounts: [],
      payments: [],
      customerData: null,
      invoice: null,
    };
    out.accounts.push(dest);
  } else {
    dest =
      out.accounts.find((a) => a.id === target) ??
      fail("NOT_FOUND", "Cuenta no encontrada", { accountId: target });
    if (dest.id === src.id) {
      fail("VALIDATION", "Origen y destino son la misma cuenta");
    }
    if (!isMovable(dest)) {
      fail("ACCOUNT_CLOSED", "La cuenta de destino ya tiene cobros o está facturada", { accountId: dest.id });
    }
  }
  for (const [lid, n] of Object.entries(pick)) {
    if (!n) {
      continue;
    }
    const l =
      src.lines.find((x) => x.id === lid) ?? fail("NOT_FOUND", "Línea no encontrada", { lineId: lid });
    if (!Number.isInteger(n) || n < 0 || n > l.quantity) {
      fail("VALIDATION", "Cantidad a pasar no válida", { lineId: lid, n, max: l.quantity });
    }
    const ex = dest.lines.find((x) => sameKey(x) === sameKey(l));
    if (ex) {
      ex.quantity += n;
    } else {
      dest.lines.push({ ...clone(l), id: ctx.newId(), quantity: n });
    }
    l.quantity -= n;
    if (l.quantity <= 0) {
      src.lines.splice(src.lines.indexOf(l), 1);
    }
  }
  assertTotalCoversPaid(src);
  const live = out.accounts.filter((a) => a.status === "open");
  if (!src.lines.length && !src.deletedLines.length && live.length > 1) {
    out.accounts.splice(out.accounts.indexOf(src), 1);
  }
  return { order: out, destId: dest.id };
}
