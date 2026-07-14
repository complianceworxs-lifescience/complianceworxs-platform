
ALTER TABLE public.user_state ADD COLUMN IF NOT EXISTS conversion_probability numeric DEFAULT 0;
