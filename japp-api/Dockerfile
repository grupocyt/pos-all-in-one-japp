# API de tienda Japp + TPV (servido en /). Se construye desde la carpeta que contiene japp-db, japp-api y japp-tpv:
#   docker build -f japp-api/Dockerfile -t japp-store-api .
FROM node:22.11-slim
ENV NODE_ENV=production TZ=UTC
WORKDIR /app

COPY japp-db/package.json japp-db/package-lock.json japp-db/
RUN cd japp-db && npm ci --omit=dev --ignore-scripts
COPY japp-db/scripts japp-db/scripts
COPY japp-db/sql japp-db/sql
COPY japp-db/migrations japp-db/migrations

COPY japp-api/package.json japp-api/package-lock.json japp-api/
COPY japp-api/packages/domain/package.json japp-api/packages/domain/
COPY japp-api/packages/db/package.json japp-api/packages/db/
COPY japp-api/packages/contracts/package.json japp-api/packages/contracts/
COPY japp-api/apps/store-api/package.json japp-api/apps/store-api/
COPY japp-api/apps/sync-agent/package.json japp-api/apps/sync-agent/
COPY japp-api/apps/fake-manager/package.json japp-api/apps/fake-manager/
RUN cd japp-api && npm ci --omit=dev --ignore-scripts
COPY japp-api/packages japp-api/packages
COPY japp-api/apps japp-api/apps
# El TPV (PWA) lo sirve la API en http://<equipo>:8080/  ·  Swagger en /api/v2/docs/
COPY japp-tpv japp-tpv
ENV TPV_DIR=/app/japp-tpv

USER node
WORKDIR /app/japp-api/apps/store-api
EXPOSE 8080
# El agente de sincronización usa esta misma imagen: docker-compose lo arranca con otro comando (servicio sync-agent).
# Al arrancar: esquema + migraciones pendientes (no borra nada) y después la API.
CMD ["sh", "-c", "node /app/japp-db/scripts/init.mjs && exec npx tsx src/Program.ts"]
# Sano = /api/v2/health responde 200. 127.0.0.1 y no localhost: localhost puede resolver a ::1 (IPv6) y la API escucha en IPv4.
# start-period: la primera vez crea la base y aplica las migraciones antes de arrancar; ese tiempo no cuenta como fallo.
HEALTHCHECK --interval=10s --timeout=5s --start-period=90s --retries=5 CMD node -e "fetch('http://127.0.0.1:8080/api/v2/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
