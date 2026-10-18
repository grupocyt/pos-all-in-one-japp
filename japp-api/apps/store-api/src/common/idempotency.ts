import { Inject, Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import { createHash } from "node:crypto";
import { from, lastValueFrom, type Observable } from "rxjs";
import { sql } from "drizzle-orm";
import type { Database } from "@japp/db";
import { fail } from "@japp/domain";
import { DATABASE } from "./tokens-di.js";
import { statusOf } from "./envelope.js";

/** Cuánto espera una petición repetida a que termine la original antes de responder IDEMPOTENCY_IN_PROGRESS. */
const WAIT_MS = 5000, POLL_MS = 50;
/** Una reserva sin terminar más vieja que esto (el proceso murió a mitad) se puede volver a tomar. */
const STALE_SECONDS = 120;

/**
 * Idempotency-Key (cabecera) en los POST que crean cosas:
 * - la clave se RESERVA antes de ejecutar (INSERT … ON CONFLICT DO NOTHING, status_code 0 = en curso): con varias peticiones
 *   iguales a la vez solo una ejecuta la acción;
 * - misma clave terminada → se devuelve la respuesta guardada sin repetir la acción (cabecera Idempotent-Replayed);
 * - misma clave en curso → se espera hasta ~5 s y se devuelve la guardada, o 409 IDEMPOTENCY_IN_PROGRESS;
 * - misma clave + otro cuerpo → 422 VALIDATION;
 * - solo se guardan las respuestas 2xx: si la acción falla se borra la reserva (un error se puede reintentar).
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest(), reply = ctx.switchToHttp().getResponse();
    const key = req.headers["idempotency-key"] as string | undefined;
    if (req.method !== "POST" || !key || !req.session) return next.handle();
    if (key.length > 80) fail("VALIDATION", "Idempotency-Key demasiado larga (máx. 80)", { field: "Idempotency-Key" });
    const storeId = req.session.storeId as string, path = String(req.url).split("?")[0]!;
    const hash = createHash("sha256").update(`${req.method} ${path} ${JSON.stringify(req.body ?? null)}`).digest("hex");
    return from(this.run(storeId, key, req.method, path, hash, statusOf(ctx), reply, () => lastValueFrom(next.handle(), { defaultValue: undefined })));
  }

  private async run(storeId: string, key: string, method: string, path: string, hash: string, okStatus: number, reply: any, exec: () => Promise<unknown>) {
    const db = this.database.db;
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      const reserved = (await db.execute(sql`INSERT INTO idempotency_key (store_id, key, method, path, request_hash, status_code, response)
        VALUES (${storeId}, ${key}, ${method}, ${path}, ${hash}, 0, '{}'::jsonb) ON CONFLICT DO NOTHING RETURNING key`)).rows.length > 0
        // la petición original murió sin terminar: se toma su reserva
        || (await db.execute(sql`UPDATE idempotency_key SET created_at = now(), request_hash = ${hash} WHERE store_id = ${storeId} AND key = ${key}
            AND status_code = 0 AND created_at < now() - make_interval(secs => ${STALE_SECONDS}) RETURNING key`)).rows.length > 0;
      if (reserved) {
        let body: unknown;
        try { body = await exec(); } catch (e) {
          await db.execute(sql`DELETE FROM idempotency_key WHERE store_id = ${storeId} AND key = ${key} AND status_code = 0`).catch(() => {});
          throw e;
        }
        await db.execute(sql`UPDATE idempotency_key SET status_code = ${okStatus}, response = ${JSON.stringify(body ?? null)}::jsonb
          WHERE store_id = ${storeId} AND key = ${key}`);
        if (Math.random() < 0.01) await db.execute(sql`DELETE FROM idempotency_key WHERE created_at < now() - interval '7 days' AND status_code <> 0`).catch(() => {});
        return body;
      }
      const [prev] = (await db.execute(sql`SELECT request_hash, status_code, response FROM idempotency_key WHERE store_id = ${storeId} AND key = ${key}`)).rows as { request_hash: string; status_code: number; response: unknown }[];
      if (!prev) continue; // la original falló y borró su reserva: se vuelve a intentar reservar
      if (prev.request_hash !== hash) fail("VALIDATION", "Esa Idempotency-Key ya se usó con otra petición", { field: "Idempotency-Key" });
      if (Number(prev.status_code) !== 0) {
        reply.header("Idempotent-Replayed", "true");
        reply.status(Number(prev.status_code));
        return prev.response;
      }
      if (Date.now() > deadline) fail("IDEMPOTENCY_IN_PROGRESS", "La misma petición sigue en curso: vuelve a intentarlo en unos segundos", { key });
      await new Promise(r => setTimeout(r, POLL_MS));
    }
  }
}
