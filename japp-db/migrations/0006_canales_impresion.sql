-- 0006 · Canales de impresión por tipo (comanda / ticket), impresora por defecto, copias y ticket por área.
-- Comanda: LINEA, CONTROL, BEBIDA… y sus copias (COPIA CONTROL imprime lo mismo que CONTROL en otra impresora, para locales con doble zona).
-- Ticket: precuenta y factura salen por el canal de tickets del ÁREA de la mesa (terraza → impresora de terraza), sea cual sea el TPV o la PDA.

ALTER TABLE "print_channel" ADD COLUMN IF NOT EXISTS "kind" VARCHAR(20) NOT NULL DEFAULT 'kitchen';
ALTER TABLE "print_channel" ADD COLUMN IF NOT EXISTS "printer_id" UUID REFERENCES "printer" ("id");
ALTER TABLE "print_channel" ADD COLUMN IF NOT EXISTS "copy_of_id" UUID REFERENCES "print_channel" ("id");
DO $$ BEGIN
  ALTER TABLE "print_channel" ADD CONSTRAINT "ck_print_channel_kind" CHECK ("kind" IN ('kitchen','ticket'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "print_channel" ADD CONSTRAINT "ck_print_channel_copy_of_self" CHECK ("copy_of_id" IS NULL OR "copy_of_id" <> "id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "ix_print_channel_printer_id" ON "print_channel" ("printer_id");
CREATE INDEX IF NOT EXISTS "ix_print_channel_copy_of_id" ON "print_channel" ("copy_of_id");
COMMENT ON COLUMN "print_channel"."kind" IS 'kitchen = comanda (los productos salen por aquí) · ticket = precuenta y factura';
COMMENT ON COLUMN "print_channel"."printer_id" IS 'Impresora por defecto del canal (una estación puede cambiarla en station_channel_printer)';
COMMENT ON COLUMN "print_channel"."copy_of_id" IS 'Copia de otro canal de comanda: imprime lo mismo que ese canal en su propia impresora (doble zona)';

ALTER TABLE "area" ADD COLUMN IF NOT EXISTS "ticket_channel_id" UUID REFERENCES "print_channel" ("id");
CREATE INDEX IF NOT EXISTS "ix_area_ticket_channel_id" ON "area" ("ticket_channel_id");
COMMENT ON COLUMN "area"."ticket_channel_id" IS 'Canal de tickets (precuenta y factura) de las mesas de esta área; NULL = el de la estación';

-- Impresora por defecto de cada canal: la que ya tenía asignada alguna estación (la primera por nombre).
UPDATE "print_channel" pc SET "printer_id" = x.printer_id
  FROM (SELECT DISTINCT ON (scp.channel_id) scp.channel_id, scp.printer_id FROM "station_channel_printer" scp JOIN "station" s ON s.id = scp.station_id ORDER BY scp.channel_id, s.name) x
 WHERE pc.id = x.channel_id AND pc."printer_id" IS NULL;

-- Un canal TICKET por tienda (impresora de tipo ticket o, si no hay, la de barra / la primera) y las áreas apuntando a él.
INSERT INTO "print_channel" ("id", "store_id", "name", "active", "kind", "printer_id")
SELECT gen_random_uuid(), st.id, 'TICKET', true, 'ticket',
       (SELECT p.id FROM "printer" p WHERE p.store_id = st.id AND p.active ORDER BY (p.kind = 'ticket') DESC, (p.kind = 'bar') DESC, p.name LIMIT 1)
  FROM "store" st
 WHERE NOT EXISTS (SELECT 1 FROM "print_channel" c WHERE c.store_id = st.id AND c.kind = 'ticket');
UPDATE "area" a SET "ticket_channel_id" = (SELECT c.id FROM "print_channel" c WHERE c.store_id = a.store_id AND c.kind = 'ticket' ORDER BY c.name LIMIT 1)
 WHERE a."ticket_channel_id" IS NULL;
