import { fail } from "./errors.js";

/**
 * Segunda pantalla del cliente (Ajustes › Restaurante › Banners; GET/PUT /config/pantalla-cliente).
 *
 * - Tipos: off (apagada), billing (solo facturación), billing_banner (facturación + banner) y banner (solo vídeo / banner).
 * - Los banners son solo para fast food: en una tienda de mesas valen off y billing; si la configuración guardada
 *   tiene un banner (la tienda pasó de fast food a mesas), la pantalla funciona como billing (`effectiveMode`).
 * - La lista: vídeos (MP4, WebM) e imágenes (JPG, PNG, WebP, GIF) de hasta 300 MB, con días (1 = lunes … 7 = domingo,
 *   vacío = todos) y franja horaria en hora de Madrid (con «hasta» menor que «desde», cruza la medianoche).
 */
export const DISPLAY_MODES = ["off", "billing", "billing_banner", "banner"] as const;
export type DisplayMode = (typeof DISPLAY_MODES)[number];
export type ServiceType = "table" | "fastfood";

export const DISPLAY_MAX_BYTES = 300 * 1024 * 1024;
export const DISPLAY_MIMES: Record<string, "video" | "image"> = {
  "video/mp4": "video",
  "video/webm": "video",
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
};

export interface DisplayTickets {
  email: boolean;
  print: boolean;
  invoice: boolean;
  none: boolean;
}
/** Colores de la pantalla (además de `color`, el principal: franjas, totales, despedida). */
export interface DisplayTheme {
  background: string;
  text: string;
  muted: string;
  accentText: string;
  success: string;
  successText: string;
  buttonBg: string;
  buttonText: string;
  buttonBorder: string;
  highlight: string;
  highlightText: string;
}
export const DISPLAY_THEME_DEFAULT: DisplayTheme = {
  background: "#f4f7f8",
  text: "#17262b",
  muted: "#5b6b70",
  accentText: "#ffffff",
  success: "#1c7a4a",
  successText: "#ffffff",
  buttonBg: "#ffffff",
  buttonText: "#17262b",
  buttonBorder: "#c9d5d8",
  highlight: "#fff7e8",
  highlightText: "#7a4a10",
};
export interface DisplayConfig {
  mode: DisplayMode;
  greeting: string;
  name: string;
  color: string;
  farewell: string;
  reviewUrl: string;
  sideTitle: string;
  tickets: DisplayTickets;
  loop: boolean;
  muted: boolean;
  imageSeconds: number;
  theme: DisplayTheme;
}

export const DISPLAY_DEFAULT: DisplayConfig = {
  mode: "billing",
  greeting: "Le damos la bienvenida a",
  name: "",
  color: "#155f6b",
  farewell: "¡Gracias por tu visita!",
  reviewUrl: "",
  sideTitle: "Hoy recomendamos",
  tickets: { email: true, print: true, invoice: true, none: true },
  loop: true,
  muted: true,
  imageSeconds: 8,
  theme: DISPLAY_THEME_DEFAULT,
};

/** Tipos que se pueden elegir según el servicio de la tienda. */
export function allowedDisplayModes(service: ServiceType): DisplayMode[] {
  return service === "fastfood" ? [...DISPLAY_MODES] : ["off", "billing"];
}

/** El tipo con el que funciona la pantalla: un banner guardado en una tienda de mesas pasa a solo facturación. */
export function effectiveDisplayMode(mode: DisplayMode, service: ServiceType): DisplayMode {
  return allowedDisplayModes(service).includes(mode) ? mode : "billing";
}

const str = (v: unknown, max: number, field: string, def: string): string => {
  if (v === undefined || v === null) {
    return def;
  }
  if (typeof v !== "string") {
    fail("VALIDATION", "Tiene que ser un texto", { field });
  }
  const s = (v as string).trim();
  if (s.length > max) {
    fail("VALIDATION", `Como mucho ${max} caracteres`, { field });
  }
  return s;
};
const bool = (v: unknown, field: string, def: boolean): boolean => {
  if (v === undefined || v === null) {
    return def;
  }
  if (typeof v !== "boolean") {
    fail("VALIDATION", "Tiene que ser true o false", { field });
  }
  return v as boolean;
};

/** Valida y completa la configuración que llega (lo que no viene, el valor por defecto). */
export function normalizeDisplayConfig(input: unknown, service: ServiceType): DisplayConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("VALIDATION", "La configuración tiene que ser un objeto", { field: "config" });
  }
  const i = input as Record<string, unknown>;
  const mode = (i.mode ?? DISPLAY_DEFAULT.mode) as DisplayMode;
  if (!DISPLAY_MODES.includes(mode)) {
    fail("VALIDATION", `Tipo de pantalla desconocido: ${String(i.mode)}`, { field: "config.mode" });
  }
  if (!allowedDisplayModes(service).includes(mode)) {
    fail("VALIDATION", "Los banners son solo para fast food: en una tienda de mesas, apagada o solo facturación", {
      field: "config.mode",
      allowed: allowedDisplayModes(service),
    });
  }
  const color = str(i.color, 9, "config.color", DISPLAY_DEFAULT.color);
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    fail("VALIDATION", "Color #RRGGBB", { field: "config.color" });
  }
  const reviewUrl = str(i.reviewUrl, 300, "config.reviewUrl", "");
  if (reviewUrl && !/^https?:\/\/\S+$/.test(reviewUrl)) {
    fail("VALIDATION", "El enlace de reseñas empieza por http:// o https://", { field: "config.reviewUrl" });
  }
  const sec = i.imageSeconds ?? DISPLAY_DEFAULT.imageSeconds;
  if (typeof sec !== "number" || !Number.isInteger(sec) || sec < 2 || sec > 120) {
    fail("VALIDATION", "Segundos por imagen: de 2 a 120", { field: "config.imageSeconds" });
  }
  const th = (i.theme ?? {}) as Record<string, unknown>;
  if (typeof th !== "object" || Array.isArray(th)) {
    fail("VALIDATION", "theme tiene que ser un objeto", { field: "config.theme" });
  }
  const theme = { ...DISPLAY_THEME_DEFAULT };
  for (const k of Object.keys(th)) {
    if (!(k in DISPLAY_THEME_DEFAULT)) {
      fail("VALIDATION", `Color desconocido: ${k}`, { field: `config.theme.${k}` });
    }
    const v = th[k];
    if (typeof v !== "string" || !/^#[0-9a-fA-F]{6}$/.test(v)) {
      fail("VALIDATION", "Color #RRGGBB", { field: `config.theme.${k}` });
    }
    (theme as Record<string, string>)[k] = (v as string).toLowerCase();
  }
  const tk = (i.tickets ?? {}) as Record<string, unknown>;
  if (typeof tk !== "object" || Array.isArray(tk)) {
    fail("VALIDATION", "tickets tiene que ser un objeto", { field: "config.tickets" });
  }
  return {
    mode,
    greeting: str(i.greeting, 60, "config.greeting", DISPLAY_DEFAULT.greeting),
    name: str(i.name, 40, "config.name", ""),
    color: color.toLowerCase(),
    farewell: str(i.farewell, 60, "config.farewell", DISPLAY_DEFAULT.farewell),
    reviewUrl,
    sideTitle: str(i.sideTitle, 40, "config.sideTitle", DISPLAY_DEFAULT.sideTitle),
    tickets: {
      email: bool(tk.email, "config.tickets.email", true),
      print: bool(tk.print, "config.tickets.print", true),
      invoice: bool(tk.invoice, "config.tickets.invoice", true),
      none: bool(tk.none, "config.tickets.none", true),
    },
    loop: bool(i.loop, "config.loop", true),
    muted: bool(i.muted, "config.muted", true),
    imageSeconds: sec as number,
    theme,
  };
}

/** Lo que guarda la base, completado con los valores por defecto (sin fallar: lo viejo se lee siempre). */
export function readDisplayConfig(stored: unknown): DisplayConfig {
  const s = (stored && typeof stored === "object" ? stored : {}) as Partial<DisplayConfig>;
  return {
    ...DISPLAY_DEFAULT,
    ...s,
    mode: DISPLAY_MODES.includes(s.mode as DisplayMode) ? (s.mode as DisplayMode) : DISPLAY_DEFAULT.mode,
    tickets: { ...DISPLAY_DEFAULT.tickets, ...(s.tickets ?? {}) },
    theme: { ...DISPLAY_THEME_DEFAULT, ...(s.theme ?? {}) },
  };
}

/** Tipo de archivo por su Content-Type; otro → 422 VALIDATION. */
export function displayMediaKind(mime: string): "video" | "image" {
  const m = (mime || "").split(";")[0]!.trim().toLowerCase();
  const k = DISPLAY_MIMES[m];
  if (!k) {
    fail("VALIDATION", "Solo vídeos MP4 o WebM e imágenes JPG, PNG, WebP o GIF", {
      field: "content-type",
      allowed: Object.keys(DISPLAY_MIMES),
    });
  }
  return k!;
}

export interface DisplaySchedule {
  days: number[];
  from: string | null;
  to: string | null;
  active: boolean;
}

/** Valida el horario de un archivo de la lista. */
export function normalizeSchedule(x: Partial<DisplaySchedule>, field: string): DisplaySchedule {
  const days = x.days ?? [];
  if (!Array.isArray(days) || days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
    fail("VALIDATION", "Días de 1 (lunes) a 7 (domingo)", { field: `${field}.days` });
  }
  const t = (v: unknown, f: string) => {
    if (v === undefined || v === null || v === "") {
      return null;
    }
    if (typeof v !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) {
      fail("VALIDATION", "Hora HH:MM", { field: `${field}.${f}` });
    }
    return v as string;
  };
  return {
    days: [...new Set(days)].sort((a, b) => a - b),
    from: t(x.from, "from"),
    to: t(x.to, "to"),
    active: x.active !== false,
  };
}

/** ¿Sale ahora? `dow` 1–7 (lunes–domingo) y `hm` HH:MM, los dos en hora de Madrid. */
export function scheduleOn(s: DisplaySchedule, dow: number, hm: string): boolean {
  if (!s.active) {
    return false;
  }
  if (s.days.length && !s.days.includes(dow)) {
    return false;
  }
  if (s.from && s.to) {
    return s.from <= s.to ? hm >= s.from && hm < s.to : hm >= s.from || hm < s.to;
  }
  if (s.from) {
    return hm >= s.from;
  }
  if (s.to) {
    return hm < s.to;
  }
  return true;
}
