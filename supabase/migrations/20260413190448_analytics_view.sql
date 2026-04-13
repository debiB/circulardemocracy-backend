DROP MATERIALIZED VIEW IF EXISTS daily_message_analytics CASCADE;
DROP VIEW IF EXISTS daily_message_analytics CASCADE;
CREATE VIEW daily_message_analytics AS
SELECT 
  date_trunc('day', m.received_at) AS date,
  m.campaign_id,
  c.name AS campaign_name,
  COUNT(*) AS message_count,
  politician_id
FROM messages m
INNER JOIN campaigns c ON m.campaign_id = c.id
GROUP BY date_trunc('day', m.received_at), m.campaign_id, c.name, politician_id
ORDER BY date ASC;
