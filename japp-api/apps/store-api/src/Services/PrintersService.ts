import { Inject, Injectable } from "@nestjs/common";
import {
  fail,
  invoiceTicket,
  issueInvoice,
  kitchenTicket,
  preBillTicket,
  registerPayment,
  renderText,
  type Account,
  type Ctx,
  type Line,
  type TicketLine,
} from "@japp/domain";
import { CLOCK, type Clock } from "../Constants/Injection.js";
import type { Session } from "../Helpers/AuthGuard.js";
import { AuthorizationService } from "./AuthorizationService.js";
import { parse } from "../Helpers/ValidationHelper.js";
import { StoreApplication } from "../Applications/StoreApplication.js";
import { PrintersApplication } from "../Applications/PrintersApplication.js";
import { EscPosNetPrinter, pingPrinter } from "../Clases/Printers.js";
import {
  PingPrinter,
  PreviewPrinter,
  PrintSample,
  TestPrinter,
  type SampleInput,
} from "../Models/PrintersModels.js";

/**
 * Ajustes › Prueba de impresoras (antes japp-print-test, ahora dentro de la API): vista previa, probar conexión e imprimir
 * tickets de ejemplo por IP. Siempre manda a la impresora de verdad por TCP (aunque PRINTER_MODE sea «log»): es una prueba de hardware.
 * El permiso (ajustes.impresoras) se comprueba ANTES de validar el cuerpo, como siempre: sin permiso es 403 aunque el cuerpo esté mal.
 */
@Injectable()
export class PrintersService {
  private readonly net = new EscPosNetPrinter();
  constructor(
    @Inject(StoreApplication) private readonly stores: StoreApplication,
    @Inject(PrintersApplication) private readonly printers: PrintersApplication,
    @Inject(AuthorizationService) private readonly auth: AuthorizationService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Tickets de ejemplo con el formato real (comanda, menú por pases, precuenta, factura) o la hoja de prueba de caracteres. */
  private async sample(b: SampleInput, connection = ""): Promise<TicketLine[]> {
    const now = this.clock();
    const st = await this.stores.store();
    const actor = {
      user: b.waiter,
      role: "waiter" as const,
      device: "PRUEBA",
      origin: "tpv" as const,
      at: now.toISOString(),
    };
    const ctx: Ctx = {
      now,
      newId: (() => {
        let i = 0;
        return () => `p-${++i}`;
      })(),
      actor,
    };
    const line = (o: Partial<Line>): Line =>
      ({
        id: crypto.randomUUID(),
        productId: 0,
        name: "",
        quantity: 1,
        unitPrice: 0,
        taxRate: 10,
        comment: "",
        modifiers: [],
        status: "printed",
        createdBy: actor,
        ...o,
      }) as Line;
    const lines = () => [
      line({ productId: 1813, name: "Tosta de jamón ibérico y tumaca", unitPrice: 8.5 }),
      line({
        productId: 1884,
        name: "Croquetas de boletus (media)",
        quantity: 2,
        unitPrice: 5.95,
        comment: "una sin gluten",
      }),
      line({
        productId: 2018,
        name: "Bacardi",
        unitPrice: 10.5,
        modifiers: [{ name: "Kas limón", unitPrice: 0, quantity: 1 }] as any,
      }),
      line({ productId: 2422, name: "Seven Up", quantity: 2, unitPrice: 3.4 }),
    ];
    const account = (ls: Line[]): Account =>
      ({
        id: "acc-1",
        name: "Cuenta 1",
        status: "open",
        lines: ls,
        deletedLines: [],
        discounts: [],
        payments: [],
        customerData: null,
        invoice: null,
      }) as Account;
    const tctx = {
      store: {
        legalName: st.issuerName,
        tradeName: st.name,
        taxId: st.nif,
        address: st.address ?? undefined,
        city: st.city ?? undefined,
        phone: st.phone ?? undefined,
        header: st.ticketHeader ?? undefined,
        footer: st.ticketFooter ?? undefined,
      },
      table: { name: b.table, area: b.area },
      waiter: b.waiter,
      guests: b.guests,
      at: now,
    };
    if (b.kind === "kitchen") {
      return kitchenTicket(
        lines().map((l) => ({
          quantity: l.quantity,
          name: l.name,
          comment: l.comment,
          modifiers: l.modifiers,
        })),
        { channel: b.channel, waiter: b.waiter, guests: b.guests, table: tctx.table, at: now },
      );
    }
    if (b.kind === "menu") {
      return kitchenTicket(
        [
          {
            quantity: 1,
            name: "Menú del día ciclo 1",
            comment: "",
            modifiers: [{ name: "Crema de puerro", unitPrice: 0, quantity: 1 }] as any,
            tag: "MARCHA 1.º",
            notes: ["2.º EN ESPERA: MERLUZA A LA ROMANA"],
          },
        ],
        { channel: b.channel, waiter: b.waiter, guests: b.guests, table: tctx.table, at: now },
      );
    }
    if (b.kind === "prebill") {
      return preBillTicket(account(lines().map((l) => ({ ...l, status: "preBill" as const }))), tctx);
    }
    if (b.kind === "invoice") {
      const acc = account(lines());
      const total = acc.lines.reduce((a, l) => a + l.unitPrice * l.quantity, 0);
      const paid = registerPayment(
        acc,
        { method: "cash", kind: "cash", amount: Math.round(total * 100) / 100, cashGiven: 50 } as any,
        ctx,
      ).account;
      return invoiceTicket(
        issueInvoice(paid, 1, { serieF: "PRUEBA-F", serieT: "PRUEBA-T", nif: st.nif }, ctx),
        { ...tctx, paymentNames: { cash: "Efectivo", card: "Tarjeta" } },
      );
    }
    const T = (text: string, x: Record<string, unknown> = {}) => ({ k: "text", text, ...x }) as TicketLine;
    return [
      T("PRUEBA DE IMPRESORA", { align: "center", size: "wh", bold: true }),
      { k: "rule", ch: "=" } as TicketLine,
      T(`${connection || "?"}  ·  ${now.toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}`),
      T(`${st.code} · ${st.name}`),
      T("Acentos: áéíóú ÁÉÍÓÚ ü ñ Ñ ç ¿? ¡!"),
      T("Euro: 12,50 €   1.234,56 €"),
      T("Doble ancho", { size: "w" }),
      T("Doble alto", { size: "h" }),
      T("Doble ancho y alto", { size: "wh" }),
      T("Negrita", { bold: true }),
      T("Centrado", { align: "center" }),
      T("Derecha", { align: "right" }),
      { k: "rule", ch: "-" } as TicketLine,
      T("123456789012345678901234567890123456789012345678"),
      T("^ 48 columnas (papel de 80 mm)"),
      { k: "qr", data: "https://japp.grupocyt.com.es/" } as TicketLine,
      { k: "feed", n: 3 } as TicketLine,
      { k: "cut" } as TicketLine,
    ];
  }

  private async send(
    connection: string,
    ticket: TicketLine[],
    o: { copies: number; drawer: boolean; logo: boolean; title: string },
  ) {
    const t0 = Date.now();
    for (let i = 0; i < o.copies; i++) {
      const r = await this.net.print({
        kind: "test",
        channel: "PRUEBA",
        printer: connection,
        connection,
        title: o.title,
        ticket,
        openDrawer: o.drawer && i === 0,
        logoFromPrinter: o.logo,
      });
      if (!r.ok) {
        fail("PRINTER_OFFLINE", r.error ?? "La impresora no responde", { connection });
      }
    }
    return { ok: true, copies: o.copies, ms: Date.now() - t0 };
  }

  async preview(se: Session, body: unknown) {
    await this.auth.require(se, "ajustes.impresoras");
    const b = parse(PreviewPrinter, body);
    return { text: renderText(await this.sample(b, b.connection)) };
  }

  async ping(se: Session, body: unknown) {
    await this.auth.require(se, "ajustes.impresoras");
    const b = parse(PingPrinter, body);
    return pingPrinter(b.connection);
  }

  async print(se: Session, body: unknown) {
    await this.auth.require(se, "ajustes.impresoras");
    const b = parse(PrintSample, body);
    const ticket = await this.sample(b, b.connection);
    return {
      ...(await this.send(b.connection, ticket, {
        copies: b.copies,
        drawer: b.drawer,
        logo: b.logo,
        title: `Prueba ${b.kind}`,
      })),
      text: renderText(ticket),
    };
  }

  /** Estado de todas las impresoras activas (conecta con cada una, sin imprimir). */
  async status(se: Session) {
    await this.auth.require(se, "ajustes.impresoras");
    const ps = await this.printers.listActive(se.storeId);
    const res = await Promise.all(
      ps.map(async (p) => ({
        id: p.id,
        name: p.name,
        connection: p.connection,
        kind: p.kind,
        ...(await pingPrinter(p.connection)),
      })),
    );
    return { items: res };
  }

  /** Imprimir un ticket de ejemplo en una impresora dada de alta en Ajustes. */
  async test(se: Session, id: string, body: unknown) {
    await this.auth.require(se, "ajustes.impresoras");
    const b = parse(TestPrinter, body ?? {});
    const p = await this.printers.byId(se.storeId, id);
    if (!p) {
      fail("NOT_FOUND", "Esa impresora no existe", { printerId: id });
    }
    return {
      printer: p!.name,
      ...(await this.send(p!.connection, await this.sample(b, p!.connection), {
        copies: b.copies,
        drawer: false,
        logo: false,
        title: `Prueba ${p!.name}`,
      })),
    };
  }
}
