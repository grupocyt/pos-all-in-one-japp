import Decimal from "decimal.js";

/**
 * Dinero: entra y sale como número de euros con 2 decimales, pero se calcula con Decimal
 * para que 0.1 + 0.2 sea 0.30. Redondeo comercial: mitad hacia arriba (como Math.round del prototipo
 * con importes positivos, pero sin los errores de coma flotante).
 */
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type Money = number;
export const D = (n: Decimal.Value) => new Decimal(n);
/** Redondea a céntimos y devuelve número. Equivale a r2() del prototipo. */
export const r2 = (n: Decimal.Value): Money =>
  new Decimal(n).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
export const sum = (xs: Decimal.Value[]): Decimal => xs.reduce<Decimal>((a, x) => a.plus(x), new Decimal(0));
export const toCents = (n: Decimal.Value): number =>
  new Decimal(n).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
export const fromCents = (c: number): Money => new Decimal(c).div(100).toNumber();
export { Decimal };
