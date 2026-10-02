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
