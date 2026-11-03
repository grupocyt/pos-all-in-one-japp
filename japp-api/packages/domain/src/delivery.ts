import { fail } from "./errors.js";
import { D, r2, sum } from "./money.js";

/**
 * Pedidos de delivery (TPV 1.2.217–1.2.233 y 1.2.264): tablero con estados, semáforo y motorizado.
 * Estados en orden: pending → received → to_assign → assigned → on_route → delivered; cancelled desde cualquiera sin terminar.
 * En el TPV: pend, rec, poras, asig, camino, done, cancel.
 */
export const DELIVERY_FLOW = [
  "pending",
  "received",
  "to_assign",
  "assigned",
  "on_route",
  "delivered",
] as const;
export type DeliveryStatus = (typeof DELIVERY_FLOW)[number] | "cancelled";
export const DELIVERY_LIVE: DeliveryStatus[] = ["pending", "received", "to_assign", "assigned", "on_route"];
export const isDeliveryFinished = (s: string) => s === "delivered" || s === "cancelled";

/** Estado del TPV ↔ estado de la API. */
export const DELIVERY_TPV: Record<DeliveryStatus, string> = {
  pending: "pend",
  received: "rec",
  to_assign: "poras",
  assigned: "asig",
  on_route: "camino",
  delivered: "done",
  cancelled: "cancel",
};

/** Quien lo lleva cuando no se elige motorizado (sin askRider). */
export const PLATFORM_RIDER = "Repartidor de la plataforma";

/** El estado siguiente; un pedido entregado o cancelado no avanza (INVALID_TRANSITION). */
export function nextDeliveryStatus(s: string): DeliveryStatus {
  const i = (DELIVERY_FLOW as readonly string[]).indexOf(s);
  if (i < 0 || i === DELIVERY_FLOW.length - 1) {
    fail("INVALID_TRANSITION", "El pedido ya está entregado o cancelado", { status: s });
  }
  return DELIVERY_FLOW[i + 1]!;
}

/** Se cancela cualquiera sin terminar. */
export function assertDeliveryCancel(s: string): void {
  if (isDeliveryFinished(s)) {
    fail("INVALID_TRANSITION", "El pedido ya está entregado o cancelado", { status: s });
  }
}

/** Minutos de espera desde que llegó y semáforo: verde, ámbar desde amberMinutes, rojo desde redMinutes; null si terminó. */
export function deliveryLight(
  status: string,
  receivedAt: string | Date,
  now: Date,
  s: { amberMinutes: number; redMinutes: number },
  finishedAt?: string | Date | null,
): { wait: number; light: "green" | "amber" | "red" | null } {
  const end = finishedAt ? new Date(finishedAt) : now;
  const wait = Math.max(0, Math.floor((end.getTime() - new Date(receivedAt).getTime()) / 60000));
  if (isDeliveryFinished(status)) {
    return { wait, light: null };
  }
  if (wait >= s.redMinutes) {
    return { wait, light: "red" };
  }
  if (wait >= s.amberMinutes) {
    return { wait, light: "amber" };
  }
  return { wait, light: "green" };
}

/** Total del pedido: Σ cantidad × precio, redondeado a céntimos (lo que mande el integrador como total no cuenta). */
export const deliveryTotal = (lines: { quantity: number; unitPrice: number }[]) =>
  r2(sum(lines.map((l) => D(l.quantity).times(l.unitPrice))));

/** Ajustes › Pedidos: los minutos del semáforo y la preparación van de 1 a 240 y el rojo después del ámbar. */
export function checkDeliverySettings(r: {
  prepMinutes?: number;
  amberMinutes?: number;
  redMinutes?: number;
}) {
  for (const k of ["prepMinutes", "amberMinutes", "redMinutes"] as const) {
    const v = r[k];
    if (v != null && (!Number.isInteger(v) || v < 1 || v > 240)) {
      fail("VALIDATION", "Los minutos van de 1 a 240", { field: k });
    }
  }
  if (r.amberMinutes != null && r.redMinutes != null && r.redMinutes <= r.amberMinutes) {
    fail("VALIDATION", "El rojo tiene que ser después del ámbar", { field: "redMinutes" });
  }
}
