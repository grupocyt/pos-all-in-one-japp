import { createDatabase } from "@japp/db";
import { pickStore } from "@japp/domain";
import { OutboxApplication } from "./Applications/OutboxApplication.js";
import { ManagerClient } from "./Clases/ManagerClient.js";
import { createLogger } from "./Helpers/Logger.js";
import { loadSettings } from "./Properties/AppSettings.js";
import { SyncService } from "./Services/SyncService.js";

// Arranque del agente: configuración por entorno, tienda (STORE_ID, STORE_CODE o la única de la base), ciclo y parada limpia con SIGTERM.
const settings = loadSettings();
const log = createLogger(settings.logLevel);
// Pocas conexiones: una dedicada al bloqueo/LISTEN y otra para el trabajo; el agente no compite con store-api.
const database = createDatabase(settings.databaseUrl, 3);
database.pool.on("error", (e) =>
  log.warn({ err: e.message }, "Conexión de la base caída; el pool la repone"),
);
const outbox = new OutboxApplication(database);

async function resolveStoreId(): Promise<string> {
  if (settings.storeId) {
    if (!(await outbox.storeExists(settings.storeId))) {
      throw new Error("STORE_ID no existe en la tabla store");
    }
    return settings.storeId;
  }
  // Sin STORE_ID: la misma regla que la API (la única tienda de la base, o la de STORE_CODE sin espacios ni mayúsculas).
  return pickStore(await outbox.stores(), settings.storeCode).id;
}

let service: SyncService | null = null;
try {
  const storeId = await resolveStoreId();
  const manager = new ManagerClient({
    baseUrl: settings.managerUrl,
    storeId,
    storeKey: settings.storeKey,
    gzip: settings.gzip,
    timeoutMs: settings.httpTimeoutMs,
  });
  service = new SyncService(settings, storeId, outbox, manager, log);
  await service.start();
} catch (e) {
  log.fatal({ err: String(e) }, "El agente no puede arrancar");
  await database.close();
  process.exit(1);
}

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) {
    return;
  }
  stopping = true;
  log.info({ signal }, "Parando el agente");
  await service?.stop();
  await database.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
