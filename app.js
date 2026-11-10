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
  // Acordos do processo: o texto-base é o mesmo para todos; as condições vêm da ficha de cada paciente.
  // Rótulos de aceites feitos antes do termo individual:
  const LEGACY_LABELS = { 'acordos-v1': 'novembro de 2026 (R$ 400,00 · tolerância de 15 min)' };
  const DAY = 864e5;

  if (!cfg.SUPABASE_URL || /SEU-PROJETO/.test(cfg.SUPABASE_URL) || !window.supabase) {
    $app.innerHTML = '<main class="login"><h1>Quase lá</h1><p class="lead">Preencha o arquivo <strong>config.js</strong> com a URL e a chave do seu projeto Supabase (veja o README).</p></main>';
    return;
  }
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  let me = null;
  let recovering = false;

  /* ================= instalar como app (PWA) ================= */
  let installEvt = null;
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = () => /android/i.test(navigator.userAgent);
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvt = e;
    document.querySelectorAll('[data-install-btn]').forEach((b) => { b.hidden = false; });
  });
  window.addEventListener('appinstalled', () => {
    installEvt = null;
    document.querySelectorAll('.install-card').forEach((c) => c.remove());
  });
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  function installCard(dismissable) {
    if (isStandalone()) return '';
    if (dismissable) { try { if (localStorage.getItem('lumivia-install-hide')) return ''; } catch (e) { /* sem armazenamento */ } }
    const how = isIOS()
      ? 'No iPhone, abra pelo <strong>Safari</strong>, toque em <strong>Compartilhar</strong> (o quadrado com a seta para cima) e depois em <strong>Adicionar à Tela de Início</strong>.'
      : isAndroid()
        ? 'No Android, toque em <strong>Instalar app</strong> abaixo. Se o botão não aparecer, abra o menu <strong>⋮</strong> do Chrome e escolha <strong>Instalar app</strong> ou <strong>Adicionar à tela inicial</strong>.'
        : 'No computador, use o botão <strong>Instalar app</strong> abaixo ou o ícone de instalar na barra de endereço do Chrome ou do Edge.';
    return `<section class="card install-card">
        <div class="profile-row"><img src="icons/icon-192.png" alt="" width="48" height="48" class="install-ico"><div>
          <h2>Tenha o ${esc(APP)} no seu celular</h2>
          <p class="muted small">Um ícone na tela inicial para abrir com um toque, como um aplicativo.</p></div></div>
        <p class="small">${how}</p>
        <div class="row-btns">
          <button class="btn sm" type="button" data-install-btn${installEvt ? '' : ' hidden'}>Instalar app</button>
          ${dismissable ? '<button class="btn sm ghost" type="button" data-install-hide>Agora não</button>' : ''}
        </div>
      </section>`;
  }
  function bindInstall() {
    $app.querySelectorAll('[data-install-btn]').forEach((b) => b.addEventListener('click', async () => {
      if (!installEvt) return;
      installEvt.prompt();
      const r = await installEvt.userChoice;
      installEvt = null;
      if (r && r.outcome === 'accepted') $app.querySelectorAll('.install-card').forEach((c) => c.remove());
    }));
    $app.querySelectorAll('[data-install-hide]').forEach((b) => b.addEventListener('click', () => {
      try { localStorage.setItem('lumivia-install-hide', '1'); } catch (e) { /* sem armazenamento */ }
      b.closest('.install-card').remove();
    }));
  }

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

  /* Erros: os que a pessoa pode resolver viram uma mensagem amigável;
     os técnicos nunca aparecem crus. Ao carregar uma tela, mostram a tela de manutenção;
     depois de carregada, um aviso genérico (a terapeuta vê o detalhe técnico). */
  let loadingView = false;
  function friendlyError(m) {
    m = m || '';
    if (/Invalid login/i.test(m)) return 'E-mail ou senha incorretos.';
    if (/rate limit/i.test(m)) return 'Muitas tentativas. Aguarde alguns minutos.';
    if (/Password should be|at least 6/i.test(m)) return 'A senha precisa ter pelo menos 6 caracteres.';
    if (/same as the old|different from the old/i.test(m)) return 'A nova senha precisa ser diferente da atual.';
    if (/JWT|expired/i.test(m)) return 'Sua sessão expirou. Entre novamente.';
    if (/exceeded the maximum allowed size|Payload too large/i.test(m)) return 'Arquivo grande demais (máximo 50 MB).';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Sem conexão com a internet. Verifique e tente de novo.';
    return null;
  }
  function traduzErro(m) {
    return friendlyError(m) || (me && me.role === 'therapist'
      ? 'Algo deu errado. Detalhe técnico: ' + m
      : 'Não foi possível concluir agora. Tente novamente em instantes.');
  }
  async function q(p) {
    let res;
    try { res = await p; } catch (e) { res = { error: e }; }
    const { data, error } = res;
    if (error) {
      const f = friendlyError(error.message);
      if (f || !loadingView) toast(f || traduzErro(error.message), true);
      throw error;
    }
    return data;
  }

  function viewMaintenance(err) {
    const msg = (err && (err.message || String(err))) || '';
    const offline = !navigator.onLine || /Failed to fetch|NetworkError|Load failed/i.test(msg);
    console.error(err);
    $app.innerHTML = `<main class="login maint">
      <div class="brand">${icon('leaf', 28)}</div>
      <h1>${offline ? 'Sem conexão' : 'Estamos em manutenção'}</h1>
      <p class="lead">${offline
        ? 'Parece que você está sem internet. Verifique sua conexão e tente de novo.'
        : `Estamos fazendo alguns ajustes para deixar o ${esc(APP)} ainda melhor. Volte em alguns minutos — seus dados estão seguros.`}</p>
      <button class="btn" type="button" id="retry">Tentar de novo</button>
      ${me && me.role === 'therapist' && !offline ? `<details class="card"><summary>Detalhes técnicos (só você vê)</summary><p class="small prose">${esc(msg)}</p></details>` : ''}
      ${me ? '<button class="btn-link" type="button" id="maint-out">Sair</button>' : ''}
    </main>`;
    document.getElementById('retry').addEventListener('click', () => route());
    const out = document.getElementById('maint-out');
    if (out) out.addEventListener('click', () => sb.auth.signOut());
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

  /* ---------- termos: status e comprovante ---------- */
  const fmtStamp = (d) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
  function deviceName(ua) {
    ua = ua || '';
    const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Outro sistema';
    const br = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'navegador';
    return `${br} · ${os}`;
  }
  const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const monthYear = (d) => new Date(d).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const FREQ = {
    semanal: { label: 'Semanal', adj: 'semanal', incl: 'as sessões semanais do mês' },
    quinzenal: { label: 'Quinzenal', adj: 'quinzenal', incl: 'as sessões quinzenais do mês' },
    mensal: { label: 'Mensal', adj: 'mensal', incl: 'a sessão do mês' }
  };
  const FORMATS = { online: 'Online', presencial: 'Presencial', 'online e presencial': 'Online e presencial' };

  function termsLabel(t, legacyVersion) {
    if (!t) return LEGACY_LABELS[legacyVersion] || legacyVersion || '';
    return `${monthYear(t.versioned_at || t.updated_at || new Date())} (${brl(t.monthly_fee)} · tolerância de 15 min)`;
  }

  // Texto completo dos acordos com as condições do paciente
  function termsBody(t) {
    const f = FREQ[t.frequency] || FREQ.semanal;
    const fmt = t.format === 'online' ? 'online, por chamada de vídeo. O link é enviado antes de cada encontro.'
      : t.format === 'presencial' ? 'presencial, no consultório.'
      : 'online (por chamada de vídeo) ou presencial, conforme combinado para cada encontro.';
    return `
      <p>Que bom que você decidiu começar essa jornada. Este documento reúne os combinados que tornam o nosso trabalho mais claro, seguro e tranquilo para você e para mim.</p>
      <h3>1. Sobre o acompanhamento</h3>
      <p>O acompanhamento é um processo de desenvolvimento pessoal, voltado ao autoconhecimento, ao fortalecimento emocional e à construção de novos hábitos, organizado em fases.</p>
      <p>Este trabalho <strong>não substitui</strong> acompanhamento médico, psicológico ou psiquiátrico. Se você faz algum tratamento, mantenha-o normalmente e, se quiser, me conte para que eu possa considerar isso no nosso processo.</p>
      <h3>2. Sessões</h3>
      <ul>
        <li><strong>Formato:</strong> ${fmt}</li>
        <li><strong>Frequência e duração:</strong> ${f.adj}, com ${esc(t.duration_min)} minutos.</li>
        ${t.format !== 'presencial' ? '<li><strong>Ambiente:</strong> nas sessões online, escolha um lugar reservado e silencioso, de preferência com fone de ouvido, para que você possa falar com liberdade.</li>' : ''}
        <li><strong>Pontualidade:</strong> há uma tolerância de 15 minutos de atraso, para ambas as partes. Atrasos do(a) paciente não estendem o horário da sessão; se eu me atrasar, o tempo é reposto. Passados 15 minutos sem aviso, a sessão é considerada falta, ou remarcada sem custo quando o atraso for meu.</li>
      </ul>
      <h3>3. Remarcações, faltas e pagamento</h3>
      <ul>
        <li>Remarcações com <strong>pelo menos 24 horas de antecedência</strong> não têm custo.</li>
        <li>Cancelamentos com menos de 24 horas ou ausência sem aviso são considerados sessão realizada.</li>
        <li>Situações de emergência ou saúde são avaliadas com cuidado, caso a caso.</li>
        <li><strong>Valor mensal:</strong> ${brl(t.monthly_fee)}, incluindo ${f.incl}.</li>
        <li><strong>Pagamento:</strong> ${esc(t.payment_method)}, todo dia ${esc(t.payment_day)} de cada mês.</li>
      </ul>
      <h3>4. Sigilo</h3>
      <p>Tudo o que você compartilha nas sessões e na plataforma é <strong>confidencial</strong>. O sigilo só pode ser quebrado em situações de risco à sua vida ou à de outras pessoas, ou por determinação legal. Nesses casos, sempre que possível, conversaremos antes.</p>
      <h3>5. Plataforma ${esc(APP)}</h3>
      <ul>
        <li>Seu acesso é pessoal. Guarde sua senha e não a compartilhe.</li>
        <li>Os conteúdos (vídeos, textos, exercícios e áudios) são para o seu uso pessoal. Por favor, não os compartilhe nem os publique.</li>
        <li>Eu leio o seu diário antes de cada sessão. Ele <strong>não é acompanhado em tempo real</strong>.</li>
      </ul>
      <p class="terms-alert"><strong>A plataforma não é um canal de emergência.</strong> Em uma crise, ligue para o <strong>CVV — 188</strong> (24 horas, gratuito) ou para o <strong>SAMU — 192</strong>, ou vá ao pronto-socorro mais próximo.</p>
      <h3>6. Seus dados pessoais (LGPD)</h3>
      <p>Para o acompanhamento, são registrados seu nome, e-mail, foto de perfil (se você adicionar), registros do diário, tarefas e resumos das sessões. Esses dados são usados apenas para o seu processo, ficam guardados em um serviço com acesso restrito e não são compartilhados com terceiros.</p>
      <p>Você pode, a qualquer momento, pedir para ver, corrigir ou excluir seus dados, e também retirar este consentimento, conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018).</p>
      <h3>7. Encerramento</h3>
      <p>Você pode interromper o acompanhamento quando quiser. Se possível, avise com antecedência: uma sessão de encerramento ajuda a revisar o caminho percorrido e a planejar os próximos passos.</p>
      <h3>Termo de consentimento</h3>
      <p>Ao aceitar, declaro que li e compreendi os acordos acima, tive a oportunidade de esclarecer minhas dúvidas e concordo em participar do acompanhamento e em utilizar a plataforma ${esc(APP)}, autorizando o registro e o uso dos meus dados para essa finalidade.</p>`;
  }

  // Situação do termo: sem condições, pendente, condições alteradas ou aceito
  function termsState(t, cs) {
    if (!t) return { key: 'none', label: 'Não definido', cls: 'pending' };
    if (cs && cs.version === t.version) return { key: 'ok', label: 'Aceito', cls: 'ok' };
    if (cs) return { key: 'changed', label: 'Pendente', cls: 'pending' };
    return { key: 'pending', label: 'Pendente', cls: 'pending' };
  }

  function termsCard(t, cs, opt) {
    const s = termsState(t, cs);
    const isT = opt && opt.therapist;
    const meta = cs ? `<dl class="term-meta">
        <div><dt>Assinado como</dt><dd>${esc(cs.full_name)}</dd></div>
        <div><dt>Data e hora</dt><dd>${esc(fmtStamp(cs.accepted_at))}</dd></div>
        <div><dt>Dispositivo</dt><dd>${esc(deviceName(cs.user_agent))}</dd></div>
      </dl>` : '';
    let body = '';
    if (s.key === 'none') body = `<p class="muted small">${isT ? 'Defina as condições abaixo para o paciente poder ler e aceitar os acordos.' : 'Sua terapeuta ainda está preparando os seus acordos.'}</p>`;
    else if (s.key === 'pending') body = `<p class="muted small">${isT ? 'O paciente verá o pedido de aceite na tela de Início.' : 'Leia e aceite os acordos para concluir.'}</p>`;
    else if (s.key === 'changed') body = `<p class="consent-pending">As condições mudaram depois do último aceite (${esc(fmtDate(cs.accepted_at))}). ${isT ? 'O paciente precisa aceitar de novo.' : 'Leia e aceite a nova versão.'}</p>${meta}`;
    else body = meta;
    const actions = [];
    if (!isT && t) actions.push(`<a class="btn ${s.key === 'ok' ? 'ghost ' : ''}sm" href="#/acordos">${icon('file', 18)}${s.key === 'ok' ? 'Ler os acordos' : 'Ler e aceitar'}</a>`);
    if (isT && t) actions.push(`<a class="btn ghost sm" href="#/paciente/${opt.pid}/termo">${icon('file', 18)}Ver termo do paciente</a>`);
    if (cs) actions.push(`<button type="button" class="btn ghost sm" id="receipt">${icon('check', 18)}${s.key === 'changed' ? 'Comprovante anterior' : 'Ver comprovante'}</button>`);
    const cond = isT ? termsForm(t) : '';
    return `<section class="card">
      <h2>Termos</h2>
      <div class="term-row">
        <div class="term-info"><strong>Acordos do processo</strong>${t ? `<span class="muted small">Versão: ${esc(termsLabel(t))}</span>` : ''}</div>
        <span class="status ${s.cls}">${s.key === 'ok' ? icon('check', 16) : ''}${s.label}</span>
      </div>
      ${body}
      ${actions.length ? `<div class="photo-actions">${actions.join('')}</div>` : ''}
      ${cond}
    </section>`;
  }

  function termsForm(t) {
    t = t || {};
    const sel = (a, b) => (a === b ? ' selected' : '');
    return `<details class="cond"${t.version ? '' : ' open'}>
      <summary>${t.version ? 'Alterar condições' : 'Definir condições do paciente'}</summary>
      <form id="tf" class="stack">
        <div class="grid2">
          ${field('tfee', 'Valor mensal (R$)', `<input id="tfee" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(t.monthly_fee ?? '')}" required>`)}
          ${field('tday', 'Dia do pagamento', `<input id="tday" type="number" min="1" max="31" inputmode="numeric" value="${esc(t.payment_day ?? 15)}" required>`)}
          ${field('tmethod', 'Forma de pagamento', `<input id="tmethod" type="text" value="${esc(t.payment_method || 'Pix')}" required>`)}
          ${field('tfreq', 'Frequência', `<select id="tfreq">${Object.entries(FREQ).map(([k, v]) => `<option value="${k}"${sel(k, t.frequency || 'semanal')}>${v.label}</option>`).join('')}</select>`)}
          ${field('tdur', 'Duração (minutos)', `<input id="tdur" type="number" min="15" max="240" step="5" inputmode="numeric" value="${esc(t.duration_min ?? 50)}" required>`)}
          ${field('tfmt', 'Formato', `<select id="tfmt">${Object.entries(FORMATS).map(([k, v]) => `<option value="${k}"${sel(k, t.format || 'online')}>${v}</option>`).join('')}</select>`)}
        </div>
        ${t.version ? '<p class="muted small">Se você mudar alguma condição, o paciente será convidado a aceitar os acordos de novo. O aceite anterior fica no histórico.</p>' : ''}
        <button class="btn sm" type="submit">Salvar condições</button>
      </form>
    </details>`;
  }

  function bindTermsForm(pid, after) {
    const f = $('#tf');
    if (!f) return;
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const row = {
        patient_id: pid,
        monthly_fee: Number($('#tfee').value),
        payment_day: Number($('#tday').value),
        payment_method: $('#tmethod').value.trim() || 'Pix',
        frequency: $('#tfreq').value,
        duration_min: Number($('#tdur').value),
        format: $('#tfmt').value
      };
      if (!(row.monthly_fee >= 0) || !(row.payment_day >= 1 && row.payment_day <= 31)) return toast('Confira o valor e o dia do pagamento.', true);
      try { await q(sb.from('patient_terms').upsert(row)); toast('Condições salvas.'); after(); } catch (err) { /* toast */ }
    });
  }
  function bindReceipt(cs, p) {
    const b = $('#receipt');
    if (!b || !cs) return;
    b.addEventListener('click', () => {
      const w = window.open('', '_blank');
      if (!w) return toast('Permita pop-ups para este site para abrir o comprovante.', true);
      w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Comprovante de aceite — ${esc(cs.full_name)}</title>
        <style>
          body{font-family:Inter,system-ui,sans-serif;color:#1F2A24;max-width:720px;margin:40px auto;padding:0 24px;line-height:1.55}
          .top{display:flex;align-items:center;gap:14px;border-bottom:2px solid #2F6B5E;padding-bottom:16px;margin-bottom:24px}
          .logo{width:44px;height:44px;border-radius:12px;background:#2F6B5E;color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0}
          *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
          h1{font-size:22px;margin:0} .sub{color:#4C5852;margin:2px 0 0;font-size:14px}
          table{width:100%;border-collapse:collapse;margin:20px 0}
          td{padding:10px 12px;border-bottom:1px solid #E1E7E3;vertical-align:top;font-size:15px}
          td:first-child{color:#4C5852;width:38%;font-weight:600}
          .stamp{background:#D5E3DD;color:#1F4D43;border-radius:10px;padding:14px 16px;font-weight:600}
          .ua{font-size:12px;color:#4C5852;word-break:break-all}
          .foot{margin-top:28px;font-size:12px;color:#4C5852}
          button{margin-top:24px;padding:12px 20px;border:none;border-radius:10px;background:#2F6B5E;color:#fff;font:inherit;font-weight:600;cursor:pointer}
          .terms{border:1px solid #E1E7E3;border-radius:12px;padding:8px 20px 16px;margin-top:12px;font-size:14px}
          .terms h3{font-size:15px;color:#2F6B5E;margin:18px 0 6px} .terms ul{padding-left:20px;margin:6px 0} .terms li{margin:4px 0}
          .terms-alert{background:#F6E7CC;border-radius:8px;padding:10px 12px}
          h2{font-size:17px;margin:28px 0 4px}
          @media print{button{display:none} body{margin:0 auto} .terms{page-break-before:always}}
        </style></head><body>
        <div class="top"><div class="logo">${icon('leaf', 24)}</div><div><h1>Comprovante de aceite eletrônico</h1><p class="sub">${esc(APP)}${cfg.CLINIC_NAME ? ' · ' + esc(cfg.CLINIC_NAME) : ''}</p></div></div>
        <p class="stamp">✓ O documento “Acordos do processo” foi aceito eletronicamente pelo(a) paciente abaixo.</p>
        <table>
          <tr><td>Documento</td><td>Acordos do processo — combinados do acompanhamento e termo de consentimento</td></tr>
          <tr><td>Versão</td><td>${esc(termsLabel(cs.terms, cs.version))}</td></tr>
          ${cs.terms ? `<tr><td>Condições aceitas</td><td>${esc(brl(cs.terms.monthly_fee))} por mês · ${esc(cs.terms.payment_method)}, dia ${esc(cs.terms.payment_day)}<br>${esc((FREQ[cs.terms.frequency] || FREQ.semanal).label)}, ${esc(cs.terms.duration_min)} min · ${esc(FORMATS[cs.terms.format] || cs.terms.format)}</td></tr>` : ''}
          <tr><td>Paciente</td><td>${esc(p.full_name || '')}</td></tr>
          <tr><td>E-mail da conta</td><td>${esc(p.email || '')}</td></tr>
          <tr><td>Assinado como</td><td>${esc(cs.full_name)}</td></tr>
          <tr><td>Data e hora do aceite</td><td>${esc(fmtStamp(cs.accepted_at))}<br><span class="ua">Horário registrado pelo servidor (UTC: ${esc(new Date(cs.accepted_at).toISOString())})</span></td></tr>
          <tr><td>Dispositivo</td><td>${esc(deviceName(cs.user_agent))}<br><span class="ua">${esc(cs.user_agent || '')}</span></td></tr>
          <tr><td>Código do registro</td><td><span class="ua">${esc(cs.id)}</span></td></tr>
        </table>
        <p>Declaração aceita: “Li e concordo com os Acordos do processo”, confirmada com a digitação do nome completo, após login com e-mail e senha pessoais.</p>
        <p class="foot">Comprovante gerado em ${esc(fmtStamp(new Date()))}. O registro original é imutável: não pode ser alterado nem apagado pelo paciente.</p>
        <button onclick="window.print()">Salvar em PDF / imprimir</button>
        ${cs.terms ? `<h2>Texto aceito</h2><div class="terms">${termsBody(cs.terms)}</div>` : ''}
        </body></html>`);
      w.document.close();
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
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="M5 12l5 5L20 7"/>',
    wheel: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4"/>'
  };
  const icon = (n, size) => `<svg width="${size || 22}" height="${size || 22}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;
  const kindIcon = (k) => ({ video: 'play', audio: 'audio', pdf: 'file', link: 'link', exercicio: 'pen', texto: 'book' }[k] || 'book');

  /* ================= selo "Novo" (o que o paciente já viu) ================= */
  async function viewedSet(kind) {
    const { data } = await sb.from('item_views').select('item_id').eq('patient_id', me.id).eq('kind', kind);
    return new Set((data || []).map((v) => v.item_id));
  }
  async function markViewed(kind, ids) {
    if (!me || me.role !== 'patient' || !ids.length) return;
    await sb.from('item_views').upsert(ids.map((item_id) => ({ patient_id: me.id, kind, item_id })), { onConflict: 'patient_id,kind,item_id', ignoreDuplicates: true });
  }
  // Contador de novidades nas abas Conteúdos e Sessões
  async function updateNavBadges() {
    if (!me || me.role !== 'patient') return;
    try {
      const [contents, sessions, vc, vs] = await Promise.all([
        sb.from('contents').select('id'),
        sb.from('sessions').select('id').eq('patient_id', me.id),
        viewedSet('content'), viewedSet('session')
      ]);
      const nc = (contents.data || []).filter((c) => !vc.has(c.id)).length;
      const ns = (sessions.data || []).filter((s) => !vs.has(s.id)).length;
      const put = (route, n) => {
        const a = document.querySelector(`.nav a[href="#/${route}"]`);
        if (!a) return;
        const old = a.querySelector('.nav-badge');
        if (old) old.remove();
        if (n > 0) {
          const b = document.createElement('span');
          b.className = 'nav-badge';
          b.textContent = n > 9 ? '9+' : String(n);
          b.setAttribute('aria-label', `${n} ${n === 1 ? 'novo' : 'novos'}`);
          a.appendChild(b);
        }
      };
      put('conteudos', nc);
      put('sessoes', ns);
    } catch (e) { /* o selo é um extra: nunca atrapalha a tela */ }
  }

  /* ================= estrutura ================= */
  function shell(content, active) {
    loadingView = false;
    const nav = me.role === 'therapist'
      ? [['pacientes', 'Pacientes', 'users'], ['biblioteca', 'Biblioteca', 'book'], ['conta', 'Conta', 'user']]
      : [['inicio', 'Início', 'home'], ['conteudos', 'Conteúdos', 'book'], ['diario', 'Diário', 'pen'], ['sessoes', 'Sessões', 'cal']];
    $app.innerHTML = `<main class="page">${content}</main>
      <nav class="nav" aria-label="Navegação principal"><div class="nav-in" style="--n:${nav.length}">${nav.map(([r, l, i]) =>
        `<a href="#/${r}"${active === r ? ' aria-current="page"' : ''}>${icon(i)}<span>${l}</span></a>`).join('')}</div></nav>`;
    window.scrollTo(0, 0);
    if (me.role === 'patient') updateNavBadges();
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
    const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (error) throw error;
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
      } catch (err) { btn.disabled = false; return; }
      try {
        await loadMe();
        if (me) go('#/'); else { await sb.auth.signOut(); btn.disabled = false; }
      } catch (err) { viewMaintenance(err); }
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
    let myT = null, myCs = null;
    if (!isT) {
      const [tt, cc] = await Promise.all([
        q(sb.from('patient_terms').select('*').eq('patient_id', me.id).maybeSingle()),
        q(sb.from('consents').select('*').eq('patient_id', me.id).order('accepted_at', { ascending: false }).limit(1))
      ]);
      myT = tt; myCs = cc[0] || null;
    }
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
      ${isT ? '' : termsCard(myT, myCs, { therapist: false })}
      ${installCard(false)}
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
    bindReceipt(myCs, me);
    bindInstall();
    if ($('#myname')) $('#myname').addEventListener('submit', async (e) => {
      e.preventDefault();
      const full_name = $('#mname').value.trim();
      if (!full_name) return;
      try { await q(sb.from('profiles').update({ full_name }).eq('id', me.id)); await loadMe(); toast('Nome salvo.'); } catch (err) { /* toast */ }
    });
  }

  /* ================= RODA DA VIDA ================= */
  const WHEEL_GROUPS = [
    { key: 'pessoal', label: 'Pessoal', color: '#2F6B5E' },
    { key: 'profissional', label: 'Profissional', color: '#B7791F' },
    { key: 'relacoes', label: 'Relacionamentos', color: '#3F6FA0' },
    { key: 'qualidade', label: 'Qualidade de vida', color: '#7E57A0' }
  ];
  const WHEEL_AREAS = [
    { key: 'saude', label: 'Saúde e disposição', short: 'Saúde', group: 'pessoal' },
    { key: 'intelecto', label: 'Desenvolvimento intelectual', short: 'Intelecto', group: 'pessoal' },
    { key: 'emocional', label: 'Equilíbrio emocional', short: 'Emocional', group: 'pessoal' },
    { key: 'proposito', label: 'Realização e propósito', short: 'Propósito', group: 'profissional' },
    { key: 'financas', label: 'Recursos financeiros', short: 'Finanças', group: 'profissional' },
    { key: 'contribuicao', label: 'Contribuição social', short: 'Contribuição', group: 'profissional' },
    { key: 'familia', label: 'Família', short: 'Família', group: 'relacoes' },
    { key: 'amor', label: 'Vida amorosa', short: 'Amor', group: 'relacoes' },
    { key: 'social', label: 'Vida social', short: 'Social', group: 'relacoes' },
    { key: 'diversao', label: 'Diversão e hobbies', short: 'Diversão', group: 'qualidade' },
    { key: 'felicidade', label: 'Plenitude e felicidade', short: 'Felicidade', group: 'qualidade' },
    { key: 'espiritualidade', label: 'Espiritualidade', short: 'Espiritualidade', group: 'qualidade' }
  ];
  const areaLabel = (k) => (WHEEL_AREAS.find((a) => a.key === k) || { label: k }).label;
  const groupColor = (g) => (WHEEL_GROUPS.find((x) => x.key === g) || {}).color || '#2F6B5E';

  // Desenha a roda: cada fatia é preenchida do centro até a nota; a linha tracejada é a roda de comparação
  function wheelSvg(scores, compare) {
    const W = 600, H = 440, cx = W / 2, cy = H / 2, R = 150, n = WHEEL_AREAS.length, step = (Math.PI * 2) / n;
    const pt = (r, a) => [(cx + r * Math.cos(a)).toFixed(1), (cy + r * Math.sin(a)).toFixed(1)];
    const desc = WHEEL_AREAS.map((a) => `${a.label}: ${scores[a.key] ?? 'sem nota'}`).join(', ');
    let s = `<svg viewBox="0 0 ${W} ${H}" class="wheel" role="img" aria-label="Roda da Vida. ${esc(desc)}">`;
    for (let k = 2; k <= 10; k += 2) s += `<circle cx="${cx}" cy="${cy}" r="${(R * k) / 10}" fill="none" stroke="#DDE4E0" stroke-width="${k === 10 ? 1.5 : 1}"/>`;
    WHEEL_AREAS.forEach((a, i) => {
      const a0 = -Math.PI / 2 + i * step, a1 = a0 + step;
      const [sx, sy] = pt(R, a0);
      s += `<line x1="${cx}" y1="${cy}" x2="${sx}" y2="${sy}" stroke="#DDE4E0"/>`;
      const v = Number(scores[a.key] ?? 0);
      if (v > 0) {
        const r = (R * v) / 10, [x0, y0] = pt(r, a0 + 0.012), [x1, y1] = pt(r, a1 - 0.012);
        s += `<path d="M${cx},${cy} L${x0},${y0} A${r},${r} 0 0 1 ${x1},${y1} Z" fill="${groupColor(a.group)}" fill-opacity="0.82"/>`;
      }
      if (compare && compare[a.key] != null && Number(compare[a.key]) > 0) {
        const r = (R * Number(compare[a.key])) / 10, [x0, y0] = pt(r, a0 + 0.03), [x1, y1] = pt(r, a1 - 0.03);
        s += `<path d="M${x0},${y0} A${r},${r} 0 0 1 ${x1},${y1}" fill="none" stroke="#1F2A24" stroke-width="2.5" stroke-dasharray="6 4" stroke-linecap="round"/>`;
      }
      const am = a0 + step / 2, c = Math.cos(am), [lx, ly] = pt(R + (Math.abs(c) < 0.5 ? 22 : 16), am);
      const anchor = Math.abs(c) < 0.05 ? 'middle' : c > 0 ? 'start' : 'end';
      s += `<text x="${lx}" y="${ly}" text-anchor="${anchor}" dominant-baseline="middle" font-size="15" fill="#3E4A44" font-family="Inter, sans-serif">${esc(a.short)} <tspan font-weight="700" fill="${groupColor(a.group)}">${scores[a.key] ?? '–'}</tspan></text>`;
    });
    return s + '</svg>';
  }
  const wheelLegend = (compareDate) => `<div class="wheel-legend">${WHEEL_GROUPS.map((g) => `<span><i style="background:${g.color}"></i>${g.label}</span>`).join('')}
      ${compareDate ? `<span><i class="dash"></i>Primeira roda (${esc(fmtDate(compareDate))})</span>` : ''}</div>`;

  function wheelChanges(first, last) {
    const rows = WHEEL_AREAS.map((a) => ({ a, f: Number(first.scores[a.key] ?? 0), l: Number(last.scores[a.key] ?? 0) }))
      .map((r) => ({ ...r, d: r.l - r.f }));
    return `<table class="wheel-table"><thead><tr><th scope="col">Área</th><th scope="col">Primeira</th><th scope="col">Atual</th><th scope="col">Mudança</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.a.label)}</td><td>${r.f}</td><td>${r.l}</td><td class="${r.d > 0 ? 'up' : r.d < 0 ? 'down' : ''}">${r.d > 0 ? '▲ +' + r.d : r.d < 0 ? '▼ ' + r.d : '='}</td></tr>`).join('')}
    </tbody></table>`;
  }

  // Paciente: preencher e acompanhar a própria Roda da Vida
  async function viewWheel() {
    loading();
    const [acc, entries] = await Promise.all([
      q(sb.from('tool_access').select('released_at').eq('patient_id', me.id).eq('tool', 'roda').maybeSingle()),
      q(sb.from('wheel_entries').select('*').eq('patient_id', me.id).order('created_at'))
    ]);
    const back = `<a class="back-l" href="#/inicio">${icon('back', 18)}Início</a>`;
    if (!acc) {
      shell(`${back}${header('Roda da Vida', '')}<section class="card"><p>Sua terapeuta vai liberar este exercício no momento certo da sua jornada.</p></section>`, 'inicio');
      return;
    }
    const first = entries[0], last = entries[entries.length - 1];
    const compare = entries.length > 1 ? first : null;

    const showResult = () => {
      shell(`${back}${header('Roda da Vida', `Preenchida em ${fmtDate(last.created_at)}${entries.length > 1 ? ` · ${entries.length} vezes até agora` : ''}`)}
        <section class="card">${wheelSvg(last.scores, compare && compare.scores)}${wheelLegend(compare && compare.created_at)}</section>
        ${last.focus ? `<section class="card"><p class="muted small">Área para cuidar primeiro</p><h2>${esc(areaLabel(last.focus))}</h2>${last.reflection ? `<p class="prose">${esc(last.reflection)}</p>` : ''}</section>` : ''}
        ${compare ? `<section class="card"><h2>Sua evolução</h2>${wheelChanges(first, last)}</section>` : ''}
        <button class="btn" type="button" id="redo">Refazer a Roda da Vida</button>
        <p class="muted small">Refazer não apaga as anteriores: elas ficam guardadas para você acompanhar sua evolução.</p>`, 'inicio');
      $('#redo').addEventListener('click', showForm);
    };

    const showForm = () => {
      const scores = {};
      WHEEL_AREAS.forEach((a) => { scores[a.key] = last ? Number(last.scores[a.key] ?? 5) : 5; });
      shell(`${back}${header('Roda da Vida', 'Como está cada área da sua vida hoje?')}
        <section class="card"><p>Dê uma nota de <strong>0 a 10</strong> para o quanto você está satisfeita(o) hoje com cada área. Não existe resposta certa: vale a primeira sensação.</p></section>
        <section class="card wheel-live" id="wheelbox">${wheelSvg(scores, compare && compare.scores)}</section>
        <form id="wf" class="stack">
          ${WHEEL_GROUPS.map((g) => `<fieldset class="card wheel-group" style="--gc:${g.color}">
            <legend><i style="background:${g.color}"></i>${g.label}</legend>
            ${WHEEL_AREAS.filter((a) => a.group === g.key).map((a) => `<div class="slider">
              <label for="w-${a.key}">${esc(a.label)}</label><output id="o-${a.key}" for="w-${a.key}">${scores[a.key]}</output>
              <input type="range" id="w-${a.key}" data-area="${a.key}" min="0" max="10" step="1" value="${scores[a.key]}">
            </div>`).join('')}
          </fieldset>`).join('')}
          <section class="card">
            ${field('wfocus', 'Qual área você quer cuidar primeiro?', `<select id="wfocus"><option value="">Escolha uma área</option>${WHEEL_AREAS.map((a) => `<option value="${a.key}">${esc(a.label)}</option>`).join('')}</select>`)}
            ${field('wrefl', 'O que você percebeu ao olhar para a sua roda? (opcional)', '<textarea id="wrefl" rows="4"></textarea>')}
          </section>
          <button class="btn" type="submit">Salvar minha Roda da Vida</button>
          ${last ? '<button class="btn ghost" type="button" id="wcancel">Cancelar</button>' : ''}
        </form>`, 'inicio');
      $$('[data-area]').forEach((inp) => inp.addEventListener('input', () => {
        scores[inp.dataset.area] = Number(inp.value);
        $('#o-' + inp.dataset.area).textContent = inp.value;
        $('#wheelbox').innerHTML = wheelSvg(scores, compare && compare.scores);
      }));
      if ($('#wcancel')) $('#wcancel').addEventListener('click', showResult);
      $('#wf').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = $('#wf button[type=submit]');
        btn.disabled = true;
        try {
          await q(sb.from('wheel_entries').insert({ patient_id: me.id, scores, focus: $('#wfocus').value || null, reflection: $('#wrefl').value.trim() || null }));
          toast('Roda da Vida salva.');
          viewWheel();
        } catch (err) { btn.disabled = false; }
      });
    };

    if (last) showResult(); else showForm();
  }

  /* ---------- Relatório da Roda da Vida (só para a terapeuta) ---------- */
  // Biblioteca de estratégias de PNL por área: apoio à leitura da terapeuta, não prescrição.
  const PNL = {
    saude: [
      ['Ponte ao futuro', 'Conduza o paciente a se ver daqui a 3 meses com a nova rotina (sono, alimentação, movimento), explorando o que vê, ouve e sente. Use para reforçar a motivação antes de definir hábitos.'],
      ['Swish de hábitos', 'Troque a imagem do gatilho do hábito atual (ex.: celular antes de dormir) pela imagem do novo comportamento desejado, repetindo o padrão de forma rápida.']
    ],
    intelecto: [
      ['Modelagem', 'Identifique alguém que o paciente admira por aprender com facilidade e explore estratégias, crenças e rotinas dessa pessoa que ele possa adaptar.'],
      ['Ancoragem de estado de aprendizagem', 'Resgate uma memória de curiosidade e entusiasmo ao aprender algo e ancore esse estado para acessá-lo antes de estudar.']
    ],
    emocional: [
      ['Ancoragem de recursos', 'Identifique estados de calma e segurança já vividos e crie uma âncora (toque, palavra ou imagem) para acessá-los em momentos de tensão.'],
      ['Ressignificação', 'Trabalhe uma situação que gera sofrimento buscando outro significado (de sentido) ou outro contexto em que aquele comportamento seja útil (de contexto).']
    ],
    proposito: [
      ['Níveis neurológicos (Dilts)', 'Percorra ambiente, comportamento, capacidades, crenças e valores, identidade e propósito para entender em que nível está o desalinhamento com o trabalho.'],
      ['Objetivo bem formulado', 'Transforme a insatisfação em um objetivo positivo, específico, sob controle do paciente, com evidências de sucesso e checagem ecológica.']
    ],
    financas: [
      ['Metamodelo de linguagem', 'Escute generalizações e crenças sobre dinheiro (“nunca sobra”, “dinheiro é difícil”) e questione: sempre? quem disse? o que especificamente?'],
      ['Objetivo bem formulado', 'Defina uma meta financeira concreta, com prazo, primeiro passo e evidência sensorial de como será quando alcançada.']
    ],
    contribuicao: [
      ['Níveis neurológicos: missão', 'Explore o nível além da identidade: “para quem e para quê eu faço o que faço?”. Ajuda a encontrar formas de contribuição coerentes com os valores.'],
      ['Linha do tempo', 'Peça que o paciente se veja no futuro olhando para trás: que legado gostaria de ter deixado? Traga essas respostas para ações no presente.']
    ],
    familia: [
      ['Posições perceptivas', 'Revise um conflito familiar pela 1ª posição (eu), 2ª (o outro) e 3ª (observador neutro), ampliando a compreensão e as opções de resposta.'],
      ['Ressignificação de contexto', 'Explore em que contexto o comportamento do familiar que incomoda poderia ter uma intenção positiva ou ser útil.']
    ],
    amor: [
      ['Posições perceptivas', 'Use a 2ª posição para o paciente experimentar a perspectiva do par (ou de relações passadas) e a 3ª para observar padrões da relação.'],
      ['Crenças e metamodelo', 'Identifique crenças sobre merecimento e relacionamento (“sempre acabo sozinha(o)”) e questione generalizações e leituras mentais.']
    ],
    social: [
      ['Rapport e calibração', 'Trabalhe habilidades de conexão: espelhamento sutil, escuta ativa e calibração das respostas do outro em situações sociais.'],
      ['Ensaio mental com ponte ao futuro', 'Ensaie mentalmente um encontro social desejado, com o estado de recurso ancorado, até que a cena fique confortável.']
    ],
    diversao: [
      ['Submodalidades', 'Compare como o paciente representa algo prazeroso e algo “obrigatório”; ajuste brilho, tamanho e distância para tornar o lazer mais atraente.'],
      ['Ancoragem de estado de prazer', 'Resgate momentos de leveza e diversão genuína e ancore esse estado; depois planeje pequenas pausas reais na semana.']
    ],
    felicidade: [
      ['Ponte ao futuro', 'Explore como seria um dia comum com mais plenitude: o que estaria diferente? Identifique os elementos que já são possíveis agora.'],
      ['Valores e critérios', 'Elicie os valores mais importantes do paciente e verifique quais estão sendo honrados no dia a dia e quais estão ausentes.']
    ],
    espiritualidade: [
      ['Níveis neurológicos: espiritual', 'Explore o que dá sentido e conexão com algo maior (fé, natureza, propósito, comunidade), sem impor crenças.'],
      ['Ancoragem de presença', 'Resgate momentos de paz e conexão profunda e ancore esse estado para práticas breves de presença no dia a dia.']
    ]
  };
  const SESSION_QUESTIONS = [
    'O que, especificamente, faria essa nota subir um ponto?',
    'Como você vai saber que chegou lá? O que vai ver, ouvir e sentir?',
    'O que te impede hoje? E o que já está a seu favor?',
    'Quando essa área esteve melhor, o que era diferente?',
    'Qual é o primeiro passo pequeno que depende só de você?',
    'Se essa área melhorar, o que muda nas outras áreas da sua vida?'
  ];

  function wheelReportHtml(entry, prev, p) {
    const sc = (k) => Number(entry.scores[k] ?? 0);
    const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',');
    const vals = WHEEL_AREAS.map((a) => ({ ...a, v: sc(a.key) }));
    const avg = vals.reduce((s, a) => s + a.v, 0) / vals.length;
    const sorted = [...vals].sort((a, b) => a.v - b.v);
    const low = sorted[0], high = sorted[sorted.length - 1];
    const range = high.v - low.v;
    const balance = range <= 3 ? ['equilibrada', 'As notas estão próximas entre si. O trabalho pode focar em elevar o nível geral ou em uma área de interesse.']
      : range <= 6 ? ['moderadamente desequilibrada', 'Há diferença relevante entre as áreas. Vale explorar como as áreas fortes podem apoiar as mais baixas.']
      : ['desequilibrada', 'Há grande distância entre as áreas. Investigue se a área mais alta está “compensando” as outras e o custo disso.'];
    const groupAvg = WHEEL_GROUPS.map((g) => {
      const a = vals.filter((x) => x.group === g.key);
      return { ...g, avg: a.reduce((s, x) => s + x.v, 0) / a.length };
    });
    const attention = sorted.filter((a) => a.v <= 4);
    const strengths = [...sorted].reverse().filter((a) => a.v >= 8);
    const focus = entry.focus ? vals.find((a) => a.key === entry.focus) : null;
    const lowest3 = sorted.slice(0, 3).map((a) => a.key);
    let focusInsight = '';
    if (!focus) focusInsight = 'O paciente não escolheu uma área prioritária. Pode ser útil explorar na sessão o que dificulta essa escolha.';
    else if (focus.key === low.key) focusInsight = `O foco escolhido (${focus.label}, nota ${focus.v}) coincide com a menor nota: há coerência entre a percepção e a prioridade.`;
    else if (lowest3.includes(focus.key)) focusInsight = `O foco escolhido (${focus.label}, nota ${focus.v}) está entre as três notas mais baixas: prioridade coerente com o resultado.`;
    else focusInsight = `O paciente escolheu ${focus.label} (nota ${focus.v}), embora ${low.label} tenha a menor nota (${low.v}). Vale explorar os critérios dessa escolha: motivação “em direção a” algo desejado ou “afastamento” de algo difícil de encarar (metaprograma de direção).`;
    const alerts = [];
    if (sc('emocional') <= 2 || sc('felicidade') <= 2) alerts.push('Notas muito baixas em Equilíbrio emocional ou Plenitude e felicidade merecem atenção cuidadosa. Avalie se há necessidade de encaminhamento para acompanhamento psicológico ou psiquiátrico.');
    if (avg <= 3) alerts.push('A média geral está muito baixa. Acolha antes de propor metas e investigue o momento de vida do paciente.');
    let evolution = '';
    if (prev) {
      const diffs = WHEEL_AREAS.map((a) => ({ ...a, d: sc(a.key) - Number(prev.scores[a.key] ?? 0) })).filter((x) => x.d !== 0).sort((a, b) => b.d - a.d);
      const ups = diffs.filter((x) => x.d > 0), downs = diffs.filter((x) => x.d < 0).reverse();
      const prevAvg = WHEEL_AREAS.reduce((s, a) => s + Number(prev.scores[a.key] ?? 0), 0) / WHEEL_AREAS.length;
      const dAvg = Math.round(avg * 10) / 10 - Math.round(prevAvg * 10) / 10;
      evolution = `<section class="card"><h2>Evolução desde ${esc(fmtDate(prev.created_at))}</h2>
        <p>Média geral: <strong>${f1(prevAvg)}</strong> → <strong>${f1(avg)}</strong> (${dAvg >= 0 ? '+' : ''}${f1(dAvg)}).</p>
        ${ups.length ? `<p><strong class="up-t">Subiram:</strong> ${ups.map((x) => `${esc(x.label)} (+${x.d})`).join(', ')}.</p>` : ''}
        ${downs.length ? `<p><strong class="down-t">Caíram:</strong> ${downs.map((x) => `${esc(x.label)} (${x.d})`).join(', ')}.</p>` : ''}
        ${downs.some((x) => x.d <= -2) ? '<p class="consent-pending">Há queda de 2 pontos ou mais em alguma área. Investigue o que aconteceu nesse período.</p>' : ''}
        ${!diffs.length ? '<p>Nenhuma nota mudou.</p>' : ''}
      </section>`;
    }
    const pnlAreas = [];
    if (focus) pnlAreas.push(focus);
    sorted.forEach((a) => { if (pnlAreas.length < 3 && !pnlAreas.some((x) => x.key === a.key) && a.v <= 6) pnlAreas.push(a); });
    return `
      <section class="card report-head">
        <p class="muted small">Relatório da Roda da Vida · somente para a terapeuta</p>
        <h2>${esc(p.full_name || p.email)}</h2>
        <p class="muted small">Preenchida em ${esc(fmtStamp(entry.created_at))}</p>
      </section>
      ${alerts.map((t) => `<p class="consent-pending">${esc(t)}</p>`).join('')}
      <section class="card">${wheelSvg(entry.scores, prev && prev.scores)}${wheelLegend(prev && prev.created_at)}</section>
      <section class="card"><h2>Visão geral</h2>
        <div class="report-kpis">
          <div><strong>${f1(avg)}</strong><span>média geral</span></div>
          <div><strong>${high.v}</strong><span>maior: ${esc(high.short)}</span></div>
          <div><strong>${low.v}</strong><span>menor: ${esc(low.short)}</span></div>
        </div>
        <p>A roda está <strong>${balance[0]}</strong> (diferença de ${range} pontos entre a maior e a menor nota). ${balance[1]}</p>
        <div class="group-bars">${groupAvg.map((g) => `<div><span>${esc(g.label)}</span><div class="gb"><i style="width:${g.avg * 10}%;background:${g.color}"></i></div><b>${f1(g.avg)}</b></div>`).join('')}</div>
      </section>
      ${attention.length ? `<section class="card"><h2>Áreas de atenção (nota 4 ou menos)</h2><ul class="report-list">${attention.map((a) => `<li><b>${a.v}</b> ${esc(a.label)}</li>`).join('')}</ul></section>` : ''}
      ${strengths.length ? `<section class="card"><h2>Pontos fortes (nota 8 ou mais)</h2><ul class="report-list">${strengths.map((a) => `<li><b>${a.v}</b> ${esc(a.label)}</li>`).join('')}</ul>
        <p class="muted small">Recursos que podem ser transferidos para as áreas mais baixas: explore o que o paciente faz, pensa e sente nessas áreas e como levar isso para as demais (ancoragem e encadeamento de recursos).</p></section>` : ''}
      <section class="card"><h2>Foco escolhido pelo paciente</h2><p>${esc(focusInsight)}</p>
        ${entry.reflection ? `<blockquote class="quote">“${esc(entry.reflection)}”</blockquote>` : ''}</section>
      ${evolution}
      ${pnlAreas.length ? `<section class="card"><h2>Estratégias de PNL sugeridas</h2>
        ${pnlAreas.map((a) => `<div class="pnl-area"><h3 style="color:${groupColor(a.group)}">${esc(a.label)} · nota ${a.v}${focus && a.key === focus.key ? ' · foco do paciente' : ''}</h3>
          ${(PNL[a.key] || []).map(([n, d]) => `<p><strong>${esc(n)}:</strong> ${esc(d)}</p>`).join('')}</div>`).join('')}
      </section>` : ''}
      <section class="card"><h2>Perguntas para a próxima sessão</h2>
        <p class="muted small">Baseadas na estrutura de objetivo bem formulado, aplicadas a ${esc(focus ? focus.label : low.label)}.</p>
        <ol class="report-q">${SESSION_QUESTIONS.map((q) => `<li>${esc(q)}</li>`).join('')}</ol></section>
      <p class="muted small">Relatório gerado automaticamente a partir das notas, como apoio à sua leitura. Não é diagnóstico e não substitui a sua avaliação profissional. Visível somente para você.</p>`;
  }

  async function viewWheelReport(pid, entryId) {
    loading();
    const [p, entries] = await Promise.all([
      q(sb.from('profiles').select('id,full_name,email').eq('id', pid).maybeSingle()),
      q(sb.from('wheel_entries').select('*').eq('patient_id', pid).order('created_at'))
    ]);
    if (!p || !entries.length) { go('#/paciente/' + pid); return; }
    let idx = entries.findIndex((e) => e.id === entryId);
    if (idx < 0) idx = entries.length - 1;
    const entry = entries[idx], prev = idx > 0 ? entries[idx - 1] : null;
    shell(`${darkHeader('', 'Relatório da Roda da Vida', p.full_name || p.email, ['#/paciente/' + pid, 'Ficha do paciente'])}
      <div class="no-print stack">
        ${entries.length > 1 ? field('wsel', 'Preenchimento', `<select id="wsel">${entries.map((e, i) => `<option value="${e.id}"${i === idx ? ' selected' : ''}>${esc(fmtDate(e.created_at))}${i === entries.length - 1 ? ' (mais recente)' : ''}</option>`).join('')}</select>`) : ''}
        <button type="button" class="btn ghost sm" id="wprint">${icon('file', 18)}Imprimir / salvar em PDF</button>
      </div>
      ${wheelReportHtml(entry, prev, p)}`, 'pacientes');
    if ($('#wsel')) $('#wsel').addEventListener('change', (e) => viewWheelReport(pid, e.target.value));
    $('#wprint').addEventListener('click', () => window.print());
  }

  // Terapeuta: tópico Roda da Vida na ficha
  function wheelTherapistCard(acc, entries) {
    const first = entries[0], last = entries[entries.length - 1];
    return `<section class="card">
      <div class="term-row"><h2>Roda da Vida</h2>
        <span class="status ${acc ? 'ok' : 'pending'}">${acc ? icon('check', 16) + 'Liberada' : 'Não liberada'}</span></div>
      ${!acc ? '<p class="muted small">Libere quando for o momento: o paciente verá o exercício na tela de Início.</p><button type="button" class="btn sm" id="wheel-release">Liberar Roda da Vida</button>'
        : `<p class="muted small">Liberada em ${esc(fmtDate(acc.released_at))}. ${entries.length ? `Preenchida ${entries.length} ${entries.length === 1 ? 'vez' : 'vezes'}: ${entries.map((e) => esc(fmtDate(e.created_at))).join(', ')}.` : 'O paciente ainda não preencheu.'}</p>`}
      ${last ? `${wheelSvg(last.scores, entries.length > 1 ? first.scores : null)}${wheelLegend(entries.length > 1 ? first.created_at : null)}
        ${last.focus ? `<p><span class="muted small">Área para cuidar primeiro:</span> <strong>${esc(areaLabel(last.focus))}</strong></p>` : ''}
        ${last.reflection ? `<p class="prose">${esc(last.reflection)}</p>` : ''}
        ${entries.length > 1 ? `<details><summary class="sub-h" style="cursor:pointer">Comparar primeira e atual</summary>${wheelChanges(first, last)}</details>` : ''}
        <a class="btn sm" href="#/paciente/${last.patient_id}/roda-relatorio">${icon('file', 18)}Ver relatório com estratégias de PNL</a>` : ''}
      ${acc ? '<button type="button" class="btn-link" id="wheel-revoke">Remover acesso do paciente</button>' : ''}
    </section>`;
  }

  /* ================= gráfico de bem-estar (paciente e terapeuta) ================= */
  // Por semana: primeiro a média de cada dia, depois a média dos dias.
  // Assim, vários registros no mesmo dia não pesam mais do que um dia com um registro só.
  function moodChart(diary, title, caption) {
    const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`; };
    const weeks = Array.from({ length: 6 }, () => new Map());
    diary.forEach((d) => {
      if (d.mood == null) return;
      const w = Math.floor((Date.now() - new Date(d.created_at)) / (7 * DAY));
      if (w < 0 || w >= 6) return;
      const days = weeks[5 - w], k = dayKey(d.created_at);
      if (!days.has(k)) days.set(k, []);
      days.get(k).push(d.mood);
    });
    const stats = weeks.map((days) => {
      const dayAvgs = [...days.values()].map((m) => m.reduce((a, b) => a + b, 0) / m.length);
      return { avg: dayAvgs.length ? dayAvgs.reduce((a, b) => a + b, 0) / dayAvgs.length : null, n: dayAvgs.length };
    });
    const moodOf = (s) => MOODS[Math.round(s.avg)];
    const label = (s) => (s.avg == null ? 'sem registros' : `média ${moodOf(s)} · ${s.n} ${s.n === 1 ? 'dia registrado' : 'dias registrados'}`);
    const bars = stats.map((s, i) => {
      const h = s.avg == null ? 6 : Math.round(((s.avg + 1) / 5) * 100);
      return `<div class="bar"><span class="bar-val">${s.avg == null ? '' : esc(moodOf(s))}</span>
        <div class="bar-track"><div class="bar-fill${i === 5 ? ' now' : ''}${s.avg == null ? ' empty' : ''}" style="height:${h}%" title="${label(s)}"></div></div>
        <span>${i === 5 ? 'Agora' : '-' + (5 - i) + 's'}</span></div>`;
    }).join('');
    const now = stats[5];
    const withData = stats.filter((s) => s.avg != null).length;
    return `<section class="card">
      <h2>${esc(title)}</h2>
      <div class="bars" role="img" aria-label="${esc(stats.map((s, i) => `semana ${i + 1}: ${label(s)}`).join(', '))}">${bars}</div>
      <p class="chart-sum"><strong>Esta semana:</strong> ${now.avg == null ? 'nenhum humor registrado ainda' : esc(label(now).replace('média ', ''))}${withData ? ` · ${withData} de 6 semanas com registros` : ''}</p>
      <p class="muted small">${esc(caption)}</p>
    </section>`;
  }

  /* ================= PACIENTE ================= */
  async function viewHome() {
    loading();
    const since = new Date(Date.now() - 42 * DAY).toISOString();
    const [phases, unlocks, goals, diary, latest, therapists, terms, lastConsent, wheelAcc, wheelAny] = await Promise.all([
      q(sb.from('phases').select('*').order('position')),
      q(sb.from('phase_unlocks').select('phase_id').eq('patient_id', me.id)),
      q(sb.from('goals').select('*').eq('patient_id', me.id).order('created_at')),
      q(sb.from('diary_entries').select('mood,created_at').eq('patient_id', me.id).gte('created_at', since)),
      q(sb.from('contents').select('id,title,kind').order('created_at', { ascending: false }).limit(1)),
      q(sb.from('profiles').select('id,full_name,avatar_path').eq('role', 'therapist').limit(1)),
      q(sb.from('patient_terms').select('*').eq('patient_id', me.id).maybeSingle()),
      q(sb.from('consents').select('version,accepted_at').eq('patient_id', me.id).order('accepted_at', { ascending: false }).limit(1)),
      q(sb.from('tool_access').select('released_at').eq('patient_id', me.id).eq('tool', 'roda').maybeSingle()),
      q(sb.from('wheel_entries').select('id').eq('patient_id', me.id).limit(1))
    ]);
    const latestSeen = latest[0] ? (await viewedSet('content')).has(latest[0].id) : true;
    const wheelCard = wheelAcc ? `<a class="highlight wheel-hl" href="#/roda"><span class="hl-ico">${icon('wheel', 22)}</span>
        <span><span class="kicker-amber">${wheelAny.length ? 'SUA RODA DA VIDA' : 'EXERCÍCIO LIBERADO'}</span><strong>${wheelAny.length ? 'Ver sua roda e evolução' : 'Faça sua Roda da Vida'}</strong></span></a>` : '';
    const tState = termsState(terms, lastConsent[0]);
    const consentCard = (tState.key === 'pending' || tState.key === 'changed') ? `<section class="card consent">
        <span class="kicker-amber">${tState.key === 'changed' ? 'ACORDOS ATUALIZADOS' : 'ANTES DE COMEÇAR'}</span>
        <h2>${tState.key === 'changed' ? 'Seus acordos foram atualizados' : 'Leia e aceite os Acordos do processo'}</h2>
        <p class="muted">São os combinados sobre sessões, sigilo, pagamento e uso dos seus dados.</p>
        <a class="btn" href="#/acordos">${icon('file', 20)}Ler e aceitar os acordos</a>
      </section>` : '';
    const ther = therapists[0];
    const urls = await avatarUrls([me.avatar_path, ther && ther.avatar_path]);
    const unlocked = new Set(unlocks.map((u) => u.phase_id));
    const opened = phases.filter((p) => unlocked.has(p.id));
    const current = opened[opened.length - 1];
    const pct = phases.length ? Math.round((opened.length / phases.length) * 100) : 0;

    shell(`<header class="hd"><div><p class="muted small cap">${esc(fmtFull(new Date()))}</p><h1>Olá, ${esc(firstName(me.full_name))}</h1></div>
        ${avatarHtml(me, urls, '', '#/conta', 'Minha conta')}</header>
      ${consentCard}
      ${wheelCard}
      ${installCard(true)}
      <section class="journey">
        <div class="row-between"><span class="kicker">Sua jornada</span><span class="kicker">${current ? `Fase ${current.position} de ${phases.length}` : ''}</span></div>
        <h2>${esc(current ? current.name : 'Sua jornada vai começar em breve')}</h2>
        <div class="progress" role="progressbar" aria-label="Progresso na jornada" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div style="width:${pct}%"></div></div>
        <ol class="phases">${phases.map((p) => `<li class="${current && p.id === current.id ? 'on' : ''}">${esc(p.name)}</li>`).join('')}</ol>
      </section>
      ${moodChart(diary, 'Bem-estar nas últimas semanas', 'Calculado a partir do humor que você registra no diário.')}
      <section class="card">
        <h2>Metas combinadas</h2>
        ${goals.length ? `<ul class="checks">${goals.map((g) => `<li><label><input type="checkbox" data-goal="${g.id}"${g.done ? ' checked' : ''}><span>${esc(g.title)}</span></label></li>`).join('')}</ul>`
          : '<p class="muted">Suas metas aparecerão aqui depois da sessão.</p>'}
      </section>
      ${latest[0] ? `<a class="highlight" href="#/conteudo/${latest[0].id}"><span class="hl-ico">${icon(kindIcon(latest[0].kind), 20)}</span>
        <span><span class="kicker-amber">${latestSeen ? 'CONTEÚDO MAIS RECENTE' : 'NOVO CONTEÚDO PARA VOCÊ'}</span><strong>${esc(latest[0].title)}</strong></span></a>` : ''}
      ${ther ? `<section class="card profile-row">${avatarHtml(ther, urls)}<div><p class="muted small">Sua terapeuta</p><strong>${esc(ther.full_name || '')}</strong></div></section>` : ''}`, 'inicio');
    bindChecks('data-goal', 'goals');
    bindInstall();
  }

  // Acordos do processo do paciente: leitura e aceite
  async function viewTerms() {
    loading();
    const [t, cons] = await Promise.all([
      q(sb.from('patient_terms').select('*').eq('patient_id', me.id).maybeSingle()),
      q(sb.from('consents').select('*').eq('patient_id', me.id).order('accepted_at', { ascending: false }).limit(1))
    ]);
    const cs = cons[0] || null;
    const s = termsState(t, cs);
    if (!t) {
      shell(`<a class="back-l" href="#/inicio">${icon('back', 18)}Início</a>${header('Acordos do processo', '')}
        <section class="card"><p>Sua terapeuta ainda está preparando os seus acordos. Assim que estiverem prontos, eles aparecerão aqui.</p></section>`, 'inicio');
      return;
    }
    shell(`<a class="back-l" href="#/inicio">${icon('back', 18)}Início</a>
      ${header('Acordos do processo', 'Versão: ' + termsLabel(t))}
      <article class="card terms">${termsBody(t)}</article>
      ${s.key === 'ok'
        ? `<section class="card"><p class="consent-ok">${icon('check', 18)}<span>Você aceitou estes acordos em ${esc(fmtStamp(cs.accepted_at))}, assinando como “${esc(cs.full_name)}”.</span></p>
            <button type="button" class="btn ghost sm" id="receipt">${icon('check', 18)}Ver comprovante</button></section>`
        : `<section class="card consent">
            <h2>Aceitar os acordos</h2>
            <form id="cform" class="stack">
              <label class="check-line"><input type="checkbox" id="cok"> Li e concordo com os Acordos do processo</label>
              ${field('cname', 'Digite seu nome completo para assinar', '<input id="cname" type="text" autocomplete="name" required>')}
              <button class="btn" type="submit">Aceitar e assinar</button>
            </form>
          </section>`}`, 'inicio');
    bindReceipt(cs, me);
    if ($('#cform')) $('#cform').addEventListener('submit', async (e) => {
      e.preventDefault();
      const full_name = $('#cname').value.trim();
      if (!$('#cok').checked) return toast('Marque que você leu e concorda.', true);
      if (full_name.split(/\s+/).length < 2) return toast('Digite seu nome completo (nome e sobrenome).', true);
      const btn = $('#cform button[type=submit]');
      btn.disabled = true;
      try {
        // versão, data e condições são gravadas pelo servidor
        await q(sb.from('consents').insert({ patient_id: me.id, version: 'servidor', full_name, user_agent: navigator.userAgent.slice(0, 300) }));
        toast('Acordos aceitos. Obrigada!');
        viewTerms();
      } catch (err) { btn.disabled = false; }
    });
  }

  async function viewContents() {
    loading();
    const [phases, unlocks, contents] = await Promise.all([
      q(sb.from('phases').select('*').order('position')),
      q(sb.from('phase_unlocks').select('phase_id').eq('patient_id', me.id)),
      q(sb.from('contents').select('id,phase_id,kind,title,duration,created_at,audience').order('created_at'))
    ]);
    const unlocked = new Set(unlocks.map((u) => u.phase_id));
    const filters = [['todos', 'Todos'], ['video', 'Vídeos'], ['texto', 'Textos'], ['exercicio', 'Exercícios'], ['audio', 'Áudios'], ['pdf', 'PDFs']];
    const seen = await viewedSet('content');
    let filter = 'todos';

    const itemHtml = (c) => `<a class="item" href="#/conteudo/${c.id}"><span class="thumb">${icon(kindIcon(c.kind))}</span>
      <span class="item-body">${!seen.has(c.id) ? '<span class="badge">NOVO</span>' : ''}<strong>${esc(c.title)}</strong>
      <span class="muted small">${KINDS[c.kind] || ''}${c.duration ? ' · ' + esc(c.duration) : ''}</span></span></a>`;

    function list() {
      const open = phases.filter((p) => unlocked.has(p.id)).reverse();
      const locked = phases.filter((p) => !unlocked.has(p.id));
      const ok = (c) => filter === 'todos' || c.kind === filter;
      const personal = contents.filter((c) => c.audience === 'selected' && ok(c)).reverse();
      let html = personal.length ? `<section class="for-you"><h2 class="sec" style="margin:0;color:var(--amber)">Escolhidos para você</h2>${personal.map(itemHtml).join('')}</section>` : '';
      html += open.map((p) => {
        const items = contents.filter((c) => c.phase_id === p.id && c.audience !== 'selected' && ok(c));
        return `<h2 class="sec">Fase ${p.position} · ${esc(p.name)}</h2>${items.length ? items.map(itemHtml).join('') : '<p class="muted small">Nada deste tipo nesta fase ainda.</p>'}`;
      }).join('');
      if (!open.length && !personal.length) html = '<p class="muted">Seus conteúdos aparecerão aqui quando forem liberados.</p>';
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
    markViewed('content', [c.id]);
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
    const seenS = await viewedSet('session');
    const isNew = (s) => (!seenS.has(s.id) ? ' <span class="badge">NOVA</span>' : '');

    const body = (s) => `
      ${s.summary ? `<div class="stack" style="gap:4px"><h3 class="sub-h">Resumo da terapeuta</h3><p class="prose">${esc(s.summary)}</p></div>` : ''}
      ${s.weekly_task ? `<div class="stack" style="gap:4px"><h3 class="sub-h">Combinado para a semana</h3><p class="prose">${esc(s.weekly_task)}</p></div>` : ''}
      ${(() => { const h = materialsHtml(mats.filter((m) => m.session_id === s.id), urls); return h ? `<div class="stack" style="gap:8px"><h3 class="sub-h">Materiais da sessão</h3>${h}</div>` : ''; })()}`;

    shell(`${header('Sessões', 'O que foi trabalhado em cada encontro')}
      ${!total ? '<p class="muted">Depois de cada sessão, o resumo e os materiais aparecerão aqui.</p>' : ''}
      ${sessions.map((s, i) => i === 0
        ? `<section class="card"><span class="kicker-amber">ÚLTIMA SESSÃO${isNew(s)}</span><h2 style="font-family:Outfit,sans-serif;font-size:20px">Sessão ${total} · ${esc(fmtDate(s.session_date))}</h2>${body(s)}</section>
           ${total > 1 ? '<h2 class="sec">Anteriores</h2>' : ''}`
        : `<details class="card"><summary><span>Sessão ${total - i} · ${esc(fmtDate(s.session_date))}${isNew(s)}</span></summary>${body(s)}</details>`).join('')}`, 'sessoes');
    // ao abrir a tela de Sessões, todas passam a contar como vistas (o selo some na próxima visita)
    await markViewed('session', sessions.filter((s) => !seenS.has(s.id)).map((s) => s.id));
    updateNavBadges();
  }

  /* ================= TERAPEUTA ================= */
  async function viewPatients() {
    loading();
    const since = new Date(Date.now() - 30 * DAY).toISOString();
    const [patients, unlocks, phases, diary, sessions, allTerms, allConsents] = await Promise.all([
      q(sb.from('profiles').select('*').eq('role', 'patient').order('full_name')),
      q(sb.from('phase_unlocks').select('patient_id,phase_id')),
      q(sb.from('phases').select('*').order('position')),
      q(sb.from('diary_entries').select('patient_id,created_at').gte('created_at', since).order('created_at', { ascending: false })),
      q(sb.from('sessions').select('patient_id,created_at').order('created_at', { ascending: false }).limit(2000)),
      q(sb.from('patient_terms').select('patient_id,version')),
      q(sb.from('consents').select('patient_id,version'))
    ]);
    const termVer = Object.fromEntries(allTerms.map((t) => [t.patient_id, t.version]));
    const accepted = new Set(allConsents.map((c) => c.patient_id + '|' + c.version));
    const termBadge = (pid) => !termVer[pid] ? '<span class="badge">Definir termo</span>'
      : !accepted.has(pid + '|' + termVer[pid]) ? '<span class="badge">Termo pendente</span>' : '';
    const phaseById = Object.fromEntries(phases.map((p) => [p.id, p]));
    const lastDiary = {}, lastSession = {};
    diary.forEach((d) => { if (!lastDiary[d.patient_id]) lastDiary[d.patient_id] = d.created_at; });
    sessions.forEach((s) => { if (!lastSession[s.patient_id]) lastSession[s.patient_id] = s.created_at; });
    const currentPhase = (pid) => unlocks.filter((u) => u.patient_id === pid).map((u) => phaseById[u.phase_id]).filter(Boolean).sort((a, b) => b.position - a.position)[0];
    const hasNew = (pid) => lastDiary[pid] && (!lastSession[pid] || new Date(lastDiary[pid]) > new Date(lastSession[pid]));
    const weekDiaries = diary.filter((d) => new Date(d.created_at) > Date.now() - 7 * DAY).length;
    const urls = await avatarUrls(patients.map((p) => p.avatar_path));

    const activeP = patients.filter((p) => p.active !== false);
    const inactiveP = patients.filter((p) => p.active === false);
    let showInactive = false;

    const row = (p) => {
      const ph = currentPhase(p.id);
      const off = p.active === false;
      return `<a class="item${off ? ' inactive' : ''}" href="#/paciente/${p.id}" data-name="${esc((p.full_name || '').toLowerCase() + ' ' + (p.email || '').toLowerCase())}">
        ${avatarHtml(p, urls)}
        <span class="item-body"><strong>${esc(p.full_name || p.email)}</strong><span class="muted small">${off ? `Inativo${p.deactivated_at ? ' desde ' + esc(fmtDate(p.deactivated_at)) : ''}` : ph ? `Fase ${ph.position} · ${esc(ph.name)}` : 'Nenhuma fase liberada'}</span></span>
        ${off ? '' : `<span class="badges">${hasNew(p.id) ? '<span class="badge">Diário novo</span>' : ''}${termBadge(p.id)}</span>`}</a>`;
    };
    const listHtml = () => {
      const arr = showInactive ? inactiveP : activeP;
      if (arr.length) return arr.map(row).join('');
      return showInactive ? '<p class="muted">Nenhum paciente inativo.</p>' : '<p class="muted">Nenhum paciente ativo. Veja abaixo como convidar.</p>';
    };

    shell(`${darkHeader('Painel da terapeuta', 'Pacientes', '', null,
        `<div class="stats"><div><strong>${activeP.length}</strong><span>ativos</span></div><div><strong>${activeP.filter((p) => hasNew(p.id)).length}</strong><span>diários novos</span></div><div><strong>${weekDiaries}</strong><span>registros na semana</span></div></div>`)}
      <div class="pills" role="group" aria-label="Mostrar pacientes">
        <button type="button" class="pill" data-tab="on" aria-pressed="true">Ativos (${activeP.length})</button>
        <button type="button" class="pill" data-tab="off" aria-pressed="false">Inativos (${inactiveP.length})</button>
      </div>
      ${field('busca', 'Buscar paciente', '<input id="busca" type="search" placeholder="Nome ou e-mail" autocomplete="off">')}
      <div id="plist" class="stack">${listHtml()}</div>
      <details class="card">
        <summary>+ Convidar novo paciente</summary>
        <ol class="stack" style="padding-left:20px;margin:0">
          <li>Abra o painel do Supabase › <strong>Authentication › Users › Add user › Create new user</strong>.</li>
          <li>Informe o e-mail do paciente e uma senha provisória e marque <strong>Auto Confirm User</strong>.</li>
          <li>Ele aparecerá aqui automaticamente, com a fase 1 já liberada. Abra a ficha para colocar o nome completo.</li>
          <li>Envie ao paciente o link deste site, o e-mail e a senha provisória. Ele troca a senha em <strong>Conta</strong>.</li>
        </ol>
      </details>`, 'pacientes');

    const filterList = () => {
      const t = $('#busca').value.trim().toLowerCase();
      $$('#plist [data-name]').forEach((a) => { a.style.display = a.dataset.name.includes(t) ? '' : 'none'; });
    };
    $('#busca').addEventListener('input', filterList);
    $$('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      showInactive = b.dataset.tab === 'off';
      $$('[data-tab]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      $('#plist').innerHTML = listHtml();
      filterList();
    }));
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
    const moodDiary = await q(sb.from('diary_entries').select('mood,created_at').eq('patient_id', pid).gte('created_at', new Date(Date.now() - 42 * DAY).toISOString()));
    const urls = await avatarUrls([p.avatar_path]);
    const [pterms, consents, wAcc, wEntries] = await Promise.all([
      q(sb.from('patient_terms').select('*').eq('patient_id', pid).maybeSingle()),
      q(sb.from('consents').select('*').eq('patient_id', pid).order('accepted_at', { ascending: false }).limit(1)),
      q(sb.from('tool_access').select('released_at').eq('patient_id', pid).eq('tool', 'roda').maybeSingle()),
      q(sb.from('wheel_entries').select('*').eq('patient_id', pid).order('created_at'))
    ]);
    const cs = consents[0] || null;
    const [myAssigns, personalAll, pViews] = await Promise.all([
      q(sb.from('content_patients').select('content_id').eq('patient_id', pid)),
      q(sb.from('contents').select('id,title,phase_id,respect_phase').eq('audience', 'selected').order('title')),
      q(sb.from('item_views').select('kind,item_id,viewed_at').eq('patient_id', pid))
    ]);
    const viewedAt = Object.fromEntries(pViews.map((v) => [v.kind + ':' + v.item_id, v.viewed_at]));
    const seenTag = (kind, id) => viewedAt[kind + ':' + id]
      ? `<span class="seen">✓ visto em ${esc(fmtDate(viewedAt[kind + ':' + id]))}</span>`
      : '<span class="unseen">ainda não visto</span>';
    const assignedIds = new Set(myAssigns.map((a) => a.content_id));
    const phaseOf = Object.fromEntries(phases.map((ph) => [ph.id, ph]));
    const mine = personalAll.filter((c) => assignedIds.has(c.id));
    const available = personalAll.filter((c) => !assignedIds.has(c.id));
    const personalCard = `<section class="card">
        <h2>Conteúdos personalizados</h2>
        ${mine.length ? `<ul class="rows">${mine.map((c) => {
          const ph = phaseOf[c.phase_id];
          const waiting = c.respect_phase && !unlocked.has(c.phase_id);
          return `<li><span><a href="#/conteudo/${c.id}" style="color:inherit">${esc(c.title)}</a><br><span class="muted small">Fase ${ph ? ph.position : '?'}${waiting ? ' · aguardando a liberação da fase' : ' · visível ao paciente · ' + seenTag('content', c.id)}</span></span>
            <button type="button" class="icon-btn" data-unassign="${c.id}" aria-label="Remover ${esc(c.title)} deste paciente">${icon('trash', 18)}</button></li>`;
        }).join('')}</ul>` : '<p class="muted small">Nenhum conteúdo personalizado para este paciente.</p>'}
        ${available.length ? `<form id="assignf" class="inline"><label class="sr" for="assignsel">Adicionar conteúdo personalizado</label>
            <select id="assignsel">${available.map((c) => `<option value="${c.id}">${esc(c.title)} (fase ${phaseOf[c.phase_id] ? phaseOf[c.phase_id].position : '?'})</option>`).join('')}</select>
            <button class="btn sm" type="submit">Adicionar</button></form>` : ''}
        <p class="muted small">Para criar um novo, vá à Biblioteca e escolha “Só pacientes escolhidos”.</p>
      </section>`;

    const listRows = (items, table, label) => `${items.length ? `<ul class="rows">${items.map((it) => `<li><span class="${it.done ? 'done' : ''}">${esc(it.title)}</span>
        <button type="button" class="icon-btn" data-del="${table}:${it.id}" aria-label="Remover ${label}: ${esc(it.title)}">${icon('trash', 18)}</button></li>`).join('')}</ul>` : `<p class="muted small">Nenhuma ${label} ainda.</p>`}
      <form class="inline" data-add="${table}"><label class="sr" for="add-${table}">Nova ${label}</label>
        <input id="add-${table}" type="text" placeholder="Nova ${label}" required><button class="btn sm" type="submit">Adicionar</button></form>`;

    const off = p.active === false;
    const statusCard = `<section class="card">
        <h2>Situação</h2>
        <div class="term-row">
          <div class="term-info"><strong>${off ? 'Acompanhamento encerrado' : 'Em acompanhamento'}</strong>
            <span class="muted small">${off ? `Inativo${p.deactivated_at ? ' desde ' + esc(fmtDate(p.deactivated_at)) : ''} · sem acesso ao site` : 'O paciente tem acesso ao site'}</span></div>
          <span class="status ${off ? 'pending' : 'ok'}">${off ? 'Inativo' : icon('check', 16) + 'Ativo'}</span>
        </div>
        ${off
          ? '<button type="button" class="btn sm" id="reactivate">Reativar paciente</button>'
          : '<button type="button" class="btn sm danger" id="deactivate">Encerrar acompanhamento (inativar)</button><p class="muted small">O paciente perde o acesso, mas nada é apagado: diário, sessões e termos ficam guardados e você pode reativar quando quiser.</p>'}
      </section>`;

    shell(`${darkHeader('', p.full_name || p.email, `${total} ${total === 1 ? 'sessão registrada' : 'sessões registradas'} · ${p.email || ''}`, ['#/pacientes', 'Pacientes'])}
      ${off ? `<p class="consent-pending">Paciente inativo desde ${esc(fmtDate(p.deactivated_at || new Date()))}. Ele não consegue acessar o site.</p>` : `<a class="btn" href="#/paciente/${pid}/nova-sessao">Registrar sessão</a>`}
      <section class="card">
        <h2>Perfil do paciente</h2>
        <div class="profile-row">${avatarHtml(p, urls, 'lg')}${photoControls('pphoto', !!p.avatar_path)}</div>
        <form id="nf" class="inline"><label class="sr" for="pname">Nome do paciente</label>
          <input id="pname" type="text" value="${esc(p.full_name || '')}" placeholder="Nome completo"><button class="btn sm ghost" type="submit">Salvar nome</button></form>
      </section>
      ${termsCard(pterms, cs, { therapist: true, pid })}
      <section class="card" style="gap:4px">
        <h2 style="margin-bottom:6px">Fases da jornada</h2>
        ${phases.map((ph) => { const on = unlocked.has(ph.id); return `<div class="phase-row"><div><strong style="font-size:15px">${ph.position} · ${esc(ph.name)}</strong>
          <span class="muted small">${on ? 'Visível ao paciente' : 'Bloqueada'}</span></div>
          <button type="button" class="toggle" data-phase="${ph.id}" aria-pressed="${on}">${on ? 'Liberada' : 'Liberar'}</button></div>`; }).join('')}
      </section>
      ${personalCard}
      ${wheelTherapistCard(wAcc, wEntries)}
      <section class="card"><h2>Metas combinadas</h2>${listRows(goals, 'goals', 'meta')}</section>
      <section class="card"><div class="row-between"><h2>Tarefas</h2><span class="muted small">${tasks.filter((t) => t.done).length} de ${tasks.length} feitas</span></div>${listRows(tasks, 'tasks', 'tarefa')}</section>
      ${moodChart(moodDiary, 'Bem-estar nas últimas semanas', 'Média do humor registrado pelo paciente no diário. Cada dia tem o mesmo peso, mesmo com vários registros.')}
      <h2 class="sec">Diário recente</h2>
      ${diary.length ? diary.map((e) => entryCard(e, !lastSessionAt || new Date(e.created_at) > lastSessionAt)).join('') : '<p class="muted">O paciente ainda não escreveu no diário.</p>'}
      <h2 class="sec">Sessões</h2>
      ${sessions.length ? sessions.map((s) => `<details class="card"><summary><span>${esc(fmtDate(s.session_date))} <span class="small">· ${seenTag('session', s.id)}</span></span></summary>
          ${s.summary ? `<h3 class="sub-h">Resumo</h3><p class="prose">${esc(s.summary)}</p>` : ''}
          ${s.weekly_task ? `<h3 class="sub-h">Tarefa</h3><p class="prose">${esc(s.weekly_task)}</p>
            <button type="button" class="btn sm ghost" data-clear-task="${s.id}">Remover tarefa desta sessão</button>` : ''}
          ${noteBy[s.id] ? `<h3 class="sub-h">Notas privadas</h3><p class="prose">${esc(noteBy[s.id])}</p>` : ''}
          <button type="button" class="btn sm danger" data-del-session="${s.id}">Apagar sessão</button></details>`).join('')
        : '<p class="muted">Nenhuma sessão registrada.</p>'}
      ${statusCard}`, 'pacientes');

    if ($('#deactivate')) $('#deactivate').addEventListener('click', async () => {
      if (!confirm(`Encerrar o acompanhamento de ${p.full_name || p.email}?\n\nO paciente perde o acesso ao site. Nada é apagado e você pode reativar quando quiser.`)) return;
      try { await q(sb.from('profiles').update({ active: false, deactivated_at: new Date().toISOString() }).eq('id', pid)); toast('Paciente inativado.'); viewPatient(pid); } catch (err) { /* toast */ }
    });
    if ($('#reactivate')) $('#reactivate').addEventListener('click', async () => {
      try { await q(sb.from('profiles').update({ active: true, deactivated_at: null }).eq('id', pid)); toast('Paciente reativado.'); viewPatient(pid); } catch (err) { /* toast */ }
    });
    bindPhoto('pphoto', pid, p.avatar_path, () => viewPatient(pid));
    bindReceipt(cs, p);
    bindTermsForm(pid, () => viewPatient(pid));
    if ($('#wheel-release')) $('#wheel-release').addEventListener('click', async () => {
      try { await q(sb.from('tool_access').insert({ patient_id: pid, tool: 'roda' })); toast('Roda da Vida liberada para o paciente.'); viewPatient(pid); } catch (err) { /* toast */ }
    });
    if ($('#wheel-revoke')) $('#wheel-revoke').addEventListener('click', async () => {
      if (!confirm('Remover o acesso do paciente à Roda da Vida? As rodas já preenchidas continuam guardadas.')) return;
      try { await q(sb.from('tool_access').delete().eq('patient_id', pid).eq('tool', 'roda')); viewPatient(pid); } catch (err) { /* toast */ }
    });
    if ($('#assignf')) $('#assignf').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await q(sb.from('content_patients').insert({ content_id: $('#assignsel').value, patient_id: pid })); toast('Conteúdo adicionado para o paciente.'); viewPatient(pid); } catch (err) { /* toast */ }
    });
    $$('[data-unassign]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Remover este conteúdo deste paciente?')) return;
      try { await q(sb.from('content_patients').delete().eq('content_id', b.dataset.unassign).eq('patient_id', pid)); viewPatient(pid); } catch (err) { /* toast */ }
    }));
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
      if (!confirm(table === 'goals' ? 'Remover esta meta do paciente?' : 'Remover esta tarefa do paciente?')) return;
      try { await q(sb.from(table).delete().eq('id', id)); toast(table === 'goals' ? 'Meta removida.' : 'Tarefa removida.'); viewPatient(pid); } catch (err) { /* toast */ }
    }));
    // Tarefas criadas a partir de uma sessão: as novas ficam ligadas a ela (session_id);
    // as antigas, criadas antes dessa ligação, são encontradas pelo mesmo texto.
    async function removeSessionTasks(sid) {
      const s = sessions.find((x) => x.id === sid);
      await q(sb.from('tasks').delete().eq('session_id', sid));
      if (s && s.weekly_task) await q(sb.from('tasks').delete().eq('patient_id', pid).is('session_id', null).eq('title', s.weekly_task));
    }
    $$('[data-clear-task]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Remover a tarefa desta sessão? Ela também sai da lista de tarefas do paciente.')) return;
      const sid = b.dataset.clearTask;
      try {
        await removeSessionTasks(sid);
        await q(sb.from('sessions').update({ weekly_task: null }).eq('id', sid));
        toast('Tarefa removida.');
        viewPatient(pid);
      } catch (err) { /* toast */ }
    }));
    $$('[data-del-session]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Apagar esta sessão, seus materiais e a tarefa criada a partir dela? Isso não pode ser desfeito.')) return;
      const sid = b.dataset.delSession;
      try {
        const mats = await q(sb.from('session_materials').select('file_path').eq('session_id', sid));
        const paths = mats.map((m) => m.file_path).filter(Boolean);
        if (paths.length) await sb.storage.from(BUCKET).remove(paths);
        await removeSessionTasks(sid);
        await q(sb.from('sessions').delete().eq('id', sid));
        toast('Sessão apagada.');
        viewPatient(pid);
      } catch (err) { /* toast */ }
    }));
  }

  // Terapeuta: ver o termo exatamente como o paciente vê
  async function viewPatientTerms(pid) {
    loading();
    const [p, t] = await Promise.all([
      q(sb.from('profiles').select('id,full_name,email').eq('id', pid).maybeSingle()),
      q(sb.from('patient_terms').select('*').eq('patient_id', pid).maybeSingle())
    ]);
    if (!p) { go('#/pacientes'); return; }
    shell(`${darkHeader('', 'Acordos do processo', p.full_name || p.email, ['#/paciente/' + pid, 'Ficha do paciente'])}
      ${t ? `<p class="muted small">Versão: ${esc(termsLabel(t))}. É exatamente este texto que o paciente lê e aceita.</p>
        <article class="card terms">${termsBody(t)}</article>`
        : `<section class="card"><p>As condições deste paciente ainda não foram definidas. Defina-as no tópico <strong>Termos</strong> da ficha.</p>
            <a class="btn sm" href="#/paciente/${pid}">Voltar à ficha</a></section>`}`, 'pacientes');
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
        if (weekly_task && $('#astask').checked) await q(sb.from('tasks').insert({ patient_id: pid, title: weekly_task, session_id: s.id }));
        toast('Sessão liberada para o paciente.');
        go('#/paciente/' + pid);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Liberar para o paciente';
      }
    });
  }

  /* --- formulário de conteúdo (novo e edição) --- */
  function contentFields(phases, c, patients, assigned) {
    c = c || {};
    patients = patients || [];
    assigned = assigned || new Set();
    const aud = c.audience || 'phase';
    const respect = c.respect_phase !== false;
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
      ${field('cfile', c.file_path ? 'Substituir por outro arquivo (opcional · até 50 MB)' : 'Arquivo (opcional · até 50 MB)', '<input id="cfile" type="file">')}
      <fieldset class="audience">
        <legend>Quem pode ver</legend>
        <label class="check-line"><input type="radio" name="aud" value="phase"${aud === 'phase' ? ' checked' : ''}> Todos os pacientes com esta fase liberada</label>
        <label class="check-line"><input type="radio" name="aud" value="selected"${aud === 'selected' ? ' checked' : ''}> Só pacientes escolhidos (personalizado)</label>
        <div id="selbox" class="selbox"${aud === 'selected' ? '' : ' hidden'}>
          ${patients.length ? patients.map((p) => `<label class="check-line"><input type="checkbox" name="pt" value="${p.id}"${assigned.has(p.id) ? ' checked' : ''}> ${esc(p.full_name || p.email)}${p.active === false ? ' <span class="muted small">(inativo)</span>' : ''}</label>`).join('')
            : '<p class="muted small">Nenhum paciente cadastrado ainda.</p>'}
          <label class="check-line respect"><input type="checkbox" id="respect"${respect ? ' checked' : ''}> Mostrar só quando esta fase estiver liberada para o paciente</label>
          <p class="muted small">Desmarcado, o conteúdo aparece para o paciente assim que você salvar.</p>
        </div>
      </fieldset>`;
  }

  function bindAudience() {
    $$('input[name=aud]').forEach((r) => r.addEventListener('change', () => {
      $('#selbox').hidden = $('input[name=aud]:checked').value !== 'selected';
    }));
  }

  async function syncAssignments(contentId, audience, selected) {
    await q(sb.from('content_patients').delete().eq('content_id', contentId));
    if (audience === 'selected' && selected.length) {
      await q(sb.from('content_patients').insert(selected.map((patient_id) => ({ content_id: contentId, patient_id }))));
    }
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
    const audience = $('input[name=aud]:checked').value;
    const selected = $$('input[name=pt]:checked').map((i) => i.value);
    if (audience === 'selected' && !selected.length) { toast('Escolha pelo menos um paciente para o conteúdo personalizado.', true); return null; }
    return {
      phase_id, file, remove: !!($('#cremove') && $('#cremove').checked), audience, selected,
      row: {
        phase_id, kind: $('#ckind').value, title,
        duration: $('#cdur').value.trim() || null,
        body: $('#cbody').value.trim() || null,
        url: url || null,
        audience,
        respect_phase: audience === 'selected' ? $('#respect').checked : true
      }
    };
  }

  async function viewEditContent(id) {
    loading();
    const [c, phases, patients, assigns] = await Promise.all([
      q(sb.from('contents').select('*').eq('id', id).maybeSingle()),
      q(sb.from('phases').select('*').order('position')),
      q(sb.from('profiles').select('id,full_name,email,active').eq('role', 'patient').order('full_name')),
      q(sb.from('content_patients').select('patient_id').eq('content_id', id))
    ]);
    if (!c) { toast('Conteúdo não encontrado.', true); go('#/biblioteca'); return; }

    shell(`<a class="back-l" href="#/biblioteca">${icon('back', 18)}Biblioteca</a>
      ${header('Editar conteúdo', 'As mudanças aparecem na hora para os pacientes')}
      <form id="ef" class="card stack">
        ${contentFields(phases, c, patients, new Set(assigns.map((a) => a.patient_id)))}
        <button class="btn" type="submit">Salvar alterações</button>
        <a class="btn ghost" href="#/conteudo/${c.id}">Ver como o paciente vê</a>
      </form>`, 'biblioteca');
    bindAudience();

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
        await syncAssignments(c.id, v.audience, v.selected);
        if (old && old !== file_path) await sb.storage.from(BUCKET).remove([old]);
        toast('Conteúdo atualizado.');
        go('#/biblioteca');
      } catch (err) { btn.disabled = false; btn.textContent = 'Salvar alterações'; }
    });
  }

  async function viewLibrary() {
    loading();
    const [phases, contents, patients, assigns] = await Promise.all([
      q(sb.from('phases').select('*').order('position')),
      q(sb.from('contents').select('*').order('created_at')),
      q(sb.from('profiles').select('id,full_name,email,active').eq('role', 'patient').order('full_name')),
      q(sb.from('content_patients').select('content_id'))
    ]);
    const countBy = {};
    assigns.forEach((a) => { countBy[a.content_id] = (countBy[a.content_id] || 0) + 1; });
    const audBadge = (c) => {
      if (c.audience !== 'selected') return '';
      const n = countBy[c.id] || 0;
      return `<span class="badge personal">Personalizado · ${n} ${n === 1 ? 'paciente' : 'pacientes'}${c.respect_phase ? '' : ' · já liberado'}</span>`;
    };

    shell(`${header('Biblioteca', 'Conteúdos de cada fase da jornada')}
      <details class="card" ${contents.length ? '' : 'open'}>
        <summary>+ Novo conteúdo</summary>
        <form id="cf" class="stack">
          ${contentFields(phases, null, patients)}
          <button class="btn" type="submit">Adicionar à biblioteca</button>
        </form>
      </details>
      ${phases.map((p) => {
        const items = contents.filter((c) => c.phase_id === p.id);
        return `<div class="row-between" style="margin-top:6px"><h2 class="sec" style="margin:0">Fase ${p.position} · ${esc(p.name)}</h2>
            <button type="button" class="btn-link" data-rename="${p.id}" aria-label="Renomear fase ${esc(p.name)}">Renomear</button></div>
          ${items.length ? items.map((c) => `<div class="item"><a class="thumb" href="#/conteudo/${c.id}" aria-label="Ver ${esc(c.title)}">${icon(kindIcon(c.kind))}</a>
            <a class="item-body" href="#/conteudo/${c.id}" style="text-decoration:none;color:inherit">${audBadge(c)}<strong>${esc(c.title)}</strong><span class="muted small">${KINDS[c.kind] || ''}${c.duration ? ' · ' + esc(c.duration) : ''}</span></a>
            <a class="icon-btn edit" href="#/biblioteca/editar/${c.id}" aria-label="Editar ${esc(c.title)}">${icon('pen', 18)}</a>
            <button type="button" class="icon-btn" data-delc="${c.id}" aria-label="Apagar ${esc(c.title)}">${icon('trash', 18)}</button></div>`).join('')
            : '<p class="muted small">Nenhum conteúdo nesta fase.</p>'}`;
      }).join('')}
      <form id="pf" class="card">
        <h2>Nova fase</h2>
        <div class="inline"><label class="sr" for="pnew">Nome da nova fase</label><input id="pnew" type="text" placeholder="Nome da fase" required><button class="btn sm" type="submit">Criar</button></div>
      </form>`, 'biblioteca');
    bindAudience();

    $('#cf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#cf button[type=submit]');
      const v = readContentForm();
      if (!v) return;
      btn.disabled = true;
      btn.textContent = v.file ? 'Enviando arquivo…' : 'Salvando…';
      try {
        const file_path = v.file ? await upload(`conteudos/${v.phase_id}/${uuid()}-${cleanName(v.file.name)}`, v.file) : null;
        const created = await q(sb.from('contents').insert({ ...v.row, file_path }).select('id').single());
        await syncAssignments(created.id, v.audience, v.selected);
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
  // Paciente inativo (acompanhamento encerrado): só vê esta mensagem
  function viewEnded() {
    loadingView = false;
    $app.innerHTML = `<main class="login maint">
      <div class="brand">${icon('leaf', 28)}</div>
      <h1>Seu acompanhamento foi encerrado</h1>
      <p class="lead">Obrigada por ter compartilhado essa jornada comigo. Seu acesso ao ${esc(APP)} foi encerrado, mas tudo o que construímos continua com você.</p>
      <p class="muted">Se quiser retomar o acompanhamento, é só entrar em contato com sua terapeuta. Seus registros continuam guardados com sigilo, e você pode pedir a exclusão dos seus dados a qualquer momento.</p>
      <button class="btn ghost" type="button" id="ended-out">Sair</button>
    </main>`;
    document.getElementById('ended-out').addEventListener('click', () => sb.auth.signOut());
  }

  async function route() {
    const h = location.hash || '#/';
    if (!me) return viewLogin();
    if (me.role === 'patient' && me.active === false) return viewEnded();
    let m;
    loadingView = true;
    try {
      if (h === '#/conta') return await viewAccount();
      if ((m = h.match(/^#\/conteudo\/([\w-]+)$/))) return await viewContent(m[1]);
      if (me.role === 'therapist') {
        if ((m = h.match(/^#\/paciente\/([\w-]+)\/nova-sessao$/))) return await viewNewSession(m[1]);
        if ((m = h.match(/^#\/paciente\/([\w-]+)\/termo$/))) return await viewPatientTerms(m[1]);
        if ((m = h.match(/^#\/paciente\/([\w-]+)\/roda-relatorio$/))) return await viewWheelReport(m[1]);
        if ((m = h.match(/^#\/paciente\/([\w-]+)$/))) return await viewPatient(m[1]);
        if ((m = h.match(/^#\/biblioteca\/editar\/([\w-]+)$/))) return await viewEditContent(m[1]);
        if (h === '#/biblioteca') return await viewLibrary();
        return await viewPatients();
      }
      if (h === '#/acordos') return await viewTerms();
      if (h === '#/roda') return await viewWheel();
      if (h === '#/conteudos') return await viewContents();
      if (h === '#/diario') return await viewDiary();
      if (h === '#/sessoes') return await viewSessions();
      return await viewHome();
    } catch (err) {
      loadingView = false;
      if (/JWT|expired/i.test(err && err.message)) { await sb.auth.signOut(); return; }
      viewMaintenance(err);
    }
  }

  // Qualquer erro inesperado que escape: nunca mostrar texto técnico ao paciente
  window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); e.preventDefault(); });

  sb.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') recovering = true;
    if (event === 'SIGNED_OUT') { me = null; recovering = false; if (location.hash !== '#/login') location.hash = '#/login'; else viewLogin(); }
  });
  window.addEventListener('hashchange', route);

  (async function boot() {
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (session) await loadMe();
    } catch (err) { return viewMaintenance(err); }
    if (/access_token|type=recovery|error_description/.test(location.hash)) {
      history.replaceState(null, '', location.pathname + (recovering && me ? '#/conta' : '#/'));
    }
    route();
  })();
})();
