import { z } from "zod";
import type { ModuleDef } from "../Applications/ConfigRegistry.js";

/** Consulta de GET /config/{module}: texto, página, cursor y filtro de activos (llegan como texto). */
export interface ConfigListQuery {
  q?: string;
  limit?: string;
  cursor?: string;
  active?: string;
}

/** Consulta de GET /config/history. */
export interface ConfigHistoryQuery {
  module?: string;
  recordId?: string;
  limit?: string;
  cursor?: string;
}

/**
 * Esquemas zod de alta (obligatorios marcados) y de cambio (todo opcional + version), generados desde el registro.
 * Son `strict`: un campo desconocido → 422.
 */
export function schemas(d: ModuleDef) {
  const create: Record<string, z.ZodTypeAny> = {};
  const patch: Record<string, z.ZodTypeAny> = {};
  for (const [k, f] of Object.entries(d.fields)) {
    create[k] = f.required ? f.z : f.z.optional();
    patch[k] = f.z.optional();
  }
  for (const [k, f] of Object.entries(d.extra ?? {})) {
    create[k] = f.z.optional();
    patch[k] = f.z.optional();
  }
  if (!d.noActive) {
    create.active = z.boolean().optional();
    patch.active = z.boolean().optional();
  }
  return {
    create: z.object(create).strict(),
    patch: z.object({ ...patch, version: z.number().int() }).strict(),
  };
}
