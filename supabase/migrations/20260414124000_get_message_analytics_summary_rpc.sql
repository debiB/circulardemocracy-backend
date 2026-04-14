-- RPC: get_message_analytics_summary
-- Purpose: return dashboard analytics as a pre-aggregated JSON payload
-- to avoid frontend-side grouping/reduction logic.

BEGIN;

DROP FUNCTION IF EXISTS public.get_message_analytics_summary(integer) CASCADE;

CREATE OR REPLACE FUNCTION public.get_message_analytics_summary(
  days_back integer DEFAULT 7
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
AS $$
  WITH base AS (
    SELECT
      date::date AS date,
      campaign_id,
      campaign_name,
      message_count::bigint AS message_count
    FROM public.get_message_analytics_daily(days_back)
  ),
  totals AS (
    SELECT COALESCE(SUM(message_count), 0)::bigint AS total_messages
    FROM base
  ),
  by_day AS (
    SELECT
      date,
      SUM(message_count)::bigint AS count
    FROM base
    GROUP BY date
    ORDER BY date
  ),
  by_campaign AS (
    SELECT
      campaign_id AS "campaignId",
      MIN(campaign_name) AS "campaignName",
      SUM(message_count)::bigint AS count
    FROM base
    GROUP BY campaign_id
    ORDER BY campaign_id
  ),
  by_day_campaign AS (
    SELECT
      date,
      jsonb_object_agg(campaign_name, message_count ORDER BY campaign_name) AS campaigns
    FROM base
    GROUP BY date
    ORDER BY date
  )
  SELECT jsonb_build_object(
    'totalMessages', totals.total_messages,
    'repliesSent', 0,
    'pendingReplies', totals.total_messages,
    'messagesByDay', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('date', date, 'count', count) ORDER BY date) FROM by_day),
      '[]'::jsonb
    ),
    'messagesByCampaign', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'campaignId', "campaignId",
            'campaignName', "campaignName",
            'count', count
          )
          ORDER BY "campaignId"
        )
        FROM by_campaign
      ),
      '[]'::jsonb
    ),
    'dailyCampaignData', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object('date', date, 'campaigns', campaigns)
          ORDER BY date
        )
        FROM by_day_campaign
      ),
      '[]'::jsonb
    )
  )
  FROM totals;
$$;

GRANT EXECUTE ON FUNCTION public.get_message_analytics_summary(integer) TO authenticated;

COMMIT;
