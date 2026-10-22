-- ============================================================================
-- Restricted zones: an organisation controls which vehicles may enter its area
--
-- THE IDEA
--   Some places are restricted: an estate, a campus, a hospital, a market, an industrial park, a port. The organisation that
--   runs one registers on IcanEra (it already has a business account and a CMMS company), then, in CMMS > Transport:
--     1. creates a ZONE and decides how outsiders get in (never / by paying an entry fee, per vehicle class);
--     2. adds the vehicles it trusts to the zone's APPROVED LIST - bodas, tuktuks, cars, vans, trucks, bicycles: anything
--        that holds a BodaGoEra rider ID card. They are "staff" of the zone (or contractor / resident / supplier / vip),
--        optionally only for some dates or hours;
--     3. runs the GATE DESK. The gate scans the QR on the rider's ID card. The card is checked LIVE (genuine, paid, not
--        expired, rider active), and then:
--          approved vehicle ........... "Access granted" - checked in, and it never pays anything (no entry fee, no
--                                       overstay fee)
--          not approved ............... MUST PAY: the entry fee for its vehicle class is requested from the rider. The rider
--                                       approves it in the BodaGoEra app (with their PIN) or the gate collects cash; only
--                                       then is the vehicle in. (A zone that sets no fee at all is members only: a vehicle
--                                       that is not approved is refused.)
--          approved but suspended / expired / outside its hours ... treated as not approved, so it pays
--     4. at the way OUT the gate scans the same card. The vehicle must have been checked in, and must have CLEARED
--        everything (entry fee paid, overstay paid) - "Cleared to leave". Anything unpaid holds the vehicle.
--
-- WHAT ICANERA TAKES
--   3% of every fee a business sets (ican_fee_rates.zone_access_fee, default 0.03). The rider always pays exactly the fee the
--   zone published - nothing is added on top. The business receives 97%. A developer changes the rate the same way as the
--   other platform fees:   UPDATE public.ican_fee_rates SET rate = 0.025 WHERE key = 'zone_access_fee';
--   Wallet payments are split at once. Cash is collected by the business, so IcanEra's cut of a cash fee is taken from the
--   business's ICAN wallet (and kept as "owed" on the visit until the wallet can cover it, then settled automatically).
--
-- WHO MAY DO WHAT (checked here, in the database - the screens only hide buttons)
--   The business owner and CMMS administrators can do everything. Any other CMMS role needs the matching action on its
--   "Transport" tool in Role and tool configuration:
--     edit    create and change zones, fees and rules
--     assign  manage the approved list (add, suspend, remove)
--     gate    run the gate desk (scan in / out, collect cash)
--     view    read-only: zones, who is inside, the log
--
-- MONEY
--   Fees are set in UGX and converted to ICAN at the same 5000 UGX = 1 ICAN rate the rides use (setting
--   access_zone.ugx_per_ican overrides it). A rider's fee is debited with mbg_debit_journey_fare, the business and IcanEra are
--   credited in the same transaction - if any step fails nothing moves.
--
-- WHAT THIS MIGRATION ADDS
--   tables      mbg_access_zones, mbg_access_zone_fees, mbg_access_zone_members, mbg_access_visits (no direct API access:
--               everything goes through the functions below)
--   rate        ican_fee_rates 'zone_access_fee' = 3%  (ican_fee_rate() learns its fallback)
--   staff API   mbg_zone_upsert, mbg_zone_list, mbg_zone_search_riders, mbg_zone_member_add, mbg_zone_member_set_status,
--               mbg_zone_members, mbg_zone_gate_scan (one scan: in, out or auto), mbg_zone_gate_check_in,
--               mbg_zone_gate_check_out, mbg_zone_gate_collect_cash,
--               mbg_zone_gate_cancel, mbg_zone_visits, mbg_zone_visit_status, mbg_zone_report, mbg_zone_settle_owed
--   rider API   mbg_my_gate_passes, mbg_rider_pay_gate_fee, mbg_rider_decline_gate_fee
--
-- Run after: ADD_RIDER_ID_CARDS.sql + ADD_RIDER_CARD_EXPIRY_AND_KIN.sql (mybodaguy), FEE_RATES + SALE_PLATFORM_FEES,
-- ROUTE_PLATFORM_FEES_TO_IWOS_BUSINESS.sql, the CMMS schema, SHARED_CORPORATE_TRANSPORT_AND_MONTHLY_RIDERS.sql.
-- Safe to run twice. Roll back with supabase/rollback/20261110_rollback_restricted_zone_access.sql.
-- ============================================================================


-- ─── 0. Make sure everything this builds on is there ─────────────────────────

DO $guard$
BEGIN
  IF to_regclass('public.ican_fee_rates') IS NULL OR to_regprocedure('public.ican_fee_rate(text)') IS NULL THEN
    RAISE EXCEPTION 'Run FEE_RATES_PASTE_INTO_SUPABASE.sql first - it creates public.ican_fee_rates.';
  END IF;
  IF to_regprocedure('public.fn_credit_platform_fee_to_business(numeric,text,text,text,uuid,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Run ROUTE_PLATFORM_FEES_TO_IWOS_BUSINESS.sql first - it sets up the business that receives ICANera''s fees.';
  END IF;
  IF to_regclass('public.mbg_riders') IS NULL OR to_regclass('public.mbg_rider_cards') IS NULL
     OR to_regprocedure('public.mbg_rider_card_payload(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Run mybodaguy/backend/database/ADD_RIDER_ID_CARDS.sql and ADD_RIDER_CARD_EXPIRY_AND_KIN.sql first - zones check the rider ID card.';
  END IF;
  IF to_regprocedure('public.mbg_debit_journey_fare(uuid,numeric,text,text)') IS NULL
     AND to_regprocedure('public.mbg_debit_journey_fare(uuid,numeric,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Run ICAN/backend/CREATE_JOURNEY_ESCROW_FUNCTION.sql first - it creates mbg_debit_journey_fare, the rider wallet debit.';
  END IF;
  IF to_regclass('public.cmms_users') IS NULL OR to_regclass('public.cmms_company_profiles') IS NULL THEN
    RAISE EXCEPTION 'Run the CMMS schema first - zones are managed from CMMS.';
  END IF;
  IF to_regclass('public.ican_business_wallets') IS NULL OR to_regclass('public.ican_business_wallet_transactions') IS NULL THEN
    RAISE EXCEPTION 'Run PITCHIN_BUSINESS_PROFILE_ICAN_WALLET.sql and UNIFIED_BUSINESS_WALLET_OPERATIONS.sql first - the business wallet receives the fees.';
  END IF;
END $guard$;


-- ─── 1. IcanEra's cut: one row in the fee table ──────────────────────────────

-- DO NOTHING on conflict: running this again must never undo a rate the developer has already changed.
INSERT INTO public.ican_fee_rates (key, rate, label) VALUES
  ('zone_access_fee', 0.03, 'ICANera''s cut of every restricted-zone entry or overstay fee a business sets - taken out of what the business receives, never added to the rider''s fee')
ON CONFLICT (key) DO NOTHING;

-- Same function as before plus the new fallback: a row someone deleted must not turn a charge into "free".
CREATE OR REPLACE FUNCTION public.ican_fee_rate(p_key TEXT) RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT r.rate FROM public.ican_fee_rates r WHERE r.key = p_key),
    -- a deleted row must not turn a charge into "free" by accident
    CASE p_key
      WHEN 'send_mobile_money' THEN 0.03
      WHEN 'send_bank'         THEN 0.03
      WHEN 'withdraw_wallet'   THEN 0.03
      WHEN 'coin_cash_out'     THEN 0.03
      WHEN 'dropship_sale'     THEN 0.02
      WHEN 'store_sale'        THEN 0.01
      WHEN 'zone_access_fee'   THEN 0.03
      ELSE 0
    END)
$$;


-- ─── 2. Tables ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.mbg_access_zones (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id       UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  name                      TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  kind                      TEXT NOT NULL DEFAULT 'other'
                              CHECK (kind IN ('estate', 'campus', 'hospital', 'market', 'industrial', 'port', 'event', 'other')),
  location                  TEXT,
  status                    TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'closed')),
  -- members_only: only the approved list gets in.  paid_entry: everyone else may enter by paying the fee for their vehicle class.
  entry_mode                TEXT NOT NULL DEFAULT 'members_only' CHECK (entry_mode IN ('members_only', 'paid_entry')),
  -- per_entry: the fee is charged every time.  day_pass: one payment covers every entry for the next 24 hours.
  fee_basis                 TEXT NOT NULL DEFAULT 'per_entry' CHECK (fee_basis IN ('per_entry', 'day_pass')),
  accept_cash               BOOLEAN NOT NULL DEFAULT false,
  -- Refuse a vehicle whose rider's driving permit has expired (otherwise it is only a warning on the gate desk).
  require_valid_permit      BOOLEAN NOT NULL DEFAULT false,
  max_stay_minutes          INTEGER CHECK (max_stay_minutes IS NULL OR max_stay_minutes > 0),
  overstay_fee_ugx_per_hour NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (overstay_fee_ugx_per_hour >= 0),
  payment_window_minutes    INTEGER NOT NULL DEFAULT 10 CHECK (payment_window_minutes BETWEEN 1 AND 120),
  timezone                  TEXT NOT NULL DEFAULT 'Africa/Kampala',
  created_by                UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mbg_access_zones_name_uq
  ON public.mbg_access_zones (business_profile_id, lower(btrim(name)));

-- One row per vehicle class the zone lets in by paying. A class with no row cannot buy entry; a row with fee 0 lets it in free.
CREATE TABLE IF NOT EXISTS public.mbg_access_zone_fees (
  zone_id      UUID NOT NULL REFERENCES public.mbg_access_zones(id) ON DELETE CASCADE,
  vehicle_type TEXT NOT NULL CHECK (vehicle_type IN ('motorcycle', 'bicycle', 'tuktuk', 'car', 'van', 'truck')),
  fee_ugx      NUMERIC(12, 2) NOT NULL CHECK (fee_ugx >= 0),
  PRIMARY KEY (zone_id, vehicle_type)
);

-- The approved list. One row per rider registration (= one vehicle), because a rider card belongs to a registration.
CREATE TABLE IF NOT EXISTS public.mbg_access_zone_members (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id          UUID NOT NULL REFERENCES public.mbg_access_zones(id) ON DELETE CASCADE,
  rider_id         UUID NOT NULL REFERENCES public.mbg_riders(id) ON DELETE CASCADE,
  rider_user_id    UUID,
  member_kind      TEXT NOT NULL DEFAULT 'staff' CHECK (member_kind IN ('staff', 'contractor', 'resident', 'supplier', 'vip')),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
  valid_from       TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until      TIMESTAMPTZ,
  -- Allowed hours (zone time). Start later than end means overnight (22:00 - 06:00). Both NULL = any hour.
  daily_start_time TIME,
  daily_end_time   TIME,
  note             TEXT,
  added_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (zone_id, rider_id),
  CHECK ((daily_start_time IS NULL) = (daily_end_time IS NULL))
);
CREATE INDEX IF NOT EXISTS mbg_access_zone_members_user_idx ON public.mbg_access_zone_members (rider_user_id);

-- Every scan that matters: who came, why they were let in (or refused), what they paid, when they left.
CREATE TABLE IF NOT EXISTS public.mbg_access_visits (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id                   UUID NOT NULL REFERENCES public.mbg_access_zones(id) ON DELETE CASCADE,
  business_profile_id       UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  rider_id                  UUID REFERENCES public.mbg_riders(id) ON DELETE SET NULL,
  rider_user_id             UUID,
  card_id                   UUID REFERENCES public.mbg_rider_cards(id) ON DELETE SET NULL,
  -- what the card said at the time, kept so the log survives later edits
  card_number               TEXT,
  rider_name                TEXT,
  plate_number              TEXT,
  vehicle_type              TEXT,
  access_basis              TEXT CHECK (access_basis IN ('member', 'paid', 'day_pass', 'open')),
  status                    TEXT NOT NULL CHECK (status IN ('awaiting_payment', 'inside', 'exited', 'denied', 'cancelled')),
  reason                    TEXT,
  entry_fee_ugx             NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (entry_fee_ugx >= 0),
  overstay_ugx              NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (overstay_ugx >= 0),
  fee_due_ugx               NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (fee_due_ugx >= 0),
  fee_paid_ugx              NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (fee_paid_ugx >= 0),
  payment_method            TEXT CHECK (payment_method IN ('wallet', 'cash')),
  payment_tx_id             UUID,
  platform_fee_rate         NUMERIC(7, 6),
  platform_fee_ugx          NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (platform_fee_ugx >= 0),
  platform_fee_settled_ugx  NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (platform_fee_settled_ugx >= 0),
  balance_paid_at           TIMESTAMPTZ,
  warnings                  JSONB NOT NULL DEFAULT '[]'::JSONB,
  plate_seen                TEXT,
  gate_in                   TEXT,
  gate_out                  TEXT,
  checked_in_by             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  checked_out_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  pay_by                    TIMESTAMPTZ,
  entered_at                TIMESTAMPTZ,
  exited_at                 TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (fee_paid_ugx <= fee_due_ugx OR status IN ('denied', 'cancelled'))
);
-- A vehicle is in a zone once: a second scan finds the first visit instead of making another.
CREATE UNIQUE INDEX IF NOT EXISTS mbg_access_visits_one_open
  ON public.mbg_access_visits (zone_id, rider_id)
  WHERE status IN ('awaiting_payment', 'inside');
CREATE INDEX IF NOT EXISTS mbg_access_visits_zone_idx     ON public.mbg_access_visits (zone_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS mbg_access_visits_business_idx ON public.mbg_access_visits (business_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mbg_access_visits_rider_idx    ON public.mbg_access_visits (rider_user_id, created_at DESC);

-- No policies and no grants: the API roles reach these tables only through the functions below (which run as their owner and
-- check who is asking), so a signed-in user can never read another business's list or a rider's trips directly.
ALTER TABLE public.mbg_access_zones        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mbg_access_zone_fees    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mbg_access_zone_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mbg_access_visits       ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mbg_access_zones, public.mbg_access_zone_fees, public.mbg_access_zone_members, public.mbg_access_visits
  FROM PUBLIC, anon, authenticated;


-- ─── 3. Internal helpers (not callable from the API) ─────────────────────────

-- UGX per 1 ICAN: the rate rides use, overridable by one setting.
CREATE OR REPLACE FUNCTION public.mbg_zone_ugx_per_ican() RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(public.mbg_get_setting_numeric('access_zone.ugx_per_ican', 5000), 0), 5000)
$$;

-- May the signed-in user do p_action for this business's zones?  p_action: view | edit | assign | gate | any.
-- The business owner and CMMS administrators always can. Anyone else needs the action on their role's "transport" tool
-- (the same cmms_roles.tool_access the CMMS screens read); a role whose transport access is a plain true grants all four.
CREATE OR REPLACE FUNCTION public.mbg_zone_staff_can(p_business_profile_id UUID, p_action TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_row RECORD;
  v_t   JSONB;
BEGIN
  IF auth.uid() IS NULL OR p_business_profile_id IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (SELECT 1 FROM public.business_profiles bp WHERE bp.id = p_business_profile_id AND bp.user_id = auth.uid()) THEN
    RETURN true;
  END IF;

  FOR v_row IN
    SELECT (lower(COALESCE(r.role_name, cu.role, '')) IN ('admin', 'administrator', 'cmms_admin', 'business_admin')
            OR COALESCE((to_jsonb(cu) ->> 'is_creator')::BOOLEAN, false)) AS is_admin,
           r.tool_access
      FROM public.cmms_users cu
      JOIN public.cmms_company_profiles cp ON cp.id = cu.cmms_company_id
      LEFT JOIN public.cmms_user_roles ur ON ur.cmms_user_id = cu.id AND ur.is_active
      LEFT JOIN public.cmms_roles r ON r.id = ur.cmms_role_id AND r.is_active
     WHERE cp.pichin_business_profile_id = p_business_profile_id
       AND cu.is_active
       AND lower(cu.email) = lower(auth.jwt() ->> 'email')
  LOOP
    IF v_row.is_admin THEN
      RETURN true;
    END IF;
    v_t := v_row.tool_access -> 'transport';
    IF v_t IS NULL OR v_t = 'null'::JSONB THEN
      CONTINUE;
    END IF;
    IF jsonb_typeof(v_t) = 'boolean' THEN
      IF (v_t #>> '{}')::BOOLEAN THEN RETURN true; END IF;
    ELSIF jsonb_typeof(v_t) = 'object' THEN
      IF p_action = 'any' THEN
        IF COALESCE((v_t ->> 'view')::BOOLEAN, false) OR COALESCE((v_t ->> 'edit')::BOOLEAN, false)
           OR COALESCE((v_t ->> 'assign')::BOOLEAN, false) OR COALESCE((v_t ->> 'gate')::BOOLEAN, false) THEN
          RETURN true;
        END IF;
      ELSIF COALESCE((v_t ->> p_action)::BOOLEAN, false) THEN
        RETURN true;
      END IF;
    END IF;
  END LOOP;
  RETURN false;
END;
$$;

-- "UAB 123X" / "uab-123x" -> "UAB123X", so a plate typed or read by eye compares with the card's.
CREATE OR REPLACE FUNCTION public.mbg_zone_norm_plate(p_plate TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT upper(regexp_replace(COALESCE(p_plate, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

-- The code on a rider card, from whatever the scanner read: the bare code or the whole https://.../rider-card/<code> link.
CREATE OR REPLACE FUNCTION public.mbg_zone_card_code(p_scan TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT substring(regexp_replace(btrim(COALESCE(p_scan, '')), '^.*/rider-card/', '') FROM '^[A-Za-z0-9]{16,64}')
$$;

-- Is this approved-list row good right now?  'ok' or the reason it is not.
CREATE OR REPLACE FUNCTION public.mbg_zone_member_state(p_member public.mbg_access_zone_members, p_tz TEXT)
RETURNS TEXT
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_local TIME;
BEGIN
  IF p_member.id IS NULL THEN RETURN 'not_on_list'; END IF;
  IF p_member.status = 'revoked'   THEN RETURN 'member_revoked'; END IF;
  IF p_member.status = 'suspended' THEN RETURN 'member_suspended'; END IF;
  IF p_member.valid_from > now()   THEN RETURN 'member_not_started'; END IF;
  IF p_member.valid_until IS NOT NULL AND p_member.valid_until < now() THEN RETURN 'member_expired'; END IF;
  IF p_member.daily_start_time IS NOT NULL THEN
    v_local := (now() AT TIME ZONE p_tz)::TIME;
    IF p_member.daily_start_time <= p_member.daily_end_time THEN
      IF v_local < p_member.daily_start_time OR v_local > p_member.daily_end_time THEN RETURN 'outside_hours'; END IF;
    ELSE
      IF v_local < p_member.daily_start_time AND v_local > p_member.daily_end_time THEN RETURN 'outside_hours'; END IF;
    END IF;
  END IF;
  RETURN 'ok';
END;
$$;

-- What the gate may see of a rider: the same public-safe fields the QR page shows - never phone, e-mail, full permit or wallet.
CREATE OR REPLACE FUNCTION public.mbg_zone_rider_view(p_payload JSONB) RETURNS JSONB
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'full_name',    p_payload ->> 'full_name',
    'avatar_url',   p_payload ->> 'avatar_url',
    'vehicle_type', p_payload ->> 'vehicle_type',
    'vehicle_model', p_payload ->> 'vehicle_model',
    'vehicle_color', p_payload ->> 'vehicle_color',
    'plate_number', p_payload ->> 'plate_number',
    'card_number',  p_payload ->> 'card_number',
    'expires_at',   p_payload ->> 'expires_at',
    'stage',        p_payload ->> 'stage',
    'division',     p_payload ->> 'division',
    'permit_status', p_payload ->> 'permit_status')
$$;

-- A request that is not paid in time lapses by itself - no cron needed, every entry point sweeps first.
CREATE OR REPLACE FUNCTION public.mbg_zone_expire_stale() RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.mbg_access_visits
     SET status = 'cancelled', reason = 'The entry fee was not paid in time'
   WHERE status = 'awaiting_payment' AND pay_by IS NOT NULL AND pay_by < now()
$$;

-- Overstay fee for a visit at time p_end: whole hours past the zone's maximum stay, at the zone's hourly overstay fee.
CREATE OR REPLACE FUNCTION public.mbg_zone_overstay(p_visit public.mbg_access_visits, p_zone public.mbg_access_zones, p_end TIMESTAMPTZ)
RETURNS NUMERIC
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_over INTEGER;
BEGIN
  -- Approved vehicles never pay: no entry fee, and no overstay fee either.
  IF p_visit.access_basis = 'member' THEN
    RETURN 0;
  END IF;
  IF p_zone.max_stay_minutes IS NULL OR p_zone.overstay_fee_ugx_per_hour <= 0 OR p_visit.entered_at IS NULL THEN
    RETURN 0;
  END IF;
  v_over := floor(extract(epoch FROM (p_end - p_visit.entered_at)) / 60)::INTEGER - p_zone.max_stay_minutes;
  IF v_over <= 0 THEN RETURN 0; END IF;
  RETURN ceil(v_over / 60.0) * p_zone.overstay_fee_ugx_per_hour;
END;
$$;

-- Recompute what a vehicle inside owes (entry fee + overstay so far). For 15 minutes after the rider pays an overstay balance
-- the clock stops at the moment they paid, so paying and then walking to the barrier does not start a new hour.
CREATE OR REPLACE FUNCTION public.mbg_zone_refresh_balance(p_visit_id UUID)
RETURNS public.mbg_access_visits
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v    public.mbg_access_visits;
  z    public.mbg_access_zones;
  v_end TIMESTAMPTZ;
  v_over NUMERIC;
BEGIN
  SELECT * INTO v FROM public.mbg_access_visits WHERE id = p_visit_id FOR UPDATE;
  IF NOT FOUND OR v.status <> 'inside' THEN RETURN v; END IF;
  SELECT * INTO z FROM public.mbg_access_zones WHERE id = v.zone_id;
  v_end := CASE WHEN v.balance_paid_at IS NOT NULL AND now() < v.balance_paid_at + INTERVAL '15 minutes'
                THEN v.balance_paid_at ELSE now() END;
  v_over := GREATEST(v.overstay_ugx, public.mbg_zone_overstay(v, z, v_end));   -- never goes down
  IF v_over IS DISTINCT FROM v.overstay_ugx THEN
    UPDATE public.mbg_access_visits
       SET overstay_ugx = v_over,
           fee_due_ugx = entry_fee_ugx + v_over,
           platform_fee_rate = COALESCE(platform_fee_rate, public.ican_fee_rate('zone_access_fee'))
     WHERE id = v.id
     RETURNING * INTO v;
  END IF;
  RETURN v;
END;
$$;

-- The visit as the screens see it.
CREATE OR REPLACE FUNCTION public.mbg_zone_visit_json(p_visit public.mbg_access_visits) RETURNS JSONB
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id',               p_visit.id,
    'zone_id',          p_visit.zone_id,
    'status',           p_visit.status,
    'access_basis',     p_visit.access_basis,
    'reason',           p_visit.reason,
    'rider_name',       p_visit.rider_name,
    'plate_number',     p_visit.plate_number,
    'vehicle_type',     p_visit.vehicle_type,
    'card_number',      p_visit.card_number,
    'entry_fee_ugx',    p_visit.entry_fee_ugx,
    'overstay_ugx',     p_visit.overstay_ugx,
    'fee_due_ugx',      p_visit.fee_due_ugx,
    'fee_paid_ugx',     p_visit.fee_paid_ugx,
    'balance_ugx',      GREATEST(p_visit.fee_due_ugx - p_visit.fee_paid_ugx, 0),
    'payment_method',   p_visit.payment_method,
    'platform_fee_ugx', p_visit.platform_fee_ugx,
    'platform_fee_owed_ugx', GREATEST(p_visit.platform_fee_ugx - p_visit.platform_fee_settled_ugx, 0),
    'warnings',         p_visit.warnings,
    'gate_in',          p_visit.gate_in,
    'gate_out',         p_visit.gate_out,
    'requested_at',     p_visit.requested_at,
    'pay_by',           p_visit.pay_by,
    'entered_at',       p_visit.entered_at,
    'exited_at',        p_visit.exited_at)
$$;

-- A phone alert for the rider when a gate asks them for money. Never lets a push problem break the gate.
CREATE OR REPLACE FUNCTION public.mbg_zone_notify_rider(p_user_id UUID, p_title TEXT, p_message TEXT, p_visit_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_user_id IS NULL OR to_regprocedure('public.mbg_push(uuid,text,text,text,uuid,text,boolean)') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'SELECT public.mbg_push($1, $2, $3, $4, $5, $6)'
    USING p_user_id, 'bodagoera_gate', p_title, p_message, p_visit_id, 'mbg-gate-' || p_visit_id::TEXT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Gate push failed - %', SQLERRM;
END;
$$;

-- Take IcanEra's cut that is still unsettled on a visit out of the business wallet and pay it to ICANera.
-- Returns true when nothing is left owing. If the wallet cannot cover it, nothing moves and the amount stays owed.
CREATE OR REPLACE FUNCTION public.mbg_zone_settle_platform_fee(p_visit_id UUID) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v        public.mbg_access_visits;
  v_owner  UUID;
  v_ugx    NUMERIC;
  v_ican   NUMERIC;
  v_credit JSONB;
BEGIN
  SELECT * INTO v FROM public.mbg_access_visits WHERE id = p_visit_id FOR UPDATE;
  IF NOT FOUND THEN RETURN true; END IF;
  v_ugx := v.platform_fee_ugx - v.platform_fee_settled_ugx;
  IF v_ugx <= 0 THEN RETURN true; END IF;
  v_ican := ROUND(v_ugx / public.mbg_zone_ugx_per_ican(), 8);
  IF v_ican <= 0 THEN
    UPDATE public.mbg_access_visits SET platform_fee_settled_ugx = platform_fee_ugx WHERE id = v.id;
    RETURN true;
  END IF;
  SELECT bp.user_id INTO v_owner FROM public.business_profiles bp WHERE bp.id = v.business_profile_id;

  BEGIN   -- a block with a handler is a savepoint: if crediting IcanEra fails, the business is not debited either
    UPDATE public.ican_business_wallets
       SET ican_balance = ican_balance - v_ican, total_spent = total_spent + v_ican, updated_at = now()
     WHERE business_profile_id = v.business_profile_id AND status = 'active' AND ican_balance >= v_ican;
    IF NOT FOUND THEN
      RETURN false;
    END IF;
    INSERT INTO public.ican_business_wallet_transactions
      (business_profile_id, initiated_by, amount_ican, note, reference_id, status, executed_at, direction, source_app, operation_type, metadata)
    VALUES
      (v.business_profile_id, v_owner, v_ican, 'ICANera fee on a restricted-zone entry (cash)',
       'zone-fee:' || v.id::TEXT || ':' || round(v.platform_fee_settled_ugx * 100)::TEXT, 'completed', now(), 'out',
       'mybodaguy', 'platform_fee', jsonb_build_object('visit_id', v.id, 'zone_id', v.zone_id));
    v_credit := public.fn_credit_platform_fee_to_business(
      v_ican, 'mybodaguy', 'zone-fee:' || v.id::TEXT || ':' || round(v.platform_fee_settled_ugx * 100)::TEXT,
      'zone_access_fee', v_owner, 'Restricted-zone fee, cash entry', jsonb_build_object('visit_id', v.id, 'zone_id', v.zone_id));
    IF NOT COALESCE((v_credit ->> 'success')::BOOLEAN, false) THEN
      RAISE EXCEPTION 'platform credit failed: %', COALESCE(v_credit ->> 'error', 'unknown');
    END IF;
    UPDATE public.mbg_access_visits SET platform_fee_settled_ugx = platform_fee_ugx WHERE id = v.id;
    RETURN true;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.mbg_zone_ugx_per_ican()                                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mbg_zone_staff_can(UUID, TEXT)                             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mbg_zone_norm_plate(TEXT)                                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mbg_zone_card_code(TEXT)                                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mbg_zone_member_state(public.mbg_access_zone_members, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mbg_zone_rider_view(JSONB)                                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mbg_zone_expire_stale()                                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mbg_zone_overstay(public.mbg_access_visits, public.mbg_access_zones, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mbg_zone_refresh_balance(UUID)                             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mbg_zone_visit_json(public.mbg_access_visits)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mbg_zone_notify_rider(UUID, TEXT, TEXT, UUID)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mbg_zone_settle_platform_fee(UUID)                         FROM PUBLIC, anon, authenticated;


-- ─── 4. Staff: zones, fees, rules ────────────────────────────────────────────

-- Create (p_zone_id NULL) or change a zone. p_fees is {"motorcycle": 2000, "car": 5000, ...}: the vehicle classes that may buy
-- entry and what each pays (0 = free). It replaces the old fee list. Needs 'edit'.
CREATE OR REPLACE FUNCTION public.mbg_zone_upsert(
  p_business_profile_id UUID, p_zone_id UUID, p_name TEXT, p_kind TEXT, p_location TEXT, p_status TEXT,
  p_entry_mode TEXT, p_fee_basis TEXT, p_accept_cash BOOLEAN, p_require_valid_permit BOOLEAN,
  p_max_stay_minutes INTEGER, p_overstay_fee_per_hour NUMERIC, p_payment_window_minutes INTEGER,
  p_timezone TEXT, p_fees JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_zone  public.mbg_access_zones;
  v_id    UUID;
  v_tz    TEXT := COALESCE(NULLIF(btrim(p_timezone), ''), 'Africa/Kampala');
  v_key   TEXT;
  v_val   JSONB;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Please sign in'); END IF;

  IF p_zone_id IS NOT NULL THEN
    SELECT * INTO v_zone FROM public.mbg_access_zones WHERE id = p_zone_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Zone not found'); END IF;
    IF v_zone.business_profile_id <> p_business_profile_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'Zone not found');
    END IF;
  END IF;
  IF NOT public.mbg_zone_staff_can(p_business_profile_id, 'edit') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your role cannot change restricted zones');
  END IF;

  IF length(btrim(COALESCE(p_name, ''))) < 2 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Give the zone a name');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unknown time zone');
  END IF;
  IF p_fees IS NOT NULL AND jsonb_typeof(p_fees) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Fees must be a list of vehicle types and amounts');
  END IF;
  IF p_fees IS NOT NULL THEN
    FOR v_key, v_val IN SELECT * FROM jsonb_each(p_fees) LOOP
      IF v_key NOT IN ('motorcycle', 'bicycle', 'tuktuk', 'car', 'van', 'truck') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unknown vehicle type: ' || v_key);
      END IF;
      IF jsonb_typeof(v_val) <> 'number' OR (v_val #>> '{}')::NUMERIC < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'The fee for ' || v_key || ' must be 0 or more');
      END IF;
    END LOOP;
  END IF;
  IF COALESCE(p_entry_mode, 'members_only') = 'paid_entry' AND (p_fees IS NULL OR p_fees = '{}'::JSONB) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Set a fee for at least one vehicle type, or choose members only');
  END IF;

  BEGIN
    IF p_zone_id IS NULL THEN
      INSERT INTO public.mbg_access_zones
        (business_profile_id, name, kind, location, status, entry_mode, fee_basis, accept_cash, require_valid_permit,
         max_stay_minutes, overstay_fee_ugx_per_hour, payment_window_minutes, timezone, created_by)
      VALUES
        (p_business_profile_id, btrim(p_name), COALESCE(p_kind, 'other'), NULLIF(btrim(p_location), ''),
         COALESCE(p_status, 'active'), COALESCE(p_entry_mode, 'members_only'), COALESCE(p_fee_basis, 'per_entry'),
         COALESCE(p_accept_cash, false), COALESCE(p_require_valid_permit, false), p_max_stay_minutes,
         COALESCE(p_overstay_fee_per_hour, 0), COALESCE(p_payment_window_minutes, 10), v_tz, auth.uid())
      RETURNING id INTO v_id;
    ELSE
      UPDATE public.mbg_access_zones SET
        name = btrim(p_name), kind = COALESCE(p_kind, kind), location = NULLIF(btrim(p_location), ''),
        status = COALESCE(p_status, status), entry_mode = COALESCE(p_entry_mode, entry_mode),
        fee_basis = COALESCE(p_fee_basis, fee_basis), accept_cash = COALESCE(p_accept_cash, accept_cash),
        require_valid_permit = COALESCE(p_require_valid_permit, require_valid_permit),
        max_stay_minutes = p_max_stay_minutes, overstay_fee_ugx_per_hour = COALESCE(p_overstay_fee_per_hour, 0),
        payment_window_minutes = COALESCE(p_payment_window_minutes, payment_window_minutes),
        timezone = v_tz, updated_at = now()
      WHERE id = p_zone_id
      RETURNING id INTO v_id;
    END IF;
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object('success', false, 'error', 'You already have a zone with that name');
    WHEN check_violation THEN
      RETURN jsonb_build_object('success', false, 'error', 'One of the values is out of range: ' || SQLERRM);
  END;

  IF p_fees IS NOT NULL THEN
    DELETE FROM public.mbg_access_zone_fees WHERE zone_id = v_id;
    INSERT INTO public.mbg_access_zone_fees (zone_id, vehicle_type, fee_ugx)
    SELECT v_id, e.key, ROUND((e.value #>> '{}')::NUMERIC, 2) FROM jsonb_each(p_fees) e;
  END IF;

  RETURN jsonb_build_object('success', true, 'zone_id', v_id);
END;
$$;

-- Every zone of the business with its fees, the caller's powers and live counts. Needs any Transport action.
CREATE OR REPLACE FUNCTION public.mbg_zone_list(p_business_profile_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Please sign in'); END IF;
  IF NOT public.mbg_zone_staff_can(p_business_profile_id, 'any') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your role has no access to restricted zones');
  END IF;
  PERFORM public.mbg_zone_expire_stale();

  RETURN jsonb_build_object(
    'success', true,
    'caps', jsonb_build_object(
      'view',   public.mbg_zone_staff_can(p_business_profile_id, 'view'),
      'edit',   public.mbg_zone_staff_can(p_business_profile_id, 'edit'),
      'assign', public.mbg_zone_staff_can(p_business_profile_id, 'assign'),
      'gate',   public.mbg_zone_staff_can(p_business_profile_id, 'gate')),
    'platform_fee_rate', public.ican_fee_rate('zone_access_fee'),
    'ugx_per_ican', public.mbg_zone_ugx_per_ican(),
    'zones', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', z.id, 'name', z.name, 'kind', z.kind, 'location', z.location, 'status', z.status,
        'entry_mode', z.entry_mode, 'fee_basis', z.fee_basis, 'accept_cash', z.accept_cash,
        'require_valid_permit', z.require_valid_permit, 'max_stay_minutes', z.max_stay_minutes,
        'overstay_fee_ugx_per_hour', z.overstay_fee_ugx_per_hour, 'payment_window_minutes', z.payment_window_minutes,
        'timezone', z.timezone,
        'fees', COALESCE((SELECT jsonb_object_agg(f.vehicle_type, f.fee_ugx) FROM public.mbg_access_zone_fees f WHERE f.zone_id = z.id), '{}'::JSONB),
        'members_count',  (SELECT count(*) FROM public.mbg_access_zone_members m WHERE m.zone_id = z.id AND m.status = 'active'),
        'inside_count',   (SELECT count(*) FROM public.mbg_access_visits v WHERE v.zone_id = z.id AND v.status = 'inside'),
        'awaiting_count', (SELECT count(*) FROM public.mbg_access_visits v WHERE v.zone_id = z.id AND v.status = 'awaiting_payment'))
        ORDER BY z.created_at)
      FROM public.mbg_access_zones z WHERE z.business_profile_id = p_business_profile_id), '[]'::JSONB));
END;
$$;


-- ─── 5. Staff: the approved list ─────────────────────────────────────────────

-- Find a rider registration to approve: by plate, card number or the code on the card. Public-safe fields only. Needs 'assign'.
CREATE OR REPLACE FUNCTION public.mbg_zone_search_riders(p_business_profile_id UUID, p_zone_id UUID, p_query TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_q     TEXT := btrim(COALESCE(p_query, ''));
  v_code  TEXT := public.mbg_zone_card_code(p_query);
  v_plate TEXT := public.mbg_zone_norm_plate(p_query);
  v_rows  JSONB;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Please sign in'); END IF;
  IF NOT public.mbg_zone_staff_can(p_business_profile_id, 'assign') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your role cannot manage the approved list');
  END IF;
  IF length(v_q) < 3 THEN RETURN jsonb_build_object('success', true, 'riders', '[]'::JSONB); END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x ->> 'plate_number'), '[]'::JSONB) INTO v_rows FROM (
    SELECT jsonb_build_object(
             'rider_id', r.id, 'card_number', c.card_number, 'card_status', c.status,
             'full_name', p ->> 'full_name', 'plate_number', r.plate_number, 'vehicle_type', r.vehicle_type::TEXT,
             'vehicle_model', r.vehicle_model, 'stage', p ->> 'stage',
             'already_member', EXISTS (SELECT 1 FROM public.mbg_access_zone_members m
                                        WHERE m.zone_id = p_zone_id AND m.rider_id = r.id AND m.status <> 'revoked')) AS x
      FROM public.mbg_rider_cards c
      JOIN public.mbg_riders r ON r.id = c.rider_id
      CROSS JOIN LATERAL (SELECT public.mbg_rider_card_payload(c.id) AS p) pl
     WHERE c.status IN ('active', 'pending_payment')
       AND (c.verify_code = v_code
            OR upper(c.card_number) = upper(v_q)
            OR (length(v_plate) >= 3 AND public.mbg_zone_norm_plate(r.plate_number) LIKE '%' || v_plate || '%'))
     LIMIT 15) s;
  RETURN jsonb_build_object('success', true, 'riders', v_rows);
END;
$$;

-- Approve a vehicle for the zone (or change/reactivate it). The rider must hold an ID card: that is what the gate scans.
-- Needs 'assign'.
CREATE OR REPLACE FUNCTION public.mbg_zone_member_add(
  p_zone_id UUID, p_rider_id UUID, p_kind TEXT, p_valid_until TIMESTAMPTZ,
  p_daily_start TIME, p_daily_end TIME, p_note TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_zone public.mbg_access_zones;
  v_user UUID;
  v_id   UUID;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Please sign in'); END IF;
  SELECT * INTO v_zone FROM public.mbg_access_zones WHERE id = p_zone_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Zone not found'); END IF;
  IF NOT public.mbg_zone_staff_can(v_zone.business_profile_id, 'assign') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your role cannot manage the approved list');
  END IF;
  IF (p_daily_start IS NULL) <> (p_daily_end IS NULL) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Set both the start and the end of the allowed hours, or neither');
  END IF;
  IF p_valid_until IS NOT NULL AND p_valid_until <= now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'The access end date is already past');
  END IF;

  SELECT r.user_id INTO v_user FROM public.mbg_riders r WHERE r.id = p_rider_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Rider not found'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mbg_rider_cards c WHERE c.rider_id = p_rider_id AND c.status IN ('active', 'pending_payment')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'This rider has no ID card yet. Ask the rider to request one in BodaGoEra first.');
  END IF;

  INSERT INTO public.mbg_access_zone_members
    (zone_id, rider_id, rider_user_id, member_kind, status, valid_from, valid_until, daily_start_time, daily_end_time, note, added_by)
  VALUES
    (p_zone_id, p_rider_id, v_user, COALESCE(p_kind, 'staff'), 'active', now(), p_valid_until, p_daily_start, p_daily_end,
     NULLIF(btrim(p_note), ''), auth.uid())
  ON CONFLICT (zone_id, rider_id) DO UPDATE SET
    member_kind = EXCLUDED.member_kind, status = 'active',
    valid_from = CASE WHEN public.mbg_access_zone_members.status = 'active' THEN public.mbg_access_zone_members.valid_from ELSE now() END,
    valid_until = EXCLUDED.valid_until, daily_start_time = EXCLUDED.daily_start_time, daily_end_time = EXCLUDED.daily_end_time,
    note = EXCLUDED.note, updated_at = now()
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'member_id', v_id);
EXCEPTION WHEN check_violation THEN
  RETURN jsonb_build_object('success', false, 'error', 'One of the values is out of range');
END;
$$;

-- Suspend, restore or remove a vehicle on the list. A vehicle already inside can still leave. Needs 'assign'.
CREATE OR REPLACE FUNCTION public.mbg_zone_member_set_status(p_member_id UUID, p_status TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_biz UUID;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Please sign in'); END IF;
  IF p_status NOT IN ('active', 'suspended', 'revoked') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unknown status');
  END IF;
  SELECT z.business_profile_id INTO v_biz
    FROM public.mbg_access_zone_members m JOIN public.mbg_access_zones z ON z.id = m.zone_id
   WHERE m.id = p_member_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Not on the list'); END IF;
  IF NOT public.mbg_zone_staff_can(v_biz, 'assign') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your role cannot manage the approved list');
  END IF;
  UPDATE public.mbg_access_zone_members SET status = p_status, updated_at = now() WHERE id = p_member_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- The approved list of a zone, each with the live state of the rider's card. Needs 'assign' or 'view'.
CREATE OR REPLACE FUNCTION public.mbg_zone_members(p_zone_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_zone public.mbg_access_zones;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Please sign in'); END IF;
  SELECT * INTO v_zone FROM public.mbg_access_zones WHERE id = p_zone_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Zone not found'); END IF;
  IF NOT (public.mbg_zone_staff_can(v_zone.business_profile_id, 'assign') OR public.mbg_zone_staff_can(v_zone.business_profile_id, 'view')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your role cannot see the approved list');
  END IF;

  RETURN jsonb_build_object('success', true, 'members', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', m.id, 'rider_id', m.rider_id, 'member_kind', m.member_kind, 'status', m.status,
      'state', public.mbg_zone_member_state(m, v_zone.timezone),
      'valid_from', m.valid_from, 'valid_until', m.valid_until,
      'daily_start_time', m.daily_start_time, 'daily_end_time', m.daily_end_time, 'note', m.note,
      'full_name', pl.p ->> 'full_name', 'plate_number', r.plate_number, 'vehicle_type', r.vehicle_type::TEXT,
      'vehicle_model', r.vehicle_model, 'card_number', pl.p ->> 'card_number', 'stage', pl.p ->> 'stage',
      'card_state', CASE WHEN pl.p ->> 'status' = 'revoked' THEN 'cancelled'
                         WHEN pl.p ->> 'status' = 'pending_payment' THEN 'unpaid'
                         WHEN COALESCE((pl.p ->> 'card_expired')::BOOLEAN, false) THEN 'expired'
                         WHEN pl.p ->> 'rider_status' <> 'active' THEN 'suspended'
                         WHEN pl.p IS NULL THEN 'no_card' ELSE 'valid' END,
      'inside', EXISTS (SELECT 1 FROM public.mbg_access_visits v WHERE v.zone_id = m.zone_id AND v.rider_id = m.rider_id AND v.status = 'inside'))
      ORDER BY m.status, r.plate_number)
    FROM public.mbg_access_zone_members m
    JOIN public.mbg_riders r ON r.id = m.rider_id
    LEFT JOIN LATERAL (
      SELECT public.mbg_rider_card_payload(c.id) AS p
        FROM public.mbg_rider_cards c WHERE c.rider_id = m.rider_id AND c.status IN ('active', 'pending_payment')
       ORDER BY c.issued_at DESC LIMIT 1) pl ON true
    WHERE m.zone_id = p_zone_id), '[]'::JSONB));
END;
$$;


-- ─── 6. The gate desk ────────────────────────────────────────────────────────

-- Read a scanned card. Returns the card's id/rider and its live state, the way the public QR page decides it:
-- cancelled / unpaid / expired / suspended / valid. Unknown code: {found:false}.
CREATE OR REPLACE FUNCTION public.mbg_zone_read_card(p_scan TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code TEXT := public.mbg_zone_card_code(p_scan);
  v_card public.mbg_rider_cards;
  v_p    JSONB;
BEGIN
  IF v_code IS NULL THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT * INTO v_card FROM public.mbg_rider_cards WHERE verify_code = v_code;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;
  v_p := public.mbg_rider_card_payload(v_card.id);
  RETURN jsonb_build_object(
    'found', true, 'card_id', v_card.id, 'rider_id', v_card.rider_id, 'rider_user_id', v_card.rider_user_id,
    'card_number', v_card.card_number, 'payload', v_p,
    'state', CASE
      WHEN v_p ->> 'status' = 'revoked'                                   THEN 'cancelled'
      WHEN v_p ->> 'status' = 'pending_payment'                           THEN 'unpaid'
      WHEN COALESCE((v_p ->> 'card_expired')::BOOLEAN, false)             THEN 'expired'
      WHEN v_p ->> 'rider_status' <> 'active'                             THEN 'suspended'
      ELSE 'valid' END);
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_zone_read_card(TEXT) FROM PUBLIC, anon, authenticated;

-- Warnings that do not stop a vehicle but that the gate should see, plus a plate mismatch if the gate typed what it saw.
CREATE OR REPLACE FUNCTION public.mbg_zone_warnings(p_payload JSONB, p_plate_seen TEXT) RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_w JSONB := '[]'::JSONB;
BEGIN
  IF p_payload ->> 'permit_status' = 'expired' THEN v_w := v_w || to_jsonb('The driving permit has expired.'::TEXT); END IF;
  IF p_payload ->> 'permit_status' = 'expiring_soon' THEN v_w := v_w || to_jsonb('The driving permit expires soon.'::TEXT); END IF;
  IF COALESCE((p_payload ->> 'commission_owed_ugx')::NUMERIC, 0) > 0 THEN
    v_w := v_w || to_jsonb('Ride commission is still owed to the chairpersons.'::TEXT);
  END IF;
  IF p_payload #>> '{insurance,state}' = 'expired' THEN v_w := v_w || to_jsonb('The insurance cover has expired.'::TEXT); END IF;
  IF p_payload #>> '{insurance,state}' = 'grace' THEN v_w := v_w || to_jsonb('The insurance cover has ended and is in its grace days.'::TEXT); END IF;
  IF NULLIF(public.mbg_zone_norm_plate(p_plate_seen), '') IS NOT NULL
     AND public.mbg_zone_norm_plate(p_plate_seen) <> public.mbg_zone_norm_plate(p_payload ->> 'plate_number') THEN
    v_w := v_w || to_jsonb(('The plate you entered (' || public.mbg_zone_norm_plate(p_plate_seen) || ') does not match the card ('
                            || COALESCE(p_payload ->> 'plate_number', '?') || ').')::TEXT);
  END IF;
  RETURN v_w;
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_zone_warnings(JSONB, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mbg_zone_deny_message(p_reason TEXT, p_type TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_reason
    WHEN 'unknown_card'       THEN 'This is not a BodaGoEra rider card. It may be forged or mistyped.'
    WHEN 'card_cancelled'     THEN 'This card was cancelled. Do not accept it.'
    WHEN 'card_unpaid'        THEN 'This card has not been activated, so it is not valid.'
    WHEN 'card_expired'       THEN 'This card has expired. The rider must renew it.'
    WHEN 'rider_suspended'    THEN 'The card is genuine but the rider is suspended or inactive.'
    WHEN 'zone_closed'        THEN 'This zone is not accepting vehicles right now.'
    WHEN 'permit_expired'     THEN 'The rider''s driving permit has expired, and this zone requires a valid permit.'
    WHEN 'not_on_list'        THEN 'This vehicle is not on the zone''s approved list.'
    WHEN 'member_revoked'     THEN 'This vehicle was removed from the approved list.'
    WHEN 'member_suspended'   THEN 'This vehicle''s access is suspended.'
    WHEN 'member_not_started' THEN 'This vehicle''s access has not started yet.'
    WHEN 'member_expired'     THEN 'This vehicle''s access has ended.'
    WHEN 'outside_hours'      THEN 'This vehicle is approved, but not at this hour.'
    WHEN 'vehicle_not_allowed' THEN 'This zone does not accept ' || COALESCE(p_type, 'this type of vehicle') || '.'
    ELSE 'Entry refused.' END
$$;
REVOKE ALL ON FUNCTION public.mbg_zone_deny_message(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- Scan IN. Needs 'gate'. Verdicts:  granted | pay_required | already_inside | denied
CREATE OR REPLACE FUNCTION public.mbg_zone_gate_check_in(p_zone_id UUID, p_code TEXT, p_gate TEXT DEFAULT NULL, p_plate_seen TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_zone    public.mbg_access_zones;
  v_card    JSONB;
  v_p       JSONB;
  v_member  public.mbg_access_zone_members;
  v_mstate  TEXT;
  v_open    public.mbg_access_visits;
  v_visit   public.mbg_access_visits;
  v_fee     NUMERIC;
  v_type    TEXT;
  v_reason  TEXT;
  v_warn    JSONB;
  v_rate    NUMERIC;
  v_gate    TEXT := NULLIF(btrim(COALESCE(p_gate, '')), '');
  v_rider   JSONB;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Please sign in'); END IF;
  SELECT * INTO v_zone FROM public.mbg_access_zones WHERE id = p_zone_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Zone not found'); END IF;
  IF NOT public.mbg_zone_staff_can(v_zone.business_profile_id, 'gate') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your role cannot run the gate for this zone');
  END IF;
  PERFORM public.mbg_zone_expire_stale();

  v_card := public.mbg_zone_read_card(p_code);
  IF NOT COALESCE((v_card ->> 'found')::BOOLEAN, false) THEN
    RETURN jsonb_build_object('success', true, 'verdict', 'denied', 'reason', 'unknown_card',
                              'message', public.mbg_zone_deny_message('unknown_card', NULL));
  END IF;
  v_p := v_card -> 'payload';
  v_type := v_p ->> 'vehicle_type';

  -- The card must be a good card first. Nothing about the rider is shown when it is not (same rule as the public QR page).
  v_reason := CASE v_card ->> 'state'
    WHEN 'cancelled' THEN 'card_cancelled' WHEN 'unpaid' THEN 'card_unpaid'
    WHEN 'expired' THEN 'card_expired' WHEN 'suspended' THEN 'rider_suspended' ELSE NULL END;
  IF v_reason IS NOT NULL THEN
    INSERT INTO public.mbg_access_visits (zone_id, business_profile_id, card_id, card_number, status, reason, gate_in, checked_in_by, plate_seen)
    VALUES (v_zone.id, v_zone.business_profile_id, (v_card ->> 'card_id')::UUID, v_card ->> 'card_number', 'denied',
            public.mbg_zone_deny_message(v_reason, NULL), v_gate, auth.uid(), NULLIF(btrim(p_plate_seen), ''));
    RETURN jsonb_build_object('success', true, 'verdict', 'denied', 'reason', v_reason, 'card_state', v_card ->> 'state',
                              'card_number', v_card ->> 'card_number', 'message', public.mbg_zone_deny_message(v_reason, NULL));
  END IF;

  v_rider := public.mbg_zone_rider_view(v_p);
  v_warn  := public.mbg_zone_warnings(v_p, p_plate_seen);

  -- Rules of the zone that refuse even a good card. A refused scan is logged too.
  IF v_zone.status <> 'active' THEN v_reason := 'zone_closed'; END IF;
  IF v_reason IS NULL AND v_zone.require_valid_permit AND v_p ->> 'permit_status' = 'expired' THEN v_reason := 'permit_expired'; END IF;

  -- Is this vehicle already in?
  SELECT * INTO v_open FROM public.mbg_access_visits
   WHERE zone_id = v_zone.id AND rider_id = (v_card ->> 'rider_id')::UUID AND status IN ('awaiting_payment', 'inside');
  IF FOUND AND v_reason IS NULL THEN
    IF v_open.status = 'inside' THEN
      RETURN jsonb_build_object('success', true, 'verdict', 'already_inside', 'visit', public.mbg_zone_visit_json(v_open), 'rider', v_rider,
        'message', 'Already checked in at ' || to_char(v_open.entered_at AT TIME ZONE v_zone.timezone, 'HH24:MI') || '. If the vehicle is leaving, use Check out.',
        'warnings', v_warn);
    END IF;
    RETURN jsonb_build_object('success', true, 'verdict', 'pay_required', 'visit', public.mbg_zone_visit_json(v_open), 'rider', v_rider,
      'can_collect_cash', v_zone.accept_cash, 'warnings', v_warn,
      'message', 'Waiting for the rider to approve the entry fee in BodaGoEra.');
  END IF;

  SELECT * INTO v_member FROM public.mbg_access_zone_members WHERE zone_id = v_zone.id AND rider_id = (v_card ->> 'rider_id')::UUID;
  v_mstate := public.mbg_zone_member_state(v_member, v_zone.timezone);

  -- 1. approved vehicle: in, free
  IF v_reason IS NULL AND v_mstate = 'ok' THEN
    BEGIN
      INSERT INTO public.mbg_access_visits
        (zone_id, business_profile_id, rider_id, rider_user_id, card_id, card_number, rider_name, plate_number, vehicle_type,
         access_basis, status, gate_in, checked_in_by, plate_seen, warnings, entered_at)
      VALUES
        (v_zone.id, v_zone.business_profile_id, (v_card ->> 'rider_id')::UUID, (v_card ->> 'rider_user_id')::UUID,
         (v_card ->> 'card_id')::UUID, v_card ->> 'card_number', v_p ->> 'full_name', v_p ->> 'plate_number', v_type,
         'member', 'inside', v_gate, auth.uid(), NULLIF(btrim(p_plate_seen), ''), v_warn, now())
      RETURNING * INTO v_visit;
    EXCEPTION WHEN unique_violation THEN
      SELECT * INTO v_visit FROM public.mbg_access_visits
       WHERE zone_id = v_zone.id AND rider_id = (v_card ->> 'rider_id')::UUID AND status IN ('awaiting_payment', 'inside');
      RETURN jsonb_build_object('success', true, 'verdict', 'already_inside', 'visit', public.mbg_zone_visit_json(v_visit), 'rider', v_rider,
        'message', 'Already checked in.', 'warnings', v_warn);
    END;
    RETURN jsonb_build_object('success', true, 'verdict', 'granted', 'basis', 'member', 'visit', public.mbg_zone_visit_json(v_visit),
      'rider', v_rider, 'member', jsonb_build_object('kind', v_member.member_kind, 'valid_until', v_member.valid_until, 'note', v_member.note),
      'warnings', v_warn, 'message', 'Access granted - approved ' || v_member.member_kind || '.');
  END IF;

  -- 2. not (or no longer) on the list: may the vehicle buy its way in?
  IF v_reason IS NULL AND v_zone.entry_mode = 'paid_entry' THEN
    SELECT f.fee_ugx INTO v_fee FROM public.mbg_access_zone_fees f WHERE f.zone_id = v_zone.id AND f.vehicle_type = v_type;
    IF NOT FOUND THEN
      v_reason := 'vehicle_not_allowed';
    ELSIF v_fee <= 0 THEN
      INSERT INTO public.mbg_access_visits
        (zone_id, business_profile_id, rider_id, rider_user_id, card_id, card_number, rider_name, plate_number, vehicle_type,
         access_basis, status, gate_in, checked_in_by, plate_seen, warnings, entered_at)
      VALUES
        (v_zone.id, v_zone.business_profile_id, (v_card ->> 'rider_id')::UUID, (v_card ->> 'rider_user_id')::UUID,
         (v_card ->> 'card_id')::UUID, v_card ->> 'card_number', v_p ->> 'full_name', v_p ->> 'plate_number', v_type,
         'open', 'inside', v_gate, auth.uid(), NULLIF(btrim(p_plate_seen), ''), v_warn, now())
      ON CONFLICT DO NOTHING
      RETURNING * INTO v_visit;
      IF v_visit.id IS NULL THEN
        SELECT * INTO v_visit FROM public.mbg_access_visits
         WHERE zone_id = v_zone.id AND rider_id = (v_card ->> 'rider_id')::UUID AND status IN ('awaiting_payment', 'inside');
      END IF;
      RETURN jsonb_build_object('success', true, 'verdict', 'granted', 'basis', 'open', 'visit', public.mbg_zone_visit_json(v_visit),
        'rider', v_rider, 'warnings', v_warn, 'message', 'Access granted - no fee for this vehicle type.');
    ELSE
      -- a day pass already paid in the last 24 hours covers this entry too
      IF v_zone.fee_basis = 'day_pass' AND EXISTS (
           SELECT 1 FROM public.mbg_access_visits pv
            WHERE pv.zone_id = v_zone.id AND pv.rider_id = (v_card ->> 'rider_id')::UUID
              AND pv.entry_fee_ugx > 0 AND pv.fee_paid_ugx >= pv.entry_fee_ugx AND pv.entered_at > now() - INTERVAL '24 hours') THEN
        INSERT INTO public.mbg_access_visits
          (zone_id, business_profile_id, rider_id, rider_user_id, card_id, card_number, rider_name, plate_number, vehicle_type,
           access_basis, status, gate_in, checked_in_by, plate_seen, warnings, entered_at)
        VALUES
          (v_zone.id, v_zone.business_profile_id, (v_card ->> 'rider_id')::UUID, (v_card ->> 'rider_user_id')::UUID,
           (v_card ->> 'card_id')::UUID, v_card ->> 'card_number', v_p ->> 'full_name', v_p ->> 'plate_number', v_type,
           'day_pass', 'inside', v_gate, auth.uid(), NULLIF(btrim(p_plate_seen), ''), v_warn, now())
        ON CONFLICT DO NOTHING
        RETURNING * INTO v_visit;
        IF v_visit.id IS NULL THEN
          SELECT * INTO v_visit FROM public.mbg_access_visits
           WHERE zone_id = v_zone.id AND rider_id = (v_card ->> 'rider_id')::UUID AND status IN ('awaiting_payment', 'inside');
        END IF;
        RETURN jsonb_build_object('success', true, 'verdict', 'granted', 'basis', 'day_pass', 'visit', public.mbg_zone_visit_json(v_visit),
          'rider', v_rider, 'warnings', v_warn, 'message', 'Access granted - today''s pass is already paid.');
      END IF;

      -- ask the rider for the fee
      v_rate := public.ican_fee_rate('zone_access_fee');
      BEGIN
        INSERT INTO public.mbg_access_visits
          (zone_id, business_profile_id, rider_id, rider_user_id, card_id, card_number, rider_name, plate_number, vehicle_type,
           access_basis, status, reason, entry_fee_ugx, fee_due_ugx, platform_fee_rate, gate_in, checked_in_by, plate_seen, warnings, pay_by)
        VALUES
          (v_zone.id, v_zone.business_profile_id, (v_card ->> 'rider_id')::UUID, (v_card ->> 'rider_user_id')::UUID,
           (v_card ->> 'card_id')::UUID, v_card ->> 'card_number', v_p ->> 'full_name', v_p ->> 'plate_number', v_type,
           'paid', 'awaiting_payment', CASE WHEN v_mstate = 'not_on_list' THEN NULL ELSE public.mbg_zone_deny_message(v_mstate, v_type) END,
           v_fee, v_fee, v_rate, v_gate, auth.uid(), NULLIF(btrim(p_plate_seen), ''), v_warn,
           now() + make_interval(mins => v_zone.payment_window_minutes))
        RETURNING * INTO v_visit;
      EXCEPTION WHEN unique_violation THEN
        SELECT * INTO v_visit FROM public.mbg_access_visits
         WHERE zone_id = v_zone.id AND rider_id = (v_card ->> 'rider_id')::UUID AND status IN ('awaiting_payment', 'inside');
        RETURN jsonb_build_object('success', true, 'verdict', 'pay_required', 'visit', public.mbg_zone_visit_json(v_visit), 'rider', v_rider,
          'can_collect_cash', v_zone.accept_cash, 'warnings', v_warn, 'message', 'Waiting for the rider to approve the entry fee in BodaGoEra.');
      END;
      PERFORM public.mbg_zone_notify_rider(
        (v_card ->> 'rider_user_id')::UUID, v_zone.name || ' entry fee',
        'Approve UGX ' || to_char(v_fee, 'FM999,999,999') || ' to enter ' || v_zone.name || '. Open BodaGoEra > Gate passes.', v_visit.id);
      RETURN jsonb_build_object('success', true, 'verdict', 'pay_required', 'visit', public.mbg_zone_visit_json(v_visit), 'rider', v_rider,
        'can_collect_cash', v_zone.accept_cash, 'warnings', v_warn,
        'fee_ugx', v_fee, 'fee_ican', ROUND(v_fee / public.mbg_zone_ugx_per_ican(), 8),
        'message', 'Not on the approved list. Entry fee UGX ' || to_char(v_fee, 'FM999,999,999') || ' - waiting for the rider to approve it.');
    END IF;
  END IF;

  -- 3. refused
  v_reason := COALESCE(v_reason, CASE WHEN v_mstate = 'ok' THEN 'not_on_list' ELSE v_mstate END);
  INSERT INTO public.mbg_access_visits
    (zone_id, business_profile_id, rider_id, rider_user_id, card_id, card_number, rider_name, plate_number, vehicle_type,
     status, reason, gate_in, checked_in_by, plate_seen, warnings)
  VALUES
    (v_zone.id, v_zone.business_profile_id, (v_card ->> 'rider_id')::UUID, (v_card ->> 'rider_user_id')::UUID,
     (v_card ->> 'card_id')::UUID, v_card ->> 'card_number', v_p ->> 'full_name', v_p ->> 'plate_number', v_type,
     'denied', public.mbg_zone_deny_message(v_reason, v_type), v_gate, auth.uid(), NULLIF(btrim(p_plate_seen), ''), v_warn)
  RETURNING * INTO v_visit;
  RETURN jsonb_build_object('success', true, 'verdict', 'denied', 'reason', v_reason, 'visit', public.mbg_zone_visit_json(v_visit),
    'rider', v_rider, 'warnings', v_warn, 'message', public.mbg_zone_deny_message(v_reason, v_type));
END;
$$;

-- Scan OUT. Needs 'gate'. The vehicle must have been checked in, and must owe nothing.
-- Verdicts:  cleared | balance_due | not_checked_in | denied (unknown / cancelled card)
CREATE OR REPLACE FUNCTION public.mbg_zone_gate_check_out(p_zone_id UUID, p_code TEXT, p_gate TEXT DEFAULT NULL, p_plate_seen TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_zone    public.mbg_access_zones;
  v_card    JSONB;
  v_p       JSONB;
  v_visit   public.mbg_access_visits;
  v_balance NUMERIC;
  v_stay    INTEGER;
  v_warn    JSONB;
  v_gate    TEXT := NULLIF(btrim(COALESCE(p_gate, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Please sign in'); END IF;
  SELECT * INTO v_zone FROM public.mbg_access_zones WHERE id = p_zone_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Zone not found'); END IF;
  IF NOT public.mbg_zone_staff_can(v_zone.business_profile_id, 'gate') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your role cannot run the gate for this zone');
  END IF;
  PERFORM public.mbg_zone_expire_stale();

  v_card := public.mbg_zone_read_card(p_code);
  IF NOT COALESCE((v_card ->> 'found')::BOOLEAN, false) THEN
    RETURN jsonb_build_object('success', true, 'verdict', 'denied', 'reason', 'unknown_card',
                              'message', public.mbg_zone_deny_message('unknown_card', NULL));
  END IF;
  v_p := v_card -> 'payload';
  v_warn := public.mbg_zone_warnings(v_p, p_plate_seen);

  -- Leaving needs no valid card (an expired card must not trap a vehicle that is already inside), only a visit.
  SELECT * INTO v_visit FROM public.mbg_access_visits
   WHERE zone_id = v_zone.id AND rider_id = (v_card ->> 'rider_id')::UUID AND status IN ('awaiting_payment', 'inside')
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'verdict', 'not_checked_in', 'rider', public.mbg_zone_rider_view(v_p), 'warnings', v_warn,
      'message', 'No entry record for this vehicle. It did not check in - hold it and call the gate supervisor. To let it in, use Check in.');
  END IF;
  IF v_visit.status = 'awaiting_payment' THEN
    RETURN jsonb_build_object('success', true, 'verdict', 'not_checked_in', 'rider', public.mbg_zone_rider_view(v_p), 'warnings', v_warn,
      'visit', public.mbg_zone_visit_json(v_visit), 'can_collect_cash', v_zone.accept_cash,
      'message', 'This vehicle never got in - its entry fee is still unpaid.');
  END IF;

  v_visit := public.mbg_zone_refresh_balance(v_visit.id);
  v_balance := GREATEST(v_visit.fee_due_ugx - v_visit.fee_paid_ugx, 0);
  v_stay := floor(extract(epoch FROM (now() - v_visit.entered_at)) / 60)::INTEGER;

  IF v_balance > 0 THEN
    IF v_visit.overstay_ugx > 0 THEN
      PERFORM public.mbg_zone_notify_rider(v_visit.rider_user_id, v_zone.name || ' exit fee',
        'UGX ' || to_char(v_balance, 'FM999,999,999') || ' is due before you can leave ' || v_zone.name || '. Open BodaGoEra > Gate passes.', v_visit.id);
    END IF;
    RETURN jsonb_build_object('success', true, 'verdict', 'balance_due', 'visit', public.mbg_zone_visit_json(v_visit),
      'rider', public.mbg_zone_rider_view(v_p), 'warnings', v_warn, 'stay_minutes', v_stay,
      'balance_ugx', v_balance, 'balance_ican', ROUND(v_balance / public.mbg_zone_ugx_per_ican(), 8),
      'can_collect_cash', v_zone.accept_cash,
      'message', 'Not cleared: UGX ' || to_char(v_balance, 'FM999,999,999') || ' is still due'
                 || CASE WHEN v_visit.overstay_ugx > 0 THEN ' (includes overstay).' ELSE '.' END);
  END IF;

  UPDATE public.mbg_access_visits
     SET status = 'exited', exited_at = now(), gate_out = v_gate, checked_out_by = auth.uid()
   WHERE id = v_visit.id
   RETURNING * INTO v_visit;
  RETURN jsonb_build_object('success', true, 'verdict', 'cleared', 'visit', public.mbg_zone_visit_json(v_visit),
    'rider', public.mbg_zone_rider_view(v_p), 'warnings', v_warn, 'stay_minutes', v_stay,
    'message', 'Cleared to leave. Everything is paid.');
END;
$$;

-- One scan, no buttons: p_direction 'in' | 'out' | 'auto'. Auto checks a vehicle that is inside OUT and any other IN, which is
-- all a single-gate zone needs ("just scan the card"). Separate entry and exit lanes should use 'in' / 'out' so a vehicle that
-- left without being scanned out cannot be mistaken for one leaving. The result says which way it went ('direction').
CREATE OR REPLACE FUNCTION public.mbg_zone_gate_scan(
  p_zone_id UUID, p_code TEXT, p_direction TEXT DEFAULT 'auto', p_gate TEXT DEFAULT NULL, p_plate_seen TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dir    TEXT := COALESCE(p_direction, 'auto');
  v_card   JSONB;
  v_result JSONB;
BEGIN
  IF v_dir NOT IN ('in', 'out', 'auto') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Direction must be in, out or auto');
  END IF;
  IF v_dir = 'auto' THEN
    v_card := public.mbg_zone_read_card(p_code);
    v_dir := CASE WHEN COALESCE((v_card ->> 'found')::BOOLEAN, false) AND EXISTS (
                        SELECT 1 FROM public.mbg_access_visits v
                         WHERE v.zone_id = p_zone_id AND v.rider_id = (v_card ->> 'rider_id')::UUID AND v.status = 'inside')
                  THEN 'out' ELSE 'in' END;
  END IF;
  v_result := CASE v_dir
    WHEN 'out' THEN public.mbg_zone_gate_check_out(p_zone_id, p_code, p_gate, p_plate_seen)
    ELSE public.mbg_zone_gate_check_in(p_zone_id, p_code, p_gate, p_plate_seen) END;
  RETURN v_result || jsonb_build_object('direction', v_dir);
END;
$$;

-- The gate collected the money in cash. Needs 'gate' and a zone that accepts cash. IcanEra's cut is taken from the business wallet.
CREATE OR REPLACE FUNCTION public.mbg_zone_gate_collect_cash(p_visit_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v         public.mbg_access_visits;
  z         public.mbg_access_zones;
  v_amount  NUMERIC;
  v_fee     NUMERIC;
  v_settled BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Please sign in'); END IF;
  PERFORM public.mbg_zone_expire_stale();
  SELECT * INTO v FROM public.mbg_access_visits WHERE id = p_visit_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Visit not found'); END IF;
  SELECT * INTO z FROM public.mbg_access_zones WHERE id = v.zone_id;
  IF NOT public.mbg_zone_staff_can(z.business_profile_id, 'gate') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your role cannot run the gate for this zone');
  END IF;
  IF NOT z.accept_cash THEN
    RETURN jsonb_build_object('success', false, 'error', 'This zone does not take cash. The rider pays from the BodaGoEra app.');
  END IF;
  IF v.status = 'inside' THEN v := public.mbg_zone_refresh_balance(v.id); END IF;
  IF v.status NOT IN ('awaiting_payment', 'inside') THEN
    RETURN jsonb_build_object('success', false, 'error', 'This visit is no longer open');
  END IF;
  v_amount := v.fee_due_ugx - v.fee_paid_ugx;
  IF v_amount <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'Nothing is due on this visit'); END IF;

  v_fee := ROUND(v_amount * COALESCE(v.platform_fee_rate, public.ican_fee_rate('zone_access_fee')), 2);
  UPDATE public.mbg_access_visits
     SET fee_paid_ugx = fee_due_ugx, payment_method = 'cash',
         platform_fee_rate = COALESCE(platform_fee_rate, public.ican_fee_rate('zone_access_fee')),
         platform_fee_ugx = platform_fee_ugx + v_fee,
         status = 'inside', entered_at = COALESCE(entered_at, now()),
         balance_paid_at = CASE WHEN v.status = 'inside' THEN now() ELSE balance_paid_at END
   WHERE id = v.id;
  v_settled := public.mbg_zone_settle_platform_fee(v.id);
  SELECT * INTO v FROM public.mbg_access_visits WHERE id = v.id;
  RETURN jsonb_build_object('success', true, 'visit', public.mbg_zone_visit_json(v), 'platform_fee_settled', v_settled);
END;
$$;

-- Withdraw an entry request that is still waiting for payment. Needs 'gate'.
CREATE OR REPLACE FUNCTION public.mbg_zone_gate_cancel(p_visit_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v public.mbg_access_visits;
  z public.mbg_access_zones;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Please sign in'); END IF;
  SELECT * INTO v FROM public.mbg_access_visits WHERE id = p_visit_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Visit not found'); END IF;
  SELECT * INTO z FROM public.mbg_access_zones WHERE id = v.zone_id;
  IF NOT public.mbg_zone_staff_can(z.business_profile_id, 'gate') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your role cannot run the gate for this zone');
  END IF;
  IF v.status <> 'awaiting_payment' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only a request that is waiting for payment can be withdrawn');
  END IF;
  UPDATE public.mbg_access_visits SET status = 'cancelled', reason = 'Withdrawn by the gate' WHERE id = v.id;
  RETURN jsonb_build_object('success', true);
END;
$$;


-- ─── 7. Staff: who is inside, the log, the numbers ───────────────────────────

-- scope: inside | awaiting | log (everything, newest first). Needs 'view', 'gate' or 'assign'.
CREATE OR REPLACE FUNCTION public.mbg_zone_visits(p_zone_id UUID, p_scope TEXT DEFAULT 'inside', p_limit INTEGER DEFAULT 100)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  z public.mbg_access_zones;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Please sign in'); END IF;
  SELECT * INTO z FROM public.mbg_access_zones WHERE id = p_zone_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Zone not found'); END IF;
  IF NOT public.mbg_zone_staff_can(z.business_profile_id, 'any') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your role has no access to restricted zones');
  END IF;
  PERFORM public.mbg_zone_expire_stale();

  RETURN jsonb_build_object('success', true, 'visits', COALESCE((
    SELECT jsonb_agg(public.mbg_zone_visit_json(v) || jsonb_build_object(
             'minutes_inside', CASE WHEN v.status = 'inside' THEN floor(extract(epoch FROM (now() - v.entered_at)) / 60) END,
             'overstaying', v.status = 'inside' AND z.max_stay_minutes IS NOT NULL
                            AND now() - v.entered_at > make_interval(mins => z.max_stay_minutes))
             ORDER BY COALESCE(v.exited_at, v.entered_at, v.requested_at, v.created_at) DESC)
      FROM (SELECT * FROM public.mbg_access_visits
             WHERE zone_id = p_zone_id
               AND CASE p_scope WHEN 'inside' THEN status = 'inside'
                                WHEN 'awaiting' THEN status = 'awaiting_payment'
                                ELSE true END
             ORDER BY COALESCE(exited_at, entered_at, requested_at, created_at) DESC
             LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)) v), '[]'::JSONB));
END;
$$;

-- One visit's current state: the gate desk polls this while the rider decides. Needs 'gate', 'view' or 'assign'.
CREATE OR REPLACE FUNCTION public.mbg_zone_visit_status(p_visit_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v public.mbg_access_visits;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Please sign in'); END IF;
  PERFORM public.mbg_zone_expire_stale();
  SELECT * INTO v FROM public.mbg_access_visits WHERE id = p_visit_id;
  IF NOT FOUND OR NOT public.mbg_zone_staff_can(v.business_profile_id, 'any') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Visit not found');
  END IF;
  IF v.status = 'inside' THEN v := public.mbg_zone_refresh_balance(v.id); END IF;
  RETURN jsonb_build_object('success', true, 'visit', public.mbg_zone_visit_json(v));
END;
$$;

-- Totals for the last p_days days. Needs any Transport action.
CREATE OR REPLACE FUNCTION public.mbg_zone_report(p_zone_id UUID, p_days INTEGER DEFAULT 30) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  z public.mbg_access_zones;
  r RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Please sign in'); END IF;
  SELECT * INTO z FROM public.mbg_access_zones WHERE id = p_zone_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Zone not found'); END IF;
  IF NOT public.mbg_zone_staff_can(z.business_profile_id, 'any') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your role has no access to restricted zones');
  END IF;

  SELECT count(*) FILTER (WHERE entered_at IS NOT NULL)                                   AS entries,
         count(*) FILTER (WHERE access_basis = 'member' AND entered_at IS NOT NULL)       AS member_entries,
         count(*) FILTER (WHERE access_basis IN ('paid', 'day_pass') AND entered_at IS NOT NULL) AS paid_entries,
         count(*) FILTER (WHERE status = 'denied')                                        AS refused,
         COALESCE(sum(fee_paid_ugx), 0)                                                   AS collected_ugx,
         COALESCE(sum(fee_paid_ugx) FILTER (WHERE payment_method = 'wallet'), 0)          AS wallet_ugx,
         COALESCE(sum(fee_paid_ugx) FILTER (WHERE payment_method = 'cash'), 0)            AS cash_ugx,
         COALESCE(sum(platform_fee_ugx), 0)                                               AS platform_fee_ugx,
         COALESCE(sum(platform_fee_ugx - platform_fee_settled_ugx), 0)                    AS platform_fee_owed_ugx
    INTO r
    FROM public.mbg_access_visits
   WHERE zone_id = p_zone_id AND created_at >= now() - make_interval(days => LEAST(GREATEST(COALESCE(p_days, 30), 1), 366));

  RETURN jsonb_build_object('success', true, 'days', p_days,
    'entries', r.entries, 'member_entries', r.member_entries, 'paid_entries', r.paid_entries, 'refused', r.refused,
    'collected_ugx', r.collected_ugx, 'wallet_ugx', r.wallet_ugx, 'cash_ugx', r.cash_ugx,
    'platform_fee_ugx', r.platform_fee_ugx, 'platform_fee_owed_ugx', r.platform_fee_owed_ugx,
    'net_to_business_ugx', r.collected_ugx - r.platform_fee_ugx);
END;
$$;

-- Pay IcanEra whatever cash entries still owe it, as far as the business wallet allows. Needs 'edit'.
CREATE OR REPLACE FUNCTION public.mbg_zone_settle_owed(p_business_profile_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id      UUID;
  v_ok      INTEGER := 0;
  v_pending INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Please sign in'); END IF;
  IF NOT public.mbg_zone_staff_can(p_business_profile_id, 'edit') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your role cannot settle fees');
  END IF;
  FOR v_id IN
    SELECT id FROM public.mbg_access_visits
     WHERE business_profile_id = p_business_profile_id AND platform_fee_ugx > platform_fee_settled_ugx
     ORDER BY created_at
  LOOP
    IF public.mbg_zone_settle_platform_fee(v_id) THEN v_ok := v_ok + 1; ELSE v_pending := v_pending + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'settled', v_ok, 'still_owed', v_pending);
END;
$$;


-- ─── 8. The rider: their passes, and paying at the gate ──────────────────────

-- Everything a rider needs on one screen: the zones that approved their vehicles, fee requests waiting for them, where they
-- are inside right now (and what they owe to leave), and the last few visits.
CREATE OR REPLACE FUNCTION public.mbg_my_gate_passes() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Please sign in'); END IF;
  PERFORM public.mbg_zone_expire_stale();
  -- bring the overstay of the vehicles currently inside up to date, so the rider sees what the gate will ask
  PERFORM public.mbg_zone_refresh_balance(v.id) FROM public.mbg_access_visits v WHERE v.rider_user_id = v_uid AND v.status = 'inside';

  RETURN jsonb_build_object(
    'success', true,
    'ugx_per_ican', public.mbg_zone_ugx_per_ican(),
    'passes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'member_id', m.id, 'zone_id', z.id, 'zone_name', z.name, 'zone_kind', z.kind, 'location', z.location,
        'organisation', bp.business_name, 'member_kind', m.member_kind, 'status', m.status,
        'state', public.mbg_zone_member_state(m, z.timezone), 'valid_until', m.valid_until,
        'daily_start_time', m.daily_start_time, 'daily_end_time', m.daily_end_time,
        'plate_number', r.plate_number, 'vehicle_type', r.vehicle_type::TEXT) ORDER BY z.name)
      FROM public.mbg_access_zone_members m
      JOIN public.mbg_access_zones z ON z.id = m.zone_id
      JOIN public.business_profiles bp ON bp.id = z.business_profile_id
      JOIN public.mbg_riders r ON r.id = m.rider_id
      WHERE m.rider_user_id = v_uid AND m.status <> 'revoked'), '[]'::JSONB),
    'requests', COALESCE((
      SELECT jsonb_agg(public.mbg_zone_visit_json(v) || jsonb_build_object(
               'zone_name', z.name, 'fee_ican', ROUND((v.fee_due_ugx - v.fee_paid_ugx) / public.mbg_zone_ugx_per_ican(), 8),
               'kind', CASE WHEN v.status = 'awaiting_payment' THEN 'entry' ELSE 'balance' END) ORDER BY v.requested_at DESC)
      FROM public.mbg_access_visits v JOIN public.mbg_access_zones z ON z.id = v.zone_id
      WHERE v.rider_user_id = v_uid AND v.fee_due_ugx > v.fee_paid_ugx AND v.status IN ('awaiting_payment', 'inside')
        AND NOT (v.status = 'awaiting_payment' AND v.pay_by < now())), '[]'::JSONB),
    'inside', COALESCE((
      SELECT jsonb_agg(public.mbg_zone_visit_json(v) || jsonb_build_object(
               'zone_name', z.name, 'max_stay_minutes', z.max_stay_minutes,
               'minutes_inside', floor(extract(epoch FROM (now() - v.entered_at)) / 60)) ORDER BY v.entered_at DESC)
      FROM public.mbg_access_visits v JOIN public.mbg_access_zones z ON z.id = v.zone_id
      WHERE v.rider_user_id = v_uid AND v.status = 'inside'), '[]'::JSONB),
    'recent', COALESCE((
      SELECT jsonb_agg(public.mbg_zone_visit_json(v) || jsonb_build_object('zone_name', z.name) ORDER BY v.created_at DESC)
      FROM (SELECT * FROM public.mbg_access_visits
             WHERE rider_user_id = v_uid AND status IN ('exited', 'denied', 'cancelled')
             ORDER BY created_at DESC LIMIT 10) v
      JOIN public.mbg_access_zones z ON z.id = v.zone_id), '[]'::JSONB));
END;
$$;

-- The rider approves and pays what a gate asked for: the entry fee, or the balance they owe to leave.
-- Debits the rider's ICAN wallet, pays the business its share and IcanEra's cut, all in one transaction.
CREATE OR REPLACE FUNCTION public.mbg_rider_pay_gate_fee(p_visit_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v          public.mbg_access_visits;
  z          public.mbg_access_zones;
  v_amount   NUMERIC;
  v_ican     NUMERIC;
  v_rate     NUMERIC;
  v_platform_ugx  NUMERIC;
  v_platform_ican NUMERIC;
  v_business_ican NUMERIC;
  v_owner    UUID;
  v_ref      TEXT;
  v_debit    JSONB;
  v_credit   JSONB;
  v_platform_ok BOOLEAN := false;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Please sign in'); END IF;
  PERFORM public.mbg_zone_expire_stale();
  SELECT * INTO v FROM public.mbg_access_visits WHERE id = p_visit_id FOR UPDATE;
  IF NOT FOUND OR v.rider_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found');
  END IF;
  IF v.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This request has expired or was withdrawn. Ask the gate to scan your card again.');
  END IF;
  IF v.status = 'inside' THEN v := public.mbg_zone_refresh_balance(v.id); END IF;
  IF v.status NOT IN ('awaiting_payment', 'inside') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Nothing to pay on this visit');
  END IF;
  SELECT * INTO z FROM public.mbg_access_zones WHERE id = v.zone_id;
  IF v.status = 'awaiting_payment' AND z.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This zone is not accepting vehicles right now');
  END IF;

  v_amount := v.fee_due_ugx - v.fee_paid_ugx;
  IF v_amount <= 0 THEN
    RETURN jsonb_build_object('success', true, 'already_paid', true, 'visit', public.mbg_zone_visit_json(v));
  END IF;

  v_rate := COALESCE(v.platform_fee_rate, public.ican_fee_rate('zone_access_fee'));
  v_ican := ROUND(v_amount / public.mbg_zone_ugx_per_ican(), 8);
  IF v_ican <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'The amount is too small to pay'); END IF;
  v_platform_ugx  := ROUND(v_amount * v_rate, 2);
  v_platform_ican := ROUND(v_ican * v_rate, 8);
  v_business_ican := v_ican - v_platform_ican;

  -- keyed on how much has been paid so far, so a double tap finds the first payment already counted and stops at "already paid"
  v_ref := 'gate_fee:' || v.id::TEXT || ':' || round(v.fee_paid_ugx * 100)::TEXT;
  v_debit := public.mbg_debit_journey_fare(auth.uid(), v_ican, 'mybodaguy', v_ref);
  IF NOT COALESCE((v_debit ->> 'success')::BOOLEAN, false) THEN
    RETURN jsonb_build_object('success', false, 'error', COALESCE(v_debit ->> 'error', 'Wallet payment failed'));
  END IF;

  SELECT bp.user_id INTO v_owner FROM public.business_profiles bp WHERE bp.id = v.business_profile_id;

  -- The business gets the fee minus IcanEra's cut. If IcanEra's side cannot be credited (platform business not set up), the
  -- business keeps that part for now and it stays "owed" on the visit, so no money disappears and the rider is not blocked.
  v_credit := public.fn_credit_platform_fee_to_business(
    v_platform_ican, 'mybodaguy', v_ref, 'zone_access_fee', v_owner, 'Restricted-zone fee: ' || z.name,
    jsonb_build_object('visit_id', v.id, 'zone_id', z.id));
  v_platform_ok := COALESCE((v_credit ->> 'success')::BOOLEAN, false);
  IF NOT v_platform_ok THEN
    v_business_ican := v_ican;
  END IF;

  INSERT INTO public.ican_business_wallets (business_profile_id, created_by)
  SELECT bp.id, bp.user_id FROM public.business_profiles bp WHERE bp.id = v.business_profile_id
  ON CONFLICT (business_profile_id) DO NOTHING;
  UPDATE public.ican_business_wallets
     SET ican_balance = ican_balance + v_business_ican, total_earned = total_earned + v_business_ican, updated_at = now()
   WHERE business_profile_id = v.business_profile_id;
  INSERT INTO public.ican_business_wallet_transactions
    (business_profile_id, initiated_by, amount_ican, note, reference_id, status, executed_at, direction, source_app, operation_type, metadata)
  VALUES
    (v.business_profile_id, auth.uid(), v_business_ican,
     CASE WHEN v.status = 'awaiting_payment' THEN 'Restricted-zone entry fee: ' ELSE 'Restricted-zone exit fee: ' END || z.name,
     v_ref, 'completed', now(), 'in', 'mybodaguy', 'zone_access_fee',
     jsonb_build_object('visit_id', v.id, 'zone_id', z.id, 'plate', v.plate_number, 'gross_ugx', v_amount, 'platform_fee_ugx', v_platform_ugx));

  UPDATE public.mbg_access_visits SET
    fee_paid_ugx = fee_due_ugx, payment_method = 'wallet', payment_tx_id = NULLIF(v_debit ->> 'tx_id', '')::UUID,
    platform_fee_rate = v_rate,
    platform_fee_ugx = platform_fee_ugx + v_platform_ugx,
    platform_fee_settled_ugx = platform_fee_settled_ugx + CASE WHEN v_platform_ok THEN v_platform_ugx ELSE 0 END,
    balance_paid_at = CASE WHEN status = 'inside' THEN now() ELSE balance_paid_at END,
    status = 'inside', entered_at = COALESCE(entered_at, now())
  WHERE id = v.id
  RETURNING * INTO v;

  RETURN jsonb_build_object('success', true, 'visit', public.mbg_zone_visit_json(v), 'paid_ugx', v_amount, 'paid_ican', v_ican);
END;
$$;

-- The rider says no to a fee request. The vehicle simply does not enter.
CREATE OR REPLACE FUNCTION public.mbg_rider_decline_gate_fee(p_visit_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v public.mbg_access_visits;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Please sign in'); END IF;
  SELECT * INTO v FROM public.mbg_access_visits WHERE id = p_visit_id FOR UPDATE;
  IF NOT FOUND OR v.rider_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found');
  END IF;
  IF v.status <> 'awaiting_payment' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only an entry request that is still waiting can be declined');
  END IF;
  UPDATE public.mbg_access_visits SET status = 'cancelled', reason = 'The rider declined the entry fee' WHERE id = v.id;
  RETURN jsonb_build_object('success', true);
END;
$$;


-- ─── 9. Who may call what ────────────────────────────────────────────────────
-- Supabase grants every new function to anon and authenticated; REVOKE FROM PUBLIC does not take those back, so they go by name.

REVOKE ALL ON FUNCTION public.mbg_zone_upsert(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, NUMERIC, INTEGER, TEXT, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_zone_list(UUID)                                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_zone_search_riders(UUID, UUID, TEXT)              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_zone_member_add(UUID, UUID, TEXT, TIMESTAMPTZ, TIME, TIME, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_zone_member_set_status(UUID, TEXT)                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_zone_members(UUID)                                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_zone_gate_check_in(UUID, TEXT, TEXT, TEXT)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_zone_gate_check_out(UUID, TEXT, TEXT, TEXT)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_zone_gate_scan(UUID, TEXT, TEXT, TEXT, TEXT)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_zone_gate_collect_cash(UUID)                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_zone_gate_cancel(UUID)                            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_zone_visits(UUID, TEXT, INTEGER)                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_zone_visit_status(UUID)                           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_zone_report(UUID, INTEGER)                        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_zone_settle_owed(UUID)                            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_my_gate_passes()                                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_rider_pay_gate_fee(UUID)                          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_rider_decline_gate_fee(UUID)                      FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.mbg_zone_upsert(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, NUMERIC, INTEGER, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_zone_list(UUID)                                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_zone_search_riders(UUID, UUID, TEXT)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_zone_member_add(UUID, UUID, TEXT, TIMESTAMPTZ, TIME, TIME, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_zone_member_set_status(UUID, TEXT)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_zone_members(UUID)                                TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_zone_gate_check_in(UUID, TEXT, TEXT, TEXT)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_zone_gate_check_out(UUID, TEXT, TEXT, TEXT)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_zone_gate_scan(UUID, TEXT, TEXT, TEXT, TEXT)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_zone_gate_collect_cash(UUID)                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_zone_gate_cancel(UUID)                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_zone_visits(UUID, TEXT, INTEGER)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_zone_visit_status(UUID)                           TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_zone_report(UUID, INTEGER)                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_zone_settle_owed(UUID)                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_my_gate_passes()                                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_rider_pay_gate_fee(UUID)                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_rider_decline_gate_fee(UUID)                      TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'Restricted zones ready: organisations approve vehicles by rider ID card, sell entry to others, and clear vehicles on the way out. ICANera now takes % of every zone fee (ican_fee_rates.zone_access_fee).',
    trim_scale(round(public.ican_fee_rate('zone_access_fee') * 100, 4))::TEXT || '%';
END $$;
