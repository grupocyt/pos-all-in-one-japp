/** Tokens de inyección (inyección explícita: no dependemos de emitDecoratorMetadata). */
export const CONFIG = Symbol("CONFIG");
export const DATABASE = Symbol("DATABASE");
export const PRINTER = Symbol("PRINTER");
export const CLOCK = Symbol("CLOCK");
export type Clock = () => Date;
