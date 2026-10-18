-- Huecos o repetidos en la numeración de facturas por tienda y serie (VeriFactu no los admite). Vacío = bien.
SELECT store_id, series, MIN(sequence) AS desde, MAX(sequence) AS hasta, COUNT(*) AS emitidas,
       COUNT(DISTINCT sequence) AS distintas, MAX(sequence) - MIN(sequence) + 1 AS esperadas
FROM invoice
GROUP BY store_id, series
HAVING COUNT(*) <> COUNT(DISTINCT sequence) OR MAX(sequence) - MIN(sequence) + 1 <> COUNT(*);
