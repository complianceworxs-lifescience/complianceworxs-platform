
-- Ensure user_state has the strategy column the execution layer writes to
ALTER TABLE public.user_state 
  ADD COLUMN IF NOT EXISTS current_strategy text DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS strategy_set_at timestamptz DEFAULT now();

-- Execution log — every action the system takes, timestamped
CREATE TABLE IF NOT EXISTS public.execution_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  action text NOT NULL,
  strategy text,
  triggered_by text, -- 'lock_view' | 'cta_click' | 'return_visit' | 'batch'
  executed_at timestamptz DEFAULT now(),
  result text DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_execution_log_user_id ON public.execution_log(user_id);
CREATE INDEX IF NOT EXISTS idx_execution_log_executed_at ON public.execution_log(executed_at DESC);
