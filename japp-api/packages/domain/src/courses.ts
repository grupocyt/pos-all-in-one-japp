import { clone, type Ctx } from "./context.js";
import { fail } from "./errors.js";
import type { Account, DeletedLine, Line, LineCourse, Modifier } from "./types.js";

/**
 * Menú por pases (decidido 15/10/2026, opción «a»):
 * - Cada pregunta de un menú puede tener pase: 0 bebida, 1 primero, 2 segundo, 3 postre.
 * - La bebida se elige al pedir y sale con el pedido. Los demás pases se pueden dejar «por elegir».
 * - Al guardar/enviar: lo elegido sale si es la bebida o si los pases de comida anteriores ya estaban marchados;
 *   si no, queda «en espera» y sale con «Marchar» (fireCourse). Lo elegido más tarde sale al guardar.
 * - No se cobra ni se factura una cuenta con pases «por elegir».
 */
export const courseLabel = (c: number) => (c === 0 ? "Bebida" : c === 1 ? "1.º" : c === 2 ? "2.º" : c === 3 ? "Postre" : `${c}.º`);
export const MENU_ABSORB_REASON = "Incluida en menú";

export interface KitchenItem {
  /** PLU que decide por qué impresora sale (la respuesta del pase, o el producto) */
  plu: number; quantity: number; name: string; comment: string; modifiers: Modifier[];
  /** «BEBIDA», «MARCHA 1.º», «AVISO MENÚ» */
  tag?: string;
  /** «2.º POR ELEGIR», «2.º EN ESPERA: MERLUZA» */
  notes?: string[];
}

export const pendingCourses = (acc: Pick<Account, "lines">) => acc.lines.flatMap(l => (l.courses ?? []).filter(c => c.state === "pending").map(c => ({ line: l, course: c })));
export function assertNoPendingCourses(acc: Pick<Account, "lines">) {
  const p = pendingCourses(acc);
  if (p.length) fail("COURSE_PENDING", `Falta elegir ${p.map(x => `${courseLabel(x.course.course)} de ${x.line.name}`).join(", ")}`, { lines: p.map(x => ({ lineId: x.line.id, course: x.course.course })) });
}

const modsOfCourse = (l: Line, c: number) => l.modifiers.filter(m => m.course === c);
const foodBefore = (cs: LineCourse[], c: number) => cs.filter(x => x.course >= 1 && x.course < c);

/** Notas de lo que queda pendiente de una línea con pases (después de este envío). */
function notesOf(l: Line): string[] {
  return (l.courses ?? []).filter(c => c.state === "pending" || c.state === "held").sort((a, b) => a.course - b.course)
    .map(c => c.state === "pending" ? `${courseLabel(c.course).toUpperCase()} POR ELEGIR` : `${courseLabel(c.course).toUpperCase()} EN ESPERA: ${modsOfCourse(l, c.course).map(m => m.name.toUpperCase()).join(", ")}`);
}

/**
 * Enviar (Guardar): lo «Por enviar» pasa a enviado y los pases elegidos salen según la regla.
 * force = marchar un pase en espera ahora mismo (botón «Marchar 2.º»).
 * Devuelve las piezas de comanda (items) además de las líneas tocadas (sent).
 */
export function sendWithCourses(acc: Account, opts: { now?: Date; force?: { lineId: string; course: number } } = {}): { account: Account; sent: Line[]; items: KitchenItem[] } {
  if (acc.status !== "open") fail("ACCOUNT_CLOSED", "La cuenta ya está facturada", { accountId: acc.id });
  const out = clone(acc), at = opts.now ? opts.now.toISOString() : null;
  const sent: Line[] = [], items: KitchenItem[] = [];
  if (opts.force) {
    const l = out.lines.find(x => x.id === opts.force!.lineId) ?? fail("NOT_FOUND", "La línea no existe", { lineId: opts.force.lineId });
    const c = l!.courses?.find(x => x.course === opts.force!.course) ?? fail("VALIDATION", "Ese pase no existe en la línea", { field: "course" });
    if (c!.state === "pending") fail("COURSE_PENDING", `Falta elegir ${courseLabel(c!.course)} de ${l!.name}`, { lineId: l!.id, course: c!.course });
    if (c!.state === "fired") fail("VALIDATION", `${courseLabel(c!.course)} de ${l!.name} ya está marchado`, { field: "course" });
  }
  for (const l of out.lines) {
    const wasPending = l.status === "pendingPrint";
    if (!l.courses?.length) {
      if (wasPending) { l.status = "printed"; sent.push(l); items.push({ plu: l.productId, quantity: l.quantity, name: l.name, comment: l.comment, modifiers: l.modifiers }); }
      continue;
    }
    const before = l.courses.map(c => ({ ...c }));
    const fired: LineCourse[] = []; let newlyHeld = false;
    for (const c of l.courses.sort((a, b) => a.course - b.course)) {
      const forced = opts.force?.lineId === l.id && opts.force.course === c.course;
      if (forced || (c.state === "ready" && (c.course === 0 || foodBefore(before, c.course).every(x => x.state === "fired")))) {
        c.state = "fired"; c.firedAt = at; fired.push(c);
      } else if (c.state === "ready") { c.state = "held"; newlyHeld = true; }
    }
    if (!wasPending && !fired.length && !newlyHeld) continue;
    if (wasPending) l.status = "printed";
    sent.push(l);
    const base = l.modifiers.filter(m => m.course == null), notes = notesOf(l);
    let usedBase = false;
    for (const c of fired) {
      const mods = modsOfCourse(l, c.course), food = c.course >= 1;
      items.push({
        plu: mods.find(m => m.plu)?.plu ?? l.productId, quantity: l.quantity, name: l.name, comment: food ? l.comment : "",
        modifiers: [...(food && wasPending && !usedBase ? base : []), ...mods], tag: c.course === 0 ? "BEBIDA" : `MARCHA ${courseLabel(c.course).toUpperCase()}`,
        notes: food ? notes : [],
      });
      if (food && wasPending) usedBase = true;
    }
    const hasFood = l.courses.some(c => c.course >= 1);
    if (hasFood && !fired.some(c => c.course >= 1) && (wasPending || newlyHeld))
      items.push({ plu: l.productId, quantity: l.quantity, name: l.name, comment: l.comment, modifiers: base, tag: "AVISO MENÚ", notes });
  }
  return { account: out, sent, items };
}

/** Elegir (o cambiar) las respuestas de un pase que aún no ha salido. La validación de mínimos/máximos la hace checkAnswers. */
export function chooseCourse(acc: Account, lineId: string, course: number, mods: Modifier[]): Account {
  if (acc.status !== "open") fail("ACCOUNT_CLOSED", "La cuenta ya está facturada", { accountId: acc.id });
  const out = clone(acc);
  const l = out.lines.find(x => x.id === lineId) ?? fail("NOT_FOUND", "La línea no existe", { lineId });
  const c = l!.courses?.find(x => x.course === course) ?? fail("VALIDATION", "Ese pase no existe en la línea", { field: "course" });
  if (c!.state === "fired") fail("VALIDATION", `${courseLabel(course)} ya está marchado: no se puede cambiar`, { field: "course" });
  l!.modifiers = [...l!.modifiers.filter(m => m.course !== course), ...mods.map(m => ({ ...m, course, questionId: c!.questionId }))];
  c!.state = mods.length ? "ready" : "pending";
  return out;
}

/**
 * «Inclúyeme la bebida en el menú»: una bebida ya pedida pasa a ser la bebida del menú.
 * - Se quitan de la línea de carta tantas unidades como menús tiene la línea (si estaba enviada queda como eliminada
 *   con motivo «Incluida en menú», sin pedir encargado; si no se había enviado, simplemente se quita).
 * - El pase de bebida del menú queda con esa respuesta: marchado si la bebida ya se había enviado, listo si no.
 */
export function absorbIntoMenu(acc: Account, input: { menuLineId: string; course: number; sourceLineId: string; answer: Modifier }, ctx: Ctx): Account {
  if (acc.status !== "open") fail("ACCOUNT_CLOSED", "La cuenta ya está facturada", { accountId: acc.id });
  const out = clone(acc);
  const menu = out.lines.find(x => x.id === input.menuLineId) ?? fail("NOT_FOUND", "La línea del menú no existe", { lineId: input.menuLineId });
  const src = out.lines.find(x => x.id === input.sourceLineId) ?? fail("NOT_FOUND", "La bebida no existe en esta cuenta", { lineId: input.sourceLineId });
  if (menu!.id === src!.id) fail("VALIDATION", "La bebida y el menú son la misma línea", { field: "sourceLineId" });
  const c = menu!.courses?.find(x => x.course === input.course) ?? fail("VALIDATION", "Ese pase no existe en el menú", { field: "course" });
  if (c!.state === "fired") fail("VALIDATION", `${courseLabel(input.course)} del menú ya está marchado`, { field: "course" });
  if (src!.courses?.length || src!.modifiers.length) fail("VALIDATION", "Solo se puede incluir un producto sencillo", { field: "sourceLineId" });
  const n = menu!.quantity;
  if (src!.quantity < n) fail("VALIDATION", `Hacen falta ${n} unidades de ${src!.name} (hay ${src!.quantity})`, { field: "sourceLineId", need: n, have: src!.quantity });
  const sentSrc = src!.status !== "pendingPrint";
  if (sentSrc) {
    const d: DeletedLine = { ...clone(src!), id: src!.quantity === n ? src!.id : ctx.newId(), quantity: n, reason: MENU_ABSORB_REASON, removedBy: ctx.actor, authorizedBy: null, removedAt: ctx.now.toISOString() };
    out.deletedLines.push(d);
  }
  src!.quantity -= n;
  if (src!.quantity <= 0) out.lines = out.lines.filter(x => x.id !== src!.id);
  menu!.modifiers = [...menu!.modifiers.filter(m => m.course !== input.course), { ...input.answer, quantity: 1, course: input.course, questionId: c!.questionId }];
  c!.state = sentSrc ? "fired" : "ready"; c!.firedAt = sentSrc ? ctx.now.toISOString() : null;
  return out;
}
