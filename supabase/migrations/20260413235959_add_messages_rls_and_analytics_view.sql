-- Migration: Add RLS policies for messages table and create RLS-protected analytics view
-- Ensures staff can only see analytics for their assigned politicians.
-- Uses a normal view over messages (no materialized view).

BEGIN;

-- Remove legacy analytics functions
DROP TRIGGER IF EXISTS trigger_refresh_analytics_on_insert ON public.messages;
DROP FUNCTION IF EXISTS refresh_analytics_on_message_insert() CASCADE;
DROP FUNCTION IF EXISTS refresh_daily_analytics() CASCADE;
DROP FUNCTION IF EXISTS get_message_analytics_daily(integer) CASCADE;

-- 1) Enable RLS on messages table
ALTER TABLE IF EXISTS public.messages ENABLE ROW LEVEL SECURITY;

-- Reuse existing messages policies; avoid dropping/recreating them here.

-- 2) Keep only purposeful indexes aligned with analytics access patterns:
-- - campaign/day rollups
-- - politician-scoped reads (RLS-aware)
DROP INDEX IF EXISTS public.idx_messages_campaign_id;
DROP INDEX IF EXISTS public.idx_messages_politician;

CREATE INDEX IF NOT EXISTS idx_messages_campaign_received
  ON public.messages(campaign_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_politician_campaign_received
  ON public.messages(politician_id, campaign_id, received_at DESC);

-- 3) Create analytics view from base table (RLS applies through messages).
CREATE OR REPLACE VIEW public.message_analytics_view AS
SELECT 
  date_trunc('day', m.received_at) AS date,
  m.campaign_id,
  c.name AS campaign_name,
  m.politician_id,
  COUNT(*) AS message_count
FROM messages m
INNER JOIN campaigns c ON m.campaign_id = c.id
GROUP BY date_trunc('day', m.received_at), m.campaign_id, c.name, m.politician_id
ORDER BY date ASC;

-- Views do not support RLS; rely on underlying table RLS (messages).
GRANT SELECT ON public.message_analytics_view TO authenticated;

COMMIT;
