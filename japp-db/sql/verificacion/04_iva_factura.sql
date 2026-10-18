-- Facturas cuyo desglose de IVA (base + cuota) no suma el total, admitiendo 1 céntimo por tipo. Vacío = bien.
SELECT i.id, i.invoice_number, i.total, SUM(t.base + t.tax) AS desglose, COUNT(*) AS tipos
FROM invoice i
JOIN invoice_tax t ON t.invoice_id = i.id
GROUP BY i.id
HAVING ABS(SUM(t.base + t.tax) - i.total) > 0.01 * COUNT(*)
    OR SUM(t.base) <> i.tax_base OR SUM(t.tax) <> i.tax_total;
