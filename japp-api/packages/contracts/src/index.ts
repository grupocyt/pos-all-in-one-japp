import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createRequire } from "node:module";
export type { paths, components } from "./schema.js";

const require = createRequire(import.meta.url);
const doc = require("./openapi.json") as any;

const ajv = new (Ajv2020 as any)({ strict: false, allErrors: true });
(addFormats as any)(ajv);
ajv.addSchema({ $id: "openapi", components: doc.components });

/** Busca la operación del contrato que corresponde a una ruta real (/api/v2/orders/abc → /api/v2/orders/{orderId}). */
export function findOperation(method: string, url: string) {
  const path = url.split("?")[0]!;
  for (const [tpl, item] of Object.entries<any>(doc.paths)) {
    const re = new RegExp("^" + tpl.replace(/\{[^}]+\}/g, "[^/]+") + "$");
    if (re.test(path) && item[method.toLowerCase()]) return { template: tpl, op: item[method.toLowerCase()] };
  }
  return null;
}

/**
 * Valida una respuesta contra el contrato. Devuelve la lista de errores (vacía = cumple).
 * - la ruta y el método deben existir en openapi.yaml;
 * - el código HTTP debe estar documentado (o ser un error con forma Error);
 * - el cuerpo debe cumplir el esquema del contrato (con $ref resueltos).
 */
export function contractErrors(method: string, url: string, status: number, body: unknown): string[] {
  const found = findOperation(method, url);
  if (!found) return [`${method} ${url} no está en openapi.yaml`];
  const responses = found.op.responses ?? {};
  let schema: any;
  if (status >= 400) schema = { $ref: "openapi#/components/schemas/Error" };
  else {
    const r = responses[String(status)];
    if (!r) return [`${method} ${found.template} no documenta ${status} (documenta ${Object.keys(responses).join(", ")})`];
    const c = r.content?.["application/json"];
    if (!c) return [];
    schema = c.schema ?? null;
    if (!schema) return [];
  }
  const fix = (s: any): any => (s && typeof s === "object" ? (Array.isArray(s) ? s.map(fix) : Object.fromEntries(Object.entries(s).map(([k, v]) =>
    [k, k === "$ref" && typeof v === "string" && v.startsWith("#/") ? "openapi" + v : fix(v)]))) : s);
  const validate = ajv.compile(fix(schema));
  const errs = validate(body) ? [] : (validate.errors ?? []).map((e: any) => `${e.instancePath || "/"} ${e.message}`);
  if (body && typeof body === "object" && (body as any).status !== status) errs.push(`/status ${(body as any).status} ≠ HTTP ${status}`);
  return errs;
}
