import { connect } from "node:net";
import { renderEscPos, renderText, type TicketLine } from "@japp/domain";

/**
 * Puerto de impresión: la API decide QUÉ se imprime (ticket de @japp/domain); el adaptador sabe CÓMO.
 * - LogPrinter: no imprime, guarda el texto (desarrollo y pruebas).
 * - EscPosNetPrinter: manda ESC/POS por TCP (puerto 9100) a las Epson/Bixolon de la tienda.
 */
export interface PrintJob {
  /** drawer = solo el pulso de apertura del cajón (ticket vacío, sin cortar papel). */
  kind: "kitchen" | "prebill" | "invoice" | "test" | "oot" | "drawer";
  channel: string;
  printer: string;
  connection: string;
  title: string;
  ticket: TicketLine[];
  openDrawer?: boolean;
  /** Logo guardado en la memoria NV de la impresora (FS p). */
  logoFromPrinter?: boolean;
}
export interface PrinterPort {
  print(job: PrintJob): Promise<{ ok: boolean; error?: string }>;
}

export class LogPrinter implements PrinterPort {
  readonly jobs: (PrintJob & { text: string })[] = [];
  async print(job: PrintJob) {
    this.jobs.push({ ...job, text: renderText(job.ticket) });
    return { ok: true };
  }
}

/** «tcp://10.221.11.32», «10.221.11.32» o «10.221.11.32:9100» → host y puerto (9100 por defecto). */
export function parseConnection(c: string): { host: string; port: number } | null {
  const m =
    /^(?:tcp:\/\/)?((?:\d{1,3}\.){3}\d{1,3}|[a-z0-9][\w.-]*\.[a-z]{2,}|localhost)(?::(\d+))?\/?$/i.exec(
      c.trim(),
    );
  return m ? { host: m[1]!, port: Number(m[2] ?? 9100) } : null;
}

export class EscPosNetPrinter implements PrinterPort {
  constructor(private readonly timeoutMs = 4000) {}
  print(job: PrintJob): Promise<{ ok: boolean; error?: string }> {
    const to = parseConnection(job.connection);
    if (!to) {
      return Promise.resolve({ ok: false, error: `Conexión no soportada: ${job.connection}` });
    }
    const bytes = renderEscPos(job.ticket, {
      openDrawer: job.openDrawer,
      logoFromPrinter: job.logoFromPrinter,
    });
    return new Promise((resolve) => {
      const s = connect(to.port, to.host);
      const done = (r: { ok: boolean; error?: string }) => {
        s.destroy();
        resolve(r);
      };
      s.setTimeout(this.timeoutMs, () =>
        done({ ok: false, error: `Sin respuesta de ${job.printer} (${to.host}:${to.port})` }),
      );
      s.on("error", (e) => done({ ok: false, error: `${job.printer}: ${e.message}` }));
      s.on("connect", () => s.end(Buffer.from(bytes), () => done({ ok: true })));
    });
  }
}

/** ¿Contesta la impresora? (abre y cierra una conexión TCP; no imprime nada). */
export function pingPrinter(
  connection: string,
  timeoutMs = 2500,
): Promise<{ ok: boolean; ms: number; message: string }> {
  const to = parseConnection(connection);
  const t0 = Date.now();
  if (!to) {
    return Promise.resolve({
      ok: false,
      ms: 0,
      message: `Conexión no válida: ${connection} (usa una IP, IP:puerto o tcp://IP)`,
    });
  }
  return new Promise((resolve) => {
    const s = connect(to.port, to.host);
    const done = (ok: boolean, message: string) => {
      s.destroy();
      resolve({ ok, ms: Date.now() - t0, message });
    };
    s.setTimeout(timeoutMs, () =>
      done(false, `Sin respuesta en ${timeoutMs / 1000} s (¿IP o puerto correctos? ¿misma red?)`),
    );
    s.on("connect", () => done(true, `Conecta con ${to.host}:${to.port}`));
    s.on("error", (e: any) =>
      done(
        false,
        e.code === "ECONNREFUSED"
          ? "Rechaza la conexión en ese puerto (¿es el 9100?)"
          : e.code === "EHOSTUNREACH" || e.code === "ENETUNREACH"
            ? "No hay ruta hasta esa IP (¿misma red?)"
            : String(e.code || e.message),
      ),
    );
  });
}
