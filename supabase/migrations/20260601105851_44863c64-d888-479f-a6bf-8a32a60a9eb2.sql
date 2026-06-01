
ALTER TABLE public.bamboo_settings
  ADD COLUMN lunch_out_start time without time zone NOT NULL DEFAULT '13:30:00',
  ADD COLUMN lunch_out_end   time without time zone NOT NULL DEFAULT '14:00:00',
  ADD COLUMN lunch_in_start  time without time zone NOT NULL DEFAULT '14:30:00',
  ADD COLUMN lunch_in_end    time without time zone NOT NULL DEFAULT '15:00:00';

ALTER TABLE public.execution_history
  ADD COLUMN planned_lunch_out time without time zone,
  ADD COLUMN planned_lunch_in  time without time zone;
