
-- ── USER TOKENS TABLE ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_tokens (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  email             text NOT NULL,
  tokens_remaining  integer NOT NULL DEFAULT 0,
  tokens_used       integer NOT NULL DEFAULT 0,
  subscription_tier text NOT NULL DEFAULT 'pay_per_use',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- One record per user
CREATE UNIQUE INDEX IF NOT EXISTS user_tokens_user_id_idx ON user_tokens(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS user_tokens_email_idx ON user_tokens(email);

-- Row Level Security
ALTER TABLE user_tokens ENABLE ROW LEVEL SECURITY;

-- Users can only read their own token balance
CREATE POLICY "user_tokens_select_own" ON user_tokens
  FOR SELECT USING (auth.uid() = user_id);

-- Only service role can insert/update tokens
CREATE POLICY "user_tokens_service_insert" ON user_tokens
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "user_tokens_service_update" ON user_tokens
  FOR UPDATE USING (auth.role() = 'service_role');


-- ── GENERATION LOG TABLE ───────────────────────────────────
CREATE TABLE IF NOT EXISTS generation_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  email           text NOT NULL,
  scenario        text NOT NULL DEFAULT 'batch-release',
  stripe_session  text,
  tokens_before   integer,
  tokens_after    integer,
  generated_at    timestamptz NOT NULL DEFAULT now(),
  ip_address      text,
  user_agent      text
);

-- Row Level Security
ALTER TABLE generation_log ENABLE ROW LEVEL SECURITY;

-- Users can only see their own generation history
CREATE POLICY "generation_log_select_own" ON generation_log
  FOR SELECT USING (auth.uid() = user_id);

-- Only service role can insert
CREATE POLICY "generation_log_service_insert" ON generation_log
  FOR INSERT WITH CHECK (auth.role() = 'service_role');


-- ── STRIPE PURCHASE LOG ────────────────────────────────────
CREATE TABLE IF NOT EXISTS stripe_token_purchases (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id     text UNIQUE NOT NULL,
  stripe_session_id   text,
  customer_email      text NOT NULL,
  product_id          text,
  price_id            text,
  tokens_granted      integer NOT NULL DEFAULT 1,
  scenario            text,
  processed_at        timestamptz NOT NULL DEFAULT now()
);

-- Row Level Security
ALTER TABLE stripe_token_purchases ENABLE ROW LEVEL SECURITY;

-- Only service role can read/write
CREATE POLICY "stripe_purchases_service_only" ON stripe_token_purchases
  FOR ALL USING (auth.role() = 'service_role');


-- ── UPDATED_AT TRIGGER ─────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_tokens_updated_at
  BEFORE UPDATE ON user_tokens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
