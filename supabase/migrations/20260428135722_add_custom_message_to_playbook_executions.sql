ALTER TABLE playbook_executions
  ADD COLUMN IF NOT EXISTS custom_message TEXT,
  ADD COLUMN IF NOT EXISTS custom_message_edited_at TIMESTAMPTZ;