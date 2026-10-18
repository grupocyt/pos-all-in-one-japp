# japp-tpv

El TPV (PWA instalable): `index.html`, `sw.js`, `manifest.webmanifest` e `icons/`.
La API de tienda lo sirve en `/` (mismo origen que `/api/v2`), así que con `docker compose up` se abre en **http://localhost:8080/**.

- Ajustes › Developer › **Conexión API**: replica cada cambio en la API y lo compara; pestaña **Probar peticiones (Swagger)**.
- `python3 build.py tpv-japp.html` mete una versión nueva del TPV de una sola página en la PWA.
