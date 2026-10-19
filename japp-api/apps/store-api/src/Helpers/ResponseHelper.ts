import { HTTP_CODE_METADATA } from "@nestjs/common/constants.js";
import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { map, type Observable } from "rxjs";
import { CONFIG } from "../Constants/Injection.js";
import type { Config } from "../Properties/AppSettings.js";

/**
 * Formato común de TODAS las respuestas de /api/v2 (correctas y de error):
 *   { title, type: "success"|"error", status, data, errors: [], traceId, author, mode }
 * - title: resumen del endpoint en el contrato (docs/openapi.yaml), p. ej. «Abrir mesa».
 * - data: el resultado; null en errores y en acciones sin contenido.
 * - errors: [{ code, message, field, details }]; vacío si todo fue bien.
 * - traceId: id de la petición (también en la cabecera X-Trace-Id y en los logs).
 */
export interface ApiErrorItem {
  code: string;
  message: string;
  field: string | null;
  details: Record<string, unknown>;
}
export interface Envelope<T = unknown> {
  title: string;
  type: "success" | "error";
  status: number;
  data: T | null;
  errors: ApiErrorItem[];
  traceId: string;
  author: string;
  mode: "developer" | "production";
}

const here = fileURLToPath(new URL(".", import.meta.url));
let routes: { re: RegExp; method: string; title: string }[] | null = null;
function loadRoutes() {
  if (routes) {
    return routes;
  }
  routes = [];
  try {
    const doc = JSON.parse(
      readFileSync(resolve(here, "../../../../packages/contracts/src/openapi.json"), "utf8"),
    );
    for (const [tpl, item] of Object.entries<any>(doc.paths)) {
      if (!tpl.startsWith("/api/v2/")) {
        continue;
      }
      for (const [method, op] of Object.entries<any>(item)) {
        if (op?.summary) {
          routes.push({
            re: new RegExp("^" + tpl.replace(/\{[^}]+\}/g, "[^/]+") + "$"),
            method: method.toUpperCase(),
            title: op.summary,
          });
        }
      }
    }
  } catch {
    /* sin contrato: se usa el título genérico */
  }
  return routes;
}

/** Título de la respuesta: el resumen del endpoint en el contrato. */
export function titleFor(method: string, url: string): string {
  const path = String(url).split("?")[0]!;
  return loadRoutes().find((r) => r.method === method.toUpperCase() && r.re.test(path))?.title ?? "API Japp";
}

export function envelope<T>(
  cfg: Pick<Config, "apiAuthor" | "apiMode">,
  req: { method: string; url: string; id?: string },
  status: number,
  data: T | null,
  errors: ApiErrorItem[] = [],
): Envelope<T> {
  return {
    title: titleFor(req.method, req.url),
    type: errors.length || status >= 400 ? "error" : "success",
    status,
    data: errors.length || status >= 400 ? null : data === undefined ? null : data,
    errors,
    traceId: String(req.id ?? ""),
    author: cfg.apiAuthor,
    mode: cfg.apiMode,
  };
}

/** Código HTTP de éxito del endpoint: el de @HttpCode o el de Nest por defecto (POST 201, resto 200). */
export function statusOf(ctx: ExecutionContext): number {
  const code = Reflect.getMetadata(HTTP_CODE_METADATA, ctx.getHandler());
  if (typeof code === "number") {
    return code;
  }
  return ctx.switchToHttp().getRequest().method === "POST" ? 201 : 200;
}

/** Envuelve el resultado de cada controlador. Va el primero (por fuera de la idempotencia): una respuesta repetida lleva su propio traceId. */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  constructor(@Inject(CONFIG) private readonly cfg: Config) {}
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const reply = ctx.switchToHttp().getResponse();
    const status = statusOf(ctx);
    return next
      .handle()
      .pipe(
        map((body) =>
          reply.statusCode === 304
            ? undefined
            : envelope(
                this.cfg,
                req,
                reply.statusCode && reply.statusCode !== 200 ? reply.statusCode : status,
                body ?? null,
              ),
        ),
      );
  }
}
