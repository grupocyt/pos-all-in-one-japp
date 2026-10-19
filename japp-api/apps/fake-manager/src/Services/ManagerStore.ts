import { fingerprint } from "../Helpers/Canonical.js";

export type ResultStatus = "accepted" | "duplicate" | "stale" | "conflict" | "rejected";

export interface TransactionResult {
  orderId: string;
  version: number | null;
  status: ResultStatus;
  error?: string;
}

/** Lo que el Manager tiene de una transacción: la versión más alta recibida y su contenido. */
export interface StoredTransaction {
  storeId: string;
  orderId: string;
  version: number;
  hash: string;
  transaction: Record<string, unknown>;
  receivedAt: string;
}

/** Una entrada del historial: qué se contestó a cada transacción recibida (para comprobar en las pruebas). */
export interface HistoryEntry {
  storeId: string;
  orderId: string;
  version: number | null;
  status: ResultStatus;
  at: string;
}

interface StoredInvoice {
  orderId: string;
  hash: string;
}

interface StoredResponse {
  bodyHash: string;
  status: number;
  envelope: unknown;
}

export interface ReconcileItem {
  orderId: string;
  version: number;
}

export type Route = "transactions" | "reconcile" | "heartbeat";

/**
 * Controles para provocar fallos en las pruebas. Todo se puede cambiar en caliente
 * (desde el código de la prueba o con POST /__fake/controls).
 */
export interface Controls {
  /** Responder siempre este código en esa ruta (503 = Manager caído, 401 = storeKey revocada…). null = normal. */
  fail: Partial<Record<Route, number | null>>;
  /** Cuántos lotes de transacciones guardar y luego cortar la conexión sin contestar (y sin apuntar la respuesta de la Idempotency-Key). */
  loseResponses: number;
  /** Órdenes que se contestan siempre «rejected» (JSON inválido). */
  reject: Set<string>;
  /** Órdenes que hacen que el lote entero responda 422 (el lote no se puede leer). */
  poison: Set<string>;
  /** Más transacciones que esto en un lote → 413. null = sin límite. */
  maxBatch: number | null;
}

export function defaultControls(): Controls {
  return { fail: {}, loseResponses: 0, reject: new Set(), poison: new Set(), maxBatch: null };
}

const STATUSES = new Set(["open", "billing", "closed", "cancelled"]);

/**
 * Estado en memoria del Manager de pruebas y sus reglas:
 * - guarda por (storeId, orderId) solo si la versión es mayor (igual = duplicate, menor = stale);
 * - misma versión con otro contenido = conflict;
 * - las facturas de dentro son únicas por (storeId, serie, número): otra con distinto contenido = conflict;
 * - Idempotency-Key: misma clave y mismo cuerpo → misma respuesta; otro cuerpo → IDEMPOTENCY_MISMATCH.
 */
export class ManagerStore {
  readonly transactions = new Map<string, StoredTransaction>();
  readonly invoices = new Map<string, StoredInvoice>();
  readonly idempotency = new Map<string, StoredResponse>();
  readonly history: HistoryEntry[] = [];
  readonly heartbeats: Array<{ storeId: string; at: string; body: Record<string, unknown> }> = [];
  readonly reconciles: Array<{
    storeId: string;
    at: string;
    body: Record<string, unknown>;
    result: unknown;
  }> = [];
  /** Cada petición recibida con su código de respuesta (para contar intentos). */
  readonly requests: Array<{
    route: Route;
    storeId: string;
    status: number;
    key: string | null;
    at: string;
  }> = [];
  controls: Controls = defaultControls();

  reset() {
    this.transactions.clear();
    this.invoices.clear();
    this.idempotency.clear();
    this.history.length = 0;
    this.heartbeats.length = 0;
    this.reconciles.length = 0;
    this.requests.length = 0;
    this.controls = defaultControls();
  }

  /** Simula que el Manager perdió una transacción (p. ej. restauró una copia): la conciliación debe recuperarla. */
  forget(storeId: string, orderId: string): boolean {
    return this.transactions.delete(this.txKey(storeId, orderId));
  }

  get(storeId: string, orderId: string): StoredTransaction | undefined {
    return this.transactions.get(this.txKey(storeId, orderId));
  }

  list(storeId: string): StoredTransaction[] {
    return [...this.transactions.values()].filter((t) => t.storeId === storeId);
  }

  /** Respuesta guardada para esta Idempotency-Key, o «mismatch» si llega otro cuerpo con la misma clave. */
  replay(storeId: string, key: string, bodyHash: string): StoredResponse | "mismatch" | null {
    const saved = this.idempotency.get(`${storeId}|${key}`);
    if (!saved) {
      return null;
    }
    if (saved.bodyHash !== bodyHash) {
      return "mismatch";
    }
    return saved;
  }

  remember(storeId: string, key: string, bodyHash: string, status: number, envelope: unknown) {
    this.idempotency.set(`${storeId}|${key}`, { bodyHash, status, envelope });
  }

  /** Procesa las transacciones de un lote en orden y devuelve un resultado por cada una. */
  receive(storeId: string, transactions: unknown[]): TransactionResult[] {
    return transactions.map((t) => {
      const r = this.receiveOne(storeId, t);
      this.history.push({
        storeId,
        orderId: r.orderId,
        version: r.version,
        status: r.status,
        at: new Date().toISOString(),
      });
      return r;
    });
  }

  /** Conciliación: qué le falta al Manager (missing) y qué tiene más viejo que la tienda (outdated). */
  reconcile(storeId: string, items: ReconcileItem[]) {
    const missing: string[] = [];
    const outdated: Array<{ orderId: string; managerVersion: number }> = [];
    for (const it of items) {
      const have = this.get(storeId, it.orderId);
      if (!have) {
        missing.push(it.orderId);
        continue;
      }
      if (have.version < it.version) {
        outdated.push({ orderId: it.orderId, managerVersion: have.version });
      }
    }
    return { missing, outdated };
  }

  private receiveOne(storeId: string, raw: unknown): TransactionResult {
    const t = raw as Record<string, unknown> | null;
    const orderId = t && typeof t._id === "string" ? t._id : "";
    const version = t && Number.isInteger(t.version) ? (t.version as number) : null;
    const invalid = this.invalidReason(t, orderId, version);
    if (invalid) {
      return { orderId, version, status: "rejected", error: invalid };
    }
    const tx = t as Record<string, unknown>;
    const v = version as number;
    const hash = fingerprint(tx);
    const have = this.get(storeId, orderId);
    if (have && v < have.version) {
      return { orderId, version: v, status: "stale" };
    }
    if (have && v === have.version) {
      if (have.hash === hash) {
        return { orderId, version: v, status: "duplicate" };
      }
      return { orderId, version: v, status: "conflict", error: "Misma versión con otro contenido" };
    }
    const invoices = this.invoicesOf(tx);
    for (const inv of invoices) {
      const prev = this.invoices.get(`${storeId}|${inv.key}`);
      if (prev && (prev.orderId !== orderId || prev.hash !== inv.hash)) {
        return {
          orderId,
          version: v,
          status: "conflict",
          error: `La factura ${inv.key} ya existe con otro contenido`,
        };
      }
    }
    for (const inv of invoices) {
      this.invoices.set(`${storeId}|${inv.key}`, { orderId, hash: inv.hash });
    }
    this.transactions.set(this.txKey(storeId, orderId), {
      storeId,
      orderId,
      version: v,
      hash,
      transaction: tx,
      receivedAt: new Date().toISOString(),
    });
    return { orderId, version: v, status: "accepted" };
  }

  /** Lo mínimo para poder guardar una transacción; si falta, «rejected». */
  private invalidReason(t: Record<string, unknown> | null, orderId: string, version: number | null) {
    if (!t || typeof t !== "object" || Array.isArray(t)) {
      return "La transacción no es un objeto";
    }
    if (!orderId) {
      return "Falta _id";
    }
    if (this.controls.reject.has(orderId)) {
      return "Rechazada por el control de pruebas";
    }
    if (version === null || version < 1) {
      return "version debe ser un entero ≥ 1";
    }
    if (typeof t.status !== "string" || !STATUSES.has(t.status)) {
      return "status no válido";
    }
    if (!Array.isArray(t.accounts)) {
      return "accounts debe ser una lista";
    }
    return null;
  }

  /** Facturas de dentro de la transacción: clave serie|número (o invoiceNumber) y huella de su contenido. */
  private invoicesOf(t: Record<string, unknown>) {
    const out: Array<{ key: string; hash: string }> = [];
    for (const acc of t.accounts as Array<Record<string, unknown> | null>) {
      const inv = acc?.invoice as Record<string, unknown> | null | undefined;
      if (!inv || typeof inv !== "object") {
        continue;
      }
      const key = invoiceKey(inv);
      if (key) {
        out.push({ key, hash: fingerprint(inv) });
      }
    }
    return out;
  }

  private txKey(storeId: string, orderId: string) {
    return `${storeId}|${orderId}`;
  }
}

/** Serie + número si vienen; si no, el número completo (invoiceNumber). Sin ninguno no se puede comprobar. */
function invoiceKey(inv: Record<string, unknown>): string | null {
  if (typeof inv.series === "string" && inv.sequence != null) {
    return `${inv.series}|${String(inv.sequence)}`;
  }
  if (typeof inv.invoiceNumber === "string" && inv.invoiceNumber) {
    return `num|${inv.invoiceNumber}`;
  }
  return null;
}
