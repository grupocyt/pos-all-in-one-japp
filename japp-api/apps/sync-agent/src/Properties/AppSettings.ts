import { readFileSync } from "node:fs";

/** Configuración del agente, solo desde variables de entorno (la storeKey nunca va en el código). Tiempos en ms. */
export interface AppSettings {
  databaseUrl: string;
  /** URL base del contrato del Manager, ya terminada en /api/manager/v1. */
  managerUrl: string;
  /** Tienda: STORE_ID (UUID); si no, STORE_CODE (sin espacios ni mayúsculas); si no, la única tienda de la base. */
  storeId?: string;
  storeCode?: string;
  storeKey: string;
  intervalMs: number;
  instant: boolean;
  debounceMs: number;
  batch: number;
  gzip: boolean;
  maxAttempts: number;
  reconcileMs: number;
  heartbeatMs: number;
  /** Espera creciente ante fallos temporales: base, base×2, base×4… hasta el máximo. */
  retryBaseMs: number;
  retryMaxMs: number;
  httpTimeoutMs: number;
  agentVersion: string;
  logLevel: string;
}

/** Versión del agente que viaja en cada lote y en el latido (la del package.json). */
export function agentVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    version: string;
  };
  return `sync-agent/${pkg.version}`;
}

/**
 * MANAGER_URL puede venir como el dominio (https://japp.grupocyt.com.es/) o ya con /api/manager/v1:
 * así vale el mismo valor que usa store-api y el de .env.example.
 */
export function managerBase(url: string): string {
  const clean = url.trim().replace(/\/+$/, "");
  if (clean.endsWith("/api/manager/v1")) {
    return clean;
  }
  return `${clean}/api/manager/v1`;
}

export function loadSettings(env: NodeJS.ProcessEnv = process.env): AppSettings {
  const need = (k: string) => {
    const v = env[k]?.trim();
    if (!v) {
      throw new Error(`Falta la variable de entorno ${k} (mira .env.example)`);
    }
    return v;
  };
  const num = (k: string, def: number, min: number) => {
    const raw = env[k]?.trim();
    if (!raw) {
      return def;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < min) {
      throw new Error(`${k} debe ser un número ≥ ${min}`);
    }
    return n;
  };
  const bool = (k: string, def: boolean) => {
    const raw = env[k]?.trim().toLowerCase();
    if (!raw) {
      return def;
    }
    return raw === "true" || raw === "1" || raw === "yes" || raw === "si";
  };
  const storeId = env.STORE_ID?.trim() || undefined;
  const storeCode = env.STORE_CODE?.trim() || undefined;
  return {
    databaseUrl: need("DATABASE_URL"),
    managerUrl: managerBase(need("MANAGER_URL")),
    storeId,
    storeCode,
    storeKey: need("STORE_KEY"),
    intervalMs: num("SYNC_INTERVAL_SECONDS", 60, 0.01) * 1000,
    instant: bool("SYNC_INSTANT", true),
    debounceMs: num("SYNC_DEBOUNCE_MS", 2000, 0),
    batch: Math.floor(num("SYNC_BATCH", 100, 1)),
    gzip: bool("SYNC_GZIP", true),
    maxAttempts: Math.floor(num("SYNC_MAX_ATTEMPTS", 10, 1)),
    reconcileMs: num("SYNC_RECONCILE_MINUTES", 60, 0.001) * 60_000,
    heartbeatMs: num("SYNC_HEARTBEAT_SECONDS", 60, 0.01) * 1000,
    retryBaseMs: num("SYNC_RETRY_BASE_MS", 5000, 1),
    retryMaxMs: num("SYNC_RETRY_MAX_MS", 60_000, 1),
    httpTimeoutMs: num("SYNC_HTTP_TIMEOUT_MS", 30_000, 100),
    agentVersion: agentVersion(),
    logLevel: env.LOG_LEVEL?.trim() || "info",
  };
}
