
-- Playbook definitions (the "what to do when X happens" config)
CREATE TABLE IF NOT EXISTS playbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playbook_key TEXT NOT NULL UNIQUE,
  playbook_name TEXT NOT NULL,
  trigger_signal_source TEXT NOT NULL,
  trigger_severity TEXT[] NOT NULL,
  buyer_state TEXT NOT NULL,
  asset_routing TEXT NOT NULL,
  asset_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Touch templates (Day 0, Day 3, Day 7 messages per playbook)
CREATE TABLE IF NOT EXISTS playbook_touches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playbook_id UUID NOT NULL REFERENCES playbooks(id) ON DELETE CASCADE,
  touch_number INT NOT NULL,
  day_offset INT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('linkedin_dm', 'email', 'linkedin_comment')),
  variant_label TEXT NOT NULL,
  subject TEXT,
  message_template TEXT NOT NULL,
  closer_line TEXT,
  fire_condition TEXT NOT NULL DEFAULT 'always' CHECK (fire_condition IN ('always', 'no_reply_to_previous', 'reply_to_previous')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (playbook_id, touch_number, variant_label)
);

CREATE INDEX idx_playbook_touches_playbook ON playbook_touches(playbook_id, touch_number);

-- Playbook executions (a signal fired a playbook for a specific contact)
CREATE TABLE IF NOT EXISTS playbook_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playbook_id UUID NOT NULL REFERENCES playbooks(id) ON DELETE RESTRICT,
  signal_id UUID REFERENCES adverse_signals(id) ON DELETE SET NULL,
  watchlist_id UUID REFERENCES adverse_watchlist(id) ON DELETE SET NULL,
  target_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  target_name TEXT,
  target_linkedin TEXT,
  target_email TEXT,
  target_company TEXT,
  status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval', 'approved', 'sending', 'completed', 'replied', 'converted', 'aborted', 'expired')),
  current_touch_number INT NOT NULL DEFAULT 0,
  next_touch_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  completed_at TIMESTAMPTZ,
  outcome TEXT,
  outcome_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_playbook_executions_status ON playbook_executions(status, next_touch_at) WHERE status IN ('approved', 'sending');
CREATE INDEX idx_playbook_executions_signal ON playbook_executions(signal_id) WHERE signal_id IS NOT NULL;
CREATE INDEX idx_playbook_executions_pending ON playbook_executions(created_at DESC) WHERE status = 'pending_approval';
