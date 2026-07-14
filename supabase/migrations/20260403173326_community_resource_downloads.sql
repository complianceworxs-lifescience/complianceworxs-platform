
CREATE TABLE IF NOT EXISTS community_resource_downloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_slug text NOT NULL,
  resource_title text,
  category text,
  email text,
  member_id uuid REFERENCES community_members(id),
  downloaded_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resource_downloads_slug ON community_resource_downloads(resource_slug);
CREATE INDEX IF NOT EXISTS idx_resource_downloads_email ON community_resource_downloads(email);

ALTER TABLE community_resource_downloads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "downloads_service_only" ON community_resource_downloads FOR ALL USING (auth.role() = 'service_role');
