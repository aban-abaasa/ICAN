-- Links a voice note's retention row to the chat message(s) it was sent
-- as, so that deleting/expiring the note also deletes those messages
-- (not just the audio). Run this after add_voice_note_retention.sql,
-- against the same Supabase project (SQL editor, or `supabase db push`).
--
-- One retention row can map to more than one message: a CMMS voice note
-- sent to "everyone" fans out into one cmms_report_messages row per
-- recipient, all pointing at the same audio file.

create table if not exists public.voice_note_messages (
  id uuid primary key default gen_random_uuid(),
  retention_id uuid not null references public.voice_note_retention(id) on delete cascade,
  message_table text not null check (
    message_table in ('chat_messages', 'group_messages', 'landing_messages', 'cmms_report_messages')
  ),
  message_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists voice_note_messages_retention_idx
  on public.voice_note_messages (retention_id);

alter table public.voice_note_messages enable row level security;

drop policy if exists "Voice note messages: owner manages their own links" on public.voice_note_messages;
create policy "Voice note messages: owner manages their own links"
  on public.voice_note_messages
  for all
  using (exists (
    select 1 from public.voice_note_retention r
    where r.id = voice_note_messages.retention_id and r.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.voice_note_retention r
    where r.id = voice_note_messages.retention_id and r.owner_id = auth.uid()
  ));

-- NOTE ON MESSAGE DELETION:
-- The app now tries to delete the underlying chat_messages / group_messages
-- / landing_messages row when a voice note is deleted or auto-expires.
-- cmms_report_messages already has a delete path (fn_delete_message RPC).
-- The other three tables were created outside this migration set, so their
-- exact ownership columns/RLS aren't known here. If deleted voice notes
-- still leave the message bubble behind (rather than showing "Voice note
-- removed"), it means that table doesn't yet have a DELETE policy letting
-- the author remove their own row -- add one scoped to however you
-- identify the sender on that table (e.g. a user_id/auth_id column), or
-- point deleteMessage/deleteGroupMessage/deleteLandingMessage in the
-- frontend services at an RPC the way cmms already does.
