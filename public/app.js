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
function showApp() {
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  $('#user-name').textContent = USER?.name || '';
  router();
}

// ── Router ──
function router() {
  const route = (location.hash.replace('#', '') || 'dashboard');
  document.querySelectorAll('.nav-item').forEach((a) =>
    a.classList.toggle('active', a.dataset.route === route));
  const page = $('#page');
  page.innerHTML = '<div class="empty">Carregando…</div>';
  const fn = ROUTES[route] || ROUTES.dashboard;
  fn(page).catch((err) => page.innerHTML = `<div class="empty">${err.message}</div>`);
}

// ── Pages ──
const ROUTES = {
  async dashboard(page) {
    const d = await api('/api/dashboards/comercial');
    page.innerHTML = `
      <div class="page-header"><div><h2>Dashboard Comercial</h2>
        <p class="sub">Visão geral do funil e propostas</p></div></div>
      <div class="kpi-grid">
        ${kpi('Leads hoje', d.leads_hoje)}
        ${kpi('Total de leads', d.leads_total)}
        ${kpi('Propostas enviadas', d.propostas_enviadas)}
        ${kpi('Propostas aceitas', d.propostas_aceitas)}
        ${kpi('Taxa de conversão', d.taxa_conversao)}
        ${kpi('Valor em aberto', money(d.valor_potencial_aberto), 'money')}
        ${kpi('Reuniões marcadas', d.reunioes_marcadas)}
        ${kpi('Propostas vencendo', d.propostas_vencendo)}
      </div>
      <div class="card" style="padding:20px">
        <h3 style="color:var(--navy);margin-bottom:12px">Leads por status</h3>
        ${(d.leads_por_status || []).map((s) => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">${badge(s.status)}<strong>${s.total}</strong></div>`).join('') || '<p class="empty">Sem leads ainda</p>'}
      </div>`;
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
          <td><strong>${c.name}</strong><br><small style="color:var(--text-muted)">${c.cpf_cnpj || ''}</small></td>
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
    const cols = { novo: 'Novo', contatado: 'Contatado', qualificado: 'Qualificado', reuniao_marcada: 'Reunião marcada' };
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
  const stages = [['novo','Novo'],['contatado','Contatado'],['qualificado','Qualificado'],['reuniao_marcada','Reunião marcada'],['perdido','Perdido']];
  const form = el(`<div class="form-grid">
    <div><strong style="font-size:18px">${l.name}</strong><br><small style="color:var(--text-muted)">${l.legal_area || ''} · ${l.source || ''}</small></div>
    <div>${l.phone || ''} ${l.email ? '· ' + l.email : ''}</div>
    ${field('Mover no funil', 'status', { value: l.status, options: stages.map(([v,t])=>({v,t})) })}
    <button class="btn-primary" id="move">Atualizar etapa</button>
    <button class="btn-gold" id="conv">Converter em cliente</button>
  </div>`);
  form.querySelector('#move').onclick = async () => {
    try { await api(`/api/leads/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: form.querySelector('[name=status]').value }) });
      closeModal(); toast('Etapa atualizada'); onSave(); } catch (e) { toast(e.message, 'error'); }
  };
  form.querySelector('#conv').onclick = async () => {
    try { await api(`/api/leads/${id}/convert-client`, { method: 'POST', body: JSON.stringify({ tipo: 'PF' }) });
      closeModal(); toast('Lead convertido em cliente'); onSave(); } catch (e) { toast(e.message, 'error'); }
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
    <strong style="font-size:13px">Movimentações</strong>
    <div style="max-height:200px;overflow-y:auto">${movs}</div>
    <textarea id="mov-desc" rows="2" placeholder="Nova movimentação processual…"></textarea>
    <button class="btn-primary" id="add-mov">Registrar movimentação</button>
  </div>`);
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

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ── Init ──
$('#login-form').onsubmit = login;
$('#logout-btn').onclick = logout;
$('#modal-close').onclick = closeModal;
$('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };
window.addEventListener('hashchange', router);
if (TOKEN && USER) showApp(); else { $('#login-view').classList.remove('hidden'); }
