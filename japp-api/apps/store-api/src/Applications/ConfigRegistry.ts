import { z } from "zod";
import type { ConfigModule } from "@japp/domain";

/**
 * Ajustes: cada módulo dice qué tabla toca y qué campos expone (nombre de API ↔ columna).
 * Los nombres de tabla y columna salen SOLO de aquí (nunca del cliente), así el SQL dinámico es seguro.
 */
export type Kind = "s" | "i" | "n" | "b" | "d" | "u";
export interface Field {
  col: string;
  kind: Kind;
  z: z.ZodTypeAny;
  label: string;
  required?: boolean;
  default?: unknown;
  readOnly?: boolean;
}
export interface ModuleDef {
  table: string;
  /** Cómo se encuentra el registro único: por store_id, por el id de la tienda o por la empresa de la tienda. */
  singleton?: "store_id" | "store" | "company";
  /** Sin columna active (objetivos): no se desactiva. */
  noActive?: boolean;
  /** Campo que da nombre al registro en el historial. */
  nameField: string;
  order: string;
  search?: string[];
  fields: Record<string, Field>;
  /** Campos que no son columnas (relaciones): se validan aquí y los guarda el servicio. */
  extra?: Record<string, { z: z.ZodTypeAny; label: string }>;
}

const str = (max: number) => z.string().trim().min(1).max(max);
const optStr = (max: number) => z.string().trim().max(max).nullish();
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{3,8}$/, "Color #RRGGBB")
  .nullish();
const money = z.number().min(0).max(100000);
const F = (col: string, kind: Kind, zz: z.ZodTypeAny, label: string, o: Partial<Field> = {}): Field => ({
  col,
  kind,
  z: zz,
  label,
  ...o,
});

export const MODULES: Record<ConfigModule, ModuleDef> = {
  restaurante: {
    table: "store",
    singleton: "store",
    nameField: "name",
    order: "name",
    fields: {
      code: F("code", "s", str(20), "Código"),
      name: F("name", "s", str(120), "Nombre"),
      serviceType: F("service_type", "s", z.enum(["table", "fastfood"]), "Tipo de servicio"),
      address: F("address", "s", optStr(200), "Dirección"),
      city: F("city", "s", optStr(80), "Ciudad"),
      phone: F("phone", "s", optStr(30), "Teléfono"),
      openingHours: F("opening_hours", "s", optStr(60), "Horario"),
      reviewsUrl: F("reviews_url", "s", optStr(300), "Reseñas"),
      logoUrl: F("logo_url", "s", optStr(300), "Logo"),
      // URL base de Order on Table: el QR de la mesa es esta URL + /t/ + token
      webOrderUrl: F("web_order_url", "s", optStr(300), "URL de Order on Table"),
      ticketHeader: F("ticket_header", "s", z.string().max(2000).nullish(), "Cabecera del ticket"),
      ticketFooter: F("ticket_footer", "s", z.string().max(2000).nullish(), "Pie del ticket"),
      // código del restaurante en el SIR (cod_restaurante; en MaxPoint rst_id)
      sirCode: F(
        "maxpoint_rst_id",
        "i",
        z.number().int().positive().nullish(),
        "Código de restaurante en el SIR",
      ),
      sirUrl: F(
        "sir_url",
        "s",
        z
          .string()
          .trim()
          .max(300)
          .regex(/^https?:\/\//i, "http:// o https://")
          .nullish()
          .or(z.literal("").transform(() => null)),
        "URL de la interfaz del SIR",
      ),
    },
  },
  empresa: {
    table: "company",
    singleton: "company",
    nameField: "legalName",
    order: "legal_name",
    fields: {
      legalName: F("legal_name", "s", str(120), "Razón social"),
      tradeName: F("trade_name", "s", optStr(120), "Nombre comercial"),
      taxId: F("tax_id", "s", str(20), "NIF"),
      address: F("address", "s", optStr(200), "Dirección fiscal"),
      country: F("country", "s", optStr(60), "País"),
    },
  },
  facturacion: {
    table: "billing_settings",
    singleton: "store_id",
    nameField: "seriesSimplified",
    order: "store_id",
    fields: {
      billingEmail: F("billing_email", "s", z.string().email().max(120).nullish(), "Correo de facturación"),
      establishment: F("establishment", "s", optStr(10), "Establecimiento"),
      emissionPoint: F("emission_point", "s", optStr(10), "Punto de emisión"),
      seriesSimplified: F("series_simplified", "s", str(20), "Serie simplificada"),
      seriesFull: F("series_full", "s", str(20), "Serie completa"),
      seriesCredit: F("series_credit", "s", str(20), "Serie rectificativa"),
      // segundos sin tocar tras los que el TPV y la PDA mandan la tanda de la mesa (migración 0016)
      batchSendSeconds: F(
        "batch_send_seconds",
        "i",
        z.number().int().min(2).max(30),
        "Envío de lo marcado (s)",
      ),
    },
  },
  parametros: {
    table: "store_parameters",
    singleton: "store_id",
    nameField: "lockSeconds",
    order: "store_id",
    fields: {
      lockSeconds: F("lock_seconds", "i", z.number().int(), "Bloqueo TPV (s)"),
      lockSecondsPda: F("lock_seconds_pda", "i", z.number().int(), "Bloqueo PDA (s)"),
      duplicateMinutes: F("duplicate_minutes", "i", z.number().int(), "Aviso de duplicado (min)"),
      cashFloat: F("cash_float", "n", money, "Fondo de caja"),
      cashDiffThreshold: F("cash_diff_threshold", "n", money, "Umbral de descuadre"),
      idleTableMinutes: F("idle_table_minutes", "i", z.number().int(), "Mesa inactiva (min)"),
      prebillToPayMinutes: F("prebill_to_pay_minutes", "i", z.number().int(), "Precuenta sin cobrar (min)"),
      kpiMinTables: F("kpi_min_tables", "i", z.number().int(), "Mesas mínimas KPI"),
      pinAttempts: F("pin_attempts", "i", z.number().int(), "Intentos de PIN"),
      pinLockSeconds: F("pin_lock_seconds", "i", z.number().int(), "Bloqueo de PIN (s)"),
    },
  },
  usuarios: {
    table: "app_user",
    nameField: "name",
    order: "name",
    search: ["name"],
    fields: {
      name: F("name", "s", str(60), "Nombre", { required: true }),
      initials: F("initials", "s", optStr(4), "Iniciales"),
      // color de la persona en el TPV (etiqueta de lo que marcó); vacío = automático (migración 0018)
      color: F(
        "color",
        "s",
        z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/, "Color #RRGGBB")
          .nullish(),
        "Color",
      ),
      profileId: F("profile_id", "u", z.string().uuid(), "Perfil", { required: true }),
      canCharge: F("can_charge", "b", z.boolean().nullish(), "Cobra"),
      canDeletePrinted: F("can_delete_printed", "b", z.boolean().nullish(), "Elimina enviado"),
      canDeletePrebill: F("can_delete_prebill", "b", z.boolean().nullish(), "Elimina en precuenta"),
      lockSeconds: F("lock_seconds", "i", z.number().int().nullish(), "Bloqueo de sesión"),
    },
    extra: { pin: { z: z.string().regex(/^\d{4}$/, "4 números"), label: "PIN" } },
  },
  perfiles: {
    table: "user_profile",
    nameField: "name",
    order: "level DESC, name",
    search: ["name", "code"],
    fields: {
      code: F("code", "s", str(30).regex(/^[A-Z0-9_]+$/, "Mayúsculas, números y _"), "Código", {
        required: true,
      }),
      name: F("name", "s", str(60), "Nombre", { required: true }),
      level: F("level", "i", z.number().int(), "Nivel", { required: true }),
      color: F("color", "s", optStr(30), "Color"),
      allowedStations: F(
        "allowed_stations",
        "s",
        z.enum(["any", "main"]),
        "Equipos (cualquiera / solo caja principal)",
        { default: "any" },
      ),
    },
    extra: { permissions: { z: z.array(z.string().max(40)).max(200), label: "Permisos" } },
  },
  areas: {
    table: "area",
    nameField: "name",
    order: "sort_order, name",
    search: ["name"],
    fields: {
      name: F("name", "s", str(60), "Nombre", { required: true }),
      sortOrder: F("sort_order", "i", z.number().int().min(0).max(999), "Orden", { default: 0 }),
      priceList: F("price_list", "s", z.enum(["general", "terrace"]), "Tarifa", { default: "general" }),
      tableNumberFrom: F("table_number_from", "i", z.number().int(), "Numeración desde", { default: 1 }),
      planWidth: F("plan_width", "i", z.number().int().min(0).max(10000).nullish(), "Ancho del plano"),
      planHeight: F("plan_height", "i", z.number().int().min(0).max(10000).nullish(), "Alto del plano"),
      planImageUrl: F("plan_image_url", "s", optStr(300), "Imagen del plano"),
      ticketChannelId: F("ticket_channel_id", "u", z.string().uuid().nullish(), "Canal de tickets"),
    },
  },
  mesas: {
    table: "dining_table",
    nameField: "number",
    order: "area_id, (CASE WHEN number ~ '^[0-9]+$' THEN number::int END), number",
    search: ["number"],
    fields: {
      number: F("number", "s", str(10), "Mesa", { required: true }),
      areaId: F("area_id", "u", z.string().uuid(), "Área", { required: true }),
      capacity: F("capacity", "i", z.number().int(), "Capacidad", { default: 4 }),
      posX: F("pos_x", "n", z.number().min(0).max(100000).nullish(), "X"),
      posY: F("pos_y", "n", z.number().min(0).max(100000).nullish(), "Y"),
      width: F("width", "i", z.number().int().min(10).max(2000).nullish(), "Ancho"),
      height: F("height", "i", z.number().int().min(10).max(2000).nullish(), "Alto"),
    },
  },
  impuestos: {
    table: "tax",
    nameField: "name",
    order: "rate",
    search: ["name"],
    fields: {
      name: F("name", "s", str(30), "Nombre", { required: true }),
      rate: F("rate", "n", z.number(), "Tipo (%)", { required: true }),
    },
  },
  categorias: {
    table: "category",
    nameField: "name",
    order: "sort_order, name",
    search: ["name"],
    fields: {
      name: F("name", "s", str(60), "Nombre", { required: true }),
      bgColor: F("bg_color", "s", color, "Color"),
      fgColor: F("fg_color", "s", color, "Color del texto"),
      sortOrder: F("sort_order", "i", z.number().int().min(0).max(999), "Orden", { default: 0 }),
      hidden: F("hidden", "b", z.boolean(), "Oculta", { default: false }),
      orderOnTable: F("order_on_table", "b", z.boolean(), "Order on Table", { default: true }),
      // id del App Manager: lo pone el sync de la carta; único por tienda
      externalId: F("external_id", "s", optStr(60), "Id del Manager"),
    },
  },
  productos: {
    table: "product",
    nameField: "name",
    order: "name",
    search: ["name", "ticket_name", "plu::text"],
    fields: {
      plu: F("plu", "i", z.number().int(), "PLU"),
      name: F("name", "s", str(80), "Nombre (tecla)", { required: true }),
      ticketName: F("ticket_name", "s", optStr(80), "Nombre en ticket"),
      categoryId: F("category_id", "u", z.string().uuid().nullish(), "Categoría"),
      price: F("price", "n", z.number().max(100000), "PVP", { required: true }),
      priceTerrace: F("price_terrace", "n", z.number().max(100000).nullish(), "PVP terraza"),
      taxId: F("tax_id", "u", z.string().uuid(), "IVA"),
      bgColor: F("bg_color", "s", color, "Color"),
      fgColor: F("fg_color", "s", color, "Color del texto"),
      soldOut: F("sold_out", "b", z.boolean(), "Agotado", { default: false }),
      answerOnly: F("answer_only", "b", z.boolean(), "Solo como respuesta", { default: false }),
      description: F("description", "s", z.string().max(300).nullish(), "Descripción"),
      orderOnTable: F("order_on_table", "b", z.boolean(), "Order on Table", { default: true }),
      externalId: F("external_id", "s", optStr(60), "Id del Manager"),
    },
    extra: {
      taxRate: { z: z.number().min(0).max(100), label: "IVA (%)" },
      buttonLabel: { z: z.string().trim().min(1).max(80), label: "Texto de la tecla" },
      channels: { z: z.array(z.string().max(40)).max(20), label: "Canales" },
      questions: { z: z.array(z.string().uuid()).max(30), label: "Preguntas" },
    },
  },
  preguntas: {
    table: "question",
    nameField: "name",
    order: "name",
    search: ["name"],
    fields: {
      name: F("name", "s", str(100), "Nombre", { required: true }),
      minAnswers: F("min_answers", "i", z.number().int().min(0).max(50), "Mínimo", { default: 0 }),
      maxAnswers: F("max_answers", "i", z.number().int().min(0).max(50), "Máximo", { default: 1 }),
      course: F("course", "i", z.number().int().nullish(), "Pase"),
      externalId: F("external_id", "s", optStr(60), "Id del Manager"),
    },
    extra: {
      answers: {
        z: z
          .array(
            z
              .object({
                productId: z.string().uuid().optional(),
                plu: z.number().int().optional(),
                label: optStr(80),
                extraPrice: z.number().min(0).max(1000).default(0),
                bgColor: color,
                fgColor: color,
              })
              .refine((a) => a.productId || a.plu, "productId o plu"),
          )
          .max(100),
        label: "Respuestas",
      },
    },
  },
  canales: {
    table: "print_channel",
    nameField: "name",
    order: "kind, name",
    search: ["name"],
    fields: {
      name: F("name", "s", str(40), "Nombre", { required: true }),
      kind: F("kind", "s", z.enum(["kitchen", "ticket"]), "Tipo (comanda / ticket)", { default: "kitchen" }),
      printerId: F("printer_id", "u", z.string().uuid().nullish(), "Impresora"),
      copyOfId: F("copy_of_id", "u", z.string().uuid().nullish(), "Copia de"),
    },
  },
  impresoras: {
    table: "printer",
    nameField: "name",
    order: "name",
    search: ["name", "connection"],
    fields: {
      name: F("name", "s", str(40), "Nombre", { required: true }),
      connection: F("connection", "s", str(120), "Conexión (IP o tcp://IP:puerto)", { required: true }),
      model: F("model", "s", str(30), "Modelo", { default: "EPSON" }),
      kind: F("kind", "s", z.enum(["ticket", "kitchen", "bar"]), "Tipo", { default: "kitchen" }),
    },
  },
  estaciones: {
    table: "station",
    nameField: "name",
    order: "kind, name",
    search: ["name", "ip"],
    fields: {
      name: F("name", "s", str(40), "Nombre", { required: true }),
      kind: F("kind", "s", z.enum(["station", "pda"]), "Tipo", { default: "station" }),
      deviceUuid: F("device_uuid", "s", z.string().max(36).nullish(), "UUID del equipo"),
      ip: F("ip", "s", z.string().max(45).nullish(), "IP"),
      emissionPoint: F("emission_point", "s", optStr(10), "Punto de emisión"),
      opensDrawer: F("opens_drawer", "b", z.boolean(), "Abre cajón", { default: false }),
      isMain: F("is_main", "b", z.boolean(), "Caja principal", { default: false }),
    },
    extra: {
      channels: {
        z: z.record(z.string().max(40), z.string().max(40).nullable()),
        label: "Canal → impresora",
      },
      paymentMethods: { z: z.array(z.string().max(40)).max(20), label: "Formas de pago" },
      discounts: { z: z.array(z.string().uuid()).max(50), label: "Descuentos" },
    },
  },
  "formas-pago": {
    table: "payment_method",
    nameField: "name",
    order: "name",
    search: ["name", "code"],
    fields: {
      code: F("code", "s", str(20).regex(/^[a-z0-9_-]+$/, "minúsculas, números, - y _"), "Código", {
        required: true,
      }),
      name: F("name", "s", str(40), "Nombre", { required: true }),
      kind: F("kind", "s", z.enum(["cash", "card", "platform", "voucher"]), "Tipo", { required: true }),
      opensDrawer: F("opens_drawer", "b", z.boolean(), "Abre cajón", { default: false }),
      allowsTip: F("allows_tip", "b", z.boolean(), "Admite propina", { default: false }),
      externalId: F("external_id", "s", optStr(60), "Id de integración"),
    },
  },
  descuentos: {
    table: "discount",
    nameField: "name",
    order: "name",
    search: ["name"],
    fields: {
      name: F("name", "s", str(60), "Nombre", { required: true }),
      percent: F("percent", "n", z.number(), "Porcentaje", { required: true }),
      validFrom: F(
        "valid_from",
        "d",
        z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullish(),
        "Desde",
      ),
      validTo: F(
        "valid_to",
        "d",
        z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullish(),
        "Hasta",
      ),
      needsAuthorization: F("needs_authorization", "b", z.boolean(), "Pide clave", { default: false }),
    },
  },
  motivos: {
    table: "reason",
    nameField: "name",
    order: "kind, name",
    search: ["name"],
    fields: {
      name: F("name", "s", str(80), "Nombre", { required: true }),
      kind: F("kind", "s", z.enum(["delete", "withdrawal", "credit"]), "Tipo", { required: true }),
    },
  },
  objetivos: {
    table: "sales_target",
    noActive: true,
    nameField: "year",
    order: "year DESC, week",
    fields: {
      year: F("year", "i", z.number().int().min(2000).max(2100), "Año", { required: true }),
      week: F("week", "i", z.number().int(), "Semana", { default: 0 }),
      growthPct: F("growth_pct", "n", z.number(), "Objetivo (%)", { default: 0 }),
      amount: F("amount", "n", z.number().nullish(), "Importe fijo"),
      note: F("note", "s", optStr(200), "Nota"),
    },
  },
};

/** Etiquetas para el historial («PVP terraza: — → 2,80»). */
export const labelsOf = (d: ModuleDef) => ({
  ...Object.fromEntries(Object.entries(d.fields).map(([k, f]) => [k, f.label])),
  ...Object.fromEntries(Object.entries(d.extra ?? {}).map(([k, f]) => [k, f.label])),
  active: "Activo",
});
