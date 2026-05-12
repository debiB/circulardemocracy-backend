-- Remove legacy daily analytics view; app uses message_analytics_weekly_view only.
-- This is a VIEW (not a table). No data is stored in the view itself.

BEGIN;

DROP VIEW IF EXISTS public.message_analytics_view CASCADE;

COMMIT;
