import type { Money } from "./money.js";

export type LineStatus = "pendingPrint" | "printed" | "preBill";
export type AccountStatus = "open" | "invoiced";
export type PaymentStatus = "pending" | "confirmed" | "declined" | "refunded" | "cancelled"; // = CHECK de payment.status
export type Origin = "tpv" | "pda" | "manager";

/** Quién hizo algo (columnas ACTOR en la base de datos). */
export interface Actor { userId?: string; user: string; role: string; device?: string; origin?: Origin; at: string; }

export interface Modifier { name: string; unitPrice: Money; quantity?: number; plu?: number; questionId?: string | null; course?: number | null; }

/** Pase de un menú (bebida, 1.º, 2.º, postre) y su estado. */
export type CourseState = "pending" | "ready" | "held" | "fired";
export interface LineCourse { course: number; questionId: string; question: string; state: CourseState; firedAt?: string | null; }

export interface Line {
  id: string; productId: number; name: string; quantity: number; unitPrice: Money; taxRate: number;
  comment: string; modifiers: Modifier[]; status: LineStatus; createdBy: Actor;
  /** Pases del menú; solo en productos con preguntas de pase (Ajustes › Preguntas › Pase). */
  courses?: LineCourse[];
}
export interface DeletedLine extends Line { reason: string; removedBy: Actor; authorizedBy: Actor | null; removedAt: string; }

export type DiscountType = "percentage" | "fixed";
export interface Discount { id: string; type: DiscountType; value: number; reason: string; status: "applied" | "removed"; }

export interface Payment {
  id: string; method: string; /** payment_method.id */ methodId?: string | null; kind: "cash" | "card" | "other"; amount: Money; tip: Money;
  cashGiven: Money | null; change: Money | null; status: PaymentStatus; collectedBy: Actor;
}

export interface CustomerData {
  id?: string; type?: "person" | "company"; name: string; taxId: string; email?: string;
  street?: string; postalCode?: string; city?: string; province?: string; country?: string;
}

export interface Invoice {
  type: "F1" | "F2"; series: string; sequence: number; invoiceNumber: string; issuedAt: string;
  total: Money; taxes: TaxBreakdown[]; customer: CustomerData | null; verifactuQr: string;
}

export interface Account {
  id: string; name: string; status: AccountStatus; lines: Line[]; deletedLines: DeletedLine[];
  discounts: Discount[]; payments: Payment[]; customerData: CustomerData | null; invoice: Invoice | null;
  parts?: number;
}

export interface Order { id: string; tableId: string; guests: number; version: number; accounts: Account[]; }

export interface TaxBreakdown { rate: number; base: Money; tax: Money; }
export interface Totals { sub: Money; disc: Money; total: Money; paid: Money; pending: Money; taxes: TaxBreakdown[]; }

export interface Product { plu: number; name: string; price: Money; terracePrice?: Money; taxRate: number; }
export interface Area { id: string; name: string; priceList: "general" | "terrace"; } // = CHECK de orders.price_list
