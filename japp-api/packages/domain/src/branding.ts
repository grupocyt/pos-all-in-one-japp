import { fail } from "./errors.js";

/**
 * Ajustes › Administración › Sistema (TPV 1.2.206): nombre del sistema, textos del acceso, logos y colores.
 * Una fila por tienda (system_branding); sin fila = los originales con version 0.
 */
export interface PaletteColor {
  hex: string;
  name: string;
  default: boolean;
}
export interface Branding {
  name: string;
  subtitle: string | null;
  loginGroup: string | null;
  logo: string | null;
  noImage: string | null;
  palette: PaletteColor[];
  colors: Record<string, string>;
}

/** Colores del sistema que se pueden cambiar (el que falta = el original). */
export const BRANDING_COLOR_KEYS = [
  "secondary",
  "bg",
  "card",
  "text",
  "muted",
  "line",
  "link",
  "ok",
  "warn",
  "err",
  "info",
] as const;

/** Tamaño máximo de un logo como data URL (el TPV ya los reduce a 256 px). */
export const BRANDING_IMAGE_MAX = 190_000;

export const DEFAULT_BRANDING: Branding = {
  name: "Japp",
  subtitle: null,
  loginGroup: null,
  logo: null,
  noImage: null,
  palette: [{ hex: "#15616D", name: "Verde", default: true }],
  colors: {},
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const bad = (field: string, message: string, details: Record<string, unknown> = {}): never =>
  fail("VALIDATION", message, { field, ...details });

/**
 * Normaliza y valida lo que manda el TPV: textos sin espacios de más (vacío = null), paleta de 1 a 12 colores
 * #RRGGBB con un solo «Por defecto» (si no marca ninguno, el primero), colores del sistema conocidos y logos
 * como data URL de imagen de 190 000 caracteres como mucho (TOO_LARGE).
 */
export function normalizeBranding(b: {
  name: string;
  subtitle?: string | null;
  loginGroup?: string | null;
  logo?: string | null;
  noImage?: string | null;
  palette: { hex: string; name?: string | null; default?: boolean | null }[];
  colors?: Record<string, string | null> | null;
}): Branding {
  const txt = (v: string | null | undefined) => {
    const s = (v ?? "").trim();
    return s ? s : null;
  };
  const name = (b.name ?? "").trim();
  if (!name) {
    bad("name", "El nombre del sistema no puede quedar vacío");
  }
  if (name.length > 60) {
    bad("name", "El nombre del sistema tiene como mucho 60 caracteres");
  }
  for (const [k, max] of [
    ["subtitle", 60],
    ["loginGroup", 80],
  ] as const) {
    const v = txt(b[k]);
    if (v && v.length > max) {
      bad(k, `Como mucho ${max} caracteres`);
    }
  }
  for (const k of ["logo", "noImage"] as const) {
    const v = txt(b[k]);
    if (v && !/^data:image\//.test(v)) {
      bad(k, "La imagen va como data URL (data:image/…)");
    }
    if (v && v.length > BRANDING_IMAGE_MAX) {
      fail("TOO_LARGE", "El logo es demasiado grande: como mucho 190 000 caracteres (redúcelo a 256 px)", {
        field: k,
        length: v.length,
        max: BRANDING_IMAGE_MAX,
      });
    }
  }
  const pal = b.palette ?? [];
  if (!pal.length) {
    bad("palette", "La paleta necesita al menos un color");
  }
  if (pal.length > 12) {
    bad("palette", "La paleta tiene como mucho 12 colores", { count: pal.length });
  }
  pal.forEach((c, i) => {
    if (!HEX.test(String(c.hex ?? ""))) {
      bad("palette", "Cada color de la paleta es #RRGGBB", { index: i, hex: c.hex ?? null });
    }
  });
  const defs = pal.filter((c) => c.default).length;
  if (defs > 1) {
    bad("palette", "Solo un color puede ser «Por defecto»", { defaults: defs });
  }
  const palette = pal.map((c, i) => ({
    hex: c.hex.toUpperCase(),
    name: txt(c.name)?.slice(0, 30) ?? c.hex.toUpperCase(),
    default: defs ? !!c.default : i === 0,
  }));
  const colors: Record<string, string> = {};
  for (const [k, v] of Object.entries(b.colors ?? {})) {
    if (!(BRANDING_COLOR_KEYS as readonly string[]).includes(k)) {
      bad("colors", `Color del sistema que no existe: ${k}`, { key: k });
    }
    if (v == null || v === "") {
      continue;
    }
    if (!HEX.test(v)) {
      bad("colors", "Cada color del sistema es #RRGGBB", { key: k, hex: v });
    }
    colors[k] = v.toUpperCase();
  }
  return {
    name,
    subtitle: txt(b.subtitle),
    loginGroup: txt(b.loginGroup),
    logo: txt(b.logo),
    noImage: txt(b.noImage),
    palette,
    colors,
  };
}
