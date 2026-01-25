-- Enable Realtime for licenses table
-- This allows the Dashboard to receive live updates when assets are imported

-- Add licenses table to Supabase Realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE licenses;

-- Verify (run this to check):
-- SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
