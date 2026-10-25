# Japp · base de datos + API de tienda + TPV

```
japp-db/          PostgreSQL 16: esquema, datos de arranque, migraciones 0001–0015, consultas de control · 66 pruebas
japp-api/         API de tienda /api/v2 (NestJS + Fastify + Drizzle) · 97 endpoints · 255 pruebas de dominio + 264 de integración
                  + agente de sincronización con Japp Manager (14 pruebas) y un Manager de pruebas (6)
japp-tpv/         el TPV (PWA) 1.2.169. La API lo sirve en http://localhost:8080/
japp-print-test/  la prueba de impresoras antigua (ahora está dentro de la API: /api/v2/printers/*)
```

Las tres carpetas van juntas, una al lado de la otra: la API usa `../japp-db` para crear y migrar la base y `../japp-tpv` para servir el TPV.

## Opción A · Docker (lo más rápido)

```
cd japp-api
cp .env.example .env
echo "SESSION_SECRET=$(openssl rand -hex 32)" >> .env
echo "DB_PASSWORD=$(openssl rand -hex 16)" >> .env
docker compose up --build -d
```

- **TPV**: http://localhost:8080/ → PIN 0186. Arriba aparece la etiqueta «API ✓»: cada cambio del TPV se replica en la API y se compara.
- **Ajustes › Developer › API backend**: documentación de la API y pestaña *Conectar y probar* (registro, diferencias y Swagger).
- **Agente de sincronización** (opcional): pon `MANAGER_URL` y `STORE_KEY` en `.env` y `docker compose --profile sync up -d`.
- **Swagger suelto**: http://localhost:8080/api/v2/docs/ (entra con el PIN en la barra de arriba).
- Desde otro equipo de la red: http://<IP del Mac>:8080/

Todas las respuestas de la API tienen el formato `{ title, type, status, data, errors, traceId, author, mode }`.

Tras cambiar código: `docker compose up --build -d` otra vez (la base se conserva).

## Opción B · Node 22 + PostgreSQL 16 en tu equipo

```
cd japp-db  && cp .env.example .env && npm install && npm run db:up && npm test
cd ../japp-api && cp .env.example .env && npm install
#  → en japp-api/.env pon SESSION_SECRET y las URL de la base (las mismas que en japp-db/.env)
npm run db:init
npm test
npm run dev        # también sirve el TPV en http://localhost:8080/
```

## Instalación nueva (base vacía) con los datos de la tienda

Con `SEED=1` la base se crea con la carta y con los datos de la tienda del formulario «Datos iniciales Japp» (`japp-db/sql/04_datos_tienda_inicial.sql`):
tienda **JC01 · Nueva Sucursal Japp**, empresa con NIF B12300141, salas BARRA (mesa 1), SALON (100–199) y TERRAZA (200–399), canales BEBIDA (impresora BARRA) y COMIDA (impresora LINEA), y la matriz de permisos (el Cajero ya puede abrir el periodo).
Usuarios de prueba: Sistemas, Jeison, Barra, Mesero y **Capitan Mesero (PIN 7070)**. **Cambia todos los PIN antes de producción.**
Solo se aplica al crear la base desde cero; una base que ya existe (como la de LG01) no cambia.

## Actualizar una tienda ya instalada a 1.2.169 (sin borrar la base)

Desde la 1.2.164 hay **una migración nueva, la 0016**: el tiempo de la tanda en Ajustes › Facturación (una columna con 5 s por defecto). No borra ni cambia datos y `npm run db:init` la aplica sola. Si vienes de una versión anterior a la 1.2.160, aplica también la 0014 (id de integración de las formas de pago) y la 0015 (incidencias de mesa). No hagas `db:reset`.

**Importante:** la API y el TPV de la 1.2.169 van juntos. Actualiza todos los equipos (cajas y PDA) a la vez: con la API nueva, un TPV antiguo ya no puede añadir ni guardar en una mesa que tiene otro equipo.

1. Para la API (Ctrl+C en su ventana, o `docker compose stop api`).
2. Haz copia de tu `.env` de `japp-api` y de `japp-db`. Descomprime el zip encima de la carpeta anterior (el zip no trae `.env`).
3. En `japp-api`: `npm install` y después `npm run db:init` (aplica las migraciones pendientes, la 0016 y si faltan la 0014 y la 0015; no borra nada). Con Docker: `docker compose up --build -d`.
4. Para que la factura, la precuenta y la comanda salgan por papel, en el `.env` de `japp-api` pon `PRINTER_MODE=escpos`.
5. Arranca la API (`npm start`) y en el TPV pulsa **Actualizar** (o Ctrl+F5): abajo debe poner **v169**.
6. Para que lleguen los datos al Manager, arranca también el agente (`npm start -w sync-agent` en otra ventana, o en Docker `--profile sync`).

## Git: un solo repositorio en la carpeta principal

Desde la 1.2.169 todo el proyecto es **un solo repositorio git** en la carpeta principal (`pos-all-in-one-japp`), con un único `.gitignore` en la raíz. Las subcarpetas (`japp-api`, `japp-db`, `japp-print-test`, `japp-tpv`) ya no tienen su propio `.git`; el historial de cada una está dentro del repositorio principal (`git log -- japp-api`).

Si tu copia aún tiene un `.git` en cada subcarpeta, una sola vez:

1. Guarda tus `.env` (`japp-api/.env`, `japp-db/.env`).
2. Borra los `.git` de las subcarpetas y el de la raíz (en Mac, desde la carpeta principal: `rm -rf .git japp-api/.git japp-db/.git japp-print-test/.git japp-tpv/.git`).
3. Descomprime el zip encima: trae el `.git` nuevo de la raíz, con todo el historial. `git status` debe salir limpio.

El `.gitignore` deja fuera `node_modules`, `dist`, `.env` (menos `.env.example`), `preset.js`, las copias `*.sql.gz` y `.DS_Store`.

## Seguir construyendo con Claude Code

Abre `japp-api` en VS Code y pídele a Claude Code: *«Lee CLAUDE.md y haz el Siguiente encargo, punto 1»*.

Los PIN de prueba (0186 Sistemas, 5845 Jeison, 1012 Barra, 1111 Mesero) se cambian antes de producción.
