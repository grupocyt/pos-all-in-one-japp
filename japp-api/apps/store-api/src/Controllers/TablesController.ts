import { Controller, Get, Inject, Query } from "@nestjs/common";
import { parse } from "../Helpers/ValidationHelper.js";
import { CurrentSession, type Session } from "../Helpers/AuthGuard.js";
import { TablesService } from "../Services/TablesService.js";
import { AreaId } from "../Models/TablesModels.js";

/** Plano: cada mesa con su estado (libre, mía, de otro, precuenta, dividida) y lo pendiente. */
@Controller("tables")
export class TablesController {
  constructor(@Inject(TablesService) private readonly svc: TablesService) {}

  @Get()
  async list(@CurrentSession() session: Session, @Query("areaId") rawArea?: string) {
    const areaId = rawArea ? parse(AreaId, rawArea) : undefined;
    return this.svc.list(session, areaId);
  }
}
