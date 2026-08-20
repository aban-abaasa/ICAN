-- Structured records for CMMS specialist business modules.
-- Run after UNIFIED_BUSINESS_MANAGEMENT_AND_SUPPLIER_MARKETPLACE.sql.

CREATE TABLE IF NOT EXISTS public.cmms_specialist_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL CHECK (module_key IN ('quality', 'pharmacy', 'production', 'clinical')),
  record_type TEXT NOT NULL,
  title TEXT NOT NULL,
  reference_code TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  quantity NUMERIC(15,3),
  due_at TIMESTAMPTZ,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cmms_specialist_records_business_module
  ON public.cmms_specialist_records(business_profile_id, module_key, created_at DESC);

ALTER TABLE public.cmms_specialist_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cmms_specialist_records_read ON public.cmms_specialist_records;
CREATE POLICY cmms_specialist_records_read ON public.cmms_specialist_records
  FOR SELECT TO authenticated
  USING (public.unified_business_member(business_profile_id));

CREATE OR REPLACE FUNCTION public.cmms_create_specialist_record(
  p_business_profile_id UUID, p_module_key TEXT, p_record_type TEXT,
  p_title TEXT, p_reference_code TEXT DEFAULT NULL, p_status TEXT DEFAULT 'open',
  p_priority TEXT DEFAULT 'normal', p_quantity NUMERIC DEFAULT NULL,
  p_due_at TIMESTAMPTZ DEFAULT NULL, p_details JSONB DEFAULT '{}'::jsonb
) RETURNS public.cmms_specialist_records
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_record public.cmms_specialist_records;
BEGIN
  IF auth.uid() IS NULL OR NOT public.unified_business_member(p_business_profile_id) THEN
    RAISE EXCEPTION 'Business membership required';
  END IF;
  IF lower(trim(p_module_key)) NOT IN ('quality', 'pharmacy', 'production', 'clinical') THEN
    RAISE EXCEPTION 'Unsupported CMMS specialist module';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.business_profile_modules
    WHERE business_profile_id = p_business_profile_id
      AND module_key = lower(trim(p_module_key)) AND enabled
  ) THEN RAISE EXCEPTION 'This CMMS module is not enabled for the business'; END IF;
  INSERT INTO public.cmms_specialist_records
    (business_profile_id, module_key, record_type, title, reference_code, status, priority, quantity, due_at, details, created_by)
  VALUES
    (p_business_profile_id, lower(trim(p_module_key)), lower(trim(p_record_type)), trim(p_title),
     NULLIF(trim(p_reference_code), ''), COALESCE(NULLIF(lower(trim(p_status)), ''), 'open'),
     COALESCE(NULLIF(lower(trim(p_priority)), ''), 'normal'), p_quantity, p_due_at,
     COALESCE(p_details, '{}'::jsonb), auth.uid())
  RETURNING * INTO v_record;
  RETURN v_record;
END; $$;

CREATE OR REPLACE FUNCTION public.cmms_update_specialist_record_status(
  p_record_id UUID, p_status TEXT
) RETURNS public.cmms_specialist_records
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_record public.cmms_specialist_records;
BEGIN
  UPDATE public.cmms_specialist_records
     SET status = lower(trim(p_status)), updated_at = now()
   WHERE id = p_record_id
     AND public.unified_business_member(business_profile_id)
  RETURNING * INTO v_record;
  IF v_record.id IS NULL THEN RAISE EXCEPTION 'Record not found or access denied'; END IF;
  RETURN v_record;
END; $$;

REVOKE ALL ON FUNCTION public.cmms_create_specialist_record(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TIMESTAMPTZ, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cmms_update_specialist_record_status(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cmms_create_specialist_record(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TIMESTAMPTZ, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cmms_update_specialist_record_status(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
