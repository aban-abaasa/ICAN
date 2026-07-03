-- ============================================================================
-- landing_updates — public announcements feed for the ICANera landing page
-- ============================================================================
-- Read-only for everyone (anon + authenticated). There is intentionally NO
-- insert/update/delete policy for anon or authenticated — content is authored
-- via the Supabase SQL editor / dashboard (service_role bypasses RLS). No
-- in-app authoring UI exists yet; that is an explicit scope boundary for this
-- pass, not an oversight.
-- ============================================================================

create table if not exists public.landing_updates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  category text not null default 'general',
  published boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists landing_updates_published_created_at_idx
  on public.landing_updates (published, created_at desc);

alter table public.landing_updates enable row level security;

drop policy if exists "Public can view published updates" on public.landing_updates;
create policy "Public can view published updates"
  on public.landing_updates for select
  using (published = true);

-- Enable realtime so UpdatesFeed.jsx can live-update without a page reload.
alter publication supabase_realtime add table public.landing_updates;

-- Seed a couple of rows so the feed isn't empty on first load.
insert into public.landing_updates (title, body, category)
values
  ('Welcome to the new ICANera landing page', 'You can now browse PitchIn opportunities, try mock ICAN trades, and explore TRUST groups right from this page — sign in any time to make it real.', 'product'),
  ('TRUST groups are live', 'Democratic savings groups with transparent, blockchain-backed fund tracking. Browse active groups below.', 'product')
on conflict do nothing;
