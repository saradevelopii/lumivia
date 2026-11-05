-- =====================================================================
-- Lumivia — atualização 06: inativar paciente (encerramento do acompanhamento)
-- Rode UMA vez no Supabase: SQL Editor > New query > cole tudo > Run
-- Nada é apagado: o paciente inativo só perde o acesso; a terapeuta pode reativar.
-- =====================================================================

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
