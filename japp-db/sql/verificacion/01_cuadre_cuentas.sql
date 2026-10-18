-- Cuentas cuyo total guardado no cuadra con sus líneas (cantidad × (precio + modificadores)) menos descuentos aplicados.
-- Vacío = todo bien.
WITH l AS (
  SELECT ol.account_id,
         SUM(ROUND(ol.quantity * (ol.unit_price + COALESCE(m.mods, 0)), 2)) AS sub
  FROM order_line ol
  LEFT JOIN (SELECT line_id, SUM(unit_price * quantity) AS mods FROM order_line_modifier GROUP BY line_id) m ON m.line_id = ol.id
  WHERE NOT ol.deleted
  GROUP BY ol.account_id
), d AS (
  SELECT account_id, SUM(amount) AS disc FROM account_discount WHERE status = 'applied' GROUP BY account_id
)
SELECT a.id, a.name, a.subtotal, COALESCE(l.sub, 0) AS calc_subtotal, a.total,
       GREATEST(COALESCE(l.sub, 0) - LEAST(COALESCE(d.disc, 0), COALESCE(l.sub, 0)), 0) AS calc_total
FROM account a
LEFT JOIN l ON l.account_id = a.id
LEFT JOIN d ON d.account_id = a.id
WHERE a.status <> 'cancelled'
  AND (a.subtotal <> COALESCE(l.sub, 0)
       OR a.total <> GREATEST(COALESCE(l.sub, 0) - LEAST(COALESCE(d.disc, 0), COALESCE(l.sub, 0)), 0));
