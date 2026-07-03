-- ============================================================================
-- landing_mock_trades — logs simulated (not real) invest/buy/sell actions
-- taken by anonymous or signed-in visitors on the ICANera landing page.
-- ============================================================================
-- No real money, equity, or wallet balance is ever touched by these rows —
-- they exist purely to power a "recent activity" ticker and give basic
-- lead-gen visibility into what visitors try before signing up. Same risk
-- class as the already-accepted anonymous-write pattern on landing_messages
-- (no PII required, worst-case abuse is spam rows, not financial exposure).
-- ============================================================================

create table if not exists public.landing_mock_trades (
  id uuid primary key default gen_random_uuid(),
  guest_key uuid,                        -- set when auth_id is null (anon visitor)
  auth_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('pitch_invest', 'wallet_buy', 'wallet_sell')),
  target_type text,                      -- 'pitch' | 'ican_coin' | null
  target_id text,                        -- pitches.id (as text) when kind = 'pitch_invest'
  input_amount numeric not null check (input_amount > 0 and input_amount <= 100000000),
  computed_result jsonb not null default '{}'::jsonb,
  origin_app text not null default 'ican',
  created_at timestamptz not null default now()
);

create index if not exists landing_mock_trades_created_at_idx
  on public.landing_mock_trades (created_at desc);

alter table public.landing_mock_trades enable row level security;

drop policy if exists "Anyone can record a mock trade" on public.landing_mock_trades;
create policy "Anyone can record a mock trade"
  on public.landing_mock_trades for insert
  with check (
    (auth_id is null and guest_key is not null)
    or (auth_id = auth.uid())
  );

drop policy if exists "Anyone can view mock trades" on public.landing_mock_trades;
create policy "Anyone can view mock trades"
  on public.landing_mock_trades for select
  using (true);

-- No update/delete policy — rows are immutable; moderation via service_role only.

-- Enable realtime so the "recent activity" ticker can live-update.
alter publication supabase_realtime add table public.landing_mock_trades;
