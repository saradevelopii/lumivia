-- =====================================================================
-- Lumivia — banco de dados (Supabase)
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Tabelas ----------

-- Perfil de cada pessoa que faz login (paciente ou terapeuta)
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  role        text not null default 'patient' check (role in ('patient', 'therapist')),
  created_at  timestamptz not null default now()
);

-- Fases da jornada (as mesmas para todos os pacientes)
create table if not exists public.phases (
  id          serial primary key,
  position    int not null unique,
  name        text not null,
  description text
);

-- Quais fases cada paciente já tem liberadas
create table if not exists public.phase_unlocks (
  patient_id  uuid not null references public.profiles(id) on delete cascade,
  phase_id    int  not null references public.phases(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (patient_id, phase_id)
);

-- Biblioteca de conteúdos (vídeos, textos, exercícios...) por fase
create table if not exists public.contents (
  id          uuid primary key default gen_random_uuid(),
  phase_id    int  not null references public.phases(id) on delete cascade,
  kind        text not null check (kind in ('video', 'texto', 'exercicio', 'audio', 'pdf', 'link')),
  title       text not null,
  body        text,
  url         text,
  file_path   text,
  duration    text,
  created_at  timestamptz not null default now()
);

-- Sessões registradas pela terapeuta
create table if not exists public.sessions (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references public.profiles(id) on delete cascade,
  session_date date not null default current_date,
  summary      text,
  weekly_task  text,
  created_at   timestamptz not null default now()
);

-- Notas privadas da sessão (o paciente NUNCA tem acesso)
create table if not exists public.session_private_notes (
  session_id  uuid primary key references public.sessions(id) on delete cascade,
  notes       text
);

-- Materiais anexados a uma sessão (arquivo ou link)
create table if not exists public.session_materials (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.sessions(id) on delete cascade,
  title       text not null,
  url         text,
  file_path   text,
  created_at  timestamptz not null default now()
);

-- Diário do paciente (humor de 0 a 4 + reflexão)
create table if not exists public.diary_entries (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  mood        smallint check (mood between 0 and 4),
  reflection  text,
  created_at  timestamptz not null default now()
);

-- Tarefas para o paciente
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references public.profiles(id) on delete cascade,
  title       text not null,
  done        boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Metas combinadas
create table if not exists public.goals (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references public.profiles(id) on delete cascade,
  title       text not null,
  done        boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists diary_patient_idx    on public.diary_entries (patient_id, created_at desc);
create index if not exists sessions_patient_idx on public.sessions (patient_id, session_date desc);
create index if not exists contents_phase_idx   on public.contents (phase_id);

-- ---------- Funções auxiliares ----------

create or replace function public.is_therapist()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'therapist');
$$;

create or replace function public.phase_unlocked(pid int)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.phase_unlocks where patient_id = auth.uid() and phase_id = pid);
$$;

-- Versão em texto, usada nas regras dos arquivos (pasta conteudos/<fase>/...)
create or replace function public.phase_unlocked_txt(pid text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.phase_unlocks where patient_id = auth.uid() and phase_id::text = pid);
$$;

-- Ao criar um usuário: cria o perfil e libera a primeira fase
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));

  insert into public.phase_unlocks (patient_id, phase_id)
  select new.id, id from public.phases order by position limit 1
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Segurança (RLS): quem pode ver e mudar o quê ----------

alter table public.profiles              enable row level security;
alter table public.phases                enable row level security;
alter table public.phase_unlocks         enable row level security;
alter table public.contents              enable row level security;
alter table public.sessions              enable row level security;
alter table public.session_private_notes enable row level security;
alter table public.session_materials     enable row level security;
alter table public.diary_entries         enable row level security;
alter table public.tasks                 enable row level security;
alter table public.goals                 enable row level security;

-- Perfis: cada um vê o próprio; terapeuta vê e edita todos
create policy profiles_self_read  on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_therapist  on public.profiles for all    to authenticated using (public.is_therapist()) with check (public.is_therapist());

-- Fases: todos leem; só a terapeuta altera
create policy phases_read         on public.phases for select to authenticated using (true);
create policy phases_therapist    on public.phases for all    to authenticated using (public.is_therapist()) with check (public.is_therapist());

-- Liberação de fases
create policy unlocks_self_read   on public.phase_unlocks for select to authenticated using (patient_id = auth.uid());
create policy unlocks_therapist   on public.phase_unlocks for all    to authenticated using (public.is_therapist()) with check (public.is_therapist());

-- Conteúdos: paciente só vê os das fases liberadas para ele
create policy contents_unlocked   on public.contents for select to authenticated using (public.phase_unlocked(phase_id));
create policy contents_therapist  on public.contents for all    to authenticated using (public.is_therapist()) with check (public.is_therapist());

-- Sessões: paciente vê só as próprias
create policy sessions_self_read  on public.sessions for select to authenticated using (patient_id = auth.uid());
create policy sessions_therapist  on public.sessions for all    to authenticated using (public.is_therapist()) with check (public.is_therapist());

-- Notas privadas: só a terapeuta
create policy notes_therapist     on public.session_private_notes for all to authenticated using (public.is_therapist()) with check (public.is_therapist());

-- Materiais de sessão: paciente vê os das próprias sessões
create policy materials_self_read on public.session_materials for select to authenticated
  using (exists (select 1 from public.sessions s where s.id = session_id and s.patient_id = auth.uid()));
create policy materials_therapist on public.session_materials for all to authenticated using (public.is_therapist()) with check (public.is_therapist());

-- Diário: o paciente escreve e lê o próprio; a terapeuta só lê
create policy diary_self          on public.diary_entries for all    to authenticated using (patient_id = auth.uid()) with check (patient_id = auth.uid());
create policy diary_therapist     on public.diary_entries for select to authenticated using (public.is_therapist());

-- Tarefas e metas: paciente lê e marca como feita; terapeuta gerencia
create policy tasks_self_read     on public.tasks for select to authenticated using (patient_id = auth.uid());
create policy tasks_self_update   on public.tasks for update to authenticated using (patient_id = auth.uid()) with check (patient_id = auth.uid());
create policy tasks_therapist     on public.tasks for all    to authenticated using (public.is_therapist()) with check (public.is_therapist());

create policy goals_self_read     on public.goals for select to authenticated using (patient_id = auth.uid());
create policy goals_self_update   on public.goals for update to authenticated using (patient_id = auth.uid()) with check (patient_id = auth.uid());
create policy goals_therapist     on public.goals for all    to authenticated using (public.is_therapist()) with check (public.is_therapist());

-- ---------- Arquivos (Storage) ----------
-- Pastas:  conteudos/<id da fase>/arquivo   → conteúdos da biblioteca
--          <id do paciente>/arquivo         → materiais de sessão daquele paciente

insert into storage.buckets (id, name, public)
values ('materiais', 'materiais', false)
on conflict (id) do nothing;

create policy materiais_read on storage.objects for select to authenticated using (
  bucket_id = 'materiais' and (
    public.is_therapist()
    or (storage.foldername(name))[1] = auth.uid()::text
    or ((storage.foldername(name))[1] = 'conteudos' and public.phase_unlocked_txt((storage.foldername(name))[2]))
  )
);
create policy materiais_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'materiais' and public.is_therapist());
create policy materiais_delete on storage.objects for delete to authenticated
  using (bucket_id = 'materiais' and public.is_therapist());

-- ---------- Fases iniciais (renomeie à vontade pelo app) ----------

insert into public.phases (position, name, description) values
  (1, 'Acolhimento',      'Primeiros passos e construção de confiança'),
  (2, 'Autoconhecimento', 'Reconhecer emoções, padrões e crenças'),
  (3, 'Mudança',          'Construir novos hábitos e respostas'),
  (4, 'Autonomia',        'Consolidar e seguir com as próprias ferramentas')
on conflict (position) do nothing;

