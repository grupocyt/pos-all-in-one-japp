/** Estado visible de una mesa en el plano (= cls() del prototipo). */
export type TableClass = "free" | "bill" | "split" | "mine" | "busy";
export interface OpenTable {
  state?: "open" | "bill" | "split";
  waiter: string;
}
export function tableClass(open: OpenTable | null | undefined, currentUser: string | null): TableClass {
  if (!open) {
    return "free";
  }
  if (open.state === "bill") {
    return "bill";
  }
  if (open.state === "split") {
    return "split";
  }
  return currentUser && open.waiter === currentUser ? "mine" : "busy";
}
/** Transferir: solo a una mesa libre. */
export function canTransferTo(dest: OpenTable | null | undefined): boolean {
  return !dest;
}

/**
 * Editar sala (decisión del 28/10, TPV 1.2.261): una mesa no puede quedar encima de otra. Rectángulos x, y, ancho y alto
 * en las mismas unidades del plano; tocarse por el borde (0,2) no cuenta. Devuelve la primera pareja que se solapa.
 */
export function findTableOverlap(
  tables: { number: string; x: number; y: number; width: number; height: number }[],
): { a: string; b: string } | null {
  const E = 0.2;
  for (let i = 0; i < tables.length; i++) {
    for (let j = i + 1; j < tables.length; j++) {
      const p = tables[i]!;
      const q = tables[j]!;
      if (
        p.x < q.x + q.width - E &&
        p.x + p.width > q.x + E &&
        p.y < q.y + q.height - E &&
        p.y + p.height > q.y + E
      ) {
        return { a: p.number, b: q.number };
      }
    }
  }
  return null;
}
