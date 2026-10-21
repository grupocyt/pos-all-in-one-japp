/**
 * Qué tienda es este servidor (decidido 21/10/2026). Cada tienda tiene su servidor y su base, así que lo normal es
 * que la base tenga UNA tienda y no haga falta configurar nada:
 * - Sin STORE_CODE: la única tienda activa de la base. Si hay varias, no se adivina: error claro al arrancar.
 * - Con STORE_CODE: se compara sin espacios ni mayúsculas («CT03» = «ct 03» = «CT 03»).
 * El código de verdad vive en la base (store.code, Ajustes › Restaurante); el .env solo elige entre varias.
 */
export interface StoreRow {
  id: string;
  code: string;
  active: boolean;
}

export const normalizeStoreCode = (code: string) => code.replace(/\s+/g, "").toUpperCase();

export class StoreSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreSelectionError";
  }
}

export function pickStore<S extends StoreRow>(stores: S[], code?: string | null): S {
  const active = stores.filter((s) => s.active);
  const wanted = code?.trim();
  const list = active.map((s) => s.code).join(", ");
  if (wanted) {
    const n = normalizeStoreCode(wanted);
    const hits = active.filter((s) => normalizeStoreCode(s.code) === n);
    if (hits.length === 1) {
      return hits[0]!;
    }
    if (hits.length > 1) {
      throw new StoreSelectionError(
        `STORE_CODE=${wanted} coincide con varias tiendas (${hits.map((s) => s.code).join(", ")}): usa STORE_ID`,
      );
    }
    throw new StoreSelectionError(
      `No hay ninguna tienda activa con el código ${wanted}. En la base: ${list || "ninguna"}. ` +
        "Quita STORE_CODE del .env (si solo hay una) o pon uno de esos códigos",
    );
  }
  if (active.length === 1) {
    return active[0]!;
  }
  if (active.length === 0) {
    throw new StoreSelectionError(
      "La base no tiene ninguna tienda activa: créala con npm run db:init (SEED=1 para la Sucursal Pruebas)",
    );
  }
  throw new StoreSelectionError(
    `La base tiene ${active.length} tiendas (${list}): pon STORE_CODE en .env para elegir cuál es este servidor`,
  );
}
