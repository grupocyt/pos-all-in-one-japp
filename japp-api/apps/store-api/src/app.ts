import "reflect-metadata";
import { Module, type DynamicModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { createDatabase, type Database } from "@japp/db";
import { CLOCK, CONFIG, DATABASE, PRINTER, type Clock } from "./common/tokens-di.js";
import { ErrorsFilter } from "./common/errors.filter.js";
import { AuthGuard } from "./common/auth.js";
import { Authorization } from "./common/authorization.js";
import { IdempotencyInterceptor } from "./common/idempotency.js";
import { EnvelopeInterceptor } from "./common/envelope.js";
import { randomUUID } from "node:crypto";
import { StoreRepo } from "./repos/store.repo.js";
import { OrderRepo } from "./repos/order.repo.js";
import { SystemController } from "./modules/system.controller.js";
import { SessionsController } from "./modules/sessions.controller.js";
import { PeriodsController } from "./modules/periods.controller.js";
import { TablesController } from "./modules/tables.controller.js";
import { OrdersController } from "./modules/orders.controller.js";
import { OrdersService } from "./modules/orders.service.js";
import { ReportsController } from "./modules/reports.controller.js";
import { ClosingsService } from "./modules/closings.service.js";
import { ConfigController } from "./modules/config/config.controller.js";
import { ConfigService } from "./modules/config/config.service.js";
import { EscPosNetPrinter, LogPrinter, type PrinterPort } from "./ports/printer.js";
import type { Config } from "./config.js";
import { registerWeb } from "./web.js";

export interface AppDeps { config: Config; database?: Database; printer?: PrinterPort; clock?: Clock; logger?: boolean; }

@Module({})
class AppModule {
  static with(d: Required<Omit<AppDeps, "logger">>): DynamicModule {
    return {
      module: AppModule,
      controllers: [SystemController, SessionsController, PeriodsController, TablesController, OrdersController, ReportsController, ConfigController],
      providers: [
        { provide: CONFIG, useValue: d.config }, { provide: DATABASE, useValue: d.database }, { provide: PRINTER, useValue: d.printer }, { provide: CLOCK, useValue: d.clock },
        StoreRepo, OrderRepo, Authorization, OrdersService, ClosingsService, ConfigService,
        { provide: APP_FILTER, useClass: ErrorsFilter }, { provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor }, { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
      ],
    };
  }
}

/** Construye la app (la usan main.ts y las pruebas). Todas las rutas cuelgan de /api/v2. */
export async function buildApp(deps: AppDeps) {
  const database = deps.database ?? createDatabase(deps.config.databaseUrl);
  const full = { config: deps.config, database, printer: deps.printer ?? (deps.config.printerMode === "escpos" ? new EscPosNetPrinter() : new LogPrinter()), clock: deps.clock ?? (() => new Date()) };
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.with(full), new FastifyAdapter({
    logger: deps.logger ?? false, bodyLimit: 256 * 1024,
    // traceId de cada respuesta: el que mande el equipo en X-Trace-Id (si es válido) o uno nuevo
    requestIdHeader: false, genReqId: (req: any) => { const h = req.headers?.["x-trace-id"]; return typeof h === "string" && /^[\w-]{8,64}$/.test(h) ? h : randomUUID(); },
  } as any), { logger: deps.logger === false ? false : undefined });
  app.setGlobalPrefix("api/v2");
  const origins = deps.config.corsOrigins ?? [];
  if (origins.length) app.enableCors({
    origin: origins.includes("*") ? true : origins, credentials: false, maxAge: 600,
    allowedHeaders: ["authorization", "content-type", "idempotency-key", "x-station-id", "x-trace-id"], exposedHeaders: ["idempotent-replayed", "x-trace-id"],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  });
  app.getHttpAdapter().getInstance().addHook("onRequest", async (req: any, reply: any) => { reply.header("x-trace-id", req.id); });
  app.enableShutdownHooks();
  registerWeb(app.getHttpAdapter().getInstance(), deps.config);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, database, printer: full.printer };
}
