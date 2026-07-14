CREATE TABLE IF NOT EXISTS milestone6_reviewers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  email text,
  credentials text,
  source text, -- e.g. 'compliance_group', 'linkedin', 'referral'
  independence_confirmed boolean DEFAULT false, -- no involvement in CW design/implementation
  status text NOT NULL DEFAULT 'candidate', -- candidate | contacted | confirmed | declined | reviewing | complete
  scores jsonb, -- gate2 + gate4 rubric scores once submitted
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);