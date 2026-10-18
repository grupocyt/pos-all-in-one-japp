import { readFileSync, existsSync } from "node:fs";
// Lee .env sin dependencias (solo KEY=VALUE).
export function loadEnv(path = new URL("../.env", import.meta.url)) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
