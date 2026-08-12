CREATE TABLE IF NOT EXISTS public.cmms_school_fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmms_company_id UUID NOT NULL REFERENCES public.cmms_company_profiles(id) ON DELETE CASCADE,
  business_profile_id UUID REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  student_user_id UUID,
  student_department_id UUID REFERENCES public.business_departments(id) ON DELETE SET NULL,
  student_name TEXT NOT NULL, class_name TEXT NOT NULL, term TEXT NOT NULL,
  amount NUMERIC(18,2) NOT NULL CHECK (amount >= 0), due_date DATE,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'partial', 'paid', 'waived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cmms_school_fees
  ADD COLUMN IF NOT EXISTS business_profile_id UUID REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS student_user_id UUID,
  ADD COLUMN IF NOT EXISTS student_department_id UUID REFERENCES public.business_departments(id) ON DELETE SET NULL;

-- Older CMMS installations may not yet have these account-link columns.
ALTER TABLE public.cmms_users
  ADD COLUMN IF NOT EXISTS ican_user_id UUID,
  ADD COLUMN IF NOT EXISTS department_id UUID;

CREATE INDEX IF NOT EXISTS idx_cmms_school_fees_student
  ON public.cmms_school_fees(business_profile_id, student_user_id, term);

-- Let school administrators see the real profile names of students assigned
-- to their school, so the CMMS fee assignment list does not stay on old labels.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cmms_school_admin_read_student_profiles ON public.profiles;
CREATE POLICY cmms_school_admin_read_student_profiles
  ON public.profiles FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1
        FROM public.business_member_roles student_bmr
        JOIN public.business_roles student_br
          ON student_br.id = student_bmr.business_role_id
        JOIN public.cmms_company_profiles cp
          ON cp.pichin_business_profile_id = student_bmr.business_profile_id
       WHERE student_bmr.auth_user_id = profiles.id
         AND student_bmr.status = 'active'
         AND student_br.role_key = 'student'
         AND student_br.is_active = TRUE
         AND public.cmms_is_company_admin(cp.id)
    )
  );

CREATE OR REPLACE FUNCTION public.update_school_student_identity(
  p_business_profile_id UUID,
  p_full_name TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_full_name TEXT := trim(COALESCE(p_full_name, ''));
  v_email TEXT := lower(trim(COALESCE(auth.jwt() ->> 'email', '')));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF v_full_name = '' THEN
    RAISE EXCEPTION 'Student name is required';
  END IF;
  IF v_email = '' THEN
    SELECT lower(email) INTO v_email FROM auth.users WHERE id = auth.uid();
  END IF;
  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'Authenticated email is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.business_member_roles bmr
      JOIN public.business_roles br ON br.id = bmr.business_role_id
     WHERE bmr.business_profile_id = p_business_profile_id
       AND bmr.auth_user_id = auth.uid()
       AND bmr.status = 'active'
       AND br.role_key = 'student'
       AND br.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Student role assignment required';
  END IF;

  INSERT INTO public.profiles (id, email, full_name, updated_at)
  VALUES (auth.uid(), v_email, v_full_name, now())
  ON CONFLICT (id) DO UPDATE SET
    email = COALESCE(NULLIF(public.profiles.email, ''), EXCLUDED.email),
    full_name = EXCLUDED.full_name,
    updated_at = now();

  UPDATE public.cmms_school_fees
     SET student_name = v_full_name,
         updated_at = now()
   WHERE business_profile_id = p_business_profile_id
     AND student_user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_school_student_identity(UUID, TEXT) TO authenticated;

-- CMMS and business roles are stored separately. When an administrator gives
-- a user the CMMS Student role, link that ICAN account to the school's
-- business Student role as well, so fees can be assigned and viewed.
CREATE OR REPLACE FUNCTION public.sync_cmms_student_business_membership(
  p_company_id UUID,
  p_cmms_user_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_business_profile_id UUID;
  v_student_user_id UUID;
  v_department_id UUID;
  v_business_department_id UUID;
  v_cmms_department_name TEXT;
  v_student_role_id UUID;
BEGIN
  IF NOT public.cmms_is_company_admin(p_company_id) THEN
    RAISE EXCEPTION 'Only a CMMS administrator can assign students';
  END IF;

  SELECT cp.pichin_business_profile_id, cu.ican_user_id, cu.department_id
    INTO v_business_profile_id, v_student_user_id, v_department_id
    FROM public.cmms_company_profiles cp
    JOIN public.cmms_users cu ON cu.cmms_company_id = cp.id
   WHERE cp.id = p_company_id
     AND cu.id = p_cmms_user_id
     AND cu.is_active = TRUE;

  IF v_business_profile_id IS NULL THEN
    RAISE EXCEPTION 'Link this CMMS company to its school business profile first';
  END IF;
  IF v_student_user_id IS NULL THEN
    SELECT user_id INTO v_student_user_id
      FROM public.all_users
     WHERE lower(email) = lower((SELECT email FROM public.cmms_users WHERE id = p_cmms_user_id))
     LIMIT 1;
  END IF;
  IF v_student_user_id IS NULL THEN
    RAISE EXCEPTION 'The selected CMMS user is not linked to an ICAN account';
  END IF;

  SELECT id INTO v_student_role_id
    FROM public.business_roles
   WHERE business_profile_id = v_business_profile_id
     AND role_key = 'student'
     AND is_active = TRUE;
  IF v_student_role_id IS NULL THEN
    RAISE EXCEPTION 'The school business profile has no active Student role';
  END IF;

  -- A CMMS department UUID belongs to cmms_departments, whereas a student
  -- business role requires a business_departments UUID. Map by department
  -- name when both exist; otherwise leave it NULL rather than failing the
  -- student assignment.
  SELECT department_name INTO v_cmms_department_name
    FROM public.cmms_departments
   WHERE id = v_department_id;
  IF v_cmms_department_name IS NOT NULL THEN
    SELECT id INTO v_business_department_id
      FROM public.business_departments
     WHERE business_profile_id = v_business_profile_id
       AND lower(department_name) = lower(v_cmms_department_name)
     LIMIT 1;
  END IF;

  UPDATE public.business_member_roles
     SET status = 'active', department_id = v_business_department_id
   WHERE business_profile_id = v_business_profile_id
     AND auth_user_id = v_student_user_id
     AND business_role_id = v_student_role_id;

  IF NOT FOUND THEN
    INSERT INTO public.business_member_roles
      (business_profile_id, auth_user_id, business_role_id, department_id, status, assigned_by)
    VALUES
      (v_business_profile_id, v_student_user_id, v_student_role_id, v_business_department_id, 'active', auth.uid());
  END IF;

  UPDATE public.cmms_users
     SET ican_user_id = v_student_user_id, updated_at = now()
   WHERE id = p_cmms_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_cmms_student_business_membership(UUID, UUID) TO authenticated;

-- Direct wallet payment for a student when the school has not yet created a
-- specific fee obligation. This records the wallet transfer as a school-fee
-- payment without granting the student access to create or alter fee records.
CREATE OR REPLACE FUNCTION public.pay_school_fee_to_school_wallet(
  p_business_profile_id UUID,
  p_amount_ugx NUMERIC,
  p_note TEXT DEFAULT 'School fees payment'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_school_owner_id UUID;
  v_payment_ican NUMERIC(18,8);
  v_reference_id UUID := gen_random_uuid();
  v_transfer JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_business_profile_id IS NULL OR COALESCE(p_amount_ugx, 0) <= 0 THEN
    RAISE EXCEPTION 'A school and a positive payment amount are required';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.business_member_roles bmr
      JOIN public.business_roles br ON br.id = bmr.business_role_id
      JOIN public.business_role_permissions brp ON brp.business_role_id = br.id
     WHERE bmr.business_profile_id = p_business_profile_id
       AND bmr.auth_user_id = auth.uid()
       AND bmr.status = 'active'
       AND br.role_key = 'student'
       AND br.is_active = TRUE
       AND brp.permission_key = 'pay_own_school_fees_wallet'
       AND brp.allowed = TRUE
  ) THEN
    RAISE EXCEPTION 'Student fee-payment permission required';
  END IF;

  SELECT user_id INTO v_school_owner_id
    FROM public.business_profiles
   WHERE id = p_business_profile_id
     AND COALESCE(status, 'active') = 'active';
  IF v_school_owner_id IS NULL THEN
    RAISE EXCEPTION 'School payment wallet is unavailable';
  END IF;

  v_payment_ican := ROUND(p_amount_ugx / 5000, 8);
  -- Six arguments work with both the original wallet RPC and the newer
  -- contextual version (whose additional parameters have defaults).
  v_transfer := public.transfer_ican(
    auth.uid(), v_school_owner_id, v_payment_ican,
    COALESCE(NULLIF(trim(p_note), ''), 'School fees payment'),
    'digital-city-era', v_reference_id::TEXT
  );
  IF COALESCE((v_transfer ->> 'success')::BOOLEAN, FALSE) = FALSE THEN
    RAISE EXCEPTION '%', COALESCE(v_transfer ->> 'error', 'Wallet payment failed');
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'transaction_id', v_transfer ->> 'out_tx_id',
    'reference_id', v_reference_id,
    'amount_ugx', p_amount_ugx,
    'amount_ican', v_payment_ican
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pay_school_fee_to_school_wallet(UUID, NUMERIC, TEXT) TO authenticated;

-- Students may correct their own name, class and term on an obligation. They
-- cannot change the amount, due date, status or another student's record.
CREATE OR REPLACE FUNCTION public.update_own_school_fee_details(
  p_fee_id UUID,
  p_student_name TEXT,
  p_class_name TEXT,
  p_term TEXT
) RETURNS public.cmms_school_fees
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_fee public.cmms_school_fees%ROWTYPE;
  v_name TEXT := trim(COALESCE(p_student_name, ''));
  v_class TEXT := trim(COALESCE(p_class_name, ''));
  v_term TEXT := trim(COALESCE(p_term, ''));
  v_email TEXT := lower(trim(COALESCE(auth.jwt() ->> 'email', '')));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF v_name = '' OR v_class = '' OR v_term = '' THEN
    RAISE EXCEPTION 'Student name, class and term are required';
  END IF;
  IF v_email = '' THEN
    SELECT lower(email) INTO v_email FROM auth.users WHERE id = auth.uid();
  END IF;
  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'Authenticated email is required';
  END IF;
  SELECT * INTO v_fee FROM public.cmms_school_fees
   WHERE id = p_fee_id AND student_user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This fee is not assigned to your account'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.business_member_roles bmr
    JOIN public.business_roles br ON br.id = bmr.business_role_id
    WHERE bmr.business_profile_id = v_fee.business_profile_id
      AND bmr.auth_user_id = auth.uid() AND bmr.status = 'active'
      AND br.role_key = 'student' AND br.is_active = TRUE
  ) THEN RAISE EXCEPTION 'Student role assignment required'; END IF;

  INSERT INTO public.profiles (id, email, full_name, updated_at)
  VALUES (auth.uid(), v_email, v_name, now())
  ON CONFLICT (id) DO UPDATE SET
    email = COALESCE(NULLIF(public.profiles.email, ''), EXCLUDED.email),
    full_name = EXCLUDED.full_name,
    updated_at = now();
  UPDATE public.cmms_school_fees
     SET student_name = v_name, class_name = v_class, term = v_term, updated_at = now()
   WHERE id = p_fee_id
   RETURNING * INTO v_fee;
  RETURN v_fee;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_own_school_fee_details(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- A student can pay only their own unpaid obligation.  The fee is stored in
-- UGX, while the ICAN wallet transfer uses the locked 5,000 UGX per ICAN rate.
-- This RPC performs the identity, role and fee ownership checks before it
-- calls the wallet transfer and marks the obligation paid.
CREATE OR REPLACE FUNCTION public.pay_own_school_fee(
  p_fee_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_fee public.cmms_school_fees%ROWTYPE;
  v_school_owner_id UUID;
  v_payment_ican NUMERIC(18,8);
  v_transfer JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_fee
    FROM public.cmms_school_fees
   WHERE id = p_fee_id
   FOR UPDATE;

  IF NOT FOUND OR v_fee.student_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'This fee is not assigned to your account';
  END IF;
  IF v_fee.status NOT IN ('unpaid', 'partial') THEN
    RAISE EXCEPTION 'This fee is no longer payable';
  END IF;
  IF v_fee.business_profile_id IS NULL THEN
    RAISE EXCEPTION 'This fee is not linked to a school business account';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.business_member_roles bmr
      JOIN public.business_roles br ON br.id = bmr.business_role_id
      JOIN public.business_role_permissions brp ON brp.business_role_id = br.id
     WHERE bmr.business_profile_id = v_fee.business_profile_id
       AND bmr.auth_user_id = auth.uid()
       AND bmr.status = 'active'
       AND br.role_key = 'student'
       AND br.is_active = TRUE
       AND brp.permission_key = 'pay_own_school_fees_wallet'
       AND brp.allowed = TRUE
  ) THEN
    RAISE EXCEPTION 'Student fee-payment permission required';
  END IF;

  SELECT user_id INTO v_school_owner_id
    FROM public.business_profiles
   WHERE id = v_fee.business_profile_id;
  IF v_school_owner_id IS NULL THEN
    RAISE EXCEPTION 'School payment wallet is unavailable';
  END IF;

  v_payment_ican := ROUND(v_fee.amount / 5000, 8);
  IF v_payment_ican <= 0 THEN
    RAISE EXCEPTION 'Fee amount must be greater than zero';
  END IF;

  v_transfer := public.transfer_ican(
    auth.uid(), v_school_owner_id, v_payment_ican,
    format('School fee: %s (%s)', v_fee.class_name, v_fee.term),
    'digital-city-era', v_fee.id::TEXT
  );
  IF COALESCE((v_transfer ->> 'success')::BOOLEAN, FALSE) = FALSE THEN
    RAISE EXCEPTION '%', COALESCE(v_transfer ->> 'error', 'Wallet payment failed');
  END IF;

  UPDATE public.cmms_school_fees
     SET status = 'paid', updated_at = now()
   WHERE id = v_fee.id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'transaction_id', v_transfer ->> 'out_tx_id',
    'fee_id', v_fee.id,
    'amount_ugx', v_fee.amount,
    'amount_ican', v_payment_ican
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pay_own_school_fee(UUID) TO authenticated;

ALTER TABLE public.cmms_school_fees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cmms_school_fees_member_access ON public.cmms_school_fees;
CREATE POLICY cmms_school_fees_member_access ON public.cmms_school_fees FOR ALL TO authenticated
USING (
  (
    EXISTS (SELECT 1 FROM public.cmms_users cu WHERE lower(cu.email) = lower(COALESCE(auth.jwt() ->> 'email', '')) AND cu.cmms_company_id = cmms_school_fees.cmms_company_id AND cu.is_active)
    AND NOT EXISTS (
      SELECT 1 FROM public.business_member_roles bmr
      JOIN public.business_roles br ON br.id = bmr.business_role_id
      WHERE bmr.business_profile_id = cmms_school_fees.business_profile_id
        AND bmr.auth_user_id = auth.uid()
        AND bmr.status = 'active'
        AND br.role_key = 'student'
        AND br.is_active = TRUE
    )
  )
  OR (
    business_profile_id IS NOT NULL
    AND student_user_id = auth.uid()
    AND EXISTS (
      SELECT 1
        FROM public.business_member_roles bmr
        JOIN public.business_roles br ON br.id = bmr.business_role_id
        JOIN public.business_role_permissions brp ON brp.business_role_id = br.id
       WHERE bmr.business_profile_id = cmms_school_fees.business_profile_id
         AND bmr.auth_user_id = auth.uid()
         AND bmr.status = 'active'
         AND br.role_key = 'student'
         AND br.is_active = TRUE
         AND brp.permission_key = 'view_own_student_fees'
         AND brp.allowed = TRUE
    )
  )
)
WITH CHECK (EXISTS (SELECT 1 FROM public.cmms_users cu WHERE lower(cu.email) = lower(COALESCE(auth.jwt() ->> 'email', '')) AND cu.cmms_company_id = cmms_school_fees.cmms_company_id AND cu.is_active));

-- Make new RPCs available to PostgREST/Supabase immediately after this script.
NOTIFY pgrst, 'reload schema';
