
-- ============ bamboo_settings ============
CREATE TABLE public.bamboo_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  subdomain TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  clockin_start TIME NOT NULL DEFAULT '08:50',
  clockin_end TIME NOT NULL DEFAULT '09:10',
  clockout_start TIME NOT NULL DEFAULT '17:50',
  clockout_end TIME NOT NULL DEFAULT '18:30',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bamboo_settings TO authenticated;
GRANT ALL ON public.bamboo_settings TO service_role;

ALTER TABLE public.bamboo_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can read own settings"
  ON public.bamboo_settings FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "users can insert own settings"
  ON public.bamboo_settings FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users can update own settings"
  ON public.bamboo_settings FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "users can delete own settings"
  ON public.bamboo_settings FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER bamboo_settings_set_updated_at
  BEFORE UPDATE ON public.bamboo_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ execution_history ============
CREATE TABLE public.execution_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  run_date DATE NOT NULL,
  planned_clock_in TIME,
  planned_clock_out TIME,
  status TEXT NOT NULL,
  error TEXT,
  bamboo_response JSONB,
  triggered_by TEXT NOT NULL DEFAULT 'cron',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX execution_history_user_date_idx
  ON public.execution_history (user_id, run_date DESC, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.execution_history TO authenticated;
GRANT ALL ON public.execution_history TO service_role;

ALTER TABLE public.execution_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can read own history"
  ON public.execution_history FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Inserts/updates happen via server functions using service role; no client write policy needed.
