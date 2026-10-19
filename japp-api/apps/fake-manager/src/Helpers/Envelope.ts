import { randomUUID } from "node:crypto";

export const AUTHOR = "Japp Manager de pruebas";

export interface ErrorItem {
  code: string;
  message: string;
  field: string | null;
  details: unknown;
}

export interface Envelope<T = unknown> {
  title: string;
  type: "success" | "error";
  status: number;
  data: T | null;
  errors: ErrorItem[];
  traceId: string;
  author: string;
  mode: "developer" | "production";
}

/** Respuesta correcta con el formato común de la API (mismo sobre que store-api). */
export function ok<T>(title: string, data: T, status = 200): Envelope<T> {
  return {
    title,
    type: "success",
    status,
    data,
    errors: [],
    traceId: randomUUID(),
    author: AUTHOR,
    mode: "developer",
  };
}

/** Respuesta de error con el formato común: data null y un elemento en errors. */
export function fail(
  title: string,
  status: number,
  code: string,
  message: string,
  details: unknown = null,
): Envelope {
  return {
    title,
    type: "error",
    status,
    data: null,
    errors: [{ code, message, field: null, details }],
    traceId: randomUUID(),
    author: AUTHOR,
    mode: "developer",
  };
}
