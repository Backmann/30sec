-- 002_answered_during_reading.sql
-- 30sec.org — record whether an answer arrived before the clock started.
--
-- Answering is not gated by phase: a player may reply while the question is
-- still being read, during the 20-second reading window, before the answering
-- countdown begins. That is what the "Быстрая рука" achievement rewards.
--
-- The judge decides later whether the answer was right, so the fact has to
-- survive between submission and judging — hence a column rather than a
-- transient flag.
--
-- Safe to run more than once. Existing rows get FALSE, which is correct:
-- nothing recorded this before, so no past answer can claim the badge.
--
-- Apply BEFORE deploying the matching API build. The generated Prisma client
-- will expect this column, and queries fail if it is missing.
--
--   docker compose exec -T postgres psql -U sec30user -d sec30db \
--     -f - < prisma/migrations-manual/002_answered_during_reading.sql

ALTER TABLE answers
  ADD COLUMN IF NOT EXISTS answered_during_reading BOOLEAN NOT NULL DEFAULT FALSE;

-- The achievement no longer measures five seconds; bring the catalogue text in
-- line with what the code actually grants.
UPDATE achievements
   SET description = 'Верный ответ ещё во время чтения вопроса, до начала отсчёта'
 WHERE code = 'quick_draw';
