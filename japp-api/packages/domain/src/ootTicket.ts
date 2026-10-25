import { lr, madridParts, wrap, WIDTH, type TicketLine } from "./tickets.js";

/** Lo que lleva el ticket del QR de Order on Table. */
export interface OotQrContext {
  /** chain = nombre comercial de la cadena (Ajustes › Empresa); name = nombre del local (Ajustes › Restaurante). */
  store: { chain?: string | null; name?: string | null; tradeName?: string; legalName: string };
  table: { name: string; area: string };
  url: string;
  /** Token del QR: en el ticket solo sale el «código de mesa» (4 primeros y 4 últimos). */
  token?: string | null;
  /** Quien lo imprime (abajo a la derecha). */
  waiter?: string | null;
  at: Date;
}

const T = (text: string, o: Omit<Extract<TicketLine, { k: "text" }>, "k" | "text"> = {}): TicketLine => ({
  k: "text",
  text,
  ...o,
});

/**
 * Ticket «ootQr» (Order on Table), igual que la vista previa del TPV (25/10/2026): logo de la cadena, «cadena · local»,
 * «PIDE DESDE TU MÓVIL», «ÁREA · MESA N» en grande, cómo pedir, el QR, el código de mesa y quién lo imprimió.
 */
export function ootQrTicket(ctx: OotQrContext): TicketLine[] {
  const when = madridParts(ctx.at);
  const s = ctx.store;
  const chain = s.chain ?? null;
  const local = s.name ?? s.tradeName ?? null;
  const head = [chain, local].filter(Boolean).join(" · ") || s.legalName;
  const area = String(ctx.table.area || "").toUpperCase();
  const tk = ctx.token ?? "";
  const out: TicketLine[] = [{ k: "logo" }];
  wrap(head, WIDTH).forEach((x) => out.push(T(x, { align: "center" })));
  out.push({ k: "rule", ch: "=" });
  out.push(T("PIDE DESDE TU MÓVIL", { align: "center", bold: true, size: "w" }));
  out.push(T("Order on Table", { align: "center" }));
  out.push({ k: "rule", ch: "-" });
  out.push(
    T(area ? `${area} · MESA ${ctx.table.name}` : `MESA ${ctx.table.name}`, {
      align: "center",
      bold: true,
      size: "wh",
    }),
  );
  out.push({ k: "rule", ch: "-" }, { k: "feed" });
  wrap(
    "Escanea el código con la cámara del móvil para ver la carta y pedir. Tu pedido llega directo a esta mesa.",
    WIDTH,
  ).forEach((x) => out.push(T(x, { align: "center" })));
  out.push({ k: "feed" }, { k: "qr", data: ctx.url }, { k: "feed" });
  if (tk.length >= 8) {
    out.push(T(`Código de mesa: ${tk.slice(0, 4)}-${tk.slice(-4)}`, { align: "center", bold: true }));
  }
  out.push(T("Válido solo para esta mesa mientras esté abierta", { align: "center" }));
  out.push({ k: "rule", ch: "-" });
  out.push(T(lr(`${when.date} ${when.hm}`, ctx.waiter ?? "")));
  out.push({ k: "feed", n: 2 }, { k: "cut" });
  return out;
}
