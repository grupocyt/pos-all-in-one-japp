import { StoreApplication } from "./Applications/StoreApplication.js";
import { loadConfig } from "./Properties/AppSettings.js";
import { buildApp } from "./Startup.js";

const config = loadConfig();
const { app } = await buildApp({ config, logger: true });
// Antes de escuchar: qué tienda es este servidor. Si no se puede saber (varias tiendas sin STORE_CODE, código que no
// existe, base vacía) la API no arranca y lo dice, en vez de responder 500 al entrar con la clave.
let store;
try {
  store = await app.get(StoreApplication).store();
} catch (e) {
  console.error(`La API no puede arrancar: ${e instanceof Error ? e.message : String(e)}`);
  await app.close();
  process.exit(1);
}
await app.listen(config.port, "0.0.0.0");
console.log(`API de tienda ${store.code} (${store.name}) escuchando en :${config.port}/api/v2`);
