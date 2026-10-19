import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";
import { schema as s, type Database, type Tx } from "@japp/db";
import { DATABASE } from "../Constants/Injection.js";

type Row = Record<string, any>;

/** Estaciones y el UUID del equipo asignado a cada una; configuración de la estación de un equipo. */
@Injectable()
export class DevicesApplication {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async activeStations(storeId: string) {
    return this.database.db
      .select()
      .from(s.station)
      .where(and(eq(s.station.storeId, storeId), eq(s.station.active, true)));
  }

  /** Deja la estación ligada a ese equipo. */
  async assignDevice(storeId: string, stationId: string, deviceUuid: string) {
    await this.database.db
      .update(s.station)
      .set({ deviceUuid } as any)
      .where(and(eq(s.station.storeId, storeId), eq(s.station.id, stationId)));
  }

  /** Todas las estaciones de la tienda bloqueadas (FOR UPDATE, por id): dos equipos a la vez no se pisan el UUID. */
  async lockStations(tx: Tx, storeId: string) {
    return tx
      .select()
      .from(s.station)
      .where(eq(s.station.storeId, storeId))
      .orderBy(asc(s.station.id))
      .for("update");
  }

  /** Cambia el UUID del equipo de una estación (null = sin equipo) y sube la versión del registro; devuelve la fila nueva. */
  async setDeviceUuid(tx: Tx, storeId: string, stationId: string, deviceUuid: string | null) {
    const [r] = await tx
      .update(s.station)
      .set({ deviceUuid, version: sql`${s.station.version} + 1`, updatedAt: sql`now()` } as any)
      .where(and(eq(s.station.storeId, storeId), eq(s.station.id, stationId)))
      .returning();
    return r!;
  }

  /** La estación (activa o no) por id. */
  async station(storeId: string, stationId: string) {
    const [r] = await this.database.db
      .select()
      .from(s.station)
      .where(and(eq(s.station.storeId, storeId), eq(s.station.id, stationId)));
    return r;
  }

  /** Formas de pago de la tienda (código, tipo y si está activa), por nombre. */
  async paymentMethods(storeId: string) {
    return this.database.db
      .select({
        id: s.paymentMethod.id,
        code: s.paymentMethod.code,
        kind: s.paymentMethod.kind,
        active: s.paymentMethod.active,
      })
      .from(s.paymentMethod)
      .where(eq(s.paymentMethod.storeId, storeId))
      .orderBy(asc(s.paymentMethod.name));
  }

  /** Ids de las formas de pago configuradas en la estación (vacío = ninguna configurada). */
  async stationPaymentMethodIds(storeId: string, stationId: string): Promise<string[]> {
    const rows = await this.database.db
      .select({ id: s.stationPaymentMethod.paymentMethodId })
      .from(s.stationPaymentMethod)
      .where(
        and(eq(s.stationPaymentMethod.storeId, storeId), eq(s.stationPaymentMethod.stationId, stationId)),
      );
    return rows.map((r) => r.id);
  }

  /** Ids de los descuentos activos configurados en la estación. */
  async stationDiscountIds(storeId: string, stationId: string): Promise<string[]> {
    const rows = (
      await this.database.db.execute(
        sql`SELECT d.id::text id FROM station_discount sd JOIN discount d ON d.id = sd.discount_id AND d.store_id = sd.store_id
          WHERE sd.store_id = ${storeId} AND sd.station_id = ${stationId} AND d.active ORDER BY d.name`,
      )
    ).rows as Row[];
    return rows.map((r) => r.id as string);
  }

  /**
   * Por qué impresora sale cada canal activo en esta estación: la de la estación para ese canal
   * (station_channel_printer) o la del canal. Los canales sin impresora no salen.
   */
  async stationChannels(
    storeId: string,
    stationId: string,
  ): Promise<{ channel: string; printer: string; connection: string }[]> {
    return (
      await this.database.db.execute(
        sql`SELECT ch.name channel, pr.name printer, pr.connection FROM print_channel ch
          LEFT JOIN station_channel_printer scp ON scp.channel_id = ch.id AND scp.station_id = ${stationId} AND scp.store_id = ${storeId}
          JOIN printer pr ON pr.id = coalesce(scp.printer_id, ch.printer_id) AND pr.store_id = ${storeId} AND pr.active
          WHERE ch.store_id = ${storeId} AND ch.active ORDER BY ch.name`,
      )
    ).rows as { channel: string; printer: string; connection: string }[];
  }
}
