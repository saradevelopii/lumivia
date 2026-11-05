-- =====================================================================
-- Lumivia — atualização 07: Roda da Vida
-- Rode UMA vez no Supabase: SQL Editor > New query > cole tudo > Run
-- =====================================================================

-- Ferramentas liberadas pela terapeuta para cada paciente (ex.: 'roda')
create table if not exists public.tool_access (
  patient_id   uuid not null references public.profiles(id) on delete cascade,
  tool         text not null,
  released_at  timestamptz not null default now(),
  primary key (patient_id, tool)
);
alter table public.tool_access enable row level security;
create policy ta_self_read on public.tool_access for select to authenticated using (patient_id = auth.uid() and public.is_active());
create policy ta_therapist on public.tool_access for all    to authenticated using (public.is_therapist()) with check (public.is_therapist());

create or replace function public.tool_released(t text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tool_access where patient_id = auth.uid() and tool = t);
$$;

-- Cada preenchimento da Roda da Vida (histórico; o paciente não altera nem apaga)
create table if not exists public.wheel_entries (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  scores      jsonb not null check (jsonb_typeof(scores) = 'object'),
  focus       text,
  reflection  text,
  created_at  timestamptz not null default now()
);
create index if not exists wheel_patient_idx on public.wheel_entries (patient_id, created_at);

-- Notas sempre entre 0 e 10, e data do servidor
create or replace function public.wheel_check()
returns trigger language plpgsql as $$
declare k text; v jsonb;
begin
  new.created_at := now();
  for k, v in select * from jsonb_each(new.scores) loop
    if jsonb_typeof(v) <> 'number' or (v::text)::numeric < 0 or (v::text)::numeric > 10 then
      raise exception 'Nota inválida na área %', k;
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists wheel_check on public.wheel_entries;
create trigger wheel_check before insert on public.wheel_entries for each row execute function public.wheel_check();

alter table public.wheel_entries enable row level security;
create policy wheel_self_insert on public.wheel_entries for insert to authenticated
  with check (patient_id = auth.uid() and public.is_active() and public.tool_released('roda'));
create policy wheel_self_read on public.wheel_entries for select to authenticated
  using (patient_id = auth.uid() and public.is_active());
create policy wheel_therapist_read on public.wheel_entries for select to authenticated using (public.is_therapist());

-- Faz o Supabase reconhecer as tabelas novas na hora
notify pgrst, 'reload schema';
