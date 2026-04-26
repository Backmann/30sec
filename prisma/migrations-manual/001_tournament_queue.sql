-- 001_tournament_queue.sql
-- 30sec.org — Tournament queue feature (исправлено под cuid/text)
--
-- Adds tournament_requests: users sign up for future tournaments with
-- mandatory language. Admin aggregates by language/day/themes to know
-- which tournaments to schedule and which questions to write.
--
-- Apply on server:
--   docker exec -i 30sec-postgres psql -U sec30user -d sec30db < 001_tournament_queue.sql
--
-- Rollback:
--   docker exec 30sec-postgres psql -U sec30user -d sec30db \
--     -c "DROP TABLE IF EXISTS tournament_requests;"

BEGIN;

CREATE TABLE IF NOT EXISTS tournament_requests (
  id                          TEXT         PRIMARY KEY,
  user_id                     TEXT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  language                    VARCHAR(5)   NOT NULL,
  preferred_days              TEXT[]       NOT NULL DEFAULT '{}',
  preferred_time_slot         VARCHAR(20),
  themes                      TEXT[]       NOT NULL DEFAULT '{}',
  comment                     TEXT,
  status                      VARCHAR(20)  NOT NULL DEFAULT 'active',
  fulfilled_by_tournament_id  TEXT         REFERENCES tournaments(id) ON DELETE SET NULL,
  created_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at                  TIMESTAMPTZ  NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),

  CONSTRAINT tr_status_check
    CHECK (status IN ('active','fulfilled','withdrawn','expired')),

  CONSTRAINT tr_time_slot_check
    CHECK (preferred_time_slot IS NULL
           OR preferred_time_slot IN ('morning','afternoon','evening')),

  CONSTRAINT tr_language_check
    CHECK (length(language) BETWEEN 2 AND 5)
);

-- One active request per user per language. Snimaem pri fulfill/withdraw/expire.
CREATE UNIQUE INDEX IF NOT EXISTS tournament_requests_one_active_per_user_lang
  ON tournament_requests(user_id, language)
  WHERE status = 'active';

-- For admin heatmap (counts by language + status filter).
CREATE INDEX IF NOT EXISTS tournament_requests_lang_status_idx
  ON tournament_requests(language, status);

-- For TTL cleanup cron (find expired actives fast).
CREATE INDEX IF NOT EXISTS tournament_requests_expires_idx
  ON tournament_requests(expires_at)
  WHERE status = 'active';

-- For user's "my requests" view.
CREATE INDEX IF NOT EXISTS tournament_requests_user_idx
  ON tournament_requests(user_id);

COMMENT ON TABLE tournament_requests IS
  'Queue for future tournaments. Mandatory language. Drives admin tournament scheduling.';

COMMIT;

\echo ''
\echo '=== tournament_requests created ==='
\d tournament_requests
\echo ''
\echo '=== indexes ==='
\di tournament_requests*
