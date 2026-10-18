import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import { CurrentSession, type Session } from "../../common/auth.js";
import { ConfigService } from "./config.service.js";

/** Ajustes por API: paquete de configuración, CRUD de cada módulo (nada se borra: se desactiva) e historial. */
@Controller("config")
export class ConfigController {
  constructor(@Inject(ConfigService) private readonly cfg: ConfigService) {}

  /** Paquete para pintar el TPV y la PDA. ETag = versión de configuración; If-None-Match igual → 304 sin cuerpo. */
  @Get()
  async bundle(@CurrentSession() se: Session, @Req() req: any, @Res({ passthrough: true }) reply: any) {
    const v = await this.cfg.configVersion(se.storeId), etag = `W/"${v}"`;
    reply.header("etag", etag);
    if (String(req.headers["if-none-match"] ?? "") === etag) { reply.status(304); return null; }
    return this.cfg.bundle(se);
  }

  @Get("history")
  history(@CurrentSession() se: Session, @Query("module") module?: string, @Query("recordId") recordId?: string, @Query("limit") limit?: string, @Query("cursor") cursor?: string) {
    return this.cfg.history(se, { module, recordId, limit, cursor });
  }

  @Get(":module")
  list(@CurrentSession() se: Session, @Param("module") module: string, @Query("q") q?: string, @Query("limit") limit?: string, @Query("cursor") cursor?: string, @Query("active") active?: string) {
    return this.cfg.list(se, module, { q, limit, cursor, active });
  }

  @Get(":module/:id")
  get(@CurrentSession() se: Session, @Param("module") module: string, @Param("id") id: string) {
    return this.cfg.get(se, module, id);
  }

  @Post(":module") @HttpCode(201)
  create(@CurrentSession() se: Session, @Param("module") module: string, @Body() body: unknown) {
    return this.cfg.create(se, module, body);
  }

  @Patch(":module/:id")
  update(@CurrentSession() se: Session, @Param("module") module: string, @Param("id") id: string, @Body() body: unknown) {
    return this.cfg.update(se, module, id, body);
  }

  @Post(":module/:id/deactivate") @HttpCode(200)
  deactivate(@CurrentSession() se: Session, @Param("module") module: string, @Param("id") id: string, @Body() body: unknown) {
    return this.cfg.deactivate(se, module, id, body);
  }
}
