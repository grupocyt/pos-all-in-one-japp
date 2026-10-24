import "reflect-metadata";
import { Module, type DynamicModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { createDatabase, type Database } from "@japp/db";
import { CLOCK, CONFIG, DATABASE, EVENTS, PRINTER, type Clock } from "./Constants/Injection.js";
import { ErrorsFilter } from "./Helpers/ErrorsFilter.js";
import { AuthGuard } from "./Helpers/AuthGuard.js";
import { AuthorizationService } from "./Services/AuthorizationService.js";
import { SessionsApplication } from "./Applications/SessionsApplication.js";
import { IdempotencyInterceptor } from "./Helpers/IdempotencyInterceptor.js";
import { EnvelopeInterceptor } from "./Helpers/ResponseHelper.js";
import { randomUUID } from "node:crypto";
import { StoreApplication } from "./Applications/StoreApplication.js";
import { OrdersApplication } from "./Applications/OrdersApplication.js";
import { CartaApplication } from "./Applications/CartaApplication.js";
import { TablesApplication } from "./Applications/TablesApplication.js";
import { PrintersApplication } from "./Applications/PrintersApplication.js";
import { TablesService } from "./Services/TablesService.js";
import { PrintersService } from "./Services/PrintersService.js";
import { ConfigApplication } from "./Applications/ConfigApplication.js";
import { ConfigHistoryApplication } from "./Applications/ConfigHistoryApplication.js";
import { SystemController } from "./Controllers/SystemController.js";
import { SessionsController } from "./Controllers/SessionsController.js";
import { PeriodsController } from "./Controllers/PeriodsController.js";
import { TablesController } from "./Controllers/TablesController.js";
import { OrdersController } from "./Controllers/OrdersController.js";
import { OrdersService } from "./Services/OrdersService.js";
import { ReportsController } from "./Controllers/ReportsController.js";
import { ClosingsService } from "./Services/ClosingsService.js";
import { ConfigController } from "./Controllers/ConfigController.js";
import { PrintersController } from "./Controllers/PrintersController.js";
import { TransactionsController } from "./Controllers/TransactionsController.js";
import { TransactionsService } from "./Services/TransactionsService.js";
import { ConfigService } from "./Services/ConfigService.js";
import { EscPosNetPrinter, LogPrinter, type PrinterPort } from "./Clases/Printers.js";
import type { Config } from "./Properties/AppSettings.js";
import { registerWeb } from "./Helpers/WebHost.js";
import { registerEvents } from "./Helpers/EventsSocket.js";
import { EventsInterceptor } from "./Helpers/EventsInterceptor.js";
import { EventsHub } from "./Clases/EventsHub.js";
import { SessionsService } from "./Services/SessionsService.js";
import { SystemService } from "./Services/SystemService.js";
import { PeriodsService } from "./Services/PeriodsService.js";
import { CashService } from "./Services/CashService.js";
import { InvoicesService } from "./Services/InvoicesService.js";
import { ReportsService } from "./Services/ReportsService.js";
import { SystemApplication } from "./Applications/SystemApplication.js";
import { DevicesApplication } from "./Applications/DevicesApplication.js";
import { PeriodsApplication } from "./Applications/PeriodsApplication.js";
import { CashApplication } from "./Applications/CashApplication.js";
import { InvoicesApplication } from "./Applications/InvoicesApplication.js";
import { ReportsApplication } from "./Applications/ReportsApplication.js";
import { ClosingsApplication } from "./Applications/ClosingsApplication.js";
import { TransactionsApplication } from "./Applications/TransactionsApplication.js";
import { IdempotencyApplication } from "./Applications/IdempotencyApplication.js";
import { CashController } from "./Controllers/CashController.js";
import { InvoicesController } from "./Controllers/InvoicesController.js";
import { SyncController } from "./Controllers/SyncController.js";
import { CustomersController } from "./Controllers/CustomersController.js";
import { CustomersService } from "./Services/CustomersService.js";
import { CustomersApplication } from "./Applications/CustomersApplication.js";
import {
  OrderOnTableController,
  OrderOnTablePublicController,
} from "./Controllers/OrderOnTableController.js";
import { OrderOnTableService } from "./Services/OrderOnTableService.js";
import { OrderOnTableApplication } from "./Applications/OrderOnTableApplication.js";
import { IntegrationKeyGuard } from "./Helpers/IntegrationKeyGuard.js";
import { CartaController } from "./Controllers/CartaController.js";
import { CartaService } from "./Services/CartaService.js";
import { CartaSyncService } from "./Services/CartaSyncService.js";
import { CartaSyncApplication } from "./Applications/CartaSyncApplication.js";
import { DevicesController } from "./Controllers/DevicesController.js";
import { DevicesService } from "./Services/DevicesService.js";
import { safeRequestLog } from "./Helpers/LogHelper.js";
import { IncidentsController } from "./Controllers/IncidentsController.js";
import { OrderIncidentsController } from "./Controllers/OrderIncidentsController.js";
import { OrderIncidentsService } from "./Services/OrderIncidentsService.js";
import { OrderIncidentsApplication } from "./Applications/OrderIncidentsApplication.js";
import { IncidentsService } from "./Services/IncidentsService.js";
import { IncidentsApplication } from "./Applications/IncidentsApplication.js";

export interface AppDeps {
  config: Config;
  database?: Database;
  printer?: PrinterPort;
  clock?: Clock;
  events?: EventsHub;
  logger?: boolean;
}

@Module({})
class AppModule {
  static with(d: Required<Omit<AppDeps, "logger">>): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        SystemController,
        SessionsController,
        PeriodsController,
        TablesController,
        OrdersController,
        CashController,
        InvoicesController,
        ReportsController,
        SyncController,
        // antes que ConfigController: sus rutas concretas (/config/carta, …/sync, …/order) y las genéricas /config/{module}
        CartaController,
        ConfigController,
        PrintersController,
        TransactionsController,
        CustomersController,
        OrderOnTableController,
        OrderOnTablePublicController,
        DevicesController,
        IncidentsController,
        OrderIncidentsController,
      ],
      providers: [
        { provide: CONFIG, useValue: d.config },
        { provide: DATABASE, useValue: d.database },
        { provide: PRINTER, useValue: d.printer },
        { provide: CLOCK, useValue: d.clock },
        { provide: EVENTS, useValue: d.events },
        StoreApplication,
        OrdersApplication,
        CartaApplication,
        TablesApplication,
        PrintersApplication,
        ConfigApplication,
        ConfigHistoryApplication,
        AuthorizationService,
        SessionsApplication,
        OrdersService,
        TablesService,
        PrintersService,
        ClosingsService,
        ConfigService,
        TransactionsService,
        SessionsService,
        SystemService,
        PeriodsService,
        CashService,
        InvoicesService,
        ReportsService,
        SystemApplication,
        DevicesApplication,
        PeriodsApplication,
        CashApplication,
        InvoicesApplication,
        ReportsApplication,
        ClosingsApplication,
        TransactionsApplication,
        IdempotencyApplication,
        CustomersService,
        CustomersApplication,
        OrderOnTableApplication,
        OrderOnTableService,
        IntegrationKeyGuard,
        CartaService,
        CartaSyncService,
        CartaSyncApplication,
        DevicesService,
        IncidentsService,
        IncidentsApplication,
        OrderIncidentsService,
        OrderIncidentsApplication,
        { provide: APP_FILTER, useClass: ErrorsFilter },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
        // el último es el de dentro: avisa con el dato del controlador, después del COMMIT (y no en una respuesta repetida)
        { provide: APP_INTERCEPTOR, useClass: EventsInterceptor },
      ],
    };
  }
}

/** Opciones del logger de Fastify: apagado, o encendido con el serializador de req que sanea la URL. */
function loggerOptions(on: boolean | undefined) {
  if (!on) {
    return false;
  }
  return { serializers: { req: safeRequestLog } };
}

/** Construye la app (la usan main.ts y las pruebas). Todas las rutas cuelgan de /api/v2. */
export async function buildApp(deps: AppDeps) {
  const database = deps.database ?? createDatabase(deps.config.databaseUrl);
  const full = {
    config: deps.config,
    database,
    printer:
      deps.printer ?? (deps.config.printerMode === "escpos" ? new EscPosNetPrinter() : new LogPrinter()),
    clock: deps.clock ?? (() => new Date()),
    events: deps.events ?? new EventsHub(),
  };
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.with(full),
    new FastifyAdapter({
      // con logs: la URL se escribe sin query y sin el token del QR (LogHelper), nunca con tokens
      logger: loggerOptions(deps.logger),
      bodyLimit: 256 * 1024,
      // traceId de cada respuesta: el que mande el equipo en X-Trace-Id (si es válido) o uno nuevo
      requestIdHeader: false,
      genReqId: (req: any) => {
        const h = req.headers?.["x-trace-id"];
        return typeof h === "string" && /^[\w-]{8,64}$/.test(h) ? h : randomUUID();
      },
    } as any),
    { logger: deps.logger === false ? false : undefined },
  );
  app.setGlobalPrefix("api/v2");
  const origins = deps.config.corsOrigins ?? [];
  if (origins.length) {
    app.enableCors({
      origin: origins.includes("*") ? true : origins,
      credentials: false,
      maxAge: 600,
      allowedHeaders: [
        "authorization",
        "content-type",
        "idempotency-key",
        "x-station-id",
        "x-trace-id",
        "x-integration-key",
      ],
      exposedHeaders: ["idempotent-replayed", "x-trace-id"],
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    });
  }
  app
    .getHttpAdapter()
    .getInstance()
    .addHook("onRequest", async (req: any, reply: any) => {
      reply.header("x-trace-id", req.id);
    });
  app.enableShutdownHooks();
  await registerEvents(
    app.getHttpAdapter().getInstance(),
    full.events,
    deps.config,
    app.get(SessionsApplication),
  );
  registerWeb(app.getHttpAdapter().getInstance(), deps.config);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, database, printer: full.printer, events: full.events };
}
