import type { Actor } from "./types.js";
/** Todo lo que no es puro (reloj, ids, quién actúa) entra por aquí, así las pruebas son deterministas. */
export interface Ctx {
  now: Date;
  newId: () => string;
  actor: Actor;
}
export const clone = <T>(x: T): T => structuredClone(x);
