import type {
  LeaderSession,
  OutboxApplication,
  Outcome,
  PendingTransaction,
  PeriodRow,
} from "../Applications/OutboxApplication.js";
import type { ManagerClient, ManagerReply, TransactionResultDto } from "../Clases/ManagerClient.js";
import { shortError, type Logger } from "../Helpers/Logger.js";
import { backoffMs, madridDate, sleep } from "../Helpers/Time.js";
import type { AppSettings } from "../Properties/AppSettings.js";

/** Estado del agente visible desde fuera (pruebas, logs) y que viaja en el latido. */
export interface AgentStatus {
  /** Este proceso tiene el advisory lock: es el único que envía. */
  leader: boolean;
  /** El Manager rechazó la storeKey (401/403): no se envía hasta que un latido vuelva a dar 200. */
  authFailed: boolean;
  lastError: string | null;
  lastSentAt: string | null;
  lastHeartbeatAt: string | null;
  /** Lotes con respuesta 200 del Manager. */
  batchesSent: number;
}

export const AUTH_ERROR =
  "STORE_KEY_REJECTED: el Manager rechaza la storeKey; envío parado hasta que el Manager la acepte";

/** Fallo temporal: se reintenta el mismo lote con la misma clave tras una espera creciente. */
function isTransient(reply: ManagerReply): boolean {
  if (reply.kind === "network") {
    return true;
  }
  return reply.status === 408 || reply.status === 429 || reply.status >= 500;
}

/**
 * 4xx que no se arregla repitiendo el mismo lote. Fuera: 401/403 (para el envío), 408/429 (temporales), 409 (clave
 * de idempotencia o en curso), 413/422 (se parte el lote).
 */
const RETRY_OR_HANDLED = new Set([401, 403, 408, 409, 413, 422, 429]);
function isPermanent(reply: ManagerReply): boolean {
  if (reply.kind !== "http") {
    return false;
  }
  return reply.status >= 400 && reply.status < 500 && !RETRY_OR_HANDLED.has(reply.status);
}

/**
 * El ciclo del agente y sus reglas (diseño «Sincronización Manager», puntos 3, 4, 6 y 7):
 * - un solo agente a la vez (advisory lock en una conexión dedicada);
 * - LISTEN sync_outbox + red de seguridad cada intervalo;
 * - agrupa por transacción y manda la foto actual; marca, aparca o suma intento según el resultado;
 * - errores HTTP: 401/403 para; 409 IDEMPOTENCY_MISMATCH clave nueva; 413/422 parte el lote; otro 4xx cuenta un intento
 *   (y aparca al máximo); el resto espera y reintenta;
 * - conciliación periódica y al cerrar periodo; latido.
 */
export class SyncService {
  private session: LeaderSession | null = null;
  private leading: Promise<boolean> | null = null;
  private stopping = false;
  private readonly abort = new AbortController();
  private readonly timers: NodeJS.Timeout[] = [];
  private debounce: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private beating: Promise<void> | null = null;
  /** Toca conciliar el periodo actual (al arrancar y cada SYNC_RECONCILE_MINUTES). */
  private reconcileDue = true;
  /** Periodos recién cerrados que faltan por conciliar (se quedan aquí hasta que el Manager conteste). */
  private closedPending: PeriodRow[] = [];
  private lastClosedSeen: string | null | undefined = undefined;
  readonly status: AgentStatus = {
    leader: false,
    authFailed: false,
    lastError: null,
    lastSentAt: null,
    lastHeartbeatAt: null,
    batchesSent: 0,
  };

  constructor(
    private readonly settings: AppSettings,
    private readonly storeId: string,
    private readonly outbox: OutboxApplication,
    private readonly manager: ManagerClient,
    private readonly log: Logger,
  ) {}

  async start(): Promise<void> {
    this.log.info(
      {
        storeId: this.storeId,
        manager: this.settings.managerUrl,
        intervalMs: this.settings.intervalMs,
        instant: this.settings.instant,
        batch: this.settings.batch,
      },
      "Arranca el agente de sincronización",
    );
    this.timers.push(setInterval(() => this.tick(), this.settings.intervalMs));
    this.timers.push(
      setInterval(() => {
        this.reconcileDue = true;
        this.kick();
      }, this.settings.reconcileMs),
    );
    this.timers.push(setInterval(() => void this.heartbeat(), this.settings.heartbeatMs));
    await this.tryLead();
  }

  /** Parada limpia: corta las esperas y la petición en curso, espera al ciclo y suelta el bloqueo. */
  async stop(): Promise<void> {
    this.stopping = true;
    this.abort.abort();
    for (const t of this.timers) {
      clearInterval(t);
    }
    if (this.debounce) {
      clearTimeout(this.debounce);
      this.debounce = null;
    }
    await this.leading;
    await this.running;
    await this.beating;
    await this.dropSession(false);
    this.log.info("Agente parado");
  }

  /** Concilia ya (lo usa «Enviar ahora» o las pruebas). */
  reconcileNow(): void {
    this.reconcileDue = true;
    this.kick();
  }

  /** Termina cuando acaba el ciclo en curso (si lo hay). */
  async whenIdle(): Promise<void> {
    await this.leading;
    while (this.running) {
      await this.running;
    }
  }

  /** Despierta el ciclo ya, sin esperar al intervalo. */
  syncNow(): void {
    this.kick();
  }

  // ───────────────────────── Un solo agente ─────────────────────────

  private tick(): void {
    if (this.stopping) {
      return;
    }
    if (!this.status.leader) {
      void this.tryLead();
      return;
    }
    this.kick();
  }

  private tryLead(): Promise<boolean> {
    if (this.leading) {
      return this.leading;
    }
    this.leading = this.lead().finally(() => {
      this.leading = null;
    });
    return this.leading;
  }

  private async lead(): Promise<boolean> {
    if (this.stopping || this.session) {
      return Boolean(this.session);
    }
    let s: LeaderSession;
    try {
      s = await this.outbox.openSession(this.storeId);
    } catch (e) {
      this.log.warn({ err: String(e) }, "Sin conexión con la base; se reintenta en el siguiente ciclo");
      return false;
    }
    try {
      if (!(await s.tryLock())) {
        await s.close();
        this.log.debug("Otro agente tiene el bloqueo; este espera");
        return false;
      }
      this.session = s;
      this.status.leader = true;
      s.onLost((err) => {
        if (this.session !== s) {
          return;
        }
        this.log.warn({ err: err.message }, "Se perdió la conexión del bloqueo; se vuelve a pedir");
        void this.dropSession(true);
      });
      if (this.settings.instant) {
        await s.listen(() => this.onNotify());
      }
    } catch (e) {
      this.log.warn({ err: String(e) }, "No se pudo tomar el bloqueo del agente");
      await this.dropSession(true);
      await s.close(true);
      return false;
    }
    this.log.info("Este proceso es el agente que envía (advisory lock)");
    this.kick();
    void this.heartbeat();
    return true;
  }

  private async dropSession(broken: boolean) {
    const s = this.session;
    this.session = null;
    this.status.leader = false;
    if (s) {
      await s.close(broken);
    }
  }

  /** NOTIFY: se espera SYNC_DEBOUNCE_MS para juntar varios cambios seguidos de la misma mesa en una sola foto. */
  private onNotify(): void {
    if (this.stopping || !this.status.leader || this.debounce) {
      return;
    }
    this.debounce = setTimeout(() => {
      this.debounce = null;
      this.kick();
    }, this.settings.debounceMs);
  }

  /** Un ciclo a la vez: si llega otro aviso mientras se envía, se repite al terminar. */
  private kick(): void {
    if (this.stopping || !this.status.leader) {
      return;
    }
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = this.loop().finally(() => {
      this.running = null;
    });
  }

  private async loop(): Promise<void> {
    do {
      this.again = false;
      await this.cycle();
    } while (this.again && !this.stopping && this.status.leader);
  }

  private async cycle(): Promise<void> {
    try {
      await this.checkClosedPeriods();
      if (this.reconcileDue || this.closedPending.length) {
        await this.reconcile();
      }
      await this.drain();
    } catch (e) {
      if (this.stopping) {
        return;
      }
      this.log.error({ err: String(e) }, "Fallo en el ciclo del agente");
      this.recordError(`Fallo del agente: ${String(e)}`);
    }
  }

  // ───────────────────────── Envío ─────────────────────────

  /** Vacía la cola por lotes; si el lote venía lleno (había atraso) repite enseguida. */
  private async drain(): Promise<void> {
    while (this.canSend()) {
      const items = await this.outbox.pending(this.storeId, this.settings.batch);
      if (!items.length) {
        return;
      }
      const progress = await this.send(items);
      // Sin avance (p. ej. el Manager no contestó por alguna) no se repite en bucle: espera al siguiente ciclo.
      if (items.length < this.settings.batch || progress === 0) {
        return;
      }
    }
  }

  private canSend(): boolean {
    return !this.stopping && this.status.leader && !this.status.authFailed;
  }

  /** Manda un lote; devuelve cuántas transacciones han salido de la cola (enviadas o aparcadas). */
  private async send(items: PendingTransaction[]): Promise<number> {
    const noPhoto = items.filter((i) => !i.transaction);
    if (noPhoto.length) {
      await this.outbox.apply(
        this.storeId,
        noPhoto.map((i) => park(i, "Sin foto de la transacción (orders.snapshot vacío)")),
        this.settings.maxAttempts,
      );
    }
    const list = items.filter((i) => i.transaction);
    if (!list.length) {
      return noPhoto.length;
    }
    const body = {
      agent: { version: this.settings.agentVersion, sentAt: new Date().toISOString() },
      transactions: list.map(withVersion),
    };
    // Los reintentos mandan los mismos bytes con la misma clave: el Manager devuelve la respuesta guardada.
    const prepared = await this.manager.prepare(body);
    const baseKey = batchKey(this.storeId, list);
    let key = baseKey;
    let attempt = 0;
    while (this.canSend()) {
      const reply = await this.manager.postTransactions(prepared, key, this.abort.signal);
      if (this.stopping) {
        return 0;
      }
      if (reply.kind === "http" && reply.status === 200) {
        return noPhoto.length + (await this.applyResults(list, reply.envelope?.data?.results));
      }
      if (reply.kind === "http" && (reply.status === 401 || reply.status === 403)) {
        this.authFailed(reply.status);
        return noPhoto.length;
      }
      if (reply.kind === "http" && reply.status === 409 && errorCode(reply) === "IDEMPOTENCY_MISMATCH") {
        // Esa clave ya se usó con otro cuerpo (p. ej. tras reiniciar): clave nueva; la versión sigue evitando duplicados.
        key = `${baseKey}-${Date.now().toString(36)}`;
        this.log.warn({ key }, "Idempotency-Key ya usada con otro cuerpo; se rehace con clave nueva");
        continue;
      }
      if (reply.kind === "http" && (reply.status === 413 || reply.status === 422)) {
        return noPhoto.length + (await this.split(list, reply.status));
      }
      const why = describe(reply);
      this.recordError(why);
      if (isPermanent(reply)) {
        // un 4xx que no se arregla esperando (p. ej. 400 o 404): reintentar el mismo lote sin fin frenaría la cola para
        // siempre. Cuenta como un intento de cada aviso del lote y se aparca al llegar a SYNC_MAX_ATTEMPTS, como los rechazados.
        return noPhoto.length + (await this.countFailure(list, why));
      }
      const wait = backoffMs(attempt, this.settings.retryBaseMs, this.settings.retryMaxMs);
      attempt++;
      this.log.warn(
        { err: why, attempt, waitMs: wait, key },
        "Fallo temporal al enviar; se reintenta el mismo lote",
      );
      if (!isTransient(reply)) {
        this.log.error(
          { status: reply.kind === "http" ? reply.status : null },
          "Respuesta inesperada del Manager",
        );
      }
      await sleep(wait, this.abort.signal);
    }
    return noPhoto.length;
  }

  /** Un intento más de cada transacción del lote (y aparcada al llegar al máximo); devuelve cuántas se aparcaron. */
  private async countFailure(list: PendingTransaction[], why: string): Promise<number> {
    const outcomes: Outcome[] = list.map((item) => ({
      orderId: item.orderId,
      lastId: item.lastId,
      kind: "reject",
      error: shortError(`${why} (respuesta no reintentable)`),
    }));
    const { parked } = await this.outbox.apply(this.storeId, outcomes, this.settings.maxAttempts);
    this.log.error(
      { err: why, size: list.length, parked: parked.length },
      "Respuesta no reintentable del Manager",
    );
    if (parked.length) {
      this.recordError(`Aparcadas: ${parked.join(", ")}`);
    }
    return parked.length;
  }

  /** 413 (demasiado grande) o 422 (no se puede leer): se parte a la mitad hasta aislar la transacción mala y se aparca. */
  private async split(list: PendingTransaction[], status: number): Promise<number> {
    if (list.length === 1) {
      const item = list[0]!;
      const why = `HTTP ${status}: el Manager no acepta esta transacción; aparcada`;
      this.log.error({ orderId: item.orderId, status }, why);
      await this.outbox.apply(this.storeId, [park(item, why)], this.settings.maxAttempts);
      this.recordError(`${why} (${item.orderId})`);
      return 1;
    }
    const half = Math.ceil(list.length / 2);
    this.log.warn({ status, size: list.length }, "Lote rechazado entero; se parte a la mitad");
    const a = await this.send(list.slice(0, half));
    const b = await this.send(list.slice(half));
    return a + b;
  }

  /** accepted/duplicate/stale → enviados; conflict → aparcada; rejected → intento + 1 (y aparcada al llegar al máximo). */
  private async applyResults(list: PendingTransaction[], results: TransactionResultDto[] | undefined) {
    this.status.batchesSent++;
    if (!Array.isArray(results)) {
      this.recordError("El Manager respondió 200 sin results");
      return 0;
    }
    const byId = new Map(results.map((r) => [r.orderId, r]));
    const outcomes: Outcome[] = [];
    for (const item of list) {
      const outcome = outcomeOf(item, byId.get(item.orderId));
      if (outcome) {
        outcomes.push(outcome);
      }
    }
    const { parked } = await this.outbox.apply(this.storeId, outcomes, this.settings.maxAttempts);
    const sent = outcomes.filter((o) => o.kind === "sent").length;
    if (sent > 0) {
      this.status.lastSentAt = new Date().toISOString();
    }
    this.status.lastError = null;
    for (const o of outcomes) {
      if (o.kind !== "sent") {
        this.log.warn(
          { orderId: o.orderId, kind: o.kind, err: o.error },
          "Transacción no aceptada por el Manager",
        );
      }
    }
    if (parked.length) {
      this.recordError(`Aparcadas: ${parked.join(", ")}`);
    }
    this.log.info({ size: list.length, sent, parked: parked.length }, "Lote enviado");
    return sent + parked.length;
  }

  private authFailed(status: number) {
    if (!this.status.authFailed) {
      this.log.error({ status }, AUTH_ERROR);
    }
    this.status.authFailed = true;
    this.recordError(`${AUTH_ERROR} (HTTP ${status})`);
  }

  /**
   * El latido usa la misma storeKey: si vuelve a dar 200 tras un 401/403, la clave vale otra vez
   * (corregida o reactivada en el Manager) y se reanuda el envío sin reiniciar el agente.
   */
  private resumeAfterAuth() {
    if (!this.status.authFailed || this.stopping) {
      return;
    }
    this.status.authFailed = false;
    this.log.info("El Manager vuelve a aceptar la storeKey (latido 200); se reanuda el envío");
    this.kick();
  }

  private recordError(message: string) {
    const text = shortError(message);
    this.status.lastError = text;
    this.outbox.saveError(this.storeId, text).catch((e) => {
      this.log.warn({ err: String(e) }, "No se pudo guardar el error en sync_state");
    });
  }

  // ───────────────────────── Conciliación ─────────────────────────

  /** Un periodo recién cerrado (otro distinto del último visto) se concilia enseguida. */
  private async checkClosedPeriods(): Promise<void> {
    const latest = await this.outbox.latestClosedPeriod(this.storeId);
    const id = latest?.id ?? null;
    if (this.lastClosedSeen === id) {
      return;
    }
    // Al arrancar también se repasa el último cerrado: pudo cerrarse con el agente parado.
    this.lastClosedSeen = id;
    if (latest && !this.closedPending.some((p) => p.id === latest.id)) {
      this.closedPending.push(latest);
    }
  }

  /** Manda orderId + versión de las órdenes del periodo; lo que falta o está viejo en el Manager se vuelve a encolar. */
  private async reconcile(): Promise<void> {
    if (!this.canSend()) {
      return;
    }
    const targets: Array<{ period: PeriodRow; due: boolean }> = this.closedPending.map((p) => ({
      period: p,
      due: false,
    }));
    if (this.reconcileDue) {
      const current = await this.outbox.currentPeriod(this.storeId);
      if (!current) {
        this.reconcileDue = false;
      } else if (!targets.some((t) => t.period.id === current.id)) {
        targets.push({ period: current, due: true });
      } else {
        this.reconcileDue = false;
      }
    }
    for (const t of targets) {
      const done = await this.reconcilePeriod(t.period);
      if (!done) {
        return;
      }
      this.closedPending = this.closedPending.filter((p) => p.id !== t.period.id);
      if (t.due) {
        this.reconcileDue = false;
      }
    }
  }

  private async reconcilePeriod(period: PeriodRow): Promise<boolean> {
    const items = await this.outbox.periodItems(this.storeId, period.id);
    const body = { businessDate: madridDate(period.openedAt), periodId: period.id, items };
    const reply = await this.manager.reconcile(body, this.abort.signal);
    if (this.stopping) {
      return false;
    }
    if (reply.kind === "http" && reply.status === 200 && reply.envelope?.data) {
      const { missing = [], outdated = [] } = reply.envelope.data;
      const ids = [...new Set([...missing, ...outdated.map((o) => o.orderId)])];
      const queued = await this.outbox.requeue(this.storeId, ids);
      this.log.info(
        {
          periodId: period.id,
          items: items.length,
          missing: missing.length,
          outdated: outdated.length,
          queued,
        },
        "Conciliación hecha",
      );
      return true;
    }
    if (reply.kind === "http" && (reply.status === 401 || reply.status === 403)) {
      this.authFailed(reply.status);
      return false;
    }
    const why = `Conciliación: ${describe(reply)}`;
    this.recordError(why);
    this.log.warn(
      { periodId: period.id, err: why },
      "Conciliación pendiente; se reintenta en el siguiente ciclo",
    );
    return false;
  }

  // ───────────────────────── Latido ─────────────────────────

  private heartbeat(): Promise<void> {
    if (this.stopping || !this.status.leader || this.beating) {
      return this.beating ?? Promise.resolve();
    }
    this.beating = this.beat().finally(() => {
      this.beating = null;
    });
    return this.beating;
  }

  private async beat(): Promise<void> {
    try {
      const stats = await this.outbox.stats(this.storeId);
      const body = {
        agentVersion: this.settings.agentVersion,
        outboxPending: stats.outboxPending,
        oldestPendingAt: stats.oldestPendingAt,
        openTransactions: stats.openTransactions,
        lastSentAt: stats.lastSentAt ?? this.status.lastSentAt,
        lastError: this.status.lastError,
      };
      const t0 = Date.now();
      const reply = await this.manager.heartbeat(body, this.abort.signal);
      const t1 = Date.now();
      if (this.stopping) {
        return;
      }
      if (reply.kind === "http" && reply.status === 200) {
        const serverTime = reply.envelope?.data?.serverTime;
        // Diferencia de reloj: hora del Manager menos la hora local a mitad de la petición.
        const offset = serverTime ? Math.round(Date.parse(serverTime) - (t0 + t1) / 2) : null;
        await this.outbox.saveHeartbeat(this.storeId, Number.isFinite(offset) ? offset : null);
        this.status.lastHeartbeatAt = new Date().toISOString();
        this.resumeAfterAuth();
        return;
      }
      if (reply.kind === "http" && (reply.status === 401 || reply.status === 403)) {
        this.authFailed(reply.status);
        return;
      }
      this.log.warn({ err: describe(reply) }, "Latido sin respuesta del Manager");
    } catch (e) {
      if (!this.stopping) {
        this.log.warn({ err: String(e) }, "Fallo al preparar el latido");
      }
    }
  }
}

/** La transacción tal cual está en la base; si no trae versión, la de orders.version. */
function withVersion(item: PendingTransaction): Record<string, unknown> {
  const t = item.transaction as Record<string, unknown>;
  if (Number.isInteger(t.version) || item.version === null) {
    return t;
  }
  return { ...t, version: item.version };
}

/** Idempotency-Key del lote: tx-{storeId}-{primer aviso}-{último aviso}. */
function batchKey(storeId: string, list: PendingTransaction[]): string {
  const first = Math.min(...list.map((i) => i.firstId));
  const last = Math.max(...list.map((i) => i.lastId));
  return `tx-${storeId}-${first}-${last}`;
}

function park(item: PendingTransaction, error: string): Outcome {
  return { orderId: item.orderId, lastId: item.lastId, kind: "park", error: shortError(error) };
}

function outcomeOf(item: PendingTransaction, r: TransactionResultDto | undefined): Outcome | null {
  if (!r) {
    return null;
  }
  if (r.status === "accepted" || r.status === "duplicate" || r.status === "stale") {
    return { orderId: item.orderId, lastId: item.lastId, kind: "sent" };
  }
  if (r.status === "conflict") {
    return park(item, `CONFLICT v${r.version ?? "?"}: ${r.error ?? "misma versión con otro contenido"}`);
  }
  return {
    orderId: item.orderId,
    lastId: item.lastId,
    kind: "reject",
    error: shortError(`REJECTED v${r.version ?? "?"}: ${r.error ?? "rechazada por el Manager"}`),
  };
}

function errorCode(reply: ManagerReply): string | null {
  if (reply.kind !== "http") {
    return null;
  }
  return reply.envelope?.errors?.[0]?.code ?? null;
}

function describe(reply: ManagerReply): string {
  if (reply.kind === "network") {
    return reply.error;
  }
  const e = reply.envelope?.errors?.[0];
  if (e) {
    return `HTTP ${reply.status} ${e.code}: ${e.message}`;
  }
  return `HTTP ${reply.status}`;
}
