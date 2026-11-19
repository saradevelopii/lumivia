-- Lumivia · migração 13 — registro do diário sobre ontem (só 1 dia para trás)
-- created_at passa a ser "o dia a que o registro se refere" (é ele que conta nas métricas, nos meses e nos filtros);
-- written_at guarda quando o paciente realmente escreveu. Quem define as datas é o servidor, nunca o app.

alter table public.diary_entries add column if not exists written_at timestamptz;
alter table public.diary_entries add column if not exists backdated boolean not null default false;
update public.diary_entries set written_at = created_at where written_at is null;
alter table public.diary_entries alter column written_at set default now();
alter table public.diary_entries alter column written_at set not null;

create or replace function public.diary_dates() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.written_at := now();
    if new.backdated then
      -- fim do dia de ontem, no horário de Brasília (fica por último entre os registros de ontem)
      new.created_at := (((now() at time zone 'America/Sao_Paulo')::date - 1) + time '23:59:59') at time zone 'America/Sao_Paulo';
    else
      new.created_at := now();
    end if;
  else
    new.created_at := old.created_at;
    new.written_at := old.written_at;
    new.backdated := old.backdated;
  end if;
  return new;
end $$;
drop trigger if exists diary_dates on public.diary_entries;
create trigger diary_dates before insert or update on public.diary_entries
  for each row execute function public.diary_dates();

notify pgrst, 'reload schema';
