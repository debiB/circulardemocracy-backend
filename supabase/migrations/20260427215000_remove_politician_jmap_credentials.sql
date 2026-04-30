BEGIN;

-- Legacy per-politician outbound credential model is removed.
-- Outbound authentication now uses one global service account from runtime env.
ALTER TABLE IF EXISTS public.politicians
  DROP COLUMN IF EXISTS stalwart_jmap_endpoint,
  DROP COLUMN IF EXISTS stalwart_jmap_account_id,
  DROP COLUMN IF EXISTS stalwart_username,
  DROP COLUMN IF EXISTS stalwart_app_password,
  DROP COLUMN IF EXISTS stalwart_app_password_secret_name;

COMMIT;
