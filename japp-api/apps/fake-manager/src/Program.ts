import { createFakeManager } from "./FakeManager.js";

// Arranque del Manager de pruebas: puerto FAKE_MANAGER_PORT (8090) y storeKey FAKE_MANAGER_STORE_KEY (obligatoria).
const storeKey = process.env.FAKE_MANAGER_STORE_KEY?.trim();
if (!storeKey) {
  console.error("Falta FAKE_MANAGER_STORE_KEY (mira .env.example)");
  process.exit(1);
}
const port = Number(process.env.FAKE_MANAGER_PORT ?? 8090);
const host = process.env.FAKE_MANAGER_HOST ?? "127.0.0.1";
const fake = createFakeManager({ storeKey, logger: true });
const url = await fake.listen(port, host);
fake.app.log.info({ url }, "Manager de pruebas escuchando");

const stop = async () => {
  await fake.close();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
