import { Controller, Get, Inject } from "@nestjs/common";
import { Public } from "../Helpers/AuthGuard.js";
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
}
