import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { schema as s, type Database, type Tx } from "@japp/db";
import { DATABASE } from "../Constants/Injection.js";

/** Mesas (dining_table) con su área: plano y bloqueo de la mesa al abrir o transferir. */
@Injectable()
export class TablesApplication {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /**
   * Mesa con su área, bloqueada (FOR UPDATE solo sobre dining_table): así dos personas no abren
   * ni transfieren a la misma mesa a la vez. undefined si la mesa no es de la tienda.
   */
  async lockWithArea(tx: Tx, storeId: string, tableId: string) {
    const [t] = await tx
      .select({ t: s.diningTable, a: s.area })
      .from(s.diningTable)
      .innerJoin(s.area, eq(s.area.id, s.diningTable.areaId))
      .where(and(eq(s.diningTable.id, tableId), eq(s.diningTable.storeId, storeId)))
      .for("update", { of: s.diningTable });
    return t;
  }

  /** Mesas activas de la tienda con su área (opcionalmente de un área). */
  async listWithArea(storeId: string, areaId?: string) {
    return this.database.db
      .select({ t: s.diningTable, a: s.area })
      .from(s.diningTable)
      .innerJoin(s.area, eq(s.area.id, s.diningTable.areaId))
      .where(
        and(
          eq(s.diningTable.storeId, storeId),
          eq(s.diningTable.active, true),
          ...(areaId ? [eq(s.diningTable.areaId, areaId)] : []),
        ),
      );
  }
}
