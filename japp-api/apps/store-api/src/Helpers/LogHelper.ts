/**
 * Saneado de lo que Fastify escribe en los logs de cada petición. Hay tokens que viajan en la URL: el de sesión en
 * /api/v2/ws?token=… (el navegador no manda cabeceras al abrir un WebSocket) y el del QR de Order on Table en
 * /api/v2/oot/oot_…. Quien lea los logs no debe poder usarlos: se quita la query entera y el token del QR se tapa.
 */
export function safeUrl(url: string | undefined | null): string {
  const path = String(url ?? "").split(/[?#]/)[0] ?? "";
  return path.replace(/(^|\/)oot_[^/]*/g, "$1oot_***");
}

/** Serializador de req para el logger de Fastify (pino): lo mismo que el de siempre, con la URL saneada. */
export function safeRequestLog(req: {
  method?: string;
  url?: string;
  hostname?: string;
  host?: string;
  ip?: string;
  socket?: { remotePort?: number };
}) {
  return {
    method: req.method,
    url: safeUrl(req.url),
    host: req.host ?? req.hostname,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
  };
}
