import { Inject, Injectable } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { Database } from "@japp/db";
import { fail, planBatch, type BatchCommand, type ErrorCode, HTTP_STATUS } from "@japp/domain";
import { DATABASE } from "../Constants/Injection.js";
import type { Session } from "../Helpers/AuthGuard.js";

/** Cabeceras del equipo que se pasan a cada comando de la tanda (la sesión, la estación y el traceId). */
const PASS_HEADERS = ["authorization", "x-station-id", "x-trace-id"] as const;

/**
 * Tanda de comandos de una mesa (25/10/2026). El TPV junta lo que se marca y lo manda en UNA petición.
 * Cada comando se ejecuta por su propia ruta (mismos permisos, presencia, versión, idempotencia y respuesta que suelto),
 * pero todos dentro de UNA transacción (Database.ambient): si uno falla no queda ninguno y se responde su error con
 * details.batchIndex, method y path. Las reglas de qué entra en una tanda están en @japp/domain → planBatch.
 */
@Injectable()
export class OrdersBatchService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(HttpAdapterHost) private readonly host: HttpAdapterHost,
  ) {}

  async run(session: Session, orderId: string, commands: BatchCommand[], headers: Record<string, unknown>) {
    void session; // la sesión ya la comprobó el guard; cada comando la vuelve a comprobar con sus permisos
    const list = planBatch(orderId, commands);
    const app = this.host.httpAdapter.getInstance();
    const base: Record<string, string> = { "content-type": "application/json" };
    for (const h of PASS_HEADERS) {
      if (typeof headers[h] === "string") {
        base[h] = headers[h] as string;
      }
    }
    return this.database.ambient(async () => {
      const results: { status: number; data: unknown }[] = [];
      for (const [i, c] of list.entries()) {
        const res = await app.inject({
          method: c.method,
          url: `/api/v2${c.path}`,
          headers: c.idempotencyKey ? { ...base, "idempotency-key": c.idempotencyKey } : base,
          payload: JSON.stringify(c.body ?? {}),
        });
        let env: any = null;
        try {
          env = JSON.parse(res.body);
        } catch {
          env = null;
        }
        if (res.statusCode >= 300) {
          const er = env?.errors?.[0] ?? {};
          const code = (er.code in HTTP_STATUS ? er.code : "VALIDATION") as ErrorCode;
          fail(code, er.message ?? `HTTP ${res.statusCode}`, {
            ...(er.details ?? {}),
            ...(er.field ? { field: er.field } : {}),
            batchIndex: i,
            method: c.method,
            path: c.path,
          });
        }
        results.push({ status: res.statusCode, data: env?.data ?? null });
      }
      return { applied: results.length, results };
    });
  }
}
