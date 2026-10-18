import { Inject, Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import { createHash } from "node:crypto";
import { from, of, switchMap, type Observable } from "rxjs";
import { and, eq, lt, sql } from "drizzle-orm";
import { schema as s, type Database } from "@japp/db";
import { fail } from "@japp/domain";
import { DATABASE } from "./tokens-di.js";
import { statusOf } from "./envelope.js";

/**
 * Idempotency-Key (cabecera) en los POST que crean cosas:
 * - misma clave + mismo cuerpo → se devuelve la respuesta guardada sin repetir la acción;
 * - misma clave + otro cuerpo → 422 VALIDATION;
 * - solo se guardan las respuestas 2xx (un error se puede reintentar).
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
    const db = this.database.db;
    return from(db.select().from(s.idempotencyKey).where(and(eq(s.idempotencyKey.storeId, storeId), eq(s.idempotencyKey.key, key)))).pipe(
      switchMap(([prev]) => {
        if (prev) {
          if (prev.requestHash !== hash) fail("VALIDATION", "Esa Idempotency-Key ya se usó con otra petición", { field: "Idempotency-Key" });
          reply.header("Idempotent-Replayed", "true");
          reply.status(prev.statusCode);
          return of(prev.response);
        }
        return next.handle().pipe(switchMap(body => from((async () => {
          await db.insert(s.idempotencyKey).values({ storeId, key, method: req.method, path, requestHash: hash, statusCode: statusOf(ctx), response: body as any }).onConflictDoNothing();
          if (Math.random() < 0.01) await db.delete(s.idempotencyKey).where(lt(s.idempotencyKey.createdAt, sql`now() - interval '7 days'`) as any);
          return body;
        })())));
      }),
    );
  }
}
