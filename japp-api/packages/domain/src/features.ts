/**
 * 1.2.289 · Ajustes › Funcionalidades: funciones que se pueden desactivar para todo el sistema.
 * Desactivada = nadie la puede usar, ni con su perfil ni con la clave de un encargado (store_parameters.disabled_features, 0042).
 * Cada función apaga los permisos «módulo.tecla» que la abren.
 */
export const FEATURES = {
  transferir: ["mesas.transferir"],
  pasarCuenta: ["pedido.pasarCuenta"],
  separar: ["pedido.separar"],
  eliminaciones: ["pedido.elimEnviado", "pedido.elimPrecuenta"],
  descuentos: ["cobro.descuentos"],
  clientes: ["cobro.clientes"],
  reabrir: ["cobro.reabrir"],
  abonar: ["funciones.abonar"],
  abrirCajon: ["funciones.abrirCajon"],
  cajaChica: ["funciones.cajaChica"],
  pedidos: ["funciones.pedidos"],
  editarPlano: ["mesas.moverMesas", "mesas.editarPlano"],
  ordenImpresion: ["pedido.ordenImpresion"],
  miVenta: ["funciones.miVenta"],
} as const satisfies Record<string, readonly string[]>;

export type FeatureKey = keyof typeof FEATURES;
export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];

/** La función desactivada a la que pertenece este permiso, o null si se puede usar. */
export function featureOff(perm: string, disabled: readonly string[] | null | undefined): FeatureKey | null {
  if (!disabled?.length) {
    return null;
  }
  for (const k of FEATURE_KEYS) {
    if (disabled.includes(k) && (FEATURES[k] as readonly string[]).includes(perm)) {
      return k;
    }
  }
  return null;
}
