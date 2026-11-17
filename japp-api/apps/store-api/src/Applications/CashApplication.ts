import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, or, sql } from "drizzle-orm";
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
  /** 0033 · arqueo: lo que marcó cada datáfono y la suma */
  cardDetail?: { name: string; amount: number }[] | null;
  countedCard?: number | null;
  /** 0037 · conteos */
  countType?: "arqueo" | "apertura" | "cortex" | "auditoria" | null;
  expectedCash?: number | null;
  expectedCard?: number | null;
  cashTips?: number | null;
  cardTips?: number | null;
  tipsConfirmed?: boolean | null;
  difference?: number | null;
}
const n2 = (v: number | null | undefined) => (v == null ? null : v.toFixed(2));

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
      cardDetail: m.cardDetail ?? null,
      countedCard: m.countedCard == null ? null : m.countedCard.toFixed(2),
      countType: m.countType ?? (m.kind === "count" ? "arqueo" : null),
      expectedCash: n2(m.expectedCash),
      expectedCard: n2(m.expectedCard),
      cashTips: n2(m.cashTips),
      cardTips: n2(m.cardTips),
      tipsConfirmed: m.tipsConfirmed ?? null,
      difference: n2(m.difference),
      note: m.note,
      byUserId: a.userId,
      byUserName: a.user,
      byRole: a.role,
      byDevice: a.device,
      byAt: a.at,
      authorizedBy: m.authorizedBy,
    } as any);
  }

  /** 11/11 (D2) · un arqueo («count») del periodo, para reimprimir su resumen. */
  async countById(storeId: string, id: string) {
    const [r] = await this.database.db
      .select()
      .from(s.cashMovement)
      .where(
        and(eq(s.cashMovement.storeId, storeId), eq(s.cashMovement.id, id), eq(s.cashMovement.kind, "count")),
      );
    return r ?? null;
  }

  /** 0037 · movimientos de caja de un periodo, del más nuevo al más viejo. */
  async movements(storeId: string, periodId: string) {
    return this.database.db
      .select()
      .from(s.cashMovement)
      .where(and(eq(s.cashMovement.storeId, storeId), eq(s.cashMovement.periodId, periodId)))
      .orderBy(desc(s.cashMovement.byAt));
  }

  /** 0037 · caja chica: todos los apuntes (para el saldo) y los últimos para enseñar. */
  async pettyMoves(storeId: string, q: Q = this.database.db) {
    return q
      .select()
      .from(s.pettyCashMovement)
      .where(eq(s.pettyCashMovement.storeId, storeId))
      .orderBy(desc(s.pettyCashMovement.byAt), desc(s.pettyCashMovement.createdAt));
  }
  async insertPetty(tx: Tx, r: Record<string, unknown>) {
    await tx.insert(s.pettyCashMovement).values(r as any);
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
