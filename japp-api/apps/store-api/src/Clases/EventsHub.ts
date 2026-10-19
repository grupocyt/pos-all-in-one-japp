/**
 * Tiempo real (GET /api/v2/ws): los equipos abiertos de una tienda reciben avisos para repintarse sin preguntar.
 * Solo avisa (qué cambió y su versión); el dato se vuelve a pedir por REST. Un proceso por tienda: basta la memoria.
 * Eventos: order.updated, table.updated, config.changed, print.failed, session.replaced.
 */
export interface HubEvent {
  event: "order.updated" | "table.updated" | "config.changed" | "print.failed" | "session.replaced";
  [k: string]: unknown;
}

export interface HubSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface Client {
  socket: HubSocket;
  storeId: string;
  userId: string;
  jti: string;
}

const OPEN = 1;

export class EventsHub {
  private readonly clients = new Set<Client>();

  add(socket: HubSocket, storeId: string, userId: string, jti: string): () => void {
    const c: Client = { socket, storeId, userId, jti };
    this.clients.add(c);
    return () => {
      this.clients.delete(c);
    };
  }

  /** A todos los equipos de la tienda (null = de todas: rutas sin sesión). Un socket roto se quita sin afectar a los demás. */
  publish(storeId: string | null, e: HubEvent): void {
    const msg = JSON.stringify({ ...e, at: new Date().toISOString() });
    for (const c of this.clients) {
      if (storeId !== null && c.storeId !== storeId) {
        continue;
      }
      this.sendTo(c, msg);
    }
  }

  /** El usuario entró en otro equipo: sus sockets con la sesión anterior reciben session.replaced y se cierran. */
  replaced(storeId: string, userId: string, newJti: string, station: string): void {
    const msg = JSON.stringify({ event: "session.replaced", userId, station, at: new Date().toISOString() });
    for (const c of this.clients) {
      if (c.storeId !== storeId || c.userId !== userId || c.jti === newJti) {
        continue;
      }
      this.sendTo(c, msg);
      c.socket.close(4001, "SESSION_REPLACED");
      this.clients.delete(c);
    }
  }

  /** La sesión terminó (DELETE /sessions/current): sus sockets se cierran con 4001; los de otras sesiones siguen. */
  ended(storeId: string, jti: string): void {
    for (const c of this.clients) {
      if (c.storeId !== storeId || c.jti !== jti) {
        continue;
      }
      c.socket.close(4001, "SESSION_ENDED");
      this.clients.delete(c);
    }
  }

  get size(): number {
    return this.clients.size;
  }

  private sendTo(c: Client, msg: string) {
    if (c.socket.readyState !== OPEN) {
      this.clients.delete(c);
      return;
    }
    try {
      c.socket.send(msg);
    } catch {
      this.clients.delete(c);
    }
  }
}
