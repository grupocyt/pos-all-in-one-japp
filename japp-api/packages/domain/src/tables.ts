/** Estado visible de una mesa en el plano (= cls() del prototipo). */
export type TableClass = "free" | "bill" | "split" | "mine" | "busy";
export interface OpenTable { state?: "open" | "bill" | "split"; waiter: string; }
export function tableClass(open: OpenTable | null | undefined, currentUser: string | null): TableClass {
  if (!open) return "free";
  if (open.state === "bill") return "bill";
  if (open.state === "split") return "split";
  return currentUser && open.waiter === currentUser ? "mine" : "busy";
}
/** Transferir: solo a una mesa libre. */
export function canTransferTo(dest: OpenTable | null | undefined): boolean { return !dest; }
