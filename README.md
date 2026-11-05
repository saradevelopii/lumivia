# Lumivia — Área do Paciente

Site para a terapeuta acompanhar os pacientes e liberar conteúdos. Custo zero:
**GitHub Pages** (site) + **Supabase** (login, banco de dados e arquivos) + **YouTube não listado** (vídeos).

## O que o sistema faz

**Paciente**
- **Início**: fase atual da jornada, progresso, gráfico de bem-estar das últimas 6 semanas (vem do diário) e metas combinadas.
- **Conteúdos**: vídeos, textos, exercícios, áudios e PDFs das fases liberadas. As próximas fases aparecem bloqueadas.
- **Diário**: humor do dia, reflexão escrita e tarefas para marcar como feitas.
- **Sessões**: resumo de cada sessão, o combinado da semana e os materiais anexados.
- **Conta**: trocar a senha e sair.

**Terapeuta**
- **Pacientes**: lista com a fase de cada um e um aviso de "diário novo".
- **Ficha do paciente**: liberar ou bloquear fases, metas, tarefas, leitura do diário e histórico de sessões com notas privadas.
- **Registrar sessão**: resumo, tarefa, arquivos, links e notas privadas que só você vê.
- **Biblioteca**: adicionar conteúdos a cada fase, renomear fases e criar novas.

---

## Passo a passo para publicar (cerca de 30 minutos)

### 1. Criar o banco no Supabase
1. Crie uma conta grátis em **supabase.com** e clique em **New project**.
   - Região: **South America (São Paulo)**.
   - Guarde a senha do banco num lugar seguro.
2. Abra **SQL Editor → New query**, cole todo o conteúdo de `supabase/schema.sql` e clique em **Run**.

### 2. Configurar o login
1. Em **Authentication → Sign In / Providers**, desative **Allow new users to sign up**.
   Assim, só você cria os acessos.
2. Em **Authentication → URL Configuration**, coloque em **Site URL** o endereço do site (passo 4), por exemplo:
   `https://seuusuario.github.io/lumivia/`

### 3. Criar a sua conta de terapeuta
1. Vá em **Authentication → Users → Add user → Create new user**.
   Informe seu e-mail e uma senha e marque **Auto Confirm User**.
2. No **SQL Editor**, rode este comando, trocando pelo seu e-mail:
   ```sql
   update public.profiles set role = 'therapist' where email = 'seu@email.com';
   ```

### 4. Publicar no GitHub Pages
1. Abra `config.js` e preencha os dados de **Project Settings → API** (ou **API Keys**):
   - `SUPABASE_URL`: a Project URL.
   - `SUPABASE_ANON_KEY`: a chave **anon public** ou **publishable**.
     Essa chave é feita para ficar no site. **Nunca** use a `service_role` / `secret`.
   - `APP_NAME`: o nome do sistema. `CLINIC_NAME` é opcional.
2. Crie um repositório **público** no GitHub (ex.: `lumivia`) e envie todos os arquivos desta pasta.
3. Em **Settings → Pages**, escolha **Deploy from a branch → main → / (root)** e salve.
4. Em 1 ou 2 minutos o site estará em `https://seuusuario.github.io/lumivia/`.

### 5. Adicionar um paciente
1. No Supabase, vá em **Authentication → Users → Add user → Create new user**.
   Informe o e-mail do paciente e uma senha provisória e marque **Auto Confirm User**.
2. Ele aparece em **Pacientes** já com a fase 1 liberada. Abra a ficha e coloque o nome completo.
3. Envie a ele o link do site, o e-mail e a senha provisória. Ele troca a senha em **Conta**.

---

## Dicas de uso
- **Vídeos**: suba no YouTube como **Não listado** e cole o link no conteúdo. O vídeo toca dentro do site e não ocupa espaço no Supabase.
- **Arquivos**: cada arquivo pode ter até 50 MB. O total do plano grátis é 1 GB, o que dá para muitos PDFs e áudios.
- **Fases**: renomeie ou crie fases na **Biblioteca**. Um conteúdo só aparece para o paciente quando a fase dele estiver liberada.
- **Notas privadas** ficam numa tabela separada, que o paciente não consegue ler, nem por acesso técnico.

## Limites do plano grátis
- **Pausa por inatividade**: o Supabase pausa o projeto se ficar **7 dias sem nenhum acesso**. Para voltar, entre no painel e clique em **Restore**.
- **Sem backup automático**: exporte os dados de vez em quando em **Table Editor → (tabela) → Export to CSV**, principalmente `diary_entries` e `sessions`.
- **E-mails** de "esqueci minha senha" têm limite de poucos envios por hora. Se o link não chegar, crie uma nova senha provisória para o paciente pelo painel (**Users → ⋯ → Reset password** ou recriando a senha).

## Segurança e LGPD
Diário e sessões são **dados de saúde**, que a LGPD trata como sensíveis. As regras de acesso estão no `schema.sql` e foram testadas:
- O paciente vê **só os próprios** dados e só os conteúdos das fases liberadas.
- O paciente não consegue liberar fases, mudar o próprio papel, ler notas privadas, escrever no diário de outra pessoa nem enviar arquivos.
- A terapeuta vê tudo, mas **não edita** o diário do paciente.

Recomendações:
- Peça ao paciente um **termo de consentimento** para o uso da plataforma e o armazenamento dos registros. Vale confirmar o texto com um profissional da área jurídica.
- Use uma senha forte e ative a verificação em duas etapas na sua conta do Supabase e do GitHub.

### Teste rápido antes de usar com pacientes reais
Crie dois pacientes de teste (A e B) e confira:
1. Entrando como **A**, você não vê nada de **B** (sessões, diário, tarefas).
2. Um conteúdo de fase bloqueada não aparece para **A**. Depois que você libera a fase, aparece.
3. As notas privadas de uma sessão de **A** não aparecem na tela de Sessões de **A**.
4. Abrir o link direto de um conteúdo bloqueado (`#/conteudo/<id>`) mostra "Conteúdo indisponível".

## Estrutura dos arquivos
```
index.html            página única do site
config.js             nome do sistema e dados do Supabase (edite aqui)
app.js                telas e lógica (paciente e terapeuta)
styles.css            visual
supabase/schema.sql   tabelas, regras de segurança e fases iniciais
```
