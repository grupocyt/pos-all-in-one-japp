import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Post, Put } from "@nestjs/common";
import { CurrentSession, Public, type Session } from "../Helpers/AuthGuard.js";
import { parse } from "../Helpers/ValidationHelper.js";
import { AuthorizeModel, ChangePinModel, LoginModel } from "../Models/SessionsModels.js";
import { SessionsService } from "../Services/SessionsService.js";

/** Sesión del equipo (clave de 4 a 8 cifras) y autorización de encargado. */
@Controller("sessions")
export class SessionsController {
  constructor(@Inject(SessionsService) private readonly sessions: SessionsService) {}

  @Public()
  @Post()
  @HttpCode(201)
  async login(@Body() body: unknown, @Headers("x-station-id") stationHeader?: string) {
    const b = parse(LoginModel, body);
    return this.sessions.login(b, stationHeader);
  }

  /** Otro usuario con el permiso escribe su clave: autorización de un solo uso (2 min) para esa acción. */
  @Post("authorize")
  @HttpCode(201)
  async authorize(@Body() body: unknown, @CurrentSession() session: Session) {
    const b = parse(AuthorizeModel, body);
    return this.sessions.authorize(b, session);
  }

  @Get("current")
  async current(@CurrentSession() session: Session) {
    return this.sessions.current(session);
  }

  /** 1.2.272 · cambiar mi clave (la actual y la nueva); sin permiso de Ajustes. */
  @Put("current/pin")
  @HttpCode(200)
  async changePin(@Body() body: unknown, @CurrentSession() se: Session) {
    const b = parse(ChangePinModel, body);
    return this.sessions.changePin(se, b);
  }

  /** Salir: la sesión deja de valer (app_session.ended_reason = logout). */
  @Delete("current")
  @HttpCode(200)
  async logout(@CurrentSession() se: Session) {
    await this.sessions.logout(se);
  }
}
