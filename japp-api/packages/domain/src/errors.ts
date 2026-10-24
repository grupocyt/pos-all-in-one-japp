/** Códigos de error compartidos con la API (openapi.yaml › components › Error). */
export type ErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "BAD_PIN"
  | "PIN_LOCKED"
  | "PERMISSION_REQUIRED"
  | "NOT_ALLOWED"
  | "VERSION_CONFLICT"
  | "DUPLICATE_SUSPECTED"
  | "ACCOUNT_CLOSED"
  | "ORDER_CLOSED"
  | "TABLE_BUSY"
  | "PERIOD_CLOSED"
  | "PENDING_NOT_ZERO"
  | "NOTHING_TO_CHARGE"
  | "COURSE_PENDING"
  | "ORDER_NOT_EMPTY"
  | "PRINTER_OFFLINE"
  | "IN_USE"
  | "DUPLICATE"
  | "STATION_NOT_ALLOWED"
  | "MAIN_STATION_REQUIRED"
  | "PERIOD_ALREADY_OPEN"
  | "INCIDENT_RESOLVED"
  | "TABLE_TAKEN"
  | "TABLE_CHARGING"
  | "TOTAL_BELOW_PAID"
  | "AMOUNT_EXCEEDS_PENDING"
  | "METHOD_NOT_ALLOWED"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "SESSION_REPLACED"
  | "NOTHING_TO_TRANSFER"
  | "DEVICE_NOT_REGISTERED"
  | "DEVICE_TYPE_MISMATCH"
  | "OOT_TOKEN_INVALID"
  | "OOT_NOT_CONFIGURED"
  | "PRODUCT_NOT_OOT"
  | "REF_NOT_FOUND"
  | "TOO_LARGE"
  | "LINE_NOT_SENT"
  | "QUANTITY_EXCEEDS"
  | "BUSY_RETRY";

export const HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION: 422,
  NOT_FOUND: 404,
  BAD_PIN: 401,
  PIN_LOCKED: 423,
  PERMISSION_REQUIRED: 403,
  NOT_ALLOWED: 403,
  VERSION_CONFLICT: 409,
  DUPLICATE_SUSPECTED: 409,
  ACCOUNT_CLOSED: 409,
  ORDER_CLOSED: 409,
  TABLE_BUSY: 409,
  PERIOD_CLOSED: 409,
  PENDING_NOT_ZERO: 409,
  NOTHING_TO_CHARGE: 409,
  COURSE_PENDING: 409,
  ORDER_NOT_EMPTY: 409,
  PRINTER_OFFLINE: 503,
  IN_USE: 409,
  DUPLICATE: 409,
  STATION_NOT_ALLOWED: 403,
  MAIN_STATION_REQUIRED: 403,
  PERIOD_ALREADY_OPEN: 409,
  INCIDENT_RESOLVED: 409,
  TABLE_TAKEN: 409,
  TABLE_CHARGING: 409,
  TOTAL_BELOW_PAID: 409,
  AMOUNT_EXCEEDS_PENDING: 409,
  METHOD_NOT_ALLOWED: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  SESSION_REPLACED: 401,
  NOTHING_TO_TRANSFER: 422,
  DEVICE_NOT_REGISTERED: 404,
  DEVICE_TYPE_MISMATCH: 409,
  OOT_TOKEN_INVALID: 404,
  OOT_NOT_CONFIGURED: 409,
  PRODUCT_NOT_OOT: 422,
  REF_NOT_FOUND: 422,
  TOO_LARGE: 413,
  LINE_NOT_SENT: 409,
  QUANTITY_EXCEEDS: 422,
  // la base canceló la transacción por un interbloqueo (40P01) o un fallo de serialización (40001): nada quedó a medias
  BUSY_RETRY: 409,
};

export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "DomainError";
  }
  get status() {
    return HTTP_STATUS[this.code];
  }
}
export const fail = (code: ErrorCode, message: string, details?: Record<string, unknown>): never => {
  throw new DomainError(code, message, details);
};
