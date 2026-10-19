import { Body, Controller, Get, HttpCode, Inject, Post } from "@nestjs/common";
import { CurrentSession, Public, type Session } from "../Helpers/AuthGuard.js";
import { parse } from "../Helpers/ValidationHelper.js";
import { ClaimMainModel, IdentifyDeviceModel } from "../Models/DevicesModels.js";
import { DevicesService } from "../Services/DevicesService.js";

/** Equipo: reconocerlo por su UUID, configurarlo como caja principal y la configuración de su estación. */
@Controller()
export class DevicesController {
  constructor(@Inject(DevicesService) private readonly devices: DevicesService) {}

  /** Primer arranque: qué estación es este equipo (sin sesión). */
  @Public()
  @Post("devices/identify")
  @HttpCode(200)
  async identify(@Body() body: unknown) {
    const b = parse(IdentifyDeviceModel, body);
    return this.devices.identify(b);
  }

  /** Este equipo pasa a ser la caja principal, con la clave de un administrador (sin sesión). */
  @Public()
  @Post("devices/claim-main")
  @HttpCode(200)
  async claimMain(@Body() body: unknown) {
    const b = parse(ClaimMainModel, body);
    return this.devices.claimMain(b);
  }

  /** Configuración de la estación de la sesión. */
  @Get("devices/me")
  async me(@CurrentSession() se: Session) {
    return this.devices.me(se);
  }
}
