-- Tracking tokens for one-time access to the snapshot page
CREATE TABLE IF NOT EXISTS exposure_snapshot_tokens (
  token text PRIMARY KEY,
  email text NOT NULL,
  case_file_slug text NOT NULL,
  session_id text,
  contact_id uuid REFERENCES contacts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  email_sent_at timestamptz,
  page_first_viewed_at timestamptz,
  page_view_count int NOT NULL DEFAULT 0,
  irr_clicked_at timestamptz,
  case_file_clicked_at timestamptz,
  membership_clicked_at timestamptz,
  reply_received_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_snapshot_tokens_email ON exposure_snapshot_tokens(email);
CREATE INDEX IF NOT EXISTS idx_snapshot_tokens_session ON exposure_snapshot_tokens(session_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_tokens_created ON exposure_snapshot_tokens(created_at DESC);

-- Conversion measurement view
CREATE OR REPLACE VIEW exposure_snapshot_funnel AS
SELECT
  case_file_slug,
  COUNT(*) AS captures,
  COUNT(*) FILTER (WHERE email_sent_at IS NOT NULL) AS emails_sent,
  COUNT(*) FILTER (WHERE page_first_viewed_at IS NOT NULL) AS pages_viewed,
  COUNT(*) FILTER (WHERE irr_clicked_at IS NOT NULL) AS irr_clicks,
  COUNT(*) FILTER (WHERE case_file_clicked_at IS NOT NULL) AS case_file_clicks,
  COUNT(*) FILTER (WHERE membership_clicked_at IS NOT NULL) AS membership_clicks
FROM exposure_snapshot_tokens
GROUP BY case_file_slug
ORDER BY captures DESC;