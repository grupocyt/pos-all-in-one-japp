# japp-api

API de tienda de Japp TPV (`/api/v2`). Contexto, reglas y estado del proyecto: **[CLAUDE.md](CLAUDE.md)**. Va **al lado de** `japp-db` en la misma carpeta (`~/japp/japp-db` y `~/japp/japp-api`). Contrato: `docs/openapi.yaml` (versión legible en `docs/api-japp.html`).

```bash
npm install && npm run db:init && npm test && npm run dev
curl localhost:8080/api/v2/health
curl -XPOST localhost:8080/api/v2/sessions -H 'content-type: application/json' -d '{"pin":"0186"}'
```

Con Docker: `cp .env.example .env`, añade `SESSION_SECRET` y `DB_PASSWORD` (ver `.env.example`) y `docker compose up --build -d`. Necesita `../japp-tpv` al lado.

| Qué | Dónde |
|---|---|
| TPV (PIN 0186) | http://localhost:8080/ |
| Swagger (probar peticiones) | http://localhost:8080/api/v2/docs/ |
| Estado | http://localhost:8080/api/v2/health |

Todas las respuestas llevan el mismo formato: `{ title, type, status, data, errors, traceId, author, mode }` (el resultado va en `data`).

En el TPV: Ajustes › Developer › **Conexión API** replica cada cambio en la API y lo compara (pestaña de validación) y abre Swagger con tu sesión.
