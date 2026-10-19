import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { schema as s, type Database } from "@japp/db";
import { DATABASE } from "../Constants/Injection.js";

/** Filtro de estado de Developer › Transacciones: abiertas (open + billing), cerradas o todas. */
const statusFilter = (status?: string): SQL[] => {
  if (status === "open") {
    return [inArray(s.orders.status, ["open", "billing"])];
  }
  if (status === "closed") {
    return [eq(s.orders.status, "closed")];
  }
  return [];
};

/** Lecturas de informes: eliminaciones y Developer › Transacciones. */
@Injectable()
export class ReportsApplication {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** Líneas eliminadas después de enviar (o en precuenta), con su mesa; las 500 últimas. */
  async deletedLines(storeId: string) {
    return this.database.db
      .select({ l: s.orderLine, table: s.orders.tableName })
      .from(s.orderLine)
      .innerJoin(s.orders, and(eq(s.orders.id, s.orderLine.orderId), eq(s.orders.storeId, storeId)))
      .where(
        and(
          eq(s.orderLine.storeId, storeId),
          eq(s.orderLine.deleted, true),
          or(eq(s.orderLine.printed, true), inArray(s.orderLine.deletedStage, ["printed", "preBill"])),
        ),
      )
      .orderBy(desc(s.orderLine.deletedByAt))
      .limit(500);
  }

  /** Modificadores (precio y cantidad) de esas líneas. */
  async lineModifiers(storeId: string, lineIds: string[]) {
    if (!lineIds.length) {
      return [];
    }
    return this.database.db
      .select({
        lineId: s.orderLineModifier.lineId,
        unitPrice: s.orderLineModifier.unitPrice,
        quantity: s.orderLineModifier.quantity,
      })
      .from(s.orderLineModifier)
      .where(and(eq(s.orderLineModifier.storeId, storeId), inArray(s.orderLineModifier.lineId, lineIds)));
  }

  /** Developer › Transacciones: las 300 últimas órdenes con su total (sin cuentas anuladas). */
  async orders(storeId: string, status?: string, q?: string) {
    const conds: SQL[] = [eq(s.orders.storeId, storeId), ...statusFilter(status)];
    if (q) {
      conds.push(
        or(
          ilike(s.orders.tableName, `%${q}%`),
          ilike(s.orders.zone, `%${q}%`),
          sql`${s.orders.id}::text ilike ${"%" + q + "%"}`,
        )!,
      );
    }
    return this.database.db
      .select({
        o: s.orders,
        total: sql<string>`coalesce((select sum(a.total) from account a where a.order_id = "orders"."id" and a.status <> 'cancelled'), 0)`,
      })
      .from(s.orders)
      .where(and(...conds))
      .orderBy(desc(s.orders.openedByAt))
      .limit(300);
  }
}
