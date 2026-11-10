-- Lumivia · migração 09 — tarefa ligada à sessão
-- A tarefa criada a partir de um registro de sessão passa a ficar ligada a ele:
-- se a sessão for apagada, a tarefa sai junto da lista do paciente.
alter table public.tasks add column if not exists session_id uuid references public.sessions(id) on delete cascade;
create index if not exists tasks_session_idx on public.tasks (session_id);

notify pgrst, 'reload schema';
