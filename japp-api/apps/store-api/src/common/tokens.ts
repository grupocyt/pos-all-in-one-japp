import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Tokens firmados (HMAC-SHA256) sin estado: <payload base64url>.<firma>.
 * - session: lo devuelve POST /sessions; va en Authorization: Bearer.
 * - auth: autorización de encargado de un solo uso para un permiso concreto (POST /sessions/authorize).
 */
export interface SessionClaims { typ: "session"; sub: string; store: string; station: string; exp: number; jti: string; }
export interface AuthClaims { typ: "auth"; sub: string; store: string; perm: string; exp: number; jti: string; }
type Claims = SessionClaims | AuthClaims;

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sig = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("base64url");

export function signToken<T extends Claims>(secret: string, claims: Omit<T, "jti"> & { jti?: string }): string {
  const body = b64(JSON.stringify({ ...claims, jti: claims.jti ?? randomUUID() }));
  return `${body}.${sig(secret, body)}`;
}

export function verifyToken<T extends Claims>(secret: string, token: string | undefined | null, typ: T["typ"], now = Date.now()): T | null {
  if (!token) return null;
  const [body, s] = token.split(".");
  if (!body || !s) return null;
  const expect = Buffer.from(sig(secret, body)), got = Buffer.from(s);
  if (expect.length !== got.length || !timingSafeEqual(expect, got)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString()) as T;
    if (c.typ !== typ || typeof c.exp !== "number" || c.exp * 1000 < now) return null;
    return c;
  } catch { return null; }
}
