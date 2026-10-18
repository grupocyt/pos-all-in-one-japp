import { Catch, HttpException, Inject, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import { DomainError, HTTP_STATUS } from "@japp/domain";
import { ZodError } from "zod";
import { CONFIG } from "./tokens-di.js";
import { envelope, type ApiErrorItem } from "./envelope.js";
import type { Config } from "../config.js";

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
    let errors: ApiErrorItem[] = [{ code: "INTERNAL", message: "Error interno. Si se repite, avisa a sistemas con el traceId.", field: null, details: {} }];
    if (ex instanceof DomainError) {
      status = ex.status;
      const field = typeof ex.details?.field === "string" ? ex.details.field as string : null;
      errors = [{ code: ex.code, message: ex.message, field, details: ex.details ?? {} }];
    } else if (ex instanceof ZodError) {
      status = 422;
      errors = ex.issues.map(i => ({ code: "VALIDATION", message: `${i.path.join(".") || "cuerpo"}: ${i.message}`, field: i.path.join(".") || null, details: {} }));
    } else if (ex instanceof HttpException) {
      status = ex.getStatus();
      const code = status === 404 ? "NOT_FOUND" : status === 401 ? "UNAUTHORIZED" : status >= 500 ? "INTERNAL" : "VALIDATION";
      errors = [{ code, message: status === 404 ? "No existe" : ex.message, field: null, details: {} }];
    } else {
      req.log?.error({ err: ex, traceId: req.id }, "error no controlado"); if (process.env.DEBUG_ERRORS) console.error(ex);
    }
    reply.status(status).send(envelope(this.cfg, req, status, null, errors));
  }
}
export { HTTP_STATUS };
