import { Catch, HttpException, Inject, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import { DomainError, HTTP_STATUS } from "@japp/domain";
import { ZodError } from "zod";
import { CONFIG } from "../Constants/Injection.js";
import { envelope, type ApiErrorItem } from "./ResponseHelper.js";
import type { Config } from "../Properties/AppSettings.js";

/**
 * Los errores salen con el formato común (envelope.ts): type "error", data null y errors con { code, message, field, details }.
 * VALIDATION trae un elemento por campo. Nada interno (pila, SQL) sale hacia fuera: se busca en los logs por traceId.
 */
@Catch()
export class ErrorsFilter implements ExceptionFilter {
  constructor(@Inject(CONFIG) private readonly cfg: Config) {}
  catch(ex: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse();
    const req = host.switchToHttp().getRequest();
    let status = 500;
    let errors: ApiErrorItem[] = [
      {
        code: "INTERNAL",
        message: "Error interno. Si se repite, avisa a sistemas con el traceId.",
        field: null,
        details: {},
      },
    ];
    if (ex instanceof DomainError) {
      status = ex.status;
      const field = typeof ex.details?.field === "string" ? (ex.details.field as string) : null;
      errors = [{ code: ex.code, message: ex.message, field, details: ex.details ?? {} }];
    } else if (ex instanceof ZodError) {
      status = 422;
      errors = ex.issues.map((i) => ({
        code: "VALIDATION",
        message: `${i.path.join(".") || "cuerpo"}: ${i.message}`,
        field: i.path.join(".") || null,
        details: {},
      }));
    } else if (pgRetryable(ex)) {
      // interbloqueo o fallo de serialización: PostgreSQL deshizo la transacción entera, así que repetirla es seguro
      status = HTTP_STATUS.BUSY_RETRY;
      errors = [
        {
          code: "BUSY_RETRY",
          message: "Otro equipo está cambiando lo mismo: vuelve a intentarlo",
          field: null,
          details: {},
        },
      ];
      req.log?.warn({ err: ex, traceId: req.id }, "transacción cancelada por la base (reintentable)");
    } else if (pgError(ex)) {
      // errores de la base por datos del equipo: nunca un 500
      const pg = pgError(ex)!;
      const c = pg.constraint ?? "";
      if (pg.code === "23505") {
        const [code, message]: [string, string] = /open_flag/.test(c)
          ? ["PERIOD_ALREADY_OPEN", "Ya hay un periodo abierto"]
          : c === "uq_orders_open_table"
            ? ["TABLE_BUSY", "La mesa ya está abierta"]
            : c === "uq_invoice_account_issued"
              ? ["ACCOUNT_CLOSED", "La cuenta ya está facturada"]
              : ["DUPLICATE", "Ya existe: ese id, código o nombre ya se usó"];
        status = HTTP_STATUS[code as keyof typeof HTTP_STATUS];
        errors = [{ code, message, field: null, details: { constraint: c } }];
      } else {
        status = 422;
        const message =
          pg.code === "23503"
            ? "Hace referencia a algo que no existe"
            : pg.code === "23514"
              ? "Valor fuera de lo permitido"
              : "Valor no válido";
        errors = [{ code: "VALIDATION", message, field: null, details: c ? { constraint: c } : {} }];
      }
      req.log?.warn({ err: ex, traceId: req.id }, "error de datos");
    } else if (ex instanceof HttpException) {
      status = ex.getStatus();
      const code =
        status === 404
          ? "NOT_FOUND"
          : status === 401
            ? "UNAUTHORIZED"
            : status >= 500
              ? "INTERNAL"
              : "VALIDATION";
      errors = [{ code, message: status === 404 ? "No existe" : ex.message, field: null, details: {} }];
    } else {
      req.log?.error({ err: ex, traceId: req.id }, "error no controlado");
      if (process.env.DEBUG_ERRORS) {
        console.error(ex);
      }
    }
    reply.status(status).send(envelope(this.cfg, req, status, null, errors));
  }
}
export { HTTP_STATUS };

/** Clases de error de PostgreSQL que vienen de datos del cliente: único (23505), FK (23503), CHECK (23514), formato (22P02, 22007, 22008, 22003). */
const CLIENT_PG = new Set(["23505", "23503", "23514", "22P02", "22007", "22008", "22003", "22001"]);
export function pgError(ex: unknown): { code: string; constraint?: string } | null {
  for (let e: any = ex, i = 0; e && i < 4; e = e.cause, i++) {
    if (typeof e.code === "string" && CLIENT_PG.has(e.code)) {
      return { code: e.code, constraint: e.constraint };
    }
  }
  return null;
}

/** Interbloqueo (40P01) o fallo de serialización (40001): la base deshizo la transacción y se puede repetir. */
const RETRYABLE_PG = new Set(["40P01", "40001"]);
export function pgRetryable(ex: unknown): boolean {
  for (let e: any = ex, i = 0; e && i < 4; e = e.cause, i++) {
    if (typeof e.code === "string" && RETRYABLE_PG.has(e.code)) {
      return true;
    }
  }
  return false;
}
