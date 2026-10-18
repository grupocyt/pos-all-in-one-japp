-- Registros VeriFactu cuyo previous_hash no coincide con el hash del registro anterior de la misma tienda. Vacío = bien.
SELECT r.id, r.invoice_number, r.previous_hash, p.hash AS hash_anterior
FROM verifactu_record r
LEFT JOIN verifactu_record p ON p.id = r.previous_record_id
WHERE (r.previous_record_id IS NULL AND EXISTS (SELECT 1 FROM verifactu_record x WHERE x.store_id = r.store_id AND x.generated_at < r.generated_at))
   OR (r.previous_record_id IS NOT NULL AND r.previous_hash IS DISTINCT FROM p.hash);
