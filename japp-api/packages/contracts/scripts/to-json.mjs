// Copia docs/openapi.yaml a src/openapi.json para validar respuestas en las pruebas sin parsear YAML en caliente.
import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "yaml";
const doc = parse(readFileSync(new URL("../../../docs/openapi.yaml", import.meta.url), "utf8"));
writeFileSync(new URL("../src/openapi.json", import.meta.url), JSON.stringify(doc));
console.log(`openapi.json · ${Object.keys(doc.paths).length} rutas`);
