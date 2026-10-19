import type { Area, Product } from "./types.js";
/** Precio según la zona: en un área con «PVP terraza» se usa el precio terraza si existe y es > 0. */
export function priceFor(
  p: Pick<Product, "price" | "terracePrice">,
  area: Pick<Area, "priceList"> | null | undefined,
): number {
  if (area?.priceList === "terrace" && (p.terracePrice ?? 0) > 0) {
    return p.terracePrice as number;
  }
  return p.price;
}
