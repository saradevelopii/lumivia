-- Lumivia · migração 12 — "O seu compromisso" (compromisso do paciente consigo mesmo)
-- Um compromisso por paciente, escrito pela terapeuta. O paciente assume uma única vez.
-- Depois de assumido, o texto fica travado.

create table if not exists public.commitments (
  patient_id  uuid primary key references public.profiles(id) on delete cascade,
  intro       text check (char_length(intro) <= 1000),
  phrase      text not null check (char_length(phrase) between 1 and 600),
  first_step  text check (char_length(first_step) <= 500),
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);
alter table public.commitments enable row level security;

drop policy if exists commitments_therapist on public.commitments;
create policy commitments_therapist on public.commitments for all to authenticated
  using (public.is_therapist()) with check (public.is_therapist());
drop policy if exists commitments_self_read on public.commitments;
create policy commitments_self_read on public.commitments for select to authenticated
  using (patient_id = auth.uid() and public.is_active());

-- depois de assumido, ninguém altera o texto, o passo nem a data
create or replace function public.commitments_lock() returns trigger language plpgsql as $$
begin
  if old.accepted_at is not null and (new.intro is distinct from old.intro or new.phrase is distinct from old.phrase
     or new.first_step is distinct from old.first_step or new.accepted_at is distinct from old.accepted_at) then
    raise exception 'Este compromisso já foi assumido e não pode ser alterado.';
  end if;
  return new;
end $$;
drop trigger if exists commitments_lock on public.commitments;
create trigger commitments_lock before update on public.commitments
  for each row execute function public.commitments_lock();

-- o paciente assume pelo app: data e hora do servidor, uma única vez
create or replace function public.accept_commitment(step text) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare t timestamptz;
begin
  if not public.is_active() then raise exception 'Paciente inativo.'; end if;
  update commitments set accepted_at = now(), first_step = nullif(left(trim(coalesce(step, '')), 500), '')
   where patient_id = auth.uid() and accepted_at is null
   returning accepted_at into t;
  if t is null then raise exception 'Nenhum compromisso pendente.'; end if;
  return t;
end $$;
revoke all on function public.accept_commitment(text) from public;
grant execute on function public.accept_commitment(text) to authenticated;

notify pgrst, 'reload schema';
