-- Customer lifecycle actions per paying buyer
CREATE TABLE IF NOT EXISTS customer_lifecycle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  email TEXT NOT NULL,
  contact_id UUID REFERENCES contacts(id),
  attio_person_id TEXT,
  
  first_purchase_at TIMESTAMPTZ NOT NULL,
  first_product TEXT,
  
  -- Lifecycle milestones
  day_7_action TEXT,
  day_7_completed_at TIMESTAMPTZ,
  day_14_action TEXT,
  day_14_completed_at TIMESTAMPTZ,
  day_30_action TEXT,
  day_30_completed_at TIMESTAMPTZ,
  day_60_action TEXT,
  day_60_completed_at TIMESTAMPTZ,
  day_90_action TEXT,
  day_90_completed_at TIMESTAMPTZ,
  
  testimonial_requested_at TIMESTAMPTZ,
  testimonial_received_at TIMESTAMPTZ,
  case_study_requested_at TIMESTAMPTZ,
  case_study_completed_at TIMESTAMPTZ,
  referral_requested_at TIMESTAMPTZ,
  referral_received_at TIMESTAMPTZ,
  second_purchase_at TIMESTAMPTZ,
  second_product TEXT,
  
  notes TEXT,
  UNIQUE(email)
);

CREATE INDEX IF NOT EXISTS idx_customer_lifecycle_first_purchase
  ON customer_lifecycle(first_purchase_at DESC);

-- Touch counter state — logged outreach per day
CREATE TABLE IF NOT EXISTS outbound_pace_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  check_date DATE NOT NULL,
  week_of DATE NOT NULL,
  touches_this_week INT NOT NULL,
  touches_target INT NOT NULL DEFAULT 20,
  days_remaining_in_week INT NOT NULL,
  under_pace BOOLEAN NOT NULL,
  attio_note_posted BOOLEAN DEFAULT FALSE,
  UNIQUE(check_date)
);

-- Edge function audit: last-fired timestamps
CREATE TABLE IF NOT EXISTS edge_function_heartbeat (
  function_name TEXT PRIMARY KEY,
  last_fired_at TIMESTAMPTZ,
  last_status TEXT,
  fire_count_30d INT DEFAULT 0,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Content-to-pipeline attribution records
CREATE TABLE IF NOT EXISTS content_attribution (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  week_of DATE NOT NULL,
  pipeline_id UUID REFERENCES content_pipeline(id),
  posted_at TIMESTAMPTZ,
  
  -- Attribution measurements
  views_attributed INT DEFAULT 0,
  case_file_views_attributed INT DEFAULT 0,
  email_captures_attributed INT DEFAULT 0,
  replies_attributed INT DEFAULT 0,
  pipeline_entries INT DEFAULT 0,
  purchases_attributed INT DEFAULT 0,
  revenue_attributed_cents INT DEFAULT 0,
  
  notes TEXT
);