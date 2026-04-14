-- Migration: Add RLS policies for messages table and create RLS-protected analytics view
-- Ensures staff can only see analytics for their assigned politicians
-- This migration completely replaces the existing analytics implementation

BEGIN;

-- First, completely remove the old implementation to ensure clean replacement
-- Drop old trigger and functions
DROP TRIGGER IF EXISTS trigger_refresh_analytics_on_insert ON public.messages;
DROP FUNCTION IF EXISTS refresh_analytics_on_message_insert() CASCADE;
DROP FUNCTION IF EXISTS refresh_daily_analytics() CASCADE;
DROP FUNCTION IF EXISTS get_message_analytics_daily(integer) CASCADE;

-- Drop old analytics objects safely (view vs materialized view)
DO $$
BEGIN
  -- daily_message_analytics has existed as either a VIEW or a MATERIALIZED VIEW in this repo.
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'daily_message_analytics'
      AND c.relkind = 'm'
  ) THEN
    EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS public.daily_message_analytics CASCADE';
  END IF;

  -- Drop view form (also covers cases where relkind = 'v')
  EXECUTE 'DROP VIEW IF EXISTS public.daily_message_analytics CASCADE';
END $$;

-- Drop any old views that might exist
DROP VIEW IF EXISTS public.message_analytics_view CASCADE;

-- 1) Enable RLS on messages table
ALTER TABLE IF EXISTS public.messages ENABLE ROW LEVEL SECURITY;

-- Drop existing message policies if they exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'Messages: staff can select own politicians' AND polrelid = 'public.messages'::regclass) THEN
    EXECUTE 'DROP POLICY "Messages: staff can select own politicians" ON public.messages';
  END IF;
  
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'Messages: staff can insert' AND polrelid = 'public.messages'::regclass) THEN
    EXECUTE 'DROP POLICY "Messages: staff can insert" ON public.messages';
  END IF;
END$$;

-- Allow staff to only see messages for their assigned politicians
CREATE POLICY "Messages: staff can select own politicians" ON public.messages
  FOR SELECT
  TO authenticated
  USING (
    -- User can access messages if they are staff for the message's politician
    EXISTS (
      SELECT 1 FROM public.politician_staff ps
      WHERE ps.politician_id = public.messages.politician_id
        AND ps.user_id = (SELECT auth.uid())
    )
  );

-- Allow staff to insert messages (for their assigned politicians)
CREATE POLICY "Messages: staff can insert" ON public.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- User can insert messages if they are staff for the politician
    EXISTS (
      SELECT 1 FROM public.politician_staff ps
      WHERE ps.politician_id = public.messages.politician_id
        AND ps.user_id = (SELECT auth.uid())
    )
  );

-- 2) Create RLS-protected analytics view that respects politician filtering
-- Drop existing view if it exists
DROP VIEW IF EXISTS public.message_analytics_view CASCADE;

CREATE VIEW public.message_analytics_view AS
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

-- 3) Views do not support RLS; rely on underlying table RLS (messages).
-- 4) Grant access to authenticated users for the view
GRANT SELECT ON public.message_analytics_view TO authenticated;

-- 5) Update the materialized view to include politician_id for better filtering
-- Drop existing materialized view
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'daily_message_analytics'
      AND c.relkind = 'm'
  ) THEN
    EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS public.daily_message_analytics CASCADE';
  END IF;
  EXECUTE 'DROP VIEW IF EXISTS public.daily_message_analytics CASCADE';
END $$;

-- Recreate materialized view with politician_id
CREATE MATERIALIZED VIEW public.daily_message_analytics AS
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

-- Create indexes for performance
CREATE INDEX idx_daily_message_analytics_date ON public.daily_message_analytics(date);
CREATE INDEX idx_daily_message_analytics_campaign ON public.daily_message_analytics(campaign_id);
CREATE INDEX idx_daily_message_analytics_politician ON public.daily_message_analytics(politician_id);

-- 6) Postgres does not support RLS on materialized views.
-- Restrict access via SECURITY DEFINER RPC (below) and grants.
-- Grant access to authenticated users for the materialized view
GRANT SELECT ON public.daily_message_analytics TO authenticated;

-- 7) Update the trigger function to work with the new materialized view
DROP TRIGGER IF EXISTS trigger_refresh_analytics_on_insert ON public.messages;
DROP FUNCTION IF EXISTS refresh_analytics_on_message_insert() CASCADE;
DROP FUNCTION IF EXISTS refresh_daily_analytics() CASCADE;

-- Function to refresh the materialized view
CREATE OR REPLACE FUNCTION refresh_daily_analytics()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.daily_message_analytics;
END;
$$ LANGUAGE plpgsql;

-- Trigger function to refresh view when messages are inserted
CREATE OR REPLACE FUNCTION refresh_analytics_on_message_insert()
RETURNS trigger AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.daily_message_analytics;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on messages table
CREATE TRIGGER trigger_refresh_analytics_on_insert
AFTER INSERT ON public.messages
FOR EACH STATEMENT
EXECUTE FUNCTION refresh_analytics_on_message_insert();

-- 8) Recreate analytics RPC and enforce staff filtering
CREATE OR REPLACE FUNCTION public.get_message_analytics_daily(
  days_back integer DEFAULT 7
)
RETURNS TABLE (
  date timestamp with time zone,
  campaign_id integer,
  campaign_name text,
  message_count bigint
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    a.date,
    a.campaign_id,
    a.campaign_name,
    a.message_count
  FROM public.daily_message_analytics a
  WHERE a.date >= NOW() - (days_back || ' days')::interval
    AND EXISTS (
      SELECT 1
      FROM public.politician_staff ps
      WHERE ps.politician_id = a.politician_id
        AND ps.user_id = (SELECT auth.uid())
    )
  ORDER BY a.date ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_message_analytics_daily(integer) TO authenticated;

COMMIT;
