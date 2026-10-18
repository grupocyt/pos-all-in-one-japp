# japp-db

Base de datos de Japp TPV (PostgreSQL 16): esquema, datos de arranque de la Sucursal Pruebas, migraciones y consultas de control.
Va **al lado de** [`japp-api`](../japp-api) en la misma carpeta (`~/japp/japp-db` y `~/japp/japp-api`).

Contexto, convenciones y cómo cambiar el esquema: **[CLAUDE.md](CLAUDE.md)**.

```bash
cp .env.example .env && npm install && npm test     # 37 pruebas contra PostgreSQL real
```
