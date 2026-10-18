-- Cuentas facturadas cuyos cobros confirmados no suman el total, o con pendiente distinto de 0. Vacío = bien.
SELECT a.id, a.name, a.total, COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'confirmed'), 0) AS cobrado, a.pending
FROM account a
LEFT JOIN payment p ON p.account_id = a.id
WHERE a.status = 'invoiced'
GROUP BY a.id
HAVING COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'confirmed'), 0) <> a.total OR a.pending <> 0;
