-- =====================================================================
-- Lumivia — atualização 08: selo "Novo" (o que o paciente já viu)
-- Rode UMA vez no Supabase: SQL Editor > New query > cole tudo > Run
-- =====================================================================

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
