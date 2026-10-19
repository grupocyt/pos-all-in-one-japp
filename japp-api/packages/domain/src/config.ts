import { fail } from "./errors.js";

/**
 * Ajustes: módulos que se pueden consultar y cambiar desde el TPV (y por API), su permiso y las reglas de cada registro.
 * La forma de los datos (tipos, longitudes) la valida la API con zod; aquí viven las reglas de negocio.
 */
export const CONFIG_MODULES = [
  "restaurante",
  "empresa",
  "facturacion",
  "parametros",
  "usuarios",
  "perfiles",
  "areas",
  "mesas",
  "impuestos",
  "categorias",
  "productos",
  "preguntas",
  "canales",
  "impresoras",
  "estaciones",
  "formas-pago",
  "descuentos",
  "motivos",
  "objetivos",
] as const;
export type ConfigModule = (typeof CONFIG_MODULES)[number];

/** Módulos de un solo registro (la tienda): se leen y cambian con id «current». */
export const SINGLETON_MODULES: readonly ConfigModule[] = [
  "restaurante",
  "empresa",
  "facturacion",
  "parametros",
];

/** Permiso de cada módulo (= los que pinta Ajustes › Perfiles). */
export const CONFIG_PERMISSION: Record<ConfigModule, string> = {
  restaurante: "ajustes.restaurante",
  empresa: "ajustes.restaurante",
  facturacion: "ajustes.facturacion",
  impuestos: "ajustes.facturacion",
  "formas-pago": "ajustes.facturacion",
  descuentos: "ajustes.facturacion",
  parametros: "ajustes.parametros",
  usuarios: "ajustes.usuarios",
  perfiles: "ajustes.perfiles",
  areas: "mesas.editarPlano",
  mesas: "mesas.editarPlano",
  categorias: "ajustes.categorias",
  productos: "ajustes.productos",
  preguntas: "ajustes.preguntas",
  canales: "ajustes.canales",
  impresoras: "ajustes.impresoras",
  estaciones: "ajustes.estaciones",
  motivos: "ajustes.motivos",
  objetivos: "ajustes.cierres",
};

export const isConfigModule = (m: string): m is ConfigModule =>
  (CONFIG_MODULES as readonly string[]).includes(m);

const bad = (field: string, message: string, details: Record<string, unknown> = {}): never =>
  fail("VALIDATION", message, { field, ...details });

/** Reglas de negocio de un registro ya completo (lo nuevo encima de lo que había). Lanza VALIDATION con el campo. */
export function checkConfigRecord(
  module: ConfigModule,
  r: Record<string, any>,
  opts: { isNew: boolean },
): void {
  switch (module) {
    case "usuarios":
      if (opts.isNew && r.pin == null) {
        bad("pin", "El PIN es obligatorio");
      }
      if (r.pin != null && !/^\d{4}$/.test(String(r.pin))) {
        bad("pin", "El PIN son 4 números");
      }
      if (r.lockSeconds != null && (r.lockSeconds < 0 || r.lockSeconds > 3600)) {
        bad("lockSeconds", "El bloqueo va de 0 (nunca) a 3600 segundos");
      }
      break;
    case "perfiles":
      if (r.level < 0 || r.level > 100) {
        bad("level", "El nivel va de 0 a 100");
      }
      break;
    case "preguntas": {
      const answers = (r.answers ?? []) as unknown[];
      if (r.minAnswers > r.maxAnswers) {
        bad("minAnswers", "El mínimo no puede ser mayor que el máximo");
      }
      if (r.maxAnswers < 1) {
        bad("maxAnswers", "El máximo tiene que ser al menos 1");
      }
      if (r.minAnswers >= 1 && answers.length === 0) {
        bad("answers", "Una pregunta obligatoria necesita al menos una respuesta");
      }
      if (answers.length && r.minAnswers > answers.length) {
        bad("minAnswers", "Pide más respuestas de las que tiene", { answers: answers.length });
      }
      if (r.course != null && (r.course < 0 || r.course > 9)) {
        bad("course", "El pase va de 0 (bebida) a 9");
      }
      break;
    }
    case "impuestos":
      if (r.rate < 0 || r.rate > 100) {
        bad("rate", "El tipo de IVA va de 0 a 100");
      }
      break;
    case "descuentos":
      if (!(r.percent > 0 && r.percent <= 100)) {
        bad("percent", "El descuento va de 0 a 100 %");
      }
      if (r.validFrom && r.validTo && r.validFrom > r.validTo) {
        bad("validTo", "La fecha de fin es anterior a la de inicio");
      }
      break;
    case "productos":
      if (r.price < 0) {
        bad("price", "El precio no puede ser negativo");
      }
      if (r.priceTerrace != null && r.priceTerrace < 0) {
        bad("priceTerrace", "El precio de terraza no puede ser negativo");
      }
      if (r.plu != null && (!Number.isInteger(r.plu) || r.plu <= 0)) {
        bad("plu", "El PLU es un número entero positivo");
      }
      break;
    case "areas":
      if (r.tableNumberFrom < 0) {
        bad("tableNumberFrom", "La numeración empieza en 0 o más");
      }
      break;
    case "mesas":
      if (r.capacity < 1 || r.capacity > 99) {
        bad("capacity", "La capacidad va de 1 a 99");
      }
      break;
    case "parametros":
      for (const [k, min, max] of [
        ["lockSeconds", 0, 3600],
        ["lockSecondsPda", 0, 3600],
        ["duplicateMinutes", 0, 120],
        ["pinAttempts", 1, 20],
        ["pinLockSeconds", 0, 3600],
        ["idleTableMinutes", 0, 1440],
        ["prebillToPayMinutes", 0, 1440],
        ["kpiMinTables", 0, 1000],
      ] as const) {
        if (r[k] != null && (r[k] < min || r[k] > max)) {
          bad(k, `Fuera de rango (${min}–${max})`);
        }
      }
      if (r.cashFloat != null && r.cashFloat < 0) {
        bad("cashFloat", "El fondo de caja no puede ser negativo");
      }
      if (r.cashDiffThreshold != null && r.cashDiffThreshold < 0) {
        bad("cashDiffThreshold", "El umbral no puede ser negativo");
      }
      break;
    case "objetivos":
      if (r.week < 0 || r.week > 53) {
        bad("week", "La semana va de 0 (todo el año) a 53");
      }
      if (r.growthPct < -100 || r.growthPct > 1000) {
        bad("growthPct", "El objetivo va de −100 % a 1000 %");
      }
      if (r.amount != null && r.amount < 0) {
        bad("amount", "El importe no puede ser negativo");
      }
      break;
  }
}

/** Optimista por registro: si la versión no coincide → VERSION_CONFLICT con la actual. Devuelve la siguiente. */
export function assertRecordVersion(current: number, sent: number | null | undefined): number {
  if (sent == null) {
    fail("VALIDATION", "Falta version", { field: "version" });
  }
  if (sent !== current) {
    fail("VERSION_CONFLICT", "Otro equipo cambió este registro antes", { current, sent });
  }
  return current + 1;
}

/** Qué impide desactivar un registro. Lo que llega es el recuento que hace la API. */
export interface ConfigUsage {
  openOrders?: number;
  activeChildren?: number;
  users?: number;
  products?: number;
  stations?: number;
  self?: boolean;
  base?: boolean;
}
export function assertCanDeactivate(module: ConfigModule, u: ConfigUsage): void {
  if (SINGLETON_MODULES.includes(module)) {
    fail("VALIDATION", "Este módulo no se desactiva", { field: "id" });
  }
  if (u.self) {
    fail("IN_USE", "No puedes desactivarte a ti mismo", { reason: "self" });
  }
  if (u.base) {
    fail("IN_USE", "Es una forma de pago base (efectivo o tarjeta)", { reason: "base" });
  }
  if (u.openOrders) {
    fail("IN_USE", "Tiene mesas abiertas", { reason: "openOrders", count: u.openOrders });
  }
  if (u.users) {
    fail("IN_USE", "Hay usuarios con este perfil", { reason: "users", count: u.users });
  }
  if (u.activeChildren) {
    fail("IN_USE", module === "areas" ? "El área tiene mesas" : "Tiene registros activos dentro", {
      reason: "children",
      count: u.activeChildren,
    });
  }
  if (u.products) {
    fail("IN_USE", "Lo usan productos activos", { reason: "products", count: u.products });
  }
  if (u.stations) {
    fail("IN_USE", "Lo usan estaciones", { reason: "stations", count: u.stations });
  }
}

const show = (v: unknown): string => {
  if (v == null || v === "") {
    return "—";
  }
  if (typeof v === "boolean") {
    return v ? "sí" : "no";
  }
  if (typeof v === "number") {
    return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(".", ",");
  }
  if (Array.isArray(v)) {
    return v.length ? v.map(show).join(", ") : "—";
  }
  if (typeof v === "object") {
    return JSON.stringify(v);
  }
  return String(v);
};
/** «PVP terraza: — → 2,80 · Nombre: AGUA → AGUA 50» (lo que se ve en Ajustes › Historial). Campos secretos nunca. */
export function describeDiff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  labels: Record<string, string> = {},
  secret: string[] = ["pin", "pinHash"],
): string {
  if (!before) {
    return "Alta";
  }
  if (!after) {
    return "Baja";
  }
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (k) => !["id", "version", "updatedAt", "createdAt"].includes(k),
  );
  return keys
    .filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null))
    .map((k) =>
      secret.includes(k)
        ? `${labels[k] ?? k}: cambiado`
        : `${labels[k] ?? k}: ${show(before[k])} → ${show(after[k])}`,
    )
    .join(" · ");
}
