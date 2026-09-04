-- Voice notes: move file storage from Cloudflare R2 to Supabase Storage,
-- and add a daily keep/delete retention prompt.
--
-- Run this against the Supabase project (SQL editor, or `supabase db push`
-- if you're driving it from the CLI). It is not applied automatically.

-- 1. Private bucket for voice-note audio, one folder per owner (auth uid).
insert into storage.buckets (id, name, public)
values ('voice-notes', 'voice-notes', false)
on conflict (id) do nothing;

-- Any file owner may upload/delete inside their own `${auth.uid()}/...` folder.
create policy "Voice notes: owner can upload"
  on storage.objects for insert
  with check (
    bucket_id = 'voice-notes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Voice notes: owner can delete"
  on storage.objects for delete
  using (
    bucket_id = 'voice-notes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Any signed-in user can read/play a voice note (recipients aren't the
-- uploader, so read access can't be scoped to the owner the way
-- insert/delete are).
create policy "Voice notes: authenticated users can read"
  on storage.objects for select
  using (bucket_id = 'voice-notes' and auth.role() = 'authenticated');

-- 2. Retention tracking: one row per uploaded voice note.
--
-- Semantics ("ask once a day, default to delete if ignored"):
--   - last_prompted_date is set (to today) the moment a note is surfaced
--     in the daily keep/delete prompt.
--   - last_answered_date is set (to today) only when the owner actively
--     clicks "Keep".
--   - a note is auto-deleted once a later sweep finds last_prompted_date
--     in the past with no matching last_answered_date for that date --
--     i.e. it was shown and never answered.
create table if not exists public.voice_note_retention (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'deleted')),
  created_at timestamptz not null default now(),
  last_prompted_date date,
  last_answered_date date,
  decided_at timestamptz
);

create index if not exists voice_note_retention_owner_pending_idx
  on public.voice_note_retention (owner_id, status);

alter table public.voice_note_retention enable row level security;

create policy "Voice note retention: owner manages their own rows"
  on public.voice_note_retention
  for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);
