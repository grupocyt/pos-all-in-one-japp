import type { Ctx } from "../src/context.js";
import type { Account, Line, Product } from "../src/types.js";
import type { Profile, UserLike } from "../src/permissions.js";
import { BASIC_PERMISSIONS, ALL_PERMISSIONS } from "../src/permissions.js";

export const T0 = new Date("2026-10-13T12:00:00Z");
let n = 0;
export const ctx = (over: Partial<Ctx> = {}): Ctx => ({
  now: T0, newId: () => `id-${++n}`, actor: { user: "Marta", role: "waiter", device: "TPV Barra", origin: "tpv", at: T0.toISOString() }, ...over,
});
export const minutesAgo = (m: number, from = T0) => new Date(from.getTime() - m * 60_000).toISOString();

export const account = (over: Partial<Account> = {}): Account => ({
  id: "acc-1", name: "Cuenta 1", status: "open", lines: [], deletedLines: [], discounts: [], payments: [], customerData: null, invoice: null, ...over,
});
export const line = (over: Partial<Line> = {}): Line => ({
  id: `l-${++n}`, productId: 3004, name: "Croquetas", quantity: 1, unitPrice: 10, taxRate: 10, comment: "", modifiers: [],
  status: "pendingPrint", createdBy: { user: "Marta", role: "waiter", at: minutesAgo(30) }, ...over,
});

// Productos de la carta de prueba (Sucursal Pruebas, CT 03)
export const CANA: Product = { plu: 1001, name: "Caña", price: 2.5, terracePrice: 2.9, taxRate: 10 };
export const CROQUETAS: Product = { plu: 3004, name: "Croquetas de jamón (8 ud)", price: 10, terracePrice: 11.5, taxRate: 10 };
export const AGUA: Product = { plu: 1050, name: "Agua 50 cl", price: 2, taxRate: 10 };
export const CAMISETA: Product = { plu: 9001, name: "Camiseta Cañas y Tapas", price: 15, taxRate: 21 };

export const SALA = { id: "sala", name: "Sala", priceList: "general" as const };
export const TERRAZA = { id: "terraza", name: "Terraza", priceList: "terrace" as const };

const all = Object.fromEntries(ALL_PERMISSIONS.map(p => [p, true]));
export const PROFILES: Profile[] = [
  { id: "ADMIN", level: 200, perms: all },
  { id: "ENCARGADO", level: 100, perms: { ...BASIC_PERMISSIONS, "cobro.cobrar": true, "pedido.elimEnviado": true, "pedido.elimPrecuenta": true, "cobro.descuentos": true, "sistema.autorizar": true, "funciones.caja": true } },
  { id: "CAMARERO", level: 10, perms: { ...BASIC_PERMISSIONS } },
  { id: "CAJERO", level: 20, perms: { ...BASIC_PERMISSIONS, "cobro.cobrar": true } },
];
export const MARTA: UserLike = { id: "u-marta", profileId: "CAMARERO" };
export const PABLO: UserLike = { id: "u-pablo", profileId: "CAMARERO", overrides: { "cobro.cobrar": true } };
export const LUCIA: UserLike = { id: "u-lucia", profileId: "ENCARGADO" };
export const JEISON: UserLike = { id: "u-jeison", profileId: "ADMIN" };
