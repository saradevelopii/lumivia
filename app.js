/* Lumivia — área do paciente e painel da terapeuta.
   Site estático (GitHub Pages) + Supabase (login, banco e arquivos). */
(function () {
  'use strict';

  const cfg = window.CONFIG || {};
  const APP = cfg.APP_NAME || 'Lumivia';
  document.title = APP;

  const $app = document.getElementById('app');
  const MOODS = ['Difícil', 'Baixo', 'Ok', 'Bem', 'Ótimo'];
  const KINDS = { video: 'Vídeo', texto: 'Texto', exercicio: 'Exercício', audio: 'Áudio', pdf: 'PDF', link: 'Link' };
  const BUCKET = 'materiais';
  const DAY = 864e5;

  if (!cfg.SUPABASE_URL || /SEU-PROJETO/.test(cfg.SUPABASE_URL) || !window.supabase) {
    $app.innerHTML = '<main class="login"><h1>Quase lá</h1><p class="lead">Preencha o arquivo <strong>config.js</strong> com a URL e a chave do seu projeto Supabase (veja o README).</p></main>';
    return;
  }
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  let me = null;
  let recovering = false;

  /* ================= utilidades ================= */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toDate = (d) => (d instanceof Date ? d : new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d + 'T12:00:00' : d));
  const fmtDate = (d) => toDate(d).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
  const fmtFull = (d) => toDate(d).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const safeUrl = (u) => (/^https?:\/\//i.test((u || '').trim()) ? u.trim() : '');
  const cleanName = (n) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-80);
  const initials = (n) => (n || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  const firstName = (n) => (n || '').trim().split(/\s+/)[0] || '';
  const $ = (sel) => $app.querySelector(sel);
  const $$ = (sel) => Array.from($app.querySelectorAll(sel));
  const go = (h) => { if (location.hash === h) route(); else location.hash = h; };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  function toast(msg, isError) {
    const t = document.createElement('div');
    t.className = 'toast' + (isError ? ' err' : '');
    t.setAttribute('role', isError ? 'alert' : 'status');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3800);
  }

  function traduzErro(m) {
    m = m || '';
    if (/Invalid login/i.test(m)) return 'E-mail ou senha incorretos.';
    if (/row-level security|permission denied/i.test(m)) return 'Você não tem permissão para isso.';
    if (/rate limit/i.test(m)) return 'Muitas tentativas. Aguarde alguns minutos.';
    if (/Password should be|at least 6/i.test(m)) return 'A senha precisa ter pelo menos 6 caracteres.';
    if (/JWT|expired/i.test(m)) return 'Sua sessão expirou. Entre novamente.';
    if (/exceeded the maximum allowed size|Payload too large/i.test(m)) return 'Arquivo grande demais (máximo 50 MB).';
    return m || 'Algo deu errado. Tente de novo.';
  }

  async function q(p) {
    const { data, error } = await p;
    if (error) { toast(traduzErro(error.message), true); throw error; }
    return data;
  }

  async function signedUrls(paths) {
    const list = Array.from(new Set(paths.filter(Boolean)));
    if (!list.length) return {};
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(list, 3600);
    if (error || !data) return {};
    const map = {};
    data.forEach((d) => { if (d.signedUrl && d.path) map[d.path] = d.signedUrl; });
    return map;
  }

  /* ---------- fotos de perfil ---------- */
  const AVATARS = 'avatars';
  async function avatarUrls(paths) {
    const list = Array.from(new Set(paths.filter(Boolean)));
    if (!list.length) return {};
    const { data } = await sb.storage.from(AVATARS).createSignedUrls(list, 3600);
    const map = {};
    (data || []).forEach((d) => { if (d.signedUrl && d.path) map[d.path] = d.signedUrl; });
    return map;
  }
  function avatarHtml(p, urls, extraCls, href, label) {
    const url = p && p.avatar_path ? urls[p.avatar_path] : '';
    const inner = url ? `<img src="${esc(url)}" alt="">` : esc(initials(p && p.full_name));
    const cls = 'avatar' + (extraCls ? ' ' + extraCls : '');
    return href ? `<a class="${cls}" href="${href}" aria-label="${esc(label)}">${inner}</a>` : `<span class="${cls}" aria-hidden="true">${inner}</span>`;
  }
  async function toSquareJpeg(file, size) {
    let img;
    try { img = await createImageBitmap(file); }
    catch (e) { toast('Não foi possível abrir essa imagem. Use uma foto JPG ou PNG.', true); throw e; }
    const s = Math.min(img.width, img.height);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
    return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
  }
  async function changeAvatar(target, file, oldPath) {
    const blob = await toSquareJpeg(file, 400);
    const path = `${target}/${uuid()}.jpg`;
    const { error } = await sb.storage.from(AVATARS).upload(path, blob, { contentType: 'image/jpeg' });
    if (error) { toast(traduzErro(error.message), true); throw error; }
    await q(sb.rpc('set_avatar', { target, path }));
    if (oldPath) await sb.storage.from(AVATARS).remove([oldPath]);
  }
  async function removeAvatar(target, oldPath) {
    await q(sb.rpc('set_avatar', { target, path: null }));
    if (oldPath) await sb.storage.from(AVATARS).remove([oldPath]);
  }
  const photoControls = (id, hasPhoto) => `<div class="photo-actions">
      <label class="btn ghost sm" for="${id}">${hasPhoto ? 'Trocar foto' : 'Adicionar foto'}</label>
      <input id="${id}" type="file" accept="image/*" class="sr">
      ${hasPhoto ? `<button type="button" class="btn-link" data-rmphoto="${id}">Remover foto</button>` : ''}</div>`;
  function bindPhoto(id, target, oldPath, after) {
    const input = $('#' + id);
    if (input) input.addEventListener('change', async () => {
      const f = input.files[0];
      if (!f) return;
      if (f.size > 15 * 1024 * 1024) return toast('Foto grande demais (máximo 15 MB).', true);
      toast('Enviando foto…');
      try { await changeAvatar(target, f, oldPath); toast('Foto atualizada.'); after(); } catch (e) { /* toast */ }
    });
    const rm = $(`[data-rmphoto="${id}"]`);
    if (rm) rm.addEventListener('click', async () => {
      if (!confirm('Remover a foto de perfil?')) return;
      try { await removeAvatar(target, oldPath); after(); } catch (e) { /* toast */ }
    });
  }

  async function upload(path, file) {
    const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (error) { toast(traduzErro(error.message), true); throw error; }
    return path;
  }

  /* ================= ícones ================= */
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    book: '<path d="M4 19.5V5a2 2 0 0 1 2-2h14v15H6.5A2.5 2.5 0 0 0 4 20.5"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    play: '<path d="M8 5v14l11-7z"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
    audio: '<path d="M3 14v-2a9 9 0 0 1 18 0v2"/><path d="M3 14h4v6H3zM17 14h4v6h-4z"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    leaf: '<path d="M12 21c-4-3-7-6.5-7-10a4.5 4.5 0 0 1 7-3.7A4.5 4.5 0 0 1 19 11c0 3.5-3 7-7 10z"/><path d="M12 7.3V21"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>'
  };
  const icon = (n, size) => `<svg width="${size || 22}" height="${size || 22}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;
  const kindIcon = (k) => ({ video: 'play', audio: 'audio', pdf: 'file', link: 'link', exercicio: 'pen', texto: 'book' }[k] || 'book');

  /* ================= estrutura ================= */
  function shell(content, active) {
    const nav = me.role === 'therapist'
      ? [['pacientes', 'Pacientes', 'users'], ['biblioteca', 'Biblioteca', 'book'], ['conta', 'Conta', 'user']]
      : [['inicio', 'Início', 'home'], ['conteudos', 'Conteúdos', 'book'], ['diario', 'Diário', 'pen'], ['sessoes', 'Sessões', 'cal']];
    $app.innerHTML = `<main class="page">${content}</main>
      <nav class="nav" aria-label="Navegação principal"><div class="nav-in" style="--n:${nav.length}">${nav.map(([r, l, i]) =>
        `<a href="#/${r}"${active === r ? ' aria-current="page"' : ''}>${icon(i)}<span>${l}</span></a>`).join('')}</div></nav>`;
    window.scrollTo(0, 0);
  }
  const loading = () => { $app.innerHTML = '<div class="loading" role="status">Carregando…</div>'; };
  const header = (title, sub, extra) => `<header class="hd"><div><h1>${esc(title)}</h1>${sub ? `<p class="muted">${esc(sub)}</p>` : ''}</div>${extra || ''}</header>`;
  const darkHeader = (kicker, title, sub, back, extra) => `<header class="hd-dark">${back ? `<a class="back" href="${back[0]}">${icon('back', 18)}${esc(back[1])}</a>` : `<span class="kicker">${esc(kicker)}</span>`}
      <h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}${extra || ''}</header>`;
  const field = (id, label, input) => `<div class="field"><label for="${id}">${label}</label>${input}</div>`;
  const entryCard = (e, isNew) => `<article class="entry${isNew ? ' new' : ''}"><p class="kicker-s">${esc(fmtDate(e.created_at))}${e.mood != null ? ' · Humor: ' + MOODS[e.mood] : ''}${isNew ? ' · novo' : ''}</p>${e.reflection ? `<p class="prose">${esc(e.reflection)}</p>` : ''}</article>`;

  function bindChecks(attr, table) {
    $$(`[${attr}]`).forEach((cb) => cb.addEventListener('change', async () => {
      cb.disabled = true;
      try { await q(sb.from(table).update({ done: cb.checked }).eq('id', cb.getAttribute(attr))); }
      catch (e) { cb.checked = !cb.checked; }
      cb.disabled = false;
    }));
  }

  /* ================= autenticação ================= */
  async function loadMe() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { me = null; return; }
    const { data } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    me = data || null;
    if (!me) toast('Perfil não encontrado. Fale com sua terapeuta.', true);
  }

  function viewLogin() {
    $app.innerHTML = `<main class="login">
      <div class="brand">${icon('leaf', 28)}</div>
      ${cfg.CLINIC_NAME ? `<p class="muted small">${esc(cfg.CLINIC_NAME)}</p>` : ''}
      <h1>${esc(APP)}</h1>
      <p class="lead">Acompanhe sua jornada, acesse os conteúdos liberados para você e registre suas reflexões entre as sessões.</p>
      <form id="f" class="stack" novalidate>
        ${field('email', 'E-mail', '<input id="email" type="email" autocomplete="email" required>')}
        ${field('senha', 'Senha', '<input id="senha" type="password" autocomplete="current-password" required>')}
        <button class="btn" type="submit">Entrar</button>
        <button class="btn-link" type="button" id="esqueci">Esqueci minha senha</button>
      </form>
      <p class="note">${icon('lock', 18)}<span>O acesso é pessoal e criado pela sua terapeuta. Suas informações ficam visíveis só para você e para ela.</span></p>
    </main>`;
    $('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = $('#email').value.trim();
      const password = $('#senha').value;
      if (!email || !password) return toast('Preencha e-mail e senha.', true);
      const btn = $('#f button[type=submit]');
      btn.disabled = true;
      try {
        await q(sb.auth.signInWithPassword({ email, password }));
        await loadMe();
        if (me) go('#/'); else { await sb.auth.signOut(); btn.disabled = false; }
      } catch (err) { btn.disabled = false; }
    });
    $('#esqueci').addEventListener('click', async () => {
      const email = $('#email').value.trim();
      if (!email) return toast('Digite seu e-mail acima primeiro.', true);
      try {
        await q(sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }));
        toast('Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha.');
      } catch (err) { /* toast já exibido */ }
    });
  }

  async function viewAccount() {
    loading();
    const urls = await avatarUrls([me.avatar_path]);
    const isT = me.role === 'therapist';
    shell(`${header('Conta', me.email)}
      ${recovering ? '<section class="card"><p><strong>Crie sua nova senha abaixo.</strong></p></section>' : ''}
      <section class="card">
        <h2>Seu perfil</h2>
        <div class="profile-row">${avatarHtml(me, urls, 'lg')}${photoControls('myphoto', !!me.avatar_path)}</div>
        ${isT
          ? `<form id="myname" class="inline"><label class="sr" for="mname">Seu nome</label>
              <input id="mname" type="text" value="${esc(me.full_name || '')}" placeholder="Seu nome" required><button class="btn sm" type="submit">Salvar nome</button></form>`
          : `<p><strong>${esc(me.full_name || '—')}</strong></p><p class="muted small">Para corrigir seu nome, fale com sua terapeuta.</p>`}
      </section>
      <section class="card">
        <form id="pw" class="stack">
          <h2>Alterar senha</h2>
          ${field('np', 'Nova senha (mínimo 6 caracteres)', '<input id="np" type="password" minlength="6" autocomplete="new-password" required>')}
          ${field('np2', 'Repita a nova senha', '<input id="np2" type="password" minlength="6" autocomplete="new-password" required>')}
          <button class="btn" type="submit">Salvar nova senha</button>
        </form>
      </section>
      <button class="btn danger" id="sair" type="button">Sair</button>`, 'conta');
    $('#pw').addEventListener('submit', async (e) => {
      e.preventDefault();
      const a = $('#np').value, b = $('#np2').value;
      if (a !== b) return toast('As senhas não são iguais.', true);
      try {
        await q(sb.auth.updateUser({ password: a }));
        recovering = false;
        toast('Senha atualizada.');
        e.target.reset();
      } catch (err) { /* toast já exibido */ }
    });
    $('#sair').addEventListener('click', () => sb.auth.signOut());
    bindPhoto('myphoto', me.id, me.avatar_path, async () => { await loadMe(); viewAccount(); });
    if ($('#myname')) $('#myname').addEventListener('submit', async (e) => {
      e.preventDefault();
      const full_name = $('#mname').value.trim();
      if (!full_name) return;
      try { await q(sb.from('profiles').update({ full_name }).eq('id', me.id)); await loadMe(); toast('Nome salvo.'); } catch (err) { /* toast */ }
    });
  }

  /* ================= PACIENTE ================= */
  async function viewHome() {
    loading();
    const since = new Date(Date.now() - 42 * DAY).toISOString();
    const [phases, unlocks, goals, diary, latest, therapists] = await Promise.all([
      q(sb.from('phases').select('*').order('position')),
      q(sb.from('phase_unlocks').select('phase_id').eq('patient_id', me.id)),
      q(sb.from('goals').select('*').eq('patient_id', me.id).order('created_at')),
      q(sb.from('diary_entries').select('mood,created_at').eq('patient_id', me.id).gte('created_at', since)),
      q(sb.from('contents').select('id,title,kind').order('created_at', { ascending: false }).limit(1)),
      q(sb.from('profiles').select('id,full_name,avatar_path').eq('role', 'therapist').limit(1))
    ]);
    const ther = therapists[0];
    const urls = await avatarUrls([me.avatar_path, ther && ther.avatar_path]);
    const unlocked = new Set(unlocks.map((u) => u.phase_id));
    const opened = phases.filter((p) => unlocked.has(p.id));
    const current = opened[opened.length - 1];
    const pct = phases.length ? Math.round((opened.length / phases.length) * 100) : 0;

    const weeks = Array.from({ length: 6 }, () => []);
    diary.forEach((d) => {
      if (d.mood == null) return;
      const w = Math.floor((Date.now() - new Date(d.created_at)) / (7 * DAY));
      if (w >= 0 && w < 6) weeks[5 - w].push(d.mood);
    });
    const bars = weeks.map((w, i) => {
      const avg = w.length ? w.reduce((a, b) => a + b, 0) / w.length : null;
      const h = avg == null ? 6 : Math.round(((avg + 1) / 5) * 100);
      const label = avg == null ? 'sem registros' : 'média ' + MOODS[Math.round(avg)];
      return `<div class="bar"><div class="bar-track"><div class="bar-fill${i === 5 ? ' now' : ''}${avg == null ? ' empty' : ''}" style="height:${h}%" title="${label}"></div></div><span>${i === 5 ? 'Agora' : '-' + (5 - i) + 's'}</span></div>`;
    }).join('');
    const chartLabel = weeks.map((w, i) => (w.length ? `semana ${i + 1}: ${MOODS[Math.round(w.reduce((a, b) => a + b, 0) / w.length)]}` : `semana ${i + 1}: sem registros`)).join(', ');

    shell(`<header class="hd"><div><p class="muted small cap">${esc(fmtFull(new Date()))}</p><h1>Olá, ${esc(firstName(me.full_name))}</h1></div>
        ${avatarHtml(me, urls, '', '#/conta', 'Minha conta')}</header>
      <section class="journey">
        <div class="row-between"><span class="kicker">Sua jornada</span><span class="kicker">${current ? `Fase ${current.position} de ${phases.length}` : ''}</span></div>
        <h2>${esc(current ? current.name : 'Sua jornada vai começar em breve')}</h2>
        <div class="progress" role="progressbar" aria-label="Progresso na jornada" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div style="width:${pct}%"></div></div>
        <ol class="phases">${phases.map((p) => `<li class="${current && p.id === current.id ? 'on' : ''}">${esc(p.name)}</li>`).join('')}</ol>
      </section>
      <section class="card">
        <h2>Bem-estar nas últimas semanas</h2>
        <div class="bars" role="img" aria-label="${esc(chartLabel)}">${bars}</div>
        <p class="muted small">Calculado a partir do humor que você registra no diário.</p>
      </section>
      <section class="card">
        <h2>Metas combinadas</h2>
        ${goals.length ? `<ul class="checks">${goals.map((g) => `<li><label><input type="checkbox" data-goal="${g.id}"${g.done ? ' checked' : ''}><span>${esc(g.title)}</span></label></li>`).join('')}</ul>`
          : '<p class="muted">Suas metas aparecerão aqui depois da sessão.</p>'}
      </section>
      ${latest[0] ? `<a class="highlight" href="#/conteudo/${latest[0].id}"><span class="hl-ico">${icon(kindIcon(latest[0].kind), 20)}</span>
        <span><span class="kicker-amber">CONTEÚDO MAIS RECENTE</span><strong>${esc(latest[0].title)}</strong></span></a>` : ''}
      ${ther ? `<section class="card profile-row">${avatarHtml(ther, urls)}<div><p class="muted small">Sua terapeuta</p><strong>${esc(ther.full_name || '')}</strong></div></section>` : ''}`, 'inicio');
    bindChecks('data-goal', 'goals');
  }

  async function viewContents() {
    loading();
    const [phases, unlocks, contents] = await Promise.all([
      q(sb.from('phases').select('*').order('position')),
      q(sb.from('phase_unlocks').select('phase_id').eq('patient_id', me.id)),
      q(sb.from('contents').select('id,phase_id,kind,title,duration,created_at').order('created_at'))
    ]);
    const unlocked = new Set(unlocks.map((u) => u.phase_id));
    const filters = [['todos', 'Todos'], ['video', 'Vídeos'], ['texto', 'Textos'], ['exercicio', 'Exercícios'], ['audio', 'Áudios'], ['pdf', 'PDFs']];
    const recent = Date.now() - 7 * DAY;
    let filter = 'todos';

    const itemHtml = (c) => `<a class="item" href="#/conteudo/${c.id}"><span class="thumb">${icon(kindIcon(c.kind))}</span>
      <span class="item-body">${new Date(c.created_at) > recent ? '<span class="badge">NOVO</span>' : ''}<strong>${esc(c.title)}</strong>
      <span class="muted small">${KINDS[c.kind] || ''}${c.duration ? ' · ' + esc(c.duration) : ''}</span></span></a>`;

    function list() {
      const open = phases.filter((p) => unlocked.has(p.id)).reverse();
      const locked = phases.filter((p) => !unlocked.has(p.id));
      let html = open.map((p) => {
        const items = contents.filter((c) => c.phase_id === p.id && (filter === 'todos' || c.kind === filter));
        return `<h2 class="sec">Fase ${p.position} · ${esc(p.name)}</h2>${items.length ? items.map(itemHtml).join('') : '<p class="muted small">Nada deste tipo nesta fase ainda.</p>'}`;
      }).join('');
      if (!open.length) html = '<p class="muted">Seus conteúdos aparecerão aqui quando forem liberados.</p>';
      if (locked.length) {
        html += '<h2 class="sec">Próximas fases</h2>' + locked.map((p) => `<div class="item locked"><span class="thumb">${icon('lock')}</span>
          <span class="item-body"><strong>${esc(p.name)}</strong><span class="muted small">Será liberada pela sua terapeuta</span></span></div>`).join('');
      }
      return html;
    }

    shell(`${header('Conteúdos', 'Liberados para você a cada etapa da jornada')}
      <div class="pills" role="group" aria-label="Filtrar por tipo">${filters.map(([k, l]) => `<button type="button" class="pill" data-f="${k}" aria-pressed="${k === filter}">${l}</button>`).join('')}</div>
      <div id="list" class="stack">${list()}</div>`, 'conteudos');
    $$('[data-f]').forEach((b) => b.addEventListener('click', () => {
      filter = b.dataset.f;
      $$('[data-f]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      $('#list').innerHTML = list();
    }));
  }

  async function viewContent(id) {
    loading();
    const c = await q(sb.from('contents').select('*').eq('id', id).maybeSingle());
    const backHref = me.role === 'therapist' ? '#/biblioteca' : '#/conteudos';
    const backLabel = me.role === 'therapist' ? 'Biblioteca' : 'Conteúdos';
    if (!c) {
      shell(`<a class="back-l" href="${backHref}">${icon('back', 18)}${backLabel}</a>${header('Conteúdo indisponível', 'Este conteúdo ainda não foi liberado para você.')}`, me.role === 'therapist' ? 'biblioteca' : 'conteudos');
      return;
    }
    const urls = await signedUrls([c.file_path]);
    const file = c.file_path ? urls[c.file_path] : '';
    const link = safeUrl(c.url);
    const yt = link && link.match(/(?:youtu\.be\/|[?&]v=|embed\/|shorts\/)([\w-]{11})/);
    let media = '';
    if (yt) media = `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${yt[1]}" title="${esc(c.title)}" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe></div>`;
    else if (file && c.kind === 'video') media = `<video controls preload="metadata" src="${esc(file)}"></video>`;
    else if (file && c.kind === 'audio') media = `<audio controls preload="metadata" src="${esc(file)}"></audio>`;
    const actions = [];
    if (file && !media) actions.push(`<a class="btn" href="${esc(file)}" target="_blank" rel="noopener">${icon('file', 20)}Abrir arquivo</a>`);
    if (link && !yt) actions.push(`<a class="btn ghost" href="${esc(link)}" target="_blank" rel="noopener">${icon('link', 20)}Abrir link</a>`);
    if (me.role === 'therapist') actions.push(`<a class="btn ghost" href="#/biblioteca/editar/${c.id}">${icon('pen', 20)}Editar conteúdo</a>`);

    shell(`<a class="back-l" href="${backHref}">${icon('back', 18)}${backLabel}</a>
      <header class="hd"><div><p class="muted small">${KINDS[c.kind] || ''}${c.duration ? ' · ' + esc(c.duration) : ''}</p><h1>${esc(c.title)}</h1></div></header>
      ${media}
      ${c.body ? `<section class="card"><p class="prose">${esc(c.body)}</p></section>` : ''}
      ${actions.join('')}`, me.role === 'therapist' ? 'biblioteca' : 'conteudos');
  }

  async function viewDiary() {
    loading();
    const [tasks, entries] = await Promise.all([
      q(sb.from('tasks').select('*').eq('patient_id', me.id).order('done').order('created_at', { ascending: false }).limit(20)),
      q(sb.from('diary_entries').select('*').eq('patient_id', me.id).order('created_at', { ascending: false }).limit(10))
    ]);
    let mood = null;
    const done = tasks.filter((t) => t.done).length;

    shell(`${header('Diário', 'Sua terapeuta lê antes da próxima sessão')}
      <form id="df" class="stack">
        <section class="card">
          <h2 id="mh">Como você está hoje?</h2>
          <div class="moods" role="group" aria-labelledby="mh">${MOODS.map((m, i) => `<button type="button" class="mood" data-mood="${i}" aria-pressed="false">${m}</button>`).join('')}</div>
        </section>
        <section class="card">
          <label for="ref" class="h2">Reflexão do dia</label>
          <textarea id="ref" rows="5" placeholder="O que você percebeu em si hoje?"></textarea>
        </section>
        <button class="btn" type="submit">Salvar registro</button>
      </form>
      <section class="card">
        <div class="row-between"><h2>Tarefas</h2><span class="muted small">${done} de ${tasks.length}</span></div>
        ${tasks.length ? `<ul class="checks">${tasks.map((t) => `<li><label><input type="checkbox" data-task="${t.id}"${t.done ? ' checked' : ''}><span>${esc(t.title)}</span></label></li>`).join('')}</ul>`
          : '<p class="muted">Nenhuma tarefa no momento.</p>'}
      </section>
      <h2 class="sec">Registros anteriores</h2>
      ${entries.length ? entries.map((e) => entryCard(e)).join('') : '<p class="muted">Seus registros aparecerão aqui.</p>'}`, 'diario');

    $$('[data-mood]').forEach((b) => b.addEventListener('click', () => {
      mood = Number(b.dataset.mood);
      $$('[data-mood]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }));
    $('#df').addEventListener('submit', async (e) => {
      e.preventDefault();
      const reflection = $('#ref').value.trim();
      if (mood == null && !reflection) return toast('Escolha como você está ou escreva uma reflexão.', true);
      const btn = $('#df button[type=submit]');
      btn.disabled = true;
      try {
        await q(sb.from('diary_entries').insert({ patient_id: me.id, mood, reflection: reflection || null }));
        toast('Registro salvo.');
        viewDiary();
      } catch (err) { btn.disabled = false; }
    });
    bindChecks('data-task', 'tasks');
  }

  function materialsHtml(mats, urls) {
    return mats.map((m) => {
      const href = m.file_path ? urls[m.file_path] : safeUrl(m.url);
      if (!href) return '';
      return `<a class="mat" href="${esc(href)}" target="_blank" rel="noopener">${icon(m.file_path ? 'file' : 'link', 20)}<span>${esc(m.title)}</span></a>`;
    }).join('');
  }

  async function viewSessions() {
    loading();
    const sessions = await q(sb.from('sessions').select('*').eq('patient_id', me.id).order('session_date', { ascending: false }).order('created_at', { ascending: false }));
    const ids = sessions.map((s) => s.id);
    const mats = ids.length ? await q(sb.from('session_materials').select('*').in('session_id', ids).order('created_at')) : [];
    const urls = await signedUrls(mats.map((m) => m.file_path));
    const total = sessions.length;

    const body = (s) => `
      ${s.summary ? `<div class="stack" style="gap:4px"><h3 class="sub-h">Resumo da terapeuta</h3><p class="prose">${esc(s.summary)}</p></div>` : ''}
      ${s.weekly_task ? `<div class="stack" style="gap:4px"><h3 class="sub-h">Combinado para a semana</h3><p class="prose">${esc(s.weekly_task)}</p></div>` : ''}
      ${(() => { const h = materialsHtml(mats.filter((m) => m.session_id === s.id), urls); return h ? `<div class="stack" style="gap:8px"><h3 class="sub-h">Materiais da sessão</h3>${h}</div>` : ''; })()}`;

    shell(`${header('Sessões', 'O que foi trabalhado em cada encontro')}
      ${!total ? '<p class="muted">Depois de cada sessão, o resumo e os materiais aparecerão aqui.</p>' : ''}
      ${sessions.map((s, i) => i === 0
        ? `<section class="card"><span class="kicker-amber">ÚLTIMA SESSÃO</span><h2 style="font-family:Outfit,sans-serif;font-size:20px">Sessão ${total} · ${esc(fmtDate(s.session_date))}</h2>${body(s)}</section>
           ${total > 1 ? '<h2 class="sec">Anteriores</h2>' : ''}`
        : `<details class="card"><summary>Sessão ${total - i} · ${esc(fmtDate(s.session_date))}</summary>${body(s)}</details>`).join('')}`, 'sessoes');
  }

  /* ================= TERAPEUTA ================= */
  async function viewPatients() {
    loading();
    const since = new Date(Date.now() - 30 * DAY).toISOString();
    const [patients, unlocks, phases, diary, sessions] = await Promise.all([
      q(sb.from('profiles').select('*').eq('role', 'patient').order('full_name')),
      q(sb.from('phase_unlocks').select('patient_id,phase_id')),
      q(sb.from('phases').select('*').order('position')),
      q(sb.from('diary_entries').select('patient_id,created_at').gte('created_at', since).order('created_at', { ascending: false })),
      q(sb.from('sessions').select('patient_id,created_at').order('created_at', { ascending: false }).limit(2000))
    ]);
    const phaseById = Object.fromEntries(phases.map((p) => [p.id, p]));
    const lastDiary = {}, lastSession = {};
    diary.forEach((d) => { if (!lastDiary[d.patient_id]) lastDiary[d.patient_id] = d.created_at; });
    sessions.forEach((s) => { if (!lastSession[s.patient_id]) lastSession[s.patient_id] = s.created_at; });
    const currentPhase = (pid) => unlocks.filter((u) => u.patient_id === pid).map((u) => phaseById[u.phase_id]).filter(Boolean).sort((a, b) => b.position - a.position)[0];
    const hasNew = (pid) => lastDiary[pid] && (!lastSession[pid] || new Date(lastDiary[pid]) > new Date(lastSession[pid]));
    const weekDiaries = diary.filter((d) => new Date(d.created_at) > Date.now() - 7 * DAY).length;
    const urls = await avatarUrls(patients.map((p) => p.avatar_path));

    const row = (p) => {
      const ph = currentPhase(p.id);
      return `<a class="item" href="#/paciente/${p.id}" data-name="${esc((p.full_name || '').toLowerCase() + ' ' + (p.email || '').toLowerCase())}">
        ${avatarHtml(p, urls)}
        <span class="item-body"><strong>${esc(p.full_name || p.email)}</strong><span class="muted small">${ph ? `Fase ${ph.position} · ${esc(ph.name)}` : 'Nenhuma fase liberada'}</span></span>
        ${hasNew(p.id) ? '<span class="badge">Diário novo</span>' : ''}</a>`;
    };

    shell(`${darkHeader('Painel da terapeuta', 'Pacientes', '', null,
        `<div class="stats"><div><strong>${patients.length}</strong><span>ativos</span></div><div><strong>${patients.filter((p) => hasNew(p.id)).length}</strong><span>diários novos</span></div><div><strong>${weekDiaries}</strong><span>registros na semana</span></div></div>`)}
      ${field('busca', 'Buscar paciente', '<input id="busca" type="search" placeholder="Nome ou e-mail" autocomplete="off">')}
      <div id="plist" class="stack">${patients.length ? patients.map(row).join('') : '<p class="muted">Nenhum paciente ainda. Veja abaixo como convidar.</p>'}</div>
      <details class="card">
        <summary>+ Convidar novo paciente</summary>
        <ol class="stack" style="padding-left:20px;margin:0">
          <li>Abra o painel do Supabase › <strong>Authentication › Users › Add user › Create new user</strong>.</li>
          <li>Informe o e-mail do paciente e uma senha provisória e marque <strong>Auto Confirm User</strong>.</li>
          <li>Ele aparecerá aqui automaticamente, com a fase 1 já liberada. Abra a ficha para colocar o nome completo.</li>
          <li>Envie ao paciente o link deste site, o e-mail e a senha provisória. Ele troca a senha em <strong>Conta</strong>.</li>
        </ol>
      </details>`, 'pacientes');

    $('#busca').addEventListener('input', (e) => {
      const t = e.target.value.trim().toLowerCase();
      $$('#plist [data-name]').forEach((a) => { a.style.display = a.dataset.name.includes(t) ? '' : 'none'; });
    });
  }

  async function viewPatient(pid) {
    loading();
    const [p, phases, unlocks, goals, tasks, diary, sessions, countRes] = await Promise.all([
      q(sb.from('profiles').select('*').eq('id', pid).maybeSingle()),
      q(sb.from('phases').select('*').order('position')),
      q(sb.from('phase_unlocks').select('phase_id').eq('patient_id', pid)),
      q(sb.from('goals').select('*').eq('patient_id', pid).order('created_at')),
      q(sb.from('tasks').select('*').eq('patient_id', pid).order('done').order('created_at', { ascending: false }).limit(30)),
      q(sb.from('diary_entries').select('*').eq('patient_id', pid).order('created_at', { ascending: false }).limit(15)),
      q(sb.from('sessions').select('*').eq('patient_id', pid).order('session_date', { ascending: false }).order('created_at', { ascending: false }).limit(10)),
      sb.from('sessions').select('id', { count: 'exact', head: true }).eq('patient_id', pid)
    ]);
    if (!p) { go('#/pacientes'); return; }
    const notes = sessions.length ? await q(sb.from('session_private_notes').select('*').in('session_id', sessions.map((s) => s.id))) : [];
    const noteBy = Object.fromEntries(notes.map((n) => [n.session_id, n.notes]));
    const unlocked = new Set(unlocks.map((u) => u.phase_id));
    const total = countRes.count || sessions.length;
    const lastSessionAt = sessions[0] ? new Date(sessions[0].created_at) : null;
    const urls = await avatarUrls([p.avatar_path]);

    const listRows = (items, table, label) => `${items.length ? `<ul class="rows">${items.map((it) => `<li><span class="${it.done ? 'done' : ''}">${esc(it.title)}</span>
        <button type="button" class="icon-btn" data-del="${table}:${it.id}" aria-label="Remover ${label}: ${esc(it.title)}">${icon('trash', 18)}</button></li>`).join('')}</ul>` : `<p class="muted small">Nenhuma ${label} ainda.</p>`}
      <form class="inline" data-add="${table}"><label class="sr" for="add-${table}">Nova ${label}</label>
        <input id="add-${table}" type="text" placeholder="Nova ${label}" required><button class="btn sm" type="submit">Adicionar</button></form>`;

    shell(`${darkHeader('', p.full_name || p.email, `${total} ${total === 1 ? 'sessão registrada' : 'sessões registradas'} · ${p.email || ''}`, ['#/pacientes', 'Pacientes'])}
      <a class="btn" href="#/paciente/${pid}/nova-sessao">Registrar sessão</a>
      <section class="card">
        <h2>Perfil do paciente</h2>
        <div class="profile-row">${avatarHtml(p, urls, 'lg')}${photoControls('pphoto', !!p.avatar_path)}</div>
        <form id="nf" class="inline"><label class="sr" for="pname">Nome do paciente</label>
          <input id="pname" type="text" value="${esc(p.full_name || '')}" placeholder="Nome completo"><button class="btn sm ghost" type="submit">Salvar nome</button></form>
      </section>
      <section class="card" style="gap:4px">
        <h2 style="margin-bottom:6px">Fases da jornada</h2>
        ${phases.map((ph) => { const on = unlocked.has(ph.id); return `<div class="phase-row"><div><strong style="font-size:15px">${ph.position} · ${esc(ph.name)}</strong>
          <span class="muted small">${on ? 'Visível ao paciente' : 'Bloqueada'}</span></div>
          <button type="button" class="toggle" data-phase="${ph.id}" aria-pressed="${on}">${on ? 'Liberada' : 'Liberar'}</button></div>`; }).join('')}
      </section>
      <section class="card"><h2>Metas combinadas</h2>${listRows(goals, 'goals', 'meta')}</section>
      <section class="card"><div class="row-between"><h2>Tarefas</h2><span class="muted small">${tasks.filter((t) => t.done).length} de ${tasks.length} feitas</span></div>${listRows(tasks, 'tasks', 'tarefa')}</section>
      <h2 class="sec">Diário recente</h2>
      ${diary.length ? diary.map((e) => entryCard(e, !lastSessionAt || new Date(e.created_at) > lastSessionAt)).join('') : '<p class="muted">O paciente ainda não escreveu no diário.</p>'}
      <h2 class="sec">Sessões</h2>
      ${sessions.length ? sessions.map((s) => `<details class="card"><summary>${esc(fmtDate(s.session_date))}</summary>
          ${s.summary ? `<h3 class="sub-h">Resumo</h3><p class="prose">${esc(s.summary)}</p>` : ''}
          ${s.weekly_task ? `<h3 class="sub-h">Tarefa</h3><p class="prose">${esc(s.weekly_task)}</p>` : ''}
          ${noteBy[s.id] ? `<h3 class="sub-h">Notas privadas</h3><p class="prose">${esc(noteBy[s.id])}</p>` : ''}
          <button type="button" class="btn sm danger" data-del-session="${s.id}">Apagar sessão</button></details>`).join('')
        : '<p class="muted">Nenhuma sessão registrada.</p>'}`, 'pacientes');

    bindPhoto('pphoto', pid, p.avatar_path, () => viewPatient(pid));
    $('#nf').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await q(sb.from('profiles').update({ full_name: $('#pname').value.trim() || null }).eq('id', pid)); toast('Nome salvo.'); viewPatient(pid); } catch (err) { /* toast */ }
    });
    $$('[data-phase]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      const phase_id = Number(b.dataset.phase);
      try {
        if (b.getAttribute('aria-pressed') === 'true') {
          if (!confirm('Bloquear esta fase? O paciente deixará de ver os conteúdos dela.')) { b.disabled = false; return; }
          await q(sb.from('phase_unlocks').delete().eq('patient_id', pid).eq('phase_id', phase_id));
        } else {
          await q(sb.from('phase_unlocks').insert({ patient_id: pid, phase_id }));
        }
        viewPatient(pid);
      } catch (err) { b.disabled = false; }
    }));
    $$('[data-add]').forEach((f) => f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = f.querySelector('input').value.trim();
      if (!title) return;
      try { await q(sb.from(f.dataset.add).insert({ patient_id: pid, title })); viewPatient(pid); } catch (err) { /* toast */ }
    }));
    $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const [table, id] = b.dataset.del.split(':');
      try { await q(sb.from(table).delete().eq('id', id)); viewPatient(pid); } catch (err) { /* toast */ }
    }));
    $$('[data-del-session]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Apagar esta sessão e seus materiais? Isso não pode ser desfeito.')) return;
      const sid = b.dataset.delSession;
      try {
        const mats = await q(sb.from('session_materials').select('file_path').eq('session_id', sid));
        const paths = mats.map((m) => m.file_path).filter(Boolean);
        if (paths.length) await sb.storage.from(BUCKET).remove(paths);
        await q(sb.from('sessions').delete().eq('id', sid));
        toast('Sessão apagada.');
        viewPatient(pid);
      } catch (err) { /* toast */ }
    }));
  }

  async function viewNewSession(pid) {
    loading();
    const p = await q(sb.from('profiles').select('id,full_name,email').eq('id', pid).maybeSingle());
    if (!p) { go('#/pacientes'); return; }

    shell(`${darkHeader('', 'Registrar sessão', p.full_name || p.email, ['#/paciente/' + pid, 'Ficha do paciente'])}
      <form id="sf" class="stack">
        <section class="card">
          ${field('sdate', 'Data da sessão', `<input id="sdate" type="date" value="${today()}" required>`)}
          ${field('sum', 'Resumo para o paciente', '<textarea id="sum" rows="5" placeholder="Temas trabalhados, percepções, pontos de atenção"></textarea>')}
          ${field('task', 'Tarefa para a semana', '<input id="task" type="text" placeholder="Ex.: escrever uma carta para você daqui a 1 ano">')}
          <label class="check-line"><input type="checkbox" id="astask" checked> Adicionar também à lista de tarefas do paciente</label>
        </section>
        <fieldset class="card">
          <legend class="h2" style="padding:0;margin-bottom:4px">Materiais</legend>
          ${field('files', 'Arquivos (PDF, áudio, imagem · até 50 MB cada)', '<input id="files" type="file" multiple>')}
          <div id="links" class="stack"></div>
          <button type="button" class="btn ghost sm" id="addlink">+ Adicionar link ou vídeo do YouTube</button>
        </fieldset>
        <section class="card">
          ${field('notes', 'Notas privadas <span class="muted" style="font-weight:400">· só você vê</span>', '<textarea id="notes" rows="4" class="private"></textarea>')}
        </section>
        <button class="btn" type="submit">Liberar para o paciente</button>
      </form>`, 'pacientes');

    let n = 0;
    $('#addlink').addEventListener('click', () => {
      n += 1;
      const row = document.createElement('div');
      row.className = 'link-row';
      row.innerHTML = `<input type="text" aria-label="Título do link ${n}" placeholder="Título" data-lt>
        <input type="url" aria-label="Endereço do link ${n}" placeholder="https://…" data-lu>
        <button type="button" class="icon-btn" aria-label="Remover link ${n}">${icon('x', 18)}</button>`;
      row.querySelector('button').addEventListener('click', () => row.remove());
      $('#links').appendChild(row);
      row.querySelector('[data-lt]').focus();
    });

    $('#sf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#sf button[type=submit]');
      const summary = $('#sum').value.trim();
      const weekly_task = $('#task').value.trim();
      const notes = $('#notes').value.trim();
      const files = Array.from($('#files').files || []);
      const links = $$('.link-row').map((r) => ({ title: r.querySelector('[data-lt]').value.trim(), url: safeUrl(r.querySelector('[data-lu]').value) }));
      if (links.some((l) => !l.url && l.title)) return toast('Algum link está sem endereço válido (comece com https://).', true);
      const big = files.find((f) => f.size > 50 * 1024 * 1024);
      if (big) return toast(`"${big.name}" passa de 50 MB. Para vídeos, use o YouTube não listado.`, true);

      btn.disabled = true;
      btn.textContent = 'Salvando…';
      try {
        const s = await q(sb.from('sessions').insert({ patient_id: pid, session_date: $('#sdate').value || today(), summary: summary || null, weekly_task: weekly_task || null }).select().single());
        if (notes) await q(sb.from('session_private_notes').insert({ session_id: s.id, notes }));
        for (const f of files) {
          btn.textContent = `Enviando ${f.name}…`;
          const path = await upload(`${pid}/${uuid()}-${cleanName(f.name)}`, f);
          await q(sb.from('session_materials').insert({ session_id: s.id, title: f.name, file_path: path }));
        }
        for (const l of links.filter((x) => x.url)) {
          await q(sb.from('session_materials').insert({ session_id: s.id, title: l.title || l.url, url: l.url }));
        }
        if (weekly_task && $('#astask').checked) await q(sb.from('tasks').insert({ patient_id: pid, title: weekly_task }));
        toast('Sessão liberada para o paciente.');
        go('#/paciente/' + pid);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Liberar para o paciente';
      }
    });
  }

  /* --- formulário de conteúdo (novo e edição) --- */
  function contentFields(phases, c) {
    c = c || {};
    const sel = (a, b) => (String(a) === String(b) ? ' selected' : '');
    const fileName = c.file_path ? c.file_path.split('/').pop().replace(/^[0-9a-f-]{36}-/i, '') : '';
    return `
      ${field('cphase', 'Fase', `<select id="cphase">${phases.map((p) => `<option value="${p.id}"${sel(p.id, c.phase_id)}>${p.position} · ${esc(p.name)}</option>`).join('')}</select>`)}
      ${field('ckind', 'Tipo', `<select id="ckind">${Object.entries(KINDS).map(([k, l]) => `<option value="${k}"${sel(k, c.kind)}>${l}</option>`).join('')}</select>`)}
      ${field('ctitle', 'Título', `<input id="ctitle" type="text" value="${esc(c.title || '')}" required>`)}
      ${field('cdur', 'Duração (opcional)', `<input id="cdur" type="text" value="${esc(c.duration || '')}" placeholder="Ex.: 12 min">`)}
      ${field('cbody', 'Texto ou instruções (opcional)', `<textarea id="cbody" rows="8">${esc(c.body || '')}</textarea>`)}
      ${field('curl', 'Link (opcional) — YouTube, site, Google Drive…', `<input id="curl" type="url" value="${esc(c.url || '')}" placeholder="https://…">`)}
      ${c.file_path ? `<div class="mat">${icon('file', 20)}<span>Arquivo atual: ${esc(fileName)}</span></div>
        <label class="check-line"><input type="checkbox" id="cremove"> Remover o arquivo atual</label>` : ''}
      ${field('cfile', c.file_path ? 'Substituir por outro arquivo (opcional · até 50 MB)' : 'Arquivo (opcional · até 50 MB)', '<input id="cfile" type="file">')}`;
  }

  function readContentForm() {
    const title = $('#ctitle').value.trim();
    const rawUrl = $('#curl').value.trim();
    const url = safeUrl(rawUrl);
    const file = $('#cfile').files[0];
    if (!title) { toast('Dê um título ao conteúdo.', true); return null; }
    if (rawUrl && !url) { toast('O link precisa começar com https://', true); return null; }
    if (file && file.size > 50 * 1024 * 1024) { toast('Arquivo acima de 50 MB. Para vídeos, use o YouTube não listado.', true); return null; }
    const phase_id = Number($('#cphase').value);
    return {
      phase_id, file, remove: !!($('#cremove') && $('#cremove').checked),
      row: {
        phase_id, kind: $('#ckind').value, title,
        duration: $('#cdur').value.trim() || null,
        body: $('#cbody').value.trim() || null,
        url: url || null
      }
    };
  }

  async function viewEditContent(id) {
    loading();
    const [c, phases] = await Promise.all([
      q(sb.from('contents').select('*').eq('id', id).maybeSingle()),
      q(sb.from('phases').select('*').order('position'))
    ]);
    if (!c) { toast('Conteúdo não encontrado.', true); go('#/biblioteca'); return; }

    shell(`<a class="back-l" href="#/biblioteca">${icon('back', 18)}Biblioteca</a>
      ${header('Editar conteúdo', 'As mudanças aparecem na hora para os pacientes')}
      <form id="ef" class="card stack">
        ${contentFields(phases, c)}
        <button class="btn" type="submit">Salvar alterações</button>
        <a class="btn ghost" href="#/conteudo/${c.id}">Ver como o paciente vê</a>
      </form>`, 'biblioteca');

    $('#ef').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#ef button[type=submit]');
      const v = readContentForm();
      if (!v) return;
      btn.disabled = true;
      btn.textContent = v.file ? 'Enviando arquivo…' : 'Salvando…';
      try {
        let file_path = c.file_path;
        const old = c.file_path;
        if (v.file) {
          file_path = await upload(`conteudos/${v.phase_id}/${uuid()}-${cleanName(v.file.name)}`, v.file);
        } else if (v.remove) {
          file_path = null;
        } else if (old && Number(c.phase_id) !== v.phase_id) {
          // o arquivo acompanha a fase (as regras de acesso dependem da pasta)
          file_path = `conteudos/${v.phase_id}/${old.split('/').pop()}`;
          const { error } = await sb.storage.from(BUCKET).copy(old, file_path);
          if (error) { toast(traduzErro(error.message), true); throw error; }
        }
        await q(sb.from('contents').update({ ...v.row, file_path }).eq('id', c.id));
        if (old && old !== file_path) await sb.storage.from(BUCKET).remove([old]);
        toast('Conteúdo atualizado.');
        go('#/biblioteca');
      } catch (err) { btn.disabled = false; btn.textContent = 'Salvar alterações'; }
    });
  }

  async function viewLibrary() {
    loading();
    const [phases, contents] = await Promise.all([
      q(sb.from('phases').select('*').order('position')),
      q(sb.from('contents').select('*').order('created_at'))
    ]);

    shell(`${header('Biblioteca', 'Conteúdos de cada fase da jornada')}
      <details class="card" ${contents.length ? '' : 'open'}>
        <summary>+ Novo conteúdo</summary>
        <form id="cf" class="stack">
          ${contentFields(phases, null)}
          <button class="btn" type="submit">Adicionar à biblioteca</button>
        </form>
      </details>
      ${phases.map((p) => {
        const items = contents.filter((c) => c.phase_id === p.id);
        return `<div class="row-between" style="margin-top:6px"><h2 class="sec" style="margin:0">Fase ${p.position} · ${esc(p.name)}</h2>
            <button type="button" class="btn-link" data-rename="${p.id}" aria-label="Renomear fase ${esc(p.name)}">Renomear</button></div>
          ${items.length ? items.map((c) => `<div class="item"><a class="thumb" href="#/conteudo/${c.id}" aria-label="Ver ${esc(c.title)}">${icon(kindIcon(c.kind))}</a>
            <a class="item-body" href="#/conteudo/${c.id}" style="text-decoration:none;color:inherit"><strong>${esc(c.title)}</strong><span class="muted small">${KINDS[c.kind] || ''}${c.duration ? ' · ' + esc(c.duration) : ''}</span></a>
            <a class="icon-btn edit" href="#/biblioteca/editar/${c.id}" aria-label="Editar ${esc(c.title)}">${icon('pen', 18)}</a>
            <button type="button" class="icon-btn" data-delc="${c.id}" aria-label="Apagar ${esc(c.title)}">${icon('trash', 18)}</button></div>`).join('')
            : '<p class="muted small">Nenhum conteúdo nesta fase.</p>'}`;
      }).join('')}
      <form id="pf" class="card">
        <h2>Nova fase</h2>
        <div class="inline"><label class="sr" for="pnew">Nome da nova fase</label><input id="pnew" type="text" placeholder="Nome da fase" required><button class="btn sm" type="submit">Criar</button></div>
      </form>`, 'biblioteca');

    $('#cf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#cf button[type=submit]');
      const v = readContentForm();
      if (!v) return;
      btn.disabled = true;
      btn.textContent = v.file ? 'Enviando arquivo…' : 'Salvando…';
      try {
        const file_path = v.file ? await upload(`conteudos/${v.phase_id}/${uuid()}-${cleanName(v.file.name)}`, v.file) : null;
        await q(sb.from('contents').insert({ ...v.row, file_path }));
        toast('Conteúdo adicionado.');
        viewLibrary();
      } catch (err) { btn.disabled = false; btn.textContent = 'Adicionar à biblioteca'; }
    });
    $$('[data-delc]').forEach((b) => b.addEventListener('click', async () => {
      const c = contents.find((x) => x.id === b.dataset.delc);
      if (!c || !confirm(`Apagar "${c.title}"? Ele sumirá para todos os pacientes.`)) return;
      try {
        if (c.file_path) await sb.storage.from(BUCKET).remove([c.file_path]);
        await q(sb.from('contents').delete().eq('id', c.id));
        viewLibrary();
      } catch (err) { /* toast */ }
    }));
    $$('[data-rename]').forEach((b) => b.addEventListener('click', async () => {
      const ph = phases.find((x) => String(x.id) === b.dataset.rename);
      const name = prompt('Novo nome da fase:', ph ? ph.name : '');
      if (!name || !name.trim()) return;
      try { await q(sb.from('phases').update({ name: name.trim() }).eq('id', ph.id)); viewLibrary(); } catch (err) { /* toast */ }
    }));
    $('#pf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#pnew').value.trim();
      if (!name) return;
      const position = phases.reduce((m, p) => Math.max(m, p.position), 0) + 1;
      try { await q(sb.from('phases').insert({ position, name })); viewLibrary(); } catch (err) { /* toast */ }
    });
  }

  /* ================= rotas ================= */
  async function route() {
    const h = location.hash || '#/';
    if (!me) return viewLogin();
    let m;
    try {
      if (h === '#/conta') return await viewAccount();
      if ((m = h.match(/^#\/conteudo\/([\w-]+)$/))) return await viewContent(m[1]);
      if (me.role === 'therapist') {
        if ((m = h.match(/^#\/paciente\/([\w-]+)\/nova-sessao$/))) return await viewNewSession(m[1]);
        if ((m = h.match(/^#\/paciente\/([\w-]+)$/))) return await viewPatient(m[1]);
        if ((m = h.match(/^#\/biblioteca\/editar\/([\w-]+)$/))) return await viewEditContent(m[1]);
        if (h === '#/biblioteca') return await viewLibrary();
        return await viewPatients();
      }
      if (h === '#/conteudos') return await viewContents();
      if (h === '#/diario') return await viewDiary();
      if (h === '#/sessoes') return await viewSessions();
      return await viewHome();
    } catch (err) {
      console.error(err);
      if (/JWT|expired/i.test(err && err.message)) { await sb.auth.signOut(); return; }
      $app.innerHTML = `<main class="login"><h1>Não foi possível carregar</h1><p class="lead">Verifique sua conexão e tente de novo.</p><button class="btn" type="button" id="retry">Tentar de novo</button></main>`;
      document.getElementById('retry').addEventListener('click', route);
    }
  }

  sb.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') recovering = true;
    if (event === 'SIGNED_OUT') { me = null; recovering = false; if (location.hash !== '#/login') location.hash = '#/login'; else viewLogin(); }
  });
  window.addEventListener('hashchange', route);

  (async function boot() {
    const { data: { session } } = await sb.auth.getSession();
    if (session) await loadMe();
    if (/access_token|type=recovery|error_description/.test(location.hash)) {
      history.replaceState(null, '', location.pathname + (recovering && me ? '#/conta' : '#/'));
    }
    route();
  })();
})();
