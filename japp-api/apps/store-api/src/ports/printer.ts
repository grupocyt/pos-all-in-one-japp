import { connect } from "node:net";
import { renderEscPos, renderText, type TicketLine } from "@japp/domain";

/**
 * Puerto de impresión: la API decide QUÉ se imprime (ticket de @japp/domain); el adaptador sabe CÓMO.
 * - LogPrinter: no imprime, guarda el texto (desarrollo y pruebas).
 * - EscPosNetPrinter: manda ESC/POS por TCP (puerto 9100) a las Epson/Bixolon de la tienda.
 */
export interface PrintJob {
  kind: "kitchen" | "prebill" | "invoice";
  channel: string; printer: string; connection: string; title: string;
  ticket: TicketLine[];
  openDrawer?: boolean;
}
export interface PrinterPort { print(job: PrintJob): Promise<{ ok: boolean; error?: string }>; }

export class LogPrinter implements PrinterPort {
  readonly jobs: (PrintJob & { text: string })[] = [];
  async print(job: PrintJob) { this.jobs.push({ ...job, text: renderText(job.ticket) }); return { ok: true }; }
}

/** «tcp://10.221.11.32» o «tcp://10.221.11.32:9100» → host y puerto. */
export function parseConnection(c: string): { host: string; port: number } | null {
  const m = /^tcp:\/\/([^:/]+)(?::(\d+))?/i.exec(c.trim());
  return m ? { host: m[1]!, port: Number(m[2] ?? 9100) } : null;
}

export class EscPosNetPrinter implements PrinterPort {
  constructor(private readonly timeoutMs = 4000) {}
  print(job: PrintJob): Promise<{ ok: boolean; error?: string }> {
    const to = parseConnection(job.connection);
    if (!to) return Promise.resolve({ ok: false, error: `Conexión no soportada: ${job.connection}` });
    const bytes = renderEscPos(job.ticket, { openDrawer: job.openDrawer });
    return new Promise(resolve => {
      const s = connect(to.port, to.host);
      const done = (r: { ok: boolean; error?: string }) => { s.destroy(); resolve(r); };
      s.setTimeout(this.timeoutMs, () => done({ ok: false, error: `Sin respuesta de ${job.printer} (${to.host}:${to.port})` }));
      s.on("error", e => done({ ok: false, error: `${job.printer}: ${e.message}` }));
      s.on("connect", () => s.end(Buffer.from(bytes), () => done({ ok: true })));
    });
  }
}
