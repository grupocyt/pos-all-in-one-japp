/** Códigos de error compartidos con la API (openapi.yaml › components › Error). */
export type ErrorCode =
  | "VALIDATION" | "NOT_FOUND" | "BAD_PIN" | "PIN_LOCKED" | "PERMISSION_REQUIRED" | "NOT_ALLOWED"
  | "VERSION_CONFLICT" | "DUPLICATE_SUSPECTED" | "ACCOUNT_CLOSED" | "ORDER_CLOSED" | "TABLE_BUSY"
  | "PERIOD_CLOSED" | "PENDING_NOT_ZERO" | "NOTHING_TO_CHARGE" | "COURSE_PENDING" | "ORDER_NOT_EMPTY" | "PRINTER_OFFLINE" | "IN_USE" | "DUPLICATE";

export const HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION: 422, NOT_FOUND: 404, BAD_PIN: 401, PIN_LOCKED: 423, PERMISSION_REQUIRED: 403, NOT_ALLOWED: 403,
  VERSION_CONFLICT: 409, DUPLICATE_SUSPECTED: 409, ACCOUNT_CLOSED: 409, ORDER_CLOSED: 409, TABLE_BUSY: 409,
  PERIOD_CLOSED: 409, PENDING_NOT_ZERO: 409, NOTHING_TO_CHARGE: 409, COURSE_PENDING: 409, ORDER_NOT_EMPTY: 409, PRINTER_OFFLINE: 503, IN_USE: 409, DUPLICATE: 409,
};

export class DomainError extends Error {
  constructor(public readonly code: ErrorCode, message: string, public readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = "DomainError";
  }
  get status() { return HTTP_STATUS[this.code]; }
}
export const fail = (code: ErrorCode, message: string, details?: Record<string, unknown>): never => {
  throw new DomainError(code, message, details);
};
