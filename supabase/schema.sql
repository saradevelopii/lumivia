-- =====================================================================
-- Lumivia — banco de dados (Supabase)
-- Cole este arquivo inteiro no Supabase: SQL Editor > New query > Run
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

-- =====================================================================
-- DEPOIS de criar a sua conta em Authentication > Users, rode SÓ a linha
-- abaixo (com o seu e-mail) para se tornar a terapeuta do sistema:
--
--   update public.profiles set role = 'therapist' where email = 'seu@email.com';
--
-- =====================================================================

-- ---------- Fotos de perfil (também em migracao-02-fotos.sql) ----------
alter table public.profiles add column if not exists avatar_path text;

-- Pacientes podem ver o perfil da terapeuta (nome e foto)
create policy profiles_read_therapist on public.profiles for select to authenticated
  using (role = 'therapist');

-- Verifica se um id pertence à terapeuta (usado nas regras dos arquivos)
create or replace function public.is_therapist_id(uid text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id::text = uid and role = 'therapist');
$$;

-- Troca a foto: a própria pessoa ou a terapeuta (o paciente não consegue mudar mais nada do perfil)
create or replace function public.set_avatar(target uuid, path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if target is distinct from auth.uid() and not public.is_therapist() then
    raise exception 'sem permissão';
  end if;
  if path is not null and split_part(path, '/', 1) <> target::text then
    raise exception 'caminho inválido';
  end if;
  update public.profiles set avatar_path = path where id = target;
end;
$$;
revoke execute on function public.set_avatar(uuid, text) from public, anon;
grant execute on function public.set_avatar(uuid, text) to authenticated;

-- Pasta de fotos (privada). Cada foto fica em <id da pessoa>/arquivo.jpg
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

create policy avatars_read on storage.objects for select to authenticated using (
  bucket_id = 'avatars' and (
    public.is_therapist()
    or (storage.foldername(name))[1] = auth.uid()::text
    or public.is_therapist_id((storage.foldername(name))[1])
  )
);
create policy avatars_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'avatars' and (public.is_therapist() or (storage.foldername(name))[1] = auth.uid()::text)
);
create policy avatars_delete on storage.objects for delete to authenticated using (
  bucket_id = 'avatars' and (public.is_therapist() or (storage.foldername(name))[1] = auth.uid()::text)
);

-- ---------- Aceite dos acordos (também em migracao-03-aceite.sql) ----------
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

-- ---------- Conteúdos personalizados (também em migracao-04-personalizados.sql) ----------
alter table public.contents add column if not exists audience text not null default 'phase'
  check (audience in ('phase', 'selected'));
alter table public.contents add column if not exists respect_phase boolean not null default true;

-- Pacientes escolhidos para cada conteúdo personalizado
create table if not exists public.content_patients (
  content_id  uuid not null references public.contents(id) on delete cascade,
  patient_id  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (content_id, patient_id)
);
create index if not exists content_patients_patient_idx on public.content_patients (patient_id);

alter table public.content_patients enable row level security;
create policy cp_self_read on public.content_patients for select to authenticated using (patient_id = auth.uid());
create policy cp_therapist on public.content_patients for all    to authenticated using (public.is_therapist()) with check (public.is_therapist());

-- O paciente logado pode ver este conteúdo?
create or replace function public.content_visible(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.contents c
    where c.id = cid and (
      (c.audience = 'phase' and public.phase_unlocked(c.phase_id))
      or (c.audience = 'selected'
          and exists (select 1 from public.content_patients cp where cp.content_id = c.id and cp.patient_id = auth.uid())
          and (not c.respect_phase or public.phase_unlocked(c.phase_id)))
    )
  );
$$;

-- O paciente logado pode abrir este arquivo da biblioteca?
create or replace function public.content_file_visible(path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.contents c where c.file_path = path and public.content_visible(c.id));
$$;

-- Nova regra de leitura dos conteúdos
drop policy if exists contents_unlocked on public.contents;
create policy contents_visible on public.contents for select to authenticated using (public.content_visible(id));

-- Nova regra de leitura dos arquivos (conteúdo personalizado não vaza para outros pacientes da fase)
drop policy if exists materiais_read on storage.objects;
create policy materiais_read on storage.objects for select to authenticated using (
  bucket_id = 'materiais' and (
    public.is_therapist()
    or (storage.foldername(name))[1] = auth.uid()::text
    or ((storage.foldername(name))[1] = 'conteudos' and public.content_file_visible(name))
  )
);

-- ---------- Termo por paciente (também em migracao-05-termo-por-paciente.sql) ----------
create table if not exists public.patient_terms (
  patient_id     uuid primary key references public.profiles(id) on delete cascade,
  monthly_fee    numeric(10,2) not null check (monthly_fee >= 0),
  payment_day    smallint not null check (payment_day between 1 and 31),
  payment_method text not null default 'Pix',
  frequency      text not null default 'semanal' check (frequency in ('semanal', 'quinzenal', 'mensal')),
  duration_min   smallint not null default 50 check (duration_min between 15 and 240),
  format         text not null default 'online' check (format in ('online', 'presencial', 'online e presencial')),
  template       text not null default 't1',   -- versão do texto-base dos acordos
  version        text,                         -- calculada automaticamente
  versioned_at   timestamptz,                  -- quando esta versão passou a valer
  updated_at     timestamptz not null default now()
);

-- A versão muda sempre que uma condição muda (e só nesse caso)
create or replace function public.patient_terms_version()
returns trigger language plpgsql as $$
declare v text;
begin
  v := new.template || '-' || left(encode(sha256(convert_to(concat_ws('|',
         new.monthly_fee::text, new.payment_day::text, new.payment_method, new.frequency,
         new.duration_min::text, new.format, new.template), 'UTF8')), 'hex'), 16);
  new.updated_at := now();
  if tg_op = 'INSERT' or v is distinct from old.version then
    new.version := v;
    new.versioned_at := now();
  else
    new.version := old.version;
    new.versioned_at := old.versioned_at;
  end if;
  return new;
end;
$$;
drop trigger if exists patient_terms_version on public.patient_terms;
create trigger patient_terms_version before insert or update on public.patient_terms
  for each row execute function public.patient_terms_version();

alter table public.patient_terms enable row level security;
create policy pt_self_read  on public.patient_terms for select to authenticated using (patient_id = auth.uid());
create policy pt_therapist  on public.patient_terms for all    to authenticated using (public.is_therapist()) with check (public.is_therapist());

-- O aceite guarda uma cópia exata das condições aceitas (feita pelo servidor, não pelo navegador)
alter table public.consents add column if not exists terms jsonb;

create or replace function public.consents_fill()
returns trigger language plpgsql security definer set search_path = public as $$
declare t public.patient_terms;
begin
  new.accepted_at := now();
  select * into t from public.patient_terms where patient_id = new.patient_id;
  if not found then
    raise exception 'As condições deste paciente ainda não foram definidas.';
  end if;
  new.version := t.version;
  new.terms := to_jsonb(t) - 'patient_id';
  return new;
end;
$$;
drop trigger if exists consents_time on public.consents;
drop trigger if exists consents_fill on public.consents;
create trigger consents_fill before insert on public.consents
  for each row execute function public.consents_fill();

-- Faz o Supabase reconhecer as tabelas novas na hora
notify pgrst, 'reload schema';

-- ---------- Inativar paciente (também em migracao-06-inativar-paciente.sql) ----------
alter table public.profiles add column if not exists active boolean not null default true;
alter table public.profiles add column if not exists deactivated_at timestamptz;

-- A pessoa logada está ativa?
create or replace function public.is_active()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select active from public.profiles where id = auth.uid()), false);
$$;

-- Regras do paciente passam a exigir cadastro ativo
drop policy if exists unlocks_self_read on public.phase_unlocks;
create policy unlocks_self_read on public.phase_unlocks for select to authenticated using (patient_id = auth.uid() and public.is_active());

drop policy if exists sessions_self_read on public.sessions;
create policy sessions_self_read on public.sessions for select to authenticated using (patient_id = auth.uid() and public.is_active());

drop policy if exists materials_self_read on public.session_materials;
create policy materials_self_read on public.session_materials for select to authenticated
  using (public.is_active() and exists (select 1 from public.sessions s where s.id = session_id and s.patient_id = auth.uid()));

drop policy if exists diary_self on public.diary_entries;
create policy diary_self on public.diary_entries for all to authenticated
  using (patient_id = auth.uid() and public.is_active()) with check (patient_id = auth.uid() and public.is_active());

drop policy if exists tasks_self_read on public.tasks;
drop policy if exists tasks_self_update on public.tasks;
create policy tasks_self_read   on public.tasks for select to authenticated using (patient_id = auth.uid() and public.is_active());
create policy tasks_self_update on public.tasks for update to authenticated using (patient_id = auth.uid() and public.is_active()) with check (patient_id = auth.uid() and public.is_active());

drop policy if exists goals_self_read on public.goals;
drop policy if exists goals_self_update on public.goals;
create policy goals_self_read   on public.goals for select to authenticated using (patient_id = auth.uid() and public.is_active());
create policy goals_self_update on public.goals for update to authenticated using (patient_id = auth.uid() and public.is_active()) with check (patient_id = auth.uid() and public.is_active());

drop policy if exists cp_self_read on public.content_patients;
create policy cp_self_read on public.content_patients for select to authenticated using (patient_id = auth.uid() and public.is_active());

drop policy if exists pt_self_read on public.patient_terms;
create policy pt_self_read on public.patient_terms for select to authenticated using (patient_id = auth.uid() and public.is_active());

drop policy if exists consents_self_insert on public.consents;
drop policy if exists consents_self_read on public.consents;
create policy consents_self_insert on public.consents for insert to authenticated with check (patient_id = auth.uid() and public.is_active());
create policy consents_self_read   on public.consents for select to authenticated using (patient_id = auth.uid() and public.is_active());

-- Conteúdos e arquivos da biblioteca
create or replace function public.content_visible(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active() and exists (
    select 1 from public.contents c
    where c.id = cid and (
      (c.audience = 'phase' and public.phase_unlocked(c.phase_id))
      or (c.audience = 'selected'
          and exists (select 1 from public.content_patients cp where cp.content_id = c.id and cp.patient_id = auth.uid())
          and (not c.respect_phase or public.phase_unlocked(c.phase_id)))
    )
  );
$$;

drop policy if exists materiais_read on storage.objects;
create policy materiais_read on storage.objects for select to authenticated using (
  bucket_id = 'materiais' and (
    public.is_therapist()
    or ((storage.foldername(name))[1] = auth.uid()::text and public.is_active())
    or ((storage.foldername(name))[1] = 'conteudos' and public.content_file_visible(name))
  )
);

-- Faz o Supabase reconhecer as mudanças na hora
notify pgrst, 'reload schema';

-- ---------- Roda da Vida (também em migracao-07-roda-da-vida.sql) ----------
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

-- ---------- Selo Novo (também em migracao-08-selo-novo.sql) ----------
create table if not exists public.item_views (
  patient_id  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  kind        text not null check (kind in ('content', 'session')),
  item_id     uuid not null,
  viewed_at   timestamptz not null default now(),
  primary key (patient_id, kind, item_id)
);

alter table public.item_views enable row level security;
create policy views_self_insert on public.item_views for insert to authenticated with check (patient_id = auth.uid() and public.is_active());
create policy views_self_read   on public.item_views for select to authenticated using (patient_id = auth.uid() and public.is_active());
create policy views_therapist   on public.item_views for select to authenticated using (public.is_therapist());

-- Faz o Supabase reconhecer a tabela nova na hora
notify pgrst, 'reload schema';
