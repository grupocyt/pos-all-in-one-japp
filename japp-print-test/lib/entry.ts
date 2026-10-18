// Punto de entrada para empaquetar los tickets de japp-api (ver README).
export { invoiceTicket, preBillTicket, kitchenTicket, renderText, renderEscPos, WIDTH } from "../../japp-api/packages/domain/src/tickets.ts";
export { issueInvoice } from "../../japp-api/packages/domain/src/invoice.ts";
export { registerPayment } from "../../japp-api/packages/domain/src/payments.ts";
