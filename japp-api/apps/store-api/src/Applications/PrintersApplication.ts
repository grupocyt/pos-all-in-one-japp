import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { schema as s, type Database, type Tx } from "@japp/db";
import { DATABASE } from "../Constants/Injection.js";

/** Ruta de comanda de un PLU: canal y la impresora por la que sale (la de la estación para el canal o la del canal). */
export interface KitchenRoute {
  plu: number;
  channel: string;
  printer_id: string | null;
  printer: string | null;
  connection: string | null;
}
/** Fila de order_line_printer pendiente de imprimir. */
export interface PendingLinePrinter {
  id: string;
  line_id: string;
  channel_name: string;
  printer_id: string | null;
  printer_name: string | null;
  interface: string | null;
}
export interface TicketPrinter {
  name: string;
  connection: string;
  channel: string;
}

/**
 * Impresoras: rutas de comanda (canales del producto, copias y impresora de la estación), order_line_printer
 * (qué línea va a qué impresora y si ya salió), impresora de tickets y la tabla printer.
 */
@Injectable()
export class PrintersApplication {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /**
   * Canales de comanda de cada producto + sus copias (doble zona); impresora = la de esta estación para el canal o la del canal.
   * Primero los canales propios y luego las copias, por nombre.
   */
  async kitchenRoutes(tx: Tx, storeId: string, stationId: string, plus: number[]): Promise<KitchenRoute[]> {
    const S = storeId;
    return (
      await tx.execute(sql`WITH base AS (
        SELECT p.plu, ch.id ch_id FROM product p JOIN product_channel pc ON pc.product_id = p.id AND pc.store_id = ${S}
          JOIN print_channel ch ON ch.id = pc.channel_id AND ch.active AND ch.store_id = ${S}
        WHERE p.store_id = ${S} AND p.plu = ANY(${"{" + plus.join(",") + "}"}::int[])
      ), todos AS (SELECT plu, ch_id FROM base UNION SELECT b.plu, c.id FROM base b JOIN print_channel c ON c.copy_of_id = b.ch_id AND c.active AND c.store_id = ${S})
      SELECT t.plu, ch.name channel, pr.id::text printer_id, pr.name printer, pr.connection FROM todos t JOIN print_channel ch ON ch.id = t.ch_id AND ch.store_id = ${S}
        LEFT JOIN station_channel_printer scp ON scp.channel_id = ch.id AND scp.station_id = ${stationId} AND scp.store_id = ${S}
        LEFT JOIN printer pr ON pr.id = coalesce(scp.printer_id, ch.printer_id) AND pr.store_id = ${S}
      ORDER BY ch.copy_of_id NULLS FIRST, ch.name`)
    ).rows as unknown as KitchenRoute[];
  }

  /** A qué impresora va una línea; printed_at con printed = false = intento en curso (otro envío no lo repite mientras dura). */
  async insertLinePrinter(
    tx: Tx,
    r: {
      id: string;
      storeId: string;
      lineId: string;
      channelName: string;
      printerId: string | null;
      printerName: string;
      interface: string | null;
      printedAt: string;
    },
  ) {
    await tx.insert(s.orderLinePrinter).values({
      id: r.id,
      storeId: r.storeId,
      lineId: r.lineId,
      channelName: r.channelName,
      printerId: r.printerId,
      printerName: r.printerName,
      interface: r.interface,
      printed: false,
      printedAt: r.printedAt,
    } as any);
  }

  /**
   * Filas de la orden que no salieron (impresora apagada) y que nadie está imprimiendo ahora
   * (sin intento o con el intento anterior a claimBefore). Las líneas eliminadas no se reimprimen.
   */
  async pendingLinePrinters(
    tx: Tx,
    storeId: string,
    orderId: string,
    claimBefore: Date,
  ): Promise<PendingLinePrinter[]> {
    const S = storeId;
    return (
      await tx.execute(sql`SELECT olp.id::text id, olp.line_id::text line_id, olp.channel_name, olp.printer_id::text printer_id, olp.printer_name, olp.interface
      FROM order_line_printer olp JOIN order_line ol ON ol.id = olp.line_id AND ol.store_id = ${S}
      WHERE olp.store_id = ${S} AND ol.order_id = ${orderId} AND NOT olp.printed AND NOT ol.deleted
        AND (olp.printed_at IS NULL OR olp.printed_at < ${claimBefore.toISOString()}::timestamptz)
      ORDER BY olp.channel_name, olp.printer_name`)
    ).rows as unknown as PendingLinePrinter[];
  }

  /**
   * Impresoras por las que YA salió algo (printed = true), una vez por impresora y canal: para la comanda de anulación de
   * esas líneas o para el aviso de cambio de mesa (25/10/2026). Por líneas, por cuenta o por la orden entera.
   */
  async printedPrinters(
    tx: Tx,
    storeId: string,
    f: { orderId?: string; accountId?: string | null; lineIds?: string[] },
  ): Promise<
    {
      channel_name: string;
      printer_id: string | null;
      printer_name: string | null;
      interface: string | null;
    }[]
  > {
    const S = storeId;
    const byLines = f.lineIds?.length
      ? sql` AND olp.line_id = ANY(${"{" + f.lineIds.join(",") + "}"}::uuid[])`
      : sql``;
    const byOrder = f.orderId ? sql` AND ol.order_id = ${f.orderId}` : sql``;
    const byAcc = f.accountId ? sql` AND ol.account_id = ${f.accountId}` : sql``;
    return (
      await tx.execute(sql`SELECT DISTINCT split_part(olp.channel_name, '|', 1) channel_name, olp.printer_id::text printer_id, olp.printer_name, olp.interface
      FROM order_line_printer olp JOIN order_line ol ON ol.id = olp.line_id AND ol.store_id = ${S}
      WHERE olp.store_id = ${S} AND olp.printed${byLines}${byOrder}${byAcc}
      ORDER BY 1, 3`)
    ).rows as unknown as {
      channel_name: string;
      printer_id: string | null;
      printer_name: string | null;
      interface: string | null;
    }[];
  }

  /** Reserva las filas para este intento (printed_at = ahora, sigue printed = false). */
  async claimLinePrinters(tx: Tx, storeId: string, ids: string[], at: Date) {
    await tx.execute(
      sql`UPDATE order_line_printer SET printed_at = ${at.toISOString()}::timestamptz WHERE store_id = ${storeId} AND id = ANY(${"{" + ids.join(",") + "}"}::uuid[])`,
    );
  }

  /**
   * Apunta, DESPUÉS del COMMIT y fuera de la transacción del comando, si las filas salieron por la impresora
   * (printed = true con printedAt) o no (printed = false y printedAt null: el siguiente envío las reintenta).
   */
  async markLinePrinters(storeId: string, ids: string[], ok: boolean, printedAt: string | null) {
    await this.database.db
      .execute(sql`UPDATE order_line_printer SET printed = ${ok}, printed_at = ${printedAt}::timestamptz
        WHERE store_id = ${storeId} AND id = ANY(${"{" + ids.join(",") + "}"}::uuid[])`);
  }

  /** Impresora del canal de tickets del ÁREA de la mesa de la orden (activos los dos); undefined si el área no tiene. */
  async areaTicketPrinter(tx: Tx, storeId: string, orderId: string): Promise<TicketPrinter | undefined> {
    const r = (
      await tx.execute(sql`SELECT ch.name channel, pr.name, pr.connection FROM orders o JOIN dining_table dt ON dt.id = o.table_id AND dt.store_id = o.store_id JOIN area a ON a.id = dt.area_id AND a.store_id = o.store_id
        JOIN print_channel ch ON ch.id = a.ticket_channel_id AND ch.active AND ch.store_id = o.store_id JOIN printer pr ON pr.id = ch.printer_id AND pr.active AND pr.store_id = o.store_id
        WHERE o.id = ${orderId} AND o.store_id = ${storeId}`)
    ).rows[0] as any;
    if (!r) {
      return undefined;
    }
    return { name: r.name, connection: r.connection, channel: r.channel };
  }

  /** Primera impresora activa de tipo «ticket» de la tienda. */
  async firstTicketPrinter(tx: Tx, storeId: string) {
    const [t] = await tx
      .select({ name: s.printer.name, connection: s.printer.connection })
      .from(s.printer)
      .where(and(eq(s.printer.storeId, storeId), eq(s.printer.kind, "ticket"), eq(s.printer.active, true)))
      .limit(1);
    return t;
  }

  /** Primera impresora asignada a la estación (station_channel_printer). */
  async firstStationPrinter(tx: Tx, storeId: string, stationId: string) {
    const [f] = await tx
      .select({ name: s.printer.name, connection: s.printer.connection })
      .from(s.stationChannelPrinter)
      .innerJoin(
        s.printer,
        and(eq(s.printer.id, s.stationChannelPrinter.printerId), eq(s.printer.storeId, storeId)),
      )
      .where(
        and(eq(s.stationChannelPrinter.storeId, storeId), eq(s.stationChannelPrinter.stationId, stationId)),
      )
      .limit(1);
    return f;
  }

  /** Si la estación abre el cajón al imprimir la factura. */
  async stationOpensDrawer(tx: Tx, storeId: string, stationId: string): Promise<boolean> {
    const [stn] = await tx
      .select({ opens: s.station.opensDrawer })
      .from(s.station)
      .where(and(eq(s.station.storeId, storeId), eq(s.station.id, stationId)));
    return !!stn?.opens;
  }

  /** Impresoras activas de la tienda, por nombre. */
  async listActive(
    storeId: string,
  ): Promise<{ id: string; name: string; connection: string; kind: string }[]> {
    return (
      await this.database.db.execute(
        sql`SELECT id::text, name, connection, kind FROM printer WHERE store_id = ${storeId} AND active ORDER BY name`,
      )
    ).rows as any[];
  }

  /** Impresora de Ajustes por id (comparando como texto: un id mal formado no es un error de la base); undefined si no existe. */
  async byId(storeId: string, id: string): Promise<{ name: string; connection: string } | undefined> {
    const [p] = (
      await this.database.db.execute(
        sql`SELECT name, connection FROM printer WHERE store_id = ${storeId} AND id::text = ${id}`,
      )
    ).rows as any[];
    return p;
  }
}
