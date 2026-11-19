import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { fail, renderText } from "@japp/domain";
import { CLOCK, EVENTS, PRINTER, type Clock } from "../Constants/Injection.js";
import type { PrinterPort, PrintJob } from "../Clases/Printers.js";
import type { EventsHub } from "../Clases/EventsHub.js";
import type { Session } from "../Helpers/AuthGuard.js";
import { AuthorizationService } from "./AuthorizationService.js";
import { PrintQueueApplication, type QueuedJob } from "../Applications/PrintQueueApplication.js";

/** Reintentos: a los 2, 5, 15 y 30 s y después cada minuto; a los 5 minutos sin salir queda «fallido». */
const BACKOFF_MS = [2_000, 5_000, 15_000, 30_000, 60_000];
const GIVE_UP_MS = 5 * 60_000;
/** Lo que espera la petición (enviar, marchar…) a que salga su comanda antes de responder: después sigue en la cola. */
const WAIT_MS = 400;

export interface EnqueueInput {
  kind: string;
  job: PrintJob;
  orderId?: string | null;
  accountId?: string | null;
  linePrinterIds?: string[];
}

/** Cómo quedó un papel al responder: ok = ya salió; queued = sigue en la cola (reintentando). */
export interface JobOutcome {
  jobId: string;
  ok: boolean;
  queued: boolean;
  error: string | null;
}

const ReassignModel = z.object({ printerId: z.string().uuid(), authorization: z.string().nullish() }).strict();
const CancelModel = z.object({ reason: z.string().trim().max(200).nullish(), authorization: z.string().nullish() }).strict();

/**
 * Cola de impresión (16/11/2026, API 1.2.270): guardar y enviar ya no esperan a la impresora. Cada papel se guarda en
 * print_job y un proceso de la API lo imprime en segundo plano: todas las impresoras a la vez y cada una en orden de
 * llegada (si la primera de una impresora no sale, las siguientes de esa impresora esperan). Si una impresora no responde
 * se reintenta y se avisa a los equipos (evento print.failed); a los 5 minutos queda «fallido» en Gestiones › Impresiones.
 */
@Injectable()
export class PrintQueueService {
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly waiters = new Map<string, ((o: JobOutcome) => void)[]>();

  constructor(
    @Inject(PrintQueueApplication) private readonly queue: PrintQueueApplication,
    @Inject(PRINTER) private readonly printer: PrinterPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(EVENTS) private readonly events: EventsHub,
    @Inject(AuthorizationService) private readonly auth: AuthorizationService,
  ) {}

  /** Arranca el reintento periódico (la API; las pruebas lo llaman a mano con drain()). */
  start(everyMs = 1_000) {
    if (!this.timer) {
      this.timer = setInterval(() => this.kick(), everyMs);
      this.timer.unref?.();
    }
    this.kick();
  }
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Deja los papeles en la cola y responde enseguida: espera como mucho WAIT_MS a que salgan (en la tienda una impresora
   * que contesta tarda bastante menos); lo que no haya salido sigue en la cola y sale solo.
   */
  async enqueue(session: Session | null, storeId: string, items: EnqueueInput[], o: { wait?: number } = {}) {
    if (!items.length) {
      return [] as JobOutcome[];
    }
    const at = this.clock();
    const rows = items.map((it) => ({
      id: randomUUID(),
      storeId,
      kind: it.kind,
      title: it.job.title,
      orderId: it.orderId ?? null,
      accountId: it.accountId ?? null,
      stationId: session?.station.id ?? null,
      channel: it.job.channel,
      printerName: it.job.printer,
      connection: it.job.connection,
      job: it.job,
      linePrinterIds: it.linePrinterIds ?? [],
      createdBy: session?.user.name ?? null,
      createdDevice: session?.station.name ?? null,
      at,
    }));
    await this.queue.insert(rows);
    const outcomes = rows.map((r) => this.outcomeOf(r.id, o.wait ?? WAIT_MS));
    this.kick();
    return Promise.all(outcomes);
  }

  private outcomeOf(id: string, wait: number): Promise<JobOutcome> {
    return new Promise((resolve) => {
      const done = (x: JobOutcome) => {
        clearTimeout(t);
        resolve(x);
      };
      const t = setTimeout(() => {
        this.dropWaiter(id, done);
        resolve({ jobId: id, ok: false, queued: true, error: null });
      }, wait);
      const list = this.waiters.get(id) ?? [];
      list.push(done);
      this.waiters.set(id, list);
    });
  }
  private dropWaiter(id: string, fn: (o: JobOutcome) => void) {
    const list = (this.waiters.get(id) ?? []).filter((x) => x !== fn);
    if (list.length) {
      this.waiters.set(id, list);
    } else {
      this.waiters.delete(id);
    }
  }
  private settle(id: string, o: JobOutcome) {
    for (const fn of this.waiters.get(id) ?? []) {
      fn(o);
    }
    this.waiters.delete(id);
  }

  /** Una vuelta de la cola si no hay otra en marcha (si la hay, otra al terminar). */
  kick() {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = (async () => {
      do {
        this.again = false;
        try {
          await this.round();
        } catch {
          // un fallo de la base no tumba la cola: la siguiente vuelta lo reintenta
        }
      } while (this.again);
    })().finally(() => {
      this.running = null;
    });
  }

  /** Espera a que no quede ninguna vuelta en marcha (pruebas y cierre de la API). */
  async idle() {
    while (this.running) {
      await this.running;
    }
  }

  /** Una vuelta ya mismo (pruebas: el reloj es de mentira). */
  async drain() {
    this.kick();
    await this.idle();
  }

  private async round() {
    const now = this.clock();
    const open = await this.queue.open(now);
    const byPrinter = new Map<string, QueuedJob[]>();
    for (const j of open) {
      const k = `${j.storeId}|${j.connection || j.printerName}`;
      const list = byPrinter.get(k) ?? [];
      list.push(j);
      byPrinter.set(k, list);
    }
    await Promise.all(
      [...byPrinter.values()].map(async (list) => {
        for (const j of list) {
          // en orden: si el primero de esta impresora aún no toca o no sale, los de detrás esperan
          if (new Date(j.nextTryAt).getTime() > now.getTime()) {
            return;
          }
          if (!(await this.printOne(j))) {
            return;
          }
        }
      }),
    );
  }

  private async printOne(j: QueuedJob): Promise<boolean> {
    if (!(await this.queue.claim(j.id))) {
      return true;
    }
    const res = await this.printer
      .print(j.job)
      .catch((e) => ({ ok: false, error: String((e as Error)?.message ?? e) }));
    const at = this.clock();
    if (res.ok) {
      await this.queue.printed(j.id, at);
      await this.queue.markLines(j.storeId, j.linePrinterIds, at);
      this.settle(j.id, { jobId: j.id, ok: true, queued: false, error: null });
      if (j.attempts > 0) {
        this.events.publish(j.storeId, { event: "print.recovered", jobId: j.id, printer: j.printerName, channel: j.channel, title: j.title });
      }
      return true;
    }
    const error = res.error ?? `${j.printerName} no responde`;
    const age = at.getTime() - new Date(j.createdAt).getTime();
    const final = age >= GIVE_UP_MS;
    if (final) {
      await this.queue.failed(j.id, error);
    } else {
      const wait = BACKOFF_MS[Math.min(j.attempts, BACKOFF_MS.length - 1)]!;
      await this.queue.retryLater(j.id, error, new Date(at.getTime() + wait));
    }
    this.settle(j.id, { jobId: j.id, ok: false, queued: !final, error });
    // aviso a los equipos: el primer fallo (reintentando) y cuando se da por perdido
    if (j.attempts === 0 || final) {
      this.events.publish(j.storeId, {
        event: "print.failed",
        jobId: j.id,
        printer: j.printerName,
        channel: j.channel,
        title: j.title,
        stationId: j.stationId,
        final,
        error,
      });
    }
    return false;
  }

  // ───────────────────────── Gestiones › Impresiones ─────────────────────────
  private view(j: QueuedJob) {
    const { job: _j, linePrinterIds, storeId: _s, seq: _q, ...rest } = j;
    // 1.2.283 · el texto del papel (Gestiones › Impresiones lo enseña como en Facturas)
    let text: string | null = null;
    try {
      text = j.job?.ticket?.length ? renderText(j.job.ticket) : null;
    } catch {
      text = null;
    }
    return { ...rest, lines: linePrinterIds.length, text };
  }

  /** GET /print-jobs?status=pending,failed: la cola de la tienda (lo pendiente y fallido primero). */
  async list(se: Session, status?: string, limit?: string) {
    const st = status
      ? status
          .split(",")
          .map((x) => x.trim())
          .filter((x) => ["pending", "printing", "printed", "failed", "cancelled"].includes(x))
      : null;
    const n = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const jobs = await this.queue.list(se.storeId, st && st.length ? st : null, n);
    return { counts: await this.queue.counts(se.storeId), items: jobs.map((j) => this.view(j)) };
  }

  private async open(se: Session, id: string) {
    const j = await this.queue.byId(se.storeId, id);
    if (!j) {
      fail("NOT_FOUND", "Ese papel no está en la cola", { id });
    }
    return j!;
  }

  /** POST /print-jobs/{id}/retry: vuelve a intentarlo ya (fallido o reintentando). */
  async retry(se: Session, id: string) {
    const j = await this.open(se, id);
    if (j.status === "printed") {
      fail("INVALID_TRANSITION", "Ese papel ya salió: para otro, reimprime desde la mesa", { status: j.status });
    }
    await this.queue.requeue(se.storeId, j.id, this.clock());
    await this.drainSoon();
    return this.view((await this.queue.byId(se.storeId, j.id))!);
  }

  /** POST /print-jobs/{id}/reassign: por otra impresora (ajustes.impresoras o la clave de quien lo tenga). */
  async reassign(se: Session, id: string, body: unknown) {
    const b = ReassignModel.parse(body ?? {});
    await this.auth.require(se, "ajustes.impresoras", b.authorization ?? null);
    const j = await this.open(se, id);
    if (j.status === "printed") {
      fail("INVALID_TRANSITION", "Ese papel ya salió", { status: j.status });
    }
    const p = await this.queue.printer(se.storeId, b.printerId);
    if (!p) {
      fail("VALIDATION", "Elige una impresora activa", { field: "printerId" });
    }
    const job: PrintJob = { ...j.job, printer: p!.name, connection: p!.connection };
    await this.queue.requeue(se.storeId, j.id, this.clock(), { name: p!.name, connection: p!.connection, job });
    await this.drainSoon();
    return this.view((await this.queue.byId(se.storeId, j.id))!);
  }

  /** POST /print-jobs/{id}/cancel: ya no se imprime (ajustes.impresoras o la clave de quien lo tenga). */
  async cancel(se: Session, id: string, body: unknown) {
    const b = CancelModel.parse(body ?? {});
    await this.auth.require(se, "ajustes.impresoras", b.authorization ?? null);
    const j = await this.open(se, id);
    if (j.status === "printed" || j.status === "cancelled") {
      fail("INVALID_TRANSITION", "Ese papel ya no está pendiente", { status: j.status });
    }
    await this.queue.cancel(se.storeId, j.id, `Cancelado por ${se.user.name}${b.reason ? `: ${b.reason}` : ""}`);
    return this.view((await this.queue.byId(se.storeId, j.id))!);
  }

  /** Tras reintentar o reasignar: una vuelta y una espera corta, para responder con el estado nuevo. */
  private async drainSoon() {
    this.kick();
    await Promise.race([this.idle(), new Promise((r) => setTimeout(r, WAIT_MS))]);
  }
}
