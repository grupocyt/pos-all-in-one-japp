import { Inject, Injectable } from "@nestjs/common";
import { D, fail, sirEnvelope, sirSales, type SirItem } from "@japp/domain";
import { postSirSoap } from "../Clases/SirClient.js";
import { CLOCK, type Clock } from "../Constants/Injection.js";
import type { Session } from "../Helpers/AuthGuard.js";
import { parse } from "../Helpers/ValidationHelper.js";
import { PeriodQueryModel, SirSendModel } from "../Models/ReportsModels.js";
import { SirApplication } from "../Applications/SirApplication.js";
import { AuthorizationService } from "./AuthorizationService.js";
import { ClosingsService } from "./ClosingsService.js";

/**
 * Interfaz de ventas al SIR (antes MaxPoint interface.USP_InterfaceSistemaGerente) para un periodo: el último cerrado
 * si no viene periodId. De momento solo se consulta (pruebas del fin de periodo); el envío al SIR va aparte.
 */
@Injectable()
export class SirService {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuthorizationService) private readonly auth: AuthorizationService,
    @Inject(ClosingsService) private readonly closings: ClosingsService,
    @Inject(SirApplication) private readonly sir: SirApplication,
  ) {}

  async sales(se: Session, periodId?: string) {
    await this.auth.require(se, "funciones.periodo");
    const q = parse(PeriodQueryModel, { periodId: periodId || undefined });
    const p = await this.sir.period(se.storeId, q.periodId);
    if (!p) {
      fail(
        q.periodId ? "NOT_FOUND" : "PERIOD_CLOSED",
        q.periodId ? "Ese periodo no existe" : "Aún no hay ningún periodo cerrado",
        {
          periodId: q.periodId ?? null,
        },
      );
    }
    const from = new Date(p!.opened_at);
    const to = p!.closed_at ? new Date(p!.closed_at) : this.clock();
    const [store, sum, invoices, payments, lines, sessions, discountCode] = await Promise.all([
      this.sir.store(se.storeId),
      this.closings.summarize(null, se.storeId, p!.id),
      this.sir.invoices(se.storeId, p!.id),
      this.sir.payments(se.storeId, p!.id),
      this.sir.lines(se.storeId, p!.id),
      this.sir.sessions(se.storeId, from, to),
      this.sir.discountCode(se.storeId),
    ]);
    // cada línea: el producto y sus respuestas, menos lo abonado y con la parte del descuento de la cuenta
    const items: SirItem[] = [];
    for (const l of lines) {
      const q0 = Number(l.quantity);
      const left = Math.max(0, q0 - Number(l.credited || 0));
      if (left <= 0) {
        continue;
      }
      const f = Number(l.factor) || 1;
      const add = (plu: number | null, qty: number, gross: number, rate: number) => {
        if (plu) {
          items.push({
            plu: Number(plu),
            quantity: qty,
            gross,
            grossAfterDiscount: Number(D(gross).times(f)),
            taxRate: rate,
          });
        }
      };
      add(l.plu, left, Number(D(l.unit_price).times(left)), Number(l.tax_rate));
      for (const m of l.mods ?? []) {
        const mq = Number(D(m.quantity ?? 1).times(left));
        add(m.plu, mq, Number(D(m.unit_price).times(mq)), Number(l.tax_rate));
      }
    }
    const out = sirSales({
      storeCode: store?.rst ?? store?.code ?? "",
      // Ajustes › Formas de pago: la de tipo «descuento» (su id de integración); si no hay, SIR_DISCOUNT_CODE o 63
      discountCode: discountCode ?? (process.env.SIR_DISCOUNT_CODE || "63"),
      businessDate: sum.businessDate,
      guests: sum.guests,
      invoices: invoices.map((i) => ({
        id: i.id,
        type: i.type,
        total: Number(i.total),
        taxBase: Number(i.tax_base),
        taxTotal: Number(i.tax_total),
        zeroBase: Number(i.zero_base),
        discount: Number(i.discount),
        issuedAt: new Date(i.issued_at),
        issuedBy: i.issued_by,
      })),
      payments: payments.map((x) => ({ user: x.user, method: String(x.method), amount: Number(x.amount) })),
      items,
      sessions: sessions
        .map((s) => ({ userId: s.user_id, user: s.user, start: new Date(s.start), end: new Date(s.end) }))
        .filter((s) => s.end > s.start),
    });
    return {
      periodId: p!.id,
      periodStatus: p!.status,
      sirUrl: store?.sir_url ?? null,
      ...out,
      soap: sirEnvelope(out),
    };
  }

  /** Enviar al SIR (Developer, al cerrar el periodo): el mismo sobre que se consulta, a Ajustes › Restaurante › URL del SIR. */
  async send(se: Session, body: unknown) {
    const b = parse(SirSendModel, body ?? {});
    const r = await this.sales(se, b.periodId ?? undefined);
    if (!r.sirUrl) {
      fail("VALIDATION", "Falta la URL de la interfaz del SIR (Ajustes › Restaurante)", { field: "sirUrl" });
    }
    const res = await postSirSoap(r.sirUrl!, r.soap);
    return { periodId: r.periodId, url: r.sirUrl, request: r.soap, ...res };
  }
}
