
CREATE TABLE IF NOT EXISTS decisions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  signal text NOT NULL,
  action text NOT NULL,
  context jsonb DEFAULT '{}',
  acted_on boolean DEFAULT false,
  acted_at timestamptz
);
