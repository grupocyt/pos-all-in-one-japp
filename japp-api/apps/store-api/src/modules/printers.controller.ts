import { Body, Controller, Get, HttpCode, Inject, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { sql } from "drizzle-orm";
import type { Database } from "@japp/db";
import { fail, invoiceTicket, issueInvoice, kitchenTicket, preBillTicket, registerPayment, renderText, type Account, type Ctx, type Line, type TicketLine } from "@japp/domain";
import { CLOCK, DATABASE, type Clock } from "../common/tokens-di.js";
import { CurrentSession, type Session } from "../common/auth.js";
import { Authorization } from "../common/authorization.js";
import { parse } from "../common/validate.js";
import { StoreRepo } from "../repos/store.repo.js";
import { EscPosNetPrinter, parseConnection, pingPrinter } from "../ports/printer.js";

/**
 * Ajustes › Prueba de impresoras (antes japp-print-test, ahora dentro de la API): vista previa, probar conexión e imprimir
 * tickets de ejemplo por IP. Siempre manda a la impresora de verdad por TCP (aunque PRINTER_MODE sea «log»): es una prueba de hardware.
 */
const KINDS = ["test", "kitchen", "menu", "prebill", "invoice"] as const;
const Sample = z.object({
  kind: z.enum(KINDS).default("test"), table: z.string().max(20).default("12"), area: z.string().max(40).default("Terraza"), waiter: z.string().max(40).default("Prueba"),
  channel: z.string().max(40).default("COCINA"), guests: z.number().int().min(1).max(99).default(2),
});
const Conn = z.string().trim().min(3).max(120).refine(c => !!parseConnection(c), "Usa una IP, IP:puerto o tcp://IP:puerto");

@Controller("printers")
export class PrintersController {
  private readonly net = new EscPosNetPrinter();
  constructor(@Inject(DATABASE) private readonly database: Database, @Inject(StoreRepo) private readonly stores: StoreRepo,
    @Inject(Authorization) private readonly auth: Authorization, @Inject(CLOCK) private readonly clock: Clock) {}

  /** Tickets de ejemplo con el formato real (comanda, menú por pases, precuenta, factura) o la hoja de prueba de caracteres. */
  private async sample(b: z.infer<typeof Sample>, connection = ""): Promise<TicketLine[]> {
    const now = this.clock(), st = await this.stores.store();
    const actor = { user: b.waiter, role: "waiter" as const, device: "PRUEBA", origin: "tpv" as const, at: now.toISOString() };
    const ctx: Ctx = { now, newId: (() => { let i = 0; return () => `p-${++i}`; })(), actor };
    const line = (o: Partial<Line>): Line => ({ id: crypto.randomUUID(), productId: 0, name: "", quantity: 1, unitPrice: 0, taxRate: 10, comment: "", modifiers: [], status: "printed", createdBy: actor, ...o } as Line);
    const lines = () => [
      line({ productId: 1813, name: "Tosta de jamón ibérico y tumaca", unitPrice: 8.5 }),
      line({ productId: 1884, name: "Croquetas de boletus (media)", quantity: 2, unitPrice: 5.95, comment: "una sin gluten" }),
      line({ productId: 2018, name: "Bacardi", unitPrice: 10.5, modifiers: [{ name: "Kas limón", unitPrice: 0, quantity: 1 }] as any }),
      line({ productId: 2422, name: "Seven Up", quantity: 2, unitPrice: 3.4 }),
    ];
    const account = (ls: Line[]): Account => ({ id: "acc-1", name: "Cuenta 1", status: "open", lines: ls, deletedLines: [], discounts: [], payments: [], customerData: null, invoice: null } as Account);
    const tctx = { store: { legalName: st.issuerName, tradeName: st.name, taxId: st.nif, address: st.address ?? undefined, city: st.city ?? undefined, phone: st.phone ?? undefined, header: st.ticketHeader ?? undefined, footer: st.ticketFooter ?? undefined },
      table: { name: b.table, area: b.area }, waiter: b.waiter, guests: b.guests, at: now };
    if (b.kind === "kitchen") return kitchenTicket(lines().map(l => ({ quantity: l.quantity, name: l.name, comment: l.comment, modifiers: l.modifiers })), { channel: b.channel, waiter: b.waiter, guests: b.guests, table: tctx.table, at: now });
    if (b.kind === "menu") return kitchenTicket([{ quantity: 1, name: "Menú del día ciclo 1", comment: "", modifiers: [{ name: "Crema de puerro", unitPrice: 0, quantity: 1 }] as any, tag: "MARCHA 1.º", notes: ["2.º EN ESPERA: MERLUZA A LA ROMANA"] }],
      { channel: b.channel, waiter: b.waiter, guests: b.guests, table: tctx.table, at: now });
    if (b.kind === "prebill") return preBillTicket(account(lines().map(l => ({ ...l, status: "preBill" as const }))), tctx);
    if (b.kind === "invoice") {
      const acc = account(lines()), total = acc.lines.reduce((a, l) => a + l.unitPrice * l.quantity, 0);
      const paid = registerPayment(acc, { method: "cash", kind: "cash", amount: Math.round(total * 100) / 100, cashGiven: 50 } as any, ctx).account;
      return invoiceTicket(issueInvoice(paid, 1, { serieF: "PRUEBA-F", serieT: "PRUEBA-T", nif: st.nif }, ctx), { ...tctx, paymentNames: { cash: "Efectivo", card: "Tarjeta" } });
    }
    const T = (text: string, x: Record<string, unknown> = {}) => ({ k: "text", text, ...x }) as TicketLine;
    return [
      T("PRUEBA DE IMPRESORA", { align: "center", size: "wh", bold: true }), { k: "rule", ch: "=" } as TicketLine,
      T(`${connection || "?"}  ·  ${now.toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}`), T(`${st.code} · ${st.name}`),
      T("Acentos: áéíóú ÁÉÍÓÚ ü ñ Ñ ç ¿? ¡!"), T("Euro: 12,50 €   1.234,56 €"),
      T("Doble ancho", { size: "w" }), T("Doble alto", { size: "h" }), T("Doble ancho y alto", { size: "wh" }), T("Negrita", { bold: true }),
      T("Centrado", { align: "center" }), T("Derecha", { align: "right" }), { k: "rule", ch: "-" } as TicketLine,
      T("123456789012345678901234567890123456789012345678"), T("^ 48 columnas (papel de 80 mm)"),
      { k: "qr", data: "https://japp.grupocyt.com.es/" } as TicketLine, { k: "feed", n: 3 } as TicketLine, { k: "cut" } as TicketLine,
    ];
  }

  private async send(connection: string, ticket: TicketLine[], o: { copies: number; drawer: boolean; logo: boolean; title: string }) {
    const t0 = Date.now();
    for (let i = 0; i < o.copies; i++) {
      const r = await this.net.print({ kind: "test", channel: "PRUEBA", printer: connection, connection, title: o.title, ticket, openDrawer: o.drawer && i === 0, logoFromPrinter: o.logo });
      if (!r.ok) fail("PRINTER_OFFLINE", r.error ?? "La impresora no responde", { connection });
    }
    return { ok: true, copies: o.copies, ms: Date.now() - t0 };
  }

  @Post("preview") @HttpCode(200)
  async preview(@CurrentSession() se: Session, @Body() body: unknown) {
    await this.auth.require(se, "ajustes.impresoras");
    const b = parse(Sample.extend({ connection: z.string().max(120).optional() }), body);
    return { text: renderText(await this.sample(b, b.connection)) };
  }

  @Post("ping") @HttpCode(200)
  async ping(@CurrentSession() se: Session, @Body() body: unknown) {
    await this.auth.require(se, "ajustes.impresoras");
    const b = parse(z.object({ connection: Conn }), body);
    return pingPrinter(b.connection);
  }

  @Post("print") @HttpCode(200)
  async print(@CurrentSession() se: Session, @Body() body: unknown) {
    await this.auth.require(se, "ajustes.impresoras");
    const b = parse(Sample.extend({ connection: Conn, copies: z.number().int().min(1).max(5).default(1), drawer: z.boolean().default(false), logo: z.boolean().default(false) }), body);
    const ticket = await this.sample(b, b.connection);
    return { ...(await this.send(b.connection, ticket, { copies: b.copies, drawer: b.drawer, logo: b.logo, title: `Prueba ${b.kind}` })), text: renderText(ticket) };
  }

  /** Estado de todas las impresoras activas (conecta con cada una, sin imprimir). */
  @Get("status")
  async status(@CurrentSession() se: Session) {
    await this.auth.require(se, "ajustes.impresoras");
    const ps = (await this.database.db.execute(sql`SELECT id::text, name, connection, kind FROM printer WHERE store_id = ${se.storeId} AND active ORDER BY name`)).rows as any[];
    const res = await Promise.all(ps.map(async p => ({ id: p.id, name: p.name, connection: p.connection, kind: p.kind, ...(await pingPrinter(p.connection)) })));
    return { items: res };
  }

  /** Imprimir un ticket de ejemplo en una impresora dada de alta en Ajustes. */
  @Post(":printerId/test") @HttpCode(200)
  async test(@CurrentSession() se: Session, @Param("printerId") id: string, @Body() body: unknown) {
    await this.auth.require(se, "ajustes.impresoras");
    const b = parse(Sample.extend({ copies: z.number().int().min(1).max(5).default(1) }), body ?? {});
    const [p] = (await this.database.db.execute(sql`SELECT name, connection FROM printer WHERE store_id = ${se.storeId} AND id::text = ${id}`)).rows as any[];
    if (!p) fail("NOT_FOUND", "Esa impresora no existe", { printerId: id });
    return { printer: p.name, ...(await this.send(p.connection, await this.sample(b, p.connection), { copies: b.copies, drawer: false, logo: false, title: `Prueba ${p.name}` })) };
  }
}
