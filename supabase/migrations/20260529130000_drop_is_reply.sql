-- Drop is_reply column from messages table
-- We are replacing its functionality with processing_status = 'followup'

ALTER TABLE public.messages DROP COLUMN IF EXISTS is_reply;
