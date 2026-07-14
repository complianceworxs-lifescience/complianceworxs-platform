
CREATE TABLE linkedin_commenters (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  title text,
  company text,
  comment_text text,
  post_snippet text,
  source text DEFAULT 'taplio_screenshot',
  captured_at timestamptz DEFAULT now()
);

ALTER TABLE linkedin_commenters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon insert" ON linkedin_commenters
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Allow anon select" ON linkedin_commenters
  FOR SELECT TO anon USING (true);
