import { Body, Controller, Get, HttpCode, Inject, Post } from "@nestjs/common";
import { Public } from "../Helpers/AuthGuard.js";
import { parse } from "../Helpers/ValidationHelper.js";
import { RegisterDeviceModel } from "../Models/SystemModels.js";
import { SystemService } from "../Services/SystemService.js";

@Controller()
export class SystemController {
  constructor(@Inject(SystemService) private readonly system: SystemService) {}

  /** Latido: lo mismo que se envía al Manager. */
  @Public()
  @Get("health")
  async health() {
    return this.system.health();
  }

  /** Primer arranque del equipo: se le asigna estación (CAJA1, PDA1…) por su UUID. */
  @Public()
  @Post("devices/register")
  @HttpCode(201)
  async register(@Body() body: unknown) {
    const b = parse(RegisterDeviceModel, body);
    return this.system.register(b);
  }
}
