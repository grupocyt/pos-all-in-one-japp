-- 0004 · Menú por pases (bebida, 1.º, 2.º, postre): cada pase se elige y se marcha a cocina por separado.
-- question.course: pase de la pregunta. NULL = pregunta normal (se responde al añadir el producto).
--   0 = bebida (sale con el pedido) · 1 = primero · 2 = segundo · 3 = postre.
ALTER TABLE "question" ADD COLUMN IF NOT EXISTS "course" SMALLINT;
DO $$ BEGIN
  ALTER TABLE "question" ADD CONSTRAINT "ck_question_course" CHECK ("course" IS NULL OR "course" BETWEEN 0 AND 9);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN "question"."course" IS 'Pase del menú: NULL pregunta normal; 0 bebida; 1 primero; 2 segundo; 3 postre';

-- order_line.courses: estado de cada pase de la línea [{course, questionId, question, state, firedAt}]
--   state: pending (por elegir) · ready (elegido, sale al guardar) · held (en espera) · fired (marchado)
ALTER TABLE "order_line" ADD COLUMN IF NOT EXISTS "courses" JSONB;
COMMENT ON COLUMN "order_line"."courses" IS 'Pases del menú y su estado: pending|ready|held|fired, con la hora en que se marchó';

-- order_line_modifier.course: a qué pase pertenece la respuesta (NULL = respuesta normal)
ALTER TABLE "order_line_modifier" ADD COLUMN IF NOT EXISTS "course" SMALLINT;
COMMENT ON COLUMN "order_line_modifier"."course" IS 'Pase al que pertenece la respuesta (NULL = respuesta normal)';

-- Datos de la Sucursal Pruebas: pases de las preguntas de menú que ya existen (solo si aún no tienen)
UPDATE "question" SET "course" = 0 WHERE "course" IS NULL AND ("name" ILIKE '%bebida menu dia%');
UPDATE "question" SET "course" = 1 WHERE "course" IS NULL AND "name" ILIKE '%primero menu del dia%';
UPDATE "question" SET "course" = 2 WHERE "course" IS NULL AND "name" ILIKE '%segundo menu del dia%';
UPDATE "question" SET "course" = 3 WHERE "course" IS NULL AND "name" ILIKE '%postre menus%';
