/** Permisos por módulo y por botón. */
export const SETTINGS_MODULES = [
  "restaurante",
  "facturacion",
  "usuarios",
  "perfiles",
  "categorias",
  "productos",
  "preguntas",
  "estaciones",
  "impresoras",
  "canales",
  "incidencias",
  "motivos",
  "parametros",
  "historial",
  "cierres",
  "devtx",
  "devdb",
  "devapi",
  "devsync",
  "devtests",
] as const;

/** Teclas por módulo tal como aparecen en Ajustes › Perfiles (= PM_TREE del prototipo). */
export const PERMISSION_TREE = {
  mesas: ["abrirMesa", "transferir", "moverMesas", "editarPlano", "entrarOcupada", "orderOnTable"],
  pedido: [
    "enviar",
    "precuenta",
    "comentarios",
    "notaMesa",
    "comensales",
    "cuentas",
    "pasarCuenta",
    "separar",
    "elimEnviado",
    "elimPrecuenta",
    "historial",
    "transaccion",
  ],
  cobro: ["cobrar", "descuentos", "clientes", "reabrir"],
  funciones: ["facturas", "abonar", "informes", "kpi", "caja", "abrirCajon", "periodo"],
  ajustes: ["acceso", ...SETTINGS_MODULES],
  sistema: ["autorizar"],
} as const;

/**
 * Código de permiso = «módulo.tecla», igual que la tabla permission y PERMISSION_REQUIRED.details.permission.
 * Ej.: pedido.elimEnviado, cobro.cobrar, ajustes.acceso, ajustes.productos, sistema.autorizar.
 */
export type PermissionCode = string;
export const ALL_PERMISSIONS: PermissionCode[] = Object.entries(PERMISSION_TREE).flatMap(([m, ks]) =>
  ks.map((k) => `${m}.${k}`),
);

/** Lo que un perfil nuevo trae marcado por defecto (= PM_BASIC). */
export const BASIC_PERMISSIONS: Record<PermissionCode, boolean> = Object.fromEntries(
  [
    "mesas.abrirMesa",
    "mesas.transferir",
    "pedido.enviar",
    "pedido.precuenta",
    "pedido.comentarios",
    "pedido.notaMesa",
    "pedido.comensales",
    "pedido.cuentas",
    "pedido.pasarCuenta",
    "pedido.historial",
    "pedido.transaccion",
  ].map((k) => [k, true]),
);

export interface Profile {
  id: string;
  level: number;
  perms: Record<string, boolean>;
}
/** Excepciones por persona (p. ej. cobra: true aunque su perfil no cobre). null/undefined = usa el perfil. */
export interface UserLike {
  id: string;
  profileId: string;
  overrides?: Partial<Record<string, boolean | null>>;
}

/** ¿Puede esta persona hacer esto? Primero su excepción personal, luego su perfil. */
export function can(user: UserLike | null | undefined, perm: string, profiles: Profile[]): boolean {
  if (!user) {
    return false;
  }
  const o = user.overrides?.[perm];
  if (o === true || o === false) {
    return o;
  }
  return !!profiles.find((p) => p.id === user.profileId)?.perms[perm];
}

/** Ajustes: vale el permiso propio o el del encargado que autorizó la entrada (ajElev). */
export function canSettings(
  user: UserLike,
  module: string,
  profiles: Profile[],
  elevatedProfileId?: string | null,
): boolean {
  const perm = `ajustes.${module}`;
  if (can(user, perm, profiles)) {
    return true;
  }
  return !!elevatedProfileId && !!profiles.find((p) => p.id === elevatedProfileId)?.perms[perm];
}

/** Resultado de comprobar un permiso con posible autorización de un encargado. */
export type AuthCheck =
  | { ok: true; authorizedBy: UserLike | null }
  | { ok: false; code: "PERMISSION_REQUIRED" | "NOT_ALLOWED"; permission: string };

/**
 * Si quien pulsa no tiene el permiso, hace falta la clave de alguien que sí lo tenga.
 * Sin autorizador → PERMISSION_REQUIRED; autorizador sin el permiso → NOT_ALLOWED.
 */
export function checkWithManager(
  actor: UserLike,
  perm: string,
  profiles: Profile[],
  authorizer?: UserLike | null,
): AuthCheck {
  if (can(actor, perm, profiles)) {
    return { ok: true, authorizedBy: null };
  }
  if (!authorizer) {
    return { ok: false, code: "PERMISSION_REQUIRED", permission: perm };
  }
  if (!can(authorizer, perm, profiles)) {
    return { ok: false, code: "NOT_ALLOWED", permission: perm };
  }
  return { ok: true, authorizedBy: authorizer };
}
