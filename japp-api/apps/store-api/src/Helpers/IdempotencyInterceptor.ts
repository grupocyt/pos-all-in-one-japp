import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { from, lastValueFrom, type Observable } from "rxjs";
import { fail } from "@japp/domain";
import { IdempotencyApplication } from "../Applications/IdempotencyApplication.js";
import { statusOf } from "./ResponseHelper.js";

/** Cuánto espera una petición repetida a que termine la original antes de responder IDEMPOTENCY_IN_PROGRESS. */
const WAIT_MS = 5000;
const POLL_MS = 50;
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
  constructor(@Inject(IdempotencyApplication) private readonly keys: IdempotencyApplication) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const reply = ctx.switchToHttp().getResponse();
    const key = req.headers["idempotency-key"] as string | undefined;
    if (req.method !== "POST" || !key || !req.session) {
      return next.handle();
    }
    if (key.length > 80) {
      fail("VALIDATION", "Idempotency-Key demasiado larga (máx. 80)", { field: "Idempotency-Key" });
    }
    const storeId = req.session.storeId as string;
    const path = String(req.url).split("?")[0]!;
    const hash = createHash("sha256")
      .update(`${req.method} ${path} ${JSON.stringify(req.body ?? null)}`)
      .digest("hex");
    return from(
      this.run(storeId, key, req.method, path, hash, statusOf(ctx), reply, () =>
        lastValueFrom(next.handle(), { defaultValue: undefined }),
      ),
    );
  }

  private async run(
    storeId: string,
    key: string,
    method: string,
    path: string,
    hash: string,
    okStatus: number,
    reply: any,
    exec: () => Promise<unknown>,
  ) {
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      const reserved =
        (await this.keys.reserve(storeId, key, method, path, hash)) ||
        // la petición original murió sin terminar: se toma su reserva
        (await this.keys.takeStale(storeId, key, hash, STALE_SECONDS));
      if (reserved) {
        let body: unknown;
        try {
          body = await exec();
        } catch (e) {
          await this.keys.release(storeId, key).catch(() => {});
          throw e;
        }
        await this.keys.complete(storeId, key, okStatus, body);
        if (Math.random() < 0.01) {
          await this.keys.purgeOld().catch(() => {});
        }
        return body;
      }
      const prev = await this.keys.find(storeId, key);
      if (!prev) {
        continue;
      } // la original falló y borró su reserva: se vuelve a intentar reservar
      if (prev.request_hash !== hash) {
        fail("VALIDATION", "Esa Idempotency-Key ya se usó con otra petición", { field: "Idempotency-Key" });
      }
      if (Number(prev.status_code) !== 0) {
        reply.header("Idempotent-Replayed", "true");
        reply.status(Number(prev.status_code));
        return prev.response;
      }
      if (Date.now() > deadline) {
        fail(
          "IDEMPOTENCY_IN_PROGRESS",
          "La misma petición sigue en curso: vuelve a intentarlo en unos segundos",
          { key },
        );
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}
