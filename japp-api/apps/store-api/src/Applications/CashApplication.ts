import { Inject, Injectable } from "@nestjs/common";
import { and, eq, or, sql } from "drizzle-orm";
import { schema as s, type Database, type Db, type Tx } from "@japp/db";
import type { Actor } from "@japp/domain";
import { DATABASE } from "../Constants/Injection.js";

type Q = Db | Tx;

/** Un apunte de caja: fondo, retiro, depósito o arqueo («count»). */
export interface CashMovementRow {
  id: string;
  storeId: string;
  periodId: string;
  stationId: string;
  kind: string;
  amount: number;
  reasonId?: string | null;
  note: string | null;
  countedDetail?: Record<string, number> | null;
  authorizedBy?: string | null;
}

/** Movimientos de caja (cash_movement) y motivos (reason). */
@Injectable()
export class CashApplication {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** Guarda el movimiento; tx es la transacción (fondo al abrir el periodo) o null (fuera de transacción). */
  async insertMovement(tx: Tx | null, m: CashMovementRow, a: Actor) {
    const q: Q = tx ?? this.database.db;
    // los campos sin dar (undefined) quedan con su valor por defecto, como antes
    await q.insert(s.cashMovement).values({
      id: m.id,
      storeId: m.storeId,
      periodId: m.periodId,
      stationId: m.stationId,
      kind: m.kind,
      amount: m.amount.toFixed(2),
      reasonId: m.reasonId,
      countedDetail: m.countedDetail,
      note: m.note,
      byUserId: a.userId,
      byUserName: a.user,
      byRole: a.role,
      byDevice: a.device,
      byAt: a.at,
      authorizedBy: m.authorizedBy,
    } as any);
  }

  /** Motivo por nombre o por id, o undefined. */
  async findReason(storeId: string, idOrName: string) {
    const [r] = await this.database.db
      .select()
      .from(s.reason)
      .where(
        and(
          eq(s.reason.storeId, storeId),
          or(eq(s.reason.name, idOrName), sql`${s.reason.id}::text = ${idOrName}`),
        ),
      );
    return r;
  }
}
