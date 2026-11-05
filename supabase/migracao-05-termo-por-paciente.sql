-- =====================================================================
-- Lumivia — atualização 05: termo (Acordos do processo) individual por paciente
-- Rode UMA vez no Supabase: SQL Editor > New query > cole tudo > Run
-- =====================================================================

-- Condições combinadas com cada paciente
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
