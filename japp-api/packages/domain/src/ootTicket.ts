import { madridParts, wrap, WIDTH, type TicketLine } from "./tickets.js";

/** Lo que lleva el ticket del QR de Order on Table. */
export interface OotQrContext {
  store: { tradeName?: string; legalName: string };
  table: { name: string; area: string };
  url: string;
  at: Date;
}

/**
 * Ticket «ootQr» (Order on Table): el camarero lo deja en la mesa para que el cliente pida desde el móvil.
 * Nombre de la tienda, «Mesa N Área» en grande, el QR con la URL y la URL en texto (por si el móvil no lee el QR).
 */
export function ootQrTicket(ctx: OotQrContext): TicketLine[] {
  const when = madridParts(ctx.at);
  const out: TicketLine[] = [{ k: "logo" }];
  out.push({ k: "text", text: ctx.store.tradeName || ctx.store.legalName, align: "center", bold: true });
  out.push({ k: "feed" });
  out.push({
    k: "text",
    text: `Mesa ${ctx.table.name} ${ctx.table.area}`.trim(),
    align: "center",
    size: "wh",
  });
  out.push({ k: "feed" });
  out.push({ k: "text", text: "PIDE DESDE TU MÓVIL", align: "center", bold: true });
  out.push({ k: "text", text: "Escanea el código y haz tu pedido", align: "center" });
  out.push({ k: "feed" });
  out.push({ k: "qr", data: ctx.url });
  out.push({ k: "feed" });
  // la URL entera, partida en trozos de 48 columnas (una URL no tiene espacios: se corta a lo ancho)
  for (const part of wrap(ctx.url, WIDTH)) {
    out.push({ k: "text", text: part, align: "center" });
  }
  out.push({ k: "feed" });
  out.push({ k: "text", text: `${when.date} ${when.hm}`, align: "center" });
  out.push({ k: "feed", n: 2 }, { k: "cut" });
  return out;
}
