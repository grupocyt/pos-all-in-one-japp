import { fail } from "./errors.js";
import { ACCOUNT_NAME_MAX } from "./orderState.js";
import type { Order } from "./types.js";

/** «Cuenta 7», «cuenta  7», « CUENTA 7 »: los nombres automáticos (sin distinguir mayúsculas ni espacios de más). */
const NUMBERED = /^cuenta (\d+)$/;

const normalize = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase("es");

/**
 * Nombre de la cuenta nueva: «Cuenta N» con N = el número más alto que aparezca en un nombre «Cuenta N» de las
 * cuentas que hay + 1. Con «Cuenta 1» y «Cuenta 3» (la 2 se quitó) la siguiente es «Cuenta 4» (no se rellenan huecos);
 * si se quita la última, su número vuelve a usarse (pruebas del 26/10/2026: separar a una cuenta nueva y vaciar la de
 * origen ya no salta números).
 * - order: las cuentas cargadas (abiertas y facturadas);
 * - knownNames: otros nombres vivos que no estén en order (el servidor ya no pasa las anuladas).
 */
export function nextAccountName(order: Pick<Order, "accounts">, knownNames: readonly string[] = []): string {
  let max = 0;
  for (const name of [...order.accounts.map((a) => a.name), ...knownNames]) {
    const m = NUMBERED.exec(normalize(name));
    if (m) {
      max = Math.max(max, Number(m[1]));
    }
  }
  return `Cuenta ${max + 1}`;
}

/**
 * Nombre de una cuenta que se añade a la mesa (POST /orders/{id}/accounts):
 * - sin nombre (o en blanco) → nextAccountName;
 * - con nombre → se respeta, con las reglas del renombrado: 1–40 caracteres sin espacios de más y sin repetir
 *   el de otra cuenta de la mesa (sin distinguir mayúsculas) → 409 DUPLICATE.
 */
export function newAccountName(
  order: Pick<Order, "accounts">,
  requested: string | null | undefined,
  knownNames: readonly string[] = [],
): string {
  if (!requested?.trim()) {
    return nextAccountName(order, knownNames);
  }
  const clean = requested.trim().replace(/\s+/g, " ");
  if (clean.length > ACCOUNT_NAME_MAX) {
    fail("VALIDATION", `El nombre tiene que tener de 1 a ${ACCOUNT_NAME_MAX} caracteres`, { field: "name" });
  }
  const key = normalize(clean);
  const other = order.accounts.find((a) => normalize(a.name) === key);
  if (other) {
    fail("DUPLICATE", `Ya hay una cuenta «${other.name}» en esta mesa`, {
      field: "name",
      accountId: other.id,
    });
  }
  return clean;
}
