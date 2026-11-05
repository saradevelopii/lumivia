-- =====================================================================
-- Lumivia — atualização 02: fotos de perfil
-- Rode UMA vez no Supabase: SQL Editor > New query > cole tudo > Run
-- =====================================================================

-- Caminho da foto de cada pessoa
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
