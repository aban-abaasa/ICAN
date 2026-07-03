-- ============================================================================
-- Allow anonymous (and authenticated) readers to see PUBLIC, non-expired
-- Status posts (public.ican_statuses) — needed for the landing page's
-- "Community Stories" carousel, which shows real user-posted photos/videos.
-- ============================================================================
-- ican_statuses was built for the authenticated dashboard (StatusFeed.jsx),
-- so it likely has no SELECT policy that lets the anon role see anything —
-- that's why the landing page's carousel comes back empty. This adds ONE
-- narrow, additive policy: visibility = 'public' AND not yet expired. It
-- does not touch or replace any existing policy that lets authenticated
-- users see their own / followers' statuses — Postgres RLS policies for the
-- same command (SELECT) are OR'd together, so this can only ever reveal
-- MORE public rows, never hide anything currently visible.
-- ============================================================================

alter table public.ican_statuses enable row level security;

grant select on public.ican_statuses to anon, authenticated;

drop policy if exists "Public can view public non-expired statuses" on public.ican_statuses;
create policy "Public can view public non-expired statuses"
  on public.ican_statuses for select
  using (visibility = 'public' and expires_at > now());
