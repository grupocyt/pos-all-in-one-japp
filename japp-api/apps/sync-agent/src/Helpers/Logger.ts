import pino, { type Logger } from "pino";

export type { Logger };

/**
 * Logs en JSON (pino). Nunca se registran la storeKey ni las cabeceras de autorización:
 * se redactan por si alguna vez se cuelan en un objeto que se loguea.
 */
export function createLogger(level: string): Logger {
  return pino({
    level,
    base: { app: "sync-agent" },
    redact: { paths: ["storeKey", "*.storeKey", "authorization", "*.authorization"], censor: "[oculto]" },
  });
}

/** Texto corto para last_error (la columna es VARCHAR(300)). */
export function shortError(text: string): string {
  if (text.length <= 300) {
    return text;
  }
  return `${text.slice(0, 297)}...`;
}
