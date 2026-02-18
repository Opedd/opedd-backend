-- 030_team_members.sql — Team management tables + RLS

-- 1. team_members table
CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publisher_id UUID NOT NULL REFERENCES publishers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(publisher_id, user_id)
);

-- 2. team_invitations table
CREATE TABLE IF NOT EXISTS team_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publisher_id UUID NOT NULL REFERENCES publishers(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member')),
  token TEXT NOT NULL UNIQUE,
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(publisher_id, email)
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_publisher_id ON team_members(publisher_id);
CREATE INDEX IF NOT EXISTS idx_team_invitations_token ON team_invitations(token);
CREATE INDEX IF NOT EXISTS idx_team_invitations_publisher_id ON team_invitations(publisher_id);

-- 4. Seed existing owners from publishers table
INSERT INTO team_members (publisher_id, user_id, role)
SELECT id, user_id, 'owner' FROM publishers
ON CONFLICT DO NOTHING;

-- 5. Enable RLS
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_invitations ENABLE ROW LEVEL SECURITY;

-- 6. RLS policies for team_members

-- Users can see their own team memberships
-- NOTE: Using user_id = auth.uid() instead of a self-referencing subquery
-- to avoid infinite recursion in PostgreSQL RLS evaluation.
-- Team listing (seeing other members) is handled by service role in publisher-profile.
CREATE POLICY "team_members_select_own" ON team_members
  FOR SELECT USING (user_id = auth.uid());

-- Owners can insert new members
CREATE POLICY "team_members_insert_owner" ON team_members
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.publisher_id = team_members.publisher_id
        AND tm.user_id = auth.uid()
        AND tm.role = 'owner'
    )
  );

-- Owners can delete members (but service role handles this in practice)
CREATE POLICY "team_members_delete_owner" ON team_members
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.publisher_id = team_members.publisher_id
        AND tm.user_id = auth.uid()
        AND tm.role = 'owner'
    )
  );

-- 7. RLS policies for team_invitations

-- Team members can see invitations for their publisher
CREATE POLICY "team_invitations_select_team" ON team_invitations
  FOR SELECT USING (
    publisher_id IN (
      SELECT tm.publisher_id FROM team_members tm WHERE tm.user_id = auth.uid()
    )
  );

-- Owners can insert invitations
CREATE POLICY "team_invitations_insert_owner" ON team_invitations
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.publisher_id = team_invitations.publisher_id
        AND tm.user_id = auth.uid()
        AND tm.role = 'owner'
    )
  );

-- Owners can delete invitations
CREATE POLICY "team_invitations_delete_owner" ON team_invitations
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.publisher_id = team_invitations.publisher_id
        AND tm.user_id = auth.uid()
        AND tm.role = 'owner'
    )
  );

-- 8. Add SELECT policy on publishers for team members
-- (existing RLS may only allow owner via user_id match)
CREATE POLICY "publishers_select_team_member" ON publishers
  FOR SELECT USING (
    id IN (
      SELECT tm.publisher_id FROM team_members tm WHERE tm.user_id = auth.uid()
    )
  );

-- 9. Add SELECT policy on licenses for team members
CREATE POLICY "licenses_select_team_member" ON licenses
  FOR SELECT USING (
    publisher_id IN (
      SELECT tm.publisher_id FROM team_members tm WHERE tm.user_id = auth.uid()
    )
  );

-- 10. Add SELECT policy on license_transactions for team members
CREATE POLICY "license_transactions_select_team_member" ON license_transactions
  FOR SELECT USING (
    article_id IN (
      SELECT l.id FROM licenses l
      WHERE l.publisher_id IN (
        SELECT tm.publisher_id FROM team_members tm WHERE tm.user_id = auth.uid()
      )
    )
  );

-- 11. Add SELECT policy on webhook_deliveries for team members
CREATE POLICY "webhook_deliveries_select_team_member" ON webhook_deliveries
  FOR SELECT USING (
    publisher_id IN (
      SELECT tm.publisher_id FROM team_members tm WHERE tm.user_id = auth.uid()
    )
  );
