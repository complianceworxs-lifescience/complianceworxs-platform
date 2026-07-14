
CREATE TABLE IF NOT EXISTS signals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  source text NOT NULL,
  signal_type text NOT NULL,
  priority text NOT NULL DEFAULT 'medium',
  action text NOT NULL,
  context jsonb DEFAULT '{}',
  acted_on boolean DEFAULT false,
  acted_at timestamptz
);

CREATE INDEX IF NOT EXISTS signals_acted_on_idx ON signals(acted_on);
CREATE INDEX IF NOT EXISTS signals_created_at_idx ON signals(created_at DESC);
CREATE INDEX IF NOT EXISTS signals_priority_idx ON signals(priority);
