-- Lumivia · migração 14 — Novidades do app (a terapeuta publica; todos os pacientes ativos veem)

create table if not exists public.app_news (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(title) between 1 and 120),
  body         text check (char_length(body) <= 4000),
  video_url    text check (char_length(video_url) <= 500),
  published_at timestamptz not null default now()
);
alter table public.app_news enable row level security;
drop policy if exists news_therapist on public.app_news;
create policy news_therapist on public.app_news for all to authenticated
  using (public.is_therapist()) with check (public.is_therapist());
drop policy if exists news_read on public.app_news;
create policy news_read on public.app_news for select to authenticated using (public.is_active());

-- selo "Novo" também para as novidades
alter table public.item_views drop constraint if exists item_views_kind_check;
alter table public.item_views add constraint item_views_kind_check check (kind in ('content', 'session', 'exercise', 'exercise_result', 'news'));

-- primeiras novidades (você pode editar ou apagar pelo app)
insert into public.app_news (title, body, published_at)
select * from (values
  ('Sessões mais organizadas',
   E'Na tela de **Sessões**, o combinado para a semana agora pode ter mais de um objetivo. Eles aparecem em lista, e cada um vira uma tarefa no seu Diário.\n\nAs sessões também ficaram numeradas: a primeira é a Sessão 1, e a numeração é a mesma para você e para a sua terapeuta.',
   now() - interval '3 minutes'),
  ('Seu compromisso consigo mesmo ⛵',
   E'Agora o Lumivia tem um espaço para o seu compromisso com você mesmo.\n\nQuando a sua terapeuta liberar, ele aparece no **Início**. Leia com calma, escreva o seu primeiro passo, se quiser, e assuma. Depois, ele fica guardado para você reler sempre que precisar.',
   now() - interval '2 minutes'),
  ('Registrar sobre ontem no Diário',
   E'Não conseguiu escrever em algum dia? No dia seguinte, toque em **Ontem**, no topo do Diário, e conte como foi.\n\n- Vale só para o dia anterior\n- O registro aparece no dia certo e conta no seu bem-estar daquele dia\n- O melhor continua sendo escrever na hora, mas, se não der, ontem ainda vale 💚\n\nEssa novidade veio de uma sugestão. Obrigada!',
   now() - interval '1 minute')
) as v(title, body, published_at)
where not exists (select 1 from public.app_news);

notify pgrst, 'reload schema';
