import { fail } from "./errors.js";

/**
 * Tanda de comandos de una mesa (POST /orders/{orderId}/batch, decidido 25/10/2026).
 * El TPV junta lo que se marca (5 s sin tocar, o antes de una acción) y lo manda en UNA petición: se aplica todo en una
 * transacción o nada. Solo entran comandos que se quedan en la base: los que imprimen (Guardar/enviar, marchar un pase,
 * precuenta), mueven dinero (cobros, descuentos, facturas) o tocan la presencia van sueltos, porque un papel impreso o un
 * cobro no se pueden deshacer si la tanda falla después.
 */
export const BATCH_MAX_COMMANDS = 100;

export type BatchMethod = "POST" | "PATCH" | "PUT" | "DELETE";
export interface BatchCommand {
  method: BatchMethod;
  /** Ruta relativa a /api/v2, p. ej. /orders/{orderId}/lines */
  path: string;
  body?: Record<string, unknown> | null;
  /** Idempotency-Key del comando (la misma que llevaría suelto). */
  idempotencyKey?: string | null;
}

const ID = "[0-9a-fA-F-]{36}";
/** [método, patrón tras /orders/{orderId}, nombre para los mensajes] */
const ALLOWED: [BatchMethod, RegExp, string][] = [
  ["PATCH", /^$/, "cambiar la mesa"],
  ["POST", /^\/accounts$/, "nueva cuenta"],
  ["DELETE", new RegExp(`^/accounts/${ID}$`), "borrar una cuenta vacía"],
  ["PATCH", new RegExp(`^/accounts/${ID}$`), "renombrar una cuenta"],
  ["POST", /^\/lines$/, "añadir"],
  ["POST", /^\/lines\/move$/, "pasar a otra cuenta"],
  ["POST", /^\/lines\/reorder$/, "ordenar"],
  ["PATCH", new RegExp(`^/lines/${ID}$`), "cambiar una línea"],
  ["POST", new RegExp(`^/lines/${ID}/delete$`), "quitar o eliminar"],
  ["PUT", new RegExp(`^/lines/${ID}/answers$`), "elegir un pase"],
  ["POST", new RegExp(`^/lines/${ID}/absorb$`), "incluir en el menú"],
];

/**
 * Comprueba la tanda antes de abrir la transacción: cada comando es de esta orden y de los que se pueden juntar.
 * Abrir la mesa (POST /orders) solo si es esta misma orden (body.id). Cambiar un pase ya marchado (lleva motivo y
 * reimprime) no entra. Devuelve los comandos tal cual; si alguno no vale → 422 VALIDATION con el campo commands[i].
 */
export function planBatch(orderId: string, commands: BatchCommand[]): BatchCommand[] {
  if (!Array.isArray(commands) || commands.length === 0) {
    fail("VALIDATION", "La tanda no trae comandos", { field: "commands" });
  }
  if (commands.length > BATCH_MAX_COMMANDS) {
    fail("VALIDATION", `Como mucho ${BATCH_MAX_COMMANDS} comandos por tanda`, { field: "commands" });
  }
  const base = `/orders/${orderId}`;
  commands.forEach((c, i) => {
    const field = `commands[${i}]`;
    const path = String(c?.path ?? "").split("?")[0]!;
    if (c.method === "POST" && path === "/orders") {
      if (c.body?.id !== orderId) {
        fail("VALIDATION", "En una tanda solo se puede abrir esta misma mesa", { field: `${field}.body.id` });
      }
      return;
    }
    if (path !== base && !path.startsWith(base + "/")) {
      fail("VALIDATION", "Todos los comandos de la tanda tienen que ser de esta mesa", {
        field: `${field}.path`,
      });
    }
    const rest = path.slice(base.length);
    const ok = ALLOWED.find(([m, re]) => m === c.method && re.test(rest));
    if (!ok) {
      fail("VALIDATION", `«${c.method} ${path}» no se puede mandar en una tanda: va suelto`, {
        field: `${field}.path`,
      });
    }
    if (ok![2] === "elegir un pase" && (c.body?.reason != null || c.body?.reasonId != null)) {
      fail("VALIDATION", "Cambiar un pase ya marchado reimprime: va suelto, no en una tanda", {
        field: `${field}.body`,
      });
    }
  });
  return commands;
}
