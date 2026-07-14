ALTER TABLE runtime_generations
  ADD COLUMN IF NOT EXISTS prompt_package jsonb,
  ADD COLUMN IF NOT EXISTS filled_user_prompt text,
  ADD COLUMN IF NOT EXISTS max_tokens int,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts int NOT NULL DEFAULT 2;

CREATE OR REPLACE FUNCTION claim_next_runtime_generation()
RETURNS SETOF runtime_generations
LANGUAGE plpgsql
AS $$
DECLARE
  claimed_id uuid;
BEGIN
  SELECT generation_id INTO claimed_id
  FROM runtime_generations
  WHERE status = 'pending' AND claimed_at IS NULL
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF claimed_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE runtime_generations
  SET claimed_at = now(), updated_at = now()
  WHERE generation_id = claimed_id;

  RETURN QUERY SELECT * FROM runtime_generations WHERE generation_id = claimed_id;
END;
$$;