-- ════════════════════════════════════════════════════════════════════
-- Campus Digest — Supabase Database Schema
-- Run this ONCE in Supabase Dashboard → SQL Editor → New Query → Run
-- ════════════════════════════════════════════════════════════════════

-- ── Users ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE NOT NULL,
  name        TEXT,
  roll_no     TEXT,
  branch      TEXT,
  year        SMALLINT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── Messages ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source            TEXT NOT NULL CHECK (source IN ('gmail', 'telegram')),
  raw_id            TEXT NOT NULL,
  sender            TEXT,
  sender_domain     TEXT,
  subject           TEXT,
  body_text         TEXT,
  category          TEXT DEFAULT 'uncategorized'
                      CHECK (category IN ('placement','faculty','department','spam','uncategorized')),
  urgency           TEXT DEFAULT 'low'
                      CHECK (urgency IN ('high','medium','low')),
  confidence        FLOAT,
  deadline          TIMESTAMPTZ,
  is_read           BOOLEAN DEFAULT false,
  is_dismissed      BOOLEAN DEFAULT false,
  calendar_synced   BOOLEAN DEFAULT false,
  calendar_event_id TEXT,
  received_at       TIMESTAMPTZ NOT NULL,
  classified_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, source, raw_id)
);

-- ── Feedback ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feedback (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID REFERENCES users(id) ON DELETE CASCADE,
  message_id           UUID REFERENCES messages(id) ON DELETE CASCADE,
  corrected_category   TEXT,
  feedback_type        TEXT CHECK (feedback_type IN ('wrong_category','mark_spam','not_spam')),
  created_at           TIMESTAMPTZ DEFAULT now()
);

-- ── Notification Preferences ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  placement_push       BOOLEAN DEFAULT true,
  faculty_push         BOOLEAN DEFAULT true,
  dept_push            BOOLEAN DEFAULT true,
  tg_digest            BOOLEAN DEFAULT true,
  digest_time          TIME DEFAULT '09:00',
  dnd_start            TIME DEFAULT '23:00',
  dnd_end              TIME DEFAULT '08:00',
  fcm_token            TEXT,
  telegram_chat_id     BIGINT,
  gmail_token          TEXT,          -- encrypted OAuth tokens (AES-256)
  last_gmail_id        TEXT,          -- Gmail history ID for incremental fetch
  last_tg_offset       BIGINT,        -- Telegram update offset
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

-- ── Indexes for performance ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_messages_user_received
  ON messages (user_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_urgency
  ON messages (user_id, urgency)
  WHERE NOT is_dismissed;

CREATE INDEX IF NOT EXISTS idx_messages_deadline
  ON messages (user_id, deadline)
  WHERE deadline IS NOT NULL AND NOT is_dismissed;

CREATE INDEX IF NOT EXISTS idx_messages_unread
  ON messages (user_id, is_read)
  WHERE NOT is_dismissed AND NOT is_read;

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_messages_fts
  ON messages USING GIN (
    to_tsvector('english',
      coalesce(subject, '') || ' ' || coalesce(sender, '') || ' ' || coalesce(body_text, '')
    )
  );

-- ── Row Level Security ────────────────────────────────────────────────
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_messages" ON messages
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY "users_own_feedback" ON feedback
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY "users_own_prefs" ON notification_prefs
  FOR ALL USING (user_id = auth.uid());

-- ── Auto-update timestamp ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prefs_updated_at
  BEFORE UPDATE ON notification_prefs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
