// ─────────────────────────────────────────────────────────────
// CRM Jurídico — Frontend SPA (vanilla JS)
// ─────────────────────────────────────────────────────────────
const API = '';
let TOKEN = localStorage.getItem('crm_token') || null;
let USER = JSON.parse(localStorage.getItem('crm_user') || 'null');

// ── HTTP helper ──
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(API + path, { ...opts, headers });
  if (res.status === 401) { logout(); throw new Error('Sessão expirada'); }
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(data?.error || 'Erro na requisição');
  return data;
}

// ── Utils ──
const $ = (sel) => document.querySelector(sel);
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
const money = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('pt-BR') : '—';
const badge = (txt) => `<span class="badge ${txt}">${(txt || '').replace(/_/g, ' ')}</span>`;
function toast(msg, type = 'success') {
  const t = $('#toast'); t.textContent = msg; t.className = `toast ${type}`;
  setTimeout(() => t.classList.add('hidden'), 3000);
}
function openModal(title, bodyEl) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = ''; $('#modal-body').appendChild(bodyEl);
  $('#modal').classList.remove('hidden');
}
function closeModal() { $('#modal').classList.add('hidden'); }

// ── Auth ──
async function login(e) {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: $('#login-email').value, password: $('#login-password').value }),
    });
    TOKEN = data.token; USER = data.user;
    localStorage.setItem('crm_token', TOKEN);
    localStorage.setItem('crm_user', JSON.stringify(USER));
    showApp();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
}
function logout() {
  TOKEN = null; USER = null;
  localStorage.removeItem('crm_token'); localStorage.removeItem('crm_user');
  $('#app-view').classList.add('hidden');
  $('#login-view').classList.remove('hidden');
}
const NAV_LABELS = {
  dashboard: '📊 Dashboard', clients: '👥 Clientes', leads: '🎯 Leads',
  propostas: '📄 Propostas', cases: '⚖️ Processos', prazos: '📅 Prazos & Tarefas',
  agenda: '🗓️ Agenda', financeiro: '💰 Financeiro',
  config: '⚙️ Configurações', repasses: '💸 Meus Repasses', dativo: '🏛️ Dativo',
  contratos: '📜 Contratos', intakes: '📞 Novo Atendimento',
  portal: '📁 Meus Processos', portalFinanceiro: '💳 Valores a Pagar',
};
const NAV_BY_ROLE = {
  admin:      ['intakes','dashboard','leads','clients','propostas','contratos','cases','prazos','agenda','financeiro','dativo','config'],
  staff:      ['intakes','dashboard','leads','clients','propostas','contratos','cases','prazos','agenda','financeiro','dativo'],
  advogado:   ['intakes','dashboard','leads','clients','propostas','contratos','cases','prazos','agenda','financeiro','dativo'],
  estagiario: ['cases','prazos','agenda'],
  parceiro:   ['cases','repasses','prazos','agenda'],
  cliente:    ['portal','portalFinanceiro'],
};
function navForRole() { return NAV_BY_ROLE[USER?.role] || NAV_BY_ROLE.advogado; }

function buildNav() {
  const items = navForRole();
  $('#nav').innerHTML = items.map((r) =>
    `<a href="#${r}" class="nav-item ${r === 'intakes' ? 'nav-highlight' : ''}" data-route="${r}">${NAV_LABELS[r]}</a>`).join('');
}

let bellTimer = null;
function showApp() {
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  $('#user-name').textContent = `${USER?.name || ''}${USER?.role && USER.role !== 'advogado' ? ' · ' + USER.role : ''}`;
  buildNav();
  // rota padrão do papel
  const allowed = navForRole();
  const current = location.hash.replace('#', '');
  if (!allowed.includes(current)) location.hash = '#' + allowed[0];
  else router();
  refreshBell();
  if (bellTimer) clearInterval(bellTimer);
  bellTimer = setInterval(refreshBell, 60000); // atualiza o sino a cada 60s
}

async function refreshBell() {
  try {
    const { count } = await api('/api/notifications/count');
    const badge = $('#bell-count');
    if (count > 0) { badge.textContent = count; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
  } catch {}
}

async function openNotifications() {
  const wrap = el(`<div>
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <button class="btn-sm" id="notif-check">🔄 Verificar agora</button>
      <button class="btn-sm" id="notif-readall">Marcar todas como lidas</button>
      <button class="btn-sm" id="notif-settings">⚙️ Configurações</button>
    </div>
    <div id="notif-list"><div class="empty">Carregando…</div></div>
  </div>`);
  const loadList = async () => {
    const items = await api('/api/notifications');
    wrap.querySelector('#notif-list').innerHTML = items.length
      ? items.map((n) => `<div class="notif-item">
          <strong>${n.title}</strong>
          <p>${n.message}</p>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
            <small>${n.client_name ? n.client_name + ' · ' : ''}${fmtDate(n.scheduled_at)}</small>
            <button class="btn-sm" data-read="${n.id}">Marcar lida</button>
          </div></div>`).join('')
      : '<div class="empty">Nenhuma notificação</div>';
    wrap.querySelectorAll('[data-read]').forEach((b) => b.onclick = async () => {
      await api(`/api/notifications/${b.dataset.read}/read`, { method: 'PATCH' }); loadList(); refreshBell();
    });
  };
  wrap.querySelector('#notif-check').onclick = async () => {
    wrap.querySelector('#notif-check').textContent = '⏳ Verificando…';
    try { await api('/api/notifications/check', { method: 'POST' }); toast('Alertas atualizados'); } catch (e) { toast(e.message, 'error'); }
    wrap.querySelector('#notif-check').textContent = '🔄 Verificar agora';
    loadList(); refreshBell();
  };
  wrap.querySelector('#notif-readall').onclick = async () => {
    await api('/api/notifications/read-all', { method: 'PATCH' }); loadList(); refreshBell(); toast('Todas marcadas como lidas');
  };
  wrap.querySelector('#notif-settings').onclick = () => notificationSettings();
  openModal('Notificações', wrap);
  await loadList();
}

async function notificationSettings() {
  const [s, tg, wa] = await Promise.all([
    api('/api/notifications/settings'),
    api('/api/notifications/telegram'),
    api('/api/notifications/whatsapp'),
  ]);
  const form = el(`<div class="form-grid">
    <label style="flex-direction:row;align-items:center;gap:8px">
      <input type="checkbox" id="set-sound" ${s?.sound_enabled ? 'checked' : ''} style="width:auto"> Alertas sonoros ativados
    </label>
    ${field('Antecedência do lembrete (minutos)', 'reminder_minutes_before', { type: 'number', value: s?.reminder_minutes_before ?? 15 })}
    <button class="btn-primary" id="save-set">Salvar preferências</button>

    <hr style="border:none;border-top:1px solid var(--border);margin:6px 0">
    <strong style="color:var(--navy)">📲 Alertas via Telegram</strong>
    <small style="color:var(--text-muted)">Receba prazos, reuniões e cobranças no seu Telegram.</small>
    ${field('Bot Token', 'tg_token', { value: tg?.bot_token || '' })}
    ${field('Chat ID', 'tg_chat', { value: tg?.chat_id || '' })}
    <label style="flex-direction:row;align-items:center;gap:8px">
      <input type="checkbox" id="tg-enabled" ${tg?.enabled ? 'checked' : ''} style="width:auto"> Telegram ativado
    </label>
    <div style="display:flex;gap:8px">
      <button class="btn-primary" id="save-tg" style="flex:1">Salvar Telegram</button>
      <button class="btn-sm" id="test-tg">Enviar teste</button>
    </div>

    <hr style="border:none;border-top:1px solid var(--border);margin:6px 0">
    <strong style="color:var(--navy)">📱 Alertas via WhatsApp <span class="badge novo">preparado</span></strong>
    <small style="color:var(--text-muted)">Estrutura pronta para a WhatsApp Cloud API (Meta). Preencha quando tiver as credenciais do WhatsApp Business.</small>
    ${field('Access Token (Meta)', 'wa_token', { value: '' })}
    ${field('Phone Number ID', 'wa_phone_id', { value: wa?.phone_number_id || '' })}
    ${field('Telefone destino (com DDI, ex: 5511...)', 'wa_to', { value: wa?.recipient_phone || '' })}
    <label style="flex-direction:row;align-items:center;gap:8px">
      <input type="checkbox" id="wa-enabled" ${wa?.enabled ? 'checked' : ''} style="width:auto"> WhatsApp ativado
    </label>
    <button class="btn-sm" id="save-wa">Salvar WhatsApp</button>
  </div>`);

  form.querySelector('#save-set').onclick = async () => {
    const body = {
      sound_enabled: form.querySelector('#set-sound').checked,
      reminder_minutes_before: Number(form.querySelector('[name=reminder_minutes_before]').value) || 15,
    };
    try { await api('/api/notifications/settings', { method: 'PUT', body: JSON.stringify(body) }); toast('Preferências salvas'); } catch (e) { toast(e.message, 'error'); }
  };
  const saveTg = async () => {
    const body = {
      bot_token: form.querySelector('[name=tg_token]').value,
      chat_id: form.querySelector('[name=tg_chat]').value,
      enabled: form.querySelector('#tg-enabled').checked,
    };
    await api('/api/notifications/telegram', { method: 'PUT', body: JSON.stringify(body) });
  };
  form.querySelector('#save-tg').onclick = async () => {
    try { await saveTg(); toast('Telegram salvo'); } catch (e) { toast(e.message, 'error'); }
  };
  form.querySelector('#test-tg').onclick = async () => {
    try { await saveTg(); await api('/api/notifications/telegram/test', { method: 'POST' }); toast('Mensagem de teste enviada!'); }
    catch (e) { toast(e.message, 'error'); }
  };
  form.querySelector('#save-wa').onclick = async () => {
    const body = {
      access_token: form.querySelector('[name=wa_token]').value || undefined,
      phone_number_id: form.querySelector('[name=wa_phone_id]').value,
      recipient_phone: form.querySelector('[name=wa_to]').value,
      enabled: form.querySelector('#wa-enabled').checked,
    };
    try { await api('/api/notifications/whatsapp', { method: 'PUT', body: JSON.stringify(body) }); toast('WhatsApp salvo'); }
    catch (e) { toast(e.message, 'error'); }
  };
  openModal('Configurações de notificação', form);
}

// ── Router ──
function router() {
  const allowed = navForRole();
  let route = (location.hash.replace('#', '') || allowed[0]);
  if (!allowed.includes(route)) route = allowed[0]; // respeita o papel
  document.querySelectorAll('.nav-item').forEach((a) =>
    a.classList.toggle('active', a.dataset.route === route));
  const page = $('#page');
  page.innerHTML = '<div class="empty">Carregando…</div>';
  const fn = ROUTES[route] || ROUTES[allowed[0]];
  fn(page).catch((err) => page.innerHTML = `<div class="empty">${err.message}</div>`);
}

// ── Pages ──
const ROUTES = {
  async dashboard(page) {
    page.innerHTML = `
      <div class="page-header"><div><h2>Dashboards</h2><p class="sub">Visão gerencial do escritório</p></div></div>
      <div class="tabs" id="dash-tabs">
        <button class="tab active" data-tab="comercial">📊 Comercial</button>
        <button class="tab" data-tab="processual">⚖️ Processual</button>
        <button class="tab" data-tab="agenda">📅 Agenda</button>
        <button class="tab" data-tab="financeiro">💰 Financeiro</button>
        <button class="tab" data-tab="producao">📝 Produção</button>
      </div>
      <div id="dash-content"></div>`;
    const tabs = { comercial: dashComercial, processual: dashProcessual, agenda: dashAgenda, financeiro: dashFinanceiro, producao: dashProducao };
    const show = async (name) => {
      document.querySelectorAll('#dash-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
      const c = $('#dash-content'); c.innerHTML = '<div class="empty">Carregando…</div>';
      try { await tabs[name](c); } catch (e) { c.innerHTML = `<div class="empty">${e.message}</div>`; }
    };
    document.querySelectorAll('#dash-tabs .tab').forEach((t) => t.onclick = () => show(t.dataset.tab));
    await show('comercial');
  },

  async clients(page) {
    page.innerHTML = `
      <div class="page-header"><div><h2>Clientes</h2><p class="sub">Cadastro de clientes</p></div>
        <button class="btn-gold" id="new-client">+ Novo cliente</button></div>
      <div class="toolbar">
        <input id="cli-search" placeholder="Buscar por nome, CPF/CNPJ ou e-mail…" />
        <select id="cli-status"><option value="">Todos status</option><option value="ativo">Ativo</option><option value="inativo">Inativo</option><option value="prospecto">Prospecto</option></select>
      </div>
      <div class="card"><div id="cli-table"></div></div>`;
    const load = async () => {
      const q = new URLSearchParams();
      if ($('#cli-search').value) q.set('search', $('#cli-search').value);
      if ($('#cli-status').value) q.set('status', $('#cli-status').value);
      const r = await api('/api/clients?' + q);
      $('#cli-table').innerHTML = r.data.length ? `
        <table><thead><tr><th>Nome</th><th>Tipo</th><th>Contato</th><th>Status</th><th></th></tr></thead>
        <tbody>${r.data.map((c) => `<tr>
          <td><strong>${c.name}</strong> ${c.is_dative ? '<span class="badge dativo">DATIVO</span>' : ''}<br><small style="color:var(--text-muted)">${c.cpf_cnpj || ''}</small></td>
          <td>${c.tipo}</td><td>${c.phone || c.email || '—'}</td><td>${badge(c.status)}</td>
          <td><button class="btn-sm" data-edit="${c.id}">Editar</button></td></tr>`).join('')}</tbody></table>
        <div style="padding:12px 18px;color:var(--text-muted);font-size:13px">${r.total} cliente(s)</div>`
        : '<div class="empty">Nenhum cliente encontrado</div>';
      document.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => clientForm(b.dataset.edit, load));
    };
    $('#new-client').onclick = () => clientForm(null, load);
    $('#cli-search').oninput = debounce(load, 350);
    $('#cli-status').onchange = load;
    await load();
  },

  async leads(page) {
    page.innerHTML = `
      <div class="page-header"><div><h2>Leads</h2><p class="sub">Funil comercial</p></div>
        <button class="btn-gold" id="new-lead">+ Novo lead</button></div>
      <div id="board" class="kanban"></div>`;
    const cols = { triagem: 'Triagem', atendimento_inicial: 'Atendimento inicial', reuniao: 'Reunião', proposta: 'Produzir proposta', proposta_em_analise: 'Em análise' };
    const load = async () => {
      const b = await api('/api/leads/board');
      $('#board').innerHTML = Object.entries(cols).map(([k, label]) => `
        <div class="kanban-col"><h4>${label}<span class="count">${(b[k] || []).length}</span></h4>
        ${(b[k] || []).map((l) => `<div class="kanban-card" data-lead="${l.id}">
          <strong>${l.name}</strong><small>${l.legal_area || ''} · ${l.source || ''}</small></div>`).join('')}</div>`).join('');
      document.querySelectorAll('[data-lead]').forEach((c) => c.onclick = () => leadDetail(c.dataset.lead, load));
    };
    $('#new-lead').onclick = () => leadForm(load);
    await load();
  },

  async propostas(page) {
    page.innerHTML = `
      <div class="page-header"><div><h2>Propostas</h2><p class="sub">Honorários e parcelas</p></div>
        <button class="btn-gold" id="new-prop">+ Nova proposta</button></div>
      <div class="toolbar">
        <select id="prop-status"><option value="">Todos status</option>
          <option value="rascunho">Rascunho</option><option value="enviada">Enviada</option>
          <option value="em_negociacao">Em negociação</option><option value="aceita">Aceita</option>
          <option value="recusada">Recusada</option></select>
      </div>
      <div class="card"><div id="prop-table"></div></div>`;
    const load = async () => {
      const q = new URLSearchParams();
      if ($('#prop-status').value) q.set('status', $('#prop-status').value);
      const r = await api('/api/propostas?' + q);
      $('#prop-table').innerHTML = r.data.length ? `
        <table><thead><tr><th>Título</th><th>Cliente</th><th>Valor</th><th>Status</th><th>Validade</th><th></th></tr></thead>
        <tbody>${r.data.map((p) => `<tr>
          <td><strong>${p.title}</strong></td><td>${p.client_name || '—'}</td>
          <td>${money(p.valor)}</td><td>${badge(p.status)}</td><td>${fmtDate(p.validade)}</td>
          <td><button class="btn-sm" data-prop="${p.id}">Abrir</button></td></tr>`).join('')}</tbody></table>
        <div style="padding:12px 18px;color:var(--text-muted);font-size:13px">${r.total} proposta(s)</div>`
        : '<div class="empty">Nenhuma proposta ainda</div>';
      document.querySelectorAll('[data-prop]').forEach((b) => b.onclick = () => propostaDetail(b.dataset.prop, load));
    };
    $('#new-prop').onclick = () => propostaForm(load);
    $('#prop-status').onchange = load;
    await load();
  },

  async cases(page) {
    page.innerHTML = `
      <div class="page-header"><div><h2>Processos</h2><p class="sub">Casos e movimentações</p></div>
        <button class="btn-gold" id="new-case">+ Novo processo</button></div>
      <div class="toolbar">
        <input id="case-search" placeholder="Buscar por título ou número…" />
        <select id="case-status"><option value="">Todos status</option><option value="ativo">Ativo</option><option value="suspenso">Suspenso</option><option value="encerrado">Encerrado</option></select>
      </div>
      <div class="card"><div id="case-table"></div></div>`;
    const load = async () => {
      const q = new URLSearchParams();
      if ($('#case-search').value) q.set('search', $('#case-search').value);
      if ($('#case-status').value) q.set('status', $('#case-status').value);
      const r = await api('/api/cases?' + q);
      $('#case-table').innerHTML = r.data.length ? `
        <table><thead><tr><th>Processo</th><th>Cliente</th><th>Área</th><th>Fase</th><th>Status</th><th></th></tr></thead>
        <tbody>${r.data.map((c) => `<tr>
          <td><strong>${c.title}</strong><br><small style="color:var(--text-muted)">${c.case_number || 's/ número'}</small></td>
          <td>${c.client_name || '—'}</td><td>${c.legal_area}</td><td>${badge(c.phase)}</td><td>${badge(c.status)}</td>
          <td><button class="btn-sm" data-case="${c.id}">Abrir</button></td></tr>`).join('')}</tbody></table>
        <div style="padding:12px 18px;color:var(--text-muted);font-size:13px">${r.total} processo(s)</div>`
        : '<div class="empty">Nenhum processo ainda</div>';
      document.querySelectorAll('[data-case]').forEach((b) => b.onclick = () => caseDetail(b.dataset.case, load));
    };
    $('#new-case').onclick = () => caseForm(load);
    $('#case-search').oninput = debounce(load, 350);
    $('#case-status').onchange = load;
    await load();
  },

  async prazos(page) {
    page.innerHTML = `
      <div class="page-header"><div><h2>Prazos & Tarefas</h2><p class="sub">Contagem regressiva e prioridades</p></div>
        <div style="display:flex;gap:8px"><button class="btn-gold" id="new-deadline">+ Prazo</button>
        <button class="btn-gold" id="new-task">+ Tarefa</button></div></div>
      <div class="card" style="margin-bottom:20px"><div style="padding:14px 18px;border-bottom:1px solid var(--border)"><strong style="color:var(--navy)">⚖️ Prazos processuais</strong></div><div id="dl-table"></div></div>
      <div class="card"><div style="padding:14px 18px;border-bottom:1px solid var(--border)"><strong style="color:var(--navy)">✓ Tarefas</strong></div><div id="task-table"></div></div>`;

    const countdown = (days, label) => {
      if (label === 'vencido') return `<span class="badge vencido">vencido</span>`;
      const txt = days === 0 ? 'hoje' : days === 1 ? '1 dia' : `${days} dias`;
      return `<span class="badge ${label}">${txt}</span>`;
    };

    const loadDeadlines = async () => {
      const r = await api('/api/deadlines?status=pendente');
      $('#dl-table').innerHTML = r.data.length ? `
        <table><thead><tr><th>Prazo</th><th>Processo</th><th>Vencimento</th><th>Restam</th><th></th></tr></thead>
        <tbody>${r.data.map((d) => `<tr>
          <td><strong>${d.description}</strong></td><td>${d.client_name || d.case_number || '—'}</td>
          <td>${fmtDate(d.deadline_date)}</td><td>${countdown(d.days_remaining, d.status_label)}</td>
          <td><button class="btn-sm" data-done-dl="${d.id}">Cumprir</button></td></tr>`).join('')}</tbody></table>`
        : '<div class="empty">Nenhum prazo pendente</div>';
      document.querySelectorAll('[data-done-dl]').forEach((b) => b.onclick = async () => {
        try { await api(`/api/deadlines/${b.dataset.doneDl}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'cumprido' }) });
          toast('Prazo cumprido'); loadDeadlines(); } catch (e) { toast(e.message, 'error'); }
      });
    };

    const loadTasks = async () => {
      const r = await api('/api/tasks');
      $('#task-table').innerHTML = r.data.length ? `
        <table><thead><tr><th>Tarefa</th><th>Prioridade</th><th>Vencimento</th><th>Restam</th><th>Status</th><th></th></tr></thead>
        <tbody>${r.data.map((t) => `<tr>
          <td><strong>${t.title}</strong></td><td>${badge(t.priority)}</td>
          <td>${fmtDate(t.due_date)}</td><td>${t.due_date ? countdown(t.days_remaining, t.status_label) : '—'}</td>
          <td>${badge(t.status)}</td>
          <td>${t.status !== 'concluida' ? `<button class="btn-sm" data-done-task="${t.id}">Concluir</button>` : ''}</td></tr>`).join('')}</tbody></table>`
        : '<div class="empty">Nenhuma tarefa</div>';
      document.querySelectorAll('[data-done-task]').forEach((b) => b.onclick = async () => {
        try { await api(`/api/tasks/${b.dataset.doneTask}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'concluida' }) });
          toast('Tarefa concluída'); loadTasks(); } catch (e) { toast(e.message, 'error'); }
      });
    };

    $('#new-deadline').onclick = () => deadlineForm(loadDeadlines);
    $('#new-task').onclick = () => taskForm(loadTasks);
    await loadDeadlines(); await loadTasks();
  },

  async agenda(page) {
    let cursor = new Date(); cursor.setDate(1);
    const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const DOW = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

    page.innerHTML = `
      <div class="page-header"><div><h2>Agenda</h2><p class="sub">Eventos, prazos e tarefas</p></div>
        <div style="display:flex;gap:8px;align-items:center"><span id="google-area"></span>
        <button class="btn-gold" id="new-event">+ Evento / Reunião</button></div></div>
      <div class="cal-header">
        <button class="cal-nav" id="cal-prev">‹</button>
        <h3 id="cal-title"></h3>
        <button class="cal-nav" id="cal-next">›</button>
        <button class="btn-sm" id="cal-today">Hoje</button>
      </div>
      <div class="cal-grid" id="cal-dows">${DOW.map((d) => `<div class="cal-dow">${d}</div>`).join('')}</div>
      <div class="cal-grid" id="cal-body"></div>`;

    const render = async () => {
      const y = cursor.getFullYear(), m = cursor.getMonth();
      $('#cal-title').textContent = `${MESES[m]} ${y}`;
      const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
      const startGrid = new Date(first); startGrid.setDate(1 - first.getDay());
      const feed = await api(`/api/calendar/feed?start=${first.toISOString()}&end=${new Date(y, m + 1, 0, 23, 59).toISOString()}`);
      const byDay = {};
      feed.forEach((it) => { const k = new Date(it.datetime).toDateString(); (byDay[k] ??= []).push(it); });

      const today = new Date().toDateString();
      let html = '';
      for (let i = 0; i < 42; i++) {
        const d = new Date(startGrid); d.setDate(startGrid.getDate() + i);
        const other = d.getMonth() !== m ? 'other' : '';
        const isToday = d.toDateString() === today ? 'today' : '';
        const items = byDay[d.toDateString()] || [];
        const chips = items.slice(0, 4).map((it) => {
          const cls = (it.status_label === 'vencido' || it.status_label === 'urgente') ? it.status_label : it.type;
          const hora = ['reuniao','audiencia','compromisso'].includes(it.type) ? new Date(it.datetime).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) + ' ' : '';
          return `<div class="cal-chip ${cls}" title="${it.title}">${hora}${it.title}</div>`;
        }).join('');
        const more = items.length > 4 ? `<div class="cal-chip" style="color:var(--text-muted)">+${items.length - 4}</div>` : '';
        html += `<div class="cal-day ${other} ${isToday}"><span class="num">${d.getDate()}</span>${chips}${more}</div>`;
      }
      $('#cal-body').innerHTML = html;
    };

    const renderGoogle = async () => {
      let st = { connected: false };
      try { st = await api('/api/calendar/google/status'); } catch {}
      const area = $('#google-area');
      if (st.connected) {
        area.innerHTML = `<small style="color:var(--green)">🟢 ${st.google_email || 'Google conectado'}</small>
          <button class="btn-sm" id="g-sync">Sincronizar</button>`;
        $('#g-sync').onclick = async () => {
          try { const r = await api('/api/calendar/google/sync', { method: 'POST' });
            toast(`Sincronizado (${r.fromGoogle?.created || 0} novos)`); render(); } catch (e) { toast(e.message, 'error'); }
        };
      } else {
        area.innerHTML = `<button class="btn-sm" id="g-connect">🗓️ Conectar Google Agenda</button>`;
        $('#g-connect').onclick = async () => {
          try { const { url } = await api('/api/calendar/google/auth-url'); window.location.href = url; }
          catch (e) { toast(e.message === 'Integração Google não configurada no servidor' ? 'Google ainda não configurado no servidor' : e.message, 'error'); }
        };
      }
    };

    $('#cal-prev').onclick = () => { cursor.setMonth(cursor.getMonth() - 1); render(); };
    $('#cal-next').onclick = () => { cursor.setMonth(cursor.getMonth() + 1); render(); };
    $('#cal-today').onclick = () => { cursor = new Date(); cursor.setDate(1); render(); };
    $('#new-event').onclick = () => eventForm(render);
    await render();
    await renderGoogle();
  },

  async financeiro(page) {
    const s = await api('/api/financial/summary');
    page.innerHTML = `
      <div class="page-header"><div><h2>Financeiro</h2><p class="sub">Receitas, despesas e parcelas</p></div>
        <button class="btn-gold" id="new-fin">+ Lançamento</button></div>
      <div class="kpi-grid">
        ${kpi('Receita prevista', money(s.receita_prevista), 'money')}
        ${kpi('Receita realizada', money(s.receita_realizada), 'money')}
        ${kpi('Despesa prevista', money(s.despesa_prevista), 'money')}
        ${kpi('Despesa paga', money(s.despesa_paga), 'money')}
        ${kpi('Saldo previsto', money(s.saldo_previsto), 'money')}
        ${kpi('Saldo realizado', money(s.saldo_realizado), 'money')}
        ${kpi('Inadimplência', money(s.inadimplencia), 'money')}
      </div>
      <div class="card" style="margin-bottom:20px"><div style="padding:14px 18px;border-bottom:1px solid var(--border)"><strong style="color:var(--navy)">💸 Lançamentos</strong></div><div id="fin-table"></div></div>
      <div class="card"><div style="padding:14px 18px;border-bottom:1px solid var(--border)"><strong style="color:var(--navy)">📄 Parcelas a receber</strong></div><div id="inst-table"></div></div>`;

    const loadFin = async () => {
      const r = await api('/api/financial');
      $('#fin-table').innerHTML = r.data.length ? `
        <table><thead><tr><th>Descrição</th><th>Tipo</th><th>Valor</th><th>Vencimento</th><th>Status</th><th></th></tr></thead>
        <tbody>${r.data.map((f) => `<tr>
          <td><strong>${f.description}</strong>${f.cost_center ? `<br><small style="color:var(--text-muted)">${f.cost_center}</small>` : ''}</td>
          <td>${f.tipo === 'receita' ? '🟢 Receita' : '🔴 Despesa'}</td>
          <td>${money(f.valor)}</td><td>${fmtDate(f.due_date)}</td><td>${badge(f.status)}</td>
          <td>${f.status === 'pendente' ? `<button class="btn-sm" data-pay-fin="${f.id}">Dar baixa</button>` : ''}</td></tr>`).join('')}</tbody></table>`
        : '<div class="empty">Nenhum lançamento</div>';
      document.querySelectorAll('[data-pay-fin]').forEach((b) => b.onclick = async () => {
        try { await api(`/api/financial/${b.dataset.payFin}/pay`, { method: 'PATCH' }); toast('Baixa registrada'); ROUTES.financeiro(page); } catch (e) { toast(e.message, 'error'); }
      });
    };

    const loadInst = async () => {
      const r = await api('/api/financial/installments?status=pendente');
      $('#inst-table').innerHTML = r.length ? `
        <table><thead><tr><th>Parcela</th><th>Cliente</th><th>Valor</th><th>Vencimento</th><th></th></tr></thead>
        <tbody>${r.map((i) => `<tr>
          <td>${i.numero}ª — <small style="color:var(--text-muted)">${i.proposta_title || ''}</small></td>
          <td>${i.client_name || '—'}</td><td>${money(i.valor)}</td>
          <td>${fmtDate(i.due_date)} ${i.vencida ? '<span class="badge vencido">vencida</span>' : ''}</td>
          <td><button class="btn-sm" data-pay-inst="${i.id}">Receber</button></td></tr>`).join('')}</tbody></table>`
        : '<div class="empty">Nenhuma parcela pendente</div>';
      document.querySelectorAll('[data-pay-inst]').forEach((b) => b.onclick = async () => {
        try { await api(`/api/financial/installments/${b.dataset.payInst}/pay`, { method: 'PATCH' }); toast('Parcela recebida'); ROUTES.financeiro(page); } catch (e) { toast(e.message, 'error'); }
      });
    };

    $('#new-fin').onclick = () => financialForm(() => ROUTES.financeiro(page));
    await loadFin(); await loadInst();
  },

  async config(page) {
    page.innerHTML = `
      <div class="page-header"><div><h2>Configurações</h2><p class="sub">Usuários e conta</p></div>
        <button class="btn-gold" id="new-user">+ Novo usuário</button></div>
      <div class="card" style="margin-bottom:20px"><div id="users-table"></div></div>
      <div class="card" style="padding:20px">
        <h3 style="color:var(--navy);margin-bottom:12px">Minha conta</h3>
        <button class="btn-sm" id="change-pwd">🔒 Trocar minha senha</button>
      </div>`;
    const load = async () => {
      const users = await api('/api/users');
      $('#users-table').innerHTML = `
        <table><thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Detalhe</th><th>Status</th><th></th></tr></thead>
        <tbody>${users.map((u) => `<tr>
          <td><strong>${u.name}</strong></td><td>${u.email}</td><td>${badge(u.role)}</td>
          <td>${u.role === 'parceiro' ? (u.commission_percent || '?') + '% repasse' : u.role === 'cliente' ? (u.client_name || '—') : '—'}</td>
          <td>${u.active ? '<span class="badge ativo">ativo</span>' : '<span class="badge inativo">inativo</span>'}</td>
          <td>${u.role !== 'admin' ? `<button class="btn-sm" data-toggle="${u.id}" data-active="${u.active}">${u.active ? 'Desativar' : 'Ativar'}</button>` : ''}</td>
        </tr>`).join('')}</tbody></table>`;
      document.querySelectorAll('[data-toggle]').forEach((b) => b.onclick = async () => {
        await api('/api/users/' + b.dataset.toggle, { method: 'PUT', body: JSON.stringify({ active: b.dataset.active !== '1' }) });
        toast('Usuário atualizado'); load();
      });
    };
    $('#new-user').onclick = () => userForm(load);
    $('#change-pwd').onclick = () => changePasswordForm();
    await load();
  },

  async repasses(page) {
    const r = await api('/api/me/repasses');
    page.innerHTML = `
      <div class="page-header"><div><h2>Meus Repasses</h2><p class="sub">Repasse por processo</p></div></div>
      <div class="kpi-grid">
        ${kpi('Repasse previsto', money(r.total_previsto), 'money')}
        ${kpi('Repasse realizado', money(r.total_realizado), 'money')}
      </div>
      <div class="card"><div>${r.processos.length ? `
        <table><thead><tr><th>Processo</th><th>Cliente</th><th>%</th><th>Recebido</th><th>Repasse realizado</th><th>Repasse previsto</th></tr></thead>
        <tbody>${r.processos.map((p) => `<tr>
          <td><strong>${p.title}</strong></td><td>${p.client_name || '—'}</td><td>${p.commission_percent}%</td>
          <td>${money(p.recebido_caso)}</td><td>${money(p.repasse_realizado)}</td><td>${money(p.repasse_previsto)}</td></tr>`).join('')}</tbody></table>`
        : '<div class="empty">Você ainda não tem processos com repasse definido</div>'}</div></div>`;
  },

  async portal(page) {
    const me = await api('/api/portal/me');
    const cases = await api('/api/portal/cases');
    page.innerHTML = `
      <div class="page-header"><div><h2>Olá, ${me.name}</h2><p class="sub">Acompanhe seus processos</p></div></div>
      <div class="kpi-grid">
        ${kpi('Processos ativos', me.resumo.processos_ativos)}
        ${kpi('Valores a pagar', money(me.resumo.a_pagar), 'money')}
        ${kpi('Em atraso', money(me.resumo.vencido), 'money')}
      </div>
      <div class="card"><div id="portal-cases"></div></div>`;
    $('#portal-cases').innerHTML = cases.length ? `
      <table><thead><tr><th>Processo</th><th>Área</th><th>Fase</th><th>Status</th><th></th></tr></thead>
      <tbody>${cases.map((c) => `<tr>
        <td><strong>${c.title}</strong><br><small style="color:var(--text-muted)">${c.case_number || ''}</small></td>
        <td>${c.legal_area}</td><td>${badge(c.phase)}</td><td>${badge(c.status)}</td>
        <td><button class="btn-sm" data-pcase="${c.id}">Ver andamento</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Nenhum processo no momento</div>';
    document.querySelectorAll('[data-pcase]').forEach((b) => b.onclick = () => portalCaseDetail(b.dataset.pcase));
  },

  async portalFinanceiro(page) {
    const items = await api('/api/portal/financial');
    const totalPagar = items.filter((i) => i.status === 'pendente').reduce((s, i) => s + Number(i.valor), 0);
    page.innerHTML = `
      <div class="page-header"><div><h2>Valores a Pagar</h2><p class="sub">Suas parcelas</p></div></div>
      <div class="kpi-grid">${kpi('Total a pagar', money(totalPagar), 'money')}</div>
      <div class="card"><div>${items.length ? `
        <table><thead><tr><th>Parcela</th><th>Referência</th><th>Valor</th><th>Vencimento</th><th>Status</th></tr></thead>
        <tbody>${items.map((i) => `<tr>
          <td>${i.numero}ª</td><td>${i.proposta || '—'}</td><td>${money(i.valor)}</td>
          <td>${fmtDate(i.due_date)} ${i.vencida ? '<span class="badge vencido">vencida</span>' : ''}</td>
          <td>${badge(i.status)}</td></tr>`).join('')}</tbody></table>`
        : '<div class="empty">Nenhuma parcela registrada</div>'}</div></div>`;
  },

  async contratos(page) {
    page.innerHTML = `
      <div class="page-header"><div><h2>Contratos</h2><p class="sub">Produção por área jurídica</p></div>
        <button class="btn-gold" id="new-contract">+ Novo contrato</button></div>
      <div class="toolbar">
        <select id="ct-status"><option value="">Todos status</option>
          <option value="rascunho">Rascunho</option><option value="em_producao">Em produção</option>
          <option value="finalizado">Finalizado</option><option value="assinado">Assinado</option></select>
      </div>
      <div class="card"><div id="ct-table"></div></div>`;
    const load = async () => {
      const q = $('#ct-status').value ? '?status=' + $('#ct-status').value : '';
      const rows = await api('/api/contracts' + q);
      $('#ct-table').innerHTML = rows.length ? `
        <table><thead><tr><th>Contrato</th><th>Cliente</th><th>Área</th><th>Valor</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows.map((ct) => `<tr>
          <td><strong>${ct.title}</strong></td><td>${ct.client_name || '—'}</td><td>${badge(ct.area)}</td>
          <td>${ct.value ? money(ct.value) : '—'}</td><td>${badge(ct.status)}</td>
          <td><button class="btn-sm" data-ct="${ct.id}">Abrir / Editar</button></td></tr>`).join('')}</tbody></table>`
        : '<div class="empty">Nenhum contrato. Feche um lead ou crie um novo.</div>';
      document.querySelectorAll('[data-ct]').forEach((b) => b.onclick = () => contractEditor(b.dataset.ct, load));
    };
    $('#new-contract').onclick = () => contractForm(load);
    $('#ct-status').onchange = load;
    await load();
  },

  async dativo(page) {
    page.innerHTML = `
      <div class="page-header"><div><h2>Advocacia Dativa</h2><p class="sub">Nomeações do Estado — separado dos honorários</p></div></div>
      <div class="tabs" id="dat-tabs">
        <button class="tab active" data-tab="projecao">📈 Projeção</button>
        <button class="tab" data-tab="demandas">📋 Demandas</button>
        <button class="tab" data-tab="audiencias">⚖️ Audiências</button>
        <button class="tab" data-tab="recebimentos">💵 Recebimentos</button>
      </div>
      <div id="dat-content"></div>`;
    const tabs = { projecao: datProjecao, demandas: datDemandas, audiencias: datAudiencias, recebimentos: datRecebimentos };
    const show = async (name) => {
      document.querySelectorAll('#dat-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
      const c = $('#dat-content'); c.innerHTML = '<div class="empty">Carregando…</div>';
      try { await tabs[name](c); } catch (e) { c.innerHTML = `<div class="empty">${e.message}</div>`; }
    };
    document.querySelectorAll('#dat-tabs .tab').forEach((t) => t.onclick = () => show(t.dataset.tab));
    await show('projecao');
  },

  async intakes(page) {
    page.innerHTML = `
      <div class="page-header"><div><h2>Atendimentos</h2><p class="sub">Primeiro contato e triagem</p></div>
        <button class="btn-gold" id="new-intake">+ Novo atendimento</button></div>
      <div class="card"><div id="int-table"></div></div>`;
    const load = async () => {
      const r = await api('/api/intakes');
      $('#int-table').innerHTML = r.data.length ? `
        <table><thead><tr><th>Contato</th><th>Área</th><th>Origem</th><th>Urgência</th><th>Status</th></tr></thead>
        <tbody>${r.data.map((i) => `<tr>
          <td><strong>${i.contact_name}</strong><br><small style="color:var(--text-muted)">${i.phone || ''}</small></td>
          <td>${i.legal_area}</td><td>${i.source}</td><td>${badge(i.urgency)}</td><td>${badge(i.status)}</td></tr>`).join('')}</tbody></table>
        <div style="padding:12px 18px;color:var(--text-muted);font-size:13px">${r.total} atendimento(s)</div>`
        : '<div class="empty">Nenhum atendimento ainda</div>';
    };
    $('#new-intake').onclick = () => intakeForm(load);
    await load();
  },
};

function kpi(label, value, cls = '') {
  return `<div class="kpi"><div class="label">${label}</div><div class="value ${cls}">${value ?? 0}</div></div>`;
}

function miniList(title, rows) {
  return `<div class="dash-section"><h3>${title}</h3><div class="mini-list">${
    rows && rows.length ? rows.join('') : '<div class="mini-row"><small>Sem registros</small></div>'
  }</div></div>`;
}

async function dashComercial(c) {
  const d = await api('/api/dashboards/comercial');
  c.innerHTML = `
    <div class="kpi-grid">
      ${kpi('Leads hoje', d.leads_hoje)}${kpi('Total de leads', d.leads_total)}
      ${kpi('Propostas enviadas', d.propostas_enviadas)}${kpi('Propostas aceitas', d.propostas_aceitas)}
      ${kpi('Taxa de conversão', d.taxa_conversao)}${kpi('Valor em aberto', money(d.valor_potencial_aberto), 'money')}
      ${kpi('Reuniões marcadas', d.reunioes_marcadas)}${kpi('Propostas vencendo', d.propostas_vencendo)}
    </div>
    ${miniList('Leads por status', (d.leads_por_status || []).map((s) => `<div class="mini-row">${badge(s.status)}<strong>${s.total}</strong></div>`))}`;
}

async function dashProcessual(c) {
  const d = await api('/api/dashboards/processual');
  c.innerHTML = `
    <div class="kpi-grid">
      ${kpi('Processos ativos', d.totais?.ativos)}${kpi('Suspensos', d.totais?.suspensos)}
      ${kpi('Encerrados', d.totais?.encerrados)}${kpi('Peças pendentes', d.pecas_pendentes)}
    </div>
    ${miniList('Processos por área', (d.processos_por_area || []).map((a) => `<div class="mini-row">${badge(a.legal_area)}<strong>${a.total}</strong></div>`))}
    ${miniList('Prazos próximos', (d.prazos_proximos || []).map((p) => `<div class="mini-row"><span>${p.description}<br><small>${p.client_name || ''}</small></span><span>${badge(p.status_label || 'normal')}</span></div>`))}
    ${miniList('Audiências agendadas', (d.audiencias_agendadas || []).map((a) => `<div class="mini-row"><span>${a.title}<br><small>${a.client_name || ''}</small></span><small>${fmtDate(a.start_datetime)}</small></div>`))}
    ${miniList('Movimentações recentes', (d.movimentacoes_recentes || []).map((m) => `<div class="mini-row"><span>${m.description}<br><small>${m.case_number || ''}</small></span><small>${fmtDate(m.created_at)}</small></div>`))}`;
}

async function dashAgenda(c) {
  const d = await api('/api/dashboards/agenda');
  const cr = d.contagem_regressiva || {};
  c.innerHTML = `
    <div class="kpi-grid">
      ${kpi('Vencidos', cr.vencidos)}${kpi('Urgentes', cr.urgentes)}
      ${kpi('Atenção', cr.atencao)}${kpi('Normais', cr.normais)}
    </div>
    ${miniList('Prazos de hoje', (d.prazos_hoje || []).map((p) => `<div class="mini-row"><span>${p.description}</span>${badge(p.status_label || 'urgente')}</div>`))}
    ${miniList('Compromissos do dia', (d.compromissos_dia || []).map((e) => `<div class="mini-row"><span>${e.title}<br><small>${e.client_name || ''}</small></span><small>${fmtDate(e.start_datetime)}</small></div>`))}
    ${miniList('Tarefas por prioridade', (d.tarefas_por_prioridade || []).slice(0, 8).map((t) => `<div class="mini-row"><span>${t.title}</span>${badge(t.priority)}</div>`))}`;
}

async function dashFinanceiro(c) {
  const [s, d] = await Promise.all([api('/api/financial/summary'), api('/api/dashboards/financeiro')]);
  c.innerHTML = `
    <div class="kpi-grid">
      ${kpi('Receita prevista', money(s.receita_prevista), 'money')}${kpi('Receita realizada', money(s.receita_realizada), 'money')}
      ${kpi('Despesa prevista', money(s.despesa_prevista), 'money')}${kpi('Despesa paga', money(s.despesa_paga), 'money')}
      ${kpi('Saldo previsto', money(s.saldo_previsto), 'money')}${kpi('Saldo realizado', money(s.saldo_realizado), 'money')}
      ${kpi('Inadimplência', money(s.inadimplencia), 'money')}
    </div>
    ${miniList('Resultado por área jurídica', (d.resultado_por_area || []).map((a) => `<div class="mini-row"><span>${a.legal_area}</span><strong>${money(a.receitas)}</strong></div>`))}
    ${miniList('Previsão (próximos meses)', (d.previsao_mensal || []).slice(0, 6).map((m) => `<div class="mini-row"><span>${m.mes}</span><span style="color:var(--green)">${money(m.receitas)} <small style="color:var(--red)">- ${money(m.despesas)}</small></span></div>`))}`;
}

async function dashProducao(c) {
  const d = await api('/api/dashboards/producao');
  const p = d.pecas_por_status || {};
  c.innerHTML = `
    <div class="kpi-grid">
      ${kpi('Rascunho', p.rascunho)}${kpi('Em produção', p.producao)}${kpi('Em revisão', p.revisao)}
      ${kpi('Finalizadas', p.finalizado)}${kpi('Protocoladas', p.protocolado)}
    </div>
    ${miniList('Produtividade por responsável', (d.produtividade_por_responsavel || []).map((r) => `<div class="mini-row"><span>${r.responsavel}</span><span><strong>${r.concluidas}</strong> concluídas / ${r.em_andamento} em andamento</span></div>`))}
    ${miniList('Peças vencendo prazo', (d.pecas_vencendo_prazo || []).map((pc) => `<div class="mini-row"><span>${pc.title}<br><small>${pc.client_name || ''}</small></span>${badge(pc.status_label || 'atencao')}</div>`))}`;
}

// ── Forms ──
function field(label, name, opts = {}) {
  const { type = 'text', value = '', options } = opts;
  if (options) return `<label>${label}<select name="${name}">${options.map((o) =>
    `<option value="${o.v}" ${o.v === value ? 'selected' : ''}>${o.t}</option>`).join('')}</select></label>`;
  if (type === 'textarea') return `<label>${label}<textarea name="${name}" rows="3">${value || ''}</textarea></label>`;
  return `<label>${label}<input type="${type}" name="${name}" value="${value ?? ''}" /></label>`;
}
const AREAS = [['outro','Outro'],['trabalhista','Trabalhista'],['gestante','Gestante/Maternidade'],['familia','Família'],['civel','Cível'],['previdenciario','Previdenciário'],['consumidor','Consumidor']].map(([v,t])=>({v,t}));

async function clientForm(id, onSave) {
  let c = { name: '', tipo: 'PF', cpf_cnpj: '', email: '', phone: '', address: '', status: 'ativo' };
  if (id) c = await api('/api/clients/' + id);
  const form = el(`<form class="form-grid">
    ${field('Nome *', 'name', { value: c.name })}
    <div class="form-row">
      ${field('Tipo', 'tipo', { value: c.tipo, options: [{v:'PF',t:'Pessoa Física'},{v:'PJ',t:'Pessoa Jurídica'}] })}
      ${field('CPF/CNPJ', 'cpf_cnpj', { value: c.cpf_cnpj })}
    </div>
    <div class="form-row">${field('E-mail', 'email', { value: c.email, type: 'email' })}${field('Telefone', 'phone', { value: c.phone })}</div>
    ${field('Endereço', 'address', { value: c.address })}
    ${field('Status', 'status', { value: c.status, options: [{v:'ativo',t:'Ativo'},{v:'inativo',t:'Inativo'},{v:'prospecto',t:'Prospecto'}] })}
    <button type="submit" class="btn-primary">${id ? 'Salvar' : 'Cadastrar'}</button>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    try {
      await api(id ? '/api/clients/' + id : '/api/clients', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
      closeModal(); toast(id ? 'Cliente atualizado' : 'Cliente cadastrado'); onSave();
    } catch (err) { toast(err.message, 'error'); }
  };
  openModal(id ? 'Editar cliente' : 'Novo cliente', form);
}

async function leadForm(onSave) {
  const form = el(`<form class="form-grid">
    ${field('Nome *', 'name')}
    <div class="form-row">${field('E-mail', 'email', { type: 'email' })}${field('Telefone', 'phone')}</div>
    <div class="form-row">${field('Área', 'legal_area', { options: AREAS })}${field('Origem', 'source')}</div>
    <button type="submit" class="btn-primary">Cadastrar lead</button>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/leads', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      closeModal(); toast('Lead cadastrado'); onSave();
    } catch (err) { toast(err.message, 'error'); }
  };
  openModal('Novo lead', form);
}

async function leadDetail(id, onSave) {
  const l = await api('/api/leads/' + id);
  const stages = [['triagem','Triagem'],['atendimento_inicial','Atendimento inicial'],['reuniao','Reunião'],['proposta','Produzir proposta'],['proposta_em_analise','Proposta em análise'],['perdida','Perdida']];
  const form = el(`<div class="form-grid">
    <div><strong style="font-size:18px">${l.name}</strong><br><small style="color:var(--text-muted)">${l.source || ''}</small></div>
    <div>${l.phone || ''} ${l.email ? '· ' + l.email : ''}</div>
    ${field('Área jurídica (definir após triagem)', 'legal_area', { value: l.legal_area || 'outro', options: AREAS })}
    <button class="btn-sm" id="save-area">Salvar área</button>
    <hr style="border:none;border-top:1px solid var(--border)">
    ${field('Mover no funil', 'status', { value: l.status, options: stages.map(([v,t])=>({v,t})) })}
    <button class="btn-primary" id="move">Atualizar etapa</button>
    <hr style="border:none;border-top:1px solid var(--border)">
    <button class="btn-gold" id="close" style="width:100%">✅ Fechar negócio e gerar contrato</button>
  </div>`);
  form.querySelector('#save-area').onclick = async () => {
    try { await api('/api/leads/' + id, { method: 'PUT', body: JSON.stringify({ legal_area: form.querySelector('[name=legal_area]').value }) });
      toast('Área salva'); } catch (e) { toast(e.message, 'error'); }
  };
  form.querySelector('#move').onclick = async () => {
    try { await api(`/api/leads/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: form.querySelector('[name=status]').value }) });
      closeModal(); toast('Etapa atualizada'); onSave(); } catch (e) { toast(e.message, 'error'); }
  };
  form.querySelector('#close').onclick = async () => {
    try {
      const ct = await api(`/api/contracts/from-lead/${id}`, { method: 'POST', body: JSON.stringify({}) });
      closeModal(); toast('Negócio fechado! Contrato gerado.'); onSave();
      location.hash = '#contratos';
      setTimeout(() => contractEditor(ct.id), 400);
    } catch (e) { toast(e.message, 'error'); }
  };
  openModal('Lead', form);
}

async function intakeForm(onSave) {
  const form = el(`<form class="form-grid">
    ${field('Nome do contato *', 'contact_name')}
    <div class="form-row">${field('Telefone', 'phone')}${field('E-mail', 'email', { type: 'email' })}</div>
    <div class="form-row">${field('Área', 'legal_area', { options: AREAS })}
      ${field('Origem', 'source', { options: [['outro','Outro'],['telefone','Telefone'],['whatsapp','WhatsApp'],['site','Site'],['indicacao','Indicação'],['instagram','Instagram'],['google','Google'],['presencial','Presencial']].map(([v,t])=>({v,t})) })}</div>
    ${field('Urgência', 'urgency', { options: [['media','Média'],['alta','Alta'],['baixa','Baixa']].map(([v,t])=>({v,t})) })}
    ${field('Relato do caso', 'report', { type: 'textarea' })}
    <button type="submit" class="btn-primary">Registrar atendimento</button>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/intakes', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      closeModal(); toast('Atendimento registrado'); onSave();
    } catch (err) { toast(err.message, 'error'); }
  };
  openModal('Novo atendimento', form);
}

async function propostaForm(onSave) {
  const clients = await api('/api/clients?limit=100');
  const opts = clients.data.map((c) => ({ v: c.id, t: c.name }));
  const form = el(`<form class="form-grid">
    ${field('Cliente *', 'client_id', { options: opts })}
    ${field('Título *', 'title')}
    <div class="form-row">${field('Valor (R$)', 'valor', { type: 'number' })}${field('Validade', 'validade', { type: 'date' })}</div>
    ${field('Descrição', 'description', { type: 'textarea' })}
    <button type="submit" class="btn-primary">Criar proposta</button>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/propostas', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      closeModal(); toast('Proposta criada'); onSave();
    } catch (err) { toast(err.message, 'error'); }
  };
  openModal('Nova proposta', form);
}

async function propostaDetail(id, onSave) {
  const p = await api('/api/propostas/' + id);
  const parcelasHtml = (p.installments || []).length
    ? `<div style="margin-top:8px"><strong style="font-size:13px">Parcelas</strong>
       <table style="margin-top:6px"><tbody>${p.installments.map((i) =>
        `<tr><td>${i.numero}ª</td><td>${money(i.valor)}</td><td>${fmtDate(i.due_date)}</td><td>${badge(i.status)}</td></tr>`).join('')}</tbody></table></div>`
    : '';
  const isAceita = p.status === 'aceita';
  const form = el(`<div class="form-grid">
    <div><strong style="font-size:18px">${p.title}</strong><br>
      <small style="color:var(--text-muted)">${p.client_name || ''} · ${money(p.valor)}</small></div>
    <div>Status atual: ${badge(p.status)}</div>
    ${parcelasHtml}
    ${isAceita ? '' : `
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-sm" data-st="enviada">Marcar enviada</button>
        <button class="btn-sm" data-st="em_negociacao">Em negociação</button>
        <button class="btn-sm" data-st="recusada">Recusar</button>
      </div>
      <hr style="border:none;border-top:1px solid var(--border)">
      <strong style="font-size:13px">Aceitar e gerar parcelas</strong>
      <div class="form-row">
        ${field('Nº de parcelas', 'installments_count', { type: 'number', value: 1 })}
        ${field('1º vencimento', 'first_due_date', { type: 'date' })}
      </div>
      <button class="btn-primary" id="accept">Aceitar proposta</button>`}
  </div>`);

  form.querySelectorAll('[data-st]').forEach((b) => b.onclick = async () => {
    try { await api(`/api/propostas/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: b.dataset.st }) });
      closeModal(); toast('Status atualizado'); onSave(); } catch (e) { toast(e.message, 'error'); }
  });
  const acceptBtn = form.querySelector('#accept');
  if (acceptBtn) acceptBtn.onclick = async () => {
    const count = form.querySelector('[name=installments_count]').value;
    const due = form.querySelector('[name=first_due_date]').value;
    try { await api(`/api/propostas/${id}/accept`, { method: 'POST', body: JSON.stringify({ installments_count: count, first_due_date: due }) });
      closeModal(); toast('Proposta aceita — parcelas geradas'); onSave(); } catch (e) { toast(e.message, 'error'); }
  };
  openModal('Proposta', form);
}

const PHASES = [['inicial','Inicial'],['instrucao','Instrução'],['sentenca','Sentença'],['recurso','Recurso'],['execucao','Execução'],['encerrado','Encerrado']].map(([v,t])=>({v,t}));

async function caseForm(onSave) {
  const clients = await api('/api/clients?limit=100');
  const form = el(`<form class="form-grid">
    ${field('Cliente *', 'client_id', { options: clients.data.map((c) => ({ v: c.id, t: c.name })) })}
    ${field('Título *', 'title')}
    ${field('Número do processo', 'case_number')}
    <div class="form-row">${field('Área', 'legal_area', { options: AREAS })}${field('Fase', 'phase', { options: PHASES })}</div>
    ${field('Descrição', 'description', { type: 'textarea' })}
    <button type="submit" class="btn-primary">Criar processo</button>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/cases', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      closeModal(); toast('Processo criado'); onSave();
    } catch (err) { toast(err.message, 'error'); }
  };
  openModal('Novo processo', form);
}

async function caseDetail(id, onSave) {
  const c = await api('/api/cases/' + id);
  const movs = (c.movements || []).map((m) =>
    `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
      <small style="color:var(--text-muted)">${fmtDate(m.movement_date || m.created_at)}</small>
      <div>${m.description}</div></div>`).join('') || '<p class="empty">Sem movimentações</p>';
  const form = el(`<div class="form-grid">
    <div><strong style="font-size:18px">${c.title}</strong><br>
      <small style="color:var(--text-muted)">${c.client_name || ''} · ${c.case_number || 's/ número'}</small></div>
    <div>${badge(c.legal_area)} ${badge(c.phase)} ${badge(c.status)}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <select id="case-phase">${PHASES.map((p)=>`<option value="${p.v}" ${p.v===c.phase?'selected':''}>${p.t}</option>`).join('')}</select>
      <button class="btn-sm" id="upd-phase">Atualizar fase</button>
    </div>
    <hr style="border:none;border-top:1px solid var(--border)">
    <strong style="font-size:13px">Equipe do processo</strong>
    <div id="collab-area"></div>
    <hr style="border:none;border-top:1px solid var(--border)">
    <strong style="font-size:13px">Movimentações</strong>
    <div style="max-height:200px;overflow-y:auto">${movs}</div>
    <textarea id="mov-desc" rows="2" placeholder="Nova movimentação processual…"></textarea>
    <button class="btn-primary" id="add-mov">Registrar movimentação</button>
  </div>`);

  // Equipe / colaboradores
  const loadCollabs = async () => {
    const collabs = await api(`/api/cases/${id}/collaborators`);
    const area = form.querySelector('#collab-area');
    const list = collabs.map((cc) => `<div class="mini-row" style="padding:6px 0">
      <span>${cc.name} <small>(${cc.user_role}${cc.commission_percent ? ' · ' + cc.commission_percent + '%' : ''})</small></span>
      ${USER.role === 'admin' ? `<button class="btn-sm" data-rmcol="${cc.user_id}">remover</button>` : ''}</div>`).join('') || '<small style="color:var(--text-muted)">Ninguém atribuído</small>';
    let assign = '';
    if (USER.role === 'admin') {
      const users = await api('/api/users');
      const assignable = users.filter((u) => ['estagiario','parceiro','advogado'].includes(u.role) && u.active);
      assign = `<div style="display:flex;gap:6px;margin-top:8px">
        <select id="collab-user">${assignable.map((u) => `<option value="${u.id}">${u.name} (${u.role})</option>`).join('')}</select>
        <button class="btn-sm" id="add-collab">Atribuir</button></div>`;
    }
    area.innerHTML = list + assign;
    area.querySelectorAll('[data-rmcol]').forEach((b) => b.onclick = async () => {
      await api(`/api/cases/${id}/collaborators/${b.dataset.rmcol}`, { method: 'DELETE' }); loadCollabs();
    });
    const addBtn = area.querySelector('#add-collab');
    if (addBtn) addBtn.onclick = async () => {
      const uid = area.querySelector('#collab-user').value;
      try { await api(`/api/cases/${id}/collaborators`, { method: 'POST', body: JSON.stringify({ user_id: uid }) });
        toast('Atribuído'); loadCollabs(); } catch (e) { toast(e.message, 'error'); }
    };
  };
  loadCollabs();

  form.querySelector('#upd-phase').onclick = async () => {
    try { await api('/api/cases/' + id, { method: 'PUT', body: JSON.stringify({ phase: form.querySelector('#case-phase').value }) });
      closeModal(); toast('Fase atualizada'); onSave(); } catch (e) { toast(e.message, 'error'); }
  };
  form.querySelector('#add-mov').onclick = async () => {
    const desc = form.querySelector('#mov-desc').value;
    if (!desc.trim()) { toast('Escreva a movimentação', 'error'); return; }
    try { await api(`/api/cases/${id}/movements`, { method: 'POST', body: JSON.stringify({ description: desc }) });
      caseDetail(id, onSave); toast('Movimentação registrada'); } catch (e) { toast(e.message, 'error'); }
  };
  openModal('Processo', form);
}

const PRIORITIES = [['media','Média'],['alta','Alta'],['critica','Crítica'],['baixa','Baixa']].map(([v,t])=>({v,t}));

async function deadlineForm(onSave) {
  const cases = await api('/api/cases?limit=100');
  if (!cases.data.length) { toast('Cadastre um processo antes de criar um prazo', 'error'); return; }
  const form = el(`<form class="form-grid">
    ${field('Processo *', 'case_id', { options: cases.data.map((c) => ({ v: c.id, t: c.title })) })}
    ${field('Descrição do prazo *', 'description')}
    <div class="form-row">${field('Vencimento *', 'deadline_date', { type: 'datetime-local' })}${field('Prioridade', 'priority', { options: PRIORITIES, value: 'alta' })}</div>
    <button type="submit" class="btn-primary">Criar prazo</button>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/deadlines', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      closeModal(); toast('Prazo criado'); onSave();
    } catch (err) { toast(err.message, 'error'); }
  };
  openModal('Novo prazo', form);
}

async function taskForm(onSave) {
  const form = el(`<form class="form-grid">
    ${field('Título *', 'title')}
    <div class="form-row">${field('Vencimento', 'due_date', { type: 'datetime-local' })}${field('Prioridade', 'priority', { options: PRIORITIES })}</div>
    ${field('Descrição', 'description', { type: 'textarea' })}
    <button type="submit" class="btn-primary">Criar tarefa</button>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/tasks', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      closeModal(); toast('Tarefa criada'); onSave();
    } catch (err) { toast(err.message, 'error'); }
  };
  openModal('Nova tarefa', form);
}

async function eventForm(onSave) {
  const clients = await api('/api/clients?limit=100');
  const form = el(`<form class="form-grid">
    ${field('Título *', 'title')}
    ${field('Tipo', 'event_type', { options: [['compromisso','Compromisso'],['reuniao','Reunião'],['audiencia','Audiência']].map(([v,t])=>({v,t})) })}
    ${field('Cliente', 'client_id', { options: [{ v: '', t: '— nenhum —' }, ...clients.data.map((c) => ({ v: c.id, t: c.name }))] })}
    <div class="form-row">${field('Início *', 'start_datetime', { type: 'datetime-local' })}${field('Fim', 'end_datetime', { type: 'datetime-local' })}</div>
    ${field('Local', 'location')}
    ${field('Descrição', 'description', { type: 'textarea' })}
    <button type="submit" class="btn-primary">Criar evento</button>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    if (!body.end_datetime) body.end_datetime = body.start_datetime;
    if (!body.client_id) delete body.client_id;
    try {
      await api('/api/calendar/events', { method: 'POST', body: JSON.stringify(body) });
      closeModal(); toast('Evento criado'); onSave();
    } catch (err) { toast(err.message, 'error'); }
  };
  openModal('Novo evento / reunião', form);
}

async function financialForm(onSave) {
  const clients = await api('/api/clients?limit=100');
  const form = el(`<form class="form-grid">
    ${field('Tipo *', 'tipo', { options: [['receita','Receita'],['despesa','Despesa']].map(([v,t])=>({v,t})) })}
    ${field('Descrição *', 'description')}
    <div class="form-row">${field('Valor (R$) *', 'valor', { type: 'number' })}${field('Vencimento', 'due_date', { type: 'date' })}</div>
    <div class="form-row">
      ${field('Centro de custo', 'cost_center')}
      ${field('Recorrência', 'recurrence_type', { options: [['','Nenhuma'],['mensal','Mensal'],['trimestral','Trimestral'],['semestral','Semestral'],['anual','Anual']].map(([v,t])=>({v,t})) })}
    </div>
    ${field('Cliente', 'client_id', { options: [{ v: '', t: '— nenhum —' }, ...clients.data.map((c) => ({ v: c.id, t: c.name }))] })}
    <button type="submit" class="btn-primary">Lançar</button>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    if (!body.client_id) delete body.client_id;
    if (!body.recurrence_type) delete body.recurrence_type;
    try {
      await api('/api/financial', { method: 'POST', body: JSON.stringify(body) });
      closeModal(); toast('Lançamento criado'); onSave();
    } catch (err) { toast(err.message, 'error'); }
  };
  openModal('Novo lançamento', form);
}

async function userForm(onSave) {
  const clients = await api('/api/clients?limit=100');
  const form = el(`<form class="form-grid">
    ${field('Nome *', 'name')}
    ${field('E-mail *', 'email', { type: 'email' })}
    ${field('Senha provisória *', 'password', { type: 'password' })}
    ${field('Papel', 'role', { options: [['advogado','Advogado do escritório'],['estagiario','Estagiário'],['parceiro','Advogado parceiro'],['cliente','Cliente (portal)'],['admin','Administrador']].map(([v,t])=>({v,t})) })}
    <div id="f-commission" style="display:none">${field('Repasse do parceiro', 'commission_percent', { options: [{v:30,t:'30%'},{v:50,t:'50%'}] })}</div>
    <div id="f-client" style="display:none">${field('Cliente vinculado', 'client_id', { options: clients.data.map((c) => ({ v: c.id, t: c.name })) })}</div>
    <button type="submit" class="btn-primary">Cadastrar usuário</button>
  </form>`);
  const roleSel = form.querySelector('[name=role]');
  const sync = () => {
    form.querySelector('#f-commission').style.display = roleSel.value === 'parceiro' ? 'block' : 'none';
    form.querySelector('#f-client').style.display = roleSel.value === 'cliente' ? 'block' : 'none';
  };
  roleSel.onchange = sync; sync();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    if (body.role !== 'parceiro') delete body.commission_percent;
    if (body.role !== 'cliente') delete body.client_id;
    try {
      await api('/api/users', { method: 'POST', body: JSON.stringify(body) });
      closeModal(); toast('Usuário cadastrado'); onSave();
    } catch (err) { toast(err.message, 'error'); }
  };
  openModal('Novo usuário', form);
}

function changePasswordForm() {
  const form = el(`<form class="form-grid">
    ${field('Senha atual', 'current_password', { type: 'password' })}
    ${field('Nova senha (mín. 8)', 'new_password', { type: 'password' })}
    <button type="submit" class="btn-primary">Trocar senha</button>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/auth/password', { method: 'PATCH', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      closeModal(); toast('Senha alterada com sucesso');
    } catch (err) { toast(err.message, 'error'); }
  };
  openModal('Trocar minha senha', form);
}

async function portalCaseDetail(id) {
  const c = await api('/api/portal/cases/' + id);
  const movs = (c.movements || []).map((m) =>
    `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
      <small style="color:var(--text-muted)">${fmtDate(m.movement_date || m.created_at)}</small>
      <div>${m.description}</div></div>`).join('') || '<p class="empty">Sem movimentações registradas</p>';
  const wrap = el(`<div class="form-grid">
    <div><strong style="font-size:18px">${c.title}</strong><br>
      <small style="color:var(--text-muted)">${c.case_number || ''}</small></div>
    <div>${badge(c.legal_area)} ${badge(c.phase)} ${badge(c.status)}</div>
    <hr style="border:none;border-top:1px solid var(--border)">
    <strong style="font-size:13px">Andamento do processo</strong>
    <div style="max-height:300px;overflow-y:auto">${movs}</div>
  </div>`);
  openModal('Andamento', wrap);
}

// ── Módulo Dativo ──
const DATIVE_AREAS = [['criminal','Criminal'],['familia','Família'],['civel','Cível'],['previdenciario','Previdenciário'],['trabalhista','Trabalhista'],['infancia','Infância'],['outro','Outro']].map(([v,t])=>({v,t}));

async function datProjecao(c) {
  const s = await api('/api/dative/summary');
  c.innerHTML = `
    <div class="kpi-grid">
      ${kpi('Audiências realizadas', s.audiencias_realizadas)}
      ${kpi('Audiências futuras', s.audiencias_futuras)}
      ${kpi('Demandas ativas', s.demandas_ativas)}
      ${kpi('Realizado (a faturar)', money(s.realizado), 'money')}
      ${kpi('Agendado (futuro)', money(s.agendado), 'money')}
      ${kpi('Recebido do Estado', money(s.recebido), 'money')}
      ${kpi('A receber', money(s.a_receber), 'money')}
      ${kpi('Estimado total', money(s.estimado_total), 'money')}
    </div>
    ${miniList('Por comarca', (s.por_comarca || []).map((x) => `<div class="mini-row"><span>${x.comarca} <small>(${x.audiencias} aud.)</small></span><strong>${money(x.valor_realizado)}</strong></div>`))}
    ${miniList('Por mês (realizado / agendado)', (s.por_mes || []).map((m) => `<div class="mini-row"><span>${m.mes}</span><span style="color:var(--green)">${money(m.realizado)} <small style="color:var(--amber)">+ ${money(m.agendado)}</small></span></div>`))}`;
}

async function datDemandas(c) {
  c.innerHTML = `<div class="toolbar"><button class="btn-gold" id="new-dcase">+ Nova demanda</button></div><div class="card"><div id="dcase-table"></div></div>`;
  const load = async () => {
    const rows = await api('/api/dative/cases');
    $('#dcase-table').innerHTML = rows.length ? `
      <table><thead><tr><th>Comarca</th><th>Assistido</th><th>Área</th><th>Nomeação</th><th>Estimado</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.map((d) => `<tr>
        <td><strong>${d.comarca}</strong><br><small style="color:var(--text-muted)">${d.process_number || ''}</small></td>
        <td>${d.assisted_name || '—'}</td><td>${d.area}</td><td>${fmtDate(d.nomeacao_date)}</td>
        <td>${money(d.estimated_value)}</td><td>${badge(d.status)}</td>
        <td><button class="btn-sm" data-dcase="${d.id}">Abrir</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Nenhuma demanda dativa</div>';
    document.querySelectorAll('[data-dcase]').forEach((b) => b.onclick = () => dativeCaseDetail(b.dataset.dcase, load));
  };
  $('#new-dcase').onclick = () => dativeCaseForm(load);
  await load();
}

async function datAudiencias(c) {
  c.innerHTML = `<div class="toolbar"><button class="btn-gold" id="new-dhear">+ Nova audiência</button></div><div class="card"><div id="dhear-table"></div></div>`;
  const load = async () => {
    const rows = await api('/api/dative/hearings');
    $('#dhear-table').innerHTML = rows.length ? `
      <table><thead><tr><th>Data</th><th>Comarca</th><th>Tipo</th><th>Assistido</th><th>Valor ato</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.map((h) => `<tr>
        <td>${fmtDate(h.hearing_date)}</td><td>${h.comarca || '—'}</td><td>${h.type || '—'}</td>
        <td>${h.assisted_name || '—'}</td><td>${money(h.act_value)}</td><td>${badge(h.status)}</td>
        <td>${h.status === 'agendada' ? `<button class="btn-sm" data-realiz="${h.id}">Marcar realizada</button>` : ''}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Nenhuma audiência</div>';
    document.querySelectorAll('[data-realiz]').forEach((b) => b.onclick = async () => {
      try { await api(`/api/dative/hearings/${b.dataset.realiz}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'realizada' }) });
        toast('Audiência realizada'); load(); } catch (e) { toast(e.message, 'error'); }
    });
  };
  $('#new-dhear').onclick = () => dativeHearingForm(load);
  await load();
}

async function datRecebimentos(c) {
  c.innerHTML = `<div class="toolbar"><button class="btn-gold" id="new-dpay">+ Registrar recebimento</button></div><div class="card"><div id="dpay-table"></div></div>`;
  const load = async () => {
    const rows = await api('/api/dative/payments');
    $('#dpay-table').innerHTML = rows.length ? `
      <table><thead><tr><th>Referência</th><th>Comarca</th><th>Valor</th><th>Previsto/Recebido</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.map((p) => `<tr>
        <td>${p.reference || '—'}</td><td>${p.comarca || '—'}</td><td>${money(p.value)}</td>
        <td>${fmtDate(p.received_date || p.expected_date)}</td><td>${badge(p.status)}</td>
        <td>${p.status === 'previsto' ? `<button class="btn-sm" data-receive="${p.id}">Dar baixa</button>` : ''}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Nenhum recebimento</div>';
    document.querySelectorAll('[data-receive]').forEach((b) => b.onclick = async () => {
      try { await api(`/api/dative/payments/${b.dataset.receive}/receive`, { method: 'PATCH' }); toast('Recebimento confirmado'); load(); } catch (e) { toast(e.message, 'error'); }
    });
  };
  $('#new-dpay').onclick = () => dativePaymentForm(load);
  await load();
}

async function dativeCaseForm(onSave) {
  const clients = await api('/api/clients?limit=100');
  const form = el(`<form class="form-grid">
    <strong style="color:var(--navy);font-size:13px">👤 Cliente (assistido)</strong>
    <small style="color:var(--text-muted)">Será criada uma ficha na aba Clientes com a etiqueta DATIVO.</small>
    ${field('Cliente já cadastrado', 'client_id', { options: [{ v: '', t: '— criar nova ficha —' }, ...clients.data.map((c) => ({ v: c.id, t: c.name }))] })}
    <div id="new-client-fields">
      ${field('Nome do assistido *', 'assisted_name')}
      <div class="form-row">${field('CPF', 'client_cpf')}${field('Telefone', 'client_phone')}</div>
      ${field('E-mail', 'client_email', { type: 'email' })}
    </div>
    <hr style="border:none;border-top:1px solid var(--border)">
    <strong style="color:var(--navy);font-size:13px">🏛️ Dados da nomeação</strong>
    ${field('Comarca *', 'comarca')}
    <div class="form-row">${field('Nº do processo', 'process_number')}${field('Vara', 'vara')}</div>
    <div class="form-row">${field('Área', 'area', { options: DATIVE_AREAS })}${field('Data da nomeação', 'nomeacao_date', { type: 'date' })}</div>
    ${field('Valor estimado (R$)', 'estimated_value', { type: 'number' })}
    <button type="submit" class="btn-primary">Cadastrar demanda</button>
  </form>`);

  // Se escolher cliente existente, esconde os campos de novo cliente
  const clientSel = form.querySelector('[name=client_id]');
  const newFields = form.querySelector('#new-client-fields');
  clientSel.onchange = () => { newFields.style.display = clientSel.value ? 'none' : 'block'; };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    if (!body.client_id) delete body.client_id;
    try { await api('/api/dative/cases', { method: 'POST', body: JSON.stringify(body) });
      closeModal(); toast('Demanda cadastrada e ficha do cliente criada'); onSave(); } catch (err) { toast(err.message, 'error'); }
  };
  openModal('Nova demanda dativa', form);
}

async function dativeCaseDetail(id, onSave) {
  const d = await api('/api/dative/cases/' + id);
  const hearings = (d.hearings || []).map((h) => `<div class="mini-row" style="padding:6px 0"><span>${fmtDate(h.hearing_date)} · ${h.type || ''} <small>${h.comarca || ''}</small></span><span>${money(h.act_value)} ${badge(h.status)}</span></div>`).join('') || '<small style="color:var(--text-muted)">Sem audiências</small>';
  const form = el(`<div class="form-grid">
    <div><strong style="font-size:18px">${d.comarca}</strong><br><small style="color:var(--text-muted)">${d.process_number || ''} · ${d.assisted_name || ''}</small></div>
    <div>${badge(d.area)} ${badge(d.status)} · estimado ${money(d.estimated_value)}</div>
    ${field('Status', 'status', { value: d.status, options: [['nomeada','Nomeada'],['em_andamento','Em andamento'],['concluida','Concluída'],['paga','Paga']].map(([v,t])=>({v,t})) })}
    <button class="btn-sm" id="upd-status">Atualizar status</button>
    <hr style="border:none;border-top:1px solid var(--border)">
    <strong style="font-size:13px">Audiências</strong>
    <div>${hearings}</div>
  </div>`);
  form.querySelector('#upd-status').onclick = async () => {
    try { await api('/api/dative/cases/' + id, { method: 'PUT', body: JSON.stringify({ status: form.querySelector('[name=status]').value }) });
      closeModal(); toast('Status atualizado'); onSave(); } catch (e) { toast(e.message, 'error'); }
  };
  openModal('Demanda dativa', form);
}

async function dativeHearingForm(onSave) {
  const cases = await api('/api/dative/cases');
  if (!cases.length) { toast('Cadastre uma demanda antes', 'error'); return; }
  const form = el(`<form class="form-grid">
    ${field('Demanda *', 'dative_case_id', { options: cases.map((c) => ({ v: c.id, t: `${c.comarca} — ${c.assisted_name || c.process_number || c.id}` })) })}
    <div class="form-row">${field('Data/hora *', 'hearing_date', { type: 'datetime-local' })}${field('Tipo', 'type')}</div>
    <div class="form-row">${field('Comarca', 'comarca')}${field('Valor do ato (R$)', 'act_value', { type: 'number' })}</div>
    <button type="submit" class="btn-primary">Agendar audiência</button>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/dative/hearings', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      closeModal(); toast('Audiência registrada'); onSave(); } catch (err) { toast(err.message, 'error'); }
  };
  openModal('Nova audiência', form);
}

async function dativePaymentForm(onSave) {
  const cases = await api('/api/dative/cases');
  const form = el(`<form class="form-grid">
    ${field('Referência (ex: lote março/2026)', 'reference')}
    ${field('Demanda (opcional)', 'dative_case_id', { options: [{ v: '', t: '— geral —' }, ...cases.map((c) => ({ v: c.id, t: c.comarca }))] })}
    <div class="form-row">${field('Valor (R$) *', 'value', { type: 'number' })}${field('Data prevista', 'expected_date', { type: 'date' })}</div>
    ${field('Data de recebimento (se já recebido)', 'received_date', { type: 'date' })}
    <button type="submit" class="btn-primary">Registrar</button>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    if (!body.dative_case_id) delete body.dative_case_id;
    try { await api('/api/dative/payments', { method: 'POST', body: JSON.stringify(body) });
      closeModal(); toast('Recebimento registrado'); onSave(); } catch (err) { toast(err.message, 'error'); }
  };
  openModal('Registrar recebimento do Estado', form);
}

const CONTRACT_STATUS = [['rascunho','Rascunho'],['em_producao','Em produção'],['finalizado','Finalizado'],['assinado','Assinado']].map(([v,t])=>({v,t}));

async function contractForm(onSave) {
  const clients = await api('/api/clients?limit=100');
  const form = el(`<form class="form-grid">
    ${field('Cliente', 'client_id', { options: [{ v: '', t: '— sem cliente —' }, ...clients.data.map((c) => ({ v: c.id, t: c.name }))] })}
    ${field('Título', 'title')}
    <div class="form-row">${field('Área', 'area', { options: AREAS })}${field('Valor (R$)', 'value', { type: 'number' })}</div>
    <small style="color:var(--text-muted)">O texto-base do contrato é gerado automaticamente pela área e fica editável.</small>
    <button type="submit" class="btn-primary">Criar contrato</button>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    if (!body.client_id) delete body.client_id;
    try { const ct = await api('/api/contracts', { method: 'POST', body: JSON.stringify(body) });
      closeModal(); onSave && onSave(); contractEditor(ct.id, onSave); } catch (err) { toast(err.message, 'error'); }
  };
  openModal('Novo contrato', form);
}

async function contractEditor(id, onSave) {
  const ct = await api('/api/contracts/' + id);
  const wrap = el(`<div class="form-grid">
    ${field('Título', 'title', { value: ct.title })}
    <div class="form-row">${field('Área', 'area', { value: ct.area, options: AREAS })}${field('Valor (R$)', 'value', { type: 'number', value: ct.value ?? '' })}</div>
    ${field('Status', 'status', { value: ct.status, options: CONTRACT_STATUS })}
    <label>Conteúdo do contrato
      <textarea name="content" rows="16" style="font-family:monospace;font-size:13px">${ct.content || ''}</textarea>
    </label>
    <button class="btn-primary" id="save-ct">Salvar contrato</button>
  </div>`);
  wrap.querySelector('#save-ct').onclick = async () => {
    const body = {
      title: wrap.querySelector('[name=title]').value,
      area: wrap.querySelector('[name=area]').value,
      value: wrap.querySelector('[name=value]').value || null,
      status: wrap.querySelector('[name=status]').value,
      content: wrap.querySelector('[name=content]').value,
    };
    try { await api('/api/contracts/' + id, { method: 'PUT', body: JSON.stringify(body) });
      closeModal(); toast('Contrato salvo'); onSave && onSave(); } catch (e) { toast(e.message, 'error'); }
  };
  openModal('Editar contrato', wrap);
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ── Init ──
$('#login-form').onsubmit = login;
$('#logout-btn').onclick = logout;
$('#bell-btn').onclick = openNotifications;
$('#modal-close').onclick = closeModal;
$('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };
window.addEventListener('hashchange', router);

// Retorno do OAuth Google
const gParam = new URLSearchParams(location.search).get('google');
if (gParam) {
  history.replaceState({}, '', location.pathname);
  setTimeout(() => {
    if (gParam === 'connected') { toast('Google Agenda conectado!'); location.hash = '#agenda'; }
    else toast('Falha ao conectar o Google', 'error');
  }, 500);
}

if (TOKEN && USER) showApp(); else { $('#login-view').classList.remove('hidden'); }
