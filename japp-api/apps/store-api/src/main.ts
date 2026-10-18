import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";

const config = loadConfig();
const { app } = await buildApp({ config, logger: true });
await app.listen(config.port, "0.0.0.0");
console.log(`API de tienda ${config.storeCode} escuchando en :${config.port}/api/v2`);
