import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import type { EventsHub } from "../Clases/EventsHub.js";
import type { Config } from "../Properties/AppSettings.js";
import type { SessionsApplication } from "../Applications/SessionsApplication.js";
import { verifyToken, type SessionClaims } from "./TokenHelper.js";

/**
 * GET /api/v2/ws (WebSocket). El navegador no puede mandar cabeceras al abrir un WebSocket, así que el token de sesión
 * va en ?token=… (o en el subprotocolo «bearer, <token>»). Tiene que ser la sesión vigente del usuario: un token
 * sustituido o de alguien que salió se cierra con 4001, y también al salir (DELETE /sessions/current) o cuando caduca
 * el token. Solo se reciben avisos; el equipo no manda nada.
 */
export async function registerEvents(
  f: FastifyInstance,
  hub: EventsHub,
  cfg: Config,
  sessions: SessionsApplication,
): Promise<void> {
  await f.register(websocket, { options: { maxPayload: 1024 } });
  f.get("/api/v2/ws", { websocket: true }, async (socket, req) => {
    const claims = verifyToken<SessionClaims>(cfg.sessionSecret, tokenOf(req), "session");
    if (!claims) {
      socket.close(4001, "BAD_PIN");
      return;
    }
    const active = await sessions.get(claims.store, claims.sub);
    if (!active || active.jti !== claims.jti) {
      socket.close(4001, "SESSION_REPLACED");
      return;
    }
    const remove = hub.add(socket, claims.store, claims.sub, claims.jti);
    // el token caduca (exp) aunque el socket siga abierto: se cierra entonces con 4001 y el equipo vuelve a pedir la clave
    const expires = setTimeout(
      () => {
        remove();
        socket.close(4001, "SESSION_EXPIRED");
      },
      // setTimeout no admite más de 2^31-1 ms (~24 días)
      Math.min(Math.max(0, claims.exp * 1000 - Date.now()), 2_147_483_647),
    );
    expires.unref();
    const done = () => {
      clearTimeout(expires);
      remove();
    };
    socket.on("close", done);
    socket.on("error", done);
    // lo que mande el equipo se ignora (solo escucha)
    socket.on("message", () => undefined);
    socket.send(JSON.stringify({ event: "hello", userId: claims.sub, at: new Date().toISOString() }));
  });
}

function tokenOf(req: any): string | null {
  const q = req.query?.token;
  if (typeof q === "string" && q) {
    return q;
  }
  const proto = String(req.headers?.["sec-websocket-protocol"] ?? "");
  const parts = proto.split(",").map((p) => p.trim());
  if (parts[0]?.toLowerCase() === "bearer" && parts[1]) {
    return parts[1];
  }
  return null;
}
