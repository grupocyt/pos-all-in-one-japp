import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Database } from "@japp/db";
import { DATABASE } from "../Constants/Injection.js";
import type { PrintJob } from "../Clases/Printers.js";

/** Un papel de la cola (print_job) tal como lo usa el servicio. */
export interface QueuedJob {
  id: string;
  storeId: string;
  seq: number;
  kind: string;
  title: string;
  orderId: string | null;
  accountId: string | null;
  stationId: string | null;
  channel: string;
  printerName: string;
  connection: string;
  job: PrintJob;
  linePrinterIds: string[];
  status: string;
  attempts: number;
  lastError: string | null;
  nextTryAt: string;
  createdBy: string | null;
  createdDevice: string | null;
  createdAt: string;
  printedAt: string | null;
}

export interface NewJob {
  id: string;
  storeId: string;
  kind: string;
  title: string;
  orderId?: string | null;
  accountId?: string | null;
  stationId?: string | null;
  channel: string;
  printerName: string;
  connection: string;
  job: PrintJob;
  linePrinterIds?: string[];
  createdBy?: string | null;
  createdDevice?: string | null;
  at: Date;
}

const COLS = sql.raw(`id::text id, store_id::text "storeId", seq::int seq, kind, title, order_id::text "orderId",
  account_id::text "accountId", station_id::text "stationId", channel, printer_name "printerName", connection, job,
  line_printer_ids "linePrinterIds", status, attempts, last_error "lastError", next_try_at "nextTryAt",
  created_by "createdBy", created_device "createdDevice", created_at "createdAt", printed_at "printedAt"`);

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v));
function row(r: any): QueuedJob {
  return {
    ...r,
    seq: Number(r.seq),
    attempts: Number(r.attempts),
    linePrinterIds: Array.isArray(r.linePrinterIds) ? r.linePrinterIds : [],
    nextTryAt: iso(r.nextTryAt)!,
    createdAt: iso(r.createdAt)!,
    printedAt: iso(r.printedAt),
  };
}

/** Cola de impresión en la base (print_job). Las reglas (orden, reintentos) las decide PrintQueueService. */
@Injectable()
export class PrintQueueApplication {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async insert(jobs: NewJob[]) {
    for (const j of jobs) {
      await this.database.db.execute(sql`INSERT INTO print_job (id, store_id, kind, title, order_id, account_id, station_id,
        channel, printer_name, connection, job, line_printer_ids, created_by, created_device, created_at, next_try_at)
        VALUES (${j.id}, ${j.storeId}, ${j.kind}, ${j.title.slice(0, 120)}, ${j.orderId ?? null}, ${j.accountId ?? null},
          ${j.stationId ?? null}, ${j.channel.slice(0, 40)}, ${j.printerName.slice(0, 60)}, ${j.connection.slice(0, 120)},
          ${JSON.stringify(j.job)}::jsonb, ${JSON.stringify(j.linePrinterIds ?? [])}::jsonb, ${j.createdBy?.slice(0, 60) ?? null},
          ${j.createdDevice?.slice(0, 40) ?? null}, ${j.at.toISOString()}::timestamptz, ${j.at.toISOString()}::timestamptz)`);
    }
  }

  /**
   * Lo que queda por imprimir (de todas las tiendas de esta base), en orden de llegada. Un «printing» de hace más de un
   * minuto es de una API que se cortó a medias: vuelve a la cola.
   */
  async open(now: Date): Promise<QueuedJob[]> {
    const r = await this.database.db.execute(sql`SELECT ${COLS} FROM print_job
      WHERE status = 'pending' OR (status = 'printing' AND updated_at < ${new Date(now.getTime() - 60_000).toISOString()}::timestamptz)
      ORDER BY seq LIMIT 500`);
    return (r.rows as any[]).map(row);
  }

  /** Lo toma para imprimir (solo si sigue en cola: otro intento no lo repite). */
  async claim(id: string): Promise<boolean> {
    const r = await this.database.db.execute(sql`UPDATE print_job SET status = 'printing', attempts = attempts + 1
      WHERE id = ${id} AND status IN ('pending', 'printing') RETURNING id`);
    return r.rows.length > 0;
  }

  async printed(id: string, at: Date) {
    await this.database.db.execute(sql`UPDATE print_job SET status = 'printed', printed_at = ${at.toISOString()}::timestamptz,
      last_error = NULL WHERE id = ${id}`);
  }

  async retryLater(id: string, error: string, next: Date) {
    await this.database.db.execute(sql`UPDATE print_job SET status = 'pending', last_error = ${error.slice(0, 300)},
      next_try_at = ${next.toISOString()}::timestamptz WHERE id = ${id}`);
  }

  async failed(id: string, error: string) {
    await this.database.db.execute(sql`UPDATE print_job SET status = 'failed', last_error = ${error.slice(0, 300)} WHERE id = ${id}`);
  }

  /** Las filas order_line_printer de una comanda que ya salió. */
  async markLines(storeId: string, ids: string[], at: Date) {
    if (!ids.length) {
      return;
    }
    await this.database.db.execute(sql`UPDATE order_line_printer SET printed = TRUE, printed_at = ${at.toISOString()}::timestamptz
      WHERE store_id = ${storeId} AND id = ANY(${"{" + ids.join(",") + "}"}::uuid[])`);
  }

  async byId(storeId: string, id: string): Promise<QueuedJob | null> {
    const r = await this.database.db.execute(sql`SELECT ${COLS} FROM print_job WHERE store_id = ${storeId} AND id::text = ${id}`);
    const x = r.rows[0];
    return x ? row(x) : null;
  }

  /** Gestiones › Impresiones: lo pendiente y lo fallido primero, después lo último impreso. */
  async list(storeId: string, status: string[] | null, limit: number): Promise<QueuedJob[]> {
    const r = await this.database.db.execute(sql`SELECT ${COLS} FROM print_job WHERE store_id = ${storeId}
      ${status ? sql`AND status = ANY(${"{" + status.join(",") + "}"}::text[])` : sql``}
      ORDER BY (status IN ('failed', 'pending', 'printing')) DESC, seq DESC LIMIT ${limit}`);
    return (r.rows as any[]).map(row);
  }

  async counts(storeId: string): Promise<Record<string, number>> {
    const r = await this.database.db.execute(sql`SELECT status, count(*)::int n FROM print_job WHERE store_id = ${storeId}
      AND status IN ('pending', 'printing', 'failed') GROUP BY status`);
    return Object.fromEntries((r.rows as any[]).map((x) => [x.status, Number(x.n)]));
  }

  /** Reintentar ya (y, si se elige, por otra impresora). */
  async requeue(storeId: string, id: string, at: Date, printer?: { name: string; connection: string; job: PrintJob }) {
    await this.database.db.execute(sql`UPDATE print_job SET status = 'pending', next_try_at = ${at.toISOString()}::timestamptz,
      created_at = ${at.toISOString()}::timestamptz
      ${printer ? sql`, printer_name = ${printer.name.slice(0, 60)}, connection = ${printer.connection.slice(0, 120)}, job = ${JSON.stringify(printer.job)}::jsonb` : sql``}
      WHERE store_id = ${storeId} AND id = ${id}`);
  }

  async cancel(storeId: string, id: string, why: string) {
    await this.database.db.execute(sql`UPDATE print_job SET status = 'cancelled', last_error = ${why.slice(0, 300)}
      WHERE store_id = ${storeId} AND id = ${id}`);
  }

  /** Impresora activa de la tienda (para mandar un papel a otra). */
  async printer(storeId: string, id: string): Promise<{ name: string; connection: string } | null> {
    const r = await this.database.db.execute(sql`SELECT name, connection FROM printer WHERE store_id = ${storeId} AND id::text = ${id} AND active`);
    return (r.rows[0] as any) ?? null;
  }
}
