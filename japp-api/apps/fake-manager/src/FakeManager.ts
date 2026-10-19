import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { createGunzip } from "node:zlib";
import { sha256 } from "./Helpers/Canonical.js";
import { fail, ok } from "./Helpers/Envelope.js";
import { ManagerStore, type ReconcileItem, type Route } from "./Services/ManagerStore.js";

export interface FakeManagerOptions {
  /** Credencial que tiene que mandar la tienda en Authorization: Bearer … */
  storeKey: string;
  logger?: boolean;
}

export interface FakeManager {
  app: FastifyInstance;
  store: ManagerStore;
  /** Arranca en ese puerto (0 = uno libre) y devuelve la URL base del contrato (…/api/manager/v1). */
  listen(port?: number, host?: string): Promise<string>;
  close(): Promise<void>;
}

const BASE = "/api/manager/v1";

const TITLES: Record<Route, string> = {
  transactions: "Transacciones recibidas",
  reconcile: "Conciliación de transacciones",
  heartbeat: "Latido del agente",
};

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }
}

/**
 * Manager de pruebas con el contrato del lado Manager (POST …/transactions, …/transactions/reconcile, …/heartbeat).
 * Todo en memoria; los controles de ManagerStore permiten simular caídas, respuestas perdidas o una storeKey revocada.
 */
export function createFakeManager(opts: FakeManagerOptions): FakeManager {
  if (!opts.storeKey) {
    throw new Error("El Manager de pruebas necesita una storeKey (FAKE_MANAGER_STORE_KEY)");
  }
  const store = new ManagerStore();
  // forceCloseConnections: al parar (fin de cada prueba) no espera a las conexiones keep-alive del agente.
  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 50 * 1024 * 1024,
    forceCloseConnections: true,
  });

  // El agente manda el cuerpo comprimido (Content-Encoding: gzip): se descomprime antes de leer el JSON.
  app.addHook("preParsing", async (req, _reply, payload) => {
    if (String(req.headers["content-encoding"] ?? "").toLowerCase() === "gzip") {
      delete req.headers["content-length"];
      return payload.pipe(createGunzip());
    }
    return payload;
  });
  // Se guarda el texto tal cual llega: la Idempotency-Key compara el cuerpo recibido, no una versión re-serializada.
  app.removeContentTypeParser(["application/json"]);
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    req.rawBody = body as string;
    try {
      done(null, JSON.parse(body as string));
    } catch {
      const err = new Error("El cuerpo no es JSON válido") as Error & { statusCode: number };
      err.statusCode = 422;
      done(err, undefined);
    }
  });
  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    reply.code(status).send(fail("Error", status, status === 422 ? "VALIDATION" : "ERROR", err.message));
  });

  /** Fallo simulado y storeKey. Devuelve true si ya se ha contestado. */
  const guard = (route: Route, req: FastifyRequest, reply: FastifyReply, storeId: string): boolean => {
    const forced = store.controls.fail[route];
    if (forced) {
      log(route, storeId, forced, req);
      reply
        .code(forced)
        .send(fail(TITLES[route], forced, codeFor(forced), "Fallo simulado por el control de pruebas"));
      return true;
    }
    const auth = String(req.headers.authorization ?? "");
    if (auth !== `Bearer ${opts.storeKey}`) {
      log(route, storeId, 401, req);
      reply.code(401).send(fail(TITLES[route], 401, "UNAUTHORIZED", "storeKey no válida"));
      return true;
    }
    return false;
  };
  const log = (route: Route, storeId: string, status: number, req: FastifyRequest) => {
    const key = req.headers["idempotency-key"];
    store.requests.push({
      route,
      storeId,
      status,
      key: typeof key === "string" ? key : null,
      at: new Date().toISOString(),
    });
  };

  app.post<{ Params: { storeId: string } }>(`${BASE}/stores/:storeId/transactions`, async (req, reply) => {
    const { storeId } = req.params;
    if (guard("transactions", req, reply, storeId)) {
      return reply;
    }
    const body = req.body as { transactions?: unknown } | null;
    if (!body || !Array.isArray(body.transactions)) {
      log("transactions", storeId, 422, req);
      return reply
        .code(422)
        .send(fail(TITLES.transactions, 422, "VALIDATION", "Falta la lista transactions"));
    }
    const list = body.transactions as Array<Record<string, unknown> | null>;
    if (store.controls.maxBatch !== null && list.length > store.controls.maxBatch) {
      log("transactions", storeId, 413, req);
      return reply
        .code(413)
        .send(
          fail(TITLES.transactions, 413, "PAYLOAD_TOO_LARGE", `Máximo ${store.controls.maxBatch} por lote`),
        );
    }
    if (list.some((t) => t && typeof t._id === "string" && store.controls.poison.has(t._id))) {
      log("transactions", storeId, 422, req);
      return reply.code(422).send(fail(TITLES.transactions, 422, "VALIDATION", "El lote no se puede leer"));
    }
    const key = typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : null;
    const bodyHash = sha256(req.rawBody ?? "");
    if (key) {
      const saved = store.replay(storeId, key, bodyHash);
      if (saved === "mismatch") {
        log("transactions", storeId, 409, req);
        return reply
          .code(409)
          .send(
            fail(
              TITLES.transactions,
              409,
              "IDEMPOTENCY_MISMATCH",
              "Esta Idempotency-Key ya se usó con otro cuerpo",
            ),
          );
      }
      if (saved) {
        log("transactions", storeId, saved.status, req);
        return reply.code(saved.status).header("idempotent-replayed", "true").send(saved.envelope);
      }
    }
    const results = store.receive(storeId, list);
    if (store.controls.loseResponses > 0) {
      // Guardado, pero la respuesta no llega (y no queda apuntada): el agente no sabe si llegó y reenvía.
      store.controls.loseResponses--;
      log("transactions", storeId, 0, req);
      reply.hijack();
      req.raw.socket.destroy();
      return reply;
    }
    const env = ok(TITLES.transactions, { results });
    if (key) {
      store.remember(storeId, key, bodyHash, 200, env);
    }
    log("transactions", storeId, 200, req);
    return reply.code(200).send(env);
  });

  app.post<{ Params: { storeId: string } }>(
    `${BASE}/stores/:storeId/transactions/reconcile`,
    async (req, reply) => {
      const { storeId } = req.params;
      if (guard("reconcile", req, reply, storeId)) {
        return reply;
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (!Array.isArray(body.items)) {
        log("reconcile", storeId, 422, req);
        return reply.code(422).send(fail(TITLES.reconcile, 422, "VALIDATION", "Falta la lista items"));
      }
      const items = (body.items as ReconcileItem[]).filter(
        (it) => it && typeof it.orderId === "string" && Number.isInteger(it.version),
      );
      const result = store.reconcile(storeId, items);
      store.reconciles.push({ storeId, at: new Date().toISOString(), body, result });
      log("reconcile", storeId, 200, req);
      return reply.code(200).send(ok(TITLES.reconcile, result));
    },
  );

  app.post<{ Params: { storeId: string } }>(`${BASE}/stores/:storeId/heartbeat`, async (req, reply) => {
    const { storeId } = req.params;
    if (guard("heartbeat", req, reply, storeId)) {
      return reply;
    }
    store.heartbeats.push({
      storeId,
      at: new Date().toISOString(),
      body: (req.body ?? {}) as Record<string, unknown>,
    });
    log("heartbeat", storeId, 200, req);
    return reply.code(200).send(ok(TITLES.heartbeat, { serverTime: new Date().toISOString() }));
  });

  // ── Inspección y controles de pruebas (sin storeKey: es una herramienta local) ──
  app.get("/__fake/state", async () => ({
    transactions: [...store.transactions.values()].map(summary),
    invoices: [...store.invoices.entries()].map(([key, v]) => ({ key, orderId: v.orderId })),
    history: store.history,
    heartbeats: store.heartbeats,
    reconciles: store.reconciles,
    requests: store.requests,
    controls: controlsView(store),
  }));
  app.get<{ Params: { storeId: string } }>("/__fake/stores/:storeId/transactions", async (req) =>
    store.list(req.params.storeId).map((t) => ({ ...summary(t), transaction: t.transaction })),
  );
  app.delete<{ Params: { storeId: string; orderId: string } }>(
    "/__fake/stores/:storeId/transactions/:orderId",
    async (req) => ({ forgotten: store.forget(req.params.storeId, req.params.orderId) }),
  );
  app.post("/__fake/controls", async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (b.fail && typeof b.fail === "object") {
      store.controls.fail = { ...store.controls.fail, ...(b.fail as Record<Route, number | null>) };
    }
    if (typeof b.loseResponses === "number") {
      store.controls.loseResponses = b.loseResponses;
    }
    if (Array.isArray(b.reject)) {
      store.controls.reject = new Set(b.reject as string[]);
    }
    if (Array.isArray(b.poison)) {
      store.controls.poison = new Set(b.poison as string[]);
    }
    if ("maxBatch" in b) {
      store.controls.maxBatch = typeof b.maxBatch === "number" ? b.maxBatch : null;
    }
    return controlsView(store);
  });
  app.post("/__fake/reset", async () => {
    store.reset();
    return { reset: true };
  });

  return {
    app,
    store,
    async listen(port = 0, host = "127.0.0.1") {
      await app.listen({ port, host });
      const addr = app.server.address();
      const real = typeof addr === "object" && addr ? addr.port : port;
      return `http://${host}:${real}${BASE}`;
    },
    close: () => app.close(),
  };
}

function summary(t: { storeId: string; orderId: string; version: number; receivedAt: string }) {
  return { storeId: t.storeId, orderId: t.orderId, version: t.version, receivedAt: t.receivedAt };
}

function controlsView(store: ManagerStore) {
  const c = store.controls;
  return {
    fail: c.fail,
    loseResponses: c.loseResponses,
    reject: [...c.reject],
    poison: [...c.poison],
    maxBatch: c.maxBatch,
  };
}

function codeFor(status: number): string {
  if (status === 401 || status === 403) {
    return "UNAUTHORIZED";
  }
  if (status === 429) {
    return "TOO_MANY_REQUESTS";
  }
  if (status >= 500) {
    return "UNAVAILABLE";
  }
  return "ERROR";
}
