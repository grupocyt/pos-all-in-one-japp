/** Configuración solo desde variables de entorno (nunca secretos en el código). */
export interface Config {
  databaseUrl: string;
  port: number;
  storeCode: string;
  sessionSecret: string;
  sessionHours: number;
  version: string;
  printerMode: "log" | "escpos";
  /** Orígenes que pueden llamar a la API desde el navegador: «*», lista separada por comas, o vacío = solo el mismo origen. */
  corsOrigins: string[];
  /** Formato de respuesta: mode = developer | production (API_MODE) y author (API_AUTHOR). */
  apiMode: "developer" | "production";
  apiAuthor: string;
}
export const API_AUTHOR = "Api Japp Grupo Cañas y Tapas";
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const need = (k: string) => { const v = env[k]; if (!v) throw new Error(`Falta la variable de entorno ${k} (mira .env.example)`); return v; };
  const secret = need("SESSION_SECRET");
  if (secret.length < 32) throw new Error("SESSION_SECRET debe tener al menos 32 caracteres");
  return {
    databaseUrl: need("DATABASE_URL"),
    port: Number(env.PORT ?? 8080),
    storeCode: env.STORE_CODE ?? "CT 03",
    sessionSecret: secret,
    sessionHours: Number(env.SESSION_HOURS ?? 12),
    version: env.APP_VERSION ?? "0.1.0",
    printerMode: env.PRINTER_MODE === "escpos" ? "escpos" : "log",
    corsOrigins: (env.CORS_ORIGINS ?? "").split(",").map(x => x.trim()).filter(Boolean),
    apiMode: env.API_MODE === "production" ? "production" : "developer",
    apiAuthor: env.API_AUTHOR || API_AUTHOR,
  };
}
