-- Weekly roll-up of message analytics (RLS via underlying public.messages).

BEGIN;

CREATE OR REPLACE VIEW public.message_analytics_weekly_view AS
SELECT
  date_trunc('week', m.received_at) AS date,
  m.campaign_id,
  c.name AS campaign_name,
  m.politician_id,
  COUNT(*) AS message_count
FROM public.messages m
INNER JOIN public.campaigns c ON m.campaign_id = c.id
GROUP BY
  date_trunc('week', m.received_at),
  m.campaign_id,
  c.name,
  m.politician_id
ORDER BY date ASC;

GRANT SELECT ON public.message_analytics_weekly_view TO authenticated;

COMMIT;
