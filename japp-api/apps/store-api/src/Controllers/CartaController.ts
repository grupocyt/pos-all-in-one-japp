import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query } from "@nestjs/common";
import { CurrentSession, type Session } from "../Helpers/AuthGuard.js";
import { CartaService } from "../Services/CartaService.js";
import { CartaSyncService } from "../Services/CartaSyncService.js";

/**
 * Ajustes › Carta y Sala, y los servicios Sync del App Manager.
 * Las rutas son concretas (carta, sync, order, permisos, pwa, sold-out, layout): el router de Fastify da
 * prioridad a un segmento fijo frente a uno variable, así que ganan a las genéricas /config/{module}/{id}
 * de ConfigController. Además este controlador se registra antes en Startup.
 */
@Controller("config")
export class CartaController {
  constructor(
    @Inject(CartaService) private readonly carta: CartaService,
    @Inject(CartaSyncService) private readonly sync: CartaSyncService,
  ) {}

  @Get("carta")
  full(@CurrentSession() se: Session, @Query("active") active?: string) {
    return this.carta.cartaFull(se, active);
  }

  @Get("carta/preview")
  preview(@CurrentSession() se: Session, @Query("mode") mode?: string) {
    return this.carta.preview(se, mode);
  }

  @Post("carta/sync")
  @HttpCode(200)
  syncCarta(@CurrentSession() se: Session, @Body() body: unknown) {
    return this.sync.syncCarta(se, body);
  }

  @Post("categorias/sync")
  @HttpCode(200)
  syncCategorias(@CurrentSession() se: Session, @Body() body: unknown) {
    return this.sync.syncCategorias(se, body);
  }

  @Post("productos/sync")
  @HttpCode(200)
  syncProductos(@CurrentSession() se: Session, @Body() body: unknown) {
    return this.sync.syncProductos(se, body);
  }

  @Post("preguntas/sync")
  @HttpCode(200)
  syncPreguntas(@CurrentSession() se: Session, @Body() body: unknown) {
    return this.sync.syncPreguntas(se, body);
  }

  @Put("categorias/order")
  orderCategories(@CurrentSession() se: Session, @Body() body: unknown) {
    return this.carta.order(se, "category", body);
  }

  @Put("areas/order")
  orderAreas(@CurrentSession() se: Session, @Body() body: unknown) {
    return this.carta.order(se, "area", body);
  }

  @Put("areas/:areaId/layout")
  layout(@CurrentSession() se: Session, @Param("areaId") areaId: string, @Body() body: unknown) {
    return this.carta.layout(se, areaId, body);
  }

  @Post("productos/:id/sold-out")
  @HttpCode(200)
  soldOut(@CurrentSession() se: Session, @Param("id") id: string, @Body() body: unknown) {
    return this.carta.soldOut(se, id, body);
  }

  @Get("permisos")
  permissions(@CurrentSession() se: Session) {
    return this.carta.permissions(se);
  }

  @Get("restaurante/pwa")
  pwa(@CurrentSession() se: Session) {
    return this.carta.pwa(se);
  }
}
