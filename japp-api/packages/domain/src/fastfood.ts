/** Modo «fastfood» (heladería/mostrador): al entrar se abre siempre el pedido FF-<estación> con el PVP general. */
export type ServiceMode = "table" | "fastfood"; // = CHECK de store.service_type
export const isFastFood = (mode: ServiceMode, isPda: boolean) => mode === "fastfood" && !isPda;
export const fastFoodTableId = (stationName: string) => `FF-${stationName}`;
export const isFastFoodTable = (tableId: string) => tableId.startsWith("FF-");
/** En fastfood no hay zona terraza: siempre PVP general. */
export const FAST_FOOD_AREA = { id: "FF", name: "Fast food", priceList: "general" as const };
