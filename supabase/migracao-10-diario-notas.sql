-- Lumivia · migração 10 — diário: notas privadas, "Levar para a sessão" e humor obrigatório
-- Notas e marcações da terapeuta em cada registro do diário. O paciente NÃO tem acesso.
create table if not exists public.diary_notes (
  entry_id    uuid primary key references public.diary_entries(id) on delete cascade,
  patient_id  uuid not null references public.profiles(id) on delete cascade,
  note        text,
  pinned      boolean not null default false,
  updated_at  timestamptz not null default now()
);
create index if not exists diary_notes_patient_idx on public.diary_notes (patient_id, pinned);
alter table public.diary_notes enable row level security;
drop policy if exists diary_notes_therapist on public.diary_notes;
create policy diary_notes_therapist on public.diary_notes for all to authenticated
  using (public.is_therapist()) with check (public.is_therapist());

create or replace function public.diary_notes_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists diary_notes_touch on public.diary_notes;
create trigger diary_notes_touch before insert or update on public.diary_notes
  for each row execute function public.diary_notes_touch();

-- Humor obrigatório nos registros NOVOS (os antigos sem humor continuam como estão)
alter table public.diary_entries drop constraint if exists diary_mood_required;
alter table public.diary_entries add constraint diary_mood_required check (mood is not null) not valid;

notify pgrst, 'reload schema';
