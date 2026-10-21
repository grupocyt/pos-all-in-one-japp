import { readFileSync, existsSync } from "node:fs";
// Lee .env sin dependencias (solo KEY=VALUE). Acepta finales de línea de Windows (\r\n) y valores entre comillas.
export function loadEnv(path = new URL("../.env", import.meta.url)) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || m[1] in process.env) continue;
    process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}
