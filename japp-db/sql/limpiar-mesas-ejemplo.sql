-- Quitar las mesas de ejemplo que creaba 04_datos_tienda_inicial.sql (SALON 101–199 y TERRAZA 201–399)
-- 17/11/2026 · Japp 1.2.277
--
-- Deja la primera mesa de cada sala (SALON 100 y TERRAZA 200) y las que se hayan usado alguna vez (con pedidos):
-- esas no se borran, se dan de baja (active = FALSE) para no perder el historial.
-- Las mesas que haya creado el local con otros números no se tocan.
--
-- Uso (con la API parada):
--   psql -d "postgresql://USUARIO:CLAVE@localhost:5432/japp" -f limpiar-mesas-ejemplo.sql
-- Primero enseña cuántas mesas saldrían; si algo no cuadra, cambia COMMIT por ROLLBACK al final.

BEGIN;

CREATE TEMP TABLE mesas_ejemplo ON COMMIT DROP AS
SELECT t.id, a.name AS sala, t.number,
       EXISTS (SELECT 1 FROM orders o WHERE o.table_id = t.id) AS usada
FROM dining_table t JOIN area a ON a.id = t.area_id
WHERE (a.name = 'SALON'   AND t.number ~ '^[0-9]+$' AND t.number::int BETWEEN 101 AND 199)
   OR (a.name = 'TERRAZA' AND t.number ~ '^[0-9]+$' AND t.number::int BETWEEN 201 AND 399);

SELECT sala,
       count(*) FILTER (WHERE NOT usada) AS se_borran,
       count(*) FILTER (WHERE usada)     AS se_dan_de_baja_por_tener_pedidos
FROM mesas_ejemplo GROUP BY sala ORDER BY sala;

DELETE FROM service_sla WHERE table_id IN (SELECT id FROM mesas_ejemplo WHERE NOT usada);
DELETE FROM dining_table WHERE id IN (SELECT id FROM mesas_ejemplo WHERE NOT usada);
UPDATE dining_table SET active = FALSE, updated_at = now(), version = version + 1
 WHERE id IN (SELECT id FROM mesas_ejemplo WHERE usada) AND active;

-- El plano de TERRAZA vuelve al ancho normal (con 200 mesas medía 2000 px)
UPDATE area SET plan_width = 1000 WHERE name = 'TERRAZA' AND plan_width = 2000;

-- Sube la versión de la configuración: así cada TPV y PDA vuelve a leer las mesas al entrar
UPDATE store SET config_version = config_version + 1;

COMMIT;
