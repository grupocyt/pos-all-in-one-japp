# japp-tpv

El TPV (PWA instalable): `index.html`, `sw.js`, `manifest.webmanifest` e `icons/`.
La API de tienda lo sirve en `/` (mismo origen que `/api/v2`), así que con `docker compose up` se abre en **http://localhost:8080/**.

- Ajustes › Developer › **Conexión API**: replica cada cambio en la API y lo compara; pestaña **Probar peticiones (Swagger)**.
- `python3 build.py tpv-japp.html` mete una versión nueva del TPV de una sola página en la PWA.

## Exportar PWA desde el propio TPV

Ajustes › Restaurante › **Exportar PWA** descarga `japp-tpv-<código>-v<versión>.zip` con:
- `index.html`: este TPV.
- `preset.js`: la configuración del restaurante (carta, sala, usuarios **con sus PIN**, impresoras, estaciones…). Solo se usa en el primer arranque de cada equipo. No lo publiques.
- `manifest.webmanifest`: nombre del local.
- `sw.js`: para que funcione sin conexión.
- `icons/`: iconos con el logo.

Se instala igual que esta carpeta: servirla por HTTPS o desde la API de tienda (`TPV_DIR`) y «Instalar aplicación» en Chrome/Edge.
