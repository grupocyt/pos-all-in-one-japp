import { fail } from "./errors.js";

/**
 * Servicios Sync del App Manager (decidido 17/10/2026; Ajustes › Developer › API backend › Sync · App Manager):
 * - El Manager manda la lista COMPLETA (categorías, productos o preguntas, o la carta entera) y la tienda queda así.
 * - Cada registro se reconoce por externalId (id del Manager); si no viene, por su clave natural
 *   (nombre en categorías y preguntas, PLU en productos). Por clave natural solo casa con uno que no tenga
 *   otro externalId (si lo tiene, es otro registro del Manager).
 * - Lo que existe se actualiza, lo que no se crea, y un externalId que vuelve reactiva el registro con su mismo id.
 * - Lo que no viene se desactiva (nunca se borra: las ventas antiguas lo nombran).
 * - Todo o nada: cualquier error deja la tienda como estaba (la API lo hace en una sola transacción).
 */
export interface SyncExisting {
  id: string;
  externalId: string | null;
  /** Nombre (categorías, preguntas) o PLU (productos), tal cual. */
  naturalKey: string;
  active: boolean;
}

export interface SyncIncoming {
  externalId?: string | null;
  /** null si no viene (producto nuevo sin PLU): solo se reconoce por externalId. */
  naturalKey: string | null;
}

export type SyncAction = "created" | "updated" | "reactivated" | "unchanged";

export interface SyncMatch<E> {
  index: number;
  existing: E | null;
  action: Exclude<SyncAction, "unchanged">;
}

export interface SyncPlan<E> {
  items: SyncMatch<E>[];
  deactivate: E[];
}

const norm = (s: string) => s.trim().toLowerCase();

/** Repetidos dentro de la lista → 409 DUPLICATE con el campo de la fila (items[3].externalId). */
export function assertNoRepeats(incoming: SyncIncoming[], keyField: string, path = "items"): void {
  const seenExt = new Map<string, number>();
  const seenKey = new Map<string, number>();
  incoming.forEach((x, i) => {
    if (x.externalId) {
      const k = x.externalId.trim();
      if (seenExt.has(k)) {
        fail("DUPLICATE", `externalId repetido en la lista: ${k}`, {
          field: `${path}[${i}].externalId`,
          first: seenExt.get(k),
        });
      }
      seenExt.set(k, i);
    }
    if (x.naturalKey !== null) {
      const k = norm(x.naturalKey);
      if (seenKey.has(k)) {
        fail("DUPLICATE", `${keyField} repetido en la lista: ${x.naturalKey}`, {
          field: `${path}[${i}].${keyField}`,
          first: seenKey.get(k),
        });
      }
      seenKey.set(k, i);
    }
  });
}

/** Casa lo que llega con lo que hay. No decide «sin cambios»: eso lo sabe quien compara los campos. */
export function planSync<E extends SyncExisting>(
  existing: E[],
  incoming: SyncIncoming[],
  o: { keyFirst?: boolean } = {},
): SyncPlan<E> {
  const byExt = new Map<string, E>();
  for (const e of existing) {
    if (e.externalId) {
      byExt.set(e.externalId.trim(), e);
    }
  }
  const used = new Set<string>();
  const found: (E | null)[] = new Array(incoming.length).fill(null);
  // keyFirst (productos: el PLU nunca cambia): primero se casa todo lo que trae clave natural por esa clave,
  // tenga el registro el externalId que tenga; así el producto conserva su id (y sus canales de impresión)
  // aunque el Manager le cambie el id. Después, el resto como siempre.
  if (o.keyFirst) {
    incoming.forEach((x, i) => {
      if (x.naturalKey === null) {
        return;
      }
      const key = norm(x.naturalKey);
      const hit = existing.find((e) => !used.has(e.id) && norm(e.naturalKey) === key);
      if (hit) {
        used.add(hit.id);
        found[i] = hit;
      }
    });
  }
  const items: SyncMatch<E>[] = incoming.map((x, index) => {
    let hit = found[index] ?? null;
    if (!hit) {
      hit = findMatch(existing, byExt, used, x);
      if (hit) {
        used.add(hit.id);
      }
    }
    if (!hit) {
      return { index, existing: null, action: "created" };
    }
    if (!hit.active) {
      return { index, existing: hit, action: "reactivated" };
    }
    return { index, existing: hit, action: "updated" };
  });
  const deactivate = existing.filter((e) => e.active && !used.has(e.id));
  return { items, deactivate };
}

function findMatch<E extends SyncExisting>(
  existing: E[],
  byExt: Map<string, E>,
  used: Set<string>,
  x: SyncIncoming,
): E | null {
  const ext = x.externalId?.trim();
  if (ext) {
    const hit = byExt.get(ext);
    if (hit && !used.has(hit.id)) {
      return hit;
    }
  }
  if (x.naturalKey === null) {
    return null;
  }
  const key = norm(x.naturalKey);
  // Por clave natural: primero uno activo, luego uno desactivado. Nunca uno que es de otro externalId.
  const candidates = existing.filter(
    (e) =>
      !used.has(e.id) &&
      norm(e.naturalKey) === key &&
      (!e.externalId || (ext !== undefined && e.externalId.trim() === ext)),
  );
  const active = candidates.find((e) => e.active);
  if (active) {
    return active;
  }
  return candidates[0] ?? null;
}

/** Tamaño máximo de una carga → 413 TOO_LARGE. */
export const SYNC_LIMITS = {
  categorias: 500,
  productos: 2000,
  preguntas: 500,
  answersPerQuestion: 100,
  carta: { categories: 500, products: 5000, questions: 1000 },
} as const;

export function assertSyncSize(what: string, count: number, max: number): void {
  if (count > max) {
    fail("TOO_LARGE", `Demasiadas filas: ${count} ${what} (máximo ${max})`, { what, count, max });
  }
}

/**
 * Referencia a otro registro por externalId (o por id/PLU de la tienda). Si no está → 422 REF_NOT_FOUND
 * con el campo exacto (items[0].answers[2].productExternalId).
 */
export function resolveRef<T>(map: Map<string, T>, key: string | number, field: string, what: string): T {
  const hit = map.get(String(key).trim());
  if (hit === undefined) {
    fail("REF_NOT_FOUND", `No existe ${what} ${key} en la tienda`, {
      field,
      ref: key,
    });
  }
  return hit as T;
}

/**
 * Quitar algo que todavía se usa (sync individual): 409 IN_USE con la lista de lo que lo usa.
 * En la carga de la carta completa no se llama: allí se quita en cascada.
 */
export function assertNotInUse(rows: { name: string; count: number }[], what: string): void {
  const busy = rows.filter((r) => r.count > 0);
  if (busy.length > 0) {
    const first = busy[0]!;
    fail("IN_USE", `No se puede quitar ${what} «${first.name}»: la usan ${first.count} activos`, {
      items: busy,
    });
  }
}

/** Resumen por tipo para la respuesta: created, updated, deactivated, unchanged (y reactivated cuenta como updated). */
export function syncCounts(actions: SyncAction[], deactivated: number) {
  const c = { created: 0, updated: 0, deactivated, unchanged: 0 };
  for (const a of actions) {
    if (a === "created") {
      c.created += 1;
    } else if (a === "unchanged") {
      c.unchanged += 1;
    } else {
      c.updated += 1;
    }
  }
  return c;
}
