import { fail } from "./errors.js";

/**
 * Order on Table (decidido 18/10/2026 por el product owner):
 * - Un token por orden abierta; generar otra vez devuelve el vigente. Permiso mesas.orderOnTable.
 * - Caduca al cerrar la mesa (facturada entera o cerrada sin venta) o al anularlo; no caduca por tiempo.
 * - URL del QR = store.web_order_url + "/t/" + token. Sin URL en Restaurante → 409 OOT_NOT_CONFIGURED.
 * - Lo que pide el cliente se envía solo (como si el camarero pulsara Enviar) a una cuenta «Order on Table».
 * - Solo productos con orderOnTable cuya categoría también lo tenga; si no → 422 PRODUCT_NOT_OOT.
 */
export const OOT_ACCOUNT_NAME = "Order on Table";
export const OOT_TOKEN_PREFIX = "oot_";
const TOKEN_RE = /^oot_[A-Za-z0-9_-]{16,56}$/;

/** El token se hace con bytes aleatorios que da la API (el dominio no genera azar). */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function ootToken(random: Uint8Array): string {
  if (random.length < 16) {
    throw new Error("ootToken necesita al menos 16 bytes aleatorios");
  }
  // Un carácter por byte (6 bits de cada uno): con 32 bytes son 192 bits, imposible de adivinar.
  const body = Array.from(random.slice(0, 56), (b) => ALPHABET[b & 63]).join("");
  return `${OOT_TOKEN_PREFIX}${body}`;
}

export const isOotToken = (s: string) => TOKEN_RE.test(s);

export function ootUrl(webOrderUrl: string | null | undefined, token: string): string {
  const base = webOrderUrl?.trim();
  if (!base) {
    fail("OOT_NOT_CONFIGURED", "Falta la URL de Order on Table en Ajustes › Restaurante");
  }
  return `${(base as string).replace(/\/+$/, "")}/t/${token}`;
}

export interface OotTokenState {
  orderStatus: string;
  revokedAt: Date | string | null;
}

/** Token vigente: existe, no anulado y la mesa sigue abierta. Si no → 404 OOT_TOKEN_INVALID. */
export function assertOotTokenLive(t: OotTokenState | null): void {
  if (!t || t.revokedAt) {
    fail("OOT_TOKEN_INVALID", "Este QR ya no vale: pide uno nuevo al camarero");
  }
  const s = (t as OotTokenState).orderStatus;
  if (s === "closed" || s === "cancelled") {
    fail("OOT_TOKEN_INVALID", "Esta mesa ya está cerrada: pide uno nuevo al camarero");
  }
}

export interface OotProduct {
  plu: number;
  name: string;
  active: boolean;
  soldOut: boolean;
  answerOnly: boolean;
  orderOnTable: boolean;
  category: { orderOnTable: boolean; hidden: boolean; active: boolean } | null;
}

export const isOotProduct = (p: OotProduct) =>
  p.active &&
  !p.answerOnly &&
  p.orderOnTable &&
  !!p.category &&
  p.category.active &&
  !p.category.hidden &&
  p.category.orderOnTable;

/** Lo que pide el cliente tiene que estar en la carta de Order on Table. */
export function assertOotProduct(p: OotProduct | null, plu: number, index: number): void {
  if (!p || !isOotProduct(p)) {
    fail("PRODUCT_NOT_OOT", `El producto ${plu} no está disponible en Order on Table`, {
      field: `items[${index}].plu`,
      plu,
    });
  }
  if ((p as OotProduct).soldOut) {
    fail("PRODUCT_NOT_OOT", `${(p as OotProduct).name} está agotado`, {
      field: `items[${index}].plu`,
      plu,
      soldOut: true,
    });
  }
}
