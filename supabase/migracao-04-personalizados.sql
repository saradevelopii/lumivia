-- =====================================================================
-- Lumivia — atualização 04: conteúdos personalizados por paciente
-- Rode UMA vez no Supabase: SQL Editor > New query > cole tudo > Run
-- =====================================================================

-- Quem pode ver cada conteúdo:
--   'phase'    = todos os pacientes com a fase liberada (como antes)
--   'selected' = só os pacientes escolhidos
-- respect_phase: no modo 'selected', se true o conteúdo só aparece quando a fase do paciente estiver liberada
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

-- Faz o Supabase reconhecer as tabelas novas na hora
notify pgrst, 'reload schema';
