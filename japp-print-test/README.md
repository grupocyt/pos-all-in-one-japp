# japp-print-test

Mini proyecto **aparte** para probar impresoras térmicas por IP, sin tocar `japp-api` ni la base de datos.

Envía por red (ESC/POS, puerto RAW 9100) una **prueba de caracteres**, una **comanda**, una **comanda de menú por pases**, una **precuenta** o una **factura simplificada** de ejemplo, con el mismo formato que imprime la API de tienda (48 columnas, CP858 con €, ñ y acentos, QR, corte).

## Arrancar (Mac, Node 20 o superior)

```bash
cd japp-print-test
node server.mjs
```

Abre **http://localhost:3333**, escribe la IP de la impresora, pulsa **Probar conexión** y después **Imprimir**. No hace falta `npm install`: no tiene dependencias.

Otro puerto: `PORT=4000 node server.mjs`.

### Con Docker (sin instalar Node)

```bash
cd japp-print-test
docker run --rm -p 3333:3333 -v "$PWD":/app -w /app node:22-slim node server.mjs
```

## Requisitos de la impresora

- En la **misma red** que el equipo donde corre esto.
- Acepta **ESC/POS** por TCP en el puerto **9100** (Epson TM-T20/T88, Bixolon, la mayoría de 80 mm con red).
- Si salen símbolos raros en € o acentos: tabla de caracteres **PC858** en la configuración de la impresora.
- Comprobar desde el terminal: `nc -vz 192.168.1.50 9100` → «succeeded».
- La IP suele salir en el ticket de autotest (encender con el botón FEED pulsado).

## Qué hay

```
server.mjs          servidor (node:http + node:net): /api/preview, /api/ping, /api/print
public/index.html   la pantalla: IP y puerto, tipo de ticket, mesa, camarero, canal, copias, logo, cajón
lib/tickets.mjs     copia empaquetada de @japp/domain/tickets.ts (japp-api): mismo formato que la API
lib/entry.ts        de dónde sale esa copia
```

Para regenerar `lib/tickets.mjs` si cambian los tickets en `japp-api` (las dos carpetas una al lado de la otra):

```bash
cd ../japp-api
npx esbuild ../japp-print-test/lib/entry.ts --bundle --format=esm --platform=node --target=node20 --outfile=../japp-print-test/lib/tickets.mjs
```

## Desde el TPV

Ya está integrado en el TPV: **Ajustes › Equipos › Prueba de impresoras**. Si el TPV está conectado a la API de tienda imprime desde la API (`/api/v2/printers/…`) y no hace falta este servidor. Sin API, el TPV llama a este servidor (por defecto `http://localhost:3333`, se cambia en la propia pantalla); por eso responde con CORS abierto.
