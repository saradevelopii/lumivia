-- Lumivia · migração 11 — exercício "Antes e depois do novo"
-- A terapeuta libera o exercício (tema + data opcional). O paciente preenche 3 etapas em ordem.
-- As respostas não podem ser editadas nem apagadas pelo paciente.
-- A comparação só aparece para o paciente depois que a terapeuta libera (compare_released_at).

create table if not exists public.novelty_exercises (
  id                  uuid primary key default gen_random_uuid(),
  patient_id          uuid not null references public.profiles(id) on delete cascade,
  topic               text not null check (char_length(topic) between 1 and 200),
  event_date          date,
  compare_released_at timestamptz,
  pinned              boolean,            -- null = automático (situações "mais difícil" e "não foi" ficam marcadas)
  created_at          timestamptz not null default now()
);
create index if not exists novelty_ex_patient_idx on public.novelty_exercises (patient_id, created_at desc);

create table if not exists public.novelty_steps (
  exercise_id uuid not null references public.novelty_exercises(id) on delete cascade,
  step        smallint not null check (step between 1 and 3),
  mood        smallint not null check (mood between 0 and 4),
  difficulty  smallint check (difficulty between 0 and 10),
  went        boolean not null default true,
  answers     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  primary key (exercise_id, step),
  -- etapa 1 sempre tem dificuldade; etapas 2 e 3 têm quando a pessoa foi
  check (step <> 1 or (difficulty is not null and went)),
  check (not went or difficulty is not null)
);

-- horário sempre do servidor
create or replace function public.novelty_steps_stamp() returns trigger language plpgsql as $$
begin new.created_at := now(); return new; end $$;
drop trigger if exists novelty_steps_stamp on public.novelty_steps;
create trigger novelty_steps_stamp before insert on public.novelty_steps
  for each row execute function public.novelty_steps_stamp();

-- o paciente só pode registrar a próxima etapa do próprio exercício, em ordem;
-- se na etapa 2 ele "decidiu não ir", a etapa 3 também fica sem dificuldade
create or replace function public.novelty_can_insert(ex uuid, st smallint, w boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from novelty_exercises e where e.id = ex and e.patient_id = auth.uid())
    and (st = 1 or exists (select 1 from novelty_steps s where s.exercise_id = ex and s.step = st - 1))
    and (st <> 3 or w = coalesce((select s.went from novelty_steps s where s.exercise_id = ex and s.step = 2), true))
$$;

alter table public.novelty_exercises enable row level security;
alter table public.novelty_steps enable row level security;

drop policy if exists nov_ex_therapist on public.novelty_exercises;
create policy nov_ex_therapist on public.novelty_exercises for all to authenticated
  using (public.is_therapist()) with check (public.is_therapist());
drop policy if exists nov_ex_self_read on public.novelty_exercises;
create policy nov_ex_self_read on public.novelty_exercises for select to authenticated
  using (patient_id = auth.uid() and public.is_active());

drop policy if exists nov_st_therapist on public.novelty_steps;
create policy nov_st_therapist on public.novelty_steps for select to authenticated using (public.is_therapist());
drop policy if exists nov_st_therapist_del on public.novelty_steps;
create policy nov_st_therapist_del on public.novelty_steps for delete to authenticated using (public.is_therapist());
drop policy if exists nov_st_self_read on public.novelty_steps;
create policy nov_st_self_read on public.novelty_steps for select to authenticated
  using (public.is_active() and exists (select 1 from public.novelty_exercises e where e.id = exercise_id and e.patient_id = auth.uid()));
drop policy if exists nov_st_self_insert on public.novelty_steps;
create policy nov_st_self_insert on public.novelty_steps for insert to authenticated
  with check (public.is_active() and public.novelty_can_insert(exercise_id, step, went));

-- selo "Novo" também para o exercício
alter table public.item_views drop constraint if exists item_views_kind_check;
alter table public.item_views add constraint item_views_kind_check check (kind in ('content', 'session', 'exercise', 'exercise_result'));

notify pgrst, 'reload schema';
