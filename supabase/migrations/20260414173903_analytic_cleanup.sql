DROP TRIGGER IF EXISTS trigger_refresh_analytics_on_insert ON messages;
DROP FUNCTION IF EXISTS refresh_analytics_on_message_insert() CASCADE;
DROP FUNCTION IF EXISTS refresh_daily_analytics() CASCADE;
DROP FUNCTION IF EXISTS get_message_analytics_daily(integer) CASCADE;
DROP MATERIALIZED VIEW IF EXISTS daily_message_analytics CASCADE;
