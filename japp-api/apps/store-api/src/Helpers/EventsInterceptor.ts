import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { DomainError } from "@japp/domain";
import { catchError, tap, throwError, type Observable } from "rxjs";
import { CONFIG, EVENTS } from "../Constants/Injection.js";
import type { Config } from "../Properties/AppSettings.js";
import type { EventsHub, HubEvent } from "../Clases/EventsHub.js";
import { verifyToken, type SessionClaims } from "./TokenHelper.js";

/**
 * Avisos en tiempo real DESPUÉS del COMMIT: el servicio ya devolvió (su transacción terminó), así que el aviso
 * nunca llega antes que el dato. Se decide por la ruta, sin tocar los servicios:
 * - cambio en una orden (ruta con :orderId, o respuesta que es una transacción) → order.updated + table.updated
 * - cambio de Ajustes (/config/…) o de la sala → config.changed
 * - pedido de Order on Table (/oot/…) → table.updated
 * - una impresora que no responde (503 PRINTER_OFFLINE) → print.failed
 * - entrar con la clave (POST /sessions) → session.replaced a los equipos con la sesión anterior de ese usuario
 * - salir (DELETE /sessions/current) → los sockets de esa sesión se cierran con 4001
 */
@Injectable()
export class EventsInterceptor implements NestInterceptor {
  constructor(
    @Inject(EVENTS) private readonly hub: EventsHub,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const method = String(req.method ?? "GET");
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return next.handle();
    }
    return next.handle().pipe(
      tap((data) => {
        this.safely(() => this.afterSuccess(req, data));
      }),
      catchError((e) => {
        this.safely(() => this.afterError(req, e));
        return throwError(() => e);
      }),
    );
  }

  /** Un aviso nunca rompe la respuesta: si falla, se pierde el aviso, no la petición. */
  private safely(fn: () => void) {
    try {
      fn();
    } catch {
      // sin aviso: el equipo lo verá en su siguiente consulta
    }
  }

  private afterSuccess(req: any, data: any) {
    const path = routeOf(req);
    // Las rutas públicas (equipos, Order on Table) no tienen sesión: null = todos los equipos de este proceso (una tienda).
    const storeId: string | null = req.session?.storeId ?? null;
    if (path === "/sessions" && data?.token) {
      const c = verifyToken<SessionClaims>(this.cfg.sessionSecret, data.token, "session");
      if (c) {
        this.hub.replaced(c.store, c.sub, c.jti, String(data.station?.name ?? ""));
      }
      return;
    }
    if (path === "/sessions/current" && req.method === "DELETE" && req.session) {
      // salir: los WebSocket abiertos con esa sesión dejan de valer ya, no cuando caduque el token
      this.hub.ended(req.session.storeId, req.session.jti);
      return;
    }
    if (path.startsWith("/config") || path.startsWith("/devices/claim-main")) {
      this.hub.publish(storeId, { event: "config.changed", configVersion: data?.configVersion ?? null });
      return;
    }
    if (path.startsWith("/oot/")) {
      this.hub.publish(storeId, { event: "table.updated" });
      return;
    }
    for (const e of orderEvents(req, data)) {
      this.hub.publish(storeId, e);
    }
  }

  private afterError(req: any, e: unknown) {
    if (!(e instanceof DomainError) || e.code !== "PRINTER_OFFLINE") {
      return;
    }
    this.hub.publish(req.session?.storeId ?? null, {
      event: "print.failed",
      orderId: req.params?.orderId ?? null,
      printed: e.details.printed ?? null,
    });
  }
}

/** Ruta sin el prefijo /api/v2 ni la query. */
function routeOf(req: any): string {
  const url = String(req.routeOptions?.url ?? req.url ?? "");
  return url.replace(/^\/api\/v2/, "").split("?")[0] ?? "";
}

/** order.updated de cada orden que cambia (en un cambio de mesa, las dos) y table.updated para repintar el plano. */
function orderEvents(req: any, data: any): HubEvent[] {
  const ids = new Map<string, number | null>();
  const add = (tx: any) => {
    if (tx && typeof tx === "object" && typeof tx._id === "string") {
      ids.set(tx._id, typeof tx.version === "number" ? tx.version : null);
    }
  };
  add(data);
  add(data?.order);
  add(data?.from);
  add(data?.to);
  const param = req.params?.orderId;
  if (typeof param === "string" && !ids.has(param)) {
    ids.set(param, typeof data?.version === "number" ? data.version : null);
  }
  if (ids.size === 0) {
    return [];
  }
  const out: HubEvent[] = [...ids].map(([orderId, version]) => ({
    event: "order.updated",
    orderId,
    version,
  }));
  out.push({ event: "table.updated" });
  return out;
}
