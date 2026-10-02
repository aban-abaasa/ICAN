-- ============================================================================
-- BRANCH WALLETS UNDER A MOTHER ACCOUNT, WITH ASSIGNED APPROVERS
-- ============================================================================
-- Run AFTER:
--   * BUSINESS_OWNERSHIP_TREE_CMMS_FEED.sql   (ownership tree + wallet_control)
--   * PITCHIN_BUSINESS_PROFILE_ICAN_WALLET.sql, PITCHIN_BUSINESS_WALLET_CMMS_FINANCE_APPROVAL.sql,
--     UNIFIED_BUSINESS_WALLET_OPERATIONS.sql, ICAN_BUSINESS_WALLET_TRANSFERS.sql
--     (ican_business_wallets, ..._transactions, pitchin_execute_business_wallet_transfer)
-- Safe to run more than once.
--
-- Every Pitchin business profile already owns a dedicated business wallet, so a
-- branch already HAS its own wallet account. This file ties those wallets to the
-- mother account through the ownership tree and adds governance. It never moves
-- money itself: every transfer is still a request executed by the existing
-- pitchin_execute_business_wallet_transfer.
--
--  * WALLET CONTROL (per ownership link, consent based, like CMMS sharing):
--      none    the mother cannot see the branch wallet
--      view    the mother sees balance and activity
--      govern  the mother also sets limits, assigns approvers, freezes, funds, sweeps
--    The branch can lower it any time; only the branch can raise it.
--  * APPROVAL LADDER per wallet (branch_wallet_policies). Assigned approvers sign
--    with their OWN approval PIN, so the business-wallet PIN is never shared:
--        up to the branch limit   -> N branch approvers
--        above it                 -> branch approvers + M mother approvers
--        above it, no mother      -> the owners, through the existing approval + PIN
--    The person who raised a request can never approve it. Any rejection stops it.
--  * HARD LIMITS enforced for every request, whichever screen creates it: per
--    transaction, per day, and a FREEZE kill-switch (blocks new requests and any
--    completion, by anyone).
--  * MOTHER OPERATIONS: fund a branch, sweep surplus back, and ALLOWANCES: a
--    schedule that tops a branch wallet up to a float (or a fixed amount) and
--    sweeps what exceeds a ceiling. Allowances only ever create PENDING requests;
--    approvals stay human.
--  * Everything is written to an append-only event log.
-- ============================================================================

SET check_function_bodies = off;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- 1. TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.branch_wallet_policies (
  business_profile_id        UUID PRIMARY KEY REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  enabled                    BOOLEAN NOT NULL DEFAULT FALSE,
  wallet_label               TEXT,
  per_tx_limit_ican          NUMERIC(18, 8) CHECK (per_tx_limit_ican IS NULL OR per_tx_limit_ican > 0),
  daily_limit_ican           NUMERIC(18, 8) CHECK (daily_limit_ican IS NULL OR daily_limit_ican > 0),
  branch_approval_up_to_ican NUMERIC(18, 8) NOT NULL DEFAULT 1000 CHECK (branch_approval_up_to_ican >= 0),
  branch_approvals_required  INT NOT NULL DEFAULT 1 CHECK (branch_approvals_required BETWEEN 1 AND 5),
  mother_approvals_required  INT NOT NULL DEFAULT 1 CHECK (mother_approvals_required BETWEEN 1 AND 3),
  allow_owner_override       BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by                 UUID,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.branch_wallet_approvers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL,
  level               TEXT NOT NULL CHECK (level IN ('branch', 'mother')),
  max_amount_ican     NUMERIC(18, 8) CHECK (max_amount_ican IS NULL OR max_amount_ican > 0),
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  added_by            UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_profile_id, user_id, level)
);
CREATE INDEX IF NOT EXISTS idx_bwa_user ON public.branch_wallet_approvers(user_id) WHERE active;

-- One approval PIN per person (hashed). Separate from the business-wallet PIN.
CREATE TABLE IF NOT EXISTS public.branch_approver_pins (
  user_id      UUID PRIMARY KEY,
  pin_hash     TEXT NOT NULL,
  failed_count INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  set_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.branch_wallet_stage_approvals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES public.ican_business_wallet_transactions(id) ON DELETE CASCADE,
  approver_id    UUID NOT NULL,
  approver_email TEXT,
  level          TEXT NOT NULL CHECK (level IN ('branch', 'mother')),
  decision       TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  comment        TEXT,
  decided_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (transaction_id, approver_id)
);

CREATE TABLE IF NOT EXISTS public.branch_wallet_allowances (
  child_business_profile_id  UUID PRIMARY KEY REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  parent_business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  mode              TEXT NOT NULL DEFAULT 'top_up' CHECK (mode IN ('top_up', 'fixed')),
  amount_ican       NUMERIC(18, 8) CHECK (amount_ican IS NULL OR amount_ican > 0),   -- fixed mode
  float_target_ican NUMERIC(18, 8) CHECK (float_target_ican IS NULL OR float_target_ican > 0),  -- top_up mode
  period            TEXT NOT NULL DEFAULT 'monthly' CHECK (period IN ('weekly', 'monthly')),
  sweep_above_ican  NUMERIC(18, 8) CHECK (sweep_above_ican IS NULL OR sweep_above_ican > 0),
  next_run_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_run_at       TIMESTAMPTZ,
  created_by        UUID NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((mode = 'fixed' AND amount_ican IS NOT NULL) OR (mode = 'top_up' AND float_target_ican IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.branch_wallet_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL,
  event               TEXT NOT NULL,
  actor_id            UUID,
  actor_email         TEXT,
  details             JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bwe_business ON public.branch_wallet_events(business_profile_id, created_at DESC);

CREATE OR REPLACE FUNCTION public._bwe_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'branch_wallet_events is append-only';
END;
$$;
DROP TRIGGER IF EXISTS trg_bwe_append_only ON public.branch_wallet_events;
CREATE TRIGGER trg_bwe_append_only BEFORE UPDATE OR DELETE ON public.branch_wallet_events
  FOR EACH ROW EXECUTE FUNCTION public._bwe_append_only();

-- Everything is read and written through the functions below.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['branch_wallet_policies', 'branch_wallet_approvers', 'branch_approver_pins',
                           'branch_wallet_stage_approvals', 'branch_wallet_allowances', 'branch_wallet_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

-- ============================================================================
-- 2. WHO MAY DO WHAT
-- ============================================================================

CREATE OR REPLACE FUNCTION public._bwp_log(p_business UUID, p_event TEXT, p_details JSONB DEFAULT '{}'::JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.branch_wallet_events (business_profile_id, event, actor_id, actor_email, details)
  VALUES (p_business, p_event, auth.uid(), public._cmms_caller_email(), COALESCE(p_details, '{}'::JSONB));
END;
$$;

-- Is a given person an owner or active co-owner of a business?
CREATE OR REPLACE FUNCTION public._bwp_user_is_owner(p_user UUID, p_business UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_user IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.business_profiles bp WHERE bp.id = p_business AND bp.user_id = p_user)
    OR EXISTS (SELECT 1 FROM public.business_co_owners co
               WHERE co.business_profile_id = p_business AND co.user_id = p_user
                 AND lower(co.status) IN ('active', 'approved')));
$$;

-- The caller's power over a business wallet:
--   3 = administrator of that business itself, 2 = governs it as an ancestor,
--   1 = may view it as an ancestor, 0 = nothing.
CREATE OR REPLACE FUNCTION public._bwp_rank_over(p_business UUID)
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT GREATEST(
    CASE WHEN public._bol_is_business_admin(p_business) THEN 3 ELSE 0 END,
    COALESCE((SELECT MAX(a.wallet_rank) FROM public._bol_ancestors(p_business) a
              WHERE a.wallet_rank > 0 AND public._bol_is_business_admin(a.ancestor_id)), 0));
$$;

-- Is this wallet governed by an ancestor (every link on the path says 'govern')?
CREATE OR REPLACE FUNCTION public._bwp_governed_by_ancestor(p_business UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public._bol_ancestors(p_business) a WHERE a.wallet_rank = 2);
$$;

-- May the caller set limits / approvers / unfreeze? The governing ancestor if
-- there is one, otherwise the business's own administrator.
CREATE OR REPLACE FUNCTION public._bwp_can_govern(p_business UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public._bwp_governed_by_ancestor(p_business) THEN
      EXISTS (SELECT 1 FROM public._bol_ancestors(p_business) a
              WHERE a.wallet_rank = 2 AND public._bol_is_business_admin(a.ancestor_id))
    ELSE public._bol_is_business_admin(p_business)
  END;
$$;

-- ============================================================================
-- 3. LIMITS AND FREEZE, FOR EVERY REQUEST WHATEVER CREATES IT
-- ============================================================================

CREATE OR REPLACE FUNCTION public._bwp_tx_guard_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pol public.branch_wallet_policies; v_status TEXT; v_today NUMERIC;
BEGIN
  IF COALESCE(to_jsonb(NEW)->>'direction', 'out') = 'in' THEN RETURN NEW; END IF;

  SELECT w.status INTO v_status FROM public.ican_business_wallets w WHERE w.business_profile_id = NEW.business_profile_id;
  IF v_status IS NOT NULL AND v_status <> 'active' THEN
    RAISE EXCEPTION 'This business wallet is % and cannot start new payments', v_status;
  END IF;

  SELECT * INTO v_pol FROM public.branch_wallet_policies WHERE business_profile_id = NEW.business_profile_id AND enabled;
  IF FOUND THEN
    IF v_pol.per_tx_limit_ican IS NOT NULL AND NEW.amount_ican > v_pol.per_tx_limit_ican THEN
      RAISE EXCEPTION 'This wallet allows at most % ICAN per payment', v_pol.per_tx_limit_ican;
    END IF;
    IF v_pol.daily_limit_ican IS NOT NULL THEN
      SELECT COALESCE(SUM(t.amount_ican), 0) INTO v_today
      FROM public.ican_business_wallet_transactions t
      WHERE t.business_profile_id = NEW.business_profile_id
        AND COALESCE(to_jsonb(t)->>'direction', 'out') = 'out'
        AND t.status IN ('pending_approval', 'completed')
        AND t.created_at >= date_trunc('day', NOW());
      IF v_today + NEW.amount_ican > v_pol.daily_limit_ican THEN
        RAISE EXCEPTION 'This wallet’s daily limit of % ICAN would be exceeded (% already requested today)',
          v_pol.daily_limit_ican, v_today;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public._bwp_tx_guard_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pol public.branch_wallet_policies; v_status TEXT;
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed'
     AND COALESCE(to_jsonb(NEW)->>'direction', 'out') = 'out' THEN
    SELECT w.status INTO v_status FROM public.ican_business_wallets w WHERE w.business_profile_id = NEW.business_profile_id;
    IF v_status IS NOT NULL AND v_status <> 'active' THEN
      RAISE EXCEPTION 'This business wallet is % and cannot release payments', v_status;
    END IF;
    SELECT * INTO v_pol FROM public.branch_wallet_policies WHERE business_profile_id = NEW.business_profile_id AND enabled;
    IF FOUND AND NOT v_pol.allow_owner_override
       AND COALESCE(current_setting('bwp.engine', TRUE), '') <> 'on' THEN
      RAISE EXCEPTION 'This wallet releases payments only through its approval ladder';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bwp_tx_guard_insert ON public.ican_business_wallet_transactions;
CREATE TRIGGER trg_bwp_tx_guard_insert BEFORE INSERT ON public.ican_business_wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION public._bwp_tx_guard_insert();
DROP TRIGGER IF EXISTS trg_bwp_tx_guard_update ON public.ican_business_wallet_transactions;
CREATE TRIGGER trg_bwp_tx_guard_update BEFORE UPDATE OF status ON public.ican_business_wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION public._bwp_tx_guard_update();

-- The existing executor (pitchin_execute_business_wallet_transfer) debits the paying wallet and credits
-- recipient_user_id only; it never credits a recipient BUSINESS. Branch funding and sweeps are the
-- only transfers this layer creates between business wallets, so complete them here: when one of them
-- turns 'completed', credit the recipient business wallet in the same transaction. Other transfer
-- kinds are left exactly as they were.
CREATE OR REPLACE FUNCTION public._bwp_credit_branch_recipient()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed'
     AND NEW.recipient_business_profile_id IS NOT NULL
     AND COALESCE(to_jsonb(NEW)->>'operation_type', '') IN ('branch_funding', 'branch_sweep') THEN
    INSERT INTO public.ican_business_wallets (business_profile_id, created_by)
    SELECT bp.id, bp.user_id FROM public.business_profiles bp WHERE bp.id = NEW.recipient_business_profile_id
    ON CONFLICT (business_profile_id) DO NOTHING;
    UPDATE public.ican_business_wallets
       SET ican_balance = ican_balance + NEW.amount_ican,
           total_earned = COALESCE(total_earned, 0) + NEW.amount_ican,
           updated_at = NOW()
     WHERE business_profile_id = NEW.recipient_business_profile_id;
    PERFORM public._bwp_log(NEW.business_profile_id, 'branch_transfer_credited',
      jsonb_build_object('transaction_id', NEW.id, 'recipient', NEW.recipient_business_profile_id,
                         'amount_ican', NEW.amount_ican, 'kind', to_jsonb(NEW)->>'operation_type'));
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_bwp_credit_recipient ON public.ican_business_wallet_transactions;
CREATE TRIGGER trg_bwp_credit_recipient AFTER UPDATE OF status ON public.ican_business_wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION public._bwp_credit_branch_recipient();

-- ============================================================================
-- 4. POLICY, APPROVERS, FREEZE
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_bwp_set_policy(p_business UUID, p_policy JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_has_parent BOOLEAN; v_row public.branch_wallet_policies;
BEGIN
  IF NOT public._bwp_can_govern(p_business) THEN
    RAISE EXCEPTION 'Only the wallet’s governing administrator can change its rules';
  END IF;
  v_has_parent := public._bwp_governed_by_ancestor(p_business);

  INSERT INTO public.branch_wallet_policies (business_profile_id) VALUES (p_business) ON CONFLICT DO NOTHING;
  UPDATE public.branch_wallet_policies SET
    enabled = COALESCE((p_policy->>'enabled')::BOOLEAN, enabled),
    wallet_label = CASE WHEN p_policy ? 'wallet_label' THEN NULLIF(btrim(p_policy->>'wallet_label'), '') ELSE wallet_label END,
    per_tx_limit_ican = CASE WHEN p_policy ? 'per_tx_limit_ican' THEN NULLIF(p_policy->>'per_tx_limit_ican', '')::NUMERIC ELSE per_tx_limit_ican END,
    daily_limit_ican = CASE WHEN p_policy ? 'daily_limit_ican' THEN NULLIF(p_policy->>'daily_limit_ican', '')::NUMERIC ELSE daily_limit_ican END,
    branch_approval_up_to_ican = COALESCE(NULLIF(p_policy->>'branch_approval_up_to_ican', '')::NUMERIC, branch_approval_up_to_ican),
    branch_approvals_required = COALESCE(NULLIF(p_policy->>'branch_approvals_required', '')::INT, branch_approvals_required),
    mother_approvals_required = COALESCE(NULLIF(p_policy->>'mother_approvals_required', '')::INT, mother_approvals_required),
    -- A wallet with no mother above it must keep its owners able to approve.
    allow_owner_override = CASE WHEN NOT v_has_parent THEN TRUE
                                ELSE COALESCE((p_policy->>'allow_owner_override')::BOOLEAN, allow_owner_override) END,
    updated_by = auth.uid(), updated_at = NOW()
  WHERE business_profile_id = p_business RETURNING * INTO v_row;

  PERFORM public._bwp_log(p_business, 'policy_set', to_jsonb(v_row) - 'updated_by');
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_bwp_assign_approver(
  p_business UUID, p_email TEXT, p_level TEXT, p_max_amount NUMERIC DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user UUID; v_ok BOOLEAN;
BEGIN
  IF p_level NOT IN ('branch', 'mother') THEN RAISE EXCEPTION 'Level must be branch or mother'; END IF;
  IF NOT public._bwp_can_govern(p_business) THEN
    RAISE EXCEPTION 'Only the wallet’s governing administrator can assign approvers';
  END IF;
  SELECT id INTO v_user FROM auth.users WHERE lower(email) = lower(btrim(p_email)) LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'No ICAN account was found for %', p_email; END IF;

  IF p_level = 'mother' THEN
    -- a mother approver must own (or co-own) a business that governs this wallet
    SELECT EXISTS (SELECT 1 FROM public._bol_ancestors(p_business) a
                   WHERE a.wallet_rank = 2 AND public._bwp_user_is_owner(v_user, a.ancestor_id)) INTO v_ok;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'A mother approver must be an owner of a business that governs this branch';
    END IF;
  ELSE
    -- a branch approver must belong to the branch (team member or owner) or to a governing owner
    SELECT EXISTS (SELECT 1 FROM public.business_account_members m
                   WHERE m.business_profile_id = p_business AND m.auth_user_id = v_user
                     AND lower(COALESCE(m.employment_status, 'active')) = 'active')
        OR public._bwp_user_is_owner(v_user, p_business)
        OR EXISTS (SELECT 1 FROM public._bol_ancestors(p_business) a
                   WHERE a.wallet_rank = 2 AND public._bwp_user_is_owner(v_user, a.ancestor_id))
    INTO v_ok;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'A branch approver must be on this business’s team';
    END IF;
  END IF;

  INSERT INTO public.branch_wallet_approvers (business_profile_id, user_id, level, max_amount_ican, added_by)
  VALUES (p_business, v_user, p_level, p_max_amount, auth.uid())
  ON CONFLICT (business_profile_id, user_id, level)
  DO UPDATE SET active = TRUE, max_amount_ican = EXCLUDED.max_amount_ican;

  PERFORM public._bwp_log(p_business, 'approver_assigned',
    jsonb_build_object('approver', lower(btrim(p_email)), 'level', p_level, 'max_amount_ican', p_max_amount));
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_bwp_remove_approver(p_business UUID, p_approver_row UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.branch_wallet_approvers;
BEGIN
  IF NOT public._bwp_can_govern(p_business) THEN
    RAISE EXCEPTION 'Only the wallet’s governing administrator can remove approvers';
  END IF;
  UPDATE public.branch_wallet_approvers SET active = FALSE
  WHERE id = p_approver_row AND business_profile_id = p_business RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approver not found'; END IF;
  PERFORM public._bwp_log(p_business, 'approver_removed',
    jsonb_build_object('user_id', v_row.user_id, 'level', v_row.level));
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_bwp_list_approvers(p_business UUID)
RETURNS TABLE (id UUID, user_id UUID, email TEXT, level TEXT, max_amount_ican NUMERIC, active BOOLEAN, has_pin BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public._bwp_rank_over(p_business) < 2 THEN RAISE EXCEPTION 'You do not govern this wallet'; END IF;
  RETURN QUERY
  SELECT a.id, a.user_id, u.email::TEXT, a.level, a.max_amount_ican, a.active,
         EXISTS (SELECT 1 FROM public.branch_approver_pins p WHERE p.user_id = a.user_id)
  FROM public.branch_wallet_approvers a LEFT JOIN auth.users u ON u.id = a.user_id
  WHERE a.business_profile_id = p_business AND a.active
  ORDER BY a.level DESC, u.email;
END;
$$;

-- Freeze: either side can stop a wallet at once. Unfreeze: the governor only.
CREATE OR REPLACE FUNCTION public.fn_bwp_set_wallet_status(p_business UUID, p_status TEXT, p_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cur TEXT;
BEGIN
  IF p_status NOT IN ('active', 'frozen') THEN RAISE EXCEPTION 'Status must be active or frozen'; END IF;
  IF p_status = 'frozen' AND public._bwp_rank_over(p_business) < 2 THEN
    RAISE EXCEPTION 'You do not govern this wallet';
  END IF;
  IF p_status = 'active' AND NOT public._bwp_can_govern(p_business) THEN
    RAISE EXCEPTION 'Only the wallet’s governing administrator can unfreeze it';
  END IF;
  SELECT status INTO v_cur FROM public.ican_business_wallets WHERE business_profile_id = p_business FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This business has no wallet yet'; END IF;
  IF v_cur = 'suspended' THEN RAISE EXCEPTION 'A suspended wallet can only be reactivated by the platform'; END IF;
  UPDATE public.ican_business_wallets SET status = p_status, updated_at = NOW() WHERE business_profile_id = p_business;
  PERFORM public._bwp_log(p_business, CASE WHEN p_status = 'frozen' THEN 'wallet_frozen' ELSE 'wallet_unfrozen' END,
                          jsonb_build_object('reason', p_reason));
  RETURN jsonb_build_object('status', p_status);
END;
$$;

-- ============================================================================
-- 5. THE APPROVAL LADDER
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_bwp_set_my_pin(p_pin TEXT, p_current_pin TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_row public.branch_approver_pins;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF p_pin !~ '^[0-9]{4,8}$' THEN RAISE EXCEPTION 'The approval PIN must be 4 to 8 digits'; END IF;
  SELECT * INTO v_row FROM public.branch_approver_pins WHERE user_id = auth.uid();
  IF FOUND THEN
    IF v_row.locked_until IS NOT NULL AND v_row.locked_until > NOW() THEN RAISE EXCEPTION 'Too many wrong attempts. Try again later.'; END IF;
    IF p_current_pin IS NULL OR crypt(p_current_pin, v_row.pin_hash) <> v_row.pin_hash THEN
      RAISE EXCEPTION 'Your current approval PIN is required to change it';
    END IF;
  END IF;
  INSERT INTO public.branch_approver_pins (user_id, pin_hash) VALUES (auth.uid(), crypt(p_pin, gen_salt('bf')))
  ON CONFLICT (user_id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, failed_count = 0, locked_until = NULL, set_at = NOW();
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_bwp_my_pin_status()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('has_pin', EXISTS (SELECT 1 FROM public.branch_approver_pins WHERE user_id = auth.uid()),
                            'locked_until', (SELECT locked_until FROM public.branch_approver_pins WHERE user_id = auth.uid()));
$$;

-- Where a request stands on its ladder.
CREATE OR REPLACE FUNCTION public._bwp_stage_status(p_tx UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.ican_business_wallet_transactions; v_pol public.branch_wallet_policies;
  v_has_mother BOOLEAN; v_above BOOLEAN; v_needs_mother BOOLEAN; v_owner BOOLEAN;
  v_b INT; v_m INT; v_branch_ok BOOLEAN; v_mother_ok BOOLEAN;
BEGIN
  SELECT * INTO t FROM public.ican_business_wallet_transactions WHERE id = p_tx;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_pol FROM public.branch_wallet_policies WHERE business_profile_id = t.business_profile_id AND enabled;
  IF NOT FOUND THEN RETURN jsonb_build_object('ladder', FALSE); END IF;

  v_has_mother := public._bwp_governed_by_ancestor(t.business_profile_id);
  v_above := t.amount_ican > v_pol.branch_approval_up_to_ican;
  v_needs_mother := v_above AND v_has_mother;
  v_owner := v_above AND NOT v_has_mother;

  SELECT COUNT(*) FILTER (WHERE level = 'branch' AND decision = 'approved'),
         COUNT(*) FILTER (WHERE level = 'mother' AND decision = 'approved')
  INTO v_b, v_m FROM public.branch_wallet_stage_approvals WHERE transaction_id = p_tx;

  v_branch_ok := v_b >= v_pol.branch_approvals_required;
  v_mother_ok := (NOT v_needs_mother) OR v_m >= v_pol.mother_approvals_required;

  RETURN jsonb_build_object(
    'ladder', TRUE, 'amount_ican', t.amount_ican, 'status', t.status,
    'branch', jsonb_build_object('required', v_pol.branch_approvals_required, 'have', v_b, 'ok', v_branch_ok),
    'mother', jsonb_build_object('needed', v_needs_mother, 'required', v_pol.mother_approvals_required, 'have', v_m, 'ok', v_mother_ok),
    'owner_needed', v_owner,
    'complete', v_branch_ok AND v_mother_ok AND NOT v_owner);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_bwp_decide(p_tx UUID, p_decision TEXT, p_pin TEXT, p_comment TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  t public.ican_business_wallet_transactions; v_pol public.branch_wallet_policies;
  v_stage JSONB; v_level TEXT; v_row public.branch_wallet_approvers; v_pin public.branch_approver_pins;
  v_res JSONB; v_email TEXT := public._cmms_caller_email();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF lower(COALESCE(p_decision, '')) NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'Decision must be approved or rejected'; END IF;

  SELECT * INTO t FROM public.ican_business_wallet_transactions WHERE id = p_tx FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF t.status <> 'pending_approval' THEN RAISE EXCEPTION 'This request is already %', t.status; END IF;
  SELECT * INTO v_pol FROM public.branch_wallet_policies WHERE business_profile_id = t.business_profile_id AND enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'This wallet has no approval ladder; use the standard business approval'; END IF;
  IF t.initiated_by = auth.uid() THEN RAISE EXCEPTION 'You cannot approve a request you raised yourself'; END IF;

  v_stage := public._bwp_stage_status(p_tx);

  -- which hat is the caller wearing here?
  SELECT * INTO v_row FROM public.branch_wallet_approvers
   WHERE business_profile_id = t.business_profile_id AND user_id = auth.uid() AND active
     AND (max_amount_ican IS NULL OR max_amount_ican >= t.amount_ican)
     AND (level = 'branch' OR EXISTS (SELECT 1 FROM public._bol_ancestors(t.business_profile_id) a
                                       WHERE a.wallet_rank = 2
                                         AND (public._bwp_user_is_owner(auth.uid(), a.ancestor_id)
                                              OR public._bol_is_business_admin(a.ancestor_id))))
   ORDER BY CASE WHEN level = 'mother' AND (v_stage->'mother'->>'needed')::BOOLEAN THEN 0 ELSE 1 END, level
   LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'You are not an approver for this request (check your assignment and approval limit)'; END IF;
  v_level := v_row.level;

  -- the caller's own approval PIN (failures are counted, so they are returned, not raised)
  SELECT * INTO v_pin FROM public.branch_approver_pins WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Set your approval PIN first'; END IF;
  IF v_pin.locked_until IS NOT NULL AND v_pin.locked_until > NOW() THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Too many wrong PIN attempts. Try again after ' || to_char(v_pin.locked_until, 'HH24:MI'));
  END IF;
  IF p_pin IS NULL OR crypt(p_pin, v_pin.pin_hash) <> v_pin.pin_hash THEN
    UPDATE public.branch_approver_pins
       SET failed_count = failed_count + 1,
           locked_until = CASE WHEN failed_count + 1 >= 5 THEN NOW() + INTERVAL '15 minutes' END
     WHERE user_id = auth.uid();
    RETURN jsonb_build_object('success', FALSE, 'error', 'Wrong approval PIN');
  END IF;
  UPDATE public.branch_approver_pins SET failed_count = 0, locked_until = NULL WHERE user_id = auth.uid();

  INSERT INTO public.branch_wallet_stage_approvals (transaction_id, approver_id, approver_email, level, decision, comment)
  VALUES (p_tx, auth.uid(), v_email, v_level, lower(p_decision), p_comment)
  ON CONFLICT (transaction_id, approver_id) DO UPDATE
    SET level = EXCLUDED.level, decision = EXCLUDED.decision, comment = EXCLUDED.comment, decided_at = NOW();
  PERFORM public._bwp_log(t.business_profile_id, 'request_' || lower(p_decision),
    jsonb_build_object('transaction_id', p_tx, 'level', v_level, 'amount_ican', t.amount_ican));

  PERFORM set_config('bwp.engine', 'on', TRUE);
  IF lower(p_decision) = 'rejected' THEN
    UPDATE public.ican_business_wallet_transactions SET status = 'rejected' WHERE id = p_tx;
    PERFORM set_config('bwp.engine', '', TRUE);
    RETURN jsonb_build_object('success', TRUE, 'status', 'rejected', 'stage', public._bwp_stage_status(p_tx));
  END IF;

  v_stage := public._bwp_stage_status(p_tx);
  IF (v_stage->>'complete')::BOOLEAN THEN
    UPDATE public.ican_business_wallet_transactions
       SET approved_ownership_percentage = required_approval_percentage WHERE id = p_tx;
    v_res := public.pitchin_execute_business_wallet_transfer(p_tx);
    PERFORM set_config('bwp.engine', '', TRUE);
    PERFORM public._bwp_log(t.business_profile_id, 'request_released', jsonb_build_object('transaction_id', p_tx, 'result', v_res));
    RETURN jsonb_build_object('success', COALESCE((v_res->>'success')::BOOLEAN, FALSE),
                              'status', COALESCE(v_res->>'status', 'completed'), 'stage', public._bwp_stage_status(p_tx), 'result', v_res);
  END IF;
  PERFORM set_config('bwp.engine', '', TRUE);
  RETURN jsonb_build_object('success', TRUE, 'status', 'pending_approval', 'stage', v_stage);
END;
$$;

-- My inbox: requests waiting on a ladder I sit on
CREATE OR REPLACE FUNCTION public.fn_bwp_pending_for_me()
RETURNS TABLE (
  transaction_id UUID, business_id UUID, business_name TEXT, wallet_label TEXT, amount_ican NUMERIC, note TEXT,
  operation_type TEXT, recipient_name TEXT, created_at TIMESTAMPTZ, my_level TEXT, already_decided BOOLEAN, stage JSONB
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.business_profile_id, bp.business_name::TEXT, pol.wallet_label, t.amount_ican, t.note,
         COALESCE(to_jsonb(t)->>'operation_type', 'transfer'),
         COALESCE(rb.business_name, ru.email)::TEXT, t.created_at,
         (SELECT a.level FROM public.branch_wallet_approvers a
           WHERE a.business_profile_id = t.business_profile_id AND a.user_id = auth.uid() AND a.active
             AND (a.max_amount_ican IS NULL OR a.max_amount_ican >= t.amount_ican)
           ORDER BY a.level DESC LIMIT 1),
         EXISTS (SELECT 1 FROM public.branch_wallet_stage_approvals s WHERE s.transaction_id = t.id AND s.approver_id = auth.uid()),
         public._bwp_stage_status(t.id)
  FROM public.ican_business_wallet_transactions t
  JOIN public.branch_wallet_policies pol ON pol.business_profile_id = t.business_profile_id AND pol.enabled
  JOIN public.business_profiles bp ON bp.id = t.business_profile_id
  LEFT JOIN public.business_profiles rb ON rb.id = t.recipient_business_profile_id
  LEFT JOIN auth.users ru ON ru.id = t.recipient_user_id
  WHERE t.status = 'pending_approval' AND t.initiated_by <> auth.uid()
    AND EXISTS (SELECT 1 FROM public.branch_wallet_approvers a
                 WHERE a.business_profile_id = t.business_profile_id AND a.user_id = auth.uid() AND a.active
                   AND (a.max_amount_ican IS NULL OR a.max_amount_ican >= t.amount_ican))
  ORDER BY t.created_at;
$$;

-- ============================================================================
-- 6. THE MOTHER ACCOUNT: OVERVIEW, FUNDING, SWEEPS, ALLOWANCES
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_bwp_wallet_overview(p_business UUID)
RETURNS TABLE (
  business_id UUID, parent_id UUID, depth INT, business_name TEXT, relationship TEXT, my_rank INT,
  wallet_exists BOOLEAN, wallet_label TEXT, wallet_last4 TEXT, balance NUMERIC, wallet_status TEXT,
  funded_30d NUMERIC, spent_30d NUMERIC, pending_count INT, policy JSONB, allowance JSONB, approver_count INT
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public._bwp_rank_over(p_business) < 1 THEN RAISE EXCEPTION 'You do not have access to this wallet'; END IF;
  RETURN QUERY
  WITH RECURSIVE down AS (
    SELECT p_business AS biz, NULL::UUID AS par, 0 AS d, NULL::TEXT AS rel, 3 AS wk, ARRAY[p_business] AS path
    UNION ALL
    SELECT l.child_business_profile_id, l.parent_business_profile_id, down.d + 1, l.relationship,
           LEAST(down.wk, public._bol_wallet_rank(l.wallet_control)), down.path || l.child_business_profile_id
    FROM down JOIN public.business_ownership_links l
      ON l.parent_business_profile_id = down.biz AND l.status = 'active'
    WHERE NOT l.child_business_profile_id = ANY (down.path)
  ), nodes AS (
    -- the starting business always; a descendant only when the links on the way allow at least a view
    SELECT * FROM down WHERE d = 0 OR (wk >= 1 AND public._bwp_rank_over(p_business) >= 3)
  )
  SELECT n.biz, n.par, n.d, bp.business_name::TEXT, n.rel,
         CASE WHEN n.d = 0 THEN public._bwp_rank_over(n.biz) ELSE LEAST(n.wk, 2) END,
         w.id IS NOT NULL, pol.wallet_label,
         CASE WHEN w.wallet_address IS NULL THEN NULL ELSE right(w.wallet_address, 4) END,
         COALESCE(w.ican_balance, 0), COALESCE(w.status, 'none'),
         COALESCE((SELECT SUM(x.amount_ican) FROM public.ican_business_wallet_transactions x
                    WHERE x.recipient_business_profile_id = n.biz AND x.status = 'completed'
                      AND COALESCE(to_jsonb(x)->>'operation_type', '') IN ('branch_funding', 'branch_sweep')
                      AND x.created_at > NOW() - INTERVAL '30 days'), 0),
         COALESCE((SELECT SUM(x.amount_ican) FROM public.ican_business_wallet_transactions x
                    WHERE x.business_profile_id = n.biz AND x.status = 'completed'
                      AND COALESCE(to_jsonb(x)->>'operation_type', '') NOT IN ('branch_funding', 'branch_sweep')
                      AND x.created_at > NOW() - INTERVAL '30 days'), 0),
         (SELECT COUNT(*)::INT FROM public.ican_business_wallet_transactions x
           WHERE x.business_profile_id = n.biz AND x.status = 'pending_approval'),
         CASE WHEN pol.business_profile_id IS NULL THEN NULL ELSE to_jsonb(pol) - 'updated_by' END,
         (SELECT to_jsonb(al) - 'created_by' FROM public.branch_wallet_allowances al WHERE al.child_business_profile_id = n.biz),
         (SELECT COUNT(*)::INT FROM public.branch_wallet_approvers a WHERE a.business_profile_id = n.biz AND a.active)
  FROM nodes n
  JOIN public.business_profiles bp ON bp.id = n.biz
  LEFT JOIN public.ican_business_wallets w ON w.business_profile_id = n.biz
  LEFT JOIN public.branch_wallet_policies pol ON pol.business_profile_id = n.biz
  ORDER BY n.d, bp.business_name;
END;
$$;

-- Fund a branch from the mother (or sweep a branch back). Creates a PENDING
-- request through the existing transaction table; approval follows the SOURCE
-- wallet's rules (its ladder if it has one, otherwise the owners with the PIN).
CREATE OR REPLACE FUNCTION public.fn_bwp_propose_transfer(
  p_source UUID, p_target UUID, p_kind TEXT, p_amount NUMERIC, p_note TEXT DEFAULT NULL, p_reference TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_required NUMERIC; v_tx UUID; v_pol public.branch_wallet_policies;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF p_kind NOT IN ('funding', 'sweep') THEN RAISE EXCEPTION 'Kind must be funding or sweep'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF p_source = p_target THEN RAISE EXCEPTION 'Choose a different wallet'; END IF;

  IF p_kind = 'funding' THEN
    -- mother -> any branch beneath her
    IF NOT EXISTS (SELECT 1 FROM public._bol_ancestors(p_target) a WHERE a.ancestor_id = p_source) THEN
      RAISE EXCEPTION 'You can only fund a branch that belongs to this business';
    END IF;
    IF NOT public._bol_is_business_admin(p_source) THEN
      RAISE EXCEPTION 'Only an administrator of the funding business can fund a branch';
    END IF;
  ELSE
    -- branch -> an owner above it: the branch itself, or whoever governs it
    IF NOT EXISTS (SELECT 1 FROM public._bol_ancestors(p_source) a WHERE a.ancestor_id = p_target) THEN
      RAISE EXCEPTION 'A branch can only be swept to a business that owns it';
    END IF;
    IF NOT (public._bol_is_business_admin(p_source) OR public._bwp_can_govern(p_source)) THEN
      RAISE EXCEPTION 'Only the branch’s administrator or its governing business can sweep it';
    END IF;
  END IF;

  INSERT INTO public.ican_business_wallets (business_profile_id, created_by)
  SELECT id, user_id FROM public.business_profiles WHERE id IN (p_source, p_target)
  ON CONFLICT (business_profile_id) DO NOTHING;
  INSERT INTO public.ican_business_wallet_settings (business_profile_id) VALUES (p_source) ON CONFLICT DO NOTHING;

  SELECT approval_percentage INTO v_required FROM public.ican_business_wallet_settings WHERE business_profile_id = p_source;
  v_required := GREATEST(COALESCE(v_required, 100), 1);

  INSERT INTO public.ican_business_wallet_transactions
    (business_profile_id, initiated_by, amount_ican, note, reference_id, status, required_approval_percentage,
     recipient_business_profile_id, operation_type, source_app)
  VALUES
    (p_source, auth.uid(), p_amount, COALESCE(NULLIF(btrim(p_note), ''), CASE WHEN p_kind = 'funding' THEN 'Branch funding' ELSE 'Surplus swept to mother account' END),
     p_reference, 'pending_approval', v_required, p_target,
     CASE WHEN p_kind = 'funding' THEN 'branch_funding' ELSE 'branch_sweep' END, 'ican')
  RETURNING id INTO v_tx;

  SELECT * INTO v_pol FROM public.branch_wallet_policies WHERE business_profile_id = p_source AND enabled;
  PERFORM public._bwp_log(p_source, 'transfer_proposed',
    jsonb_build_object('transaction_id', v_tx, 'kind', p_kind, 'target', p_target, 'amount_ican', p_amount));
  RETURN jsonb_build_object('transaction_id', v_tx, 'status', 'pending_approval', 'ladder', v_pol.business_profile_id IS NOT NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_bwp_set_allowance(p_child UUID, p_config JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_parent UUID; v_row public.branch_wallet_allowances;
BEGIN
  SELECT l.parent_business_profile_id INTO v_parent FROM public.business_ownership_links l
   WHERE l.child_business_profile_id = p_child AND l.status = 'active';
  IF v_parent IS NULL THEN RAISE EXCEPTION 'This business has no mother account'; END IF;
  IF NOT public._bol_is_business_admin(v_parent) THEN
    RAISE EXCEPTION 'Only an administrator of the mother account can set a branch allowance';
  END IF;

  INSERT INTO public.branch_wallet_allowances
    (child_business_profile_id, parent_business_profile_id, enabled, mode, amount_ican, float_target_ican, period,
     sweep_above_ican, next_run_at, created_by)
  VALUES (p_child, v_parent, COALESCE((p_config->>'enabled')::BOOLEAN, TRUE), COALESCE(p_config->>'mode', 'top_up'),
          NULLIF(p_config->>'amount_ican', '')::NUMERIC, NULLIF(p_config->>'float_target_ican', '')::NUMERIC,
          COALESCE(p_config->>'period', 'monthly'), NULLIF(p_config->>'sweep_above_ican', '')::NUMERIC,
          COALESCE(NULLIF(p_config->>'next_run_at', '')::TIMESTAMPTZ, NOW()), auth.uid())
  ON CONFLICT (child_business_profile_id) DO UPDATE SET
    parent_business_profile_id = EXCLUDED.parent_business_profile_id, enabled = EXCLUDED.enabled, mode = EXCLUDED.mode,
    amount_ican = EXCLUDED.amount_ican, float_target_ican = EXCLUDED.float_target_ican, period = EXCLUDED.period,
    sweep_above_ican = EXCLUDED.sweep_above_ican, next_run_at = EXCLUDED.next_run_at,
    created_by = auth.uid(), updated_at = NOW()
  RETURNING * INTO v_row;
  PERFORM public._bwp_log(p_child, 'allowance_set', to_jsonb(v_row) - 'created_by');
  RETURN to_jsonb(v_row) - 'created_by';
END;
$$;

-- Turns due allowances into pending requests. Idempotent. Anyone may call it, but
-- only for allowances of mother accounts they administer (or from a scheduler with no user).
CREATE OR REPLACE FUNCTION public.fn_bwp_run_due_allowances()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.branch_wallet_allowances; v_bal NUMERIC; v_amt NUMERIC; v_made INT := 0; v_actor UUID;
BEGIN
  FOR a IN SELECT * FROM public.branch_wallet_allowances WHERE enabled AND next_run_at <= NOW() FOR UPDATE SKIP LOCKED LOOP
    IF auth.uid() IS NOT NULL AND NOT public._bol_is_business_admin(a.parent_business_profile_id) THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.business_ownership_links l WHERE l.child_business_profile_id = a.child_business_profile_id
                   AND l.parent_business_profile_id = a.parent_business_profile_id AND l.status = 'active') THEN
      CONTINUE;   -- the branch left the tree
    END IF;
    v_actor := a.created_by;
    SELECT COALESCE(ican_balance, 0) INTO v_bal FROM public.ican_business_wallets WHERE business_profile_id = a.child_business_profile_id;
    v_bal := COALESCE(v_bal, 0);

    v_amt := CASE WHEN a.mode = 'fixed' THEN a.amount_ican ELSE GREATEST(0, a.float_target_ican - v_bal) END;
    IF v_amt > 0 AND NOT EXISTS (
         SELECT 1 FROM public.ican_business_wallet_transactions x
          WHERE x.reference_id = 'allowance:' || a.child_business_profile_id AND x.status = 'pending_approval') THEN
      INSERT INTO public.ican_business_wallet_transactions
        (business_profile_id, initiated_by, amount_ican, note, reference_id, status, required_approval_percentage,
         recipient_business_profile_id, operation_type, source_app)
      VALUES (a.parent_business_profile_id, v_actor, v_amt,
              CASE WHEN a.mode = 'fixed' THEN 'Scheduled branch allowance' ELSE 'Top-up to float' END,
              'allowance:' || a.child_business_profile_id, 'pending_approval',
              GREATEST(COALESCE((SELECT approval_percentage FROM public.ican_business_wallet_settings WHERE business_profile_id = a.parent_business_profile_id), 100), 1),
              a.child_business_profile_id, 'branch_funding', 'ican');
      v_made := v_made + 1;
    END IF;

    IF a.sweep_above_ican IS NOT NULL AND v_bal > a.sweep_above_ican AND NOT EXISTS (
         SELECT 1 FROM public.ican_business_wallet_transactions x
          WHERE x.reference_id = 'sweep:' || a.child_business_profile_id AND x.status = 'pending_approval') THEN
      INSERT INTO public.ican_business_wallet_transactions
        (business_profile_id, initiated_by, amount_ican, note, reference_id, status, required_approval_percentage,
         recipient_business_profile_id, operation_type, source_app)
      VALUES (a.child_business_profile_id, v_actor, v_bal - a.sweep_above_ican, 'Surplus above the ceiling swept to mother account',
              'sweep:' || a.child_business_profile_id, 'pending_approval',
              GREATEST(COALESCE((SELECT approval_percentage FROM public.ican_business_wallet_settings WHERE business_profile_id = a.child_business_profile_id), 100), 1),
              a.parent_business_profile_id, 'branch_sweep', 'ican');
      v_made := v_made + 1;
    END IF;

    UPDATE public.branch_wallet_allowances
       SET last_run_at = NOW(), next_run_at = NOW() + CASE a.period WHEN 'weekly' THEN INTERVAL '7 days' ELSE INTERVAL '1 month' END
     WHERE child_business_profile_id = a.child_business_profile_id;
  END LOOP;
  RETURN jsonb_build_object('requests_created', v_made);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_bwp_events(p_business UUID)
RETURNS TABLE (created_at TIMESTAMPTZ, event TEXT, actor_email TEXT, details JSONB)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public._bwp_rank_over(p_business) < 1 THEN RAISE EXCEPTION 'You do not have access to this wallet'; END IF;
  RETURN QUERY SELECT e.created_at, e.event, e.actor_email::TEXT, e.details
  FROM public.branch_wallet_events e WHERE e.business_profile_id = p_business ORDER BY e.created_at DESC LIMIT 100;
END;
$$;

-- ============================================================================
-- 7. GRANTS
-- ============================================================================
GRANT EXECUTE ON FUNCTION
  public.fn_bwp_set_policy(UUID, JSONB),
  public.fn_bwp_assign_approver(UUID, TEXT, TEXT, NUMERIC),
  public.fn_bwp_remove_approver(UUID, UUID),
  public.fn_bwp_list_approvers(UUID),
  public.fn_bwp_set_wallet_status(UUID, TEXT, TEXT),
  public.fn_bwp_set_my_pin(TEXT, TEXT),
  public.fn_bwp_my_pin_status(),
  public.fn_bwp_decide(UUID, TEXT, TEXT, TEXT),
  public.fn_bwp_pending_for_me(),
  public.fn_bwp_wallet_overview(UUID),
  public.fn_bwp_propose_transfer(UUID, UUID, TEXT, NUMERIC, TEXT, TEXT),
  public.fn_bwp_set_allowance(UUID, JSONB),
  public.fn_bwp_run_due_allowances(),
  public.fn_bwp_events(UUID)
TO authenticated;

NOTIFY pgrst, 'reload schema';
SELECT 'Branch wallets, approval ladder and allowances installed' AS status;

-- ============================================================================
-- HARDENING: pin search_path, and close the API to everything that is not meant to be called
-- from the app. Internal helpers (leading underscore) can read other businesses' trees or write
-- log rows, so only the screens' fn_* functions (and the few harmless helpers the row-level
-- policies and triggers call as the signed-in user) stay executable by signed-in users (granted
-- explicitly, since PUBLIC no longer covers them).
-- ============================================================================
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname, p.proconfig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (ARRAY[
    '_bwe_append_only',
    '_bwp_can_govern',
    '_bwp_credit_branch_recipient',
    '_bwp_governed_by_ancestor',
    '_bwp_log',
    '_bwp_rank_over',
    '_bwp_stage_status',
    '_bwp_tx_guard_insert',
    '_bwp_tx_guard_update',
    '_bwp_user_is_owner',
    'fn_bwp_assign_approver',
    'fn_bwp_decide',
    'fn_bwp_events',
    'fn_bwp_list_approvers',
    'fn_bwp_my_pin_status',
    'fn_bwp_pending_for_me',
    'fn_bwp_propose_transfer',
    'fn_bwp_remove_approver',
    'fn_bwp_run_due_allowances',
    'fn_bwp_set_allowance',
    'fn_bwp_set_my_pin',
    'fn_bwp_set_policy',
    'fn_bwp_set_wallet_status',
    'fn_bwp_wallet_overview'
    ])
  LOOP
    IF r.proconfig IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(r.proconfig) c WHERE c LIKE 'search_path=%') THEN
      EXECUTE 'ALTER FUNCTION ' || r.sig || ' SET search_path = public';
    END IF;
    EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || r.sig || ' FROM PUBLIC, anon';
    IF left(r.proname, 1) = '_' AND r.proname <> ALL (ARRAY['_cmms_can_view_company', '_cmms_kind_from_category', '_cmms_caller_email', '_cmms_guc', '_cmms_money_spec', '_bol_access_rank', '_bol_wallet_rank']) THEN
      EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || r.sig || ' FROM authenticated';
    ELSE
      EXECUTE 'GRANT EXECUTE ON FUNCTION ' || r.sig || ' TO authenticated';
    END IF;
  END LOOP;
END $$;
