-- Add unique constraint on email to prevent dupes and enable upsert
-- First dedupe any existing rows just in case
DELETE FROM outbound_suppressions a
USING outbound_suppressions b
WHERE a.id > b.id AND a.email = b.email;

ALTER TABLE outbound_suppressions
ADD CONSTRAINT outbound_suppressions_email_key UNIQUE (email);