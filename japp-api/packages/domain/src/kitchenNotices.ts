import { madridParts, wrap, WIDTH, type TicketLine } from "./tickets.js";

const T = (text: string, o: Omit<Extract<TicketLine, { k: "text" }>, "k" | "text"> = {}): TicketLine => ({
  k: "text",
  text,
  ...o,
});
const R = (ch: "=" | "-"): TicketLine => ({ k: "rule", ch });
const W2 = WIDTH / 2;

/** Comanda de anulación: lo que se elimina después de enviarlo, a las mismas impresoras por las que salió. */
export interface KitchenVoidContext {
  channel: string;
  waiter: string;
  table: { name: string; area: string };
  at: Date;
  /** printed = eliminado tras enviar a cocina; preBill = tras la precuenta */
  stage: "printed" | "preBill";
  reason: string;
  authorizedBy?: string | null;
}

/**
 * Comanda de anulación (25/10/2026, igual que la vista previa del TPV): «ANULADO» en grande, canal/camarero, hora,
 * mesa, en qué momento se eliminó, el motivo y quién autorizó, cada producto con «-N» y «*** NO PREPARAR ***».
 */
export function kitchenVoidTicket(
  lines: { quantity: number; name: string; modifiers?: { name: string; quantity?: number }[] }[],
  ctx: KitchenVoidContext,
): TicketLine[] {
  const area = ctx.table.area ? `${ctx.table.area}/` : "";
  const out: TicketLine[] = [
    { k: "feed" },
    T("*** ANULADO ***", { align: "center", size: "wh", bold: true }),
    T(`${ctx.channel.toUpperCase()}/ ${ctx.waiter}`, { align: "center" }),
    T(madridParts(ctx.at).hms, { align: "center", size: "h" }),
    T(`Mesa ${area}${ctx.table.name}`, { align: "center", size: "w" }),
    R("="),
    T(ctx.stage === "preBill" ? "ELIMINADO TRAS LA PRECUENTA" : "ELIMINADO TRAS ENVIAR A COCINA", {
      align: "center",
      bold: true,
    }),
  ];
  wrap(`MOTIVO: ${(ctx.reason || "—").toUpperCase()}`, WIDTH).forEach((x) =>
    out.push(T(x, { align: "center", bold: true })),
  );
  if (ctx.authorizedBy) {
    out.push(T(`Autoriza: ${ctx.authorizedBy}`, { align: "center" }));
  }
  out.push(R("-"));
  lines.forEach((l, i) => {
    if (i) {
      out.push({ k: "feed" });
    }
    const q = "-" + l.quantity;
    const pre = q + " ".repeat(Math.max(2, 4 - q.length));
    const parts = wrap(l.name.toUpperCase(), W2 - pre.length);
    out.push(T(pre + parts[0], { size: "w" }));
    parts.slice(1).forEach((p) => out.push(T(" ".repeat(pre.length) + p, { size: "w" })));
    for (const m of l.modifiers ?? []) {
      out.push(T(`   -- ${(m.quantity ?? 1) * l.quantity} ${m.name.toUpperCase()}`));
    }
  });
  out.push(R("="), T("*** NO PREPARAR ***", { align: "center", bold: true, size: "w" }));
  out.push({ k: "feed", n: 3 }, { k: "cut" });
  return out;
}

/** Aviso de cambio de mesa: a las impresoras por las que ya salió algo de esa mesa. */
export interface TableChangeContext {
  channel: string;
  waiter: string;
  from: { name: string; area: string };
  to: { name: string; area: string };
  /** solo una cuenta (Separar · pasar cuenta a otra mesa): su nombre */
  account?: string | null;
  at: Date;
}

/**
 * Aviso de cambio de mesa (25/10/2026): «CAMBIO DE MESA» en grande, de qué mesa a cuál (la nueva en grande),
 * canal/camarero y la hora, para que cocina y barra lleven lo pendiente a la mesa nueva.
 */
export function tableChangeTicket(ctx: TableChangeContext): TicketLine[] {
  const m = (t: { name: string; area: string }) => `Mesa ${t.area ? `${t.area}/` : ""}${t.name}`;
  const out: TicketLine[] = [
    { k: "feed" },
    T("CAMBIO DE MESA", { align: "center", size: "wh", bold: true }),
    T(`${ctx.channel.toUpperCase()}/ ${ctx.waiter}`, { align: "center" }),
    T(madridParts(ctx.at).hms, { align: "center", size: "h" }),
    R("="),
    T(`DE: ${m(ctx.from)}`, { align: "center", size: "w" }),
    T(`A: ${m(ctx.to)}`, { align: "center", size: "wh", bold: true }),
  ];
  if (ctx.account) {
    out.push(T(`Solo ${ctx.account}`, { align: "center", bold: true }));
  }
  out.push(R("="), T("Lo pendiente va a la mesa nueva", { align: "center" }));
  out.push({ k: "feed", n: 3 }, { k: "cut" });
  return out;
}
