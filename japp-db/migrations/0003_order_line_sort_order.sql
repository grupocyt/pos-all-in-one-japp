-- 0003 · Orden de las líneas dentro de la cuenta (el camarero puede ordenar lo «Por enviar»: lo que sale primero en la comanda).
-- 0 = sin orden explícito (se ordena por created_by_at, como antes). Las líneas nuevas van al final.
ALTER TABLE "order_line" ADD COLUMN IF NOT EXISTS "sort_order" INTEGER NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE "order_line" ADD CONSTRAINT "ck_order_line_sort_order" CHECK ("sort_order" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN "order_line"."sort_order" IS 'Posición de la línea en su cuenta (0, 1, 2…); fija el orden en pantalla y en la comanda';
