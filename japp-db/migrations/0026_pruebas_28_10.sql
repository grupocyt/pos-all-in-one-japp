-- 0026 · Pruebas del 28/10 de Catalina (TPV 1.2.260, 02/11/2026).
-- 1. No hay dos personas con el mismo nombre aunque cambien mayúsculas o espacios («Ana» y « ana »).
--    Si una tienda ya tiene dos así, el índice no se crea (la migración no falla) y se avisa: hay que renombrar una y
--    volver a lanzar este bloque a mano. La API lo comprueba igualmente (409 DUPLICATE, field name).
-- 2. Los clientes del fichero se buscan también por correo: índice para la búsqueda.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "app_user" GROUP BY "store_id", lower(btrim("name")) HAVING count(*) > 1) THEN
    RAISE NOTICE '0026: hay personas con el mismo nombre (sin contar mayúsculas ni espacios); no se crea uq_app_user_store_id_name_ci';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "uq_app_user_store_id_name_ci" ON "app_user" ("store_id", lower(btrim("name")));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "ix_customer_ref_store_id_email" ON "customer_ref" ("store_id", lower("email")) WHERE "email" IS NOT NULL;
