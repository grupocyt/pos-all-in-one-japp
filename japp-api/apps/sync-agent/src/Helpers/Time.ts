/** Espera que se corta si se para el agente (SIGTERM): nunca deja colgada la parada. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** Espera creciente para fallos temporales: base, ×2, ×4… hasta el máximo (5, 10, 20, 40, 60, 60… s por defecto). */
export function backoffMs(attempt: number, baseMs: number, maxMs: number): number {
  const exp = Math.min(attempt, 20);
  return Math.min(maxMs, baseMs * 2 ** exp);
}

const MADRID = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Madrid",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Día de negocio = fecha de apertura del periodo en hora de Madrid (la misma regla que el Gestor de cierres). */
export function madridDate(at: Date | string): string {
  return MADRID.format(new Date(at));
}
