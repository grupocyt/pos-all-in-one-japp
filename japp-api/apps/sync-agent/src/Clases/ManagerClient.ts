import { promisify } from "node:util";
import { gzip as gzipCb } from "node:zlib";

const gzip = promisify(gzipCb);

/** Sobre estándar de las respuestas del Manager. */
export interface Envelope<T = unknown> {
  title: string;
  type: "success" | "error";
  status: number;
  data: T | null;
  errors: Array<{ code: string; message: string; field?: string | null; details?: unknown }>;
  traceId: string;
  author: string;
  mode: string;
}

/** Lo que pasó con una petición: o contestó el Manager (con su código) o no se llegó a saber (red, timeout). */
export type ManagerReply<T = unknown> =
  | { kind: "http"; status: number; envelope: Envelope<T> | null }
  | { kind: "network"; error: string };

/** Cuerpo ya serializado (y comprimido): un reintento manda exactamente los mismos bytes con la misma clave. */
export interface PreparedBody {
  bytes: Buffer;
  gzip: boolean;
}

export interface TransactionResultDto {
  orderId: string;
  version: number | null;
  status: "accepted" | "duplicate" | "stale" | "conflict" | "rejected";
  error?: string;
}

export interface ReconcileReply {
  missing: string[];
  outdated: Array<{ orderId: string; managerVersion: number }>;
}

export interface ManagerClientOptions {
  baseUrl: string;
  storeId: string;
  storeKey: string;
  gzip: boolean;
  timeoutMs: number;
}

/** Cliente HTTP del contrato del Manager (fetch nativo). No reintenta: eso lo decide SyncService. */
export class ManagerClient {
  constructor(private readonly opts: ManagerClientOptions) {}

  async prepare(body: unknown): Promise<PreparedBody> {
    const json = Buffer.from(JSON.stringify(body), "utf8");
    if (!this.opts.gzip) {
      return { bytes: json, gzip: false };
    }
    return { bytes: await gzip(json), gzip: true };
  }

  postTransactions(body: PreparedBody, idempotencyKey: string, signal?: AbortSignal) {
    return this.post<{ results: TransactionResultDto[] }>("transactions", body, signal, idempotencyKey);
  }

  async reconcile(body: unknown, signal?: AbortSignal) {
    return this.post<ReconcileReply>("transactions/reconcile", await this.prepare(body), signal);
  }

  async heartbeat(body: unknown, signal?: AbortSignal) {
    return this.post<{ serverTime: string }>("heartbeat", await this.prepare(body), signal);
  }

  private async post<T>(
    path: string,
    body: PreparedBody,
    signal: AbortSignal | undefined,
    idempotencyKey?: string,
  ): Promise<ManagerReply<T>> {
    const url = `${this.opts.baseUrl}/stores/${encodeURIComponent(this.opts.storeId)}/${path}`;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${this.opts.storeKey}`,
    };
    if (body.gzip) {
      headers["content-encoding"] = "gzip";
    }
    if (idempotencyKey) {
      headers["idempotency-key"] = idempotencyKey;
    }
    const timeout = AbortSignal.timeout(this.opts.timeoutMs);
    const all = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const res = await fetch(url, { method: "POST", headers, body: body.bytes, signal: all });
      const text = await res.text();
      return { kind: "http", status: res.status, envelope: parseEnvelope<T>(text) };
    } catch (e) {
      return { kind: "network", error: networkError(e, timeout.aborted) };
    }
  }
}

function parseEnvelope<T>(text: string): Envelope<T> | null {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as Envelope<T>;
  } catch {
    return null;
  }
}

/** Mensaje corto del fallo de red, sin URL ni cabeceras (no se filtra la storeKey). */
function networkError(e: unknown, timedOut: boolean): string {
  if (timedOut) {
    return "Sin respuesta del Manager (timeout)";
  }
  const err = e as { message?: string; cause?: { code?: string; message?: string } };
  const cause = err?.cause?.code ?? err?.cause?.message;
  if (cause) {
    return `Sin conexión con el Manager (${cause})`;
  }
  return `Sin conexión con el Manager (${err?.message ?? String(e)})`;
}
