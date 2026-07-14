
-- community_articles
CREATE TABLE IF NOT EXISTS community_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  subtitle text,
  body text,
  category text,
  author_id uuid REFERENCES community_members(id),
  published_at timestamptz,
  updated_at timestamptz DEFAULT now(),
  is_published boolean DEFAULT false,
  discussion_prompt text,
  created_at timestamptz DEFAULT now()
);

-- community_comments
CREATE TABLE IF NOT EXISTS community_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid REFERENCES community_articles(id) ON DELETE CASCADE,
  member_id uuid REFERENCES community_members(id),
  parent_id uuid REFERENCES community_comments(id),
  body text NOT NULL,
  posted_at timestamptz DEFAULT now(),
  is_deleted boolean DEFAULT false
);

-- community_jobs
CREATE TABLE IF NOT EXISTS community_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  company text NOT NULL,
  location text,
  type text,
  specialty text,
  description text,
  apply_url text,
  posted_by text,
  stripe_payment_id text,
  is_active boolean DEFAULT false,
  is_featured boolean DEFAULT false,
  posted_at timestamptz DEFAULT now(),
  expires_at timestamptz
);

-- community_job_applications
CREATE TABLE IF NOT EXISTS community_job_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES community_jobs(id) ON DELETE CASCADE,
  member_id uuid REFERENCES community_members(id),
  applied_at timestamptz DEFAULT now()
);

-- community_job_views
CREATE TABLE IF NOT EXISTS community_job_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES community_jobs(id) ON DELETE CASCADE,
  viewer_id uuid REFERENCES community_members(id),
  viewed_at timestamptz DEFAULT now()
);

-- indexes
CREATE INDEX IF NOT EXISTS idx_community_articles_slug ON community_articles(slug);
CREATE INDEX IF NOT EXISTS idx_community_articles_published ON community_articles(is_published, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_articles_category ON community_articles(category);
CREATE INDEX IF NOT EXISTS idx_community_comments_article ON community_comments(article_id);
CREATE INDEX IF NOT EXISTS idx_community_comments_member ON community_comments(member_id);
CREATE INDEX IF NOT EXISTS idx_community_jobs_active ON community_jobs(is_active, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_jobs_featured ON community_jobs(is_featured);

-- RLS
ALTER TABLE community_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_job_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_job_views ENABLE ROW LEVEL SECURITY;

-- articles: public read, service role write
CREATE POLICY "articles_public_read" ON community_articles FOR SELECT USING (is_published = true);
CREATE POLICY "articles_service_write" ON community_articles FOR ALL USING (auth.role() = 'service_role');

-- comments: public read, authenticated insert, own delete
CREATE POLICY "comments_public_read" ON community_comments FOR SELECT USING (is_deleted = false);
CREATE POLICY "comments_service_write" ON community_comments FOR ALL USING (auth.role() = 'service_role');

-- jobs: public read active, service role write
CREATE POLICY "jobs_public_read" ON community_jobs FOR SELECT USING (is_active = true);
CREATE POLICY "jobs_service_write" ON community_jobs FOR ALL USING (auth.role() = 'service_role');

-- applications and views: service role only
CREATE POLICY "applications_service_only" ON community_job_applications FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "job_views_service_only" ON community_job_views FOR ALL USING (auth.role() = 'service_role');
