import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, ilike, or } from "drizzle-orm";
import { schema as s, type Database } from "@japp/db";
import { DATABASE } from "../Constants/Injection.js";

/** Fichero de clientes (customer_ref) para la factura completa. */
@Injectable()
export class CustomersApplication {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /**
   * Clientes activos de la tienda cuyo NIF empieza por `q` o cuyo nombre lo contiene (sin distinguir mayúsculas),
   * por nombre, hasta `limit`. Los comodines de LIKE que traiga `q` se buscan como texto.
   */
  async search(storeId: string, q: string, limit: number) {
    const lit = q.replace(/[\\%_]/g, (c) => `\\${c}`);
    return this.database.db
      .select()
      .from(s.customerRef)
      .where(
        and(
          eq(s.customerRef.storeId, storeId),
          eq(s.customerRef.active, true),
          or(ilike(s.customerRef.taxId, `${lit}%`), ilike(s.customerRef.name, `%${lit}%`)),
        ),
      )
      .orderBy(asc(s.customerRef.name), asc(s.customerRef.taxId))
      .limit(limit);
  }
}
