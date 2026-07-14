-- ============================================================================
-- gmail_auth_state: tracks every OAuth token refresh attempt + integrity check
-- Written by outbound-sender-gmail's logAuthState() function
-- ============================================================================

CREATE TABLE IF NOT EXISTS gmail_auth_state (
  id BIGSERIAL PRIMARY KEY,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Credential identity (prefixes only — never store full secrets)
  client_id_prefix TEXT,
  refresh_token_prefix TEXT,
  
  -- Refresh attempt result
  refresh_status INT,                  -- HTTP status from oauth2.googleapis.com/token
  refresh_succeeded BOOLEAN NOT NULL DEFAULT FALSE,
  error_message TEXT,
  
  -- Integrity check (tokeninfo audience verification)
  audience_from_token TEXT,            -- The Client ID Google says the token belongs to
  audience_matches_env BOOLEAN,        -- Does it match current GMAIL_CLIENT_ID env var?
  scope_returned TEXT,                 -- OAuth scopes on the token
  
  -- Auditing
  source TEXT DEFAULT 'outbound-sender-gmail'
);

-- Index for lastSuccessfulAuth() query pattern:
-- SELECT checked_at FROM gmail_auth_state WHERE refresh_succeeded = TRUE ORDER BY checked_at DESC LIMIT 1
CREATE INDEX IF NOT EXISTS idx_gmail_auth_state_succeeded_checked_at
ON gmail_auth_state(checked_at DESC) WHERE refresh_succeeded = TRUE;

CREATE INDEX IF NOT EXISTS idx_gmail_auth_state_checked_at
ON gmail_auth_state(checked_at DESC);

COMMENT ON TABLE gmail_auth_state IS
'Per-attempt log of Gmail OAuth refresh attempts and integrity checks. Written by outbound-sender-gmail before every send batch. Used to detect token aging (>150 days = warning, >180 days = revoked) and credential drift (audience mismatch between refresh token and current GMAIL_CLIENT_ID env var). Prefix fields store first 8-16 chars only — never full secrets.';

-- ============================================================================
-- system_alerts: critical/warning/info notifications from any edge function
-- Written by outbound-sender-gmail's writeAlert() function
-- Designed to be writable by any function that needs to surface ops issues
-- ============================================================================

CREATE TABLE IF NOT EXISTS system_alerts (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Classification
  alert_type TEXT NOT NULL,            -- e.g. 'gmail_oauth_refresh_failed', 'gmail_credential_drift_detected'
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  source TEXT NOT NULL,                -- Which edge function / cron / process wrote it
  
  -- Content
  message TEXT NOT NULL,
  context JSONB,                       -- Free-form diagnostic context
  
  -- Lifecycle
  acknowledged_at TIMESTAMPTZ,         -- Set when human/system marks alert as handled
  acknowledged_by TEXT,
  resolved_at TIMESTAMPTZ              -- Set when underlying issue is fixed
);

CREATE INDEX IF NOT EXISTS idx_system_alerts_created_at
ON system_alerts(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_alerts_unresolved
ON system_alerts(created_at DESC) WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_system_alerts_severity_unresolved
ON system_alerts(severity, created_at DESC) WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_system_alerts_type
ON system_alerts(alert_type, created_at DESC);

COMMENT ON TABLE system_alerts IS
'Generic alert log writable by any edge function. Severity must be critical/warning/info. Set acknowledged_at when human reviews; set resolved_at when underlying issue is fixed. Designed for the session_start_briefing view to surface unresolved critical alerts. Currently written by outbound-sender-gmail for OAuth failures, quota hits, and credential drift.';