import { createHash } from "node:crypto";

/**
 * JSON con las claves ordenadas: dos objetos iguales dan el mismo texto aunque sus claves vengan en otro orden.
 * Así «mismo contenido» no depende de cómo serialice cada lado.
 */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonical(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Huella del contenido: decide si dos transacciones (o dos facturas) son la misma. */
export function fingerprint(value: unknown): string {
  return sha256(canonical(value));
}
