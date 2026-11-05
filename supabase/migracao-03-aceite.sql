-- =====================================================================
-- Lumivia — atualização 03: aceite dos Acordos do processo pela plataforma
-- Rode UMA vez no Supabase: SQL Editor > New query > cole tudo > Run
-- =====================================================================

-- Registro de cada aceite (não pode ser alterado nem apagado pelo paciente)
create table if not exists public.consents (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  version      text not null,
  full_name    text not null,
  user_agent   text,
  accepted_at  timestamptz not null default now(),
  unique (patient_id, version)
);

-- A data e hora do aceite é sempre a do servidor (não dá para "voltar no tempo")
create or replace function public.consents_set_time()
returns trigger language plpgsql as $$
begin
  new.accepted_at := now();
  return new;
end;
$$;
drop trigger if exists consents_time on public.consents;
create trigger consents_time before insert on public.consents
  for each row execute function public.consents_set_time();

alter table public.consents enable row level security;

create policy consents_self_insert    on public.consents for insert to authenticated with check (patient_id = auth.uid());
create policy consents_self_read      on public.consents for select to authenticated using (patient_id = auth.uid());
create policy consents_therapist_read on public.consents for select to authenticated using (public.is_therapist());
