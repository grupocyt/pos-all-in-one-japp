-- 0013 · Aviso al agente de sincronización en cuanto entra algo en la cola.
-- El agente (apps/sync-agent) hace LISTEN sync_outbox: así una mesa cobrada llega al Manager al momento y no espera a su ciclo.
-- Un aviso por sentencia (no por fila): un cambio de mesa que encola dos órdenes despierta al agente una sola vez.
-- pg_notify se entrega al hacer COMMIT; si la transacción se deshace, no se avisa.
CREATE OR REPLACE FUNCTION notify_sync_outbox() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('sync_outbox', '');
  RETURN NULL;
END $$;
COMMENT ON FUNCTION notify_sync_outbox() IS 'Despierta al agente de sincronización (LISTEN sync_outbox) tras encolar';

DROP TRIGGER IF EXISTS "trg_sync_outbox_notify" ON "sync_outbox";
CREATE TRIGGER "trg_sync_outbox_notify" AFTER INSERT ON "sync_outbox"
  FOR EACH STATEMENT EXECUTE FUNCTION notify_sync_outbox();
