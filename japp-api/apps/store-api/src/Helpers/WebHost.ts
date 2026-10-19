import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import type { Config } from "../Properties/AppSettings.js";
import { envelope } from "./ResponseHelper.js";

/**
 * Lo que la API sirve además de /api/v2 (rutas de Fastify, sin sesión):
 * - /                     el TPV (carpeta japp-tpv) → mismo origen que la API, sin CORS
 * - /api/v2/openapi.json  el contrato (solo las rutas de la API de tienda)
 * - /api/v2/docs          Swagger UI para probar peticiones (con entrada por PIN)
 */
const here = fileURLToPath(new URL(".", import.meta.url));
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

export function tpvDir(): string | null {
  const c = [process.env.TPV_DIR, resolve(here, "../../../../../japp-tpv"), "/app/japp-tpv"].filter(
    Boolean,
  ) as string[];
  return c.find((d) => existsSync(join(d, "index.html"))) ?? null;
}

function contract(version: string) {
  const file = resolve(here, "../../../../packages/contracts/src/openapi.json");
  const doc = JSON.parse(readFileSync(file, "utf8"));
  const paths = Object.fromEntries(
    Object.entries<any>(doc.paths)
      .filter(([p]) => p.startsWith("/api/v2/"))
      .map(([p, item]) => {
        const { servers: _s, ...rest } = item;
        return [p, rest];
      }),
  );
  return {
    ...doc,
    info: { ...doc.info, title: "Japp · API de tienda v2", version },
    servers: [{ url: "/", description: "Esta tienda" }],
    paths,
    security: [{ session: [] }],
  };
}

const DOCS = (
  assets: string,
) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Japp · API de tienda</title><link rel="stylesheet" href="${assets}/swagger-ui.css">
<style>body{margin:0;font-family:system-ui,sans-serif;background:#fafafa;font-size:13px}
/* compacto: es una herramienta de developer, el espacio es para las peticiones */
.jbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:4px 10px;background:#15616d;color:#fff;font-size:12px;position:sticky;top:0;z-index:5;min-height:30px}
.jbar b{font-size:12.5px}.jbar label{display:flex;gap:4px;align-items:center}.jbar input{width:64px;font-size:13px;letter-spacing:.25em;padding:2px 6px;border-radius:6px;border:0}
.jbar button{font:inherit;font-weight:700;border:0;border-radius:999px;padding:3px 12px;cursor:pointer;background:#ee7c19;color:#fff}
.jbar span{opacity:.9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1}
.swagger-ui .topbar,.swagger-ui .information-container,.swagger-ui .operation-servers{display:none}
.swagger-ui .wrapper{padding:0 10px;max-width:none}
.swagger-ui .scheme-container{padding:4px 0;margin:0 0 4px;box-shadow:none;background:transparent}
.swagger-ui .scheme-container .schemes{align-items:center}.swagger-ui .scheme-container .schemes>label,.swagger-ui .servers-title{display:none}
.swagger-ui .btn.authorize{padding:2px 10px;font-size:12px}.swagger-ui .btn.authorize svg{width:14px;height:14px}
.swagger-ui .opblock-tag-section{margin:0}
.swagger-ui .opblock-tag{font-size:13.5px;padding:4px 2px;margin:2px 0 2px;border-bottom:1px solid #e3e3e3}
.swagger-ui .opblock-tag small{font-size:11.5px;padding:0 8px;line-height:1.3}
.swagger-ui .opblock-tag svg{width:14px;height:14px}
.swagger-ui .opblock{margin:0 0 3px;border-radius:4px;box-shadow:none}
.swagger-ui .opblock .opblock-summary{padding:1px 6px}
.swagger-ui .opblock .opblock-summary-method{min-width:52px;font-size:10.5px;padding:3px 0}
.swagger-ui .opblock .opblock-summary-path,.swagger-ui .opblock .opblock-summary-path__deprecated{font-size:12.5px;padding:0 6px}
.swagger-ui .opblock .opblock-summary-description{font-size:12px}
.swagger-ui .opblock .opblock-section-header{padding:4px 12px;min-height:0}.swagger-ui .opblock .opblock-section-header h4{font-size:12px}
.swagger-ui .opblock-description-wrapper,.swagger-ui .opblock-external-docs-wrapper,.swagger-ui .opblock-title_normal{padding:6px 12px;font-size:12px}
.swagger-ui .opblock-description-wrapper p,.swagger-ui .markdown p{font-size:12px;margin:0 0 4px}
.swagger-ui .parameters-col_description input,.swagger-ui .parameters-col_description select{padding:3px 6px;font-size:12px}
.swagger-ui table tbody tr td{padding:4px 0}.swagger-ui .response-col_status{font-size:12px}
.swagger-ui .btn{padding:3px 12px;font-size:12px}.swagger-ui .execute-wrapper{padding:6px 12px}
.swagger-ui .highlight-code>.microlight,.swagger-ui textarea{font-size:11.5px}
.swagger-ui section.models{margin:8px 0}.swagger-ui section.models h4{font-size:13px}
</style></head><body>
<div class="jbar"><b>Japp · API de tienda</b><label>PIN <input id="pin" type="password" inputmode="numeric" maxlength="4" placeholder="••••"></label>
<button id="go">Entrar</button><span id="who">Sin sesión: entra con un PIN.</span></div>
<div id="ui"></div>
<script src="${assets}/swagger-ui-bundle.js"></script><script>
const KEY="japp.apiToken";
const hash=new URLSearchParams(location.hash.slice(1)); if(hash.get("token")){ try{ localStorage.setItem(KEY,hash.get("token")); }catch(e){} history.replaceState(null,"",location.pathname); }
const ui=SwaggerUIBundle({url:"openapi.json",dom_id:"#ui",deepLinking:true,persistAuthorization:true,tryItOutEnabled:true,displayRequestDuration:true,docExpansion:"list",filter:true,
  requestInterceptor:r=>{ let t=null; try{ t=localStorage.getItem(KEY); }catch(e){} if(t&&!r.headers.Authorization&&!r.headers.authorization) r.headers.Authorization="Bearer "+t;
    if(/\\/(lines|payments|invoice|accounts|discounts|orders|cash\\/movements)$/.test(r.url)&&r.method==="POST"&&!r.headers["Idempotency-Key"]) r.headers["Idempotency-Key"]=crypto.randomUUID(); return r; },
  responseInterceptor:r=>{ try{ if(/\\/sessions$/.test(r.url)&&r.status===201){ const b=typeof r.body==="object"?r.body:JSON.parse(r.text); const d=b&&b.data; if(d&&d.token){ localStorage.setItem(KEY,d.token); show(d.user); } } }catch(e){} return r; }});
function show(u){ document.getElementById("who").textContent=u?("Sesión: "+u.name+" ("+u.profile+")"):"Sesión del TPV"; }
async function login(){ const pin=document.getElementById("pin").value; const r=await fetch("sessions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({pin})}); const b=await r.json();
  if(r.ok&&b.data){ const d=b.data; localStorage.setItem(KEY,d.token); ui.preauthorizeApiKey&&ui.authActions.authorize({session:{name:"session",schema:{type:"http",scheme:"bearer"},value:d.token}}); show(d.user); } else document.getElementById("who").textContent=(b.errors&&b.errors[0]&&b.errors[0].message)||("Error "+r.status); }
document.getElementById("go").onclick=login; document.getElementById("pin").onkeydown=e=>{ if(e.key==="Enter") login(); };
try{ if(localStorage.getItem(KEY)) show(null); }catch(e){}
</script></body></html>`;

export function registerWeb(f: FastifyInstance, cfg: Config) {
  const spec = contract(cfg.version);
  f.get("/api/v2/openapi.json", async (_req, reply) => reply.header("cache-control", "no-cache").send(spec));
  const require = createRequire(import.meta.url);
  let swaggerDir: string | null = null;
  try {
    swaggerDir = resolve(require.resolve("swagger-ui-dist/package.json"), "..");
  } catch {
    swaggerDir = null;
  }
  f.get("/api/v2/docs", async (_req, reply) => reply.redirect("/api/v2/docs/"));
  f.get("/api/v2/docs/", async (_req, reply) =>
    reply.type("text/html; charset=utf-8").header("cache-control", "no-cache").send(DOCS("assets")),
  );
  f.get("/api/v2/docs/openapi.json", async (_req, reply) => reply.send(spec));
  f.post("/api/v2/docs/sessions", async (req, reply) => {
    const r = await f.inject({
      method: "POST",
      url: "/api/v2/sessions",
      payload: req.body as any,
      headers: {
        "content-type": "application/json",
        ...(req.headers["x-station-id"] ? { "x-station-id": String(req.headers["x-station-id"]) } : {}),
      },
    });
    reply.status(r.statusCode).type("application/json").send(r.body);
  });
  f.get("/api/v2/docs/assets/*", async (req, reply) => {
    if (!swaggerDir) {
      return reply.status(404).send("swagger-ui-dist no instalado");
    }
    const name = (req.params as any)["*"] as string;
    if (!/^[\w.-]+$/.test(name)) {
      return reply.status(404).send();
    }
    const file = join(swaggerDir, name);
    if (!existsSync(file)) {
      return reply.status(404).send();
    }
    return reply
      .type(TYPES[extname(file)] ?? "application/octet-stream")
      .header("cache-control", "public, max-age=86400")
      .send(readFileSync(file));
  });

  const dir = tpvDir();
  f.get("/*", async (req, reply) => {
    const url = (req.params as any)["*"] as string;
    if (url.startsWith("api/")) {
      return reply
        .status(404)
        .send(
          envelope(cfg, req, 404, null, [
            { code: "NOT_FOUND", message: "No existe esa ruta de la API", field: null, details: {} },
          ]),
        );
    }
    if (!dir) {
      return reply
        .status(404)
        .type("text/plain; charset=utf-8")
        .send("TPV no instalado (falta la carpeta japp-tpv)");
    }
    const rel = normalize(decodeURIComponent(url.split("?")[0] || "")).replace(/^(\.\.[/\\])+/, "");
    let file = join(dir, rel || "index.html");
    if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) {
      file = join(dir, "index.html");
    }
    const ext = extname(file);
    return reply
      .type(TYPES[ext] ?? "application/octet-stream")
      .header(
        "cache-control",
        ext === ".html" || file.endsWith("sw.js") ? "no-cache" : "public, max-age=3600",
      )
      .send(readFileSync(file));
  });
}
