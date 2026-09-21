-- ============================================================================
-- REFERRAL SYSTEM — BodaGoEra + ICANera  (shared DB, one backend)
-- ============================================================================
-- Ports the "Refer Friends" idea from Supermarkera (CREATE_REFERRAL_SYSTEM.sql
-- in digital-city-era) to BodaGoEra and ICANera, with one big difference:
-- Supermarkera's reward is a cosmetic 100-point counter, but here the reward
-- is REAL ICAN, priced at the coin's LIVE value, so the payout logic lives on the server
-- and is driven by a real event instead of trusting the browser.
--
-- HOW IT WORKS
--   1. Every user gets one referral code PER APP ('ican' | 'mybodaguy'),
--      e.g. ABANI4821, shared as  https://<app>/?ref=ABANI4821
--   2. A new user redeems a code (ican_referral_redeem_code). This only
--      records the link ('awaiting_deposit') — nothing is paid yet.
--   3. When that friend makes their FIRST DEPOSIT (valued at the live coin price) — either
--        · an ICAN coin purchase: a 'buy' row on ican_coin_transactions, which
--          buy_ican_coins() writes after verify-flutterwave-payment has
--          confirmed the payment, or
--        · a wallet Top Up: a completed 'topup' row on wallet_transactions,
--          which verify-flutterwave-topup writes after confirming the payment
--          (ICAN's main "deposit" button) —
--      the triggers at the bottom of this file pay the referrer reward_percent %
--      (default 5%) of that deposit, in ICAN, straight into their wallet.
--   4. ALL referrals — both apps — are managed from ONE place: the Referrals
--      tab of the ICAN developer panel (rate, cap, minimum deposit, on/off,
--      auto-pay vs manual approval, approve/reject individual rewards). It calls
--      the ican_referral_dev_* functions below. BodaGoEra has no management UI
--      of its own, only the user-facing "Refer Friends" card.
--
-- DESIGN RULES (see also the ICANera fee-design rules)
--   * Silent to the friend: the reward is paid BY THE PLATFORM ON TOP of the
--     deposit. Nothing is ever deducted from what the friend deposited/received.
--   * Real: the reward actually lands in ican_user_wallets + an 'earn' row in
--     ican_coin_transactions — never just a number on a screen.
--   * No tithe on the reward (same product call as ADD_REWARD_POINTS_
--     REDEMPTION_NO_TITHE.sql): 5% means the referrer gets the full 5%.
--   * Funding: like cashback / points-redemption, the reward is minted straight
--     into the wallet (there is no platform-treasury debit). Its cost to the
--     platform is exactly reward_ican and is reported in the dev overview.
--   * Never breaks a deposit: the trigger swallows its own errors (same
--     principle as fn_credit_platform_fee_to_business), and marks the referral
--     'failed' so a developer can retry it from the panel.
--   * One reward per friend, ever: ican_referrals.referred_id is UNIQUE and the
--     payout is guarded by a status transition under a row lock.
--   * LIVE VALUE OF THE COIN: the reward is worth exactly reward_percent % of
--     the deposit in UGX, converted to coins at the coin's live price at the
--     moment of the deposit (ican_get_market_snapshot().price_ugx — the same
--     engine the wallets read; falls back to the last stored price, then to the
--     5,000 UGX floor). That price is snapshotted on the referral row
--     (ican_price_ugx), so a reward that waits for manual approval is still paid
--     the coins it was worth when earned. A coin purchase is valued at coins x
--     live price (ICAN's Buy screen quotes at the live price), which makes the
--     reward simply reward_percent % of the coins bought.
--   * "Deposit" = an ICAN coin purchase ('buy') OR a completed Flutterwave
--     wallet top-up. A top-up is valued in UGX (UGX as-is, other currencies via
--     ican_currency_rates.rate_to_ugx) and then in coins at the live price.
--     KNOWN LIMITS: a top-up in a currency with no rate, and agent cash-in
--     (process_deposit_with_pin), are NOT counted — they neither pay nor use up
--     the friend's "first deposit"; the referral keeps waiting for one that counts.
--
-- Safe to re-run. Run in the shared Supabase SQL editor AFTER
-- ICAN_CROSS_APP_WALLET_MIGRATION.sql and ICAN_BUY_SELL_COINS_ADDENDUM.sql.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. TABLES
-- ─────────────────────────────────────────────────────────────────────────────

-- Singleton program settings (id is always TRUE, so there is exactly one row).
CREATE TABLE IF NOT EXISTS public.ican_referral_settings (
  id                BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  -- % of the friend's first deposit paid to the referrer.
  reward_percent    NUMERIC(5,2) NOT NULL DEFAULT 5 CHECK (reward_percent >= 0 AND reward_percent <= 25),
  -- Optional ceiling per referral, in ICAN. NULL = no cap.
  max_reward_ican   NUMERIC(18,8) CHECK (max_reward_ican IS NULL OR max_reward_ican > 0),
  -- A deposit smaller than this does not count as the "first deposit"
  -- (the referral keeps waiting for one that does). 0 = any deposit counts.
  min_deposit_ican  NUMERIC(18,8) NOT NULL DEFAULT 0 CHECK (min_deposit_ican >= 0),
  -- TRUE  = reward is paid the instant the friend's first deposit lands.
  -- FALSE = it waits in 'pending_approval' until a developer approves it.
  auto_pay          BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        TEXT
);
INSERT INTO public.ican_referral_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

-- One durable code per (user, app). The code itself is globally unique so a
-- code identifies exactly one person in exactly one app.
CREATE TABLE IF NOT EXISTS public.ican_referral_codes (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_app  TEXT NOT NULL CHECK (source_app IN ('ican','mybodaguy')),
  code        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, source_app)
);
CREATE UNIQUE INDEX IF NOT EXISTS ican_referral_codes_code_uidx ON public.ican_referral_codes (code);

-- One row per referred friend. (Named ican_referrals, NOT referrals — Supermarkera
-- already owns public.referrals with a different shape.)
CREATE TABLE IF NOT EXISTS public.ican_referrals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- UNIQUE: a person can only ever credit one referrer, in any app.
  referred_id      UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  source_app       TEXT NOT NULL CHECK (source_app IN ('ican','mybodaguy')),
  referral_code    TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'awaiting_deposit' CHECK (status IN (
                     'awaiting_deposit',   -- friend joined, has not deposited yet
                     'pending_approval',   -- deposited; reward computed, waiting for a developer (auto_pay off)
                     'paid',               -- reward credited to the referrer's wallet
                     'rejected',           -- a developer voided it
                     'failed'              -- payout errored; retry from the dev panel
                   )),
  -- Snapshot of the qualifying deposit + the rate/reward computed from it, so
  -- later changes to the settings never rewrite history.
  deposit_tx_id    UUID,
  deposit_ican     NUMERIC(18,8),
  deposit_ugx      NUMERIC(18,2),   -- the deposit valued in UGX
  ican_price_ugx   NUMERIC(18,2),   -- LIVE coin price used to convert the reward (UGX per 1 ICAN)
  reward_percent   NUMERIC(5,2),
  reward_ican      NUMERIC(18,8),
  reward_ugx       NUMERIC(18,2),   -- what the reward was worth in UGX when earned
  reward_tx_id     UUID,
  decided_by       TEXT,          -- 'auto' | developer email | 'dev-token'
  decided_at       TIMESTAMPTZ,
  decision_note    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ican_referrals_no_self CHECK (referrer_id <> referred_id)
);
-- Safe re-run on a database that already has the pre-live-price table.
ALTER TABLE public.ican_referrals ADD COLUMN IF NOT EXISTS deposit_ugx    NUMERIC(18,2);
ALTER TABLE public.ican_referrals ADD COLUMN IF NOT EXISTS ican_price_ugx NUMERIC(18,2);
ALTER TABLE public.ican_referrals ADD COLUMN IF NOT EXISTS reward_ugx     NUMERIC(18,2);
CREATE INDEX IF NOT EXISTS ican_referrals_referrer_idx ON public.ican_referrals (referrer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ican_referrals_status_idx   ON public.ican_referrals (status, created_at DESC);

-- No direct table access from the browser at all: RLS on, zero policies. Every
-- read/write goes through the SECURITY DEFINER functions below, which is what
-- stops a client from inserting itself a fake 'paid' referral.
ALTER TABLE public.ican_referral_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ican_referral_codes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ican_referrals         ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ican_referral_settings, public.ican_referral_codes, public.ican_referrals FROM anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. INTERNAL HELPERS
-- ─────────────────────────────────────────────────────────────────────────────

-- Who may manage the program: an active BodaGo developer (real auth session,
-- same rule as mbg_admin_adjust_reward_points), OR the ICAN dev-panel token
-- (that panel authenticates with a shared token rather than a Supabase user —
-- same convention as every ican_dev_* function in DEV_PANEL_ACCESS.sql).
CREATE OR REPLACE FUNCTION public.ican_referral_is_manager(p_dev_token TEXT DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_dev_token IS NOT NULL AND p_dev_token = 'dev_ICAN_Pr0_KV25' THEN
    RETURN TRUE;
  END IF;
  IF auth.uid() IS NOT NULL AND to_regclass('public.mbg_users') IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM public.mbg_users mu
      WHERE mu.id = auth.uid() AND mu.role_type::TEXT = 'developer' AND mu.is_active = TRUE
    );
  END IF;
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.ican_referral_display_name(p_user_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    NULLIF(TRIM(u.raw_user_meta_data->>'full_name'), ''),
    NULLIF(TRIM(u.raw_user_meta_data->>'name'), ''),
    NULLIF(split_part(u.email, '@', 1), ''),
    'Friend')
  FROM auth.users u WHERE u.id = p_user_id;
$$;

-- Builds e.g. ABANI4821 from the user's first name (letters only) + 4 digits.
CREATE OR REPLACE FUNCTION public.ican_referral_make_code(p_user_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_base TEXT;
BEGIN
  v_base := upper(regexp_replace(split_part(COALESCE(public.ican_referral_display_name(p_user_id), ''), ' ', 1), '[^A-Za-z]', '', 'g'));
  v_base := left(v_base, 6);
  IF v_base IS NULL OR v_base = '' THEN v_base := 'FRIEND'; END IF;
  RETURN v_base || (1000 + floor(random() * 9000))::INT::TEXT;
END;
$$;

-- Has this person already deposited (ICAN coin purchase or completed wallet
-- top-up, any currency)? Used to refuse a code from someone who isn't new to
-- depositing. wallet_transactions exists in several historical shapes, so its
-- part is dynamic SQL that degrades to "no" instead of erroring.
CREATE OR REPLACE FUNCTION public.ican_referral_has_deposited(p_user_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_found BOOLEAN := FALSE;
BEGIN
  IF EXISTS (SELECT 1 FROM public.ican_coin_transactions WHERE recipient_user_id = p_user_id AND transaction_type = 'buy') THEN
    RETURN TRUE;
  END IF;
  BEGIN
    IF to_regclass('public.wallet_transactions') IS NOT NULL THEN
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.wallet_transactions WHERE user_id = $1 AND type = ''topup'' AND status = ''completed'')'
        INTO v_found USING p_user_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_found := FALSE;
  END;
  RETURN COALESCE(v_found, FALSE);
END;
$$;

-- The coin's LIVE price in UGX. Same source and fallback chain the wallets use
-- (icanCoinBlockchainService.getCurrentPrice): live engine -> last stored
-- snapshot -> 5,000 floor; anything under 1,000 is treated as a bad reading.
-- Never raises, never returns NULL or 0, so callers can divide by it.
CREATE OR REPLACE FUNCTION public.ican_referral_live_price_ugx()
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v NUMERIC;
BEGIN
  BEGIN
    SELECT price_ugx INTO v FROM public.ican_get_market_snapshot() LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v := NULL;
  END;
  IF v IS NULL OR v < 1000 THEN
    BEGIN
      SELECT price_ugx INTO v FROM public.ican_coin_market_prices ORDER BY timestamp DESC LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      v := NULL;
    END;
  END IF;
  IF v IS NULL OR v < 1000 THEN v := 5000; END IF;
  RETURN v;
END;
$$;

-- Value of a fiat amount in UGX: UGX as-is, anything else via the platform's own
-- rate table (ican_currency_rates.rate_to_ugx = UGX per 1 unit). NULL when the
-- currency has no rate — the caller then ignores that deposit.
CREATE OR REPLACE FUNCTION public.ican_referral_ugx_value(p_amount NUMERIC, p_currency TEXT)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rate NUMERIC;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN NULL; END IF;
  IF upper(COALESCE(p_currency, '')) = 'UGX' THEN RETURN p_amount; END IF;
  BEGIN
    EXECUTE 'SELECT rate_to_ugx FROM public.ican_currency_rates WHERE currency_code = $1'
      INTO v_rate USING upper(COALESCE(p_currency, ''));
  EXCEPTION WHEN OTHERS THEN
    v_rate := NULL;
  END;
  IF v_rate IS NULL OR v_rate <= 0 THEN RETURN NULL; END IF;
  RETURN ROUND(p_amount * v_rate, 2);
END;
$$;

REVOKE ALL ON FUNCTION public.ican_referral_live_price_ugx() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ican_referral_ugx_value(NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ican_referral_is_manager(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ican_referral_has_deposited(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ican_referral_display_name(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ican_referral_make_code(UUID) FROM PUBLIC, anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. THE PAYOUT  (single place that ever moves the money)
-- ─────────────────────────────────────────────────────────────────────────────
-- Credits reward_ican to the referrer. Idempotent: it only acts on a row in
-- 'pending_approval' or 'failed', holds a row lock, and flips the row to 'paid'
-- in the same transaction as the wallet credit — so a double-click on Approve,
-- a retried trigger, or two developers approving at once can never pay twice.
-- Returns {success:false,error} instead of raising for expected refusals.
CREATE OR REPLACE FUNCTION public.ican_referral_pay(
  p_referral_id UUID,
  p_actor       TEXT DEFAULT 'auto',
  p_note        TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r          public.ican_referrals%ROWTYPE;
  v_wstatus  TEXT;
  v_role     TEXT;
  v_tx_id    UUID;
BEGIN
  SELECT * INTO r FROM public.ican_referrals WHERE id = p_referral_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Referral not found');
  END IF;
  IF r.status NOT IN ('pending_approval', 'failed') THEN
    RETURN jsonb_build_object('success', false, 'error', format('Referral is not awaiting payout (status: %s)', r.status));
  END IF;
  IF r.reward_ican IS NULL OR r.reward_ican <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Referral has no reward amount to pay');
  END IF;

  PERFORM public.get_or_create_ican_wallet(r.referrer_id);
  SELECT status INTO v_wstatus FROM public.ican_user_wallets WHERE user_id = r.referrer_id;
  IF v_wstatus IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', format('Referrer wallet is %s — cannot credit', COALESCE(v_wstatus, 'missing')));
  END IF;

  v_role := public.ican_resolve_caller_role();

  -- Full credit, no tithe (see header). Same two effects credit_ican_earning()
  -- has, minus the second 'tithe' row.
  UPDATE public.ican_user_wallets
     SET ican_balance = ican_balance + r.reward_ican,
         total_earned = total_earned + r.reward_ican
   WHERE user_id = r.referrer_id;

  INSERT INTO public.ican_coin_transactions
    (recipient_user_id, ican_amount, transaction_type, source_app, reference_id, note, actor_role)
  VALUES
    (r.referrer_id, r.reward_ican, 'earn', r.source_app, 'referral:' || r.id::TEXT,
     format('Referral reward: %s%% of your friend''s first deposit (UGX %s) at %s UGX per ICAN',
            r.reward_percent::TEXT, COALESCE(r.deposit_ugx, 0)::TEXT, COALESCE(r.ican_price_ugx, 0)::TEXT),
     v_role)
  RETURNING id INTO v_tx_id;

  UPDATE public.ican_referrals
     SET status = 'paid', reward_tx_id = v_tx_id,
         decided_by = p_actor, decided_at = now(),
         decision_note = COALESCE(p_note, decision_note), updated_at = now()
   WHERE id = r.id;

  RETURN jsonb_build_object('success', true, 'referral_id', r.id, 'reward_ican', r.reward_ican, 'reward_ugx', r.reward_ugx, 'tx_id', v_tx_id);
END;
$$;
REVOKE ALL ON FUNCTION public.ican_referral_pay(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. USER-FACING RPCs  (called by both apps' referralService)
-- ─────────────────────────────────────────────────────────────────────────────

-- What the "Refer Friends" card advertises. Safe for any signed-in user.
CREATE OR REPLACE FUNCTION public.ican_referral_public_info()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'enabled', enabled, 'reward_percent', reward_percent,
    'max_reward_ican', max_reward_ican, 'min_deposit_ican', min_deposit_ican,
    'live_price_ugx', public.ican_referral_live_price_ugx())
  FROM public.ican_referral_settings WHERE id;
$$;

-- Returns the caller's code for this app, creating it on first use.
CREATE OR REPLACE FUNCTION public.ican_referral_get_or_create_code(p_source_app TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_code TEXT;
  i      INT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_signed_in');
  END IF;
  IF p_source_app NOT IN ('ican', 'mybodaguy') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_app');
  END IF;

  SELECT code INTO v_code FROM public.ican_referral_codes WHERE user_id = v_uid AND source_app = p_source_app;
  IF v_code IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'code', v_code);
  END IF;

  FOR i IN 1..8 LOOP
    BEGIN
      v_code := public.ican_referral_make_code(v_uid);
      INSERT INTO public.ican_referral_codes (user_id, source_app, code) VALUES (v_uid, p_source_app, v_code);
      RETURN jsonb_build_object('success', true, 'code', v_code);
    EXCEPTION WHEN unique_violation THEN
      -- Either the random code collided with someone else's, or two tabs raced
      -- on the same (user, app). In the race case the row now exists — return it.
      SELECT code INTO v_code FROM public.ican_referral_codes WHERE user_id = v_uid AND source_app = p_source_app;
      IF v_code IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'code', v_code);
      END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object('success', false, 'reason', 'code_generation_failed');
END;
$$;

-- The friend redeems a code. Only records the link — the reward waits for the
-- friend's first deposit. `reason` is a stable machine code the client keys on.
CREATE OR REPLACE FUNCTION public.ican_referral_redeem_code(p_code TEXT, p_source_app TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_code    TEXT := upper(trim(COALESCE(p_code, '')));
  c         public.ican_referral_codes%ROWTYPE;
  v_enabled BOOLEAN;
  v_rows    INT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_signed_in');
  END IF;
  IF p_source_app NOT IN ('ican', 'mybodaguy') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_app');
  END IF;
  IF v_code = '' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_code');
  END IF;

  SELECT enabled INTO v_enabled FROM public.ican_referral_settings WHERE id;
  IF NOT COALESCE(v_enabled, FALSE) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'paused');
  END IF;

  SELECT * INTO c FROM public.ican_referral_codes WHERE code = v_code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_code');
  END IF;
  IF c.source_app <> p_source_app THEN
    RETURN jsonb_build_object('success', false, 'reason', 'wrong_app', 'code_app', c.source_app);
  END IF;
  IF c.user_id = v_uid THEN
    RETURN jsonb_build_object('success', false, 'reason', 'own_code');
  END IF;
  IF EXISTS (SELECT 1 FROM public.ican_referrals WHERE referred_id = v_uid) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_referred');
  END IF;
  -- "First deposit" only means something if they haven't already deposited.
  IF public.ican_referral_has_deposited(v_uid) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_deposited');
  END IF;
  -- Blocks the trivial A-refers-B / B-refers-A loop.
  IF EXISTS (SELECT 1 FROM public.ican_referrals WHERE referrer_id = v_uid AND referred_id = c.user_id) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'circular');
  END IF;

  INSERT INTO public.ican_referrals (referrer_id, referred_id, source_app, referral_code)
  VALUES (c.user_id, v_uid, c.source_app, v_code)
  ON CONFLICT (referred_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_referred');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'referrer_name', split_part(COALESCE(public.ican_referral_display_name(c.user_id), 'your friend'), ' ', 1));
END;
$$;

-- Everything the referrer's card needs in one round trip.
CREATE OR REPLACE FUNCTION public.ican_referral_my_stats(p_source_app TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_info    JSONB;
  v_code    TEXT;
  v_friends JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_signed_in');
  END IF;
  IF p_source_app NOT IN ('ican', 'mybodaguy') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_app');
  END IF;

  v_info := public.ican_referral_public_info();
  SELECT code INTO v_code FROM public.ican_referral_codes WHERE user_id = v_uid AND source_app = p_source_app;

  SELECT COALESCE(jsonb_agg(f ORDER BY f->>'created_at' DESC), '[]'::JSONB) INTO v_friends FROM (
    SELECT jsonb_build_object(
      'first_name', split_part(COALESCE(public.ican_referral_display_name(r.referred_id), 'Friend'), ' ', 1),
      -- 'joined' | 'pending' | 'paid' | 'rejected' — deliberately coarser than the internal statuses
      'state', CASE r.status WHEN 'awaiting_deposit' THEN 'joined'
                             WHEN 'paid' THEN 'paid'
                             WHEN 'rejected' THEN 'rejected'
                             ELSE 'pending' END,
      'reward_ican', CASE WHEN r.status IN ('paid', 'pending_approval', 'failed') THEN r.reward_ican END,
      'reward_ugx',  CASE WHEN r.status IN ('paid', 'pending_approval', 'failed') THEN r.reward_ugx END,
      'created_at', r.created_at) AS f
    FROM public.ican_referrals r
    WHERE r.referrer_id = v_uid AND r.source_app = p_source_app
    ORDER BY r.created_at DESC LIMIT 50
  ) t;

  RETURN jsonb_build_object(
    'success', true,
    'code', v_code,
    'enabled', v_info->'enabled',
    'reward_percent', v_info->'reward_percent',
    'max_reward_ican', v_info->'max_reward_ican',
    'min_deposit_ican', v_info->'min_deposit_ican',
    'live_price_ugx', v_info->'live_price_ugx',
    'friends_joined',    (SELECT count(*) FROM public.ican_referrals WHERE referrer_id = v_uid AND source_app = p_source_app),
    'friends_deposited', (SELECT count(*) FROM public.ican_referrals WHERE referrer_id = v_uid AND source_app = p_source_app AND status IN ('paid', 'pending_approval', 'failed')),
    'earned_ican',  COALESCE((SELECT sum(reward_ican) FROM public.ican_referrals WHERE referrer_id = v_uid AND source_app = p_source_app AND status = 'paid'), 0),
    'pending_ican', COALESCE((SELECT sum(reward_ican) FROM public.ican_referrals WHERE referrer_id = v_uid AND source_app = p_source_app AND status IN ('pending_approval', 'failed')), 0),
    'earned_ugx',  COALESCE((SELECT sum(reward_ugx) FROM public.ican_referrals WHERE referrer_id = v_uid AND source_app = p_source_app AND status = 'paid'), 0),
    'pending_ugx', COALESCE((SELECT sum(reward_ugx) FROM public.ican_referrals WHERE referrer_id = v_uid AND source_app = p_source_app AND status IN ('pending_approval', 'failed')), 0),
    'friends', v_friends);
END;
$$;

REVOKE ALL ON FUNCTION public.ican_referral_public_info() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ican_referral_get_or_create_code(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ican_referral_redeem_code(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ican_referral_my_stats(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ican_referral_public_info() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ican_referral_get_or_create_code(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ican_referral_redeem_code(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ican_referral_my_stats(TEXT) TO authenticated;

-- Pre-login typo check for the "Have a referral code?" field on the sign-in /
-- sign-up screens (including before "Continue with Google", where the user
-- leaves the page and can no longer see an error). Callable while signed out.
-- Deliberately answers only valid / not valid — it never reveals WHO owns a
-- code — and the code still has to be redeemed after sign-in, where every real
-- eligibility rule is enforced. (A signed-out caller can therefore learn only
-- that a code exists, which is already true of anyone holding the link.)
CREATE OR REPLACE FUNCTION public.ican_referral_check_code(p_code TEXT, p_source_app TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code    TEXT := upper(trim(COALESCE(p_code, '')));
  c         public.ican_referral_codes%ROWTYPE;
  v_enabled BOOLEAN;
BEGIN
  IF p_source_app NOT IN ('ican', 'mybodaguy') THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'invalid_app');
  END IF;
  IF v_code = '' OR length(v_code) > 20 THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'invalid_code');
  END IF;

  SELECT * INTO c FROM public.ican_referral_codes WHERE code = v_code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'invalid_code');
  END IF;
  IF c.source_app <> p_source_app THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'wrong_app');
  END IF;

  SELECT enabled INTO v_enabled FROM public.ican_referral_settings WHERE id;
  IF NOT COALESCE(v_enabled, FALSE) THEN
    -- The code is real; rewards are just switched off right now.
    RETURN jsonb_build_object('valid', true, 'paused', true);
  END IF;
  RETURN jsonb_build_object('valid', true, 'paused', false);
END;
$$;
REVOKE ALL ON FUNCTION public.ican_referral_check_code(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_referral_check_code(TEXT, TEXT) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. THE TRIGGERS  — fire on every real deposit
-- ─────────────────────────────────────────────────────────────────────────────
-- Hooking the ledgers (instead of one app's buy screen) means the reward fires
-- no matter which app the friend deposits from, and keeps working however
-- buy_ican_coins() / verify-flutterwave-topup are later rewritten.
--
-- ican_referral_qualify_deposit is the single shared entry point. Two separate
-- error scopes:
--   1) qualify + compute  → on error, log and leave the referral untouched
--   2) pay                → on error, keep the computed reward and mark 'failed'
-- and neither can ever abort the deposit that fired the trigger.
-- Signature changed when live-price valuation was added; drop the old overload
-- so a re-run on an existing database doesn't leave two versions behind.
DROP FUNCTION IF EXISTS public.ican_referral_qualify_deposit(UUID, NUMERIC, UUID);

-- Give it the deposit as UGX (p_deposit_ugx), as coins (p_deposit_ican), or both;
-- whichever is missing is derived from the live price. The reward is
-- reward_percent % of the deposit's UGX value, converted to coins at that same
-- live price, so it is worth the same UGX whatever the coin is trading at.
CREATE OR REPLACE FUNCTION public.ican_referral_qualify_deposit(
  p_user_id       UUID,
  p_deposit_ugx   NUMERIC,
  p_tx_id         UUID,
  p_deposit_ican  NUMERIC DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s              public.ican_referral_settings%ROWTYPE;
  r              public.ican_referrals%ROWTYPE;
  v_price        NUMERIC;
  v_deposit_ugx  NUMERIC(18,2);
  v_deposit_ican NUMERIC(18,8);
  v_reward_ugx   NUMERIC(18,2);
  v_reward       NUMERIC(18,8);
  v_pay          JSONB;
BEGIN
  IF p_user_id IS NULL OR (COALESCE(p_deposit_ugx, 0) <= 0 AND COALESCE(p_deposit_ican, 0) <= 0) THEN RETURN; END IF;

  -- 1) qualify + compute
  BEGIN
    SELECT * INTO r FROM public.ican_referrals
     WHERE referred_id = p_user_id AND status = 'awaiting_deposit'
     FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;

    SELECT * INTO s FROM public.ican_referral_settings WHERE id;
    -- Paused: the referral simply keeps waiting (nobody is penalised; a
    -- developer can reject it explicitly if wanted).
    IF NOT s.enabled THEN RETURN; END IF;

    v_price        := public.ican_referral_live_price_ugx();
    v_deposit_ugx  := COALESCE(NULLIF(p_deposit_ugx, 0), ROUND(p_deposit_ican * v_price, 2));
    v_deposit_ican := COALESCE(NULLIF(p_deposit_ican, 0), ROUND(p_deposit_ugx / v_price, 8));

    -- Below the minimum: it isn't the "first deposit"; keep waiting for one that is.
    IF v_deposit_ican < s.min_deposit_ican THEN RETURN; END IF;

    v_reward_ugx := ROUND(v_deposit_ugx * s.reward_percent / 100, 2);
    v_reward     := ROUND(v_reward_ugx / v_price, 8);
    IF s.max_reward_ican IS NOT NULL AND v_reward > s.max_reward_ican THEN
      v_reward     := s.max_reward_ican;
      v_reward_ugx := ROUND(v_reward * v_price, 2);
    END IF;
    IF v_reward <= 0 THEN RETURN; END IF;

    UPDATE public.ican_referrals
       SET status = 'pending_approval', deposit_tx_id = p_tx_id,
           deposit_ican = v_deposit_ican, deposit_ugx = v_deposit_ugx, ican_price_ugx = v_price,
           reward_percent = s.reward_percent, reward_ican = v_reward, reward_ugx = v_reward_ugx,
           updated_at = now()
     WHERE id = r.id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'ican_referral_qualify_deposit: qualify failed for user % (tx %): %', p_user_id, p_tx_id, SQLERRM;
    RETURN;
  END;

  -- 2) pay (only when auto_pay is on; otherwise it waits in the dev panel)
  IF s.auto_pay THEN
    BEGIN
      v_pay := public.ican_referral_pay(r.id, 'auto');
      IF NOT COALESCE((v_pay->>'success')::BOOLEAN, FALSE) THEN
        UPDATE public.ican_referrals
           SET status = 'failed', decision_note = left(COALESCE(v_pay->>'error', 'payout failed'), 300), updated_at = now()
         WHERE id = r.id AND status = 'pending_approval';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'ican_referral_qualify_deposit: payout failed for referral %: %', r.id, SQLERRM;
      UPDATE public.ican_referrals
         SET status = 'failed', decision_note = left(SQLERRM, 300), updated_at = now()
       WHERE id = r.id AND status = 'pending_approval';
    END;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.ican_referral_qualify_deposit(UUID, NUMERIC, UUID, NUMERIC) FROM PUBLIC, anon, authenticated;

-- (a) ICAN coin purchase: buy_ican_coins() writes a 'buy' row, in coins already.
-- Valued as coins x live price (the qualifier derives it) — deliberately NOT the
-- row's ugx_floor_value, which is always coins x 5,000 and understates what a
-- coin purchase at the live price is worth.
CREATE OR REPLACE FUNCTION public.ican_referral_on_buy()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ican_referral_qualify_deposit(NEW.recipient_user_id, NULL, NEW.id, NEW.ican_amount);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ican_referral_on_buy failed for tx %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ican_referral_on_buy() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ican_referral_on_buy ON public.ican_coin_transactions;
CREATE TRIGGER ican_referral_on_buy
  AFTER INSERT ON public.ican_coin_transactions
  FOR EACH ROW
  WHEN (NEW.transaction_type = 'buy')
  EXECUTE FUNCTION public.ican_referral_on_buy();

-- (b) Wallet Top Up: verify-flutterwave-topup writes a completed 'topup' row in
-- the payer's own currency. It is valued in UGX (other currencies via the
-- platform's rate table) and the qualifier prices it in coins at the live price.
-- A currency with no rate yields NULL and is ignored (see the KNOWN LIMITS).
-- Reads the row via to_jsonb(NEW) so it works against whichever historical shape
-- of wallet_transactions is live: a missing column just yields NULL and skips.
CREATE OR REPLACE FUNCTION public.ican_referral_on_topup()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row JSONB := to_jsonb(NEW);
BEGIN
  IF v_row->>'type' = 'topup' AND v_row->>'status' = 'completed' THEN
    PERFORM public.ican_referral_qualify_deposit(
      (v_row->>'user_id')::UUID,
      public.ican_referral_ugx_value((v_row->>'amount')::NUMERIC, COALESCE(NULLIF(v_row->>'currency', ''), 'UGX')),
      (v_row->>'id')::UUID);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ican_referral_on_topup failed: %', SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ican_referral_on_topup() FROM PUBLIC, anon, authenticated;

-- Installed only if wallet_transactions has the Flutterwave-era `type` column
-- (verify-flutterwave-topup inserts it); otherwise this part is skipped and the
-- ICAN-coin trigger above still works on its own.
DO $$
BEGIN
  IF to_regclass('public.wallet_transactions') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'wallet_transactions' AND column_name = 'type') THEN
    RAISE NOTICE 'wallet_transactions.type not found — wallet top-up trigger skipped (ICAN coin purchases still count).';
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS ican_referral_on_topup_insert ON public.wallet_transactions;
  CREATE TRIGGER ican_referral_on_topup_insert
    AFTER INSERT ON public.wallet_transactions
    FOR EACH ROW
    WHEN (NEW.type = 'topup' AND NEW.status = 'completed')
    EXECUTE FUNCTION public.ican_referral_on_topup();

  -- A top-up recorded as pending and completed later must count then.
  DROP TRIGGER IF EXISTS ican_referral_on_topup_update ON public.wallet_transactions;
  CREATE TRIGGER ican_referral_on_topup_update
    AFTER UPDATE OF status ON public.wallet_transactions
    FOR EACH ROW
    WHEN (NEW.type = 'topup' AND NEW.status = 'completed' AND OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION public.ican_referral_on_topup();
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. DEVELOPER-PANEL RPCs  (manage the program + individual rewards)
-- ─────────────────────────────────────────────────────────────────────────────
-- Every function checks ican_referral_is_manager() itself and raises
-- 'unauthorized' otherwise. The ICAN dev panel passes its dev token as
-- p_dev_token; an active BodaGo developer signed in with a real session is also
-- accepted (no UI uses that path today, but it is the stronger credential).

-- Settings + program-wide numbers for the dashboard header.
CREATE OR REPLACE FUNCTION public.ican_referral_dev_overview(p_dev_token TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.ican_referral_is_manager(p_dev_token) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN jsonb_build_object(
    'settings', (SELECT to_jsonb(s) FROM public.ican_referral_settings s WHERE s.id),
    'live_price_ugx', public.ican_referral_live_price_ugx(),
    'totals', jsonb_build_object(
      'joined',            (SELECT count(*) FROM public.ican_referrals),
      'awaiting_deposit',  (SELECT count(*) FROM public.ican_referrals WHERE status = 'awaiting_deposit'),
      'pending_approval',  (SELECT count(*) FROM public.ican_referrals WHERE status = 'pending_approval'),
      'paid',              (SELECT count(*) FROM public.ican_referrals WHERE status = 'paid'),
      'rejected',          (SELECT count(*) FROM public.ican_referrals WHERE status = 'rejected'),
      'failed',            (SELECT count(*) FROM public.ican_referrals WHERE status = 'failed'),
      'paid_ican',         COALESCE((SELECT sum(reward_ican) FROM public.ican_referrals WHERE status = 'paid'), 0),
      'pending_ican',      COALESCE((SELECT sum(reward_ican) FROM public.ican_referrals WHERE status IN ('pending_approval', 'failed')), 0),
      'deposits_ican',     COALESCE((SELECT sum(deposit_ican) FROM public.ican_referrals WHERE status IN ('paid', 'pending_approval', 'failed')), 0),
      'paid_ugx',          COALESCE((SELECT sum(reward_ugx) FROM public.ican_referrals WHERE status = 'paid'), 0),
      'pending_ugx',       COALESCE((SELECT sum(reward_ugx) FROM public.ican_referrals WHERE status IN ('pending_approval', 'failed')), 0),
      'deposits_ugx',      COALESCE((SELECT sum(deposit_ugx) FROM public.ican_referrals WHERE status IN ('paid', 'pending_approval', 'failed')), 0),
      'by_app', COALESCE((
        SELECT jsonb_object_agg(source_app, jsonb_build_object('joined', n, 'paid_ican', paid))
        FROM (SELECT source_app, count(*) AS n,
                     COALESCE(sum(reward_ican) FILTER (WHERE status = 'paid'), 0) AS paid
              FROM public.ican_referrals GROUP BY source_app) a), '{}'::JSONB)));
END;
$$;

-- Partial update of the settings. Only keys present in p_patch change; a JSON
-- null for max_reward_ican removes the cap. Validated here as well as by the
-- table CHECKs so the panel gets a readable error instead of a constraint name.
CREATE OR REPLACE FUNCTION public.ican_referral_dev_update_settings(p_patch JSONB, p_dev_token TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pct NUMERIC; v_cap NUMERIC; v_min NUMERIC;
BEGIN
  IF NOT public.ican_referral_is_manager(p_dev_token) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Nothing to update');
  END IF;

  IF p_patch ? 'reward_percent' THEN
    v_pct := (p_patch->>'reward_percent')::NUMERIC;
    IF v_pct IS NULL OR v_pct < 0 OR v_pct > 25 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Reward % must be between 0 and 25');
    END IF;
  END IF;
  IF p_patch ? 'max_reward_ican' AND jsonb_typeof(p_patch->'max_reward_ican') <> 'null' THEN
    v_cap := (p_patch->>'max_reward_ican')::NUMERIC;
    IF v_cap <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cap must be greater than 0 (or empty for no cap)');
    END IF;
  END IF;
  IF p_patch ? 'min_deposit_ican' THEN
    v_min := (p_patch->>'min_deposit_ican')::NUMERIC;
    IF v_min IS NULL OR v_min < 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Minimum deposit cannot be negative');
    END IF;
  END IF;

  UPDATE public.ican_referral_settings SET
    enabled          = CASE WHEN p_patch ? 'enabled'  THEN (p_patch->>'enabled')::BOOLEAN  ELSE enabled  END,
    auto_pay         = CASE WHEN p_patch ? 'auto_pay' THEN (p_patch->>'auto_pay')::BOOLEAN ELSE auto_pay END,
    reward_percent   = CASE WHEN p_patch ? 'reward_percent'  THEN v_pct ELSE reward_percent  END,
    min_deposit_ican = CASE WHEN p_patch ? 'min_deposit_ican' THEN v_min ELSE min_deposit_ican END,
    max_reward_ican  = CASE WHEN p_patch ? 'max_reward_ican'
                            THEN CASE WHEN jsonb_typeof(p_patch->'max_reward_ican') = 'null' THEN NULL ELSE v_cap END
                            ELSE max_reward_ican END,
    updated_at = now(),
    updated_by = COALESCE(auth.email(), 'dev-token')
  WHERE id;

  RETURN jsonb_build_object('success', true, 'settings', (SELECT to_jsonb(s) FROM public.ican_referral_settings s WHERE s.id));
END;
$$;

-- Newest-first list with names/emails, optionally filtered.
CREATE OR REPLACE FUNCTION public.ican_referral_dev_list(
  p_status     TEXT DEFAULT NULL,
  p_source_app TEXT DEFAULT NULL,
  p_limit      INT  DEFAULT 100,
  p_dev_token  TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.ican_referral_is_manager(p_dev_token) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY x->>'created_at' DESC) FROM (
      SELECT jsonb_build_object(
        'id', r.id, 'source_app', r.source_app, 'status', r.status, 'referral_code', r.referral_code,
        'referrer_id', r.referrer_id,
        'referrer_name', public.ican_referral_display_name(r.referrer_id),
        'referrer_email', (SELECT email FROM auth.users WHERE id = r.referrer_id),
        'referred_id', r.referred_id,
        'referred_name', public.ican_referral_display_name(r.referred_id),
        'referred_email', (SELECT email FROM auth.users WHERE id = r.referred_id),
        'deposit_ican', r.deposit_ican, 'deposit_ugx', r.deposit_ugx, 'ican_price_ugx', r.ican_price_ugx,
        'reward_percent', r.reward_percent, 'reward_ican', r.reward_ican, 'reward_ugx', r.reward_ugx,
        'decided_by', r.decided_by, 'decided_at', r.decided_at, 'decision_note', r.decision_note,
        'created_at', r.created_at) AS x
      FROM public.ican_referrals r
      WHERE (p_status IS NULL OR r.status = p_status)
        AND (p_source_app IS NULL OR r.source_app = p_source_app)
      ORDER BY r.created_at DESC
      LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
    ) t), '[]'::JSONB);
END;
$$;

-- approve → pays a 'pending_approval' / 'failed' reward now.
-- reject  → voids an 'awaiting_deposit' / 'pending_approval' / 'failed' referral
--           (an 'awaiting_deposit' one will then never pay out).
CREATE OR REPLACE FUNCTION public.ican_referral_dev_decide(
  p_referral_id UUID,
  p_action      TEXT,
  p_note        TEXT DEFAULT NULL,
  p_dev_token   TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor TEXT := COALESCE(auth.email(), 'dev-token');
  v_rows  INT;
BEGIN
  IF NOT public.ican_referral_is_manager(p_dev_token) THEN RAISE EXCEPTION 'unauthorized'; END IF;

  IF p_action = 'approve' THEN
    RETURN public.ican_referral_pay(p_referral_id, v_actor, p_note);
  ELSIF p_action = 'reject' THEN
    UPDATE public.ican_referrals
       SET status = 'rejected', decided_by = v_actor, decided_at = now(),
           decision_note = COALESCE(p_note, decision_note), updated_at = now()
     WHERE id = p_referral_id AND status IN ('awaiting_deposit', 'pending_approval', 'failed');
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Only unpaid referrals can be rejected');
    END IF;
    RETURN jsonb_build_object('success', true);
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'Unknown action');
END;
$$;

-- Pays every 'pending_approval' reward in one go (the "approve all" button).
CREATE OR REPLACE FUNCTION public.ican_referral_dev_approve_all(p_dev_token TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor TEXT := COALESCE(auth.email(), 'dev-token');
  v_id    UUID;
  v_ok    INT := 0;
  v_fail  INT := 0;
  v_res   JSONB;
BEGIN
  IF NOT public.ican_referral_is_manager(p_dev_token) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  FOR v_id IN SELECT id FROM public.ican_referrals WHERE status = 'pending_approval' ORDER BY created_at LIMIT 200 LOOP
    v_res := public.ican_referral_pay(v_id, v_actor, 'Bulk approved');
    IF COALESCE((v_res->>'success')::BOOLEAN, FALSE) THEN v_ok := v_ok + 1; ELSE v_fail := v_fail + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'paid', v_ok, 'failed', v_fail);
END;
$$;

-- Same grant convention as the other ican_dev_* functions (the function itself
-- is the gate; the ICAN panel may call with or without a Supabase session).
REVOKE ALL ON FUNCTION public.ican_referral_dev_overview(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ican_referral_dev_update_settings(JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ican_referral_dev_list(TEXT, TEXT, INT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ican_referral_dev_decide(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ican_referral_dev_approve_all(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ican_referral_dev_overview(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ican_referral_dev_update_settings(JSONB, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ican_referral_dev_list(TEXT, TEXT, INT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ican_referral_dev_decide(UUID, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ican_referral_dev_approve_all(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Referral system installed: 5%% of a friend''s first ICAN deposit -> referrer (settings editable from the dev panels).';
END $$;
