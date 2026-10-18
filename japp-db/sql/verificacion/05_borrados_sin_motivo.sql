-- Líneas borradas que ya estaban enviadas o en precuenta y no guardan motivo, quién ni cuándo. Vacío = bien.
SELECT id, account_id, name, status, deleted_by_user_name, delete_reason
FROM order_line
WHERE deleted
  AND printed
  AND (COALESCE(delete_reason, '') = '' OR deleted_by_user_name IS NULL OR deleted_by_at IS NULL);
