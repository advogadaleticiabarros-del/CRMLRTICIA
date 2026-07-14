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
  // Renovação deslizante da sessão: o servidor manda um token novo perto de expirar
  const renewed = res.headers.get('X-Renew-Token');
  if (renewed) { TOKEN = renewed; localStorage.setItem('crm_token', renewed); }
  if (res.status === 401) { logout(); throw new Error('Sessão expirada'); }
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) {
    const err = new Error(data?.error || 'Erro na requisição');
    err.status = res.status;               // permite tratar 400/429 etc.
    if (data) Object.assign(err, data);    // ex.: err.pendencias (bloqueio de etapa)
    throw err;
  }
  return data;
}

// ── Utils ──
const $ = (sel) => document.querySelector(sel);
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const AREA_LABELS = { civel: 'Cível', trabalhista: 'Trabalhista', familia: 'Família', previdenciario: 'Previdenciário', consumidor: 'Consumidor', gestante: 'Gestante', outro: 'Outro' };
function areaChipsHtml(areas) {
  let arr = []; try { arr = Array.isArray(areas) ? areas : (areas ? JSON.parse(areas) : []); } catch {}
  return (arr || []).map((a) => `<span style="font-size:10px;background:var(--gold-soft,#efe3c8);color:var(--navy);padding:1px 7px;border-radius:10px;margin-left:4px">${esc(AREA_LABELS[a] || a)}</span>`).join('');
}
// Links de arquivos internos: o servidor entrega URLs ASSINADAS (?e=&s=, HMAC 24h) —
// nada de token de sessão na URL. Sem assinatura, o link volta como está.
const fileHref = (u) => (u || '');
// Link de WhatsApp a partir do telefone (adiciona DDI 55 do Brasil se faltar).
function waLink(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 11) d = '55' + d;
  return 'https://wa.me/' + d;
}
function waBtn(phone, label) {
  const l = waLink(phone); if (!l) return '';
  return `<a href="${l}" target="_blank" rel="noopener" title="Chamar no WhatsApp" style="display:inline-flex;align-items:center;gap:4px;background:#25D366;color:#fff;padding:2px 9px;border-radius:12px;text-decoration:none;font-size:12px;font-weight:700;margin-left:6px">💬${label ? ' ' + label : ''}</a>`;
}
// Número do processo em destaque + botão de copiar (usa o handler global [data-copy]).
function procNumHtml(num) {
  if (!num) return `<span style="color:var(--text-muted)">s/ número</span>`;
  return `<span style="font-weight:700;color:var(--gold);font-size:14px;letter-spacing:.3px">${esc(num)}</span><button type="button" class="btn-copy" data-copy="${esc(num)}" title="Copiar número do processo" style="margin-left:6px;background:none;border:1px solid var(--border);border-radius:6px;cursor:pointer;padding:3px 6px;line-height:0">${svgIcon('clipboard')}</button>`;
}
const money = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('pt-BR') : '—';
const badge = (txt) => `<span class="badge ${txt}">${(txt || '').replace(/_/g, ' ')}</span>`;
function toast(msg, type = 'success') {
  const t = $('#toast'); t.textContent = msg; t.className = `toast ${type}`;
  setTimeout(() => t.classList.add('hidden'), 3000);
}
function openModal(title, bodyEl, opts) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = ''; $('#modal-body').appendChild(bodyEl);
  const card = document.querySelector('#modal .modal-card');
  if (card) card.classList.toggle('wide', !!(opts && opts.wide));
  $('#modal').classList.remove('hidden');
  // Acessibilidade: foca o primeiro campo ao abrir
  setTimeout(() => { const f = $('#modal-body').querySelector('input, select, textarea, button'); if (f) f.focus(); }, 30);
}
function closeModal() { $('#modal').classList.add('hidden'); }
// Esc fecha o modal aberto (ou a gaveta no mobile)
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#modal').classList.contains('hidden')) closeModal();
  else if (document.body.classList.contains('nav-open')) document.body.classList.remove('nav-open');
});

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
  if (idleTimer) clearTimeout(idleTimer);
  if (bellTimer) clearInterval(bellTimer);
  $('#app-view').classList.add('hidden');
  $('#login-view').classList.remove('hidden');
}
const NAV_LABELS = {
  dashboard: 'Dashboard', clients: 'Clientes', leads: 'Leads',
  propostas: 'Propostas', cases: 'Processos', prazos: 'Prazos & Tarefas',
  agenda: 'Agenda', financeiro: 'Financeiro', controladoria: 'Controladoria', correspondente: 'Correspondente',
  documentos: 'Documentos', ia: 'IA Jurídica', config: 'Configurações', repasses: 'Meus Repasses', dativo: 'Dativo',
  contratos: 'Contratos', intakes: 'Novo Atendimento',
  monitor: 'Monitoramento', fases: 'Fases (Kanban)', producao: 'Produção', parcerias: 'Parcerias', advogados: 'Advogados/OAB', whatsapp: 'WhatsApp',
  portal: 'Meus Processos', portalFinanceiro: 'Valores a Pagar',
  ppcases: 'Meus Indicados', ppclients: 'Fichas dos Clientes', ppupdates: 'Atualizações', ppagenda: 'Audiências', ppfin: 'Financeiro',
};
const NAV_BY_ROLE = {
  admin:      ['intakes','dashboard','leads','clients','propostas','contratos','documentos','ia','cases','producao','parcerias','monitor','fases','prazos','agenda','financeiro','whatsapp','controladoria','correspondente','dativo','advogados','config'],
  staff:      ['intakes','dashboard','leads','clients','propostas','contratos','documentos','ia','cases','producao','parcerias','monitor','fases','prazos','agenda','financeiro','whatsapp','controladoria','correspondente','dativo'],
  advogado:   ['intakes','dashboard','leads','clients','propostas','contratos','documentos','ia','cases','producao','parcerias','monitor','fases','prazos','agenda','financeiro','whatsapp','controladoria','correspondente','dativo'],
  estagiario: ['producao','cases','prazos','agenda'],
  parceiro:   ['cases','repasses','prazos','agenda'],
  cliente:    ['portal','portalFinanceiro'],
  parceiro_portal: ['ppcases','ppclients','ppupdates','ppagenda','ppfin'],
};
function navForRole() { return NAV_BY_ROLE[USER?.role] || NAV_BY_ROLE.advogado; }

// ── Aparência (temas) & barra lateral recolhível ──────────────────────────
const THEME_META = [
  { id: 'claro',    label: 'Clássico Claro', desc: 'Creme quente + dourado',  sb: '#fbf8f2', bg: '#f6f4ef', ink: '#221d16', dark: false },
  { id: 'espresso', label: 'Espresso',       desc: 'Barra café + dourado',    sb: '#241d16', bg: '#f6f4ef', ink: '#221d16', dark: false },
  { id: 'marinho',  label: 'Marinho',        desc: 'Barra navy profundo',     sb: '#1f3047', bg: '#f4f6f9', ink: '#1f2a3a', dark: false },
  { id: 'onix',     label: 'Ônix',           desc: 'Barra grafite sóbrio',    sb: '#1a1a1d', bg: '#f5f4f2', ink: '#20201f', dark: false },
  { id: 'marfim',   label: 'Marfim',         desc: 'Claro minimalista',       sb: '#ffffff', bg: '#faf8f3', ink: '#221d16', dark: false },
  { id: 'escuro',   label: 'Escuro',         desc: 'Modo escuro completo',    sb: '#161310', bg: '#14110d', ink: '#ece6da', dark: true },
];
const THEME_IDS = THEME_META.map((t) => t.id);
function applyTheme(id) {
  if (!THEME_IDS.includes(id)) id = 'claro';
  document.documentElement.setAttribute('data-theme', id);
  try { localStorage.setItem('crm_theme', id); } catch {}
  const meta = THEME_META.find((t) => t.id === id);
  const tc = document.querySelector('meta[name="theme-color"]');
  if (tc && meta) tc.setAttribute('content', meta.dark ? '#14110d' : meta.sb);
}
function currentTheme() { return localStorage.getItem('crm_theme') || 'claro'; }
function setSidebarCollapsed(on) {
  document.body.classList.toggle('sidebar-collapsed', !!on);
  try { localStorage.setItem('crm_sidebar', on ? '1' : '0'); } catch {}
}
function initAppearance() {
  applyTheme(currentTheme());
  setSidebarCollapsed(localStorage.getItem('crm_sidebar') === '1');
}

// Paginador reutilizável — botões « ‹ 1 … 4 5 6 … 20 › » (usa data-page)
function pagerHtml(current, pages) {
  if (!pages || pages <= 1) return '';
  const btn = (p, label, dis, act) =>
    `<button class="pg-btn${act ? ' act' : ''}"${dis ? ' disabled' : ` data-page="${p}"`}>${label || p}</button>`;
  let out = btn(current - 1, '‹', current <= 1);
  const win = [];
  const add = (p) => { if (p >= 1 && p <= pages && !win.includes(p)) win.push(p); };
  add(1); for (let p = current - 2; p <= current + 2; p++) add(p); add(pages);
  win.sort((a, b) => a - b);
  let prev = 0;
  for (const p of win) {
    if (p - prev > 1) out += `<span class="pg-gap">…</span>`;
    out += btn(p, null, false, p === current);
    prev = p;
  }
  out += btn(current + 1, '›', current >= pages);
  return `<div class="pager">${out}</div>`;
}

// ── Portal do cliente: etapas amigáveis do processo ───────────────────────
const PORTAL_STEPS = [
  { id: 'documentos', label: 'Documentos' },
  { id: 'elaboracao', label: 'Elaboração' },
  { id: 'protocolo', label: 'Protocolo' },
  { id: 'andamento', label: 'Em andamento' },
  { id: 'conclusao', label: 'Conclusão' },
];
function portalStepIndex(c) {
  const ps = c.production_stage;
  if (c.status === 'encerrado' || c.phase === 'encerrado' || ps === 'concluido') return 4;
  if (ps === 'separacao_documentos') return 0;
  if (ps === 'criacao_inicial' || ps === 'revisao_inicial') return 1;
  if (ps === 'aguardando_protocolo') return 2;
  if (ps === 'protocolado' || c.case_number) return 3;
  return 0;
}
function stepperHtml(c) {
  const cur = portalStepIndex(c);
  return `<div class="stepper">${PORTAL_STEPS.map((s, i) => `
    <div class="step ${i < cur ? 'done' : ''} ${i === cur ? 'now' : ''}">
      <div class="dot">${i < cur ? '✓' : i + 1}</div><div class="lb">${s.label}</div>
    </div>`).join('')}</div>`;
}

// ── Exportação CSV (Excel-friendly, com BOM) ──────────────────────────────
function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function downloadCsv(filename, columns, rows) {
  const head = columns.map((c) => csvEscape(c.label)).join(';');
  const body = rows.map((r) => columns.map((c) => csvEscape(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(';')).join('\n');
  const blob = new Blob(['﻿' + head + '\n' + body], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// Busca todas as páginas de um endpoint paginado (limite 100/página)
async function fetchAllPages(path, params) {
  const all = []; let page = 1, pages = 1;
  do {
    const q = new URLSearchParams(params || {});
    q.set('limit', '100'); q.set('page', String(page));
    const r = await api(path + '?' + q);
    (r.data || []).forEach((x) => all.push(x));
    pages = r.pages || 1; page++;
  } while (page <= pages && page <= 200);
  return all;
}

// ── Mini-gráficos (SVG/CSS, paleta da marca, sem bibliotecas) ─────────────
const MESES_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function monthShort(ym) {
  const m = String(ym || '').match(/^(\d{4})-(\d{2})/);
  return m ? `${MESES_PT[Number(m[2]) - 1]}/${m[1].slice(2)}` : String(ym || '');
}
function chartCard(title, inner) {
  return `<div class="card" style="padding:18px;margin-bottom:16px"><strong style="color:var(--navy)">${title}</strong><div style="margin-top:14px">${inner}</div></div>`;
}
// Sparkline — mini-tendência (linha) para dentro de um KPI
function sparkline(values, opts = {}) {
  const v = (values || []).map(Number).filter((n) => !isNaN(n));
  if (v.length < 2) return '';
  const w = 100, h = 26, pad = 2.5;
  const min = Math.min(...v), max = Math.max(...v), rng = (max - min) || 1;
  const pts = v.map((n, i) => {
    const x = pad + i * (w - 2 * pad) / (v.length - 1);
    const y = h - pad - (n - min) / rng * (h - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const [lx, ly] = pts[pts.length - 1].split(',');
  const color = opts.color || 'var(--gold)';
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${lx}" cy="${ly}" r="2.2" fill="${color}"/></svg>`;
}
// Variação vs ~7 dias atrás. goodUp=true → subir é bom (verde); false → subir é ruim (vermelho).
function deltaBadge(values, goodUp = true) {
  const v = (values || []).map(Number).filter((n) => !isNaN(n));
  if (v.length < 2) return '';
  const cur = v[v.length - 1];
  const prev = v.length > 7 ? v[v.length - 8] : v[0]; // ~7 dias atrás, ou o ponto mais antigo
  if (cur === prev) return '';
  const up = cur > prev;
  const txt = prev === 0 ? 'novo' : `${(cur - prev) > 0 ? '+' : ''}${Math.round((cur - prev) / Math.abs(prev) * 100)}%`;
  if (txt === '+0%' || txt === '0%') return '';
  const cls = (up === goodUp) ? 'good' : 'bad';
  return `<span class="delta ${cls}" title="vs. ~7 dias atrás">${up ? '▲' : '▼'} ${txt}</span>`;
}
// Barras horizontais — comparar categorias (1 série, ordena desc, rótulos sempre)
function chartHBars(items, opts = {}) {
  const fmt = opts.fmt || ((v) => v);
  const list = (items || []).map((i) => ({ label: String(i.label ?? '—'), value: Number(i.value) || 0 }))
    .sort((a, b) => b.value - a.value).slice(0, opts.limit || 12);
  if (!list.length) return '<div class="empty" style="padding:16px">Sem dados no período</div>';
  const max = Math.max(1, ...list.map((i) => i.value));
  const color = opts.color || 'var(--gold)';
  return `<div class="hbars">${list.map((i) => `
    <div class="hbar-row" title="${esc(i.label)}: ${fmt(i.value)}">
      <span class="hbar-lab">${esc(i.label)}</span>
      <span class="hbar-track"><span class="hbar-fill" style="width:${Math.max(2, Math.round(i.value / max * 100))}%;background:${color}"></span></span>
      <span class="hbar-val">${fmt(i.value)}</span>
    </div>`).join('')}</div>`;
}
// Colunas agrupadas — 2 séries por período (ex.: receitas x despesas por mês)
function chartColumns(rows, opts = {}) {
  const fmt = opts.fmt || ((v) => v);
  const list = (rows || []).map((r) => ({ label: String(r.label ?? ''), a: Number(r.a) || 0, b: Number(r.b) || 0 }));
  if (!list.length) return '<div class="empty" style="padding:16px">Sem dados</div>';
  const max = Math.max(1, ...list.flatMap((r) => [r.a, r.b]));
  const ca = opts.aColor || 'var(--green)', cb = opts.bColor || 'var(--red)';
  const legend = `<div class="chart-legend">
    <span class="lg"><span class="sw" style="background:${ca}"></span>${opts.aLabel || 'A'}</span>
    <span class="lg"><span class="sw" style="background:${cb}"></span>${opts.bLabel || 'B'}</span></div>`;
  return `${legend}<div class="cols">${list.map((r) => `
    <div class="col">
      <div class="col-bars">
        <span class="col-bar" style="height:${Math.max(2, Math.round(r.a / max * 100))}%;background:${ca}" title="${opts.aLabel || ''}: ${fmt(r.a)}"></span>
        <span class="col-bar" style="height:${Math.max(2, Math.round(r.b / max * 100))}%;background:${cb}" title="${opts.bLabel || ''}: ${fmt(r.b)}"></span>
      </div>
      <span class="col-lab">${esc(r.label)}</span>
    </div>`).join('')}</div>`;
}

// ── Sistema de ícones SVG (linha fina, herdam a cor — substituem os emojis) ──
const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"/>',
  calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 9h16M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 1.5"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19v-1a4 4 0 0 1 4-4h3a4 4 0 0 1 4 4v1"/><path d="M16.6 5.3a3.2 3.2 0 0 1 0 6M20.5 19v-1a4 4 0 0 0-3-3.9"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1.3"/>',
  file: '<path d="M6 3h7l5 5v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M13 3v5h5M8.5 13h7M8.5 16.5h5"/>',
  briefcase: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h3.6a1 1 0 0 1 .7.3L11 7h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  expand: '<path d="M8 4H5a1 1 0 0 0-1 1v3M16 4h3a1 1 0 0 1 1 1v3M8 20H5a1 1 0 0 1-1-1v-3M16 20h3a1 1 0 0 0 1-1v-3"/>',
  minimize: '<path d="M9 5v3a1 1 0 0 1-1 1H5M15 5v3a1 1 0 0 0 1 1h3M9 19v-3a1 1 0 0 0-1-1H5M15 19v-3a1 1 0 0 1 1-1h3"/>',
  bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  alert: '<path d="M12 3 2.5 20h19z"/><path d="M12 10v4M12 17.5v.4"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 20v-6M12 20v-9M16 20v-4M20 20V8"/>',
  printer: '<path d="M7 8V4h10v4"/><rect x="4" y="8" width="16" height="8" rx="1.5"/><path d="M7 14h10v6H7z"/>',
  edit: '<path d="M4 20h4L18.5 9.5a2 2 0 0 0-3-3L5 17z"/><path d="M13.5 7l3 3"/>',
  check: '<path d="M4 12.5 9 17.5 20 6.5"/>',
  clipboard: '<rect x="6" y="4" width="12" height="16" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h4"/>',
  leads: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19v-1a4 4 0 0 1 4-4h3a4 4 0 0 1 4 4v1"/><path d="M18 8v6M15 11h6"/>',
  contract: '<path d="M6 3h7l5 5v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M13 3v5h5"/><path d="m8.5 15 2 2 4-4"/>',
  docs: '<rect x="4" y="4" width="11" height="13" rx="1.5"/><path d="M8 20h9a1 1 0 0 0 1-1V8"/>',
  ia: '<path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10z"/><path d="M18 15l.7 1.8L20.5 17l-1.8.7L18 19.5l-.7-1.8L15.5 17z"/>',
  kanban: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="11" rx="1"/><rect x="17" y="4" width="4" height="14" rx="1"/>',
  swap: '<path d="M4 7h13l-3.5-3.5M20 17H7l3.5 3.5"/>',
  activity: '<path d="M3 12h4l2.5 7 4-15L16 12h5"/>',
  branch: '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 8v8M8 6h4a4 4 0 0 1 4 4M8 18h4a4 4 0 0 0 4-4"/>',
  pie: '<path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M12 3a9 9 0 0 1 9 9"/>',
  pin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  scale: '<path d="M12 3v18M7 21h10M4 8h16M4 8l6-2 8 2"/><path d="M4 8l-2.5 5a3 3 0 0 0 6 0zM20 8l2.5 5a3 3 0 0 1-6 0z"/>',
  cap: '<path d="M2 9l10-4 10 4-10 4z"/><path d="M6 11v5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  banknote: '<rect x="3" y="7" width="18" height="10" rx="2"/><circle cx="12" cy="12" r="2.3"/><path d="M6.5 10v4M17.5 10v4"/>',
  dot: '<circle cx="12" cy="12" r="3.5"/>',
  chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.5 0-2.9-.36-4.1-1L3 20l1.05-5.2A8.5 8.5 0 1 1 21 11.5z"/><path d="M8.5 10.5h7M8.5 13.5h4.5"/>',
};
// Ícones acrescentados no expurgo de emoji: emoji como ícone de interface é o
// delator nº 1 de "feito por IA" — e ainda muda de desenho a cada sistema
// operacional. O traço aqui é o mesmo do resto do conjunto (Lucide, 24×24).
Object.assign(ICONS, {
  shield:   '<path d="M12 3.5 5 6.2v5.1c0 4.3 2.9 8.2 7 9.2 4.1-1 7-4.9 7-9.2V6.2z"/><path d="M9.6 12.2l1.7 1.7 3.3-3.4"/>',
  key:      '<circle cx="8" cy="12" r="3.2"/><path d="M11.2 12H21M18 12v3M15 12v2"/>',
  mail:     '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.6 6.8 8.4 6 8.4-6"/>',
  refresh:  '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v4h-4"/>',
  download: '<path d="M12 4v10"/><path d="m8 10.5 4 4 4-4"/><path d="M4.5 17.5v1a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-1"/>',
  broom:    '<path d="M13.5 4.5 9 9"/><path d="M11 7.5 16.5 13"/><path d="M9 9.5 5.5 13a3 3 0 0 0-.6 3.3L6 19h8l1.1-2.7a3 3 0 0 0-.6-3.3z"/><path d="M8 19v-4M11 19v-4"/>',
  note:     '<path d="M6 3.5h9l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5A1.5 1.5 0 0 1 6.5 3.5z"/><path d="M15 3.5V8h4"/><path d="M8.5 12.5h7M8.5 16h4.5"/>',
  printer:  '<path d="M7 8V4h10v4"/><rect x="4" y="8" width="16" height="8" rx="1.5"/><path d="M7 14h10v5H7z"/>',
  building: '<rect x="5" y="3.5" width="14" height="17" rx="1.5"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h6v5.5H9z"/>',
});

function svgIcon(name, extra) {
  const p = ICONS[name] || ICONS.dot;
  return `<svg class="ic${extra ? ' ' + extra : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

// Ícone (nome no set SVG) por rota — usado na barra lateral e nas abas inferiores
const NAV_ICONS = {
  intakes: 'plus', dashboard: 'home', leads: 'leads', clients: 'users', propostas: 'file',
  contratos: 'contract', documentos: 'docs', ia: 'ia', cases: 'briefcase', producao: 'kanban',
  parcerias: 'swap', monitor: 'activity', fases: 'branch', prazos: 'clock', agenda: 'calendar',
  financeiro: 'wallet', controladoria: 'pie', correspondente: 'pin', dativo: 'scale',
  advogados: 'cap', config: 'gear', repasses: 'banknote', whatsapp: 'chat',
  portal: 'folder', portalFinanceiro: 'banknote',
  ppcases: 'briefcase', ppclients: 'users', ppupdates: 'activity', ppagenda: 'clock', ppfin: 'wallet',
};
const NAV_SHORT = {
  dashboard: 'Início', prazos: 'Prazos', cases: 'Processos', clients: 'Clientes',
  financeiro: 'Financeiro', propostas: 'Propostas', portal: 'Processos', portalFinanceiro: 'Pagar',
  ppcases: 'Indicados', ppclients: 'Fichas', ppupdates: 'Novidades', ppagenda: 'Audiências', ppfin: 'Financeiro',
};
// Ordem de preferência das abas inferiores (as 4 primeiras disponíveis para o papel)
const BOTTOM_PREFERRED = ['dashboard', 'agenda', 'cases', 'prazos', 'clients', 'financeiro', 'propostas', 'leads', 'portal', 'portalFinanceiro', 'ppcases', 'ppupdates', 'ppagenda', 'ppfin'];

function buildNav() {
  const items = navForRole();
  $('#nav').innerHTML = items.map((r) =>
    `<a href="#${r}" class="nav-item ${r === 'intakes' ? 'nav-highlight' : ''}" data-route="${r}" title="${NAV_LABELS[r]}">${svgIcon(NAV_ICONS[r], 'nav-ic')}<span>${NAV_LABELS[r]}</span></a>`).join('');
  buildBottomNav(items);
}

function buildBottomNav(items) {
  const el = $('#bottom-nav');
  if (!el) return;
  let primary = BOTTOM_PREFERRED.filter((r) => items.includes(r)).slice(0, 4);
  if (primary.length < 4) primary = items.slice(0, 4);
  const tabs = primary.map((r) =>
    `<a href="#${r}" class="bottom-item" data-route="${r}">
       <span class="bi-ic">${svgIcon(NAV_ICONS[r])}</span>
       <span class="bi-lb">${NAV_SHORT[r] || NAV_LABELS[r]}</span>
     </a>`).join('');
  el.innerHTML = tabs +
    `<button class="bottom-item bottom-more" id="bottom-more" type="button">
       <span class="bi-ic">${svgIcon('menu')}</span><span class="bi-lb">Mais</span>
     </button>`;
  $('#bottom-more').onclick = () => document.body.classList.toggle('nav-open');
}

function initials(name) {
  const parts = (name || '').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || 'U';
}
const ROLE_PT = { admin: 'Administrador', advogado: 'Advogado(a)', estagiario: 'Estagiário(a)', parceiro: 'Parceiro(a)', cliente: 'Cliente', staff: 'Equipe', parceiro_portal: 'Parceiro' };

let bellTimer = null;
function showApp() {
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  $('#user-name').innerHTML = `${USER?.name || ''}<small style="display:block;color:var(--gold-soft);font-size:11px">${ROLE_PT[USER?.role] || ''}</small>`;
  const av = $('#user-avatar'); if (av) av.textContent = initials(USER?.name);
  const greet = $('#topbar-greeting');
  if (greet) {
    const h = new Date().getHours();
    const saud = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
    greet.innerHTML = `${saud}, <strong>${(USER?.name || '').split(' ')[0]}</strong> <span class="topbar-date">· ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>`;
    // Portal do parceiro: a identidade exibida é SEMPRE o nome do parceiro (ex.: INFINITY LAW)
    if (USER?.role === 'parceiro_portal') {
      api('/api/partner-portal/me').then((me) => {
        if (!me?.name) return;
        greet.innerHTML = `${saud}, <strong>${esc(me.name)}</strong> <span class="topbar-date">· ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>`;
        $('#user-name').innerHTML = `${esc(me.name)}<small style="display:block;color:var(--gold-soft);font-size:11px">${ROLE_PT[USER?.role] || 'Parceiro'}</small>`;
        const av2 = $('#user-avatar'); if (av2) av2.textContent = initials(me.name);
      }).catch(() => {});
    }
  }
  buildNav();
  // rota padrão do papel
  const allowed = navForRole();
  const current = location.hash.replace('#', '');
  if (!allowed.includes(current)) location.hash = '#' + allowed[0];
  else router();
  refreshBell();
  if (bellTimer) clearInterval(bellTimer);
  bellTimer = setInterval(refreshBell, 60000); // atualiza o sino a cada 60s
  setTimeout(autoDiscoverDaily, 3500); // busca diária de processos/prazos (1x/dia, em 2º plano)
  const dbn = $('#discover-btn'); if (dbn) dbn.style.display = ['admin', 'advogado', 'staff'].includes(USER?.role) ? '' : 'none';
  resetIdle(); // arma o logout por inatividade
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {}); // PWA
    if ('Notification' in window && Notification.permission === 'granted') subscribePush();
  }
  setTimeout(maybeWelcome, 900); // boas-vindas no 1º acesso
}

// ── Tour de primeiro acesso (uma vez por aparelho) ────────────────────────
function maybeWelcome() {
  if (localStorage.getItem('crm_welcomed') === '1') return;
  if (USER?.role === 'cliente') { localStorage.setItem('crm_welcomed', '1'); return; }
  const first = (USER?.name || '').split(' ')[0] || '';
  const tip = (icon, t, d) => `<div style="display:flex;gap:12px;align-items:flex-start;padding:11px 0;border-bottom:1px solid var(--border-soft)">
      <span style="color:var(--gold);flex:0 0 auto;margin-top:1px">${svgIcon(icon)}</span>
      <div><strong style="color:var(--navy-deep);font-size:14px">${t}</strong><div style="font-size:13px;color:var(--text-soft);margin-top:1px">${d}</div></div></div>`;
  const wrap = el(`<div>
    <p style="font-size:14.5px;color:var(--text-soft);margin:0 0 12px">Que bom ter você aqui, ${esc(first)}! Um resumo rápido do que dá para fazer:</p>
    ${tip('plus', 'Novo Atendimento', 'O botão dourado no topo do menu inicia um atendimento e vira lead, proposta e processo.')}
    ${tip('home', 'Dashboards', 'Visão gerencial: financeiro, comercial, prazos e agenda — agora com gráficos.')}
    ${tip('gear', 'Aparência', 'Em Configurações você escolhe entre 6 temas (inclui modo escuro) e recolhe a barra lateral.')}
    ${tip('docs', 'Listas e exportação', 'Clientes, Processos e Propostas paginam de 20 em 20 e exportam em CSV.')}
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
      <button class="btn-primary" id="wl-ok" style="width:auto">Começar</button>
    </div>
  </div>`);
  wrap.querySelector('#wl-ok').onclick = () => { localStorage.setItem('crm_welcomed', '1'); closeModal(); };
  openModal('Bem-vinda ao seu CRM', wrap);
}

async function refreshBell() {
  try {
    const { count } = await api('/api/notifications/count');
    const badge = $('#bell-count');
    if (count > 0) { badge.textContent = count; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
    if ('Notification' in window && Notification.permission === 'granted') await maybeNotify();
  } catch {}
}

// Alertas do navegador (tipo app): dispara notificação do SO para cada nova
// pendência não lida. Na 1ª sincronização apenas registra (não alerta histórico).
const notifiedIds = new Set(JSON.parse(localStorage.getItem('crm_notified') || '[]'));
let notifSeeded = localStorage.getItem('crm_notified') != null;
function persistNotified() { localStorage.setItem('crm_notified', JSON.stringify([...notifiedIds].slice(-300))); }
async function maybeNotify() {
  const items = await api('/api/notifications').catch(() => []);
  if (!notifSeeded) { items.forEach((n) => notifiedIds.add(n.id)); persistNotified(); notifSeeded = true; return; }
  const novos = items.filter((n) => !notifiedIds.has(n.id)).slice(0, 5);
  for (const n of novos) {
    notifiedIds.add(n.id);
    const opts = { body: n.message || '', icon: '/logo.png', badge: '/logo.png', tag: 'crm-' + n.id };
    try {
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg && reg.showNotification) await reg.showNotification(n.title || 'CRM', opts);
      else new Notification(n.title || 'CRM', opts);
    } catch {}
  }
  if (novos.length) persistNotified();
}

// Pede permissão de alertas (acionado por botão — navegadores exigem gesto do usuário)
// e inscreve o dispositivo no Web Push (alerta com o app fechado).
async function ativarAlertas() {
  if (!('Notification' in window)) { toast('Este navegador não suporta alertas', 'error'); return; }
  const p = await Notification.requestPermission();
  if (p !== 'granted') { toast('Permissão de alertas negada', 'error'); return; }
  await subscribePush();
  toast('Alertas ativados neste aparelho'); refreshBell();
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Inscreve o dispositivo no Web Push (precisa de service worker + VAPID no servidor).
async function subscribePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const { key } = await api('/api/push/vapid-public').catch(() => ({ key: '' }));
    if (!key) return; // VAPID ainda não configurado no servidor
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
    }
    await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub }) });
  } catch { /* silencioso: o alerta em primeiro plano continua valendo */ }
}

// Logout automático por inatividade (1 hora sem ação).
let idleTimer = null;
const IDLE_MS = 60 * 60 * 1000;
function resetIdle() {
  if (!TOKEN) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { toast('Sessão encerrada por inatividade', 'error'); logout(); }, IDLE_MS);
}
['click', 'keydown', 'mousemove', 'scroll', 'touchstart'].forEach((ev) =>
  window.addEventListener(ev, resetIdle, { passive: true }));

// Descoberta por OAB (DJEN) no navegador (IP BR) — reusada pelo botão e pela auto-busca diária.
async function oabDiscover(lawyerId, oabNum, oabUf, onPage) {
  const itens = 100, maxPages = 20;
  let pubs = [];
  for (let p = 1; p <= maxPages; p++) {
    if (onPage) onPage(p);
    const url = `https://comunicaapi.pje.jus.br/api/v1/comunicacao?pagina=${p}&itensPorPagina=${itens}&numeroOab=${encodeURIComponent(oabNum)}&ufOab=${encodeURIComponent(oabUf || 'ES')}`;
    let data;
    try { const r = await fetch(url, { headers: { Accept: 'application/json' } }); if (!r.ok) break; data = await r.json(); }
    catch { break; }
    const items = (data.items || []).map((it) => ({
      id: it.id, numero_processo: it.numero_processo, numeroprocessocommascara: it.numeroprocessocommascara,
      siglaTribunal: it.siglaTribunal, nomeOrgao: it.nomeOrgao, nomeClasse: it.nomeClasse,
      data_disponibilizacao: it.data_disponibilizacao, tipoComunicacao: it.tipoComunicacao,
      texto: (it.texto || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 20000), link: it.link,
      parties: (it.destinatarios || []).map((d) => ({ nome: d.nome, polo: d.polo })),
      adv_count: (it.destinatarioadvogados || []).length,
    }));
    pubs = pubs.concat(items);
    if (items.length < itens) break;
  }
  if (!pubs.length) return { found: 0, novos: 0, clientesNovos: 0, publicacoes: 0, oab: `${oabNum}/${oabUf}`, vazio: true };
  return api('/api/processes/ingest-djen', { method: 'POST', body: JSON.stringify({ lawyer_id: Number(lawyerId), publications: pubs }) });
}

// Auto-busca diária (1x/dia, em segundo plano): atualiza processos, movimentações e prazos.
async function autoDiscoverDaily() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem('autoDiscover') === today) return;
    if (!['admin', 'advogado', 'staff'].includes(USER?.role)) return;
    const lawyers = await api('/api/lawyers').catch(() => []);
    let novos = 0, clientes = 0;
    for (const l of lawyers) {
      if (!l.oab_number || !l.monitoring_enabled) continue;
      try { const r = await oabDiscover(l.id, l.oab_number, l.oab_uf); novos += (r.novos || 0); clientes += (r.clientesNovos || 0); } catch {}
    }
    localStorage.setItem('autoDiscover', today);
    if (novos > 0 || clientes > 0) { toast(`Atualização diária: ${novos} processo(s) novo(s) e ${clientes} cliente(s). Confira Prazos e Monitoramento.`); refreshBell(); }
  } catch {}
}

// Descoberta por OAB sob demanda (botão do cabeçalho) — roda para todos os advogados.
async function discoverNow() {
  if (!['admin', 'advogado', 'staff'].includes(USER?.role)) { toast('Sem permissão para descobrir processos', 'error'); return; }
  const btn = $('#discover-btn'); if (!btn || btn.disabled) return;
  const orig = btn.textContent; btn.disabled = true; btn.textContent = 'Buscando…';
  try {
    const lawyers = await api('/api/lawyers').catch(() => []);
    const ativos = lawyers.filter((l) => l.oab_number && l.monitoring_enabled);
    if (!ativos.length) { toast('Nenhum advogado com OAB e monitoramento ativo. Cadastre em Advogados/OAB.', 'error'); return; }
    let novos = 0, clientes = 0;
    for (const l of ativos) {
      try { const r = await oabDiscover(l.id, l.oab_number, l.oab_uf, (p) => { btn.textContent = `Buscando… (pág. ${p})`; }); novos += (r.novos || 0); clientes += (r.clientesNovos || 0); } catch {}
    }
    toast(`Descoberta concluída: ${novos} processo(s) novo(s) e ${clientes} cliente(s). Veja em Monitoramento e Prazos.`);
    refreshBell();
  } catch (e) { toast(e.message || 'Falha na descoberta', 'error'); }
  finally { btn.disabled = false; btn.textContent = orig; }
}

async function openNotifications() {
  const wrap = el(`<div>
    <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
      <button class="btn-sm" id="notif-check">Verificar agora</button>
      <button class="btn-sm" id="notif-readall">Marcar todas como lidas</button>
      <button class="btn-sm" id="notif-bell">${svgIcon('bell')}Ativar alertas no aparelho</button>
      <button class="btn-sm" id="notif-settings">Configurações</button>
    </div>
    <div id="notif-list"><div class="spinner"></div></div>
  </div>`);
  wrap.querySelector('#notif-bell').onclick = ativarAlertas;
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
    wrap.querySelector('#notif-check').textContent = 'Verificando…';
    try { await api('/api/notifications/check', { method: 'POST' }); toast('Alertas atualizados'); } catch (e) { toast(e.message, 'error'); }
    wrap.querySelector('#notif-check').textContent = 'Verificar agora';
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
    <strong style="color:var(--navy)">Alertas via Telegram</strong>
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
    <strong style="color:var(--navy)">Alertas via WhatsApp <span class="badge novo">preparado</span></strong>
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
let routeToken = 0;
function router() {
  const token = ++routeToken;
  document.body.classList.remove('nav-open'); // fecha a gaveta ao navegar (mobile)
  const allowed = navForRole();
  let route = (location.hash.replace('#', '') || allowed[0]);
  if (!allowed.includes(route)) route = allowed[0]; // respeita o papel
  document.querySelectorAll('.nav-item').forEach((a) =>
    a.classList.toggle('active', a.dataset.route === route));
  document.querySelectorAll('.bottom-item[data-route]').forEach((a) =>
    a.classList.toggle('active', a.dataset.route === route));
  const page = $('#page');
  if (!page) return;
  // Transição sutil da página a cada navegação (respeita prefers-reduced-motion)
  page.classList.remove('page-in'); void page.offsetWidth; page.classList.add('page-in');
  page.innerHTML = '<div class="spinner"></div>';
  const fn = ROUTES[route] || ROUTES[allowed[0]];
  // Só escreve o erro se ainda estivermos na mesma rota (evita atropelar a tela nova)
  fn(page).catch((err) => { if (token === routeToken) page.innerHTML = `<div class="empty">${err.message}</div>`; });
}

// ── Pages ──
const ROUTES = {
  async dashboard(page) {
    page.innerHTML = `
      <div class="page-header"><div><h2>Dashboards</h2><p class="sub">Visão gerencial do escritório</p></div></div>
      <div class="tabs" id="dash-tabs">
        <button class="tab active" data-tab="cockpit">Cockpit</button>
        <button class="tab" data-tab="comercial">Comercial</button>
        <button class="tab" data-tab="monitoramento">Processos</button>
        <button class="tab" data-tab="processual">Processual</button>
        <button class="tab" data-tab="agenda">Agenda</button>
        <button class="tab" data-tab="financeiro">Financeiro</button>
        <button class="tab" data-tab="producao">Produção</button>
        <button class="tab" data-tab="parceria">Parceria (protocolados)</button>
      </div>
      <div id="dash-content"></div>`;
    const tabs = { cockpit: dashCockpit, comercial: dashComercial, monitoramento: dashMonitoramento, processual: dashProcessual, agenda: dashAgenda, financeiro: dashFinanceiro, producao: dashProducao, parceria: dashParceriaMensal };
    const show = async (name) => {
      document.querySelectorAll('#dash-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
      const c = $('#dash-content'); c.innerHTML = '<div class="spinner"></div>';
      try { await tabs[name](c); } catch (e) { c.innerHTML = `<div class="empty">${e.message}</div>`; }
    };
    document.querySelectorAll('#dash-tabs .tab').forEach((t) => t.onclick = () => show(t.dataset.tab));
    await show('cockpit');
  },

  async clients(page) {
    page.innerHTML = `
      <div class="page-header"><div><h2>Clientes</h2><p class="sub">Cadastro de clientes</p></div>
        <button class="btn-gold" id="new-client">+ Novo cliente</button></div>
      <div class="toolbar">
        <input id="cli-search" placeholder="Buscar por nome, CPF/CNPJ ou e-mail…" />
        <select id="cli-status"><option value="">Todos status</option><option value="ativo">Ativo</option><option value="inativo">Inativo</option><option value="prospecto">Prospecto</option></select>
        <span class="spacer"></span>
        <button class="btn-ghost" id="cli-export">${svgIcon('docs')}Exportar CSV</button>
      </div>
      <div class="card"><div id="cli-table"></div></div>`;
    let cliPage = 1;
    const load = async () => {
      const q = new URLSearchParams();
      q.set('limit', '20');
      q.set('page', String(cliPage));
      if ($('#cli-search').value) q.set('search', $('#cli-search').value);
      if ($('#cli-status').value) q.set('status', $('#cli-status').value);
      const r = await api('/api/clients?' + q);
      const pages = r.pages || 1;
      $('#cli-table').innerHTML = r.data.length ? `
        <table><thead><tr><th>Nome</th><th>Tipo</th><th>Contato</th><th>Status</th><th></th></tr></thead>
        <tbody>${r.data.map((c) => `<tr>
          <td><strong>${c.name}</strong> ${c.is_dative ? '<span class="badge dativo">DATIVO</span>' : ''}${Number(c.movs_recentes) ? '<span style="display:inline-block;white-space:nowrap;font-size:10px;background:#fdecec;color:var(--red);font-weight:700;padding:1px 7px;border-radius:10px;margin-left:4px">' + svgIcon('bell', 'ic-xs') + ' movimentação</span>' : ''}${areaChipsHtml(c.areas)}<br><small style="color:var(--text-muted)">${c.cpf_cnpj || ''}</small></td>
          <td>${c.tipo}</td><td>${c.phone ? esc(c.phone) + waBtn(c.phone) : (c.email || '—')}</td><td>${badge(c.status)}</td>
          <td style="white-space:nowrap"><button class="btn-sm" data-ficha="${c.id}">${svgIcon('clipboard')}Ficha</button> <button class="btn-sm" data-edit="${c.id}">Editar</button></td></tr>`).join('')}</tbody></table>
        <div class="list-foot"><span>${r.total} cliente(s) · página ${r.page} de ${pages}</span>${pagerHtml(r.page, pages)}</div>`
        : '<div class="empty">Nenhum cliente encontrado</div>';
      document.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => clientForm(b.dataset.edit, load));
      document.querySelectorAll('[data-ficha]').forEach((b) => b.onclick = () => fichaCliente(b.dataset.ficha, load));
      document.querySelectorAll('#cli-table [data-page]').forEach((b) => b.onclick = () => {
        cliPage = Number(b.dataset.page); load(); $('#page').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    };
    const reload = () => { cliPage = 1; load(); };
    $('#new-client').onclick = () => clientForm(null, load);
    $('#cli-search').oninput = debounce(reload, 350);
    $('#cli-status').onchange = reload;
    $('#cli-export').onclick = async () => {
      const params = {};
      if ($('#cli-search').value) params.search = $('#cli-search').value;
      if ($('#cli-status').value) params.status = $('#cli-status').value;
      toast('Gerando CSV…');
      const rows = await fetchAllPages('/api/clients', params);
      downloadCsv('clientes.csv', [
        { label: 'Nome', key: 'name' }, { label: 'Tipo', key: 'tipo' }, { label: 'CPF/CNPJ', key: 'cpf_cnpj' },
        { label: 'E-mail', key: 'email' }, { label: 'Telefone', key: 'phone' }, { label: 'Status', key: 'status' },
      ], rows);
      toast(`${rows.length} cliente(s) exportado(s)`);
    };
    await load();
  },

  async leads(page) {
    page.innerHTML = `
      <div class="page-header"><div><h2>Leads</h2><p class="sub">Funil comercial</p></div>
        <button class="btn-gold" id="new-lead">+ Novo lead</button></div>
      <div id="board" class="kanban"></div>`;
    const cols = { triagem: 'Novo Lead', atendimento_inicial: 'Primeiro Contato', reuniao: 'Atendimento Realizado', documentacao_pendente: 'Documentação Pendente', proposta: 'Proposta Enviada', proposta_em_analise: 'Negociação', contrato_assinado: 'Contrato Assinado' };
    const load = async () => {
      const b = await api('/api/leads/board');
      $('#board').innerHTML = Object.entries(cols).map(([k, label]) => `
        <div class="kanban-col" data-stage="${k}"><h4>${label}<span class="count">${(b[k] || []).length}</span></h4>
        ${(b[k] || []).map((l) => `<div class="kanban-card" draggable="true" data-lead="${l.id}" data-stage="${k}">
          <strong>${esc(l.name)}</strong><small>${l.legal_area || ''} · ${l.source || ''}</small></div>`).join('')}</div>`).join('');

      const moveLead = async (leadId, stage, from) => {
        if (!leadId || !stage || stage === from) return;
        try { await api(`/api/leads/${leadId}/status`, { method: 'PATCH', body: JSON.stringify({ status: stage }) }); toast('Etapa do lead atualizada'); load(); }
        catch (e) { toast(e.message, 'error'); load(); }
      };
      $('#board').querySelectorAll('.kanban-card').forEach((c) => {
        c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', JSON.stringify({ id: c.dataset.lead, from: c.dataset.stage })); c.style.opacity = '0.45'; });
        c.addEventListener('dragend', () => { c.style.opacity = ''; });
        c.onclick = () => leadDetail(c.dataset.lead, load);
      });
      $('#board').querySelectorAll('.kanban-col').forEach((col) => {
        col.addEventListener('dragover', (e) => { e.preventDefault(); col.style.outline = '2px dashed var(--gold)'; });
        col.addEventListener('dragleave', () => { col.style.outline = ''; });
        col.addEventListener('drop', (e) => {
          e.preventDefault(); col.style.outline = '';
          let d = {}; try { d = JSON.parse(e.dataTransfer.getData('text/plain')); } catch {}
          moveLead(d.id, col.dataset.stage, d.from);
        });
      });
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
        <span class="spacer"></span>
        <button class="btn-ghost" id="prop-export">${svgIcon('docs')}Exportar CSV</button>
      </div>
      <div class="card"><div id="prop-table"></div></div>`;
    let propPage = 1;
    const load = async () => {
      const q = new URLSearchParams();
      q.set('limit', '20'); q.set('page', String(propPage));
      if ($('#prop-status').value) q.set('status', $('#prop-status').value);
      const r = await api('/api/propostas?' + q);
      const pages = r.pages || 1;
      $('#prop-table').innerHTML = r.data.length ? `
        <table><thead><tr><th>Título</th><th>Cliente</th><th>Valor</th><th>Status</th><th>Validade</th><th></th></tr></thead>
        <tbody>${r.data.map((p) => `<tr>
          <td><strong>${p.title}</strong></td><td>${p.client_name || '—'}</td>
          <td>${money(p.valor)}</td><td>${badge(p.status)}</td><td>${fmtDate(p.validade)}</td>
          <td style="white-space:nowrap"><button class="btn-sm" data-edit-prop="${p.id}">${svgIcon('edit')} Editar</button> <button class="btn-sm" data-prop="${p.id}">Abrir</button></td></tr>`).join('')}</tbody></table>
        <div class="list-foot"><span>${r.total} proposta(s) · página ${r.page} de ${pages}</span>${pagerHtml(r.page, pages)}</div>`
        : '<div class="empty">Nenhuma proposta ainda</div>';
      document.querySelectorAll('[data-edit-prop]').forEach((b) => b.onclick = async () => {
        const prop = await api('/api/propostas/' + b.dataset.editProp);
        propostaForm(load, null, prop);
      });
      document.querySelectorAll('[data-prop]').forEach((b) => b.onclick = () => propostaDetail(b.dataset.prop, load));
      document.querySelectorAll('#prop-table [data-page]').forEach((b) => b.onclick = () => {
        propPage = Number(b.dataset.page); load(); $('#page').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    };
    $('#new-prop').onclick = () => propostaForm(load);
    $('#prop-status').onchange = () => { propPage = 1; load(); };
    $('#prop-export').onclick = async () => {
      const params = {};
      if ($('#prop-status').value) params.status = $('#prop-status').value;
      toast('Gerando CSV…');
      const rows = await fetchAllPages('/api/propostas', params);
      downloadCsv('propostas.csv', [
        { label: 'Título', key: 'title' }, { label: 'Cliente', key: 'client_name' },
        { label: 'Valor', get: (r) => r.valor }, { label: 'Status', key: 'status' },
        { label: 'Validade', get: (r) => r.validade ? fmtDate(r.validade) : '' },
      ], rows);
      toast(`${rows.length} proposta(s) exportada(s)`);
    };
    await load();
  },

  async cases(page) {
    page.innerHTML = `
      <div class="page-header"><div><h2>Processos</h2><p class="sub">Casos e movimentações</p></div>
        <button class="btn-gold" id="new-case">+ Novo processo</button></div>
      <div class="toolbar">
        <input id="case-search" placeholder="Buscar por título ou número…" />
        <select id="case-status"><option value="">Todos status</option><option value="ativo">Ativo</option><option value="suspenso">Suspenso</option><option value="encerrado">Encerrado</option></select>
        <span class="spacer"></span>
        <button class="btn-ghost" id="case-export">${svgIcon('docs')}Exportar CSV</button>
      </div>
      <div class="card"><div id="case-table"></div></div>`;
    let casePage = 1;
    const load = async () => {
      const q = new URLSearchParams();
      q.set('limit', '20'); q.set('page', String(casePage));
      if ($('#case-search').value) q.set('search', $('#case-search').value);
      if ($('#case-status').value) q.set('status', $('#case-status').value);
      const r = await api('/api/cases?' + q);
      const pages = r.pages || 1;
      $('#case-table').innerHTML = r.data.length ? `
        <table><thead><tr><th>Processo</th><th>Cliente</th><th>Área</th><th>Fase</th><th>Status</th><th></th></tr></thead>
        <tbody>${r.data.map((c) => `<tr>
          <td><strong>${c.title}</strong><br><small style="color:var(--text-muted)">${c.case_number || 's/ número'}</small></td>
          <td>${c.client_name || '—'}</td><td>${c.legal_area}</td><td>${badge(c.phase)}</td><td>${badge(c.status)}</td>
          <td><button class="btn-sm" data-case="${c.id}">Abrir</button></td></tr>`).join('')}</tbody></table>
        <div class="list-foot"><span>${r.total} processo(s) · página ${r.page} de ${pages}</span>${pagerHtml(r.page, pages)}</div>`
        : '<div class="empty">Nenhum processo ainda</div>';
      document.querySelectorAll('[data-case]').forEach((b) => b.onclick = () => caseDetail(b.dataset.case, load));
      document.querySelectorAll('#case-table [data-page]').forEach((b) => b.onclick = () => {
        casePage = Number(b.dataset.page); load(); $('#page').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    };
    const reload = () => { casePage = 1; load(); };
    $('#new-case').onclick = () => caseForm(load);
    $('#case-search').oninput = debounce(reload, 350);
    $('#case-status').onchange = reload;
    $('#case-export').onclick = async () => {
      const params = {};
      if ($('#case-search').value) params.search = $('#case-search').value;
      if ($('#case-status').value) params.status = $('#case-status').value;
      toast('Gerando CSV…');
      const rows = await fetchAllPages('/api/cases', params);
      downloadCsv('processos.csv', [
        { label: 'Título', key: 'title' }, { label: 'Número', key: 'case_number' }, { label: 'Cliente', key: 'client_name' },
        { label: 'Área', key: 'legal_area' }, { label: 'Fase', key: 'phase' }, { label: 'Status', key: 'status' },
      ], rows);
      toast(`${rows.length} processo(s) exportado(s)`);
    };
    await load();
  },

  async prazos(page) {
    page.innerHTML = `
      <div class="page-header"><div><h2>Prazos & Tarefas</h2><p class="sub">Contagem regressiva e prioridades</p></div>
        <div style="display:flex;gap:8px"><button class="btn-gold" id="new-deadline">+ Prazo</button>
        <button class="btn-gold" id="new-task">+ Tarefa</button></div></div>
      <div id="dd-card"></div>
      <div class="card" style="margin-bottom:20px"><div style="padding:14px 18px;border-bottom:1px solid var(--border)"><strong style="color:var(--navy)">Prazos processuais</strong></div><div id="dl-table"></div></div>
      <div class="card"><div style="padding:14px 18px;border-bottom:1px solid var(--border)"><strong style="color:var(--navy)">${svgIcon('check', 'ic-t')}Tarefas</strong></div><div id="task-table"></div></div>`;

    const countdown = (days, label) => {
      if (label === 'vencido') return `<span class="badge vencido">vencido</span>`;
      const txt = days === 0 ? 'hoje' : days === 1 ? '1 dia' : `${days} dias`;
      return `<span class="badge ${label}">${txt}</span>`;
    };

    const loadDeadlines = async () => {
      const r = await api('/api/deadlines?status=pendente');
      $('#dl-table').innerHTML = r.data.length ? `
        <table><thead><tr><th>Prazo</th><th>Processo</th><th>Vencimento</th><th>Restam</th><th></th></tr></thead>
        <tbody>${r.data.map((d) => { const mv = d.movement_text || ''; return `<tr>
          <td><strong>${d.description}</strong>${mv ? `<br><small style="color:var(--text-muted);font-size:0.85em">${esc(mv.slice(0, 90))}${mv.length > 90 ? '…' : ''}</small>` : ''}</td>
          <td>${d.client_name || d.case_number || '—'}</td>
          <td>${fmtDate(d.deadline_date)}</td><td>${countdown(d.days_remaining, d.status_label)}</td>
          <td nowrap>${mv ? `<button class="btn-sm" data-full-dl="${d.id}">Íntegra</button> ` : ''}<button class="btn-sm" data-done-dl="${d.id}">Cumprir</button></td></tr>`; }).join('')}</tbody></table>`
        : '<div class="empty">Nenhum prazo pendente</div>';
      document.querySelectorAll('[data-done-dl]').forEach((b) => b.onclick = async () => {
        try { await api(`/api/deadlines/${b.dataset.doneDl}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'cumprido' }) });
          toast('Prazo cumprido'); loadDeadlines(); } catch (e) { toast(e.message, 'error'); }
      });
      document.querySelectorAll('[data-full-dl]').forEach((b) => b.onclick = () => {
        const d = r.data.find((x) => x.id == b.dataset.fullDl);
        if (d) showMovementFull({ movement_full: d.movement_text, process_number: d.case_number });
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

    const loadDetected = async () => {
      const rows = await api('/api/prazos-detectados').catch(() => []);
      $('#dd-card').innerHTML = rows.length ? `
        <div class="card" style="margin-bottom:20px;border:1px solid var(--gold)">
          <div style="padding:14px 18px;border-bottom:1px solid var(--border)"><strong style="color:var(--gold)">⚠ Prazos detectados no monitoramento (${rows.length})</strong>
            <p class="sub" style="margin:2px 0 0">Movimentações que podem iniciar prazo — confirme a data (o sistema não chuta).</p></div>
          <table><thead><tr><th>Cliente / Parte</th><th>Movimentação</th><th>Processo</th><th>Sugestão</th><th></th></tr></thead>
          <tbody>${rows.map((d) => { const full = d.movement_full || d.movement_text || ''; return `<tr>
            <td><strong>${d.client_name || '<span style=\"color:var(--text-muted)\">a vincular</span>'}</strong></td>
            <td>${esc(full.slice(0, 110))}${full.length > 110 ? '…' : ''}
                <br><small style="color:var(--text-muted)">movimentação ${fmtDate(d.movement_date || d.start_date)}</small>
                ${full.length > 110 ? `<br><button class="btn-sm" data-full-dd="${d.id}" style="margin-top:6px">${svgIcon('file')}Ver na íntegra</button>` : ''}
                ${d.ai_summary ? `<div style="margin-top:8px;padding:8px 10px;border-left:3px solid var(--gold);background:var(--surface);font-size:12px;line-height:1.5"><strong>🧑‍🎓 Estagiário IA:</strong><br>${esc(d.ai_summary.slice(0, 400))}${d.ai_summary.length > 400 ? '…' : ''}</div>` : ''}
                ${d.ai_draft_id
                  ? `<button class="btn-sm" data-draft-dd="${d.ai_draft_id}" style="margin-top:6px">${svgIcon('edit')}Ver minuta</button> <button class="btn-sm" data-gen-dd="${d.id}" style="margin-top:6px">${svgIcon('ia')} Refazer com IA</button>`
                  : `<button class="btn-gold btn-sm" data-gen-dd="${d.id}" style="margin-top:6px">${svgIcon('ia')} Gerar minuta (IA)</button>`}</td>
            <td>${d.process_number || '—'}</td>
            <td>${d.suggested_type || '—'} · ${d.suggested_days || '?'} dias</td>
            <td style="white-space:nowrap"><button class="btn-gold btn-sm" data-conf-dd="${d.id}">Confirmar</button> <button class="btn-sm" data-disc-dd="${d.id}">Descartar</button></td></tr>`; }).join('')}</tbody></table>
        </div>` : '';
      document.querySelectorAll('[data-conf-dd]').forEach((b) => b.onclick = () => {
        const d = rows.find((x) => x.id == b.dataset.confDd);
        confirmDeadlineForm(d, () => { loadDetected(); loadDeadlines(); });
      });
      document.querySelectorAll('[data-disc-dd]').forEach((b) => b.onclick = async () => {
        try { await api(`/api/prazos-detectados/${b.dataset.discDd}/descartar`, { method: 'POST', body: '{}' }); toast('Descartado'); loadDetected(); } catch (e) { toast(e.message, 'error'); }
      });
      document.querySelectorAll('[data-full-dd]').forEach((b) => b.onclick = () => {
        showMovementFull(rows.find((x) => x.id == b.dataset.fullDd));
      });
      document.querySelectorAll('[data-gen-dd]').forEach((b) => b.onclick = async () => {
        const orig = b.innerHTML; b.disabled = true; b.textContent = 'Gerando com IA...';
        try {
          const r = await api(`/api/prazos-detectados/${b.dataset.genDd}/minuta`, { method: 'POST', body: '{}' });
          toast('Minuta gerada pela IA');
          loadDetected();
          if (r.ai_draft_id) {
            const g = await api(`/api/ai/${r.ai_draft_id}`);
            openModal('Minuta da IA — revisar antes de protocolar', el(`<div>
              <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">${esc(g.title || '')}</div>
              <div style="font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:60vh;overflow:auto;border:1px solid var(--border);border-radius:var(--radius);padding:12px;background:var(--surface)">${esc(g.result || '(vazio)')}</div>
            </div>`));
          }
        } catch (e) { toast(e.message, 'error'); b.disabled = false; b.innerHTML = orig; }
      });
      document.querySelectorAll('[data-draft-dd]').forEach((b) => b.onclick = async () => {
        try {
          const g = await api(`/api/ai/${b.dataset.draftDd}`);
          openModal('Minuta da IA — revisar antes de protocolar', el(`<div>
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">${esc(g.title || '')}</div>
            <div style="font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:60vh;overflow:auto;border:1px solid var(--border);border-radius:var(--radius);padding:12px;background:var(--surface)">${esc(g.result || '(vazio)')}</div>
          </div>`));
        } catch (e) { toast(e.message, 'error'); }
      });
    };
    $('#new-deadline').onclick = () => deadlineForm(loadDeadlines);
    $('#new-task').onclick = () => taskForm(loadTasks);
    await loadDeadlines(); await loadTasks(); await loadDetected();
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
          const safe = (it.title || '').replace(/"/g, '&quot;');
          return `<div class="cal-chip ${cls}" data-id="${it.id}" data-type="${it.type}" title="${safe}">${hora}${it.title}</div>`;
        }).join('');
        const more = items.length > 4 ? `<div class="cal-chip" style="color:var(--text-muted)">+${items.length - 4}</div>` : '';
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        html += `<div class="cal-day ${other} ${isToday}" data-date="${ds}" title="Clique para lançar um compromisso"><span class="num">${d.getDate()}</span>${chips}${more}</div>`;
      }
      const calBody = $('#cal-body');
      if (!calBody) return; // trocou de tela durante o carregamento do feed
      calBody.innerHTML = html;
      calBody.querySelectorAll('.cal-day').forEach((cell) => {
        cell.onclick = (ev) => {
          const chip = ev.target.closest('.cal-chip');
          if (chip && chip.dataset.id) {
            const it = feed.find((x) => String(x.id) === chip.dataset.id && x.type === chip.dataset.type);
            if (it) eventDetail(it, render);
            return;
          }
          if (chip) return; // chip "+N" (mais), ignora
          eventForm(render, cell.dataset.date);
        };
      });
    };

    const renderGoogle = async () => {
      let st = { connected: false };
      try { st = await api('/api/calendar/google/status'); } catch {}
      const area = $('#google-area');
      if (!area) return; // trocou de tela durante o carregamento
      if (st.connected) {
        area.innerHTML = `<small style="color:var(--green)">${st.google_email || 'Google conectado'}</small>
          <button class="btn-sm" id="g-sync">Sincronizar</button>`;
        $('#g-sync').onclick = async () => {
          try { const r = await api('/api/calendar/google/sync', { method: 'POST' });
            toast(`Sincronizado (${r.fromGoogle?.created || 0} novos)`); render(); } catch (e) { toast(e.message, 'error'); }
        };
      } else {
        area.innerHTML = `<button class="btn-sm" id="g-connect">Conectar Google Agenda</button>`;
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
    page.innerHTML = `
      <div class="page-header"><div><h2>Financeiro</h2><p class="sub">Visão geral, acordos, receitas, repasses e inadimplência</p></div></div>
      <div class="tabs" id="fin-tabs">
        <button class="tab active" data-tab="geral">Visão geral</button>
        <button class="tab" data-tab="acordos">Acordos</button>
        <button class="tab" data-tab="receitas">Receitas & Parcelas</button>
        <button class="tab" data-tab="pagar">Contas a Pagar</button>
        <button class="tab" data-tab="repasses">Repasses</button>
        <button class="tab" data-tab="inadimplencia">Inadimplência</button>
        <button class="tab" data-tab="fluxo">Fluxo de Caixa</button>
        <button class="tab" data-tab="pagamentos">Pagamentos a confirmar</button>
        <button class="tab" data-tab="auditoria">Auditoria</button>
      </div>
      <div id="fin-content"></div>`;
    const tabs = { geral: finVisaoGeral, acordos: finAcordos, receitas: finReceitas, pagar: finContasPagar, repasses: finRepasses, inadimplencia: finInadimplencia, fluxo: finFluxoCaixa, pagamentos: finPagamentos, auditoria: finAuditoria };
    const show = async (name) => {
      document.querySelectorAll('#fin-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
      const c = $('#fin-content'); c.innerHTML = '<div class="spinner"></div>';
      try { await tabs[name](c); } catch (e) { c.innerHTML = `<div class="empty">${e.message}</div>`; }
    };
    document.querySelectorAll('#fin-tabs .tab').forEach((t) => t.onclick = () => show(t.dataset.tab));
    await show('geral');
  },

  async config(page) {
    page.innerHTML = `
      <div class="page-header"><div><h2>Configurações</h2><p class="sub">Usuários e conta</p></div>
        <button class="btn-gold" id="new-user">+ Novo usuário</button></div>
      <div class="card" style="margin-bottom:20px"><div id="users-table"></div></div>

      <div class="card" style="padding:20px;margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div><h3 style="color:var(--navy);margin-bottom:2px">${svgIcon('shield','ic-title')}Proteção de dados (LGPD)</h3>
            <p class="sub" style="margin:0">Tokens do Google e backups cifrados · dados sem finalidade são expurgados</p></div>
          <button class="btn-sm" id="sec-reload">Atualizar</button>
        </div>
        <div id="sec-status" style="margin-top:14px"><div class="spinner"></div></div>
      </div>

      <div class="card" style="padding:20px;margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div><h3 style="color:var(--navy);margin-bottom:2px">${svgIcon('clock','ic-title')}Saúde das rotinas automáticas</h3>
            <p class="sub" style="margin:0">Prazos, backup, financeiro e sincronizações — descubra a falha antes de sentir o sintoma</p></div>
          <button class="btn-sm" id="job-reload">Atualizar</button>
        </div>
        <div id="job-health" style="margin-top:14px"><div class="spinner"></div></div>
      </div>

      <div class="card" style="padding:20px;margin-bottom:20px">
        <h3 style="color:var(--navy);margin-bottom:12px">Minha conta</h3>
        <button class="btn-sm" id="change-pwd">Trocar minha senha</button>
      </div>
      <div class="card" style="padding:20px;margin-bottom:20px">
        <h3 style="color:var(--navy);margin-bottom:6px">Aparência</h3>
        <p class="sub" style="margin-bottom:14px">Escolha o visual do sistema. A preferência fica salva neste aparelho.</p>
        <div class="theme-grid" id="theme-grid"></div>
        <label class="agree" style="display:flex;align-items:center;gap:9px;margin-top:16px;font-size:13.5px;cursor:pointer">
          <input type="checkbox" id="sb-collapse-opt" /> Iniciar com a barra lateral recolhida (mais espaço)
        </label>
      </div>
      <div class="card" style="padding:20px;margin-bottom:20px">
        <h3 style="color:var(--navy);margin-bottom:6px">Escritório — Pix e contato</h3>
        <p class="sub" style="margin-bottom:12px">Usados no portal do cliente (pagar com Pix e falar com o escritório).</p>
        <div class="form-row"><label>Chave Pix<input id="os-pix-key" placeholder="e-mail, CPF/CNPJ, telefone ou aleatória" /></label>
        <label>Nome do beneficiário<input id="os-pix-nome" placeholder="ex.: Leticia Barros Advocacia" /></label></div>
        <div class="form-row" style="margin-top:10px"><label>Cidade<input id="os-pix-cidade" placeholder="ex.: Vitória" /></label>
        <label>WhatsApp do escritório<input id="os-whats" placeholder="ex.: 5527999998888 (só números, com DDI)" /></label></div>
        <div class="form-row" style="margin-top:10px"><label>Multa por atraso (%)<input id="os-multa" type="number" step="0.5" placeholder="ex.: 2" /></label>
        <label>Juros ao mês (%)<input id="os-juros" type="number" step="0.5" placeholder="ex.: 1" /></label></div>
        <div class="form-row" style="margin-top:10px"><label>Meta de faturamento mensal (R$)<input id="os-meta" type="number" step="100" placeholder="ex.: 20000" /></label><span></span></div>
        <p class="sub" style="margin-top:6px;font-size:12px">Multa/juros atualizam o valor das parcelas vencidas no portal e no Pix. A meta aparece na Visão Geral do Financeiro.</p>
        <button class="btn-gold btn-sm" id="os-save" style="margin-top:12px">Salvar</button>
      </div>
      <div class="card" style="padding:20px;margin-bottom:20px">
        <h3 style="color:var(--navy);margin-bottom:6px">Automações</h3>
        <p class="sub" style="margin-bottom:12px">Regras que rodam sozinhas. Ligue ou desligue conforme o fluxo do escritório.</p>
        <div id="automation-list"><div class="spinner"></div></div>
      </div>
      <div class="card" style="padding:20px">
        <h3 style="color:var(--navy);margin-bottom:6px">Backup do sistema</h3>
        <p class="sub" style="margin-bottom:12px">Cópia diária do banco enviada ao MEGA automaticamente às 02h.</p>
        <button class="btn-gold btn-sm" id="run-backup">Fazer backup agora</button>
        <div id="backup-list" style="margin-top:14px"></div>
      </div>`;

    // ── Seletor de aparência (6 temas) ──
    const renderThemes = () => {
      const cur = currentTheme();
      $('#theme-grid').innerHTML = THEME_META.map((t) => `
        <button type="button" class="theme-card ${t.id === cur ? 'sel' : ''}" data-theme="${t.id}">
          <span class="theme-prev" style="background:${t.bg}">
            <span class="theme-sb" style="background:${t.sb}"></span>
            <span class="theme-dot"></span>
          </span>
          <span class="theme-name">${t.label}</span>
          <span class="theme-desc">${t.desc}</span>
        </button>`).join('');
      document.querySelectorAll('#theme-grid .theme-card').forEach((b) => b.onclick = () => {
        applyTheme(b.dataset.theme); renderThemes(); toast('Aparência aplicada');
      });
    };
    renderThemes();
    const sbOpt = $('#sb-collapse-opt');
    sbOpt.checked = localStorage.getItem('crm_sidebar') === '1';
    sbOpt.onchange = () => setSidebarCollapsed(sbOpt.checked);

    // ── Escritório (Pix e contato do portal do cliente) ──
    (async () => {
      try {
        const os = await api('/api/office-settings');
        $('#os-pix-key').value = os.pix_key || ''; $('#os-pix-nome').value = os.pix_nome || '';
        $('#os-pix-cidade').value = os.pix_cidade || ''; $('#os-whats').value = os.whatsapp || '';
        $('#os-multa').value = os.multa_percent || ''; $('#os-juros').value = os.juros_mes_percent || '';
        $('#os-meta').value = os.meta_faturamento_mes || '';
      } catch {}
    })();
    $('#os-save').onclick = async () => {
      try {
        await api('/api/office-settings', { method: 'PATCH', body: JSON.stringify({
          pix_key: $('#os-pix-key').value, pix_nome: $('#os-pix-nome').value,
          pix_cidade: $('#os-pix-cidade').value, whatsapp: $('#os-whats').value,
          multa_percent: $('#os-multa').value, juros_mes_percent: $('#os-juros').value,
          meta_faturamento_mes: $('#os-meta').value }) });
        toast('Configurações do escritório salvas');
      } catch (e) { toast(e.message, 'error'); }
    };

    const loadAutomations = async () => {
      try {
        const rules = await api('/api/automation/rules');
        $('#automation-list').innerHTML = rules.map((r) => `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid var(--border-soft)">
            <div><strong>${esc(r.name)}</strong> ${r.enabled ? '<span class="badge ativo">ligada</span>' : '<span class="badge inativo">desligada</span>'}
              <br><small style="color:var(--text-muted)">${esc(r.description || '')}</small></div>
            <button class="btn-sm" data-rule="${r.key}" data-on="${r.enabled ? 1 : 0}" style="flex-shrink:0">${r.enabled ? 'Desligar' : 'Ligar'}</button>
          </div>`).join('');
        document.querySelectorAll('[data-rule]').forEach((b) => b.onclick = async () => {
          const turnOn = b.dataset.on !== '1';
          try {
            await api(`/api/automation/rules/${b.dataset.rule}`, { method: 'PATCH', body: JSON.stringify({ enabled: turnOn }) });
            toast(turnOn ? 'Automação ligada' : 'Automação desligada');
            loadAutomations();
          } catch (e) { toast(e.message, 'error'); }
        });
      } catch (e) { $('#automation-list').innerHTML = `<div class="empty">${e.message}</div>`; }
    };
    const loadBackups = async () => {
      try {
        const r = await api('/api/backup');
        $('#backup-list').innerHTML = r.total ? `
          <table><thead><tr><th>Arquivo</th><th>Tamanho</th></tr></thead>
          <tbody>${r.backups.map((b) => `<tr><td>${b.name}</td><td>${b.sizeKB} KB</td></tr>`).join('')}</tbody></table>`
          : '<div class="empty">Nenhum backup ainda. Clique em "Fazer backup agora" ou aguarde as 02h.</div>';
      } catch (e) { $('#backup-list').innerHTML = `<div class="empty">${e.message}</div>`; }
    };
    const load = async () => {
      const users = await api('/api/users');
      $('#users-table').innerHTML = `
        <table><thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Detalhe</th><th>Status</th><th></th></tr></thead>
        <tbody>${users.map((u) => `<tr>
          <td><strong>${u.name}</strong></td><td>${u.email}</td><td>${badge(u.role)}</td>
          <td>${u.role === 'parceiro' ? (u.commission_percent || '?') + '% repasse' : u.role === 'cliente' ? (u.client_name || '—') : '—'}</td>
          <td>${u.active ? '<span class="badge ativo">ativo</span>' : '<span class="badge inativo">inativo</span>'}</td>
          <td style="white-space:nowrap">
            <button class="btn-sm" data-reset="${u.id}" data-name="${esc(u.name)}">Gerar nova senha</button>
            ${u.role !== 'admin' ? `<button class="btn-sm" data-toggle="${u.id}" data-active="${u.active}">${u.active ? 'Desativar' : 'Ativar'}</button>` : ''}
          </td>
        </tr>`).join('')}</tbody></table>`;
      document.querySelectorAll('[data-toggle]').forEach((b) => b.onclick = async () => {
        await api('/api/users/' + b.dataset.toggle, { method: 'PUT', body: JSON.stringify({ active: b.dataset.active !== '1' }) });
        toast('Usuário atualizado'); load();
      });
      document.querySelectorAll('[data-reset]').forEach((b) => b.onclick = async () => {
        if (!confirm(`Gerar uma nova senha para ${b.dataset.name}? A senha atual deixará de funcionar.`)) return;
        try {
          const r = await api('/api/users/' + b.dataset.reset + '/reset-password', { method: 'POST', body: '{}' });
          openModal('Nova senha gerada', el(`<div>
            <p class="sub">Repasse esta senha temporária para <strong>${esc(b.dataset.name)}</strong>. Recomende a troca no primeiro acesso.</p>
            <div style="font-size:22px;font-weight:700;letter-spacing:1px;text-align:center;padding:14px;border:1px dashed var(--border);border-radius:var(--radius);background:var(--surface);margin-top:8px">${esc(r.password || '')}</div>
          </div>`));
        } catch (e) { toast(e.message, 'error'); }
      });
    };
    $('#new-user').onclick = () => userForm(load);
    $('#change-pwd').onclick = () => changePasswordForm();

    // ── Proteção de dados (LGPD): prova verificável, sem precisar de DevTools ──
    const loadSeguranca = async () => {
      const box = $('#sec-status'); if (!box) return;
      try {
        const s = await api('/api/security/status');
        const pill = (ok, txt) => `<span style="display:inline-block;font-size:11.5px;font-weight:600;padding:3px 10px;border-radius:12px;background:${ok ? 'var(--green,#1e8e5a)' : 'var(--red,#c0392b)'};color:#fff">${txt}</span>`;
        const linha = (rot, val, ok) => `<div class="mini-row" style="padding:7px 0"><span>${rot}</span>${pill(ok, val)}</div>`;
        box.innerHTML = `
          <div style="margin-bottom:10px">${s.protegido
            ? pill(true, '✓ PROTEGIDO')
            : pill(false, '⚠ AÇÃO NECESSÁRIA')}</div>
          ${linha('Chave de cifragem', s.chave.origem, s.chave.configurada)}
          ${linha('Tokens do Google/WhatsApp em texto puro', `${s.tokens_oauth.em_claro} em claro · ${s.tokens_oauth.cifrados} cifrados`, s.tokens_oauth.ok)}
          ${linha('Backup enviado ao MEGA', s.backup.sera_cifrado ? 'cifrado' : 'EM CLARO', s.backup.sera_cifrado)}
          ${(s.alertas || []).map((a) => `<div style="margin-top:10px;font-size:12.5px;background:#fff4e5;border-left:3px solid var(--gold,#c9a227);padding:8px 10px;border-radius:4px">${esc(a)}</div>`).join('')}
          <div style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn-sm" id="lgpd-preview">${svgIcon('broom')} Ver o que o expurgo apagaria</button>
          </div>
          <div id="lgpd-box" style="margin-top:10px"></div>`;

        $('#lgpd-preview').onclick = async () => {
          const b = $('#lgpd-box'); b.innerHTML = '<div class="spinner"></div>';
          try {
            const r = await api('/api/retention/preview'); // SIMULA — não apaga nada
            b.innerHTML = `
              <div class="sub" style="font-size:12px;margin-bottom:6px">Simulação — <strong>nada foi apagado</strong>. Nunca toca em processo, procuração, contrato, documento ou financeiro.</div>
              <table class="tbl" style="width:100%"><thead><tr><th>O quê</th><th>Ação</th><th style="text-align:right">Linhas</th></tr></thead>
              <tbody>${r.itens.map((i) => `<tr title="${esc(i.porque)}">
                <td>${esc(i.tabela)}<br><small style="color:var(--text-muted)">${esc(i.criterio)}</small></td>
                <td>${i.acao === 'anonimizado' ? '🎭 anonimiza' : '🗑️ apaga'}</td>
                <td style="text-align:right"><strong>${i.linhas}</strong></td></tr>`).join('')}</tbody></table>
              <div class="sub" style="font-size:12px;margin-top:6px">Total: <strong>${r.total}</strong> linha(s). Roda sozinho todo dia 1º, às 4h.</div>`;
          } catch (e) { b.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
        };
      } catch (e) {
        box.innerHTML = `<div class="empty">${esc(e.message || 'Erro ao ler o estado de segurança')}</div>`;
      }
    };
    $('#sec-reload').onclick = loadSeguranca;
    loadSeguranca();

    // ── Saúde das rotinas automáticas ────────────────────────────────────────
    const loadJobs = async () => {
      const box = $('#job-health'); if (!box) return;
      try {
        const j = await api('/api/job-health');
        if (!j.total) { box.innerHTML = '<div class="empty">Nenhuma rotina executou ainda. Após o próximo ciclo, o histórico aparece aqui.</div>'; return; }
        box.innerHTML = `
          <div style="margin-bottom:10px;font-size:13px">${j.saudavel
            ? '<span style="color:var(--green,#1e8e5a);font-weight:600">✓ Todas as rotinas rodaram sem erro</span>'
            : `<span style="color:var(--red,#c0392b);font-weight:600">⚠ ${j.com_erro} rotina(s) com erro</span>`}</div>
          <table class="tbl" style="width:100%"><thead><tr><th>Rotina</th><th>Última</th><th>Estado</th><th style="text-align:right">Falhas 24h</th></tr></thead>
          <tbody>${j.rotinas.map((r) => `<tr>
            <td>${esc(r.job)}${r.status === 'erro' && r.message ? `<br><small style="color:var(--red,#c0392b)">${esc(String(r.message).slice(0, 90))}</small>` : ''}</td>
            <td><small>${fmtDate(r.ran_at)}</small></td>
            <td>${r.status === 'ok' ? '<span style="color:var(--green,#1e8e5a)">✓ ok</span>' : '<span style="color:var(--red,#c0392b)">✗ erro</span>'}</td>
            <td style="text-align:right">${Number(r.falhas_24h) ? `<strong style="color:var(--red,#c0392b)">${r.falhas_24h}</strong>` : '0'}</td></tr>`).join('')}</tbody></table>`;
      } catch (e) {
        box.innerHTML = `<div class="empty">${esc(e.message || 'Erro ao ler a saúde das rotinas')}</div>`;
      }
    };
    $('#job-reload').onclick = loadJobs;
    loadJobs();
    $('#run-backup').onclick = async () => {
      const btn = $('#run-backup'); btn.disabled = true; btn.textContent = 'Fazendo backup…';
      try {
        const r = await api('/api/backup/run', { method: 'POST', body: '{}' });
        if (r.ok) { toast(`Backup enviado: ${r.file} (${r.sizeKB} KB)`); loadBackups(); }
        else toast(r.message || 'Backup não realizado', 'error');
      } catch (e) { toast(e.message, 'error'); }
      finally { btn.disabled = false; btn.textContent = 'Fazer backup agora'; }
    };
    await load();
    await loadAutomations();
    await loadBackups();
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
    const [me, cases, contact] = await Promise.all([
      api('/api/portal/me'), api('/api/portal/cases'), api('/api/portal/contact').catch(() => ({ whatsapp: '' })),
    ]);
    const wa = (contact.whatsapp || '').replace(/\D/g, '');
    page.innerHTML = `
      <div class="page-header"><div><h2>Olá, ${esc((me.name || '').split(' ')[0])}</h2><p class="sub">Acompanhe seus processos e pagamentos</p></div>
        ${wa ? `<a class="btn-gold" href="https://wa.me/${wa}" target="_blank" rel="noopener" style="text-decoration:none">Falar com o escritório</a>` : ''}</div>
      <div class="kpi-grid">
        ${kpi('Processos ativos', me.resumo.processos_ativos)}
        ${kpi('Valores a pagar', money(me.resumo.a_pagar), 'money')}
        ${kpi('Em atraso', money(me.resumo.vencido), 'money')}
      </div>
      <div class="card" style="margin-top:16px"><div style="padding:14px 18px;border-bottom:1px solid var(--border)"><strong style="color:var(--navy)">Minhas parcelas</strong></div><div id="portal-parc"><div class="spinner"></div></div></div>
      <div id="portal-cases"></div>
      <div class="card" style="margin-top:16px"><div style="padding:14px 18px;border-bottom:1px solid var(--border)"><strong style="color:var(--navy)">Meus documentos</strong></div><div id="portal-docs"><div class="spinner"></div></div></div>
      <div class="card" style="margin-top:16px"><div style="padding:14px 18px;border-bottom:1px solid var(--border)"><strong style="color:var(--navy)">Atualizações</strong></div><div id="portal-tl"><div class="spinner"></div></div></div>`;
    $('#portal-cases').innerHTML = cases.length ? cases.map((c) => `
      <div class="card" style="padding:18px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline">
          <strong style="font-size:15.5px;color:var(--navy-deep)">${esc(c.title)}</strong>
          <small style="color:var(--text-muted)">${c.case_number ? 'Processo ' + esc(c.case_number) : 'Em preparação'}</small>
        </div>
        ${stepperHtml(c)}
        ${c.client_message ? `<div class="client-msg">${esc(c.client_message)}</div>` : ''}
        <div style="margin-top:12px"><button class="btn-sm" data-pcase="${c.id}">Ver detalhes</button></div>
      </div>`).join('') : '<div class="empty">Nenhum processo no momento</div>';
    document.querySelectorAll('[data-pcase]').forEach((b) => b.onclick = () => portalCaseDetail(b.dataset.pcase));
    api('/api/portal/financial').then((parcelas) => {
      if (!parcelas.length) { $('#portal-parc').innerHTML = '<div class="empty" style="padding:16px">Nenhuma parcela registrada</div>'; return; }
      const statusBadge = (i) => i.status === 'pago' ? '<span class="badge pago">paga</span>'
        : i.status === 'em_processamento' ? '<span class="badge" style="background:var(--amber-bg);color:var(--amber)">em processamento</span>'
        : i.status === 'cancelado' ? '<span class="badge cancelado">cancelada</span>'
        : Number(i.vencida) ? '<span class="badge vencido">vencida</span>' : '<span class="badge" style="background:#e8f5e9;color:#2e7d32">pendente</span>';
      $('#portal-parc').innerHTML = `<div style="padding:8px 12px">` + parcelas.map((i) => `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 6px;border-bottom:1px solid var(--border)">
          <div><strong style="font-size:14px">${i.numero ? i.numero + 'ª parcela' : 'Parcela'}${i.proposta ? ` <small style="color:var(--text-muted);font-weight:400">· ${esc(i.proposta)}</small>` : ''}</strong>
            <div style="font-size:12px;color:var(--text-muted)">vence ${fmtDate(i.due_date)}</div></div>
          <div style="display:flex;align-items:center;gap:8px"><strong style="font-size:15px;color:var(--navy-deep)">${money(i.valor)}</strong>${statusBadge(i)}</div>
        </div>`).join('') + `</div>`;
    }).catch(() => { $('#portal-parc').innerHTML = '<div class="empty" style="padding:16px">—</div>'; });
    api('/api/portal/documents').then((docs) => {
      $('#portal-docs').innerHTML = docs.length ? docs.map((d) => `
        <div class="mini-row"><span>${esc(d.name)}${d.case_title ? `<br><small style="color:var(--text-muted)">${esc(d.case_title)}</small>` : ''}</span>
        <a class="btn-sm" href="${esc(d.file_url)}" target="_blank" rel="noopener" style="text-decoration:none">Baixar</a></div>`).join('')
        : '<div class="empty" style="padding:16px">Nenhum documento liberado ainda</div>';
    }).catch(() => { $('#portal-docs').innerHTML = '<div class="empty" style="padding:16px">—</div>'; });
    api('/api/portal/timeline').then((tl) => {
      $('#portal-tl').innerHTML = tl.length ? tl.map((e) => `<div class="notif-item"><strong>${esc(e.description)}</strong><div style="margin-top:4px"><small>${e.case_number ? 'Proc. ' + esc(e.case_number) + ' · ' : ''}${fmtDate(e.created_at)}</small></div></div>`).join('') : '<div class="empty">Sem atualizações ainda</div>';
    }).catch(() => { $('#portal-tl').innerHTML = '<div class="empty">—</div>'; });
  },

  async portalFinanceiro(page) {
    const load = async () => {
      const items = await api('/api/portal/financial');
      const totalPagar = items.filter((i) => ['pendente', 'vencido', 'em_processamento'].includes(i.status)).reduce((s, i) => s + Number(i.valor), 0);
      page.innerHTML = `
        <div class="page-header"><div><h2>Valores a Pagar</h2><p class="sub">Suas parcelas — pague com Pix e avise com um clique</p></div></div>
        <div class="kpi-grid">${kpi('Total a pagar', money(totalPagar), 'money')}</div>
        <div id="pf-list"></div>`;
      $('#pf-list').innerHTML = items.length ? items.map((i) => `
        <div class="card" style="padding:16px;margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
            <div><strong>${i.numero ? i.numero + 'ª parcela' : 'Parcela'}</strong>${i.proposta ? ` <small style="color:var(--text-muted)">· ${esc(i.proposta)}</small>` : ''}
              <div style="font-size:13px;color:var(--text-muted)">vence ${fmtDate(i.due_date)} ${Number(i.vencida) ? '<span class="badge vencido">vencida</span>' : ''}</div></div>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              ${i.valor_atualizado && Number(i.valor_atualizado) > Number(i.valor)
                ? `<span style="text-align:right"><small style="color:var(--text-muted);text-decoration:line-through">${money(i.valor)}</small><br><strong style="font-size:17px;color:var(--red)">${money(i.valor_atualizado)}</strong><br><small style="color:var(--text-muted)">com multa e juros</small></span>`
                : `<strong style="font-size:17px;color:var(--navy-deep)">${money(i.valor)}</strong>`}
              ${i.status === 'pago' ? '<span class="badge pago">paga</span>'
                : i.status === 'em_processamento' ? '<span class="badge" style="background:var(--amber-bg);color:var(--amber)">em processamento</span>'
                : i.status === 'cancelado' ? '<span class="badge cancelado">cancelada</span>'
                : `<button class="btn-gold btn-sm" data-pix="${i.id}">Pagar com Pix</button>`}
            </div>
          </div>
          ${i.status === 'em_processamento' ? '<div style="font-size:12px;color:var(--text-muted);margin-top:8px">Você avisou que pagou — o escritório vai conferir e confirmar. Obrigado!</div>' : ''}
          <div id="pix-${i.id}"></div>
        </div>`).join('') : '<div class="empty">Nenhuma parcela registrada</div>';
      $('#pf-list').querySelectorAll('[data-pix]').forEach((b) => b.onclick = async () => {
        const id = b.dataset.pix; const box = $(`#pix-${id}`);
        if (box.innerHTML) { box.innerHTML = ''; return; }
        box.innerHTML = '<div class="spinner"></div>';
        try {
          const r = await api('/api/portal/pix/' + id);
          box.innerHTML = `<div class="pix-box">
            <div style="font-size:13.5px"><strong>Como pagar:</strong> abra o aplicativo do seu banco, escolha <strong>Pix</strong> e aponte a câmera para o código abaixo — ou copie e cole o código.</div>
            <img src="${r.qr}" alt="QR Code Pix">
            ${r.beneficiario ? `<div style="text-align:center;font-size:12.5px;color:var(--text-muted)">Beneficiário: <strong>${esc(r.beneficiario)}</strong> · ${money(r.valor)}</div>` : ''}
            ${r.atualizada ? `<div style="text-align:center;font-size:12px;color:var(--red);margin-top:4px">Valor atualizado com multa e juros (${r.dias_atraso} dia${r.dias_atraso > 1 ? 's' : ''} de atraso) — original ${money(r.valor_original)}</div>` : ''}
            <div class="pix-copy"><input readonly value="${esc(r.payload)}" id="pixv-${id}"><button class="btn-sm" type="button" data-copy-pix="${id}">Copiar</button></div>
            <div style="text-align:center;margin-top:14px">
              <button class="btn-primary" type="button" data-paguei="${id}" style="width:auto">Já paguei ✓</button>
              <div style="font-size:12px;color:var(--text-muted);margin-top:6px">Depois de pagar, clique acima — o escritório vai conferir e confirmar.</div>
            </div></div>`;
          box.querySelector('[data-copy-pix]').onclick = () => {
            const inp = $(`#pixv-${id}`); inp.select();
            try { navigator.clipboard.writeText(inp.value); toast('Código Pix copiado'); } catch { document.execCommand('copy'); toast('Código copiado'); }
          };
          box.querySelector('[data-paguei]').onclick = async (ev) => {
            ev.target.disabled = true; ev.target.textContent = 'Enviando…';
            try { await api(`/api/portal/installments/${id}/pagar`, { method: 'POST', body: '{}' }); toast('Aviso enviado! O escritório vai confirmar o pagamento.'); load(); }
            catch (e) { toast(e.message, 'error'); ev.target.disabled = false; ev.target.textContent = 'Já paguei ✓'; }
          };
        } catch (e) { box.innerHTML = ''; toast(e.message, 'error'); }
      });
    };
    await load();
  },

  // Telas do portal do parceiro → public/portal-parceiro.js (Object.assign em ROUTES)

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
        <button class="tab active" data-tab="projecao">Projeção</button>
        <button class="tab" data-tab="demandas">Demandas</button>
        <button class="tab" data-tab="audiencias">Audiências</button>
        <button class="tab" data-tab="recebimentos">Recebimentos</button>
      </div>
      <div id="dat-content"></div>`;
    const tabs = { projecao: datProjecao, demandas: datDemandas, audiencias: datAudiencias, recebimentos: datRecebimentos };
    const show = async (name) => {
      document.querySelectorAll('#dat-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
      const c = $('#dat-content'); c.innerHTML = '<div class="spinner"></div>';
      try { await tabs[name](c); } catch (e) { c.innerHTML = `<div class="empty">${e.message}</div>`; }
    };
    document.querySelectorAll('#dat-tabs .tab').forEach((t) => t.onclick = () => show(t.dataset.tab));
    await show('projecao');
  },

  async fases(page) {
    const PH = [['inicial', 'Inicial'], ['instrucao', 'Instrução'], ['sentenca', 'Sentença'], ['recurso', 'Recurso'], ['execucao', 'Execução'], ['encerrado', 'Encerrado']];
    const PHLABEL = Object.fromEntries(PH);
    page.innerHTML = `
      <div class="page-header"><div><h2>Fases dos processos</h2><p class="sub">Quadro por fase processual · a IA sugere a fase pelas movimentações</p></div>
        <button class="btn-gold btn-sm" id="apply-all-sug" style="display:none"></button></div>
      <div id="fases-kpis" class="kpi-grid"></div>
      <div id="fases-board" class="kanban-fases"></div>`;
    const load = async () => {
      const rows = await api('/api/processes');
      const total = rows.length;
      const ativos = rows.filter((r) => r.status === 'ativo').length;
      const comMov = rows.filter((r) => r.last_movement_at && (Date.now() - new Date(r.last_movement_at).getTime()) / 86400000 <= 30).length;
      const encerrados = rows.filter((r) => r.phase === 'encerrado').length;
      $('#fases-kpis').innerHTML = kpi('Processos', total) + kpi('Ativos', ativos) + kpi('Com mov. (30d)', comMov) + kpi('Encerrados', encerrados);
      const by = {}; PH.forEach(([k]) => by[k] = []);
      rows.forEach((r) => { (by[r.phase] ? by[r.phase] : by.inicial).push(r); });
      const esc2 = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      $('#fases-board').innerHTML = PH.map(([k, label]) => `
        <div class="kf-col">
          <div class="kf-head">${label} <span class="kf-count">${by[k].length}</span></div>
          <div class="kf-cards">${by[k].map((r) => `
            <div class="kf-card" data-proc="${r.id}">
              <strong>${r.process_number}</strong>
              <small>${esc2(r.client_name) || '— sem cliente'} · ${r.court || ''}</small>
              <small style="color:var(--text-muted)">últ. mov.: ${r.last_movement_at ? fmtDate(r.last_movement_at) : '—'}</small>
              ${(r.suggested_phase && r.suggested_phase !== r.phase) ? `<div class="kf-sug">Sugestão: <strong>${PHLABEL[r.suggested_phase]}</strong><button class="kf-apply" data-id="${r.id}" data-phase="${r.suggested_phase}">Aplicar ✓</button></div>` : ''}
              <select class="kf-move" data-id="${r.id}">${PH.map(([pk, pl]) => `<option value="${pk}" ${pk === r.phase ? 'selected' : ''}>${pl}</option>`).join('')}</select>
            </div>`).join('') || '<div class="kf-empty">—</div>'}</div>
        </div>`).join('');
      $('#fases-board').querySelectorAll('.kf-move, .kf-apply').forEach((el2) => el2.onclick = (e) => e.stopPropagation());
      $('#fases-board').querySelectorAll('.kf-move').forEach((sel) => sel.onchange = async () => {
        try { await api(`/api/processes/${sel.dataset.id}/phase`, { method: 'PATCH', body: JSON.stringify({ phase: sel.value }) }); toast('Fase atualizada'); load(); }
        catch (e) { toast(e.message, 'error'); }
      });
      $('#fases-board').querySelectorAll('.kf-apply').forEach((b) => b.onclick = async (e) => {
        e.stopPropagation();
        try { await api(`/api/processes/${b.dataset.id}/phase`, { method: 'PATCH', body: JSON.stringify({ phase: b.dataset.phase }) }); toast('Fase aplicada'); load(); }
        catch (err) { toast(err.message, 'error'); }
      });
      $('#fases-board').querySelectorAll('.kf-card').forEach((card) => card.onclick = (e) => { if (e.target.closest('.kf-move') || e.target.closest('.kf-apply')) return; processDetail(card.dataset.proc, load); });
      // Aplicar todas as sugestões
      const sugeridos = rows.filter((r) => r.suggested_phase && r.suggested_phase !== r.phase);
      const allBtn = $('#apply-all-sug');
      if (sugeridos.length) {
        allBtn.style.display = ''; allBtn.textContent = `Aplicar ${sugeridos.length} sugestão(ões)`;
        allBtn.onclick = async () => {
          if (!confirm(`Aplicar a fase sugerida em ${sugeridos.length} processo(s)?`)) return;
          allBtn.disabled = true; allBtn.textContent = 'Aplicando…';
          for (const r of sugeridos) { try { await api(`/api/processes/${r.id}/phase`, { method: 'PATCH', body: JSON.stringify({ phase: r.suggested_phase }) }); } catch {} }
          toast('Sugestões aplicadas'); allBtn.disabled = false; load();
        };
      } else { allBtn.style.display = 'none'; }
    };
    await load();
  },

  async producao(page) {
    const STAGES = [['separacao_documentos', 'Separação de docs'], ['criacao_inicial', 'Criação inicial'], ['revisao_inicial', 'Revisão inicial'], ['aguardando_protocolo', 'Aguardando protocolo'], ['protocolado', 'Protocolado'], ['concluido', 'Concluído']];
    const SLAMAX = 10;
    page.innerHTML = `
      <div class="page-header"><div><h2>Produção</h2><p class="sub">Esteira das peças · SLA ${SLAMAX} dias (produção total) · clique no card para abrir</p></div></div>
      <div id="prod-kpis" class="kpi-grid"></div>
      <div id="prod-board" class="kanban-fases"></div>`;
    const esc2 = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const slaBadge = (r) => {
      if (['protocolado', 'concluido'].includes(r.production_stage)) return `<span style="font-size:11px;font-weight:600;color:var(--green)">✓ concluído</span>`;
      const d = Number(r.sla_days) || 0;
      const cor = d > SLAMAX ? 'var(--red)' : (d >= 7 ? 'var(--amber)' : 'var(--green)');
      return `<span style="font-size:11px;font-weight:700;color:${cor}">${d}/${SLAMAX}d${d > SLAMAX ? ' · atrasado' : ''}</span>`;
    };
    const labelsHtml = (r) => {
      let labs = []; try { labs = Array.isArray(r.production_labels) ? r.production_labels : (r.production_labels ? JSON.parse(r.production_labels) : []); } catch {}
      // Etiquetas do lado de FORA do card (acima), todas as incluídas.
      return labs.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin:0 2px 5px">${labs.map((l) => `<span style="font-size:10px;font-weight:600;background:var(--gold-soft,#efe3c8);color:var(--navy);padding:2px 8px;border-radius:10px;box-shadow:0 1px 2px rgba(0,0,0,.08)">${esc2(l)}</span>`).join('')}</div>` : '';
    };
    const load = async () => {
      const rows = await api('/api/cases/production-board').catch(() => []);
      const ativos = rows.filter((r) => !['protocolado', 'concluido'].includes(r.production_stage));
      const atrasados = ativos.filter((r) => Number(r.sla_days) > SLAMAX).length;
      const pend = rows.reduce((a, r) => a + Number(r.pendencias || 0), 0);
      $('#prod-kpis').innerHTML = kpi('Em produção', ativos.length) + kpi(`Atrasados (>${SLAMAX}d)`, atrasados, atrasados ? 'red' : '') + kpi('Pendências', pend, pend ? 'amber' : '') + kpi('Total na esteira', rows.length);
      const by = {}; STAGES.forEach(([k]) => by[k] = []);
      rows.forEach((r) => { (by[r.production_stage] || (by[r.production_stage] = [])).push(r); });
      $('#prod-board').innerHTML = STAGES.map(([k, label]) => `
        <div class="kf-col" data-stage="${k}">
          <div class="kf-head">${label} <span class="kf-count">${by[k].length}</span></div>
          <div class="kf-cards" data-stage="${k}">${by[k].map((r) => `
            <div class="kf-card-wrap">
              ${labelsHtml(r)}
            <div class="kf-card" draggable="true" data-case="${r.id}" data-stage="${r.production_stage}">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">${slaBadge(r)}${Number(r.pendencias) ? `<span style="font-size:11px;color:var(--red);font-weight:600">⚠ ${r.pendencias}</span>` : ''}</div>
              <strong>${esc2(r.client_name) || '— sem cliente'}</strong>
              <small>${esc2(r.title) || r.case_number || 's/ número'}${r.legal_area ? ' · ' + r.legal_area : ''}</small>
              ${r.assignee_name ? `<small style="color:var(--text-muted)">resp.: ${esc2(r.assignee_name)}</small>` : ''}
              ${r.production_obs ? `<div class="kf-obs" style="margin-top:5px;font-size:11px;color:var(--navy);background:#fff7e6;border-left:3px solid var(--gold,#c9a227);padding:4px 7px;border-radius:3px;white-space:pre-wrap">📝 ${esc2(r.production_obs)}</div>` : ''}
              <div style="display:flex;gap:4px;align-items:center;margin-top:4px">
                <select class="kf-move" data-id="${r.id}" title="Mover etapa" style="flex:1">${STAGES.map(([pk, pl]) => `<option value="${pk}" ${pk === r.production_stage ? 'selected' : ''}>${pl}</option>`).join('')}</select>
                <button class="kf-edit" data-id="${r.id}" data-title="${esc2(r.title || '')}" title="Editar a demanda (título)" style="background:none;border:1px solid var(--border);color:var(--text-muted);border-radius:4px;padding:2px 6px;cursor:pointer;font-size:12px;line-height:1.4;flex-shrink:0">✎</button>
                <button class="kf-obs-edit" data-id="${r.id}" data-obs="${esc2(r.production_obs || '')}" title="Observação do card" style="background:none;border:1px solid var(--border);color:var(--text-muted);border-radius:4px;padding:2px 6px;cursor:pointer;font-size:12px;line-height:1.4;flex-shrink:0">${svgIcon('note')}</button>
                <button class="kf-dup" data-id="${r.id}" title="Duplicar demanda" style="background:none;border:1px solid var(--border);color:var(--text-muted);border-radius:4px;padding:2px 6px;cursor:pointer;font-size:12px;line-height:1.4;flex-shrink:0">⧉</button>
                <button class="kf-del" data-id="${r.id}" title="Apagar demanda" style="background:none;border:1px solid var(--red,#c0392b);color:var(--red,#c0392b);border-radius:4px;padding:2px 6px;cursor:pointer;font-size:12px;line-height:1.4;flex-shrink:0">✕</button>
              </div>
            </div>
            </div>`).join('') || '<div class="kf-empty">solte um card aqui</div>'}</div>
        </div>`).join('');

      // Move uma etapa (para frente ou para trás) e registra cada movimento.
      const moveStage = async (caseId, stage, fromStage) => {
        if (!caseId || !stage || stage === fromStage) { load(); return; }
        try {
          const extra = {};
          if (stage === 'protocolado') {
            const num = prompt('Número do processo/protocolo para protocolar:');
            if (!num) { load(); return; }
            extra.case_number = num;
            const vc = prompt('Valor da causa (R$) — não definitivo, apenas registro do protocolado (deixe vazio para pular):');
            if (vc && vc.trim()) extra.valor_causa = vc.trim();
          }
          if (stage === 'criacao_inicial') toast('Gerando petição inicial com IA…');
          if (stage === 'revisao_inicial') toast('Revisando a petição com IA…');
          const resp = await api(`/api/cases/${caseId}/production-stage`, { method: 'PATCH', body: JSON.stringify({ stage, ...extra }) });
          if (resp && resp.peticao) {
            if (resp.peticao.ok) toast('✓ Petição inicial gerada — confira em Documentos do caso');
            else toast('Movido, mas a petição falhou: ' + (resp.peticao.message || ''), 'error');
          } else if (resp && resp.revisao) {
            if (resp.revisao.ok) {
              const r = resp.revisao.resumo || {};
              const crit = r.pendencias_criticas ? ` · ${r.pendencias_criticas} pendência(s) crítica(s)` : '';
              toast(`✓ Revisão pronta: ${r.itens_ok}/${r.itens_verificados} itens OK${crit} — veja em Documentos`, r.pendencias_criticas ? 'error' : 'success');
            } else toast('Movido, mas a revisão falhou: ' + (resp.revisao.message || ''), 'error');
          } else { toast('Movido · registrado'); }
          load();
        } catch (e) {
          // NOVO: Tratamento de erro 400 — pendências abertas
          if (e.status === 400 && e.pendencias && Array.isArray(e.pendencias)) {
            toast(`❌ Resolva as pendências abaixo antes de continuar:\n\n${e.pendencias.join('\n')}`, 'error');
            return; // NÃO carrega; fica na tela atual
          }
          toast(e.message, 'error');
          load();
        }
      };

      // Seletor (alternativa ao arrastar — e funciona no celular)
      $('#prod-board').querySelectorAll('.kf-move').forEach((el2) => el2.onclick = (e) => e.stopPropagation());
      $('#prod-board').querySelectorAll('.kf-move').forEach((sel) => sel.onchange = () => moveStage(sel.dataset.id, sel.value, undefined));

      // Botão editar a demanda (título) — ex.: "empréstimo pessoal" → "empréstimo consignado"
      $('#prod-board').querySelectorAll('.kf-edit').forEach((btn) => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const novo = prompt('Editar a demanda (título do caso):', btn.dataset.title || '');
          if (novo === null) return;
          if (!novo.trim()) { toast('O título não pode ficar vazio', 'error'); return; }
          try {
            await api(`/api/cases/${btn.dataset.id}`, { method: 'PUT', body: JSON.stringify({ title: novo.trim() }) });
            toast('Demanda atualizada');
            load();
          } catch (err) { toast(err.message || 'Erro ao editar', 'error'); }
        };
      });

      // Botão duplicar demanda
      $('#prod-board').querySelectorAll('.kf-dup').forEach((btn) => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          if (!confirm('Duplicar esta demanda? Uma cópia será criada na mesma etapa.')) return;
          try {
            await api(`/api/cases/${btn.dataset.id}/duplicate`, { method: 'POST', body: '{}' });
            toast('Demanda duplicada');
            load();
          } catch (err) { toast(err.message || 'Erro ao duplicar', 'error'); }
        };
      });

      // Botão observação do card (nota fixa na face do card)
      $('#prod-board').querySelectorAll('.kf-obs-edit').forEach((btn) => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const atual = btn.dataset.obs || '';
          const nova = prompt('Observação do card (deixe vazio para remover):', atual);
          if (nova === null) return; // cancelou
          try {
            await api(`/api/cases/${btn.dataset.id}/production-meta`, { method: 'PATCH', body: JSON.stringify({ production_obs: nova }) });
            toast(nova.trim() ? 'Observação salva' : 'Observação removida');
            load();
          } catch (err) { toast(err.message || 'Erro ao salvar observação', 'error'); }
        };
      });

      // Botão apagar demanda
      $('#prod-board').querySelectorAll('.kf-del').forEach((btn) => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          if (!confirm('Apagar esta demanda permanentemente?\nEsta ação não pode ser desfeita.')) return;
          try {
            await api(`/api/cases/${btn.dataset.id}`, { method: 'DELETE' });
            toast('Demanda apagada');
            load();
          } catch (err) { toast(err.message || 'Erro ao apagar', 'error'); }
        };
      });

      // Arrastar e soltar o card entre colunas (inclusive voltar de etapa)
      $('#prod-board').querySelectorAll('.kf-card').forEach((card) => {
        card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', JSON.stringify({ id: card.dataset.case, from: card.dataset.stage })); card.style.opacity = '0.45'; });
        card.addEventListener('dragend', () => { card.style.opacity = ''; });
        card.onclick = (e) => { if (e.target.closest('.kf-move') || e.target.closest('.kf-del') || e.target.closest('.kf-edit') || e.target.closest('.kf-dup') || e.target.closest('.kf-obs-edit')) return; caseDetail(card.dataset.case, load); };
      });
      $('#prod-board').querySelectorAll('.kf-cards').forEach((zone) => {
        zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.style.outline = '2px dashed var(--gold)'; });
        zone.addEventListener('dragleave', () => { zone.style.outline = ''; });
        zone.addEventListener('drop', (e) => {
          e.preventDefault(); zone.style.outline = '';
          let d = {}; try { d = JSON.parse(e.dataTransfer.getData('text/plain')); } catch {}
          moveStage(d.id, zone.dataset.stage, d.from);
        });
      });
    };
    await load();
  },

  async parcerias(page) {
    const STAGE_PT = { separacao_documentos: 'Separação de docs', criacao_inicial: 'Criação inicial', revisao_inicial: 'Revisão inicial', aguardando_protocolo: 'Aguardando protocolo', protocolado: 'Protocolado', concluido: 'Concluído' };
    const partners = await api('/api/partners').catch(() => []);
    page.innerHTML = `
      <div class="page-header"><div><h2>Parcerias</h2><p class="sub">Casos indicados por parceiros · registro próprio, entram na esteira de produção</p></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn-ghost" id="import-email">${svgIcon('mail')} Importar do e-mail</button><button class="btn-ghost" id="new-partner">+ Novo parceiro</button><button class="btn-gold" id="new-parc-case">+ Novo caso de parceria</button></div></div>
      <div id="parc-inbox"></div>
      <div id="parc-import-queue"></div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px"><label>Parceiro</label>
        <select id="parc-sel">${partners.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
      <div id="parc-terms"></div>
      <div id="parc-cases"><div class="spinner"></div></div>`;
    if (!partners.length) { $('#parc-cases').innerHTML = '<div class="empty">Nenhum parceiro cadastrado ainda.</div>'; }

    const sel = $('#parc-sel');
    const loadCases = async () => {
      const p = partners.find((x) => x.id == sel.value);
      if (!p) return;
      $('#parc-terms').innerHTML = `<div class="card" style="padding:12px 16px;margin-bottom:14px;font-size:13px">
        <strong>${esc(p.name)}</strong> · Êxito ${Number(p.success_fee_percent)}% sobre o ganho, dividido ${Number(p.partner_split_percent)}/${100 - Number(p.partner_split_percent)} ·
        Sucumbência ${Number(p.sucumbencia_split_percent)}/${100 - Number(p.sucumbencia_split_percent)} ·
        Entrada R$ ${Number(p.entry_value_single).toFixed(2)} (1 proc.) / R$ ${Number(p.entry_value_double).toFixed(2)} (2 proc.)${Number(p.entry_split) ? ' · dividida' : ' · 100% sua'}
        <button class="btn-sm" type="button" id="parc-edit" style="margin-left:8px">Editar parceiro</button></div>`;
      $('#parc-edit').onclick = () => partnerForm(p.id, () => ROUTES.parcerias($('#page')));
      const allCases = await api(`/api/partners/${p.id}/cases`).catch(() => []);
      if (!allCases.length) { $('#parc-cases').innerHTML = '<div class="empty">Nenhum caso desta parceria ainda. Clique em "+ Novo caso de parceria".</div>'; return; }
      const areas = [...new Set(allCases.map((c) => c.legal_area).filter(Boolean))].sort();
      const lbl = (t, inner) => `<label style="display:flex;flex-direction:column;gap:2px;font-size:11px;color:var(--text-muted)">${t}${inner}</label>`;
      $('#parc-cases').innerHTML = `
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:14px">
          ${lbl('Buscar', '<input id="pf-q" placeholder="cliente ou processo" style="min-width:170px">')}
          ${lbl('Tipo de caso', `<select id="pf-area"><option value="">Todos</option>${areas.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join('')}</select>`)}
          ${lbl('Status', `<select id="pf-stage"><option value="">Todos</option>${Object.entries(STAGE_PT).map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>`)}
          ${lbl('De', '<input type="date" id="pf-from">')}
          ${lbl('Até', '<input type="date" id="pf-to">')}
          <button class="btn-ghost btn-sm" type="button" id="pf-clear">Limpar</button>
          <button class="btn-gold btn-sm" type="button" id="pf-export">Exportar relatório (CSV)</button>
        </div>
        <div id="pf-count" style="font-size:12px;color:var(--text-muted);margin-bottom:6px"></div>
        <div id="parc-rows"></div>`;
      let current = allCases;
      const filtered = () => {
        const q = ($('#pf-q').value || '').toLowerCase().trim();
        const area = $('#pf-area').value, stage = $('#pf-stage').value, from = $('#pf-from').value, to = $('#pf-to').value;
        return allCases.filter((c) => {
          if (q && !((c.client_name || '').toLowerCase().includes(q) || (c.title || '').toLowerCase().includes(q) || String(c.case_number || '').toLowerCase().includes(q))) return false;
          if (area && c.legal_area !== area) return false;
          if (stage && c.production_stage !== stage) return false;
          const d = String(c.created_at || '').slice(0, 10);
          if (from && d < from) return false;
          if (to && d > to) return false;
          return true;
        });
      };
      const render = () => {
        current = filtered();
        $('#pf-count').textContent = `${current.length} caso(s)`;
        $('#parc-rows').innerHTML = current.length ? `
          <table><thead><tr><th>Cliente</th><th>Processo</th><th>Status</th><th>SLA</th><th>Receita</th><th>Repasse</th><th></th></tr></thead>
          <tbody>${current.map((c) => {
            const proto = ['protocolado', 'concluido'].includes(c.production_stage);
            const atras = !proto && Number(c.sla_days) > 10;
            return `<tr class="parc-main" data-open="${c.id}" style="cursor:pointer">
              <td><strong>${esc(c.client_name || '—')}</strong><br><span class="badge" style="background:var(--gold-soft,#efe3c8);color:var(--navy)">Parceria: ${esc(p.name)}</span></td>
              <td>${esc(c.title || '—')}${c.case_number ? `<br><small style="color:var(--text-muted)">nº ${esc(c.case_number)}</small>` : ''}<br><small style="color:var(--text-muted)">${esc(c.legal_area || '')}</small></td>
              <td>${proto ? `<span class="badge protocolado" style="background:#e3f0e6;color:var(--green)">${STAGE_PT[c.production_stage]}</span>` : (STAGE_PT[c.production_stage] || '—')}</td>
              <td style="color:${atras ? 'var(--red)' : 'var(--text)'}">${proto ? '✓' : (c.sla_days ?? 0) + '/10d'}</td>
              <td>${money(c.receita)}</td>
              <td>${money(c.repasse_parceiro)}</td>
              <td style="white-space:nowrap"><button class="btn-sm" data-result="${c.id}" data-name="${esc(c.client_name || '')}">Êxito / Sucumb.</button></td></tr>
            <tr class="parc-drawer" id="drawer-${c.id}" style="display:none"><td colspan="7" style="background:var(--surface-2);padding:0"><div class="dr-body" style="padding:16px"></div></td></tr>`;
          }).join('')}</tbody></table>` : '<div class="empty">Nenhum caso com esses filtros.</div>';
        $('#parc-rows').querySelectorAll('[data-result]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); resultadoForm(b.dataset.result, b.dataset.name, loadCases); });
        $('#parc-rows').querySelectorAll('.parc-main').forEach((tr) => tr.onclick = async (e) => {
          if (e.target.closest('[data-result]')) return;
          const id = tr.dataset.open, drawer = $(`#drawer-${id}`);
          const open = drawer.style.display === 'none';
          drawer.style.display = open ? 'table-row' : 'none';
          if (open && !drawer.dataset.loaded) {
            drawer.dataset.loaded = '1';
            try { const f = await api(`/api/cases/${id}/ficha`); drawer.querySelector('.dr-body').innerHTML = parcDrawerHtml(f, p.name, loadCases); bindParcDrawer(drawer, id, loadCases); }
            catch (err) { drawer.querySelector('.dr-body').innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
          }
        });
      };
      render();
      ['pf-q', 'pf-area', 'pf-stage', 'pf-from', 'pf-to'].forEach((id) => { const e = $('#' + id); e.oninput = render; e.onchange = render; });
      $('#pf-clear').onclick = () => { ['pf-q', 'pf-area', 'pf-stage', 'pf-from', 'pf-to'].forEach((id) => $('#' + id).value = ''); render(); };
      $('#pf-export').onclick = () => downloadCsv(`parceria-${p.name}-${new Date().toISOString().slice(0, 10)}.csv`, [
        { label: 'Cliente', get: (c) => c.client_name || '' },
        { label: 'Processo', get: (c) => c.title || '' },
        { label: 'Número', get: (c) => c.case_number || '' },
        { label: 'Tipo', get: (c) => c.legal_area || '' },
        { label: 'Status', get: (c) => STAGE_PT[c.production_stage] || c.production_stage || '' },
        { label: 'SLA (dias)', get: (c) => c.sla_days ?? '' },
        { label: 'Receita', get: (c) => Number(c.receita || 0).toFixed(2) },
        { label: 'Repasse', get: (c) => Number(c.repasse_parceiro || 0).toFixed(2) },
        { label: 'Criado em', get: (c) => fmtDate(c.created_at) },
      ], current);
    };
    sel.onchange = loadCases;
    $('#new-partner').onclick = () => partnerForm(null, () => ROUTES.parcerias($('#page')));
    $('#new-parc-case').onclick = () => parceriaCaseForm(partners, sel.value, loadCases);
    const reloadAll = async () => { await loadInboxPanel(reloadAll); await loadImportQueue(partners, reloadAll); if (partners.length) await loadCases(); };
    $('#import-email').onclick = () => importEmailForm(partners, sel.value, reloadAll);
    await loadInboxPanel(reloadAll);
    await loadImportQueue(partners, reloadAll);
    if (partners.length) await loadCases();
  },

  // Módulo WhatsApp → public/whatsapp.js (Object.assign em ROUTES)

  async monitor(page) {
    page.innerHTML = `
      <div class="page-header"><div><h2>Monitoramento Processual</h2><p class="sub">Acompanhamento via DataJud/CNJ</p></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn-sm" id="to-esteira">Trazer p/ a esteira</button>
          <button class="btn-gold" id="new-proc">+ Monitorar processo</button>
        </div></div>
      <div class="toolbar">
        <select id="proc-filter"><option value="">Todos</option><option value="stale">Parados +30 dias</option></select>
      </div>
      <div class="card"><div id="proc-table"></div></div>`;
    const load = async () => {
      const q = $('#proc-filter').value === 'stale' ? '?stale=30' : '';
      const rows = await api('/api/processes' + q);
      $('#proc-table').innerHTML = rows.length ? `
        <table><thead><tr><th>Processo</th><th>Cliente</th><th>Tribunal</th><th>Última movimentação</th><th>Data</th><th></th></tr></thead>
        <tbody>${rows.map((p) => { const mv = (p.last_movement_text || p.last_movement_title || '').replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch])); return `<tr>
          <td>${procNumHtml(p.process_number)}<br><small style="color:var(--text-muted)">${p.judicial_area || ''}</small></td>
          <td>${p.client_name || '—'}</td><td>${p.court || '—'}</td>
          <td style="max-width:340px"><span style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${mv}">${mv || '—'}</span></td>
          <td style="white-space:nowrap">${p.last_movement_at ? fmtDate(p.last_movement_at) : '—'}</td>
          <td><button class="btn-sm" data-proc="${p.id}">Abrir</button></td></tr>`; }).join('')}</tbody></table>`
        : '<div class="empty">Nenhum processo monitorado</div>';
      document.querySelectorAll('[data-proc]').forEach((b) => b.onclick = () => processDetail(b.dataset.proc, load));
    };
    $('#new-proc').onclick = () => processForm(load);
    $('#to-esteira').onclick = async () => {
      if (!confirm('Trazer para a esteira (Processos) os processos monitorados que já têm cliente vinculado? Cria um caso em andamento para cada um, sem duplicar.')) return;
      const btn = $('#to-esteira'); btn.disabled = true; btn.textContent = 'Trazendo…';
      try {
        const r = await api('/api/processes/importar-esteira', { method: 'POST', body: '{}' });
        toast(`${r.criados} processo(s) adicionado(s) à esteira.${r.sem_cliente ? ` ${r.sem_cliente} sem cliente ficaram de fora.` : ''}`);
        if (r.criados > 0) setTimeout(() => { location.hash = '#cases'; }, 1500);
      } catch (e) { toast(e.message, 'error'); }
      finally { btn.disabled = false; btn.textContent = 'Trazer p/ a esteira'; }
    };
    $('#proc-filter').onchange = load;
    await load();
  },

  async advogados(page) {
    page.innerHTML = `
      <div class="page-header"><div><h2>Advogados / OAB</h2><p class="sub">Registro e descoberta automática de processos por OAB</p></div>
        <button class="btn-gold" id="new-law">+ Advogado</button></div>
      <div class="card"><div id="law-table"></div></div>
      <p class="sub" style="margin-top:10px">A descoberta busca as publicações da OAB no DJEN/CNJ (Diário de Justiça Eletrônico Nacional), cadastra os processos automaticamente e detecta possíveis prazos a partir das intimações.</p>`;

    // A busca roda no NAVEGADOR (IP brasileiro) porque o DJEN bloqueia o IP do
    // servidor; depois envia as publicações ao CRM para gravar.
    const discover = async (lawyerId, oabNum, oabUf, btn) => {
      const original = btn.textContent;
      btn.disabled = true; btn.textContent = 'Buscando…';
      toast('Buscando publicações da OAB no DJEN/CNJ…');
      try {
        const r = await oabDiscover(lawyerId, oabNum, oabUf, (p) => { btn.textContent = `Buscando… (pág. ${p})`; });
        if (r.vazio) { toast('Nenhuma publicação encontrada para esta OAB no DJEN.', 'error'); return; }
        toast(`OAB ${r.oab}: ${r.found} processo(s), ${r.novos} novo(s); ${r.clientesNovos || 0} cliente(s) cadastrado(s).`);
        if ((r.novos > 0) || (r.clientesNovos > 0)) setTimeout(() => { location.hash = '#monitor'; }, 1800);
      } catch (e) { toast(e.message, 'error'); }
      finally { btn.disabled = false; btn.textContent = original; }
    };

    const load = async () => {
      const rows = await api('/api/lawyers');
      $('#law-table').innerHTML = `
        <table><thead><tr><th>Nome</th><th>OAB</th><th>Monitoramento</th><th>Última sync</th><th></th></tr></thead>
        <tbody>${rows.map((l) => `<tr>
          <td><strong>${l.name}</strong></td><td>${l.oab_number || '—'}/${l.oab_uf || '—'}</td>
          <td>${l.monitoring_enabled ? '<span class="badge ativo">ativo</span>' : '<span class="badge inativo">inativo</span>'}</td>
          <td>${l.last_sync_at ? fmtDate(l.last_sync_at) : 'nunca'}</td>
          <td style="white-space:nowrap">
            ${l.oab_number ? `<button class="btn-gold btn-sm" data-discover="${l.id}" data-oab="${l.oab_number}" data-uf="${l.oab_uf || 'ES'}">Descobrir processos</button> ` : ''}
            <button class="btn-sm" data-law="${l.id}">Editar</button></td></tr>`).join('')}</tbody></table>`;
      document.querySelectorAll('[data-law]').forEach((b) => b.onclick = () => lawyerForm(b.dataset.law, load));
      document.querySelectorAll('[data-discover]').forEach((b) => b.onclick = () => discover(b.dataset.discover, b.dataset.oab, b.dataset.uf, b));
    };
    $('#new-law').onclick = () => lawyerForm(null, load);
    await load();
  },

  async intakes(page) {
    page.innerHTML = `
      <div class="page-header"><div><h2>Atendimentos</h2><p class="sub">Primeiro contato e triagem</p></div>
        <button class="btn-gold" id="new-intake">+ Novo atendimento</button></div>
      <div class="card"><div id="int-table"></div></div>`;
    let intPage = 1;
    const load = async () => {
      const q = new URLSearchParams();
      q.set('limit', '20'); q.set('page', String(intPage));
      const r = await api('/api/intakes?' + q);
      const pages = r.pages || 1;
      $('#int-table').innerHTML = r.data.length ? `
        <table><thead><tr><th>Contato</th><th>Área</th><th>Origem</th><th>Urgência</th><th>Status</th></tr></thead>
        <tbody>${r.data.map((i) => `<tr>
          <td><strong>${i.contact_name}</strong><br><small style="color:var(--text-muted)">${i.phone || ''}</small></td>
          <td>${i.legal_area}</td><td>${i.source}</td><td>${badge(i.urgency)}</td><td>${badge(i.status)}</td></tr>`).join('')}</tbody></table>
        <div class="list-foot"><span>${r.total} atendimento(s) · página ${r.page} de ${pages}</span>${pagerHtml(r.page, pages)}</div>`
        : '<div class="empty">Nenhum atendimento ainda</div>';
      document.querySelectorAll('#int-table [data-page]').forEach((b) => b.onclick = () => {
        intPage = Number(b.dataset.page); load(); $('#page').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    };
    $('#new-intake').onclick = () => intakeForm(load);
    await load();
  },

  async controladoria(page) {
    page.innerHTML = `
      <div class="page-header"><div><h2>Controladoria</h2><p class="sub">Rentabilidade, centro de custo e provisionamento</p></div></div>
      <div class="tabs" id="ctrl-tabs">
        <button class="tab active" data-tab="clientes">Rentabilidade · Clientes</button>
        <button class="tab" data-tab="processos">Rentabilidade · Processos</button>
        <button class="tab" data-tab="centro">Centro de Custo</button>
        <button class="tab" data-tab="provisao">Provisionamento</button>
      </div>
      <div id="ctrl-content"></div>`;
    const tabs = { clientes: ctrlClientes, processos: ctrlProcessos, centro: ctrlCentroCusto, provisao: ctrlProvisao };
    const show = async (name) => {
      document.querySelectorAll('#ctrl-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
      const c = $('#ctrl-content'); c.innerHTML = '<div class="spinner"></div>';
      try { await tabs[name](c); } catch (e) { c.innerHTML = `<div class="empty">${e.message}</div>`; }
    };
    document.querySelectorAll('#ctrl-tabs .tab').forEach((t) => t.onclick = () => show(t.dataset.tab));
    await show('clientes');
  },

  async correspondente(page) { await renderCorrespondente(page); },
  async documentos(page) { await renderDocumentos(page); },
  async ia(page) { await renderIA(page); },
};

const IA_TYPE_PT = { peticao_inicial: 'Petição Inicial', contestacao: 'Contestação', resumo_intimacao: 'Resumo de intimação', parecer: 'Parecer', email_cobranca: 'Cobrança' };

async function renderIA(page) {
  const cfg = await api('/api/ai/config').catch(() => ({ auto: false }));
  page.innerHTML = `
    <div class="page-header"><div><h2>IA Jurídica</h2><p class="sub">${cfg.auto ? 'Geração automática ativa' : 'Assistente — gera o prompt pronto para colar no ChatGPT/Claude'}</p></div>
      <button class="btn-gold" id="new-ia">+ Nova geração</button></div>
    ${cfg.auto ? '' : '<p class="sub" style="margin-bottom:14px">💡 Sem custo de API: o sistema monta o texto pronto, você cola na IA que já assina (ChatGPT/Claude) e traz a resposta de volta. Para gerar automático, adicione uma chave grátis (Gemini/Groq) nas variáveis.</p>'}
    <div class="card"><div id="ia-table"></div></div>`;
  const load = async () => {
    const rows = await api('/api/ai');
    $('#ia-table').innerHTML = rows.length ? `
      <table><thead><tr><th>Documento</th><th>Tipo</th><th>Cliente</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.map((g) => `<tr>
        <td><strong>${g.title || '—'}</strong><br><small style="color:var(--text-muted)">${fmtDate(g.created_at)}</small></td>
        <td>${IA_TYPE_PT[g.type] || g.type}</td><td>${g.client_name || '—'}</td>
        <td>${g.status === 'completed' ? '<span class="badge ativo">pronto</span>' : '<span class="badge pendente">aguardando</span>'}</td>
        <td><button class="btn-sm" data-ia="${g.id}">Abrir</button> <button class="btn-sm" data-del-ia="${g.id}">×</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Nenhuma geração ainda</div>';
    document.querySelectorAll('[data-ia]').forEach((b) => b.onclick = () => iaViewer(b.dataset.ia, load));
    document.querySelectorAll('[data-del-ia]').forEach((b) => b.onclick = async () => {
      try { await api('/api/ai/' + b.dataset.delIa, { method: 'DELETE' }); toast('Removido'); load(); } catch (e) { toast(e.message, 'error'); }
    });
  };
  $('#new-ia').onclick = () => iaForm(load);
  await load();
}

async function iaForm(onSave) {
  const [templates, clients] = await Promise.all([api('/api/ai/templates'), api('/api/clients?limit=200')]);
  const typeOpts = templates.map((t) => ({ v: t.type, t: t.label }));
  const form = el(`<form class="form-grid">
    ${field('Tipo de documento', 'type', { options: typeOpts })}
    ${field('Cliente (opcional)', 'client_id', { options: [{ v: '', t: '—' }].concat(clients.data.map((c) => ({ v: c.id, t: c.name }))) })}
    <div id="ia-fields"></div>
    <button type="submit" class="btn-primary">Gerar</button>
  </form>`);
  const typeSel = form.querySelector('[name=type]');
  const renderFields = () => {
    const tpl = templates.find((t) => t.type === typeSel.value);
    form.querySelector('#ia-fields').innerHTML = tpl.fields.map((f) =>
      field(f.label, 'f_' + f.name, f.type === 'textarea' ? { type: 'textarea' } : {})).join('');
  };
  typeSel.onchange = renderFields; renderFields();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    const inputs = {};
    for (const k in fd) if (k.startsWith('f_')) inputs[k.slice(2)] = fd[k];
    const body = { type: fd.type, inputs };
    if (fd.client_id) body.client_id = fd.client_id;
    try {
      const r = await api('/api/ai/generate', { method: 'POST', body: JSON.stringify(body) });
      closeModal(); if (onSave) onSave(); iaViewer(r.id, onSave);
    } catch (err) { toast(err.message, 'error'); }
  };
  openModal('Nova geração de IA', form);
}

async function iaViewer(id, onSave) {
  const g = await api('/api/ai/' + id);
  const done = g.status === 'completed' && g.result;
  const wrap = el(`<div>
    ${!done ? `
      <div><strong style="color:var(--navy)">1. Copie este prompt e cole no ChatGPT ou Claude</strong></div>
      <textarea id="ia-prompt" readonly style="width:100%;min-height:160px;margin-top:6px;font-size:13px">${g.prompt}</textarea>
      <div style="display:flex;gap:8px;margin:8px 0">
        <button class="btn-gold" id="ia-copy">Copiar prompt</button>
        <a class="btn-sm" href="https://chat.openai.com" target="_blank">Abrir ChatGPT</a>
        <a class="btn-sm" href="https://claude.ai" target="_blank">Abrir Claude</a>
      </div>
      <div style="margin-top:10px"><strong style="color:var(--navy)">2. Cole aqui a resposta da IA</strong></div>
      <textarea id="ia-result" style="width:100%;min-height:200px;margin-top:6px" placeholder="Cole aqui o texto que a IA gerou…"></textarea>
      <button class="btn-primary" id="ia-save" style="width:auto;margin-top:8px">Salvar resposta</button>
    ` : `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <strong style="color:var(--navy)">Resultado</strong>
        <span>${g.client_id ? '<button class="btn-sm" id="ia-doc">Salvar no GED</button> ' : ''}<button class="btn-sm" id="ia-copyr">Copiar</button></span>
      </div>
      <textarea id="ia-result" style="width:100%;min-height:320px;margin-top:8px;font-family:Georgia,serif;line-height:1.6">${g.result}</textarea>
      <button class="btn-sm" id="ia-update" style="margin-top:8px">Salvar alterações</button>
    `}
  </div>`);
  if (!done) {
    wrap.querySelector('#ia-copy').onclick = () => { navigator.clipboard.writeText(g.prompt); toast('Prompt copiado'); };
    wrap.querySelector('#ia-save').onclick = async () => {
      try { await api(`/api/ai/${id}/result`, { method: 'POST', body: JSON.stringify({ result: wrap.querySelector('#ia-result').value }) });
        closeModal(); toast('Salvo'); if (onSave) onSave(); } catch (e) { toast(e.message, 'error'); }
    };
  } else {
    wrap.querySelector('#ia-copyr').onclick = () => { navigator.clipboard.writeText(wrap.querySelector('#ia-result').value); toast('Copiado'); };
    wrap.querySelector('#ia-update').onclick = async () => {
      try { await api(`/api/ai/${id}/result`, { method: 'POST', body: JSON.stringify({ result: wrap.querySelector('#ia-result').value }) }); toast('Atualizado'); } catch (e) { toast(e.message, 'error'); }
    };
    const docBtn = wrap.querySelector('#ia-doc');
    if (docBtn) docBtn.onclick = async () => {
      try { await api(`/api/ai/${id}/save-document`, { method: 'POST', body: '{}' }); toast('Salvo no GED (Documentos)'); } catch (e) { toast(e.message, 'error'); }
    };
  }
  openModal(g.title || 'Geração de IA', wrap);
}

const FOLDER_PT = { contratos: 'Contratos', procuracoes: 'Procurações', documentos_pessoais: 'Documentos pessoais', processos: 'Processos', financeiro: 'Financeiro', audiencias: 'Audiências', outros: 'Outros' };

async function renderDocumentos(page) {
  page.innerHTML = `
    <div class="page-header"><div><h2>Documentos</h2><p class="sub">GED por cliente, modelos e geração automática</p></div></div>
    <div class="tabs" id="ged-tabs">
      <button class="tab active" data-tab="docs">Documentos</button>
      <button class="tab" data-tab="modelos">Modelos</button>
    </div>
    <div id="ged-content"></div>`;
  const tabs = { docs: gedDocumentos, modelos: gedModelos };
  const show = async (name) => {
    document.querySelectorAll('#ged-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    const c = $('#ged-content'); c.innerHTML = '<div class="spinner"></div>';
    try { await tabs[name](c); } catch (e) { c.innerHTML = `<div class="empty">${e.message}</div>`; }
  };
  document.querySelectorAll('#ged-tabs .tab').forEach((t) => t.onclick = () => show(t.dataset.tab));
  await show('docs');
}

async function gedDocumentos(c) {
  const clients = await api('/api/clients?limit=200');
  c.innerHTML = `
    <div class="toolbar">
      <select id="ged-client"><option value="">Selecione um cliente…</option>${clients.data.map((cl) => `<option value="${cl.id}">${cl.name}</option>`).join('')}</select>
      <span class="spacer"></span>
      <button class="btn-gold" id="ged-generate" disabled>Gerar documento</button>
    </div>
    <div id="ged-folders"></div>`;
  const sel = $('#ged-client');
  const load = async () => {
    const cid = sel.value;
    $('#ged-generate').disabled = !cid;
    if (!cid) { $('#ged-folders').innerHTML = '<div class="empty">Selecione um cliente para ver as pastas</div>'; return; }
    const docs = await api('/api/documents?client_id=' + cid);
    const byFolder = {};
    for (const f of Object.keys(FOLDER_PT)) byFolder[f] = [];
    for (const d of docs) (byFolder[d.folder || 'outros'] ??= []).push(d);
    $('#ged-folders').innerHTML = Object.keys(FOLDER_PT).map((f) => `
      <div class="card" style="margin-bottom:14px">
        <div style="padding:12px 16px;border-bottom:1px solid var(--border)"><strong style="color:var(--navy)">${FOLDER_PT[f]}</strong> <small style="color:var(--text-muted)">(${byFolder[f].length})</small></div>
        <div>${byFolder[f].length ? byFolder[f].map((d) => `<div class="mini-row">
          <span>${d.name}<br><small style="color:var(--text-muted)">${fmtDate(d.created_at)}</small></span>
          <span>${badge(d.status)} ${d.has_content == 1 ? `<button class="btn-sm" data-doc="${d.id}">Abrir</button>` : ''} ${!d.has_content && d.file_url ? `<a class="btn-sm" style="text-decoration:none" href="${esc(fileHref(d.file_url))}" target="_blank" rel="noopener">Abrir</a>` : ''} <button class="btn-sm" data-del-doc="${d.id}">×</button></span></div>`).join('') : '<div class="mini-row"><small>Vazia</small></div>'}</div>
      </div>`).join('');
    document.querySelectorAll('[data-doc]').forEach((b) => b.onclick = () => docViewer(b.dataset.doc, load));
    document.querySelectorAll('[data-del-doc]').forEach((b) => b.onclick = async () => {
      try { await api('/api/documents/' + b.dataset.delDoc, { method: 'DELETE' }); toast('Documento removido'); load(); } catch (e) { toast(e.message, 'error'); }
    });
  };
  sel.onchange = load;
  $('#ged-generate').onclick = () => gerarDocForm(sel.value, load);
  await load();
}

async function gedModelos(c) {
  c.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin:8px 0"><button class="btn-gold" id="new-tpl">+ Novo modelo</button></div>
    <div class="card"><div id="tpl-list"></div></div>`;
  const load = async () => {
    const rows = await api('/api/documents/templates');
    $('#tpl-list').innerHTML = rows.length ? `
      <table><thead><tr><th>Modelo</th><th>Categoria</th><th>Peça (IA)</th><th></th></tr></thead>
      <tbody>${rows.map((t) => { const pt = (PIECE_TYPES.find((p) => p.v === t.piece_type) || {}).t; return `<tr><td><strong>${t.name}</strong></td><td>${FOLDER_PT[t.category] || t.category}</td>
        <td>${t.piece_type ? `<span class="badge ativo">🧑‍🎓 ${pt}</span>` : '<span style="color:var(--muted,#8a8175)">—</span>'}</td>
        <td><button class="btn-sm" data-tpl="${t.id}">Editar</button> <button class="btn-sm" data-del-tpl="${t.id}">×</button></td></tr>`; }).join('')}</tbody></table>`
      : '<div class="empty">Nenhum modelo</div>';
    document.querySelectorAll('[data-tpl]').forEach((b) => b.onclick = async () => {
      const t = (await api('/api/documents/templates')).find((x) => x.id == b.dataset.tpl); templateForm(t, load);
    });
    document.querySelectorAll('[data-del-tpl]').forEach((b) => b.onclick = async () => {
      try { await api('/api/documents/templates/' + b.dataset.delTpl, { method: 'DELETE' }); toast('Modelo removido'); load(); } catch (e) { toast(e.message, 'error'); }
    });
  };
  $('#new-tpl').onclick = () => templateForm(null, load);
  await load();
}

async function gerarDocForm(clientId, onSave) {
  const [templates, cs, client] = await Promise.all([
    api('/api/documents/templates'),
    api('/api/cases?limit=200&client_id=' + clientId).catch(() => ({ data: [] })),
    api('/api/clients/' + clientId).catch(() => null),
  ]);
  const caseList = cs.data || cs || [];
  const form = el(`<form class="form-grid">
    ${field('Modelo', 'template_id', { options: templates.map((t) => ({ v: t.id, t: t.name })) })}
    <div id="tpl-info"></div>
    ${field('Processo (opcional)', 'case_id', { options: [{ v: '', t: '—' }].concat(caseList.map((c) => ({ v: c.id, t: c.title || c.case_number }))) })}
    <button type="submit" class="btn-primary">Gerar documento</button>
  </form>`);

  const APPLIES = { pf_comum: 'Pessoa Física · Justiça Comum', pj: 'Pessoa Jurídica', pf_trabalhista: 'Pessoa Física · Justiça do Trabalho' };
  const sel = form.querySelector('[name=template_id]');
  const caseSel = form.querySelector('[name=case_id]');
  const info = form.querySelector('#tpl-info');
  let userPicked = false;

  // Sugere o modelo certo conforme o caso do cliente (PJ → PJ; PF → Comum, ou
  // Trabalhista se o processo selecionado for trabalhista).
  const sugerir = () => {
    if (String(client?.tipo).toUpperCase() === 'PJ') return 'pj';
    const c = caseList.find((x) => x.id == caseSel?.value);
    if (c && c.legal_area === 'trabalhista') return 'pf_trabalhista';
    return 'pf_comum';
  };
  const aplicarSugestao = () => {
    if (userPicked) return;
    const alvo = sugerir();
    const t = templates.find((x) => x.applies_to === alvo);
    if (t) sel.value = t.id;
  };

  const renderInfo = () => {
    const t = templates.find((x) => x.id == sel.value);
    const sugerido = !userPicked && t && t.applies_to === sugerir();
    if (!t || (!t.instructions && !t.legal_basis && !t.applies_to)) { info.innerHTML = ''; return; }
    info.innerHTML = `<div style="font-size:12.5px;line-height:1.55;padding:10px 12px;border-left:3px solid var(--gold);background:var(--surface);border-radius:var(--radius);margin:-4px 0 4px">
      ${sugerido ? '<div style="color:var(--gold);font-weight:600;margin-bottom:2px">★ Sugerido para este cliente</div>' : ''}
      ${t.applies_to ? `<div><strong>Caso:</strong> ${esc(APPLIES[t.applies_to] || t.applies_to)}</div>` : ''}
      ${t.legal_basis ? `<div><strong>Fundamentação:</strong> ${esc(t.legal_basis)}</div>` : ''}
      ${t.instructions ? `<div style="margin-top:4px;white-space:pre-wrap;color:var(--text-soft)">${esc(t.instructions)}</div>` : ''}
    </div>`;
  };

  if (sel) { sel.onchange = () => { userPicked = true; renderInfo(); }; }
  if (caseSel) caseSel.onchange = () => { aplicarSugestao(); renderInfo(); };
  aplicarSugestao(); renderInfo();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form)); body.client_id = clientId;
    if (!body.case_id) delete body.case_id;
    try { const doc = await api('/api/documents/generate', { method: 'POST', body: JSON.stringify(body) }); closeModal(); toast('Documento gerado'); onSave(); docViewer(doc.id, onSave); }
    catch (err) { toast(err.message, 'error'); }
  };
  openModal('Gerar documento', form);
}

async function docViewer(id, onSave) {
  const doc = await api('/api/documents/' + id);
  const wrap = el(`<div>
    <textarea id="doc-content" style="width:100%;min-height:340px;font-family:Georgia,serif;line-height:1.6;white-space:pre-wrap">${doc.content || ''}</textarea>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button class="btn-primary" id="doc-save" style="width:auto">Salvar</button>
      <button class="btn-gold" id="doc-print">Imprimir / PDF</button>
      <button class="btn-sm" id="doc-sign">Enviar para assinatura</button>
    </div>
    <div id="doc-sig" style="margin-top:14px"></div>
  </div>`);
  wrap.querySelector('#doc-save').onclick = async () => {
    try { await api('/api/documents/' + id, { method: 'PUT', body: JSON.stringify({ content: wrap.querySelector('#doc-content').value }) }); toast('Salvo'); if (onSave) onSave(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const loadSigs = async () => {
    const sigs = await api(`/api/documents/${id}/signatures`).catch(() => []);
    wrap.querySelector('#doc-sig').innerHTML = sigs.length ? `
      <strong style="color:var(--navy);font-size:13px">Assinaturas</strong>
      ${sigs.map((s) => {
        const url = location.origin + '/assinar.html?token=' + s.token;
        return `<div class="mini-row">
          <span>${s.signer_name || 'Aguardando'} ${s.status === 'assinado' ? `<br><small style="color:var(--green)">Assinado · cód. ${s.verification_code}</small>` : '<br><small style="color:var(--text-muted)">pendente</small>'}</span>
          <span>${s.status === 'assinado'
            ? `<a class="btn-sm" href="/verificar.html?codigo=${s.verification_code}" target="_blank">Termo</a>`
            : `<button class="btn-sm" data-copy="${url}">Copiar link</button> <a class="btn-sm" href="https://wa.me/?text=${encodeURIComponent('Assine seu documento: ' + url)}" target="_blank">WhatsApp</a>`}</span></div>`;
      }).join('')}` : '';
    wrap.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy); toast('Link copiado'); });
  };
  wrap.querySelector('#doc-sign').onclick = async () => {
    try { await api(`/api/documents/${id}/sign-request`, { method: 'POST', body: '{}' }); toast('Link de assinatura criado'); loadSigs(); }
    catch (e) { toast(e.message, 'error'); }
  };
  loadSigs();
  wrap.querySelector('#doc-print').onclick = () => {
    const txt = wrap.querySelector('#doc-content').value;
    const w = window.open('', '_blank');
    w.document.write(`<html><head><title>${doc.name}</title><style>body{font-family:Georgia,serif;line-height:1.7;max-width:720px;margin:48px auto;padding:0 24px;white-space:pre-wrap;color:#231E1A}</style></head><body>${txt.replace(/</g, '&lt;')}</body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  };
  openModal(doc.name, wrap);
}

const PIECE_TYPES = [['','— Não é peça (documento comum) —'],['peticao_inicial','Petição inicial'],['contestacao','Contestação'],['replica','Réplica'],['recurso','Recurso'],['manifestacao','Manifestação'],['cumprimento_sentenca','Cumprimento de sentença'],['peticao_simples','Petição simples']].map(([v,t])=>({v,t}));

async function templateForm(tpl, onSave) {
  const cats = Object.entries(FOLDER_PT).map(([v, t]) => ({ v, t }));
  const form = el(`<form class="form-grid">
    ${field('Nome do modelo *', 'name', { value: tpl?.name || '' })}
    ${field('Categoria (pasta)', 'category', { value: tpl?.category || 'outros', options: cats })}
    ${field('Tipo de peça (para o Estagiário IA usar este modelo)', 'piece_type', { value: tpl?.piece_type || '', options: PIECE_TYPES })}
    <p style="margin:-4px 0 6px;font-size:12px;color:var(--muted,#8a8175)">Marque o tipo de peça para o Estagiário IA escolher automaticamente este modelo ao redigir a minuta desse tipo, preenchendo-o com os autos do processo.</p>
    <label>Conteúdo (use {{cliente_nome}}, {{cliente_cpf}}, {{cliente_endereco}}, {{processo_numero}}, {{advogada_nome}}, {{advogada_oab}}, {{data_extenso}})
      <textarea name="content" rows="12" style="font-family:Georgia,serif">${tpl?.content || ''}</textarea></label>
    <button type="submit" class="btn-primary">${tpl ? 'Salvar modelo' : 'Criar modelo'}</button>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    try {
      if (tpl) await api('/api/documents/templates/' + tpl.id, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/api/documents/templates', { method: 'POST', body: JSON.stringify(body) });
      closeModal(); toast('Modelo salvo'); onSave();
    } catch (err) { toast(err.message, 'error'); }
  };
  openModal(tpl ? 'Editar modelo' : 'Novo modelo', form);
}

const margemBadge = (m) => `<span class="badge ${m >= 0 ? 'ativo' : 'vencido'}">${m}%</span>`;

async function ctrlClientes(c) {
  const rows = await api('/api/controladoria/rentabilidade/clientes');
  c.innerHTML = rows.length ? `
    <div class="card"><table><thead><tr><th>Cliente</th><th>Receita</th><th>Custo</th><th>Lucro</th><th>Margem</th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td><strong>${r.client_name}</strong></td><td style="color:var(--green)">${money(r.receita)}</td>
      <td style="color:var(--red)">${money(r.custo)}</td>
      <td><strong style="color:${r.lucro >= 0 ? 'var(--green)' : 'var(--red)'}">${money(r.lucro)}</strong></td>
      <td>${margemBadge(r.margem)}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">Sem dados de rentabilidade ainda</div>';
}

async function ctrlProcessos(c) {
  const rows = await api('/api/controladoria/rentabilidade/processos');
  c.innerHTML = rows.length ? `
    <div class="card"><table><thead><tr><th>Processo</th><th>Receita</th><th>Custo</th><th>Lucro</th><th>Margem</th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td><strong>${r.case_title}</strong></td><td style="color:var(--green)">${money(r.receita)}</td>
      <td style="color:var(--red)">${money(r.custo)}</td>
      <td><strong style="color:${r.lucro >= 0 ? 'var(--green)' : 'var(--red)'}">${money(r.lucro)}</strong></td>
      <td>${margemBadge(r.margem)}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">Sem dados de rentabilidade por processo ainda</div>';
}

async function ctrlCentroCusto(c) {
  const rows = await api('/api/controladoria/centro-custo');
  c.innerHTML = rows.length ? `
    <div class="card"><table><thead><tr><th>Centro de custo</th><th>Receita</th><th>Despesa</th><th>Saldo</th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td><strong>${r.centro}</strong></td><td style="color:var(--green)">${money(r.receita)}</td>
      <td style="color:var(--red)">${money(r.despesa)}</td>
      <td><strong style="color:${r.saldo >= 0 ? 'var(--green)' : 'var(--red)'}">${money(r.saldo)}</strong></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">Defina um "centro de custo" nos lançamentos para ver aqui</div>';
}

async function ctrlProvisao(c) {
  const [resumo, lista] = await Promise.all([
    api('/api/controladoria/provisoes/resumo'),
    api('/api/controladoria/provisoes'),
  ]);
  const cell = (t, l) => `${resumo.matriz[t][l].qtd} · ${money(resumo.matriz[t][l].total)}`;
  c.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin:8px 0"><button class="btn-gold" id="new-prov">+ Nova provisão</button></div>
    <div class="kpi-grid">
      ${kpi('Ganho provisionado', money(resumo.ganho_total), 'money')}
      ${kpi('Perda provisionada', money(resumo.perda_total), 'money')}
    </div>
    <div class="card" style="margin-bottom:20px"><table><thead><tr><th>Cenário</th><th>Provável</th><th>Possível</th><th>Remoto</th></tr></thead>
      <tbody>
        <tr><td><strong style="color:var(--green)">Ganho</strong></td><td>${cell('ganho','provavel')}</td><td>${cell('ganho','possivel')}</td><td>${cell('ganho','remoto')}</td></tr>
        <tr><td><strong style="color:var(--red)">Perda</strong></td><td>${cell('perda','provavel')}</td><td>${cell('perda','possivel')}</td><td>${cell('perda','remoto')}</td></tr>
      </tbody></table></div>
    <div class="card"><div id="prov-list"></div></div>`;
  $('#prov-list').innerHTML = lista.length ? `
    <table><thead><tr><th>Processo</th><th>Cliente</th><th>Cenário</th><th>Probabilidade</th><th>Valor</th><th></th></tr></thead>
    <tbody>${lista.map((p) => `<tr>
      <td>${p.case_title || '—'}</td><td>${p.client_name || '—'}</td>
      <td>${p.type === 'ganho' ? '<span class="badge ativo">ganho</span>' : '<span class="badge vencido">perda</span>'}</td>
      <td>${badge(p.likelihood)}</td><td>${money(p.value)}</td>
      <td><button class="btn-sm" data-del-prov="${p.id}">Excluir</button></td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">Nenhuma provisão registrada</div>';
  document.querySelectorAll('[data-del-prov]').forEach((b) => b.onclick = async () => {
    try { await api('/api/controladoria/provisoes/' + b.dataset.delProv, { method: 'DELETE' }); toast('Provisão removida'); ctrlProvisao(c); } catch (e) { toast(e.message, 'error'); }
  });
  $('#new-prov').onclick = () => provisaoForm(() => ctrlProvisao(c));
}

async function provisaoForm(onSave) {
  const cs = await api('/api/cases?limit=200');
  const caseList = cs.data || cs;
  const form = el(`<form class="form-grid">
    ${field('Processo', 'case_id', { options: [{ v: '', t: '— (geral)' }].concat(caseList.map((c) => ({ v: c.id, t: c.title }))) })}
    ${field('Cenário', 'type', { options: [{ v: 'ganho', t: 'Ganho' }, { v: 'perda', t: 'Perda' }] })}
    ${field('Probabilidade', 'likelihood', { options: [{ v: 'provavel', t: 'Provável' }, { v: 'possivel', t: 'Possível' }, { v: 'remoto', t: 'Remoto' }] })}
    ${field('Valor *', 'value', { type: 'number' })}
    ${field('Descrição', 'description', { type: 'textarea' })}
    <button type="submit" class="btn-primary">Registrar provisão</button>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    if (!body.case_id) delete body.case_id;
    try { await api('/api/controladoria/provisoes', { method: 'POST', body: JSON.stringify(body) }); closeModal(); toast('Provisão registrada'); onSave(); }
    catch (err) { toast(err.message, 'error'); }
  };
  openModal('Nova provisão', form);
}

// ── Correspondente Jurídico (audiências para terceiros) ──────────────────────
async function renderCorrespondente(page) {
  page.innerHTML = `
    <div class="page-header"><div><h2>Correspondente Jurídico</h2><p class="sub">Audiências para outros escritórios — como advogado ou preposto</p></div></div>
    <div id="corr-kpis" class="kpi-grid"></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <div class="tabs" id="corr-tabs">
        <button class="tab active" data-tab="historico">${svgIcon('chart')} Histórico</button>
        <button class="tab" data-tab="agenda">${svgIcon('calendar')} Audiências da Agenda</button>
      </div>
      <button class="btn-subtle" id="new-corr-btn" title="Lançar nova audiência">+ Audiência</button>
    </div>
    <div id="corr-content"></div>`;

  const loadKpis = async () => {
    const s = await api('/api/correspondente/summary');
    $('#corr-kpis').innerHTML =
      kpi('Agendadas', s.agendadas) + kpi('Realizadas', s.realizadas) +
      kpi('A receber', money(s.a_receber), 'money') + kpi('Recebido', money(s.recebido), 'money') +
      kpi('Previsto total', money(s.previsto), 'money');
  };

  // TAB: Histórico (tabela com filtros)
  const showHistorico = async () => {
    const c = $('#corr-content');
    c.innerHTML = `
      <div class="form-section" style="margin-bottom:16px">
        <div class="section-header">${svgIcon('search', 'ic-inline')} Filtro de Status</div>
        <select id="corr-filter" style="width:100%;max-width:300px">
          <option value="">Todas</option>
          <option value="agendada">Agendadas</option>
          <option value="realizada">Realizadas</option>
          <option value="faturada">Faturadas</option>
          <option value="paga">Pagas</option>
          <option value="cancelada">Canceladas</option>
        </select>
      </div>
      <div class="card"><div id="corr-table"></div></div>`;

    const loadHistorico = async () => {
      const q = $('#corr-filter').value ? '?status=' + $('#corr-filter').value : '';
      const rows = await api('/api/correspondente' + q);
      $('#corr-table').innerHTML = rows.length ? `
        <table><thead><tr><th>Data/hora</th><th>Atuação</th><th>Processo</th><th>Pagador</th><th>Valor</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows.map((h) => {
          const acoes = [];
          if (h.status === 'agendada') acoes.push(`<button class="btn-sm" data-st="${h.id}" data-to="realizada">Realizada</button>`);
          if (h.status === 'realizada') acoes.push(`<button class="btn-sm" data-st="${h.id}" data-to="faturada">Faturar</button>`);
          if (h.status === 'faturada') acoes.push(`<button class="btn-sm" data-st="${h.id}" data-to="paga">Receber</button>`);
          if (!['paga','cancelada'].includes(h.status)) acoes.push(`<button class="btn-sm" data-st="${h.id}" data-to="cancelada">Cancelar</button>`);
          return `<tr>
            <td>${fmtDateTime(h.hearing_datetime)}<br><small style="color:var(--text-muted)">${h.comarca || ''}</small></td>
            <td>${h.role === 'preposto' ? 'Preposto' : 'Advogado'}</td>
            <td>${h.process_number || '—'}<br><small style="color:var(--text-muted)">${h.requesting_office || ''}</small></td>
            <td>${h.payer_name}<br><small style="color:var(--text-muted)">${h.payer_type}${h.payer_document ? ' · ' + h.payer_document : ''}</small></td>
            <td>${money(h.value)}</td><td>${badge(h.status)}</td>
            <td style="white-space:nowrap">${acoes.join(' ')}</td></tr>`;
        }).join('')}</tbody></table>`
        : '<div class="empty">Nenhuma audiência registrada</div>';
      document.querySelectorAll('[data-st]').forEach((b) => b.onclick = async () => {
        try { await api(`/api/correspondente/${b.dataset.st}/status`, { method: 'PATCH', body: JSON.stringify({ status: b.dataset.to }) }); toast('Status atualizado'); loadKpis(); loadHistorico(); }
        catch (e) { toast(e.message, 'error'); }
      });
    };
    $('#corr-filter').onchange = loadHistorico;
    await loadHistorico();
  };

  // TAB: Audiências da Agenda (pendências)
  const showAgenda = async () => {
    const c = $('#corr-content');
    const pend = await api('/api/correspondente/agenda-pendencias').catch(() => []);
    c.innerHTML = pend.length ? `
      <div class="form-section" style="border:1px solid var(--gold)">
        <div class="section-header">${svgIcon('calendar', 'ic-inline')} Eventos do Google Calendar</div>
        <p class="sub" style="margin-bottom:12px">Clique em "É correspondente" para registrar como audiência, ou "É do cliente" para vincular à ficha.</p>
        ${pend.map((e) => `<div class="mini-row" style="background:var(--surface-2);padding:12px;border-radius:8px;margin-bottom:8px">
          <span><strong>${e.title}</strong><br><small style="color:var(--text-muted)">${fmtDateTime(e.start_datetime)} ${e.location ? '· ' + e.location : ''}</small></span>
          <span style="white-space:nowrap;display:flex;gap:6px">
            <button class="btn-sm" data-pend-corr="${e.id}" data-dt="${e.start_datetime}">✓ Correspondente</button>
            <button class="btn-sm" data-pend-cli="${e.id}">${svgIcon('users')} Cliente</button></span></div>`).join('')}
      </div>` : '<div class="empty">Nenhuma audiência da agenda para classificar</div>';

    document.querySelectorAll('[data-pend-corr]').forEach((b) => b.onclick = () => {
      const dt = new Date(b.dataset.dt); const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      correspondenteForm(() => showAgenda(), { hearing_datetime: local, calendar_event_id: b.dataset.pendCorr });
    });
    document.querySelectorAll('[data-pend-cli]').forEach((b) => b.onclick = () => clientPicker(async (clientId) => {
      try { await api(`/api/correspondente/agenda-pendencias/${b.dataset.pendCli}/cliente`, { method: 'POST', body: JSON.stringify({ client_id: clientId }) }); toast('Audiência vinculada ao cliente'); await showAgenda(); }
      catch (e) { toast(e.message, 'error'); }
    }));
  };

  // Switch entre abas
  document.querySelectorAll('#corr-tabs .tab').forEach((tab) => {
    tab.onclick = async () => {
      document.querySelectorAll('#corr-tabs .tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const tabName = tab.dataset.tab;
      if (tabName === 'historico') await showHistorico();
      else if (tabName === 'agenda') await showAgenda();
    };
  });

  $('#new-corr-btn').onclick = () => correspondenteForm(() => renderCorrespondente(page));

  await loadKpis();
  await showHistorico();
}

async function clientPicker(onPick) {
  const clients = await api('/api/clients?limit=200');
  const form = el(`<form class="form-grid">
    ${field('Cliente', 'client_id', { options: clients.data.map((c) => ({ v: c.id, t: c.name })) })}
    <button type="submit" class="btn-primary">Vincular</button>
  </form>`);
  form.onsubmit = (e) => { e.preventDefault(); closeModal(); onPick(form.querySelector('[name=client_id]').value); };
  openModal('Vincular à ficha do cliente', form);
}

// Bloco com a movimentação/intimação na ÍNTEGRA (rolável, sem corte) + metadados.
function movementFullBlock(d) {
  const full = d.movement_full || d.movement_text || '(sem texto)';
  // movement_metadata pode vir como objeto (mysql2 JSON) ou string.
  let meta = d.movement_metadata;
  if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = null; } }
  meta = meta || {};

  const linha = [
    d.process_number ? `Processo ${esc(d.process_number)}` : '',
    d.movement_date ? `· ${fmtDate(d.movement_date)}` : '',
    d.movement_source ? `· ${esc(d.movement_source)}` : '',
  ].filter(Boolean).join(' ');

  // Partes (nome — polo), advogado intimado, tipo/órgão/classe e link do PJe.
  const parties = Array.isArray(meta.parties) ? meta.parties : [];
  const partesHtml = parties.length
    ? `<div><strong>Partes:</strong> ${parties.map((p) => `${esc(p.nome)}${p.polo ? ` <span style="color:var(--text-muted)">(${esc(p.polo)})</span>` : ''}`).join('; ')}</div>`
    : '';
  const campo = (rotulo, valor) => valor ? `<div><strong>${rotulo}:</strong> ${esc(valor)}</div>` : '';
  const linkHtml = meta.link
    ? `<div><a href="${esc(meta.link)}" target="_blank" rel="noopener" style="color:var(--gold)">Abrir no PJe/tribunal ↗</a></div>`
    : '';
  const fichaHtml = [
    campo('Tipo', meta.tipoComunicacao),
    campo('Órgão/Vara', meta.orgao),
    campo('Classe', meta.classe),
    partesHtml,
    linkHtml,
  ].filter(Boolean).join('');

  return `
    ${linha ? `<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">${linha}</div>` : ''}
    ${fichaHtml ? `<div style="font-size:12.5px;line-height:1.6;margin-bottom:8px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface)">${fichaHtml}</div>` : ''}
    <div style="font-size:13px;color:var(--text);line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:42vh;overflow:auto;border:1px solid var(--border);border-radius:var(--radius);padding:12px;background:var(--surface)">${esc(full)}</div>`;
}

// Modal somente-leitura: ver a movimentação completa sem entrar no fluxo de confirmar.
function showMovementFull(d) {
  if (!d) return;
  openModal('Movimentação na íntegra', el(`<div>${movementFullBlock(d)}</div>`));
}

async function confirmDeadlineForm(d, onSave) {
  const start = d.start_date ? new Date(d.start_date).toISOString().slice(0, 10) : '';
  const form = el(`<form class="form-grid">
    ${movementFullBlock(d)}
    ${field('Tipo de prazo', 'deadline_type', { value: d.suggested_type || '' })}
    <div class="form-row">${field('Dias (úteis)', 'days', { type: 'number', value: d.suggested_days || 15 })}${field('Início', 'start_date', { type: 'date', value: start })}</div>
    <p class="sub">A data-limite é calculada em dias úteis. Se o processo tiver caso vinculado, entra automaticamente nos alertas (30/15/7/3/1 dia).</p>
    <button type="submit" class="btn-primary">Confirmar prazo</button>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api(`/api/prazos-detectados/${d.id}/confirmar`, { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      closeModal(); toast(`Prazo confirmado: ${fmtDate(r.due_date)}${r.linked_to_case ? ' (alertas ativos)' : ''}`); onSave();
    } catch (err) { toast(err.message, 'error'); }
  };
  openModal('Confirmar prazo', form);
}

async function correspondenteFormHtml(prefill = {}) {
  const solicitantes = await api('/api/correspondente/solicitantes').catch(() => []);
  const solOpts = [{ v: '', t: '— Novo solicitante —' }].concat(
    solicitantes.map((s, i) => ({ v: String(i), t: `${s.payer_name}${s.requesting_office ? ' — ' + s.requesting_office : ''}${s.usos > 1 ? ` (${s.usos}x)` : ''}` }))
  );
  return `<form class="form-grid form-pro-max" id="corresp-form">
    <div class="form-section">
      <div class="section-header">${svgIcon('calendar', 'ic-inline')} Quando</div>
      <div class="form-row">${field('Data e hora *', 'hearing_datetime', { type: 'datetime-local', value: prefill.hearing_datetime || '' })}${field('Atuação', 'role', { options: [{ v: 'advogado', t: '👨‍⚖️ Advogado' }, { v: 'preposto', t: '📋 Preposto' }] })}</div>
    </div>

    <div class="form-section">
      <div class="section-header">${svgIcon('scale', 'ic-inline')} Processo</div>
      <div class="form-row">${field('Número do processo', 'process_number')}${field('Comarca', 'comarca')}</div>
      <div class="form-row">${field('Vara', 'vara')}${field('Fórum / link', 'location')}</div>
    </div>

    <div class="form-section">
      <div class="section-header">${svgIcon('users', 'ic-inline')} Quem pagou</div>
      ${solicitantes.length ? field('Repetir solicitante já usado', 'sol_pick', { options: solOpts }) : ''}
      ${field('Escritório/advogado contratante', 'requesting_office')}
      <div class="form-row">${field('Pagador (empresa ou pessoa) *', 'payer_name', { style: 'grid-column: 1 / -1;' })}${field('Tipo', 'payer_type', { options: [{ v: 'PJ', t: 'PJ' }, { v: 'PF', t: 'PF' }] })}</div>
      ${field('CNPJ/CPF', 'payer_document')}
    </div>

    <div class="form-section">
      <div class="section-header">${svgIcon('banknote', 'ic-inline')} Pagamento</div>
      <div class="form-row">${field('Valor da audiência *', 'value', { type: 'number' })}${field('Vencimento', 'due_date', { type: 'date' })}</div>
      ${field('Observações', 'notes', { type: 'textarea' })}
    </div>

    <button type="submit" class="btn-primary btn-large">✓ Registrar audiência</button>
  </form>`;
}

async function attachCorrespondenteFormHandlers(onSave, prefill = {}) {
  const form = $('#corresp-form');
  const solicitantes = await api('/api/correspondente/solicitantes').catch(() => []);
  const pick = form.querySelector('[name=sol_pick]');
  if (pick) pick.onchange = () => {
    const s = solicitantes[Number(pick.value)];
    if (!s) return;
    const set = (n, v) => { const inp = form.querySelector(`[name=${n}]`); if (inp) inp.value = v || ''; };
    set('requesting_office', s.requesting_office);
    set('payer_name', s.payer_name);
    set('payer_type', s.payer_type || 'PJ');
    set('payer_document', s.payer_document);
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    delete body.sol_pick;
    if (prefill.calendar_event_id) body.calendar_event_id = prefill.calendar_event_id;
    try { await api('/api/correspondente', { method: 'POST', body: JSON.stringify(body) });
      toast('Audiência registrada'); form.reset(); onSave(); }
    catch (err) { toast(err.message, 'error'); }
  };
}

async function correspondenteForm(onSave, prefill = {}) {
  const form = el(`<form class="form-grid">${await correspondenteFormHtml(prefill)}</form>`);
  const solicitantes = await api('/api/correspondente/solicitantes').catch(() => []);
  const pick = form.querySelector('[name=sol_pick]');
  if (pick) pick.onchange = () => {
    const s = solicitantes[Number(pick.value)];
    if (!s) return;
    const set = (n, v) => { const inp = form.querySelector(`[name=${n}]`); if (inp) inp.value = v || ''; };
    set('requesting_office', s.requesting_office);
    set('payer_name', s.payer_name);
    set('payer_type', s.payer_type || 'PJ');
    set('payer_document', s.payer_document);
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    delete body.sol_pick;
    if (prefill.calendar_event_id) body.calendar_event_id = prefill.calendar_event_id;
    try { await api('/api/correspondente', { method: 'POST', body: JSON.stringify(body) });
      closeModal(); toast('Audiência registrada e agendada'); onSave(); }
    catch (err) { toast(err.message, 'error'); }
  };
  openModal('Nova audiência de correspondente', form);
}

const INTAKE_AREAS = [['trabalhista', 'Trabalhista'], ['civel', 'Cível'], ['familia', 'Família'], ['previdenciario', 'Previdenciário'], ['consumidor', 'Consumidor'], ['gestante', 'Gestante'], ['outro', 'Outro']].map(([v, t]) => ({ v, t }));

// Painel de conexão do Gmail da parceria (Fase 2 — busca automática + Drive).
async function loadInboxPanel(onChange) {
  const box = $('#parc-inbox');
  if (!box) return;
  const st = await api('/api/email-intake/integration').catch(() => ({ connected: false }));
  if (!st.connected) {
    box.innerHTML = `<div class="card" style="margin-bottom:14px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;gap:10px">
      <div style="font-size:13px">📨 <strong>Busca automática por e-mail</strong> — conecte o Gmail que recebe os e-mails da Infinity para o CRM buscar sozinho e guardar os anexos no Drive.</div>
      <button class="btn-gold btn-sm" id="inbox-connect">Conectar Gmail da parceria</button></div>`;
    $('#inbox-connect').onclick = async () => {
      try { const { url } = await api('/api/email-intake/integration/auth-url'); window.location.href = url; }
      catch (e) { toast(e.message, 'error'); }
    };
    return;
  }
  const last = st.last_sync ? new Date(st.last_sync).toLocaleString('pt-BR') : 'nunca';
  box.innerHTML = `<div class="card" style="margin-bottom:14px;padding:12px 14px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <div style="font-size:13px">📨 Gmail conectado: <strong>${esc(st.google_email || '—')}</strong> · remetente <code>${esc(st.sender_filter || '')}</code> · última busca: ${last} ${st.active ? '' : '<span style="color:var(--red)">(pausado)</span>'}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn-gold btn-sm" id="inbox-sync">${svgIcon('refresh')} Buscar agora</button><button class="btn-sm" id="inbox-sync-reset" title="Apaga o last_sync e rebusca desde o início do dia">${svgIcon('refresh')} Rebuscar desde hoje</button><button class="btn-sm" id="inbox-sync-old" title="Recupera e-mails antigos do parceiro (últimos 30 dias)">${svgIcon('download')} Buscar e-mails antigos (30 dias)</button><button class="btn-sm" id="inbox-perm">${svgIcon('key')} Atualizar permissões</button><button class="btn-sm" id="inbox-disc">Desconectar</button></div>
      <div style="display:flex;gap:6px;margin-top:8px;align-items:center;flex-wrap:wrap">
        <input id="inbox-diag-term" placeholder="não achou? digite o nome do cliente (ex.: Ilma)" style="flex:1;min-width:200px;font-size:13px">
        <button class="btn-sm" id="inbox-diag">${svgIcon('search')} Diagnosticar</button>
      </div>
      <div id="inbox-diag-out" style="margin-top:8px"></div>
    </div></div>`;
  const diagBtn = $('#inbox-diag');
  if (diagBtn) diagBtn.onclick = async () => {
    const term = $('#inbox-diag-term').value.trim();
    if (!term) return;
    const out = $('#inbox-diag-out'); out.innerHTML = '<div class="spinner"></div>';
    try {
      const d = await api('/api/email-intake/integration/diagnose', { method: 'POST', body: JSON.stringify({ term }) });
      const linhas = (d.encontrados || []).map((e) => `
        <div class="mini-row" style="padding:6px 0">
          <span><strong>${esc(e.de)}</strong><br><small style="color:var(--text-muted)">${esc(e.assunto)} · ${esc(e.data)}</small></span>
          <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;background:${e.bate_filtro ? 'var(--green,#1e8e5a)' : 'var(--red,#c0392b)'};color:#fff">${e.bate_filtro ? 'bate o filtro' : 'NÃO bate'}</span>
        </div>`).join('');
      out.innerHTML = `
        <div class="card" style="padding:12px 14px;font-size:13px">
          <div>Conta conectada: <code>${esc(d.conta_conectada)}</code> · filtro de remetente: <code>${esc(d.filtro_remetente || '(vazio)')}</code></div>
          ${d.encontrados.length ? linhas
            : '<div class="empty" style="margin-top:6px">Nenhum e-mail com esse termo na conta conectada. Talvez esteja em OUTRA conta do Gmail.</div>'}
          ${d.encontrados.length && !d.encontrados.some((e) => e.bate_filtro)
            ? '<div style="margin-top:8px;background:#fff4e5;border-left:3px solid var(--gold,#c9a227);padding:8px 10px;border-radius:4px">O e-mail existe, mas o remetente <strong>não bate</strong> com o filtro. Ajuste o remetente do parceiro para o endereço mostrado acima, e busque de novo.</div>'
            : ''}
        </div>`;
    } catch (e) { out.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  };
  const permBtn = $('#inbox-perm');
  if (permBtn) permBtn.onclick = async () => {
    try { const { url } = await api('/api/email-intake/integration/auth-url'); window.location.href = url; }
    catch (e) { toast(e.message, 'error'); }
  };
  $('#inbox-sync').onclick = async () => {
    const b = $('#inbox-sync'); b.disabled = true; b.textContent = 'Buscando...';
    try { const r = await api('/api/email-intake/integration/sync', { method: 'POST', body: '{}' }); toast(`Busca concluída · ${r.imported} novo(s)`); onChange(); }
    catch (e) { toast(e.message, 'error'); b.disabled = false; b.textContent = '🔄 Buscar agora'; }
  };
  $('#inbox-sync-reset').onclick = async () => {
    if (!confirm('Isso apaga o histórico de última busca e re-sincroniza desde o início de hoje.\nE-mails já importados serão ignorados automaticamente. Continuar?')) return;
    const b = $('#inbox-sync-reset'); b.disabled = true; b.textContent = 'Rebuscando...';
    try { const r = await api('/api/email-intake/integration/sync', { method: 'POST', body: JSON.stringify({ reset_sync: true }) }); toast(`Rebusca concluída · ${r.imported} novo(s)`); onChange(); }
    catch (e) { toast(e.message, 'error'); }
    finally { b.disabled = false; b.textContent = 'Rebuscar desde hoje'; }
  };
  const oldBtn = $('#inbox-sync-old');
  if (oldBtn) oldBtn.onclick = async () => {
    if (!confirm('Buscar e-mails do parceiro dos ÚLTIMOS 30 DIAS?\nÚtil para recuperar casos antigos que não entraram na fila (ex.: chegados no início do mês).\nOs já importados são ignorados. Continuar?')) return;
    oldBtn.disabled = true; oldBtn.textContent = 'Buscando 30 dias...';
    try {
      const r = await api('/api/email-intake/integration/sync', { method: 'POST', body: JSON.stringify({ since_days: 30 }) });
      toast(`Busca retroativa concluída · ${r.imported} novo(s) na fila`);
      onChange();
    } catch (e) { toast(e.message, 'error'); }
    finally { oldBtn.disabled = false; oldBtn.textContent = 'Buscar e-mails antigos (30 dias)'; }
  };
  $('#inbox-disc').onclick = async () => {
    if (!confirm('Desconectar o Gmail da parceria?')) return;
    try { await api('/api/email-intake/integration/disconnect', { method: 'POST', body: '{}' }); toast('Desconectado'); onChange(); }
    catch (e) { toast(e.message, 'error'); }
  };
}

// Fila de importações pendentes (revisão antes de criar cliente/casos).
async function loadImportQueue(partners, onChange) {
  const box = $('#parc-import-queue');
  if (!box) return;
  const rows = await api('/api/email-intake?status=pendente').catch(() => []);
  if (!rows.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="card" style="margin-bottom:14px;border-left:3px solid var(--gold,#b08d57)">
    <div style="padding:10px 14px;font-weight:600">📥 Importados do e-mail — aguardando revisão (${rows.length})</div>
    <table><thead><tr><th>Cliente</th><th>Casos</th><th>Origem</th><th></th></tr></thead><tbody>
    ${rows.map((r) => {
      const p = r.parsed || {};
      const casos = (p.casos || []).map((c) => `${INTAKE_AREAS.find((a) => a.v === c.area)?.t || c.area}${c.tipo ? ' · ' + esc(c.tipo) : ''}${c.banco ? ' (' + esc(c.banco) + ')' : ''}`).join('<br>');
      return `<tr>
        <td><strong>${esc(p.cliente?.nome || '—')}</strong>${p.cliente?.cpf ? '<br><small>' + esc(p.cliente.cpf) + '</small>' : ''}</td>
        <td style="font-size:12px">${casos || '<span style="color:var(--red)">não estruturado</span>'}</td>
        <td><small>${esc(r.from_email || r.source || '')}</small></td>
        <td style="white-space:nowrap"><button class="btn-sm btn-gold" data-review="${r.id}">Revisar</button> <button class="btn-sm" data-discard="${r.id}">×</button></td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
  box.querySelectorAll('[data-review]').forEach((b) => b.onclick = async () => {
    const r = (await api('/api/email-intake?status=pendente')).find((x) => x.id == b.dataset.review);
    if (r) reviewImportForm(r, partners, onChange);
  });
  box.querySelectorAll('[data-discard]').forEach((b) => b.onclick = async () => {
    if (!confirm('Descartar esta importação?')) return;
    try { await api(`/api/email-intake/${b.dataset.discard}/discard`, { method: 'POST', body: '{}' }); toast('Descartado'); onChange(); }
    catch (e) { toast(e.message, 'error'); }
  });
}

// Colar o e-mail do parceiro → IA estrutura → cai na fila de revisão.
function importEmailForm(partners, defaultPartnerId, onSave) {
  const form = el(`<form class="form-grid">
    <p style="font-size:13px;color:var(--text-muted)">Cole o <strong>assunto e o corpo</strong> do e-mail do parceiro. A IA lê os dois e separa em casos por contraparte (banco/produto). Nada é criado ainda — vai para a fila de revisão.</p>
    ${field('Parceiro', 'partner_id', { value: defaultPartnerId, options: partners.map((p) => ({ v: p.id, t: p.name })) })}
    ${field('Assunto do e-mail', 'subject')}
    <p style="font-size:12px;color:var(--text-muted);margin:-6px 0 2px">Cole também o assunto — as contrapartes costumam vir nele (ex.: "Banco PAN (RCC) e Agibank (RMC) — Fulano").</p>
    ${field('E-mail do remetente (opcional)', 'from_email')}
    <label>Texto do e-mail *<textarea name="raw_text" rows="12" placeholder="Cole aqui o conteúdo do e-mail..." required></textarea></label>
    <button type="submit" class="btn-primary">Analisar com IA</button>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Analisando...';
    try {
      const body = Object.fromEntries(new FormData(form));
      const out = await api('/api/email-intake/parse', { method: 'POST', body: JSON.stringify(body) });
      closeModal();
      if (out.warning) toast(out.warning, 'error');
      else toast('E-mail analisado — revise na fila');
      onSave();
      if (out.parsed) { const r = (await api('/api/email-intake?status=pendente')).find((x) => x.id == out.id); if (r) reviewImportForm(r, partners, onSave); }
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Analisar com IA'; }
  };
  openModal('Importar cliente do e-mail', form);
}

// Revisar/editar os dados extraídos e confirmar (cria cliente + casos + entrada).
function reviewImportForm(imp, partners, onSave) {
  const p = imp.parsed || { cliente: { nome: '' }, casos: [] };
  const cl = p.cliente || {};
  let casos = (p.casos && p.casos.length ? p.casos : [{ area: 'outro' }]).map((c) => ({ ...c }));
  const wrap = el('<div></div>');
  const render = () => {
    wrap.innerHTML = `<form class="form-grid" id="rev-form">
      <div class="form-row">${field('Nome do cliente *', 'nome', { value: cl.nome || '' })}${field('CPF', 'cpf', { value: cl.cpf || '' })}</div>
      <div class="form-row">${field('E-mail', 'email', { value: cl.email || '' })}${field('Telefone', 'telefone', { value: cl.telefone || '' })}</div>
      <div style="font-weight:600;margin-top:6px">Casos (${casos.length}) — cada um vira um processo na esteira</div>
      <div id="rev-casos"></div>
      <button type="button" class="btn-ghost btn-sm" id="add-caso">+ Adicionar caso</button>
      <button type="submit" class="btn-primary">✓ Confirmar e cadastrar</button>
    </form>`;
    const cbox = wrap.querySelector('#rev-casos');
    cbox.innerHTML = casos.map((c, i) => `<div class="card" style="padding:10px 12px;margin:6px 0">
      <div class="form-row">${field('Área', `area_${i}`, { value: c.area || 'outro', options: INTAKE_AREAS })}${field('Tipo (ex.: empréstimo pessoal)', `tipo_${i}`, { value: c.tipo || '' })}</div>
      <div class="form-row">${field('Banco/instituição', `banco_${i}`, { value: c.banco || '' })}${field('Descrição', `descricao_${i}`, { value: c.descricao || '' })}</div>
      ${casos.length > 1 ? `<button type="button" class="btn-sm" data-rm="${i}">Remover caso</button>` : ''}
    </div>`).join('');
    const collect = () => {
      const f = wrap.querySelector('#rev-form');
      const g = (n) => f.querySelector(`[name="${n}"]`)?.value?.trim() || '';
      return {
        cliente: { nome: g('nome'), cpf: g('cpf'), email: g('email'), telefone: g('telefone') },
        casos: casos.map((_, i) => ({ area: g(`area_${i}`) || 'outro', tipo: g(`tipo_${i}`), banco: g(`banco_${i}`), descricao: g(`descricao_${i}`) })),
      };
    };
    wrap.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { casos = collect().casos; casos.splice(Number(b.dataset.rm), 1); Object.assign(cl, collect().cliente); render(); });
    wrap.querySelector('#add-caso').onclick = () => { const cur = collect(); casos = cur.casos.concat([{ area: 'outro' }]); Object.assign(cl, cur.cliente); render(); };
    wrap.querySelector('#rev-form').onsubmit = async (e) => {
      e.preventDefault();
      const parsed = collect();
      if (!parsed.cliente.nome) { toast('Informe o nome do cliente', 'error'); return; }
      const btn = wrap.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Cadastrando...';
      try {
        const out = await api(`/api/email-intake/${imp.id}/confirm`, { method: 'POST', body: JSON.stringify({ parsed }) });
        closeModal(); toast(`Cliente cadastrado · ${out.caseIds.length} caso(s)${out.entrada ? ' · entrada R$ ' + Number(out.entrada).toFixed(2) : ''}`); onSave();
      } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = '✓ Confirmar e cadastrar'; }
    };
  };
  render();
  openModal('Revisar importação', wrap);
}

function parceriaCaseForm(partners, defaultPartnerId, onSave) {
  const AREAS_OPT = [['trabalhista', 'Trabalhista'], ['civel', 'Cível'], ['familia', 'Família'], ['previdenciario', 'Previdenciário'], ['consumidor', 'Consumidor'], ['gestante', 'Gestante'], ['outro', 'Outro']].map(([v, t]) => ({ v, t }));
  const form = el(`<form class="form-grid">
    ${field('Parceiro', 'partner_id', { options: partners.map((p) => ({ v: p.id, t: p.name })) })}
    ${field('Cliente *', 'client_name')}
    <div class="form-row">${field('CPF', 'cpf')}${field('E-mail', 'email', { type: 'email' })}</div>
    <div class="form-row">${field('Telefone', 'phone')}${field('Área', 'legal_area', { options: AREAS_OPT })}</div>
    ${field('Processos (um por linha: título ou nº). Vazio = 1 processo.', 'processos_text', { type: 'textarea' })}
    ${field('Resumo do caso (vai para a produção)', 'case_summary', { type: 'textarea' })}
    <p class="sub">A entrada por protocolo é calculada pelo nº de processos e já é lançada no financeiro (100% do escritório).</p>
    <button type="submit" class="btn-primary">Registrar caso de parceria</button>
  </form>`);
  const psel = form.querySelector('[name=partner_id]'); if (psel && defaultPartnerId) psel.value = defaultPartnerId;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(form));
    if (!b.client_name || !b.client_name.trim()) { toast('Informe o cliente', 'error'); return; }
    const procs = (b.processos_text || '').split('\n').map((s) => s.trim()).filter(Boolean).map((t) => ({ title: t }));
    const body = { client_name: b.client_name, cpf: b.cpf, email: b.email, phone: b.phone, legal_area: b.legal_area, case_summary: b.case_summary, processos: procs };
    try {
      const r = await api(`/api/partners/${b.partner_id}/cases`, { method: 'POST', body: JSON.stringify(body) });
      closeModal(); toast(`Registrado · ${r.case_ids.length} processo(s) na esteira · entrada ${money(r.entrada)}`); onSave && onSave();
    } catch (err) { toast(err.message, 'error'); }
  };
  openModal('Novo caso de parceria', form);
}

function resultadoForm(caseId, clientName, onSave) {
  const form = el(`<form class="form-grid">
    <p class="sub">${esc(clientName || '')}</p>
    ${field('Tipo de resultado', 'kind', { options: [{ v: 'exito', t: 'Êxito (% sobre o ganho)' }, { v: 'sucumbencia', t: 'Sucumbência' }] })}
    ${field('Valor *', 'amount', { type: 'number' })}
    <p class="sub">No êxito, informe o <strong>valor ganho no processo</strong> (o sistema aplica o % do acordo). Na sucumbência, o <strong>valor recebido</strong>. A receita do escritório e o repasse ao parceiro (50/50) são lançados automaticamente.</p>
    <button type="submit" class="btn-primary">Registrar resultado</button>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(form));
    if (!Number(b.amount)) { toast('Informe o valor', 'error'); return; }
    try {
      const r = await api(`/api/partners/cases/${caseId}/resultado`, { method: 'POST', body: JSON.stringify({ kind: b.kind, amount: b.amount }) });
      closeModal(); toast(`Receita ${money(r.receita)} · repasse ao parceiro ${money(r.repasse)}`); onSave && onSave();
    } catch (err) { toast(err.message, 'error'); }
  };
  openModal('Registrar resultado (êxito/sucumbência)', form);
}

// Cadastro/edição de parceiro (empresa que indica clientes)
async function partnerForm(id, onSave) {
  let p = { name: '', success_fee_percent: 30, partner_split_percent: 50, sucumbencia_split_percent: 50, entry_value_single: 100, entry_value_double: 130, entry_split: 0, notes: '' };
  if (id) { const all = await api('/api/partners').catch(() => []); p = all.find((x) => x.id == id) || p; }
  const form = el(`<form class="form-grid">
    ${field('Nome do parceiro *', 'name', { value: p.name })}
    <div class="form-row">${field('Êxito (% sobre o ganho)', 'success_fee_percent', { type: 'number', value: p.success_fee_percent })}${field('Fatia do parceiro no êxito (%)', 'partner_split_percent', { type: 'number', value: p.partner_split_percent })}</div>
    <div class="form-row">${field('Divisão da sucumbência (%)', 'sucumbencia_split_percent', { type: 'number', value: p.sucumbencia_split_percent })}${field('Entrada — 1 processo (R$)', 'entry_value_single', { type: 'number', value: p.entry_value_single })}</div>
    <div class="form-row">${field('Entrada — 2 processos (R$)', 'entry_value_double', { type: 'number', value: p.entry_value_double })}${field('A entrada é dividida com o parceiro?', 'entry_split', { options: [{ v: '0', t: 'Não (100% do escritório)' }, { v: '1', t: 'Sim' }] })}</div>
    ${field('Observações', 'notes', { type: 'textarea', value: p.notes || '' })}
    <button type="submit" class="btn-primary">${id ? 'Salvar' : 'Cadastrar parceiro'}</button>
  </form>`);
  if (id) form.querySelector('[name=entry_split]').value = String(p.entry_split ? 1 : 0);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(form));
    if (!b.name.trim()) { toast('Informe o nome do parceiro', 'error'); return; }
    const body = {
      name: b.name.trim(),
      success_fee_percent: Number(b.success_fee_percent) || 0, partner_split_percent: Number(b.partner_split_percent) || 0,
      sucumbencia_split_percent: Number(b.sucumbencia_split_percent) || 0,
      entry_value_single: Number(b.entry_value_single) || 0, entry_value_double: Number(b.entry_value_double) || 0,
      entry_split: b.entry_split === '1' ? 1 : 0, notes: b.notes || null,
    };
    try {
      await api(id ? `/api/partners/${id}` : '/api/partners', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
      closeModal(); toast(id ? 'Parceiro atualizado' : 'Parceiro cadastrado'); onSave && onSave();
    } catch (err) { toast(err.message, 'error'); }
  };
  openModal(id ? 'Editar parceiro' : 'Novo parceiro', form);
}

function kpi(label, value, cls = '') {
  return `<div class="kpi"><div class="label">${label}</div><div class="value ${cls}">${value ?? 0}</div></div>`;
}

const fmtDateTime = (d) => d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/** Renderiza a linha do tempo unificada da jornada (lead → cliente → processo). */
function journeyHTML(events) {
  if (!events || !events.length) return '<div class="empty">Sem registros ainda</div>';
  return `<ol class="timeline">${events.map((e) => {
    const change = (e.old_value && e.new_value)
      ? `<small class="tl-change">${e.old_value} → ${e.new_value}</small>`
      : (e.new_value ? `<small class="tl-change">${e.new_value}</small>` : '');
    return `<li class="tl-item tl-${e.source || 'funil'}">
      <span class="tl-dot"></span>
      <div class="tl-body">
        <div class="tl-title">${e.title} ${change}</div>
        ${e.description ? `<div class="tl-desc">${e.description}</div>` : ''}
        <div class="tl-meta">${fmtDateTime(e.created_at)}${e.actor_name ? ' · ' + e.actor_name : ''}</div>
      </div></li>`;
  }).join('')}</ol>`;
}

/** Carrega a jornada num container, por lead ou cliente. */
async function loadJourney(container, params) {
  container.innerHTML = '<div class="spinner"></div>';
  try {
    const q = new URLSearchParams(params).toString();
    const r = await api('/api/journey?' + q);
    container.innerHTML = journeyHTML(r.events);
  } catch (e) { container.innerHTML = `<div class="empty">${e.message}</div>`; }
}

function miniList(title, rows) {
  // Aceita array (junta) ou string (usa direto) — evita "rows.join is not a function".
  const body = Array.isArray(rows) ? rows.join('') : (rows || '');
  return `<div class="dash-section"><h3>${title}</h3><div class="mini-list">${
    body ? body : '<div class="mini-row"><small>Sem registros</small></div>'
  }</div></div>`;
}

const LEAD_STATUS_PT = { triagem: 'Novo Lead', atendimento_inicial: 'Primeiro Contato', reuniao: 'Atendimento Realizado', documentacao_pendente: 'Documentação Pendente', proposta: 'Proposta Enviada', proposta_em_analise: 'Negociação', contrato_assinado: 'Contrato Assinado', fechada: 'Convertido', convertido: 'Convertido', perdida: 'Perdido' };
const FUNNEL_ORDER = ['triagem', 'atendimento_inicial', 'reuniao', 'documentacao_pendente', 'proposta', 'proposta_em_analise', 'contrato_assinado'];

// Cockpit — painel-mãe: dinheiro, prazos, intimações, alertas e agenda num só lugar.
async function dashCockpit(c) {
  const [d, series] = await Promise.all([
    api('/api/dashboards/cockpit'),
    api('/api/metrics/series?days=30').catch(() => ({})),
  ]);
  const go = (route) => `onclick="location.hash='#${route}'" style="cursor:pointer"`;
  const serie = (k) => ((series && series[k]) || []).map((p) => p.value);

  const f = d.financeiro || {};
  // KPI do sistema (robusto/responsivo) + mini-tendência (sparkline) dos últimos 30 dias
  const stat = (label, value, route, o = {}) => {
    const sp = serie(o.key);
    const spark = sp.length > 1 ? sparkline(sp, { color: o.sparkColor || 'var(--gold)' }) : '';
    const delta = deltaBadge(sp, o.goodUp !== false);
    return `<div class="kpi" ${go(route)} style="cursor:pointer">
       <div class="label">${label}</div>
       <div class="value${o.money ? ' money' : ''}"${o.color ? ` style="color:${o.color}"` : ''}>${o.money ? money(value) : (value ?? 0)}</div>
       ${delta}${spark}
     </div>`;
  };
  const kpis = `<div class="kpi-grid" style="margin-bottom:20px">
    ${stat('A receber até hoje', f.receber_hoje, 'financeiro', { money: 1, key: 'receber_hoje', sparkColor: 'var(--green)' })}
    ${stat('A receber (7 dias)', f.receber_7d, 'financeiro', { money: 1, key: 'receber_7d', sparkColor: 'var(--green)' })}
    ${stat('A pagar (7 dias)', f.pagar_7d, 'financeiro', { money: 1, key: 'pagar_7d', goodUp: false })}
    ${stat('Inadimplência', f.vencido, 'financeiro', { money: 1, key: 'inadimplencia', color: Number(f.vencido) > 0 ? 'var(--red)' : '', sparkColor: 'var(--red)', goodUp: false })}
    ${stat('Tarefas pendentes', d.tarefas_pendentes ?? 0, 'prazos', { key: 'tarefas_pendentes', color: Number(d.tarefas_pendentes) > 0 ? 'var(--amber)' : '', sparkColor: 'var(--amber)', goodUp: false })}
    ${stat('Propostas em análise', d.propostas_paradas ?? 0, 'propostas', { key: 'propostas_analise', goodUp: false })}
    ${stat('Total a protocolar', d.producao?.a_protocolar ?? 0, 'producao', { color: Number(d.producao?.a_protocolar) > 0 ? 'var(--amber)' : '', goodUp: false })}
    ${stat('Protocolados no mês', d.producao?.protocolados_mes ?? 0, 'producao', { color: 'var(--green)' })}
  </div>`;

  // Painel que se dimensiona pelo conteúdo (não estica p/ igualar) + corpo rolável
  const painel = (titulo, count, route, inner, vazio) =>
    `<div class="dash-panel">
      <div class="dash-panel-h">
        <strong>${titulo}${count != null ? ` <span class="muted">(${count})</span>` : ''}</strong>
        <button class="btn-sm" ${go(route)}>Abrir →</button>
      </div>
      <div class="dash-panel-b">${inner || `<div class="empty" style="padding:22px 16px">${vazio}</div>`}</div>
    </div>`;

  const row = (esquerda, direita, route, sub) =>
    `<div class="mini-row" ${go(route)} style="padding:10px 16px;border-bottom:1px solid var(--border-soft)">
      <span>${esquerda}${sub ? `<br><small style="color:var(--text-muted)">${sub}</small>` : ''}</span>
      <span style="white-space:nowrap">${direita}</span></div>`;

  // Prazos críticos (72h)
  const prazosHtml = (d.prazos || []).map((p) => {
    const venc = Number(p.vencido) === 1;
    const dias = venc ? 'VENCIDO' : (p.days_remaining <= 0 ? 'hoje' : `${p.days_remaining}d`);
    const cor = venc ? 'var(--red)' : (p.days_remaining <= 1 ? 'var(--amber)' : 'var(--text-muted)');
    return row(esc(p.description || 'Prazo'), `<strong style="color:${cor}">${dias}</strong>`, 'prazos',
      `${esc(p.client_name || '')}${p.case_number ? ' · ' + esc(p.case_number) : ''} · ${fmtDate(p.deadline_date)}`);
  }).join('');

  // Intimações a confirmar
  const intim = d.intimacoes || { count: 0, itens: [] };
  const intimHtml = (intim.itens || []).map((i) =>
    row(esc(i.client_name || 'A vincular'),
        `<span class="badge">${esc(i.suggested_type || '—')}</span>${Number(i.tem_minuta) === 1 ? ' ' + svgIcon('edit', 'ic-xs') : ''}`,
        'prazos',
        `${i.process_number ? 'proc. ' + esc(i.process_number) + ' · ' : ''}movimentação ${fmtDate(i.movement_date || i.start_date)}`)
  ).join('');

  // Alertas (verificar)
  const al = d.alertas || { count: 0, itens: [] };
  const alHtml = (al.itens || []).map((a) =>
    row(esc(a.title || a.detected_keyword || 'Movimentação'), `<span class="badge">verificar</span>`, 'monitor',
        a.process_number ? 'proc. ' + esc(a.process_number) : '')
  ).join('');

  // Agenda de hoje
  const agHtml = (d.agenda_hoje || []).map((e) =>
    row(esc(e.title || 'Evento'),
        `<strong>${new Date(e.start_datetime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong>`,
        'agenda',
        `${esc(e.event_type || '')}${e.client_name ? ' · ' + esc(e.client_name) : ''}`)
  ).join('');

  c.innerHTML = `
    ${kpis}
    <div class="cockpit-panels">
      ${painel(`${svgIcon('clock', 'ic-t')}Prazos críticos (72h)`, (d.prazos || []).length, 'prazos', prazosHtml, 'Nenhum prazo crítico. 👏')}
      ${painel(`${svgIcon('file', 'ic-t')}Intimações a confirmar`, intim.count, 'prazos', intimHtml, 'Nada a confirmar.')}
      ${painel(`${svgIcon('alert', 'ic-t')}Movimentações a verificar`, al.count, 'monitor', alHtml, 'Sem alertas pendentes.')}
      ${painel(`${svgIcon('calendar', 'ic-t')}Agenda de hoje`, (d.agenda_hoje || []).length, 'agenda', agHtml, 'Nada agendado para hoje.')}
    </div>`;
}

async function dashComercial(c) {
  const d = await api('/api/dashboards/comercial');
  const byStatus = Object.fromEntries((d.leads_por_status || []).map((s) => [s.status, s.total]));
  const maxFunnel = Math.max(1, ...FUNNEL_ORDER.map((k) => byStatus[k] || 0));
  const funnelHTML = FUNNEL_ORDER.map((k) => {
    const n = byStatus[k] || 0;
    return `<div class="funnel-row"><span class="funnel-label">${LEAD_STATUS_PT[k]}</span>
      <div class="funnel-bar"><div class="funnel-fill" style="width:${Math.round((n / maxFunnel) * 100)}%"></div></div>
      <strong class="funnel-num">${n}</strong></div>`;
  }).join('');
  c.innerHTML = `
    <div class="kpi-grid">
      ${kpi('Leads hoje', d.leads_hoje)}${kpi('Total de leads', d.leads_total)}
      ${kpi('Taxa de conversão', d.taxa_conversao)}${kpi('Ticket médio', money(d.ticket_medio), 'money')}
      ${kpi('Receita prevista', money(d.receita_prevista), 'money')}${kpi('Receita fechada', money(d.receita_fechada), 'money')}
      ${kpi('Pipeline estimado', money(d.pipeline_estimado), 'money')}${kpi('Reuniões marcadas', d.reunioes_marcadas)}
    </div>
    <div class="card" style="margin-bottom:20px;padding:18px"><strong style="color:var(--navy)">Funil comercial</strong>
      <div class="funnel" style="margin-top:12px">${funnelHTML}</div></div>
    <div class="dash-2col">
      ${chartCard('Leads por origem', chartHBars((d.por_origem || []).map((r) => ({ label: r.origem, value: r.total }))))}
      ${chartCard('Leads por área jurídica', chartHBars((d.por_area || []).map((r) => ({ label: r.area, value: r.total }))))}
    </div>`;
}

async function dashMonitoramento(c) {
  const d = await api('/api/dashboards/monitoramento');
  const k = d.kpi || {};
  const meses = d.movimentacoes_por_mes || [];
  const maxM = Math.max(1, ...meses.map((m) => Number(m.total)));
  const mesLabel = (ym) => { const [y, m] = ym.split('-'); return ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(m) - 1] + '/' + y.slice(2); };
  const chart = meses.length ? `<div class="card" style="padding:14px 18px;margin-bottom:16px">
      <strong style="color:var(--navy)">Movimentações por mês</strong>
      <div style="display:flex;align-items:flex-end;gap:10px;height:120px;margin-top:14px">${meses.map((m) => `
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;justify-content:flex-end;height:100%">
          <strong style="font-size:12px">${m.total}</strong>
          <div title="${m.total}" style="width:100%;max-width:46px;height:${Math.max(4, Math.round((m.total / maxM) * 86))}px;background:linear-gradient(180deg,var(--gold),#B8943F);border-radius:6px 6px 0 0"></div>
          <small style="color:var(--text-muted)">${mesLabel(m.mes)}</small>
        </div>`).join('')}</div></div>` : '';
  c.innerHTML = `
    <div class="kpi-grid">
      ${kpi('Processos monitorados', k.total)}${kpi('Com movimentação (30d)', k.com_mov_30d)}
      ${kpi('Movimentações', k.movimentacoes)}${kpi('Tribunais', k.tribunais)}
      ${kpi('Clientes vinculados', k.clientes)}${kpi('Prazos a confirmar', k.prazos_pendentes)}
    </div>
    ${chart}
    <div class="dash-2col">
      ${chartCard('Tipos de caso', chartHBars((d.por_tipo || []).map((t) => ({ label: t.tipo, value: t.total }))))}
      ${chartCard('Processos por tribunal', chartHBars((d.por_tribunal || []).map((t) => ({ label: t.court, value: t.total })), { color: 'var(--navy)' }))}
    </div>
    ${miniList('Movimentações recentes', (d.recentes || []).map((m) => `<div class="mini-row"><span>${(m.title || '').slice(0, 64)}<br><small>${m.client_name || m.process_number || ''}${m.court ? ' · ' + m.court : ''}</small></span><small>${fmtDate(m.movement_date)}</small></div>`))}
    ${miniList('Processos com atualização recente', (d.top_processos || []).map((p) => `<div class="mini-row"><span>${p.process_number}<br><small>${p.client_name || '—'} · ${p.movs} mov.</small></span><small>${p.last_movement_at ? fmtDate(p.last_movement_at) : '—'}</small></div>`))}`;
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
  const [s, d, i, series] = await Promise.all([
    api('/api/financial/summary'),
    api('/api/dashboards/financeiro'),
    api('/api/financial/inteligencia').catch(() => null),
    api('/api/metrics/series?days=30').catch(() => ({})),
  ]);
  const serieF = (k) => ((series && series[k]) || []).map((p) => p.value);
  const statF = (label, value, key, color, goodUp = true) => {
    const sp = serieF(key), spark = sp.length > 1 ? sparkline(sp, { color: color || 'var(--gold)' }) : '';
    const delta = deltaBadge(sp, goodUp);
    return `<div class="kpi"><div class="label">${label}</div><div class="value money">${money(value)}</div>${delta}${spark}</div>`;
  };

  const corSaldo = (v) => v < 0 ? 'var(--red)' : 'var(--green)';
  let inteligencia = '';
  if (i) {
    const proj = (i.projecao || []).map((p) => `
      <div class="card" style="padding:14px 16px;flex:1;min-width:200px">
        <div style="font-size:12px;color:var(--text-muted)">Próximos ${p.dias} dias</div>
        <div style="font-size:18px;font-weight:700;color:${corSaldo(p.saldo)};margin:4px 0">${money(p.saldo)}</div>
        <div style="font-size:12px;color:var(--text-muted)">entra ${money(p.entradas)} · sai ${money(p.saidas)}</div>
      </div>`).join('');
    const dre = i.dre || { mes: {}, ano: {} };
    const ina = i.inadimplencia || {};
    const dreRow = (rot, o) => `<div class="mini-row"><span>${rot}</span>
      <span>${money(o.receitas)} <small style="color:var(--red)">- ${money(o.despesas)}</small> =
      <strong style="color:${corSaldo(o.resultado)}">${money(o.resultado)}</strong></span></div>`;
    inteligencia = `
      <h3 style="color:var(--navy);margin:22px 0 10px">${svgIcon('chart', 'ic-t')}Inteligência financeira</h3>
      <p class="sub" style="margin:-6px 0 12px">Projeção de caixa (saldo previsto acumulado por janela)</p>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px">${proj}</div>
      ${miniList('DRE — resultado realizado', dreRow('Mês atual', dre.mes) + dreRow('Ano', dre.ano))}
      ${miniList('Inadimplência por atraso (aging)', `
        <div class="mini-row"><span>Até 30 dias</span><strong>${money(ina.ate_30)}</strong></div>
        <div class="mini-row"><span>31 a 60 dias</span><strong>${money(ina.de_31_60)}</strong></div>
        <div class="mini-row"><span>Mais de 60 dias</span><strong style="color:var(--red)">${money(ina.mais_60)}</strong></div>
        <div class="mini-row"><span><strong>Total vencido</strong></span><strong style="color:var(--red)">${money(ina.total)}</strong></div>`)}`;
  }

  c.innerHTML = `
    <div class="kpi-grid">
      ${statF('Receita prevista', s.receita_prevista, 'receita_prevista', 'var(--green)', true)}${statF('Receita realizada', s.receita_realizada, 'receita_realizada', 'var(--green)', true)}
      ${statF('Despesa prevista', s.despesa_prevista, 'despesa_prevista', 'var(--red)', false)}${statF('Despesa paga', s.despesa_paga, 'despesa_paga', 'var(--red)', false)}
      ${statF('Saldo previsto', s.saldo_previsto, 'saldo_previsto', 'var(--gold)', true)}${statF('Saldo realizado', s.saldo_realizado, 'saldo_realizado', 'var(--gold)', true)}
      ${statF('Inadimplência', s.inadimplencia, 'inadimplencia', 'var(--red)', false)}
    </div>
    ${inteligencia}
    ${chartCard('Fluxo mensal — receitas × despesas', chartColumns(
      (d.previsao_mensal || []).slice(0, 8).map((m) => ({ label: monthShort(m.mes), a: m.receitas, b: m.despesas })),
      { aLabel: 'Receitas', bLabel: 'Despesas', aColor: 'var(--green)', bColor: 'var(--red)', fmt: money }))}
    ${chartCard('Resultado por área jurídica', chartHBars(
      (d.resultado_por_area || []).map((a) => ({ label: a.legal_area, value: a.receitas })), { fmt: money }))}`;
}

async function dashProducao(c) {
  // Mede a ESTEIRA REAL (cases.production_stage). Antes lia a tabela legal_pieces,
  // onde nada é inserido — por isso mostrava zero mesmo com a esteira cheia.
  const d = await api('/api/dashboards/producao');
  const k = d.kpis || {};
  const etapas = d.por_etapa || [];
  const parados = d.parados || [];

  c.innerHTML = `
    <div class="kpi-grid">
      ${kpi('Em produção', k.em_producao)}
      ${kpi(`Atrasados (>${k.sla_dias}d)`, k.atrasados, k.atrasados ? 'red' : '')}
      ${kpi('Pendências abertas', k.pendencias, k.pendencias ? 'amber' : '')}
      ${kpi('Protocolados no mês', k.protocolados_mes)}
      ${kpi('Concluídos', k.concluidos)}
    </div>
    ${chartCard('Casos por etapa da esteira', chartHBars(etapas.map((e) => ({ label: e.etapa, value: e.total }))))}
    ${chartCard('Produtividade — protocolados por responsável (90 dias)',
      (d.produtividade || []).length
        ? chartHBars(d.produtividade.map((r) => ({ label: r.responsavel, value: Number(r.protocolados) })))
        : '<div class="empty">Nenhum caso protocolado nos últimos 90 dias.</div>')}
    ${miniList(`Parados há mais tempo (é aqui que a produção trava)`, parados.length
      ? parados.map((p) => `<div class="mini-row" style="cursor:pointer" data-caso="${p.id}">
          <span><strong>${esc(p.client_name || 'sem cliente')}</strong> — ${esc(p.title || '')}
            <br><small style="color:var(--text-muted)">${esc(p.production_stage || '')}${Number(p.pendencias) ? ` · ⚠ ${p.pendencias} pendência(s)` : ''}</small></span>
          <strong style="color:${Number(p.dias) > k.sla_dias ? 'var(--red)' : 'var(--text-muted)'}">${p.dias}d</strong>
        </div>`)
      : ['<div class="mini-row"><span>Nenhum caso parado na esteira.</span></div>'])}`;

  c.querySelectorAll('[data-caso]').forEach((el) => {
    el.onclick = () => caseDetail(el.dataset.caso, () => dashProducao(c));
  });
}

// ── Dashboard: relatório mensal da parceria (protocolados) ───────────────────
async function dashParceriaMensal(c) {
  const d = await api('/api/dashboards/parceria-mensal');
  const meses = d.meses || [];
  const rows = d.rows || [];
  if (!meses.length) { c.innerHTML = '<div class="empty">Nenhum caso de parceria protocolado ainda. Ao mover um card para “Protocolado”, ele passa a constar aqui.</div>'; return; }

  const mesLabel = (m) => {
    const [y, mm] = m.split('-');
    const nomes = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    return `${nomes[Number(mm)] || mm}/${y}`;
  };

  c.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px">
      <div style="display:flex;gap:8px;align-items:center"><label style="font-size:13px;color:var(--text-muted)">Mês (por data de protocolo)</label>
        <select id="pm-mes">${meses.map((m) => `<option value="${m.mes}">${mesLabel(m.mes)}</option>`).join('')}</select></div>
      <button class="btn-sm" id="pm-csv" type="button">${svgIcon('download')} Exportar CSV do mês</button>
    </div>
    <div id="pm-kpis" class="kpi-grid"></div>
    <div id="pm-tabela"></div>`;

  const render = (mes) => {
    const info = meses.find((m) => m.mes === mes) || { casos: 0, clientes: 0, valor_causa: 0, entrada: 0 };
    const lista = rows.filter((r) => r.mes === mes);
    $('#pm-kpis').innerHTML =
      kpi('Casos protocolados', info.casos) +
      kpi('Clientes', info.clientes) +
      kpi('Valor da causa (soma)', money(info.valor_causa), 'money') +
      kpi('Entrada lançada', money(info.entrada), 'money');
    $('#pm-tabela').innerHTML = `
      <table class="tbl" style="width:100%;margin-top:6px">
        <thead><tr><th>Data</th><th>Cliente</th><th>Caso</th><th>Área</th><th>Nº processo</th><th>Parceiro</th><th style="text-align:right">Valor da causa</th></tr></thead>
        <tbody>${lista.map((r) => `<tr>
          <td>${fmtDate(r.protocoled_at)}</td>
          <td><strong>${esc(r.client_name || '—')}</strong></td>
          <td>${esc(r.title || '—')}</td>
          <td>${esc(r.legal_area || '—')}</td>
          <td>${esc(r.case_number || '—')}</td>
          <td>${esc(r.partner_name || '—')}</td>
          <td style="text-align:right">${r.valor_causa ? money(r.valor_causa) : '—'}</td>
        </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">Nenhum caso neste mês</td></tr>'}</tbody>
      </table>`;
  };

  const csv = (mes) => {
    const lista = rows.filter((r) => r.mes === mes);
    const head = ['Data', 'Cliente', 'Caso', 'Área', 'Nº processo', 'Parceiro', 'Valor da causa'];
    const esc2 = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const linhas = lista.map((r) => [fmtDate(r.protocoled_at), r.client_name, r.title, r.legal_area, r.case_number, r.partner_name, r.valor_causa || ''].map(esc2).join(';'));
    const blob = new Blob(['﻿' + [head.map(esc2).join(';'), ...linhas].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `parceria-protocolados-${mes}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  const sel = $('#pm-mes');
  sel.onchange = () => render(sel.value);
  $('#pm-csv').onclick = () => csv(sel.value);
  render(meses[0].mes);
}

// ── Forms ──
// ── Financeiro avançado (abas) ───────────────────────────────────────────────
async function finVisaoGeral(c) {
  const s = await api('/api/financial/summary');
  const proj = await api('/api/dashboards/financeiro/projecao-mes');
  const [cx, origem, os] = await Promise.all([
    api('/api/financial/projecao').catch(() => null),
    api('/api/financial/receita-origem').catch(() => null),
    api('/api/office-settings').catch(() => ({})),
  ]);
  const meta = Number(os.meta_faturamento_mes) || 0;
  const recebidoMes = Number(proj.entrada_realizado) || 0;
  const pctMeta = meta ? Math.min(100, Math.round((recebidoMes / meta) * 100)) : 0;
  const metaHtml = meta ? `
    <div class="card" style="padding:16px 18px;margin:14px 0">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;align-items:baseline">
        <strong style="color:var(--navy)">Meta do mês</strong>
        <span style="font-size:13px">${money(recebidoMes)} de ${money(meta)} · <strong style="color:${pctMeta >= 100 ? 'var(--green)' : 'var(--navy-deep)'}">${pctMeta}%</strong>${pctMeta >= 100 ? ' 🎉' : ''}</span>
      </div>
      <div style="height:10px;background:var(--surface);border:1px solid var(--border);border-radius:6px;margin-top:10px;overflow:hidden">
        <div style="height:100%;width:${pctMeta}%;background:${pctMeta >= 100 ? 'var(--green)' : 'var(--gold)'};transition:width .4s"></div>
      </div>
    </div>` : '';
  const cxHtml = cx ? `
    <h3 style="color:var(--navy);margin:20px 0 8px">Fluxo projetado — próximos 90 dias</h3>
    <div class="kpi-grid">
      ${kpi('Saldo 0–30 dias', money(cx.d30.saldo), 'money')}
      ${kpi('Saldo 31–60 dias', money(cx.d60.saldo), 'money')}
      ${kpi('Saldo 61–90 dias', money(cx.d90.saldo), 'money')}
      ${kpi('Acumulado 90 dias', money(cx.acumulado.d90), 'money')}
    </div>
    <p class="sub" style="font-size:12px;margin-top:4px">Entradas previstas (parcelas + receitas) menos saídas previstas (despesas + repasses), por janela.</p>` : '';
  const origemHtml = origem && (origem.por_area.length || origem.por_parceiro.length) ? `
    <h3 style="color:var(--navy);margin:20px 0 8px">Receita recebida no mês — por origem</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">
      <div class="card" style="padding:14px 18px"><strong style="font-size:13px;color:var(--navy)">Por área</strong>
        ${origem.por_area.map((a) => `<div class="mini-row"><span>${esc(AREA_LABELS[a.area] || a.area)}</span><strong>${money(a.total)}</strong></div>`).join('') || '<div class="empty" style="padding:10px">Nada recebido ainda</div>'}</div>
      <div class="card" style="padding:14px 18px"><strong style="font-size:13px;color:var(--navy)">Por parceria (recebido · repassado)</strong>
        ${origem.por_parceiro.map((p) => `<div class="mini-row"><span>${esc(p.parceiro)}</span><span><strong>${money(p.recebido)}</strong> <small style="color:var(--text-muted)">· ${money(p.repassado)}</small></span></div>`).join('') || '<div class="empty" style="padding:10px">Sem parcerias no mês</div>'}</div>
    </div>` : '';
  c.innerHTML = `
    <div style="display:flex;justify-content:flex-end;gap:8px;margin:8px 0"><button class="btn-ghost" id="fin-dre">Relatório do contador (mês)</button><button class="btn-gold" id="new-fin">+ Lançamento</button></div>
    <h3 style="color:var(--navy);margin:16px 0 8px">Resumo Geral</h3>
    <div class="kpi-grid">
      ${kpi('Receita prevista', money(s.receita_prevista), 'money')}
      ${kpi('Receita realizada', money(s.receita_realizada), 'money')}
      ${kpi('Despesa prevista', money(s.despesa_prevista), 'money')}
      ${kpi('Despesa paga', money(s.despesa_paga), 'money')}
      ${kpi('Saldo previsto', money(s.saldo_previsto), 'money')}
      ${kpi('Saldo realizado', money(s.saldo_realizado), 'money')}
      ${kpi('Inadimplência', money(s.inadimplencia), 'money')}
    </div>
    <h3 style="color:var(--navy);margin:20px 0 8px">${svgIcon('chart','ic-title')}Projeção do Mês (${proj.mes})</h3>
    <div class="kpi-grid">
      ${kpi('✅ Entradas recebidas', money(proj.entrada_realizado), 'money', proj.entrada_realizado > 0 ? 'var(--green)' : '')}
      ${kpi('📍 A receber', money(proj.entrada_previsto), 'money', proj.entrada_previsto > 0 ? 'var(--orange)' : '')}
      ${kpi('💰 Saídas pagas', money(proj.saida_realizado), 'money', 'var(--red)')}
      ${kpi('⏳ A pagar', money(proj.saida_previsto), 'money', 'var(--orange)')}
      ${kpi('Saldo realizado', money(proj.saldo_realizado), 'money', proj.saldo_realizado > 0 ? 'var(--green)' : 'var(--red)')}
      ${kpi('Saldo previsto', money(proj.saldo_previsto), 'money', proj.saldo_previsto > 0 ? 'var(--green)' : 'var(--red)')}
    </div>
    ${metaHtml}
    ${cxHtml}
    ${origemHtml}
    <div class="card" style="margin:20px 0"><div style="padding:14px 18px;border-bottom:1px solid var(--border)"><strong style="color:var(--navy)">Lançamentos</strong></div><div id="fin-table"></div></div>
    <div class="card"><div style="padding:14px 18px;border-bottom:1px solid var(--border)"><strong style="color:var(--navy)">Parcelas a receber</strong></div><div id="inst-table"></div></div>`;
  const loadFin = async () => {
    const r = await api('/api/financial');
    $('#fin-table').innerHTML = r.data.length ? `
      <table><thead><tr><th>Descrição</th><th>Tipo</th><th>Valor</th><th>Vencimento</th><th>Status</th><th></th></tr></thead>
      <tbody>${r.data.map((f) => `<tr>
        <td><strong>${f.description}</strong>${f.cost_center ? `<br><small style="color:var(--text-muted)">${f.cost_center}</small>` : ''}</td>
        <td>${f.tipo === 'receita' ? 'Receita' : 'Despesa'}</td>
        <td>${money(f.valor)}</td><td>${fmtDate(f.due_date)}</td><td>${badge(f.status)}</td>
        <td>${f.status === 'pendente' ? `<button class="btn-sm" data-pay-fin="${f.id}">Dar baixa</button>` : ''}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Nenhum lançamento</div>';
    document.querySelectorAll('[data-pay-fin]').forEach((b) => b.onclick = async () => {
      try { await api(`/api/financial/${b.dataset.payFin}/pay`, { method: 'PATCH' }); toast('Baixa registrada'); finVisaoGeral(c); } catch (e) { toast(e.message, 'error'); }
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
      try { await api(`/api/financial/installments/${b.dataset.payInst}/pay`, { method: 'PATCH' }); toast('Parcela recebida'); finVisaoGeral(c); } catch (e) { toast(e.message, 'error'); }
    });
  };
  $('#new-fin').onclick = () => financialForm(() => finVisaoGeral(c));

  // Relatório do contador — DRE simplificada do mês (imprimir → salvar como PDF)
  $('#fin-dre').onclick = async () => {
    const mes = prompt('Mês do fechamento (AAAA-MM):', new Date().toISOString().slice(0, 7));
    if (!mes) return;
    try {
      const d = await api('/api/financial/dre?month=' + encodeURIComponent(mes.trim()));
      const linha = (t, v, forte) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${t}</td><td style="padding:6px 8px;text-align:right;border-bottom:1px solid #eee;${forte ? 'font-weight:700' : ''}">${money(v)}</td></tr>`;
      printBranded(`Fechamento financeiro — ${d.month}`, 'Demonstrativo simplificado (regime de caixa)', `
        <h3 style="margin:14px 0 4px">Receitas recebidas</h3>
        <table style="width:100%;border-collapse:collapse">
          ${linha('Parcelas de contratos', d.receitas.parcelas_contratos)}
          ${linha('Entradas de parceria', d.receitas.entradas_parceria)}
          ${linha('Demais receitas', d.receitas.demais_receitas)}
          ${linha('Total de receitas', d.receita_total, 1)}
        </table>
        <h3 style="margin:16px 0 4px">Despesas pagas</h3>
        <table style="width:100%;border-collapse:collapse">
          ${d.despesas.map((x) => linha(esc(x.categoria), x.total)).join('') || linha('—', 0)}
          ${linha('Total de despesas', d.despesa_total, 1)}
        </table>
        <h3 style="margin:16px 0 4px">Repasses a parceiros</h3>
        <table style="width:100%;border-collapse:collapse">${linha('Repasses pagos no mês', d.repasses_pagos, 1)}</table>
        <div style="margin-top:18px;padding:12px 14px;border:2px solid #0d1b2e;border-radius:8px;display:flex;justify-content:space-between;font-size:16px">
          <strong>RESULTADO DO MÊS</strong><strong style="color:${d.resultado >= 0 ? '#1c7a3d' : '#c0392b'}">${money(d.resultado)}</strong>
        </div>
        <p style="color:#777;font-size:12px;margin-top:12px">Regime de caixa (o que efetivamente entrou e saiu no mês). Use "Imprimir → Salvar como PDF" para enviar ao contador.</p>`);
    } catch (e) { toast(e.message, 'error'); }
  };
  await loadFin(); await loadInst();
}

async function finAcordos(c) {
  c.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin:8px 0"><button class="btn-gold" id="new-acordo">+ Novo acordo</button></div>
    <div class="card"><div id="acordo-table"></div></div>`;
  const load = async () => {
    const r = await api('/api/acordos');
    $('#acordo-table').innerHTML = r.data.length ? `
      <table><thead><tr><th>Parte contrária</th><th>Cliente</th><th>Valor</th><th>Honorário</th><th>Status</th><th></th></tr></thead>
      <tbody>${r.data.map((a) => {
        const acoes = [];
        if (a.status === 'Proposto') acoes.push(`<button class="btn-sm" data-acd-sign="${a.id}">Assinar</button>`);
        if (['Aceito','Homologado','Em pagamento'].includes(a.status)) acoes.push(`<button class="btn-sm" data-acd-close="${a.id}">Encerrar</button>`);
        if (!['Quitado','Descumprido'].includes(a.status)) acoes.push(`<button class="btn-sm" data-acd-cancel="${a.id}">Cancelar</button>`);
        return `<tr>
          <td><strong>${a.opposing_party}</strong>${a.process_number ? `<br><small style="color:var(--text-muted)">${a.process_number}</small>` : ''}</td>
          <td>${a.client_name || '—'}</td><td>${money(a.total_agreement_value)}</td>
          <td>${money(a.honorarium_value)} <small>(${a.honorarium_percentage}%)</small></td>
          <td>${badge(a.status)}</td><td style="white-space:nowrap">${acoes.join(' ')}</td></tr>`;
      }).join('')}</tbody></table>`
      : '<div class="empty">Nenhum acordo cadastrado</div>';
    const act = (sel, path, msg) => document.querySelectorAll(sel).forEach((b) => b.onclick = async () => {
      const id = b.dataset.acdSign || b.dataset.acdClose || b.dataset.acdCancel;
      try { await api(`/api/acordos/${id}/${path}`, { method: 'POST', body: '{}' }); toast(msg); load(); } catch (e) { toast(e.message, 'error'); }
    });
    act('[data-acd-sign]', 'assinar', 'Acordo assinado');
    act('[data-acd-close]', 'encerrar', 'Acordo encerrado');
    act('[data-acd-cancel]', 'cancelar', 'Acordo cancelado');
  };
  $('#new-acordo').onclick = () => acordoForm(load);
  await load();
}

async function finReceitas(c) {
  c.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <div><h3 style="color:var(--navy);margin:0">${svgIcon('banknote','ic-title')}Receitas & Parcelas</h3></div>
      <div style="display:flex;gap:8px"><button class="btn-gold btn-sm" id="new-receita">+ Nova receita</button><button class="btn-sm" id="print-receitas">${svgIcon('printer')} Imprimir</button><button class="btn-sm" id="export-receitas">${svgIcon('chart')} Exportar CSV</button></div>
    </div>

    <div class="form-section" style="margin-bottom:16px">
      <div class="section-header">${svgIcon('search', 'ic-inline')} Filtros</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
        <label>Status
          <select id="rec-filter-status"><option value="">Todos</option><option value="pendente">Pendente</option><option value="recebido">Recebido</option><option value="vencido">Vencido</option></select>
        </label>
        <label>Tipo
          <select id="rec-filter-tipo"><option value="">Todos</option><option value="receita">Receita</option><option value="parcela">Parcela</option><option value="audiencia">Audiência</option></select>
        </label>
        <label>Cliente
          <select id="rec-filter-cliente"><option value="">Todos</option><option id="rec-clients" disabled>Carregando...</option></select>
        </label>
        <label>Data de
          <input type="date" id="rec-filter-date-from" />
        </label>
        <label>até
          <input type="date" id="rec-filter-date-to" />
        </label>
      </div>
    </div>

    <div class="kpi-grid" id="rec-kpis" style="margin-bottom:16px"></div>

    <div class="card"><div id="receita-consolidada"></div></div>`;

  const loadClients = async () => {
    const clients = await api('/api/clients?limit=200').catch(() => ({ data: [] }));
    const sel = $('#rec-filter-cliente');
    sel.innerHTML = '<option value="">Todos</option>' + clients.data.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  };

  const loadKpis = async () => {
    const r = await api('/api/receitas').catch(() => ({ data: [] }));
    const inst = await api('/api/financial/installments').catch(() => []);
    const aud = await api('/api/correspondente').catch(() => []);
    const totalVal = r.data.reduce((a, x) => a + (x.valor || 0), 0) + inst.reduce((a, x) => a + (x.valor || 0), 0) + aud.reduce((a, x) => a + (x.value || 0), 0);
    const recebido = r.data.filter((x) => x.status === 'recebido').reduce((a, x) => a + (x.valor || 0), 0) + aud.filter((x) => x.status === 'paga').reduce((a, x) => a + (x.value || 0), 0);
    const aReceber = totalVal - recebido;
    const vencido = r.data.filter((x) => x.status === 'vencido').reduce((a, x) => a + (x.valor || 0), 0);
    $('#rec-kpis').innerHTML = kpi('💰 Total programado', money(totalVal), 'money') + kpi('✅ Já recebido', money(recebido), 'money', 'var(--green)') + kpi('📍 A receber', money(aReceber), 'money', 'var(--orange)') + kpi('⚠️ Vencido', money(vencido), 'money', 'var(--red)');
  };

  const load = async () => {
    const r = await api('/api/receitas').catch(() => ({ data: [] }));
    const inst = await api('/api/financial/installments').catch(() => []);
    const aud = await api('/api/correspondente').catch(() => []);

    const status = $('#rec-filter-status').value;
    const tipo = $('#rec-filter-tipo').value;
    const cliente = $('#rec-filter-cliente').value;
    const dateFrom = $('#rec-filter-date-from').value;
    const dateTo = $('#rec-filter-date-to').value;

    let receitas = r.data.map((x) => ({ ...x, tipo_: 'receita', descricao: x.descricao, cliente: x.client_name, valor: x.valor, vencimento: x.data_vencimento, status: x.status }));
    let parcelas = inst.map((x) => ({ ...x, tipo_: 'parcela', descricao: `${x.numero}ª parcela — ${x.proposta_title || ''}`, cliente: x.client_name, valor: x.valor, vencimento: x.due_date, status: x.status === 'pago' ? 'recebido' : 'pendente' }));
    let audiencias = aud.map((x) => ({ ...x, tipo_: 'audiencia', descricao: `Audiência — ${x.payer_name} (${x.process_number || '—'})`, cliente: '—', valor: x.value, vencimento: x.due_date, status: x.status === 'paga' ? 'recebido' : 'pendente' }));

    let all = [...receitas, ...parcelas, ...audiencias];
    if (status) all = all.filter((x) => x.status === status || (status === 'vencido' && new Date(x.vencimento) < new Date()));
    if (tipo) all = all.filter((x) => x.tipo_ === tipo);
    if (cliente) all = all.filter((x) => x.cliente_id === Number(cliente) || (x.client_id === Number(cliente)));
    if (dateFrom) all = all.filter((x) => new Date(x.vencimento) >= new Date(dateFrom));
    if (dateTo) all = all.filter((x) => new Date(x.vencimento) <= new Date(dateTo));

    const html = all.length ? `
      <table><thead><tr><th>Tipo</th><th>Descrição</th><th>Cliente</th><th>Valor</th><th>Vencimento</th><th>Status</th><th></th></tr></thead>
      <tbody>${all.map((x) => `<tr>
        <td><span style="font-weight:700;color:var(--gold)">${x.tipo_ === 'receita' ? '📄' : x.tipo_ === 'parcela' ? '📊' : '🎤'} ${x.tipo_.toUpperCase()}</span></td>
        <td><strong>${esc(x.descricao)}</strong></td>
        <td>${esc(x.cliente || '—')}</td>
        <td>${money(x.valor)}</td>
        <td>${fmtDate(x.vencimento)}</td>
        <td>${badge(x.status)}</td>
        <td><button class="btn-sm" data-pay-all="${x.id}-${x.tipo_}">Receber</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nenhum registro com esses filtros</div>';
    $('#receita-consolidada').innerHTML = html;

    document.querySelectorAll('[data-pay-all]').forEach((b) => b.onclick = async () => {
      const [id, tp] = b.dataset.payAll.split('-');
      try {
        if (tp === 'receita') await api(`/api/receitas/${id}/pay`, { method: 'PATCH' });
        else if (tp === 'parcela') await api(`/api/financial/installments/${id}/pay`, { method: 'PATCH' });
        toast('Recebimento registrado'); load();
      } catch (e) { toast(e.message, 'error'); }
    });

    await loadKpis();
  };

  $('#rec-filter-status').onchange = load;
  $('#rec-filter-tipo').onchange = load;
  $('#rec-filter-cliente').onchange = load;
  $('#rec-filter-date-from').onchange = load;
  $('#rec-filter-date-to').onchange = load;
  $('#print-receitas').onclick = () => window.print();
  $('#export-receitas').onclick = async () => { toast('Exportar em desenvolvimento'); };
  $('#new-receita').onclick = () => receitaForm(load);

  await loadClients();
  await load();
}

async function finRepasses(c) {
  c.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin:8px 0"><button class="btn-gold" id="new-repasse">+ Novo repasse</button></div>
    <div class="card"><div id="repasse-table"></div></div>`;
  const load = async () => {
    const r = await api('/api/repasses');
    $('#repasse-table').innerHTML = r.data.length ? `
      <table><thead><tr><th>Parceiro</th><th>Processo</th><th>Tipo</th><th>Valor</th><th>Vencimento</th><th>Status</th><th></th></tr></thead>
      <tbody>${r.data.map((rp) => {
        const acoes = [];
        if (rp.status === 'pendente' || rp.status === 'processando') acoes.push(`<button class="btn-sm" data-rep-pay="${rp.id}">Repassar</button>`);
        if (rp.status !== 'repassado' && rp.status !== 'cancelado') acoes.push(`<button class="btn-sm" data-rep-cancel="${rp.id}">Cancelar</button>`);
        return `<tr>
          <td><strong>${rp.parceiro}</strong></td><td>${rp.case_title || '—'}</td><td>${rp.tipo}</td>
          <td>${money(rp.valor)}</td><td>${fmtDate(rp.data_vencimento)}</td><td>${badge(rp.status)}</td>
          <td style="white-space:nowrap">${acoes.join(' ')}</td></tr>`;
      }).join('')}</tbody></table>`
      : '<div class="empty">Nenhum repasse cadastrado</div>';
    document.querySelectorAll('[data-rep-pay]').forEach((b) => b.onclick = async () => {
      const comp = prompt('Link do comprovante (Drive/banco) — o parceiro vê no portal. Deixe vazio para pular:');
      if (comp === null) return;
      try {
        await api(`/api/repasses/${b.dataset.repPay}/repassar`, { method: 'POST', body: JSON.stringify(comp && comp.trim() ? { comprovante_url: comp.trim() } : {}) });
        toast('Repasse efetuado'); load();
      } catch (e) { toast(e.message, 'error'); }
    });
    document.querySelectorAll('[data-rep-cancel]').forEach((b) => b.onclick = async () => {
      try { await api(`/api/repasses/${b.dataset.repCancel}/cancelar`, { method: 'POST', body: '{}' }); toast('Repasse cancelado'); load(); } catch (e) { toast(e.message, 'error'); }
    });
  };
  $('#new-repasse').onclick = () => repasseForm(load);
  await load();
}

async function finInadimplencia(c) {
  c.innerHTML = `
    <div style="display:flex;justify-content:flex-end;gap:8px;margin:8px 0"><button class="btn-ghost" id="renegociar-btn">Renegociar parcelas</button><button class="btn-gold" id="recalc-inad">Recalcular agora</button></div>
    <div class="card"><div id="inad-table"></div></div>`;

  // Renegociação: parcelas em aberto de um cliente viram um novo parcelamento
  $('#renegociar-btn').onclick = async () => {
    const clients = await api('/api/clients?limit=100').catch(() => ({ data: [] }));
    const form = el(`<form class="form-grid">
      ${field('Cliente *', 'client_id', { options: [{ v: '', t: '— escolha —' }, ...clients.data.map((x) => ({ v: x.id, t: x.name }))] })}
      <div id="ren-parcelas"><small style="color:var(--text-muted)">Escolha o cliente para listar as parcelas em aberto.</small></div>
      <div class="form-row">${field('Nº de novas parcelas *', 'num_parcelas', { type: 'number', value: 3 })}${field('1ª parcela vence em *', 'primeira_data', { type: 'date' })}</div>
      ${field('Valor total do acordo (R$) — vazio mantém a soma original', 'valor_total', { type: 'number' })}
      <button type="submit" class="btn-primary">Fechar acordo</button>
    </form>`);
    const sel = form.querySelector('[name=client_id]');
    sel.onchange = async () => {
      const box = form.querySelector('#ren-parcelas');
      if (!sel.value) { box.innerHTML = ''; return; }
      box.innerHTML = '<div class="spinner"></div>';
      const insts = await api(`/api/financial/installments?client_id=${sel.value}`).catch(() => []);
      const abertas = (insts || []).filter((i) => ['pendente', 'vencido', 'em_processamento'].includes(i.status));
      box.innerHTML = abertas.length ? `<strong style="font-size:12px;color:var(--navy)">Parcelas em aberto (marque as que entram no acordo)</strong>
        ${abertas.map((i) => `<label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-top:6px">
          <input type="checkbox" name="inst" value="${i.id}" checked style="width:auto">
          ${i.numero ? i.numero + 'ª' : 'Parcela'} · ${money(i.valor)} · venc. ${fmtDate(i.due_date)} ${badge(i.status)}</label>`).join('')}`
        : '<small style="color:var(--text-muted)">Este cliente não tem parcelas em aberto.</small>';
    };
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const ids = [...form.querySelectorAll('[name=inst]:checked')].map((x) => Number(x.value));
      const b = Object.fromEntries(new FormData(form));
      if (!b.client_id || !ids.length) { toast('Escolha o cliente e ao menos uma parcela', 'error'); return; }
      if (!confirm(`Cancelar ${ids.length} parcela(s) e criar ${b.num_parcelas} nova(s)? O acordo fica registrado na timeline.`)) return;
      try {
        const r = await api('/api/financial/renegociar', { method: 'POST', body: JSON.stringify({
          client_id: b.client_id, installment_ids: ids, num_parcelas: b.num_parcelas,
          primeira_data: b.primeira_data, valor_total: b.valor_total || null }) });
        closeModal(); toast(`Acordo fechado: ${r.canceladas} parcela(s) → ${r.criadas}x (total ${money(r.total)})`); load();
      } catch (e) { toast(e.message, 'error'); }
    };
    openModal('Renegociar parcelas', form);
  };
  const load = async () => {
    const r = await api('/api/inadimplencias');
    $('#inad-table').innerHTML = r.data.length ? `
      <table><thead><tr><th>Cliente</th><th>Parcela</th><th>Dias atraso</th><th>Valor</th><th>Status</th><th>Cobranças</th><th></th></tr></thead>
      <tbody>${r.data.map((i) => `<tr>
        <td><strong>${i.client_name || '—'}</strong></td>
        <td>${i.parcela_numero ? i.parcela_numero + 'ª' : '—'} <small style="color:var(--text-muted)">${i.receita_descricao || ''}</small></td>
        <td>${i.dias_atraso}</td><td>${money(i.valor)}</td><td>${badge(i.status)}</td>
        <td>${i.tentativas_cobranca}</td>
        <td>${i.status !== 'resolvido' ? `<button class="btn-sm" data-inad="${i.id}">Resolver</button>` : ''}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Nenhuma inadimplência registrada</div>';
    document.querySelectorAll('[data-inad]').forEach((b) => b.onclick = async () => {
      try { await api(`/api/inadimplencias/${b.dataset.inad}/resolver`, { method: 'POST', body: '{}' }); toast('Inadimplência resolvida'); load(); } catch (e) { toast(e.message, 'error'); }
    });
  };
  $('#recalc-inad').onclick = async () => {
    const btn = $('#recalc-inad'); btn.disabled = true; btn.textContent = 'Recalculando…';
    try { const r = await api('/api/inadimplencias/recalcular', { method: 'POST', body: '{}' }); toast(`${r.criadas} nova(s), ${r.atualizadas} atualizada(s).`); load(); }
    catch (e) { toast(e.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = 'Recalcular agora'; }
  };
  await load();
}

const GRUPOS_DESPESA = [
  ['empresa', 'Empresa / Escritório'],
  ['pessoal', 'Pessoal'],
  ['cartao', 'Cartão de crédito'],
  ['moradia', 'Moradia'],
  ['impostos', 'Impostos & Tributos'],
  ['salarios', 'Salários & Folha'],
  ['fornecedores', 'Fornecedores'],
  ['software', 'Software & Assinaturas'],
  ['marketing', 'Marketing'],
  ['transporte', 'Transporte & Deslocamento'],
  ['extraordinaria', 'Despesas extraordinárias'],
  ['outro_saida', 'Outras saídas'],
];
const GRUPO_PT = Object.fromEntries(GRUPOS_DESPESA);

async function finContasPagar(c) {
  const now = new Date();
  const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const todayStr = new Date().toISOString().split('T')[0];
  let scope = 'todas';
  let showPagas = false;
  c.innerHTML = `
    <div class="toolbar">
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text-soft)">Mês
        <input type="month" id="cp-month" value="${curYM}"></label>
      <div class="seg-toggle" id="cp-scope" style="margin-top:0;max-width:340px">
        <label class="on"><input type="radio" name="scope" value="todas" checked>Todas</label>
        <label><input type="radio" name="scope" value="empresa">🏢 Empresa</label>
        <label><input type="radio" name="scope" value="pessoal">👤 Pessoal</label>
      </div>
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;white-space:nowrap">
        <input type="checkbox" id="cp-show-pagas"> Ver pagas</label>
      <span class="spacer"></span>
      <button class="btn-sm" id="cp-new-entrada" style="border-color:var(--green);color:var(--green)">+ Registrar entrada</button>
      <button class="btn-gold" id="cp-new">+ Conta a pagar</button>
    </div>
    <div id="cp-kpis" class="kpi-grid"></div>
    <div id="cp-groups"></div>
    <div id="cp-entradas-section" style="margin-top:20px;display:none">
      <div class="card">
        <div style="padding:12px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
          <strong style="color:var(--navy)">Entradas do mês</strong>
          <span id="cp-entradas-total" style="font-weight:600;color:var(--green)"></span>
        </div>
        <div id="cp-entradas-list"></div>
      </div>
    </div>`;

  const load = async () => {
    const ym = $('#cp-month').value || curYM;
    const [y, m] = ym.split('-').map(Number);
    const from = `${ym}-01`;
    const to = `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    const escFilter = scope !== 'todas' ? '&escopo=' + scope : '';
    const [rows, entradas] = await Promise.all([
      api(`/api/cashflow?type=saida&from=${from}&to=${to}${escFilter}`),
      api(`/api/cashflow?type=entrada&from=${from}&to=${to}${escFilter}`).catch(() => []),
    ]);

    const visible = showPagas ? rows : rows.filter((r) => r.status !== 'realizado');

    let total = 0, pago = 0, aberto = 0, vencido = 0;
    rows.forEach((r) => {
      const v = Number(r.amount) || 0; total += v;
      const due = (r.due_date || '').split('T')[0];
      if (r.status === 'realizado') pago += v;
      else { aberto += v; if (due && due < todayStr) vencido += v; }
    });
    const totalEntradas = entradas.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const saldo = totalEntradas - total;
    $('#cp-kpis').innerHTML =
      kpi('Saídas do mês', money(total), 'money') +
      kpi('Pago', money(pago), 'money') +
      kpi('Em aberto', money(aberto), 'money') +
      kpi('Vencido', money(vencido), 'money') +
      (totalEntradas > 0 ? kpi('Entradas', money(totalEntradas), 'money') + kpi('Saldo', money(saldo), 'money') : '');

    // Entradas section
    const entradasEl = $('#cp-entradas-section');
    if (entradas.length) {
      entradasEl.style.display = '';
      const ENTRADA_PT = Object.fromEntries([['honorario_inicial','Honorários iniciais'],['honorario_total','Honorários'],['exito','Êxito'],['acordo','Acordos'],['dativo','Dativo'],['correspondente','Correspondente'],['salario_conjuge','Salário cônjuge/familiar'],['contribuicao_familiar','Contribuição familiar'],['salario_proprio','Salário próprio'],['freelance','Freelance'],['aluguel_recebido','Aluguel recebido'],['investimento','Rendimento'],['outro_entrada','Outras entradas']]);
      $('#cp-entradas-total').textContent = money(totalEntradas);
      $('#cp-entradas-list').innerHTML = `<table><thead><tr><th>Descrição</th><th>Data</th><th>Valor</th><th>Status</th><th></th></tr></thead><tbody>` +
        entradas.map((r) => {
          const due = (r.due_date || '').split('T')[0];
          const st = r.status === 'realizado' ? '<span class="badge ativo">recebido</span>' : '<span class="badge">previsto</span>';
          const escChip = r.escopo === 'pessoal' ? '<span class="chip-escopo pessoal">' + svgIcon('users', 'ic-inline') + 'Pessoal</span>' : '<span class="chip-escopo empresa">' + svgIcon('building', 'ic-inline') + 'Empresa</span>';
          return `<tr><td>${esc(r.description)} ${escChip}<br><small style="color:var(--text-muted)">${ENTRADA_PT[r.category] || r.category}</small></td>
            <td>${due ? fmtDate(due) : '—'}</td><td>${money(r.amount)}</td><td>${st}</td>
            <td style="white-space:nowrap;text-align:right">
              ${r.status !== 'realizado' ? `<button class="btn-sm" data-pay-ent="${r.id}">Recebido</button>` : `<button class="btn-sm" data-reopen-ent="${r.id}">Reabrir</button>`}
              <button class="btn-sm" data-del-ent="${r.id}">Excluir</button></td></tr>`;
        }).join('') + `</tbody></table>`;
      $('#cp-entradas-list').querySelectorAll('[data-pay-ent]').forEach((b) => b.onclick = async () => {
        try { await api(`/api/cashflow/${b.dataset.payEnt}/pay`, { method: 'PATCH', body: '{}' }); toast('Marcado como recebido'); load(); } catch (e) { toast(e.message, 'error'); }
      });
      $('#cp-entradas-list').querySelectorAll('[data-reopen-ent]').forEach((b) => b.onclick = async () => {
        if (!confirm('Reabrir esta entrada?')) return;
        try { await api(`/api/cashflow/${b.dataset.reopenEnt}/reopen`, { method: 'PATCH', body: '{}' }); toast('Entrada reaberta'); load(); } catch (e) { toast(e.message, 'error'); }
      });
      $('#cp-entradas-list').querySelectorAll('[data-del-ent]').forEach((b) => b.onclick = async () => {
        if (!confirm('Excluir esta entrada?')) return;
        try { await api(`/api/cashflow/${b.dataset.delEnt}`, { method: 'DELETE' }); toast('Entrada excluída'); load(); } catch (e) { toast(e.message, 'error'); }
      });
    } else {
      entradasEl.style.display = 'none';
    }

    const groups = {};
    visible.forEach((r) => { (groups[r.category] ??= []).push(r); });
    const order = GRUPOS_DESPESA.map(([k]) => k);
    const keys = Object.keys(groups).sort((a, b) => (order.indexOf(a) + 99) % 100 - (order.indexOf(b) + 99) % 100);

    $('#cp-groups').innerHTML = visible.length ? keys.map((k) => {
      const items = groups[k].sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
      const sub = items.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      return `<div class="card" style="margin-bottom:16px">
        <div style="padding:12px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
          <strong style="color:var(--navy)">${GRUPO_PT[k] || k}</strong><strong>${money(sub)}</strong></div>
        <table><thead><tr><th>Descrição</th><th>Vencimento</th><th>Valor</th><th>Status</th><th></th></tr></thead>
        <tbody>${items.map((r) => {
          const due = (r.due_date || '').split('T')[0];
          const isVenc = r.status !== 'realizado' && due && due < todayStr;
          const st = r.status === 'realizado' ? '<span class="badge ativo">pago</span>'
            : isVenc ? '<span class="badge vencido">vencido</span>' : '<span class="badge">em aberto</span>';
          const rec = r.installment_total > 1 ? ` <small style="color:var(--text-muted)">(${r.installment_no}/${r.installment_total})</small>` : '';
          const escChip = r.escopo === 'pessoal' ? '<span class="chip-escopo pessoal">' + svgIcon('users', 'ic-inline') + 'Pessoal</span>' : '<span class="chip-escopo empresa">' + svgIcon('building', 'ic-inline') + 'Empresa</span>';
          const quem = [r.pagador, r.banco].filter(Boolean).join(' · ');
          return `<tr class="${r.escopo === 'pessoal' ? 'row-pessoal' : ''}">
            <td>${r.description}${rec} ${escChip}${quem ? `<br><small style="color:var(--text-muted)">💳 ${esc(quem)}</small>` : ''}</td>
            <td>${due ? fmtDate(due) : '—'}</td>
            <td>${money(r.amount)}</td>
            <td>${st}</td>
            <td style="white-space:nowrap;text-align:right">
              ${r.status !== 'realizado' ? `<button class="btn-sm" data-pay="${r.id}">Pagar</button>` : `<button class="btn-sm" data-reopen="${r.id}" title="Desfazer pagamento">Reabrir</button>`}
              <button class="btn-sm" data-del="${r.id}" data-grp="${r.recurrence_group || ''}" data-tot="${r.installment_total || 1}">Excluir</button>
            </td></tr>`;
        }).join('')}</tbody></table></div>`;
    }).join('') : `<div class="empty">${showPagas ? 'Nenhuma conta neste mês.' : 'Nenhuma conta a pagar em aberto neste mês.'} ${!showPagas && rows.some((r) => r.status === 'realizado') ? '<br><small>Há contas pagas — ative "Ver pagas" para exibi-las.</small>' : ''}</div>`;

    $('#cp-groups').querySelectorAll('[data-pay]').forEach((b) => b.onclick = async () => {
      try { await api(`/api/cashflow/${b.dataset.pay}/pay`, { method: 'PATCH', body: '{}' }); toast('Marcado como pago'); load(); }
      catch (e) { toast(e.message, 'error'); }
    });
    $('#cp-groups').querySelectorAll('[data-reopen]').forEach((b) => b.onclick = async () => {
      if (!confirm('Desfazer o pagamento e reabrir esta conta?')) return;
      try { await api(`/api/cashflow/${b.dataset.reopen}/reopen`, { method: 'PATCH', body: '{}' }); toast('Conta reaberta'); load(); }
      catch (e) { toast(e.message, 'error'); }
    });
    $('#cp-groups').querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      const tot = Number(b.dataset.tot) || 1; const grp = b.dataset.grp;
      let url, msg;
      if (tot > 1 && grp && confirm(`Conta recorrente (${tot}x). OK = excluir a série inteira; Cancelar = excluir só esta parcela.`)) {
        url = `/api/cashflow/group/${grp}`; msg = 'Série excluída';
      } else {
        if (!confirm('Excluir esta conta?')) return;
        url = `/api/cashflow/${b.dataset.del}`; msg = 'Conta excluída';
      }
      try { await api(url, { method: 'DELETE' }); toast(msg); load(); } catch (e) { toast(e.message, 'error'); }
    });
  };
  $('#cp-month').onchange = load;
  $('#cp-show-pagas').onchange = (e) => { showPagas = e.target.checked; load(); };
  c.querySelectorAll('#cp-scope input').forEach((r) => r.onchange = () => {
    scope = r.value;
    c.querySelectorAll('#cp-scope label').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
    load();
  });
  $('#cp-new').onclick = () => contaPagarForm(load, $('#cp-month').value, scope === 'pessoal' ? 'pessoal' : 'empresa');
  $('#cp-new-entrada').onclick = () => cashflowForm(load, 'entrada');
  await load();
}

async function contaPagarForm(onSave, ym, escopoInicial) {
  const now = new Date();
  const base = ym || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const opc = await api('/api/cashflow/opcoes').catch(() => ({ pagadores: [], bancos: [] }));
  const dl = (id, arr) => `<datalist id="${id}">${(arr || []).map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`;
  const isPessoal = escopoInicial === 'pessoal';
  const form = el(`<form class="form-grid">
    <div><small style="color:var(--text-muted)">Tipo da conta</small>
      <div class="seg-toggle" id="cp-escopo">
        <label class="${isPessoal ? '' : 'on'}"><input type="radio" name="escopo" value="empresa" ${isPessoal ? '' : 'checked'}>🏢 Empresa</label>
        <label class="${isPessoal ? 'on' : ''}"><input type="radio" name="escopo" value="pessoal" ${isPessoal ? 'checked' : ''}>👤 Pessoal</label>
      </div></div>
    <label>Grupo de despesa<select name="category">${GRUPOS_DESPESA.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
    ${field('Descrição *', 'description')}
    <div class="form-row">${field('Valor (R$) *', 'amount', { type: 'number' })}${field('Vencimento *', 'due_date', { type: 'date', value: `${base}-10` })}</div>
    <div class="form-row">
      <label>Pagadora (quem paga)<input name="pagador" list="dl-pag" placeholder="ex.: Escritório, você…" autocomplete="off">${dl('dl-pag', opc.pagadores)}</label>
      <label>Banco / conta de saída<input name="banco" list="dl-ban" placeholder="ex.: Itaú, Nubank…" autocomplete="off">${dl('dl-ban', opc.bancos)}</label>
    </div>
    ${field('Recorrência', 'recurrence', { options: [{ v: 'unica', t: 'Única (1x)' }, { v: 'mensal', t: 'Mensal (repetir)' }] })}
    <div id="cp-occ" style="display:none">${field('Quantos meses', 'occurrences', { type: 'number', value: 12 })}</div>
    ${field('Observações', 'notes', { type: 'textarea' })}
    <button type="submit" class="btn-primary">Lançar conta</button>
  </form>`);
  form.querySelectorAll('#cp-escopo input').forEach((r) => r.onchange = () => form.querySelectorAll('#cp-escopo label').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked)));
  form.querySelector('[name=recurrence]').onchange = (e) => { form.querySelector('#cp-occ').style.display = e.target.value === 'mensal' ? 'block' : 'none'; };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    body.type = 'saida';
    try { const r = await api('/api/cashflow', { method: 'POST', body: JSON.stringify(body) }); closeModal(); toast(`Conta lançada (${r.created}x)`); onSave(); }
    catch (err) { toast(err.message, 'error'); }
  };
  openModal('Nova conta a pagar', form);
}

async function finFluxoCaixa(c) {
  const mesLabel = (ym) => { const [y, m] = ym.split('-'); return ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][Number(m) - 1] + '/' + y.slice(2); };
  const now = new Date();
  const fromDefault = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  c.innerHTML = `
    <div class="toolbar">
      <select id="cf-months"><option value="12">12 meses</option><option value="24" selected>24 meses</option><option value="6">6 meses</option><option value="36">36 meses</option></select>
      <span class="spacer"></span>
      <button class="btn-gold" id="cf-new">+ Lançamento no fluxo</button>
    </div>
    <div id="cf-kpis" class="kpi-grid"></div>
    <div class="card" style="margin-bottom:20px;overflow-x:auto"><div style="padding:14px 18px;border-bottom:1px solid var(--border)"><strong style="color:var(--navy)">Projeção mensal (previsto / realizado)</strong></div><div id="cf-table"></div></div>
    <div class="card"><div style="padding:14px 18px;border-bottom:1px solid var(--border)"><strong style="color:var(--navy)">Por categoria</strong></div><div id="cf-cats"></div></div>`;

  const load = async () => {
    const months = $('#cf-months').value;
    const d = await api(`/api/cashflow/monthly?from=${fromDefault}&months=${months}`);
    const t = d.totais;
    $('#cf-kpis').innerHTML =
      kpi('Entradas previstas', money(t.entrada_previsto), 'money') +
      kpi('Entradas realizadas', money(t.entrada_realizado), 'money') +
      kpi('Saídas previstas', money(t.saida_previsto), 'money') +
      kpi('Saídas realizadas', money(t.saida_realizado), 'money') +
      kpi('Saldo previsto', money(t.saldo_previsto), 'money') +
      kpi('Saldo realizado', money(t.saldo_realizado), 'money');

    $('#cf-table').innerHTML = `
      <table><thead><tr>
        <th>Mês</th><th>Entradas (prev)</th><th>Saídas (prev)</th><th>Saldo mês (prev)</th>
        <th>Realizado</th><th>Acumulado (prev)</th></tr></thead>
      <tbody>${d.meses.map((m) => `<tr>
        <td><strong>${mesLabel(m.mes)}</strong></td>
        <td style="color:var(--green)">${money(m.entrada_previsto)}</td>
        <td style="color:var(--red)">${money(m.saida_previsto)}</td>
        <td><strong style="color:${m.saldo_previsto >= 0 ? 'var(--green)' : 'var(--red)'}">${money(m.saldo_previsto)}</strong></td>
        <td>${money(m.saldo_realizado)}</td>
        <td style="color:${m.acumulado_previsto >= 0 ? 'var(--navy)' : 'var(--red)'}">${money(m.acumulado_previsto)}</td></tr>`).join('')}</tbody></table>`;

    $('#cf-cats').innerHTML = d.categorias.length ? `
      <table><thead><tr><th>Categoria</th><th>Tipo</th><th>Previsto</th><th>Realizado</th></tr></thead>
      <tbody>${d.categorias.map((cat) => `<tr>
        <td><strong>${cat.label}</strong></td>
        <td>${cat.type === 'entrada' ? '<span class="badge ativo">entrada</span>' : '<span class="badge vencido">saída</span>'}</td>
        <td>${money(cat.previsto)}</td><td>${money(cat.realizado)}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Sem dados no período</div>';
  };
  $('#cf-months').onchange = load;
  $('#cf-new').onclick = () => cashflowForm(load);
  await load();
}

async function cashflowForm(onSave, preType) {
  const CATS = {
    entrada: [
      ['honorario_inicial','Honorários iniciais'],['honorario_total','Honorários (totais)'],
      ['exito','Êxito / decisão'],['acordo','Acordos'],
      ['dativo','Dativo (Estado)'],['correspondente','Correspondente jurídico'],
      ['salario_conjuge','Salário cônjuge / familiar'],['contribuicao_familiar','Contribuição familiar'],
      ['salario_proprio','Salário próprio'],['freelance','Freelance / bico'],
      ['aluguel_recebido','Aluguel recebido'],['investimento','Rendimento / investimento'],
      ['outro_entrada','Outras entradas'],
    ],
    saida: GRUPOS_DESPESA,
  };
  const initType = preType === 'entrada' ? 'entrada' : preType === 'saida' ? 'saida' : 'entrada';
  const catOptions = (type) => CATS[type].map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
  const form = el(`<form class="form-grid">
    ${field('Tipo', 'type', { options: [{ v: 'entrada', t: 'Entrada (receita)' }, { v: 'saida', t: 'Saída (despesa)' }], value: initType })}
    <label>Categoria<select name="category">${catOptions(initType)}</select></label>
    ${field('Descrição *', 'description')}
    <div class="form-row">
      ${field('Valor *', 'amount', { type: 'number' })}
      ${field('Data *', 'due_date', { type: 'date' })}
    </div>
    <div class="seg-toggle" id="cf-escopo-toggle" style="margin-top:0">
      <label class="on"><input type="radio" name="escopo" value="empresa" checked>🏢 Empresa</label>
      <label><input type="radio" name="escopo" value="pessoal">👤 Pessoal</label>
    </div>
    ${field('Recorrência', 'recurrence', { options: [{ v: 'unica', t: 'Única (1x)' }, { v: 'mensal', t: 'Mensal (repetir)' }] })}
    <div id="cf-occ" style="display:none">${field('Quantos meses', 'occurrences', { type: 'number', value: 12 })}</div>
    ${field('Observações', 'notes', { type: 'textarea' })}
    <button type="submit" class="btn-primary">Lançar</button>
  </form>`);
  const typeSel = form.querySelector('[name=type]');
  const catSel = form.querySelector('[name=category]');
  typeSel.onchange = () => { catSel.innerHTML = catOptions(typeSel.value); };
  form.querySelectorAll('#cf-escopo-toggle input').forEach((r) => r.onchange = () => {
    form.querySelectorAll('#cf-escopo-toggle label').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
  });
  form.querySelector('[name=recurrence]').onchange = (e) => { form.querySelector('#cf-occ').style.display = e.target.value === 'mensal' ? 'block' : 'none'; };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    try {
      const r = await api('/api/cashflow', { method: 'POST', body: JSON.stringify(body) });
      closeModal(); toast(`Lançado (${r.created}x)`); onSave();
    } catch (err) { toast(err.message, 'error'); }
  };
  openModal('Novo lançamento', form);
}

// ── Formulários financeiros ──
async function acordoForm(onSave) {
  const clients = await api('/api/clients?limit=100');
  const form = el(`<form class="form-grid">
    ${field('Cliente *', 'client_id', { options: clients.data.map((c) => ({ v: c.id, t: c.name })) })}
    ${field('Parte contrária *', 'opposing_party')}
    ${field('Nº do processo', 'process_number')}
    ${field('Valor do acordo *', 'total_agreement_value', { type: 'number' })}
    ${field('Nº de parcelas', 'installments_count', { type: 'number', value: 1 })}
    ${field('1º vencimento *', 'first_due_date', { type: 'date' })}
    ${field('Honorário (%)', 'honorarium_percentage', { type: 'number', value: 30 })}
    ${field('Observações', 'notes', { type: 'textarea' })}
    <button type="submit" class="btn-primary">Criar acordo</button>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    try { await api('/api/acordos', { method: 'POST', body: JSON.stringify(body) }); closeModal(); toast('Acordo criado'); onSave(); }
    catch (err) { toast(err.message, 'error'); }
  };
  openModal('Novo acordo', form);
}

async function receitaForm(onSave) {
  const clients = await api('/api/clients?limit=100');
  const form = el(`<form class="form-grid">
    ${field('Cliente *', 'client_id', { options: clients.data.map((c) => ({ v: c.id, t: c.name })) })}
    ${field('Descrição *', 'descricao')}
    ${field('Tipo', 'tipo', { options: [{v:'servico',t:'Serviço'},{v:'honorario',t:'Honorário'},{v:'reembolso',t:'Reembolso'}] })}
    ${field('Valor *', 'valor', { type: 'number' })}
    ${field('Vencimento *', 'data_vencimento', { type: 'date' })}
    <button type="submit" class="btn-primary">Criar receita</button>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    try { await api('/api/receitas', { method: 'POST', body: JSON.stringify(body) }); closeModal(); toast('Receita criada'); onSave(); }
    catch (err) { toast(err.message, 'error'); }
  };
  openModal('Nova receita', form);
}

async function repasseForm(onSave) {
  const cs = await api('/api/cases?limit=100');
  const caseList = cs.data || cs;
  const form = el(`<form class="form-grid">
    ${field('Processo *', 'case_id', { options: caseList.map((c) => ({ v: c.id, t: c.title })) })}
    ${field('Parceiro *', 'parceiro')}
    ${field('Tipo', 'tipo', { options: [{v:'indicacao',t:'Indicação'},{v:'audiencia',t:'Audiência'},{v:'correspondente',t:'Correspondente'},{v:'diligencia',t:'Diligência'}] })}
    ${field('Valor *', 'valor', { type: 'number' })}
    ${field('Percentual (%)', 'percentual', { type: 'number' })}
    ${field('Descrição *', 'descricao')}
    ${field('Vencimento *', 'data_vencimento', { type: 'date' })}
    <button type="submit" class="btn-primary">Criar repasse</button>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    if (!body.percentual) delete body.percentual;
    try { await api('/api/repasses', { method: 'POST', body: JSON.stringify(body) }); closeModal(); toast('Repasse criado'); onSave(); }
    catch (err) { toast(err.message, 'error'); }
  };
  openModal('Novo repasse', form);
}

async function receitaDetail(id, onSave) {
  const r = await api('/api/receitas/' + id);
  const wrap = el(`<div>
    <div class="kpi-grid" style="margin-bottom:14px">
      ${kpi('Valor', money(r.valor), 'money')}
      ${kpi('Recebido', money(r.total_recebido), 'money')}
      ${kpi('Status', (r.status || '').replace(/_/g,' '))}
    </div>
    <div id="parc-list"></div>
    <div class="card" style="margin-top:14px;padding:14px">
      <strong style="color:var(--navy)">Gerar parcelas automaticamente</strong>
      <form id="gen-form" class="form-grid" style="margin-top:10px">
        ${field('Nº de parcelas *', 'total_parcelas', { type: 'number', value: 1 })}
        ${field('Início *', 'data_inicio', { type: 'date' })}
        ${field('Intervalo (dias)', 'dias_intervalo', { type: 'number', value: 30 })}
        <button type="submit" class="btn-primary">Gerar</button>
      </form>
    </div>
  </div>`);
  const renderParcelas = (parcelas) => {
    wrap.querySelector('#parc-list').innerHTML = parcelas && parcelas.length ? `
      <table><thead><tr><th>Nº</th><th>Valor</th><th>Vencimento</th><th>Status</th><th></th></tr></thead>
      <tbody>${parcelas.map((p) => `<tr>
        <td>${p.numero}/${p.total_parcelas}</td><td>${money(p.valor_final)}</td>
        <td>${fmtDate(p.data_vencimento)}</td><td>${badge(p.status)}</td>
        <td>${p.status !== 'pago' ? `<button class="btn-sm" data-pay-parc="${p.id}">Receber</button>` : ''}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Sem parcelas. Gere abaixo.</div>';
    wrap.querySelectorAll('[data-pay-parc]').forEach((b) => b.onclick = async () => {
      try { await api(`/api/parcelas/${b.dataset.payParc}/pagar`, { method: 'POST', body: '{}' }); toast('Parcela recebida'); reload(); } catch (e) { toast(e.message, 'error'); }
    });
  };
  const reload = async () => {
    const fresh = await api('/api/receitas/' + id);
    renderParcelas(fresh.parcelas);
    if (onSave) onSave();
  };
  renderParcelas(r.parcelas);
  wrap.querySelector('#gen-form').onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    body.receita_id = id;
    try { await api('/api/parcelas/gerar', { method: 'POST', body: JSON.stringify(body) }); toast('Parcelas geradas'); reload(); }
    catch (err) { toast(err.message, 'error'); }
  };
  openModal(`Receita — ${r.descricao}`, wrap);
}

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

const ORIGENS = [['', '—'], ['google', 'Google'], ['instagram', 'Instagram'], ['facebook', 'Facebook'], ['indicacao', 'Indicação'], ['site', 'Site'], ['whatsapp', 'WhatsApp'], ['parceiro', 'Parceiro']];
const ESTADO_CIVIL = [['', '—'], ['solteiro', 'Solteiro(a)'], ['casado', 'Casado(a)'], ['divorciado', 'Divorciado(a)'], ['viuvo', 'Viúvo(a)'], ['uniao_estavel', 'União estável']];

async function leadForm(onSave) {
  const form = el(`<form class="form-grid">
    <div><strong style="color:var(--navy)">Dados básicos</strong></div>
    ${field('Nome *', 'name')}
    <div class="form-row">${field('CPF/CNPJ', 'cpf_cnpj')}${field('Nascimento', 'birth_date', { type: 'date' })}</div>
    <div class="form-row">${field('Estado civil', 'marital_status', { options: ESTADO_CIVIL.map(([v, t]) => ({ v, t })) })}${field('Profissão', 'profession')}</div>
    <div><strong style="color:var(--navy)">Contato</strong></div>
    <div class="form-row">${field('Telefone/WhatsApp', 'phone')}${field('E-mail', 'email', { type: 'email' })}</div>
    <div><strong style="color:var(--navy)">Endereço</strong></div>
    <div class="form-row">${field('CEP', 'cep')}${field('Cidade', 'city')}</div>
    <div class="form-row">${field('Rua', 'street')}${field('Nº', 'number')}</div>
    <div class="form-row">${field('Bairro', 'neighborhood')}${field('UF', 'state')}</div>
    <div><strong style="color:var(--navy)">Caso & Comercial</strong></div>
    <div class="form-row">${field('Área', 'legal_area', { options: AREAS })}${field('Origem', 'source', { options: ORIGENS.map(([v, t]) => ({ v, t })) })}</div>
    ${field('Resumo do caso / dor principal', 'case_summary', { type: 'textarea' })}
    <div class="form-row">${field('Valor estimado da causa', 'estimated_value', { type: 'number' })}${field('Prob. fechamento (%)', 'close_probability', { type: 'number' })}</div>
    ${field('Próximo follow-up', 'next_followup', { type: 'date' })}
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
  const stages = [['triagem','Novo Lead'],['atendimento_inicial','Primeiro Contato'],['reuniao','Atendimento Realizado'],['documentacao_pendente','Documentação Pendente'],['proposta','Proposta Enviada'],['proposta_em_analise','Negociação'],['contrato_assinado','Contrato Assinado'],['perdida','Perdido']];
  const info = [
    l.cpf_cnpj ? 'CPF/CNPJ: ' + l.cpf_cnpj : '',
    l.city ? l.city + (l.state ? '/' + l.state : '') : '',
    l.estimated_value ? 'Causa: ' + money(l.estimated_value) : '',
    (l.close_probability !== null && l.close_probability !== undefined && l.close_probability !== '') ? 'Prob.: ' + l.close_probability + '%' : '',
    l.next_followup ? 'Follow-up: ' + fmtDate(l.next_followup) : '',
  ].filter(Boolean).join(' · ');
  const form = el(`<div class="form-grid">
    <div><strong style="font-size:18px">${l.name}</strong><br><small style="color:var(--text-muted)">${l.source || ''}${l.legal_area ? ' · ' + l.legal_area : ''}</small></div>
    <div>${l.phone ? esc(l.phone) + waBtn(l.phone, 'WhatsApp') : ''} ${l.email ? '· ' + esc(l.email) : ''}</div>
    ${info ? `<div style="font-size:13px;color:var(--text-soft)">${info}</div>` : ''}
    ${field('Resumo / contexto do caso', 'case_summary', { type: 'textarea', value: l.case_summary || '' })}
    <button class="btn-sm" id="save-summary" style="align-self:start">Salvar resumo/contexto</button>
    <div class="form-row">${field('Área', 'legal_area', { value: l.legal_area || 'outro', options: AREAS })}<button class="btn-sm" id="save-area" style="align-self:end">Salvar área</button></div>
    <hr style="border:none;border-top:1px solid var(--border)">
    ${field('Mover no funil', 'status', { value: l.status, options: stages.map(([v,t])=>({v,t})) })}
    <div id="loss-wrap" style="display:none">${field('Motivo da perda', 'loss_reason', { value: l.loss_reason || '', type: 'textarea' })}</div>
    <button class="btn-primary" id="move">Atualizar etapa</button>
    <hr style="border:none;border-top:1px solid var(--border)">
    <button class="btn-gold" id="gen-prop" style="width:100%">Gerar proposta</button>
    <button class="btn-gold" id="close" style="width:100%">Fechar negócio e gerar contrato</button>
    <button class="btn-sm" id="del-lead" style="width:100%;color:var(--red);border-color:var(--red)">Excluir lead</button>
    <hr style="border:none;border-top:1px solid var(--border)">
    <div><strong style="color:var(--navy)">Atualizações do caso</strong><p class="sub" style="margin:2px 0 6px">Acrescente informações quando precisar — não apaga o que já foi registrado.</p></div>
    <textarea id="ctx-note" rows="2" placeholder="Nova informação/atualização do caso…"></textarea>
    <button class="btn-primary btn-sm" id="add-ctx" style="align-self:start">Adicionar atualização</button>
    <hr style="border:none;border-top:1px solid var(--border)">
    <div><strong style="color:var(--navy)">Histórico da jornada</strong><p class="sub" style="margin:2px 0 8px">Tudo registrado — do primeiro contato ao fim do processo</p></div>
    <div id="lead-journey"><div class="spinner"></div></div>
  </div>`);
  loadJourney(form.querySelector('#lead-journey'), { lead_id: id });
  form.querySelector('#save-area').onclick = async () => {
    try { await api('/api/leads/' + id, { method: 'PUT', body: JSON.stringify({ legal_area: form.querySelector('[name=legal_area]').value }) });
      toast('Área salva'); } catch (e) { toast(e.message, 'error'); }
  };
  form.querySelector('#save-summary').onclick = async () => {
    try { await api('/api/leads/' + id, { method: 'PUT', body: JSON.stringify({ case_summary: form.querySelector('[name=case_summary]').value }) });
      toast('Resumo/contexto salvo'); } catch (e) { toast(e.message, 'error'); }
  };
  form.querySelector('#add-ctx').onclick = async () => {
    const ta = form.querySelector('#ctx-note'); const text = ta.value.trim();
    if (!text) { toast('Escreva a atualização', 'error'); return; }
    try {
      await api(`/api/leads/${id}/contexto`, { method: 'POST', body: JSON.stringify({ text }) });
      ta.value = ''; toast('Atualização adicionada'); loadJourney(form.querySelector('#lead-journey'), { lead_id: id });
    } catch (e) { toast(e.message, 'error'); }
  };
  const statusSel = form.querySelector('[name=status]');
  const syncLoss = () => { form.querySelector('#loss-wrap').style.display = statusSel.value === 'perdida' ? 'block' : 'none'; };
  statusSel.onchange = syncLoss; syncLoss();
  form.querySelector('#move').onclick = async () => {
    try {
      const status = statusSel.value;
      if (status === 'perdida') {
        await api('/api/leads/' + id, { method: 'PUT', body: JSON.stringify({ loss_reason: form.querySelector('[name=loss_reason]').value }) });
      }
      await api(`/api/leads/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      closeModal(); toast('Etapa atualizada'); onSave();
    } catch (e) { toast(e.message, 'error'); }
  };
  form.querySelector('#gen-prop').onclick = () => { closeModal(); propostaForm(onSave, l); };
  form.querySelector('#del-lead').onclick = async () => {
    if (!confirm(`Excluir o lead "${l.name || ''}"? Esta ação não pode ser desfeita.`)) return;
    try { await api('/api/leads/' + id, { method: 'DELETE' }); closeModal(); toast('Lead excluído'); onSave(); }
    catch (e) { toast(e.message, 'error'); }
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

const TIPOS_CAUSA = [
  'Reclamação trabalhista','Verbas rescisórias','Horas extras','Adicional de insalubridade','Reconhecimento de vínculo','Acidente de trabalho','Assédio moral','Reversão de justa causa','Estabilidade gestante',
  'Aposentadoria por idade','Aposentadoria por tempo de contribuição','Aposentadoria por invalidez','Auxílio-doença','BPC/LOAS - Idoso','BPC/LOAS - Deficiente','Pensão por morte','Salário-maternidade','Revisão de benefício',
  'Divórcio consensual','Divórcio litigioso','Guarda de filhos','Pensão alimentícia','Investigação de paternidade','Inventário','Partilha de bens','Regulamentação de visitas','Reconhecimento de união estável',
  'Cobrança','Indenização por danos morais','Indenização por danos materiais','Despejo','Usucapião','Revisão contratual','Responsabilidade civil',
  'Cobrança indevida','Negativação indevida','Vício do produto','Vício do serviço','Cancelamento de contrato','Superendividamento',
];

const OBSERVACOES_PROPOSTA = `OBSERVAÇÕES E CONDIÇÕES (Estatuto da Advocacia — Lei 8.906/94 — e Código de Ética e Disciplina da OAB)

1. HONORÁRIOS: Os honorários ajustados remuneram exclusivamente a atuação descrita nesta proposta, não abrangendo recursos, incidentes ou demandas autônomas, que serão objeto de novo ajuste.

2. DESPESAS E CUSTAS: Custas judiciais, taxas, emolumentos, honorários periciais e demais despesas processuais correm por conta exclusiva do(a) CONTRATANTE, não estando incluídas nos honorários.

3. DESLOCAMENTO E DILIGÊNCIAS: Diligências e deslocamentos para fora da comarca/sede do escritório serão cobrados à parte, conforme tabela vigente.

4. COMPROMISSOS: O não comparecimento do(a) CONTRATANTE a audiências, perícias ou reuniões previamente agendadas, sem aviso prévio e sem justificativa por motivo de saúde devidamente comprovado, será considerado falta grave, podendo ensejar a rescisão do contrato.

5. ATRASO NO PAGAMENTO: O atraso no pagamento de qualquer parcela sujeitará o(a) CONTRATANTE a juros de mora de 1% (um por cento) ao mês e multa de 2% (dois por cento) sobre o valor em atraso.

6. SUSPENSÃO POR INADIMPLÊNCIA: A falta de pagamento por 2 (dois) meses consecutivos autoriza a suspensão imediata dos serviços advocatícios, sem prejuízo da cobrança dos valores devidos e da eventual rescisão contratual.

7. RESCISÃO: A rescisão observará o Estatuto da Advocacia e o Código de Ética da OAB, sendo devidos os honorários proporcionais aos serviços já prestados.

8. HONORÁRIOS SUCUMBENCIAIS: Os honorários de sucumbência, quando houver, pertencem exclusivamente ao(à) advogado(a) (art. 23 da Lei 8.906/94).`;

const HON_MODS = [
  { k: 'entrada', label: 'Entrada (R$)', kind: 'money' },
  { k: 'fixo', label: 'Honorário fixo (R$)', kind: 'money', extra: 'parcelas', extraLabel: 'parcelas' },
  { k: 'exito', label: 'Êxito (% sobre o proveito)', kind: 'pct' },
  { k: 'sucumbencia', label: 'Sucumbência (pertence ao advogado)', kind: 'flag' },
  { k: 'ad_exitum', label: 'Ad exitum / quota litis (% — só em caso de êxito)', kind: 'pct' },
  { k: 'consulta', label: 'Consulta (R$)', kind: 'money' },
  { k: 'mensal', label: 'Mensal / advocacia de partido (R$)', kind: 'money' },
  { k: 'diligencia', label: 'Diligência / atos isolados (R$)', kind: 'money', extra: 'diligencia_desc', extraLabel: 'descrição' },
  { k: 'arbitrado', label: 'Arbitrado judicialmente', kind: 'flag' },
];
const HON_PRESETS = [
  ['Fixo + Êxito', ['fixo', 'exito']],
  ['Fixo + Sucumbência', ['fixo', 'sucumbencia']],
  ['Fixo + Êxito + Sucumbência', ['fixo', 'exito', 'sucumbencia']],
  ['Só Êxito', ['ad_exitum']],
  ['Mensal + Extraordinários', ['mensal']],
  ['Consulta + Causa', ['consulta', 'fixo']],
];

async function propostaForm(onSave, lead = null, existing = null) {
  const clients = await api('/api/clients?limit=200');
  const sec = (t) => `<div class="prop-sec">${t}</div>`;
  const honRows = HON_MODS.map((m) => `
    <label class="hon-mod"><input type="checkbox" data-hon="${m.k}"> <span>${m.label}</span></label>
    <div class="hon-val" data-hon-val="${m.k}">
      ${m.kind !== 'flag' ? `<input type="number" step="0.01" data-hon-input="${m.k}" placeholder="${m.kind === 'pct' ? '%' : 'R$ 0,00'}">` : '<small style="color:var(--text-muted)">previsto no contrato</small>'}
      ${m.extra ? `<input type="text" data-hon-extra="${m.extra}" placeholder="${m.extraLabel}">` : ''}
    </div>`).join('');

  const form = el(`<form class="form-grid prop-form">
    ${sec('Cliente / Contato')}
    ${field('Nome completo *', 'contact_name', { value: existing?.contact_name || lead?.name || '' })}
    <div class="form-row">${field('CPF', 'cpf', { value: existing?.cpf || lead?.cpf_cnpj || '' })}${field('Telefone / WhatsApp', 'phone', { value: existing?.phone || lead?.phone || '' })}</div>
    ${field('E-mail', 'email', { type: 'email', value: existing?.email || lead?.email || '' })}
    ${field('Vincular a cliente existente (opcional)', 'client_id', { options: [{ v: '', t: '—' }].concat(clients.data.map((c) => ({ v: c.id, t: c.name }))) })}
    ${field('Em parceria com (opcional)', 'partner_lawyers', { value: existing?.partner_lawyers || '', placeholder: 'Ex.: Dra. Ana Paula Ribeiro, OAB/ES 12.345' })}

    ${sec('Causa')}
    <div class="form-row">${field('Área de atuação', 'legal_area', { value: existing?.legal_area || lead?.legal_area || 'outro', options: AREAS })}
      <label>Tipo de causa<input name="tipo_causa" value="${esc(existing?.tipo_causa || '')}" list="tipos-causa-dl" placeholder="Comece a digitar…" autocomplete="off"><datalist id="tipos-causa-dl">${TIPOS_CAUSA.map((t) => `<option value="${t}">`).join('')}</datalist></label></div>
    ${field('Breve descrição do caso', 'description', { type: 'textarea', value: existing?.description || lead?.case_summary || '' })}

    ${sec('Dependentes')}
    <p class="sub" style="margin-top:-6px">Informe os dependentes (importante em BPC/LOAS e Família — guarda/pensão).</p>
    <div id="dep-list"></div>
    <button type="button" class="btn-sm" id="add-dep" style="align-self:flex-start">+ Dependente</button>

    ${sec('Honorários')}
    <label class="hon-mod" style="border:1px solid var(--gold);border-radius:10px;padding:10px 12px;background:rgba(193,154,78,.07)"><input type="checkbox" id="hon-apenas-exito"> <span><strong>💼 Apenas êxito</strong> — sem valor fixo nem entrada (ex.: 30% sobre o proveito)</span></label>
    <div id="hon-exito-only" style="display:none">
      ${field('Percentual de êxito (%) *', 'exito_only_pct', { type: 'number' })}
      <p class="sub" style="margin-top:-6px">A proposta e o contrato constarão como <strong>honorários exclusivamente de êxito</strong>, sem cobrança inicial.</p>
    </div>
    <div id="hon-fixo">
      ${field('Honorário total (R$)', 'valor_total', { type: 'number' })}
      <div class="form-row">${field('Entrada (R$)', 'entrada_valor', { type: 'number' })}${field('Data da entrada', 'entrada_data', { type: 'date' })}</div>
      <div class="form-row">${field('Qtd. de parcelas (restante)', 'parcelas_qtd', { type: 'number', value: 1 })}${field('1º vencimento das parcelas', 'parcelas_primeiro_venc', { type: 'date' })}</div>
      <div id="parc-preview" class="parc-preview"></div>
    </div>

    ${sec('Outras modalidades (opcional)')}
    <div class="hon-presets">${HON_PRESETS.map((p, i) => `<button type="button" class="btn-sm" data-preset="${i}">${p[0]}</button>`).join('')}</div>
    <div class="hon-grid">${honRows}</div>

    ${sec('Validade & Observações')}
    ${field('Validade da proposta', 'validade', { type: 'date', value: existing?.validade || '' })}
    ${field('Observações e cláusulas (OAB)', 'observacoes', { type: 'textarea', value: existing?.observacoes || OBSERVACOES_PROPOSTA })}

    <button type="submit" class="btn-primary">${existing ? 'Salvar alterações' : 'Criar proposta'}</button>
  </form>`);

  // Dependentes (repeater)
  const depList = form.querySelector('#dep-list');
  const addDep = (nome = '', cpf = '') => {
    const row = el(`<div class="dep-row" style="display:flex;gap:8px;margin-bottom:6px">
      <input placeholder="Nome completo" value="${nome}" data-dep-nome style="flex:2">
      <input placeholder="CPF" value="${cpf}" data-dep-cpf style="flex:1">
      <button type="button" class="btn-sm" data-dep-x>×</button></div>`);
    row.querySelector('[data-dep-x]').onclick = () => row.remove();
    depList.appendChild(row);
  };
  // Pre-fill dependentes se existentes
  if (existing?.dependentes && Array.isArray(existing.dependentes)) {
    existing.dependentes.forEach((d) => addDep(d.nome || '', d.cpf || ''));
  }
  form.querySelector('#add-dep').onclick = () => addDep();

  // Parcelamento — cálculo e prévia ao vivo
  const calcParcelas = () => {
    const total = Number(form.querySelector('[name=valor_total]').value) || 0;
    const entrada = Number(form.querySelector('[name=entrada_valor]').value) || 0;
    const qtd = Math.max(1, parseInt(form.querySelector('[name=parcelas_qtd]').value) || 1);
    const venc = form.querySelector('[name=parcelas_primeiro_venc]').value;
    const restante = Math.max(0, total - entrada);
    const base = Math.floor((restante / qtd) * 100) / 100;
    const ultima = Math.round((restante - base * (qtd - 1)) * 100) / 100;
    const valorParcela = base;
    let datas = '';
    if (venc) {
      const d0 = new Date(venc + 'T00:00:00');
      const fmt = (dt) => dt.toLocaleDateString('pt-BR');
      const last = new Date(d0); last.setMonth(last.getMonth() + (qtd - 1));
      datas = qtd === 1 ? `vencimento em ${fmt(d0)}` : `1º em ${fmt(d0)} · último em ${fmt(last)} (mensais)`;
    }
    return { total, entrada, qtd, venc, restante, base, ultima, valorParcela, datas };
  };
  const renderPreview = () => {
    const p = calcParcelas();
    const box = form.querySelector('#parc-preview');
    if (!p.total) { box.innerHTML = ''; return; }
    const linhaUlt = p.qtd > 1 && p.ultima !== p.base ? ` (última de ${money(p.ultima)})` : '';
    box.innerHTML = `
      <div class="parc-line"><span>Entrada</span><strong>${money(p.entrada)}</strong></div>
      <div class="parc-line"><span>Restante a parcelar</span><strong>${money(p.restante)}</strong></div>
      <div class="parc-line"><span>Parcelas</span><strong>${p.qtd}× de ${money(p.base)}${linhaUlt}</strong></div>
      ${p.datas ? `<div class="parc-line"><span>Vencimentos</span><strong>${p.datas}</strong></div>` : ''}
      <div class="parc-line total"><span>Total</span><strong>${money(p.total)}</strong></div>`;
  };
  ['valor_total', 'entrada_valor', 'parcelas_qtd', 'parcelas_primeiro_venc'].forEach((n) => {
    const inp = form.querySelector(`[name=${n}]`); if (inp) inp.oninput = renderPreview;
  });
  renderPreview();

  // Honorários reveal + presets
  const syncHon = () => form.querySelectorAll('[data-hon]').forEach((cb) => {
    form.querySelector(`[data-hon-val="${cb.dataset.hon}"]`).classList.toggle('on', cb.checked);
  });
  form.querySelectorAll('[data-hon]').forEach((cb) => cb.onchange = syncHon);
  form.querySelectorAll('[data-preset]').forEach((b) => b.onclick = () => {
    const keys = HON_PRESETS[b.dataset.preset][1];
    form.querySelectorAll('[data-hon]').forEach((cb) => { cb.checked = keys.includes(cb.dataset.hon); });
    syncHon();
  });
  syncHon();

  // Pre-fill honorários se existentes
  if (existing?.honorarios) {
    const hon = typeof existing.honorarios === 'string' ? JSON.parse(existing.honorarios) : existing.honorarios;
    if (hon.apenas_exito && hon.values?.exito) {
      apenasEx.checked = true;
      form.querySelector('[name=exito_only_pct]').value = hon.values.exito;
    } else if (hon.parcelamento) {
      const p = hon.parcelamento;
      if (p.total) form.querySelector('[name=valor_total]').value = p.total;
      if (p.entrada) form.querySelector('[name=entrada_valor]').value = p.entrada;
      if (p.entrada_data) form.querySelector('[name=entrada_data]').value = p.entrada_data;
      if (p.parcelas) form.querySelector('[name=parcelas_qtd]').value = p.parcelas;
      if (p.primeiro_vencimento) form.querySelector('[name=parcelas_primeiro_venc]').value = p.primeiro_vencimento;
    }
    if (hon.modalidades && Array.isArray(hon.modalidades)) {
      hon.modalidades.forEach((mod) => {
        const cb = form.querySelector(`[data-hon="${mod}"]`);
        if (cb) {
          cb.checked = true;
          if (hon.values && hon.values[mod]) form.querySelector(`[data-hon-input="${mod}"]`).value = hon.values[mod];
        }
      });
    }
  }

  // Modo "Apenas êxito": esconde o bloco de valor fixo/parcelas.
  const apenasEx = form.querySelector('#hon-apenas-exito');
  apenasEx.onchange = () => {
    form.querySelector('#hon-fixo').style.display = apenasEx.checked ? 'none' : '';
    form.querySelector('#hon-exito-only').style.display = apenasEx.checked ? 'block' : 'none';
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    const dependentes = [...depList.querySelectorAll('.dep-row')].map((r) => ({
      nome: r.querySelector('[data-dep-nome]').value.trim(), cpf: r.querySelector('[data-dep-cpf]').value.trim(),
    })).filter((d) => d.nome);
    const honorarios = { modalidades: [], values: {} };
    HON_MODS.forEach((m) => {
      const cb = form.querySelector(`[data-hon="${m.k}"]`);
      if (cb.checked) {
        honorarios.modalidades.push(m.k);
        const inp = form.querySelector(`[data-hon-input="${m.k}"]`);
        if (inp) honorarios.values[m.k] = inp.value;
        if (m.extra) honorarios.values[m.extra] = form.querySelector(`[data-hon-extra="${m.extra}"]`).value;
      }
    });
    let valor;
    if (apenasEx.checked) {
      // Apenas êxito: sem valor fixo, sem entrada, sem parcelas.
      const pct = Number(fd.exito_only_pct) || 0;
      if (!pct) { toast('Informe o percentual de êxito', 'error'); return; }
      honorarios.modalidades = ['exito'];
      honorarios.values = { exito: pct };
      honorarios.parcelamento = { total: 0 };
      honorarios.apenas_exito = true;
      valor = 0;
    } else {
      const pc = calcParcelas();
      honorarios.parcelamento = {
        total: pc.total, entrada: pc.entrada, entrada_data: fd.entrada_data || null,
        parcelas: pc.qtd, primeiro_vencimento: pc.venc || null,
        valor_parcela: pc.base, ultima_parcela: pc.ultima,
      };
      valor = pc.total || ((Number(honorarios.values.entrada) || 0) + (Number(honorarios.values.fixo) || 0));
    }
    const body = {
      contact_name: fd.contact_name, cpf: fd.cpf, phone: fd.phone, email: fd.email,
      partner_lawyers: String(fd.partner_lawyers || '').trim() || null,
      client_id: fd.client_id || undefined, lead_id: lead?.id,
      legal_area: fd.legal_area, tipo_causa: fd.tipo_causa, description: fd.description,
      validade: fd.validade || undefined, observacoes: fd.observacoes,
      dependentes, honorarios, valor,
      title: `Proposta — ${fd.contact_name || fd.tipo_causa || 'cliente'}`,
    };
    if (!body.client_id) delete body.client_id;
    try {
      if (existing) {
        await api(`/api/propostas/${existing.id}`, { method: 'PUT', body: JSON.stringify(body) });
        toast('Proposta atualizada');
      } else {
        await api('/api/propostas', { method: 'POST', body: JSON.stringify(body) });
        toast('Proposta criada');
      }
      closeModal(); onSave && onSave();
    } catch (err) { toast(err.message, 'error'); }
  };
  openModal('Produção da Proposta', form);
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
    <div>Status atual: ${badge(p.status)}${p.aceito_em ? ' · <span class="badge ativo">aceita pelo cliente</span>' : ''}</div>
    <div class="prop-share">
      <strong style="font-size:13px">Link para enviar ao cliente</strong>
      <div class="form-row" style="margin-top:6px">
        <input id="prop-link" readonly value="" style="flex:1;font-size:12px">
        <button class="btn-sm" id="prop-copy" type="button">Copiar</button>
        <button class="btn-gold btn-sm" id="prop-wpp" type="button">WhatsApp</button>
        <button class="btn-sm" id="prop-email" type="button">E-mail</button>
        <button class="btn-sm" id="prop-pdf" type="button">Baixar PDF</button>
      </div>
    </div>
    ${parcelasHtml}
    ${isAceita ? '' : `
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-sm" id="edit-prop">${svgIcon('edit')} Editar proposta</button>
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

  // Link público para o cliente
  (async () => {
    try {
      const { token } = await api(`/api/propostas/${id}/share`, { method: 'POST', body: '{}' });
      const link = `${location.origin}/proposta.html?t=${token}`;
      const input = form.querySelector('#prop-link');
      input.value = link;
      form.querySelector('#prop-copy').onclick = async () => {
        try { await navigator.clipboard.writeText(link); toast('Link copiado'); }
        catch { input.select(); document.execCommand('copy'); toast('Link copiado'); }
      };
      form.querySelector('#prop-wpp').onclick = () => {
        const msg = `Olá${p.contact_name ? ', ' + p.contact_name.split(' ')[0] : ''}! Segue a sua proposta de honorários: ${link}`;
        const phone = (p.phone || '').replace(/\D/g, '');
        const wa = phone ? `https://wa.me/55${phone}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
        window.open(wa, '_blank');
      };
      form.querySelector('#prop-pdf').onclick = () => window.open(link + '&pdf=1', '_blank');
      form.querySelector('#prop-email').onclick = async () => {
        let to = (p.email || '').trim();
        if (!to) to = (prompt('E-mail do cliente para enviar a proposta:') || '').trim();
        if (!to) return;
        try { const r = await api(`/api/propostas/${id}/send-email`, { method: 'POST', body: JSON.stringify({ email: to }) });
          toast('Proposta enviada para ' + r.to); }
        catch (e) { toast(e.message === 'Envio de e-mail ainda não configurado no servidor (SMTP).' ? 'E-mail ainda não configurado (Configurações do servidor)' : e.message, 'error'); }
      };
    } catch { const inp = form.querySelector('#prop-link'); if (inp) inp.value = 'erro ao gerar link'; }
  })();

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
  const editPropBtn = form.querySelector('#edit-prop');
  if (editPropBtn) editPropBtn.onclick = () => { closeModal(); propostaForm(onSave, null, p); };
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

const FICHA_STAGE = { separacao_documentos: 'Separação de documentos', criacao_inicial: 'Criação inicial', revisao_inicial: 'Revisão inicial', aguardando_protocolo: 'Aguardando protocolo', protocolado: 'Protocolado', concluido: 'Concluído' };

function buildFichaHtml(f) {
  const c = f.case || {}, cl = f.client || {};
  let labels = []; try { labels = Array.isArray(c.production_labels) ? c.production_labels : (c.production_labels ? JSON.parse(c.production_labels) : []); } catch {}
  const KIND = { observacao: 'Observação', pendencia: 'Pendência', atualizacao: 'Atualização' };
  const row = (k, v) => v ? `<div><strong>${k}:</strong> ${esc(v)}</div>` : '';
  const sec = (t, body) => `<h3 style="margin:16px 0 6px;color:var(--navy);border-bottom:1px solid var(--border);padding-bottom:3px">${t}</h3>${body}`;
  const slaTxt = c.production_started_at && !['protocolado', 'concluido'].includes(c.production_stage) ? ` · SLA ${Math.max(0, Math.floor((Date.now() - new Date(c.production_started_at)) / 86400000))}/10d` : '';
  const notes = (f.notes || []).map((n) => `<div style="padding:4px 0;border-bottom:1px solid var(--border-soft)"><span style="font-size:10px;background:#eef2f8;padding:1px 6px;border-radius:8px">${KIND[n.kind] || n.kind}${n.resolved ? ' ✓' : ''}</span> ${esc(n.text)}<br><small style="color:var(--text-muted)">${esc(n.author_name || '')} · ${fmtDate(n.created_at)}</small></div>`).join('') || '<small style="color:var(--text-muted)">—</small>';
  const movs = (f.movements || []).map((m) => `<div style="padding:4px 0"><small style="color:var(--text-muted)">${fmtDate(m.movement_date || m.created_at)}</small> ${esc(m.description)}</div>`).join('') || '<small style="color:var(--text-muted)">—</small>';
  const praz = (f.deadlines || []).map((d) => `<div>${fmtDate(d.deadline_date)} — ${esc(d.description)} <span style="color:var(--text-muted)">(${esc(d.status)})</span></div>`).join('') || '<small style="color:var(--text-muted)">—</small>';
  const docs = (f.documents || []).map((d) => `<div>${esc(d.name)} <small style="color:var(--text-muted)">(${esc(d.folder || d.type || '')} · ${esc(d.status || '')})</small></div>`).join('') || '<small style="color:var(--text-muted)">—</small>';
  const parc = (f.installments || []).map((p) => `<div>${p.numero}ª — ${money(p.valor)} · venc. ${fmtDate(p.due_date)} · ${esc(p.status)}</div>`).join('');
  const rec = (f.receitas || []).map((r) => `<div>${esc(r.description)} — ${money(r.valor)} · ${esc(r.status)}</div>`).join('');
  const fin = (parc + rec) || '<small style="color:var(--text-muted)">—</small>';
  return `
    ${sec('Qualificação (cabeçalho da peça)', `<div style="white-space:pre-wrap;font-size:13px">${esc(f.header && f.header.qualificacao || '—')}</div>`)}
    ${sec('Cliente', row('Nome', cl.name) + row('CPF/CNPJ', cl.cpf_cnpj) + row('E-mail', cl.email) + (cl.phone ? `<div><strong>Telefone:</strong> ${esc(cl.phone)} ${waBtn(cl.phone, 'WhatsApp')}</div>` : '') + row('Endereço', cl.address))}
    ${sec('Processo', row('Título', c.title) + (c.case_number ? `<div><strong>Número:</strong> ${procNumHtml(c.case_number)}</div>` : '') + row('Área', c.legal_area) + row('Fase', c.phase) + row('Etapa de produção', FICHA_STAGE[c.production_stage] || '—') + slaTxt + row('Responsável', c.assignee_name) + row('Parceiro', c.partner_name) + (labels.length ? `<div><strong>Etiquetas:</strong> ${labels.map(esc).join(', ')}</div>` : ''))}
    ${f.case_summary ? sec('Resumo do caso', `<div style="white-space:pre-wrap;font-size:13px">${esc(f.case_summary)}</div>`) : ''}
    ${sec('Histórico de produção', notes)}
    ${sec('Andamentos processuais', movs)}
    ${sec('Prazos', praz)}
    ${sec('Documentos', docs)}
    ${sec('Financeiro', fin)}`;
}

async function fichaCompleta(id) {
  const f = await api(`/api/cases/${id}/ficha`).catch(() => null);
  if (!f) { toast('Não foi possível carregar a ficha', 'error'); return; }
  const html = buildFichaHtml(f);
  const wrap = el(`<div>
    <div style="display:flex;gap:6px;margin-bottom:8px">
      <button class="btn-sm" id="ficha-print" type="button">${svgIcon('printer')}Imprimir / PDF</button>
      <button class="btn-sm" id="ficha-copy" type="button">Copiar</button>
    </div>
    <div id="ficha-body" style="max-height:65vh;overflow:auto">${html}</div>
  </div>`);
  wrap.querySelector('#ficha-print').onclick = () => printBranded(
    `Ficha do Processo — ${f.case && f.case.title || ''}`,
    `${f.client && f.client.name || ''} · ${f.case && f.case.case_number || 's/ número'}`, html);
  wrap.querySelector('#ficha-copy').onclick = () => {
    try { navigator.clipboard.writeText(wrap.querySelector('#ficha-body').innerText); toast('Ficha copiada'); } catch { toast('Copie manualmente', 'error'); }
  };
  openModal('Ficha completa do processo', wrap);
}

function buildClientFichaHtml(f) {
  const c = f.client || {};
  const sec = (t, body) => `<h3 style="margin:16px 0 6px;color:var(--navy);border-bottom:1px solid var(--border);padding-bottom:3px">${t}</h3>${body}`;
  const row = (k, v) => v ? `<div><strong>${k}:</strong> ${esc(v)}</div>` : '';
  const fin = f.financeiro || {};
  const areaChip = (a) => a ? `<span style="font-size:11px;font-weight:700;background:var(--gold-soft,#efe3c8);color:var(--navy);padding:2px 9px;border-radius:10px;white-space:nowrap">${esc(AREA_LABELS[a] || a)}</span>` : '';
  const cases = (f.cases || []).map((x) => `<div style="padding:7px 0;border-bottom:1px solid var(--border-soft)">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span>Nº do processo: ${procNumHtml(x.case_number)}</span>
        ${areaChip(x.legal_area)}
      </div>
      <div style="margin-top:2px"><strong>${esc(x.title || 'Processo')}</strong> <small style="color:var(--text-muted)">${x.production_stage ? (FICHA_STAGE[x.production_stage] || x.production_stage) + ' · ' : ''}${esc(x.status)}</small></div>
    </div>`).join('') || '<small style="color:var(--text-muted)">—</small>';
  const parc = (f.installments || []).filter((p) => p.status !== 'pago').map((p) => `<div>${p.numero}ª — ${money(p.valor)} · venc. ${fmtDate(p.due_date)} · ${esc(p.status)}</div>`).join('') || '<small style="color:var(--text-muted)">nenhuma em aberto</small>';
  const docs = (f.documents || []).map((d) => `<div>${esc(d.name)} <small style="color:var(--text-muted)">(${esc(d.folder || d.type || '')})</small></div>`).join('') || '<small style="color:var(--text-muted)">—</small>';
  const tl = (f.timeline || []).map((t) => `<div style="padding:3px 0"><small style="color:var(--text-muted)">${fmtDate(t.created_at)}</small> ${esc(t.description)}</div>`).join('') || '<small style="color:var(--text-muted)">—</small>';
  return `
    ${sec('Qualificação (cabeçalho da peça)', `<div style="white-space:pre-wrap;font-size:13px">${esc(f.header && f.header.qualificacao || '—')}</div>`)}
    ${sec('Cadastro', row('Nome', c.name) + row('Tipo', c.tipo) + row('CPF/CNPJ', c.cpf_cnpj) + row('E-mail', c.email) + (c.phone ? `<div><strong>Telefone:</strong> ${esc(c.phone)} ${waBtn(c.phone, 'WhatsApp')}</div>` : '') + row('Endereço', c.address) + row('Status', c.status) + (areaChipsHtml(c.areas) ? `<div style="margin-top:3px"><strong>Áreas:</strong> ${areaChipsHtml(c.areas)}</div>` : '') + (c.notes ? `<div style="margin-top:3px"><strong>Obs.:</strong> ${esc(c.notes)}</div>` : ''))}
    ${f.case_summary ? sec('Resumo (do lead)', `<div style="white-space:pre-wrap;font-size:13px">${esc(f.case_summary)}</div>`) : ''}
    ${sec('Processos', cases)}
    ${sec('Financeiro', `<div>A receber: <strong>${money(fin.a_receber)}</strong> · Recebido: <strong>${money(fin.pago)}</strong></div><div style="margin-top:4px">${parc}</div>`)}
    ${sec('Documentos', docs)}
    ${sec('Linha do tempo', tl)}`;
}

async function fichaCliente(id, onSave) {
  const f = await api(`/api/clients/${id}/ficha`).catch(() => null);
  if (!f) { toast('Não foi possível carregar a ficha', 'error'); return; }
  const html = buildClientFichaHtml(f);
  const wrap = el(`<div>
    <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
      <button class="btn-gold btn-sm" id="fc-edit" type="button">${svgIcon('edit')}Editar cadastro</button>
      <button class="btn-sm" id="fc-print" type="button">${svgIcon('printer')}Imprimir / PDF</button>
      <button class="btn-sm" id="fc-copy" type="button">Copiar</button>
    </div>
    <div id="fc-body" style="max-height:65vh;overflow:auto">${html}</div>
  </div>`);
  wrap.querySelector('#fc-edit').onclick = () => { closeModal(); clientForm(id, onSave); };
  wrap.querySelector('#fc-print').onclick = () => printBranded(
    `Ficha do Cliente — ${f.client && f.client.name || ''}`,
    `${f.client && f.client.tipo || ''}${f.client && f.client.cpf_cnpj ? ' · ' + f.client.cpf_cnpj : ''}`, html);
  wrap.querySelector('#fc-copy').onclick = () => { try { navigator.clipboard.writeText(wrap.querySelector('#fc-body').innerText); toast('Ficha copiada'); } catch { toast('Copie manualmente', 'error'); } };
  openModal('Ficha do cliente', wrap);
}

// Conteúdo da "gaveta" expansível de um caso de parceria (usa a ficha consolidada).
function parcDrawerHtml(f, partnerName) {
  const c = f.case || {};
  const STAGE_PT = { separacao_documentos: 'Separação de docs', criacao_inicial: 'Criação inicial', revisao_inicial: 'Revisão inicial', aguardando_protocolo: 'Aguardando protocolo', protocolado: 'Protocolado', concluido: 'Concluído' };
  const insts = (f.installments || []).map((i) => `<div class="mini-row"><span>${i.numero ? i.numero + 'ª' : 'Parcela'} · venc. ${fmtDate(i.due_date)}</span><span><strong>${money(i.valor)}</strong> ${badge(i.status)}</span></div>`).join('');
  const recs = (f.receitas || []).map((r) => `<div class="mini-row"><span>${esc(r.description || r.tipo || '—')}</span><span><strong>${money(r.valor)}</strong> ${badge(r.status)}</span></div>`).join('');
  const fin = (insts + recs) || '<small style="color:var(--text-muted)">Sem lançamentos</small>';
  const movs = (f.movements || []).slice(0, 20).map((m) => `<div style="padding:7px 0;border-bottom:1px solid var(--border-soft)"><small style="color:var(--text-muted)">${fmtDate(m.movement_date || m.created_at)}</small><div style="font-size:13px">${esc(m.description)}</div></div>`).join('') || '<small style="color:var(--text-muted)">Sem movimentações</small>';
  const prazos = (f.deadlines || []).map((d) => `<div class="mini-row"><span>${esc(d.description || '')}</span><span>${fmtDate(d.deadline_date)} ${badge(d.status)}</span></div>`).join('') || '<small style="color:var(--text-muted)">Sem prazos</small>';
  return `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
      <span class="badge" style="background:var(--gold-soft,#efe3c8);color:var(--navy)">Parceria com ${esc(partnerName)}</span>
      <span class="badge">${STAGE_PT[c.production_stage] || c.production_stage || '—'}</span>
      ${c.case_number ? `<span class="badge protocolado" style="background:#e3f0e6;color:var(--green)">nº ${esc(c.case_number)}</span>` : ''}
    </div>
    ${f.header && f.header.qualificacao ? `<div style="font-size:12.5px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px;margin-bottom:10px"><strong style="color:var(--navy)">Ficha do cliente:</strong> ${esc(f.header.qualificacao)}</div>` : ''}
    ${f.case_summary ? `<div class="client-msg" style="margin-bottom:10px">${esc(f.case_summary)}</div>` : ''}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px">
      <div><strong style="font-size:12px;color:var(--navy)">Financeiro do processo</strong><div style="margin-top:6px">${fin}</div></div>
      <div><strong style="font-size:12px;color:var(--navy)">Prazos</strong><div style="margin-top:6px">${prazos}</div></div>
    </div>
    <div style="margin-top:12px"><strong style="font-size:12px;color:var(--navy)">Movimentações</strong><div style="max-height:220px;overflow:auto;margin-top:6px">${movs}</div></div>
    <div style="margin-top:12px"><button class="btn-gold btn-sm" type="button" data-openfull="${c.id}">Abrir ficha completa</button></div>`;
}
function bindParcDrawer(drawer, id, onSave) {
  const b = drawer.querySelector('[data-openfull]');
  if (b) b.onclick = () => caseDetail(id, onSave);
}

async function caseDetail(id, onSave) {
  const c = await api('/api/cases/' + id);
  const movs = (c.movements || []).map((m) =>
    `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
      <small style="color:var(--text-muted)">${fmtDate(m.movement_date || m.created_at)}</small>
      <div>${m.description}</div></div>`).join('') || '<p class="empty">Sem movimentações</p>';
  const PROD_STAGES = [['separacao_documentos','Separação de documentos'],['criacao_inicial','Criação inicial'],['revisao_inicial','Revisão inicial'],['aguardando_protocolo','Aguardando protocolo'],['protocolado','Protocolado'],['concluido','Concluído']];
  let prodHtml = '';
  if (c.production_stage) {
    const idx = PROD_STAGES.findIndex(([v]) => v === c.production_stage);
    const steps = PROD_STAGES.map(([v,t],i) => {
      const state = i < idx ? 'done' : i === idx ? 'cur' : 'todo';
      return `<div class="prod-step ${state}"><span class="dot">${i < idx ? '✓' : i + 1}</span><span class="lbl">${t}</span></div>`;
    }).join('<span class="prod-step-sep">›</span>');
    const next = PROD_STAGES[idx+1];
    prodHtml = `<hr style="border:none;border-top:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:center"><strong style="font-size:13px;color:var(--navy-deep)">Esteira de produção</strong><small style="color:var(--text-muted)">Etapa ${idx + 1} de ${PROD_STAGES.length}</small></div>
      <div class="prod-stepper">${steps}</div>
      ${next ? `<button class="btn-gold btn-advance" id="adv-stage" data-next="${next[0]}">Avançar para “${next[1]}” →</button>` : '<div style="text-align:center;padding:10px;color:var(--green);font-weight:600">✓ Esteira concluída</div>'}`;
  }
  const form = el(`<div class="form-grid">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
      <div style="min-width:0">
        <strong style="font-size:20px;color:var(--navy-deep);line-height:1.25;display:block">${c.title}</strong>
        <small style="color:var(--text-muted)">${c.client_name || ''} · ${c.case_number || 's/ número'}</small>
        <div style="margin-top:9px;display:flex;gap:6px;flex-wrap:wrap">${badge(c.legal_area)} ${badge(c.phase)} ${badge(c.status)} ${c.production_stage ? badge(c.production_stage) : ''} ${c.partner_name ? `<span class="badge" style="background:var(--gold-soft,#efe3c8);color:var(--navy)">Parceria com ${esc(c.partner_name)}</span>` : ''}</div>
      </div>
      <button class="btn-gold btn-sm" id="ficha-btn" type="button" style="white-space:nowrap;flex:0 0 auto">${svgIcon('clipboard')} Ficha completa</button>
    </div>
    ${prodHtml}
    ${c.production_stage ? '<div id="case-checklist"></div><div id="prod-panel"><div class="spinner"></div></div>' : ''}
    <hr style="border:none;border-top:1px solid var(--border)">
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <select id="case-phase">${PHASES.map((p)=>`<option value="${p.v}" ${p.v===c.phase?'selected':''}>${p.t}</option>`).join('')}</select>
      <button class="btn-sm" id="upd-phase">Atualizar fase</button>
      <button class="btn-sm" id="gerar-peca" type="button">${svgIcon('ia', 'ic-xs')} Gerar peça</button>
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

  // Gerar peça por tipo, com os dados do caso (usa modelos do escritório se houver)
  const pecaBtn = form.querySelector('#gerar-peca');
  if (pecaBtn) pecaBtn.onclick = async () => {
    const tpls = await api('/api/ai/templates').catch(() => []);
    if (!tpls.length) { toast('Nenhum tipo de peça disponível', 'error'); return; }
    const pf = el(`<form class="form-grid">
      ${field('Tipo de peça', 'type', { options: tpls.map((t) => ({ v: t.value || t.type, t: t.label })) })}
      <p class="sub">A IA usa os dados do caso, do cliente e — se existir — o SEU modelo desse tipo de peça. A minuta fica em IA Jurídica e pode ser salva nos Documentos.</p>
      <button type="submit" class="btn-primary">Gerar minuta</button>
    </form>`);
    pf.onsubmit = async (ev) => {
      ev.preventDefault();
      const tipo = pf.querySelector('[name=type]').value;
      const btn = pf.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Gerando…';
      try {
        const r = await api('/api/ai/generate', { method: 'POST', body: JSON.stringify({ type: tipo, client_id: c.client_id, case_id: id }) });
        closeModal();
        if (r.auto && r.result) toast('✓ Minuta gerada — confira em IA Jurídica');
        else toast('Prompt preparado em IA Jurídica (IA automática indisponível)', 'error');
        location.hash = '#ia';
      } catch (e) { toast(e.message, 'error'); btn.disabled = false; btn.textContent = 'Gerar minuta'; }
    };
    openModal('Gerar peça deste caso', pf);
  };

  // Checklist de documentos por tipo de ação (tudo verde = pode iniciar a petição)
  const ckBox = form.querySelector('#case-checklist');
  if (ckBox) {
    const renderChecklist = (ck) => {
      if (!ck || !ck.itens.length) return;
      const completo = ck.completos === ck.total;
      ckBox.innerHTML = `
        <div style="border:1px solid ${completo ? 'var(--green)' : 'var(--border)'};border-radius:var(--radius);padding:14px 16px;margin-top:6px">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <strong style="font-size:13px;color:var(--navy-deep)">Checklist — ${esc(ck.titulo)}</strong>
            <span class="badge" style="${completo ? 'background:#e3f0e6;color:var(--green)' : ''}">${ck.completos}/${ck.total} ${completo ? '· pronto para a petição ✓' : ''}</span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:4px 16px;margin-top:10px">
            ${ck.itens.map((i, idx) => `<div style="font-size:12.5px;display:flex;gap:7px;align-items:baseline;cursor:pointer;user-select:none" class="ck-item" data-idx="${idx}" data-label="${esc(i.label)}" data-done="${i.done}" title="${i.doc ? 'Documento detectado: ' + i.doc : (i.manual ? 'Marcado manualmente' : 'Clique para marcar como recebido')}">
              <span style="color:${i.done ? 'var(--green)' : 'var(--text-muted)'};min-width:12px">${i.done ? (i.manual ? '☑' : '✓') : '□'}</span>
              <span style="${i.done ? (i.manual ? 'color:var(--navy)' : '') : 'color:var(--text-soft)'}">${esc(i.label)}</span></div>`).join('')}
          </div>
          <div style="margin-top:8px;font-size:11px;color:var(--text-muted)">Clique para marcar os documentos que já estão com você</div>
        </div>`;
      ckBox.querySelectorAll('.ck-item').forEach((el) => {
        el.onclick = async () => {
          const label = el.dataset.label;
          const done = el.dataset.done === 'true';
          if (el.dataset.doc) return; // detectado automaticamente — não altera
          try {
            await api(`/api/cases/${id}/checklist`, { method: 'PATCH', body: JSON.stringify({ label, checked: !done }) });
            const updated = await api(`/api/cases/${id}/checklist`);
            renderChecklist(updated);
          } catch {}
        };
      });
    };
    api(`/api/cases/${id}/checklist`).then(renderChecklist).catch(() => {});
  }

  const advBtn = form.querySelector('#adv-stage');
  if (advBtn) advBtn.onclick = async () => {
    const next = advBtn.dataset.next;
    const body = { stage: next };
    if (next === 'protocolado') {
      const num = prompt('Número do processo/protocolo (obrigatório para protocolar):');
      if (!num || !num.trim()) { toast('Número do processo é obrigatório', 'error'); return; }
      body.case_number = num.trim();
      const vc = prompt('Valor da causa (R$) — não definitivo, apenas registro do protocolado (deixe vazio para pular):');
      if (vc && vc.trim()) body.valor_causa = vc.trim();
    }
    try {
      const r = await api(`/api/cases/${id}/production-stage`, { method: 'PATCH', body: JSON.stringify(body) });
      closeModal(); toast('Etapa avançada'); onSave();
      if (r.credentials) showClientCredentials(r.credentials, r.case_number);
    } catch (e) { toast(e.message, 'error'); }
  };

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
  form.querySelector('#ficha-btn').onclick = () => fichaCompleta(id);

  // Painel de Produção — resumo, cabeçalho, etiquetas, responsável, pendências, log
  if (c.production_stage) {
    const panel = form.querySelector('#prod-panel');
    const KINDS = { observacao: 'Observação', pendencia: 'Pendência', atualizacao: 'Atualização' };
    const loadProd = async () => {
      const p = await api(`/api/cases/${id}/production`).catch(() => null);
      if (!p || !panel) { if (panel) panel.innerHTML = ''; return; }
      let labels = []; try { labels = Array.isArray(p.production_labels) ? p.production_labels : (p.production_labels ? JSON.parse(p.production_labels) : []); } catch {}
      const pend = (p.notes || []).filter((n) => n.kind === 'pendencia' && !n.resolved);
      const log = (p.notes || []).filter((n) => !(n.kind === 'pendencia' && !n.resolved));
      let assignOpts = '';
      if (USER.role === 'admin' || USER.role === 'advogado') {
        const users = await api('/api/users').catch(() => []);
        const able = users.filter((u) => ['estagiario', 'parceiro', 'advogado'].includes(u.role) && u.active);
        assignOpts = `<option value="">— responsável —</option>` + able.map((u) => `<option value="${u.id}" ${u.id == p.production_assignee ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
      }
      // Histórico unificado: jornada (lead → produção) + observações da produção, em ordem.
      const histItems = [
        ...(p.journey || []).map((j) => ({ when: j.created_at, who: j.actor_name, tag: 'Jornada', text: (j.title ? j.title + (j.description ? ': ' + j.description : '') : j.description) || j.event_type })),
        ...log.map((n) => ({ when: n.created_at, who: n.author_name, tag: KINDS[n.kind] || n.kind, text: n.text })),
      ].sort((a, b) => new Date(b.when) - new Date(a.when));
      const histHtml = histItems.length ? histItems.map((h) => `<div style="padding:6px 0;border-bottom:1px solid var(--border-soft)"><span style="font-size:10px;background:#eef2f8;padding:1px 6px;border-radius:8px">${esc(h.tag)}</span> <span style="font-size:13px">${esc(h.text)}</span><br><small style="color:var(--text-muted)">${esc(h.who || '')} · ${fmtDate(h.when)}</small></div>`).join('') : '<small style="color:var(--text-muted)">Sem registros</small>';
      // Documentos vinculados a este caso (petições, minutas, anexos…).
      const docs = (await api('/api/documents?client_id=' + (c.client_id || '')).catch(() => [])).filter((d) => d.case_id == id);
      const docsHtml = docs.length ? docs.map((d) => `<div style="padding:6px 0;border-bottom:1px solid var(--border-soft);display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap"><span style="font-size:13px">📄 ${esc(d.name)}<br><small style="color:var(--text-muted)">${esc(d.type || 'documento')} · ${esc(d.status || '')} · ${fmtDate(d.created_at)}</small></span><span style="display:flex;gap:4px;flex-wrap:wrap"><button class="btn-sm" type="button" data-vis="${d.id}" data-on="${Number(d.visible_to_client) ? 1 : 0}" title="Mostrar/ocultar no portal do cliente" ${Number(d.visible_to_client) ? 'style="border-color:var(--green);color:var(--green)"' : ''}>${Number(d.visible_to_client) ? 'Visível ao cliente ✓' : 'Liberar p/ cliente'}</button><button class="btn-gold btn-sm" type="button" data-doc="${d.id}">Abrir</button></span></div>`).join('') : '<small style="color:var(--text-muted)">Nenhum documento vinculado a este caso ainda.</small>';
      panel.innerHTML = `
        <hr style="border:none;border-top:1px solid var(--border)">
        <strong style="font-size:13px;color:var(--navy)">Produção — acompanhamento</strong>
        ${p.case_summary ? `<div style="margin-top:6px"><small style="color:var(--text-muted)">Resumo do caso (do lead)</small><div style="font-size:13px;white-space:pre-wrap;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px;margin-top:2px">${esc(p.case_summary)}</div><button class="btn-sm" id="copy-summary" type="button" style="margin-top:4px">Copiar resumo</button></div>` : ''}
        ${p.header && p.header.qualificacao ? `<div style="margin-top:6px"><small style="color:var(--text-muted)">Cabeçalho da peça (qualificação pronta)</small>
          <div style="font-size:12.5px;white-space:pre-wrap;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px;margin-top:2px">${esc(p.header.qualificacao)}</div>
          <button class="btn-sm" id="copy-header" type="button" style="margin-top:4px">Copiar cabeçalho</button></div>` : ''}
        ${assignOpts ? `<div style="margin-top:8px;display:flex;gap:6px;align-items:center"><small>Responsável:</small><select id="prod-assignee">${assignOpts}</select></div>` : ''}
        <div style="margin-top:8px"><small style="color:var(--text-muted)">Etiquetas</small>
          <div id="prod-labels" style="display:flex;flex-wrap:wrap;gap:4px;margin:4px 0">${labels.map((l, i) => `<span style="font-size:11px;background:var(--gold-soft,#efe3c8);color:var(--navy);padding:2px 8px;border-radius:10px">${esc(l)} <a href="#" data-rmlab="${i}" style="color:var(--red);text-decoration:none">×</a></span>`).join('') || '<small style="color:var(--text-muted)">nenhuma</small>'}</div>
          <div style="display:flex;gap:6px"><input id="prod-newlabel" placeholder="nova etiqueta" style="flex:1"><button class="btn-sm" type="button" id="prod-addlabel">+ etiqueta</button></div></div>
        <div style="margin-top:10px"><small style="color:var(--text-muted)">Pendências (falta algo?)</small>
          <div id="prod-pend">${pend.length ? pend.map((n) => `<div class="mini-row" style="padding:5px 0"><span>⚠ ${esc(n.text)}<br><small style="color:var(--text-muted)">${esc(n.author_name || '')} · ${fmtDate(n.created_at)}</small></span><button class="btn-sm" type="button" data-resolve="${n.id}">Resolver</button></div>`).join('') : '<small style="color:var(--green)">Sem pendências</small>'}</div>
          <div style="display:flex;gap:6px;margin-top:4px"><input id="prod-newpend" placeholder="o que falta…" style="flex:1"><button class="btn-sm" type="button" id="prod-addpend">+ pendência</button></div></div>
        <div style="margin-top:10px"><small style="color:var(--text-muted)">${svgIcon('note', 'ic-inline')}Observação do card (aparece na face do card no quadro)</small>
          <div style="display:flex;gap:6px;margin-top:4px"><textarea id="prod-obs" placeholder="ex.: cliente pediu urgência · aguardar laudo Dr. X" style="flex:1;min-height:46px;resize:vertical">${esc(p.production_obs || '')}</textarea><button class="btn-sm" type="button" id="prod-obs-save" style="align-self:flex-start">Salvar</button></div></div>
        <div style="margin-top:10px"><small style="color:var(--text-muted)">Pasta do Drive com os documentos deste caso — a IA lê, organiza e monta o checklist</small>
          <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap"><input id="prod-drive" placeholder="cole o link da pasta do Google Drive" value="${esc(p.drive_folder_url || '')}" style="flex:1;min-width:180px"><button class="btn-sm" type="button" id="prod-drive-save">Salvar</button>${p.partner_id ? `<button class="btn-sm" type="button" id="prod-reprocess-drive" title="Baixar anexos do e-mail da parceria e criar pasta no Drive">${svgIcon('download')} Baixar do e-mail</button>` : ''}<button class="btn-gold btn-sm" type="button" id="prod-analyze">${svgIcon('ia')}Analisar documentos</button></div>
          <div id="prod-analysis" style="margin-top:8px"></div></div>
        <div style="margin-top:10px"><small style="color:var(--text-muted)">Recado ao cliente (aparece no portal, em linguagem simples)</small>
          <div style="display:flex;gap:6px;margin-top:4px"><input id="prod-climsg" placeholder="ex.: Seu processo foi protocolado; agora aguardamos a resposta do INSS" value="${esc(p.client_message || '')}" style="flex:1"><button class="btn-sm" type="button" id="prod-climsg-save">Salvar</button></div></div>
        <div style="margin-top:10px"><div style="display:flex;justify-content:space-between;align-items:center"><small style="color:var(--text-muted)">${svgIcon('file', 'ic-inline')}Documentos do caso (peças, minutas, anexos)</small><button class="btn-sm btn-gold" type="button" id="prod-gen-peticao">${svgIcon('refresh')} Gerar nova versão da petição (IA)</button></div>
          <div id="prod-docs">${docsHtml}</div></div>
        <div style="margin-top:10px"><small style="color:var(--text-muted)">Histórico e atualizações do caso (do lead à produção)</small>
          <div style="max-height:240px;overflow:auto">${histHtml}</div>
          <div style="display:flex;gap:6px;margin-top:6px"><input id="prod-note" placeholder="acrescentar atualização ao caso…" style="flex:1"><button class="btn-primary btn-sm" type="button" id="prod-addnote">Adicionar</button></div></div>`;

      const saveLabels = async (arr) => { try { await api(`/api/cases/${id}/production-meta`, { method: 'PATCH', body: JSON.stringify({ labels: arr }) }); loadProd(); } catch (e) { toast(e.message, 'error'); } };
      const cp = panel.querySelector('#copy-header');
      if (cp) cp.onclick = () => { try { navigator.clipboard.writeText(p.header.qualificacao); toast('Cabeçalho copiado'); } catch { toast('Copie manualmente', 'error'); } };
      const cs = panel.querySelector('#copy-summary');
      if (cs) cs.onclick = () => { try { navigator.clipboard.writeText(p.case_summary || ''); toast('Resumo copiado'); } catch { toast('Copie manualmente', 'error'); } };
      const asg = panel.querySelector('#prod-assignee');
      if (asg) asg.onchange = async () => { try { await api(`/api/cases/${id}/production-meta`, { method: 'PATCH', body: JSON.stringify({ assignee: asg.value || null }) }); toast('Responsável atualizado'); } catch (e) { toast(e.message, 'error'); } };
      panel.querySelector('#prod-addlabel').onclick = () => { const v = panel.querySelector('#prod-newlabel').value.trim(); if (v) saveLabels([...labels, v]); };
      panel.querySelectorAll('[data-rmlab]').forEach((a) => a.onclick = (e) => { e.preventDefault(); saveLabels(labels.filter((_, i) => i != a.dataset.rmlab)); });
      panel.querySelector('#prod-addpend').onclick = async () => { const v = panel.querySelector('#prod-newpend').value.trim(); if (!v) return; try { await api(`/api/cases/${id}/production-notes`, { method: 'POST', body: JSON.stringify({ kind: 'pendencia', text: v }) }); loadProd(); } catch (e) { toast(e.message, 'error'); } };
      panel.querySelectorAll('[data-resolve]').forEach((b) => b.onclick = async () => { try { await api(`/api/cases/production-notes/${b.dataset.resolve}/resolve`, { method: 'PATCH', body: '{}' }); loadProd(); } catch (e) { toast(e.message, 'error'); } });
      panel.querySelector('#prod-addnote').onclick = async () => { const v = panel.querySelector('#prod-note').value.trim(); if (!v) return; try { await api(`/api/cases/${id}/contexto`, { method: 'POST', body: JSON.stringify({ text: v }) }); toast('Atualização adicionada'); loadProd(); } catch (e) { toast(e.message, 'error'); } };
      const dsave = panel.querySelector('#prod-drive-save');
      if (dsave) dsave.onclick = async () => { try { await api(`/api/cases/${id}/production-meta`, { method: 'PATCH', body: JSON.stringify({ drive_folder_url: panel.querySelector('#prod-drive').value.trim() }) }); toast('Pasta do Drive salva — será lida ao gerar a petição'); } catch (e) { toast(e.message, 'error'); } };
      const obsSave = panel.querySelector('#prod-obs-save');
      if (obsSave) obsSave.onclick = async () => { try { await api(`/api/cases/${id}/production-meta`, { method: 'PATCH', body: JSON.stringify({ production_obs: panel.querySelector('#prod-obs').value }) }); toast('Observação salva — aparece na face do card'); } catch (e) { toast(e.message, 'error'); } };
      const cmsave = panel.querySelector('#prod-climsg-save');
      if (cmsave) cmsave.onclick = async () => { try { await api(`/api/cases/${id}/production-meta`, { method: 'PATCH', body: JSON.stringify({ client_message: panel.querySelector('#prod-climsg').value.trim() }) }); toast('Recado salvo — visível no portal do cliente'); } catch (e) { toast(e.message, 'error'); } };
      panel.querySelectorAll('[data-vis]').forEach((b) => b.onclick = async () => {
        const on = b.dataset.on !== '1';
        try { await api(`/api/documents/${b.dataset.vis}`, { method: 'PUT', body: JSON.stringify({ visible_to_client: on }) }); toast(on ? 'Documento liberado no portal do cliente' : 'Documento oculto do portal'); loadProd(); }
        catch (e) { toast(e.message, 'error'); }
      });
      const dreprocess = panel.querySelector('#prod-reprocess-drive');
      if (dreprocess) dreprocess.onclick = async () => {
        dreprocess.disabled = true; dreprocess.textContent = 'Baixando…';
        try {
          const r = await api(`/api/email-intake/reprocess-drive/${id}`, { method: 'POST', body: '{}' });
          const g = r.gmail;
          const falhas = g && g.cloudFalhos ? g.cloudFalhos.length : 0;
          if (r.anexos > 0) {
            toast(`Drive sincronizado · ${r.anexos} arquivo(s) baixado(s)${falhas ? ` · ${falhas} link(s) de nuvem falharam` : ''}`);
          } else if (g && g.erro) {
            toast(`Gmail: ${g.erro}`, 'error');
          } else if (g && g.emails === 0) {
            toast('Nenhum e-mail do parceiro menciona este cliente (verifique o nome cadastrado)', 'error');
          } else if (falhas > 0) {
            toast(`${falhas} arquivo(s) estão como link de nuvem e não puderam ser baixados`, 'error');
          } else if (g && (g.encontrados > 0 || g.cloudLinks > 0) && g.pulados >= (g.encontrados + (g.cloudLinks || 0))) {
            toast(`Todos os arquivos já estão no Drive — nada novo a baixar`);
          } else {
            toast('E-mail localizado, mas sem arquivos identificados', 'error');
          }
          if (g) {
            console.log('[reprocess-drive] diag:', { anexos: r.anexos, encontrados: g.encontrados, pulados: g.pulados, cloudLinks: g.cloudLinks, cloudFalhos: g.cloudFalhos, assuntos: g.assuntos, query: g.query });
            if (g.arvore && g.arvore.length) console.log('[reprocess-drive] árvore MIME:\n' + g.arvore.join('\n'));
          }
          if (r.folderUrl) { panel.querySelector('#prod-drive').value = r.folderUrl; }
          loadProd();
        } catch (e) { toast(e.message || 'Erro ao sincronizar Drive', 'error'); }
        finally { dreprocess.disabled = false; dreprocess.textContent = '📥 Baixar do e-mail'; }
      };
      const danalyze = panel.querySelector('#prod-analyze');
      if (danalyze) danalyze.onclick = async () => {
        const url = panel.querySelector('#prod-drive').value.trim();
        if (!url) { toast('Cole o link da pasta do Drive primeiro', 'error'); return; }
        const out = panel.querySelector('#prod-analysis');
        const orig = danalyze.innerHTML; danalyze.disabled = true; danalyze.textContent = 'Analisando…';
        out.innerHTML = '<div class="spinner"></div>';
        try {
          await api(`/api/cases/${id}/production-meta`, { method: 'PATCH', body: JSON.stringify({ drive_folder_url: url }) });
          const r = await api(`/api/cases/${id}/analisar-documentos`, { method: 'POST' });
          if (r.ok) {
            toast(`Análise pronta — ${r.imported || 0} novo(s) do Drive · ${r.docsLidos || 0} documento(s) lido(s)`);
            out.innerHTML = `<div style="border:1px solid var(--border);border-radius:12px;background:var(--surface);padding:14px 16px;max-height:60vh;overflow:auto">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><strong style="color:var(--navy)">Análise do caso (checklist)</strong>
                  <small style="color:var(--text-muted)">salvo em Documentos do caso</small></div>
                <div style="white-space:pre-wrap;font-size:13px;line-height:1.6">${esc(r.text)}</div></div>`;
            loadProd();
          } else { out.innerHTML = ''; toast('Não foi possível analisar: ' + (r.message || ''), 'error'); }
        } catch (e) { out.innerHTML = ''; toast(e.message, 'error'); }
        danalyze.disabled = false; danalyze.innerHTML = orig;
      };
      const genBtn = panel.querySelector('#prod-gen-peticao');
      if (genBtn) genBtn.onclick = async () => {
        genBtn.disabled = true; genBtn.textContent = 'Gerando com IA…';
        try { const r = await api(`/api/cases/${id}/peticao-inicial`, { method: 'POST', body: '{}' }); toast(`✓ Petição v${r.version || ''} gerada`); loadProd(); }
        catch (e) { toast(e.message, 'error'); genBtn.disabled = false; genBtn.textContent = '🔄 Gerar nova versão da petição (IA)'; }
      };
      panel.querySelectorAll('[data-doc]').forEach((b) => b.onclick = async () => {
        try {
          const g = await api('/api/documents/' + b.dataset.doc);
          const body = el(`<div>
            <div style="font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word;max-height:62vh;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:12px;background:var(--surface)">${esc(g.content || g.file_url || '(sem conteúdo)')}</div>
            <div style="display:flex;gap:6px;margin-top:8px">${g.content ? '<button class="btn-sm" id="doc-copy2" type="button">Copiar</button><button class="btn-gold btn-sm" id="doc-print2" type="button">Imprimir / PDF</button>' : ''}</div>
          </div>`);
          openModal(g.name || 'Documento', body);
          const cpy = body.querySelector('#doc-copy2'); if (cpy) cpy.onclick = () => { try { navigator.clipboard.writeText(g.content || ''); toast('Copiado'); } catch { toast('Copie manualmente', 'error'); } };
          const prt = body.querySelector('#doc-print2'); if (prt) prt.onclick = () => { const w = window.open('', '_blank'); w.document.write(`<html><head><title>${esc(g.name || 'Documento')}</title></head><body style="font-family:Georgia,serif;line-height:1.7;max-width:720px;margin:48px auto;padding:0 24px;white-space:pre-wrap;color:#231E1A">${(g.content || '').replace(/</g, '&lt;')}</body></html>`); w.document.close(); w.focus(); setTimeout(() => w.print(), 300); };
        } catch (e) { toast(e.message, 'error'); }
      });
    };
    loadProd();
  }

  openModal('Processo', form, { wide: true });
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

async function eventDetail(item, onSave) {
  const isEvent = ['reuniao', 'audiencia', 'compromisso'].includes(item.type);
  const labels = { reuniao: 'Reunião', audiencia: 'Audiência', compromisso: 'Compromisso', prazo: 'Prazo', tarefa: 'Tarefa' };
  let full = item;
  if (isEvent) { try { full = await api(`/api/calendar/events/${item.id}`); } catch {} }
  const ini = new Date(full.start_datetime || item.datetime);
  const fim = full.end_datetime ? new Date(full.end_datetime) : null;
  const hh = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const line = (lbl, val) => val ? `<div class="evt-line"><span>${lbl}</span><strong>${val}</strong></div>` : '';

  const body = el(`<div class="evt-detail">
    <div class="evt-type ${item.type}">${labels[item.type] || item.type}</div>
    <h3 class="evt-title">${full.title || item.title}</h3>
    ${line('Data', ini.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }))}
    ${line('Horário', hh(ini) + (fim ? ` – ${hh(fim)}` : ''))}
    ${line('Cliente', full.client_name || item.client_name)}
    ${line('Local', full.location)}
    ${full.description ? `<div class="evt-desc">${full.description}</div>` : ''}
    ${full.video_link ? `<a class="btn-gold" href="${full.video_link}" target="_blank" rel="noopener" style="display:inline-block;margin-top:10px">Entrar na reunião</a>` : ''}
    ${isEvent ? `<div class="evt-actions"><button class="btn-sm" id="evt-del">Excluir evento</button></div>` : '<p class="sub" style="margin-top:12px">Gerencie prazos e tarefas na tela Prazos &amp; Tarefas.</p>'}
  </div>`);

  if (isEvent) body.querySelector('#evt-del').onclick = async () => {
    if (!confirm('Excluir este evento? Ele também sai do Google Agenda.')) return;
    try { await api(`/api/calendar/events/${item.id}`, { method: 'DELETE' }); closeModal(); toast('Evento excluído'); onSave && onSave(); }
    catch (e) { toast(e.message, 'error'); }
  };
  openModal('Detalhes', body);
}

async function eventForm(onSave, prefillDate) {
  const clients = await api('/api/clients?limit=100');
  const startVal = prefillDate ? `${prefillDate}T09:00` : '';
  const endVal   = prefillDate ? `${prefillDate}T10:00` : '';
  const form = el(`<form class="form-grid">
    ${field('Título *', 'title')}
    ${field('Tipo', 'event_type', { options: [['compromisso','Compromisso'],['reuniao','Reunião'],['audiencia','Audiência']].map(([v,t])=>({v,t})) })}
    ${field('Cliente', 'client_id', { options: [{ v: '', t: '— nenhum —' }, ...clients.data.map((c) => ({ v: c.id, t: c.name }))] })}
    <div class="form-row">${field('Início *', 'start_datetime', { type: 'datetime-local', value: startVal })}${field('Fim', 'end_datetime', { type: 'datetime-local', value: endVal })}</div>
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

const AUDIT_ENTIDADE_PT = { Receita: 'Receita', Installment: 'Parcela', Parcela: 'Parcela', Expense: 'Despesa', Agreement: 'Acordo', Repasse: 'Repasse' };
const AUDIT_ACAO_PT = { create: 'Criação', created: 'Criação', update: 'Edição', updated: 'Edição', delete: 'Exclusão', deleted: 'Exclusão', pay: 'Baixa', paid: 'Baixa', cancel: 'Cancelamento', reschedule: 'Reagendamento', status_change: 'Mudança de status' };

// ── Financeiro → Pagamentos a confirmar (informados pelos clientes no portal) ─
async function finPagamentos(c) {
  const rows = await api('/api/payments?status=em_processamento');
  c.innerHTML = `
    <p class="sub" style="margin-bottom:14px">Pagamentos que os clientes marcaram como pagos no portal. Confira o extrato e dê a baixa (ou recuse).</p>
    ${rows.length ? `
    <div class="card"><table><thead><tr><th>Cliente</th><th>Parcela</th><th>Valor</th><th>Informado em</th><th>Obs.</th><th></th></tr></thead>
    <tbody>${rows.map((p) => `<tr>
      <td><strong>${esc(p.client_name)}</strong></td>
      <td>${p.numero ? p.numero + 'ª' : '—'}${p.proposta ? `<br><small style="color:var(--text-muted)">${esc(p.proposta)}</small>` : ''}<br><small style="color:var(--text-muted)">venc. ${fmtDate(p.due_date)}</small></td>
      <td><strong>${money(p.amount)}</strong></td><td>${fmtDate(p.created_at)}</td><td>${esc(p.note || '—')}</td>
      <td style="white-space:nowrap"><button class="btn-gold btn-sm" data-pay-ok="${p.id}">Confirmar baixa</button> <button class="btn-sm" data-pay-no="${p.id}">Recusar</button></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">Nenhum pagamento aguardando confirmação</div>'}`;
  c.querySelectorAll('[data-pay-ok]').forEach((b) => b.onclick = async () => {
    try { await api(`/api/payments/${b.dataset.payOk}/confirmar`, { method: 'POST', body: '{}' }); toast('Baixa confirmada — parcela paga'); finPagamentos(c); } catch (e) { toast(e.message, 'error'); }
  });
  c.querySelectorAll('[data-pay-no]').forEach((b) => b.onclick = async () => {
    try { await api(`/api/payments/${b.dataset.payNo}/recusar`, { method: 'POST', body: '{}' }); toast('Pagamento recusado — parcela voltou a pendente'); finPagamentos(c); } catch (e) { toast(e.message, 'error'); }
  });
}

async function finAuditoria(c) {
  c.innerHTML = `
    <div id="audit-kpis" class="kpi-grid"></div>
    <div class="toolbar">
      <select id="audit-ent"><option value="">Todas as entidades</option>
        <option value="Receita">Receitas</option><option value="Parcela">Parcelas</option>
        <option value="Expense">Despesas</option><option value="Agreement">Acordos</option><option value="Repasse">Repasses</option></select>
      <select id="audit-acao"><option value="">Todas as ações</option>
        <option value="create">Criação</option><option value="update">Edição</option>
        <option value="pay">Baixa</option><option value="cancel">Cancelamento</option><option value="status_change">Status</option></select>
    </div>
    <div class="card"><div id="audit-table"></div></div>`;

  const stats = await api('/api/auditoria-financeira/stats').catch(() => ({ total_registros: 0, por_acao: {} }));
  $('#audit-kpis').innerHTML =
    kpi('Total de registros', stats.total_registros || 0) +
    kpi('Criações', stats.por_acao?.create || stats.por_acao?.created || 0) +
    kpi('Edições', stats.por_acao?.update || stats.por_acao?.updated || 0) +
    kpi('Baixas', stats.por_acao?.pay || stats.por_acao?.paid || 0);

  const fmtChange = (oldV, newV, fmt) => {
    if (oldV == null && newV == null) return '—';
    if (oldV == null) return fmt(newV);
    if (newV == null || String(oldV) === String(newV)) return fmt(oldV);
    return `<span style="color:var(--text-muted)">${fmt(oldV)}</span> → <strong>${fmt(newV)}</strong>`;
  };

  const load = async () => {
    const q = new URLSearchParams();
    if ($('#audit-ent').value) q.set('entity_type', $('#audit-ent').value);
    if ($('#audit-acao').value) q.set('action', $('#audit-acao').value);
    const r = await api('/api/auditoria-financeira?' + q);
    $('#audit-table').innerHTML = (r.data && r.data.length) ? `
      <table><thead><tr><th>Data</th><th>Entidade</th><th>Ação</th><th>Responsável</th><th>Valor</th><th>Status</th><th>Motivo</th></tr></thead>
      <tbody>${r.data.map((a) => `<tr>
        <td><small>${fmtDate(a.created_at)}</small></td>
        <td>${AUDIT_ENTIDADE_PT[a.entity_type] || a.entity_type} <small style="color:var(--text-muted)">#${a.entity_id}</small></td>
        <td>${badge((AUDIT_ACAO_PT[a.action] || a.action))}</td>
        <td>${a.user_name || '—'}</td>
        <td>${fmtChange(a.old_value, a.new_value, money)}</td>
        <td>${fmtChange(a.old_status, a.new_status, (s) => s)}</td>
        <td><small>${a.reason || ''}</small></td></tr>`).join('')}</tbody></table>
      <div style="padding:12px 18px;color:var(--text-muted);font-size:13px">${r.total} registro(s)</div>`
      : '<div class="empty">Nenhum registro de auditoria ainda. As alterações em receitas, parcelas, despesas, acordos e repasses aparecerão aqui.</div>';
  };
  $('#audit-ent').onchange = load;
  $('#audit-acao').onchange = load;
  await load();
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
  const [clients, partners] = await Promise.all([api('/api/clients?limit=100'), api('/api/partners').catch(() => [])]);
  const form = el(`<form class="form-grid">
    ${field('Nome *', 'name')}
    ${field('E-mail *', 'email', { type: 'email' })}
    ${field('Senha provisória *', 'password', { type: 'password' })}
    ${field('Papel', 'role', { options: [['advogado','Advogado do escritório'],['estagiario','Estagiário'],['parceiro','Advogado parceiro'],['parceiro_portal','Parceiro (portal de acompanhamento)'],['cliente','Cliente (portal)'],['admin','Administrador']].map(([v,t])=>({v,t})) })}
    <div id="f-commission" style="display:none">${field('Repasse do parceiro', 'commission_percent', { options: [{v:30,t:'30%'},{v:50,t:'50%'}] })}</div>
    <div id="f-client" style="display:none">${field('Cliente vinculado', 'client_id', { options: clients.data.map((c) => ({ v: c.id, t: c.name })) })}</div>
    <div id="f-partner" style="display:none">${field('Parceiro vinculado', 'partner_id', { options: partners.map((p) => ({ v: p.id, t: p.name })) })}</div>
    <button type="submit" class="btn-primary">Cadastrar usuário</button>
  </form>`);
  const roleSel = form.querySelector('[name=role]');
  const sync = () => {
    form.querySelector('#f-commission').style.display = roleSel.value === 'parceiro' ? 'block' : 'none';
    form.querySelector('#f-client').style.display = roleSel.value === 'cliente' ? 'block' : 'none';
    form.querySelector('#f-partner').style.display = roleSel.value === 'parceiro_portal' ? 'block' : 'none';
  };
  roleSel.onchange = sync; sync();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    if (body.role !== 'parceiro') delete body.commission_percent;
    if (body.role !== 'cliente') delete body.client_id;
    if (body.role !== 'parceiro_portal') delete body.partner_id;
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
    `<div style="padding:10px 0;border-bottom:1px solid var(--border-soft)">
      <small style="color:var(--text-muted)">${fmtDate(m.movement_date || m.created_at)}</small>
      <div style="font-size:13.5px">${esc(m.description)}</div></div>`).join('') || '<p class="empty">Sem movimentações registradas</p>';
  const docs = (c.documents || []).map((d) =>
    `<div class="mini-row"><span>${esc(d.name)}</span><a class="btn-sm" href="${esc(d.file_url)}" target="_blank" rel="noopener" style="text-decoration:none">Baixar</a></div>`).join('');
  const wrap = el(`<div>
    <div><strong style="font-size:18px;color:var(--navy-deep)">${esc(c.title)}</strong><br>
      <small style="color:var(--text-muted)">${c.case_number ? 'Processo ' + esc(c.case_number) : 'Em preparação'}</small></div>
    ${stepperHtml(c)}
    ${c.client_message ? `<div class="client-msg">${esc(c.client_message)}</div>` : ''}
    ${docs ? `<div style="margin-top:16px"><strong style="font-size:13px;color:var(--navy)">Documentos liberados</strong><div style="margin-top:6px">${docs}</div></div>` : ''}
    <div style="margin-top:16px"><button class="btn-sm" id="pcd-toggle" type="button">Ver detalhes técnicos (movimentações)</button>
      <div id="pcd-movs" style="display:none;max-height:300px;overflow-y:auto;margin-top:8px">${movs}</div></div>
  </div>`);
  wrap.querySelector('#pcd-toggle').onclick = (e) => {
    const box = wrap.querySelector('#pcd-movs');
    const open = box.style.display === 'none';
    box.style.display = open ? 'block' : 'none';
    e.target.textContent = open ? 'Ocultar detalhes técnicos' : 'Ver detalhes técnicos (movimentações)';
  };
  openModal('Meu processo', wrap);
}

// partnerCaseDetail → public/portal-parceiro.js

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
    <strong style="color:var(--navy);font-size:13px">Cliente (assistido)</strong>
    <small style="color:var(--text-muted)">Será criada uma ficha na aba Clientes com a etiqueta DATIVO.</small>
    ${field('Cliente já cadastrado', 'client_id', { options: [{ v: '', t: '— criar nova ficha —' }, ...clients.data.map((c) => ({ v: c.id, t: c.name }))] })}
    <div id="new-client-fields">
      ${field('Nome do assistido *', 'assisted_name')}
      <div class="form-row">${field('CPF', 'client_cpf')}${field('Telefone', 'client_phone')}</div>
      ${field('E-mail', 'client_email', { type: 'email' })}
    </div>
    <hr style="border:none;border-top:1px solid var(--border)">
    <strong style="color:var(--navy);font-size:13px">Dados da nomeação</strong>
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
  const docs = { content: 'Contrato', procuracao_content: 'Procuração', declaracao_content: 'Declaração de Hipossuficiência' };
  let signAction = '';
  if (ct.status === 'assinado')
    signAction = `<div style="text-align:center;color:var(--green);font-weight:600">Contrato assinado · processo na esteira + honorários gerados</div>`;
  else
    signAction = `
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn-gold" id="send-sign" style="flex:1;min-width:200px">Gerar link de assinatura (cliente assina na tela)</button>
        <button class="btn-sm" id="mark-signed">Marcar assinado manual</button>
      </div>
      <div id="ct-sign-status"></div>`;

  const wrap = el(`<div class="form-grid">
    ${field('Título', 'title', { value: ct.title })}
    <div class="form-row">${field('Área', 'area', { value: ct.area, options: AREAS })}${field('Valor (R$)', 'value', { type: 'number', value: ct.value ?? '' })}</div>
    <div>Status: ${badge(ct.status)}</div>
    <div class="tabs" id="doc-tabs">
      <button type="button" class="tab active" data-doc="content">Contrato</button>
      <button type="button" class="tab" data-doc="procuracao_content">Procuração</button>
      <button type="button" class="tab" data-doc="declaracao_content">Declaração</button>
    </div>
    ${Object.keys(docs).map((k, i) => `<textarea data-field="${k}" rows="14" style="font-family:monospace;font-size:12.5px;display:${i===0?'block':'none'}">${ct[k] || ''}</textarea>`).join('')}
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn-gold btn-sm" id="print-all">Baixar tudo (Contrato + Procuração + Declaração)</button>
      <button class="btn-sm" data-print="content">Contrato PDF</button>
      <button class="btn-sm" data-print="procuracao_content">Procuração PDF</button>
      <button class="btn-sm" data-print="declaracao_content">Declaração PDF</button>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button type="button" class="btn-gold btn-sm" id="toggle-complete">Completar informações faltantes</button>
      <button type="button" class="btn-sm" id="reprocess-ct">Regenerar com modelo atual</button>
    </div>
    <div id="complete-panel" class="complete-panel" style="display:none">
      <strong class="cp-grp">Dados da parte (cliente)</strong>
      ${field('Nome do cliente (corrigir se estiver errado)', 'c_nome')}
      <div class="form-row">${field('Nacionalidade', 'c_nac', { value: 'brasileiro(a)' })}${field('Profissão', 'c_prof')}</div>
      <div class="form-row">${field('CPF', 'c_cpf')}${field('E-mail', 'c_email', { type: 'email' })}</div>
      ${field('Endereço completo', 'c_end')}
      <strong class="cp-grp">Data e pagamento</strong>
      <div class="form-row">${field('Data', 'o_data')}${field('Forma de pagamento / parcelas', 'o_forma')}</div>
      <button type="button" class="btn-primary" id="apply-complete">Aplicar aos documentos</button>

      <label class="agree" id="menor-toggle" style="margin-top:6px">
        <input type="checkbox" id="menor-chk"> <span>Contrato de representação de <strong>MENOR</strong> (dependente)</span>
      </label>
      <div id="menor-fields" style="display:none;flex-direction:column;gap:10px">
        <strong class="cp-grp">Dados do menor representado</strong>
        ${field('Nome completo do menor', 'menor_nome')}
        <div class="form-row">${field('Data de nascimento', 'menor_nascimento', { type: 'date' })}${field('CPF do menor', 'menor_cpf')}</div>
        ${field('RG do responsável', 'responsavel_rg')}
        <div class="form-row">${field('Tipo de ação', 'tipo_acao')}${field('Parte contrária', 'parte_contraria')}</div>
        ${field('Foro (Comarca)', 'foro_cidade', { value: 'Vitória/ES' })}
        <button type="button" class="btn-gold" id="gerar-menor">Gerar contrato de representação de menor</button>
      </div>
    </div>
    <button class="btn-primary" id="save-ct">Salvar documentos</button>
    <hr style="border:none;border-top:1px solid var(--border)">
    <strong style="font-size:13px;color:var(--navy)">Assinatura via ZapSign</strong>
    <p class="sub" style="margin:2px 0 6px">Gere o link no ZapSign e cole abaixo — o sistema monta a mensagem para o cliente e marca o contrato como enviado para assinatura.</p>
    <label>Link do ZapSign<input id="zap-link" value="${ct.zapsign_link || ''}" placeholder="https://app.zapsign.com.br/..."></label>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn-gold btn-sm" id="zap-msg" type="button">Gerar mensagem ao cliente</button>
      <button class="btn-sm" id="zap-copy" type="button">Copiar</button>
      <button class="btn-sm" id="zap-wpp" type="button">WhatsApp</button>
    </div>
    <textarea id="zap-text" rows="8" placeholder="A mensagem orientando o cliente aparecerá aqui."></textarea>
    ${ct.status === 'assinado' ? '' : `<button class="btn-primary" id="zap-signed" type="button" style="background:var(--green)">${svgIcon('check')}Marcar como assinado (ZapSign)</button>`}
    ${signAction}
  </div>`);

  wrap.querySelectorAll('[data-print]').forEach((b) => b.onclick = () => {
    const docTitle = { content: 'Contrato', procuracao_content: 'Procuração', declaracao_content: 'Declaração de Hipossuficiência' }[b.dataset.print];
    printDoc(docTitle, wrap.querySelector(`[data-field=${b.dataset.print}]`).value);
  });
  wrap.querySelector('#print-all').onclick = () => printDocs([
    { title: 'Contrato', content: wrap.querySelector('[data-field=content]').value },
    { title: 'Procuração', content: wrap.querySelector('[data-field=procuracao_content]').value },
    { title: 'Declaração de Hipossuficiência', content: wrap.querySelector('[data-field=declaracao_content]').value },
  ]);

  wrap.querySelectorAll('#doc-tabs .tab').forEach((t) => t.onclick = () => {
    wrap.querySelectorAll('#doc-tabs .tab').forEach((x) => x.classList.toggle('active', x === t));
    wrap.querySelectorAll('[data-field]').forEach((ta) => ta.style.display = ta.dataset.field === t.dataset.doc ? 'block' : 'none');
  });

  const saveDocs = async (extra = {}) => {
    const body = {
      title: wrap.querySelector('[name=title]').value,
      area: wrap.querySelector('[name=area]').value,
      value: wrap.querySelector('[name=value]').value || null,
      content: wrap.querySelector('[data-field=content]').value,
      procuracao_content: wrap.querySelector('[data-field=procuracao_content]').value,
      declaracao_content: wrap.querySelector('[data-field=declaracao_content]').value,
      ...extra,
    };
    return api('/api/contracts/' + id, { method: 'PUT', body: JSON.stringify(body) });
  };

  // Completar informações faltantes (substitui os placeholders nos 3 documentos)
  wrap.querySelector('#toggle-complete').onclick = () => {
    const pnl = wrap.querySelector('#complete-panel');
    pnl.style.display = pnl.style.display === 'none' ? 'block' : 'none';
  };
  // Representação de menor: checkbox revela os campos do menor
  const menorChk = wrap.querySelector('#menor-chk');
  menorChk.onchange = () => { wrap.querySelector('#menor-fields').style.display = menorChk.checked ? 'flex' : 'none'; };
  wrap.querySelector('#gerar-menor').onclick = async () => {
    const g = (n) => wrap.querySelector(`[name=${n}]`)?.value || '';
    if (!g('menor_nome')) { toast('Informe o nome do menor', 'error'); return; }
    if (!confirm('Gerar o CONTRATO no modelo de representação de menor? O texto do contrato será substituído.')) return;
    try {
      await api(`/api/contracts/${id}/gerar-menor`, { method: 'POST', body: JSON.stringify({
        menor_nome: g('menor_nome'), menor_nascimento: g('menor_nascimento'), menor_cpf: g('menor_cpf'),
        responsavel_rg: g('responsavel_rg'), tipo_acao: g('tipo_acao'), parte_contraria: g('parte_contraria'), foro_cidade: g('foro_cidade'),
      }) });
      closeModal(); toast('Contrato de menor gerado'); onSave && onSave(); contractEditor(id, onSave);
    } catch (e) { toast(e.message, 'error'); }
  };
  try {
    const saved = JSON.parse(localStorage.getItem('escritorioInfo') || '{}');
    ['o_forma'].forEach((n) => {
      const inp = wrap.querySelector(`[name=${n}]`); if (inp && saved[n]) inp.value = saved[n];
    });
  } catch {}
  // Pré-preenche os dados da PARTE já cadastrados (lead + cliente) — sem retrabalho
  api(`/api/contracts/${id}/party`).then((pt) => {
    const set = (n, v) => { const inp = wrap.querySelector(`[name=${n}]`); if (inp && !inp.value && v) inp.value = v; };
    set('c_nome', pt.name); set('c_cpf', pt.cpf); set('c_prof', pt.profissao); set('c_end', pt.endereco); set('c_email', pt.email);
    set('o_forma', pt.forma_pagamento);
    set('responsavel_rg', pt.rg); set('tipo_acao', pt.tipo_causa);
    if (pt.dependentes && pt.dependentes.length) {
      set('menor_nome', pt.dependentes[0].nome); set('menor_cpf', pt.dependentes[0].cpf);
      menorChk.checked = true; wrap.querySelector('#menor-fields').style.display = 'flex';
    }
  }).catch(() => {});
  const dataEl = wrap.querySelector('[name=o_data]');
  if (dataEl && !dataEl.value) dataEl.value = new Date().toLocaleDateString('pt-BR');

  // Prefill com o complemento já salvo no contrato (persiste entre sessões).
  const ovMap = { c_nome: 'nome', c_nac: 'nacionalidade', c_prof: 'profissao', c_cpf: 'cpf', c_email: 'email', c_end: 'endereco', o_forma: 'forma_pagamento' };
  let savedOv = {};
  try { savedOv = ct.party_overrides ? (typeof ct.party_overrides === 'string' ? JSON.parse(ct.party_overrides) : ct.party_overrides) : {}; } catch {}
  Object.entries(ovMap).forEach(([fn, ok]) => { const inp = wrap.querySelector(`[name=${fn}]`); if (inp && savedOv[ok]) inp.value = savedOv[ok]; });

  const collectOverrides = () => {
    const o = {};
    for (const [fn, ok] of Object.entries(ovMap)) { const v = (wrap.querySelector(`[name=${fn}]`)?.value || '').trim(); if (v) o[ok] = v; }
    return o;
  };

  // Salva o complemento no servidor e regenera os 3 documentos (não se perde ao sair).
  let pushTimer = null;
  const pushComplement = async (silent) => {
    try {
      const r = await api(`/api/contracts/${id}/complement`, { method: 'PATCH', body: JSON.stringify({ overrides: collectOverrides() }) });
      ['content', 'procuracao_content', 'declaracao_content'].forEach((k) => {
        const ta = wrap.querySelector(`[data-field=${k}]`); if (ta && r[k] != null) ta.value = r[k];
      });
      if (!silent) toast('Informações salvas e documentos atualizados');
    } catch (e) { if (!silent) toast(e.message, 'error'); }
  };
  const schedulePush = () => { clearTimeout(pushTimer); pushTimer = setTimeout(() => pushComplement(true), 800); };

  // Auto-salva ao digitar (debounce) e ao sair do campo — mesmo sem clicar no botão.
  Object.keys(ovMap).forEach((fn) => {
    const inp = wrap.querySelector(`[name=${fn}]`);
    if (inp) { inp.addEventListener('input', schedulePush); inp.addEventListener('change', () => { clearTimeout(pushTimer); pushComplement(true); }); }
  });

  wrap.querySelector('#apply-complete').onclick = () => { clearTimeout(pushTimer); pushComplement(false); };

  wrap.querySelector('#reprocess-ct').onclick = async () => {
    if (!confirm('Regenerar os 3 documentos com o modelo atual e os dados do cadastro? O texto atual será substituído.')) return;
    try { await api(`/api/contracts/${id}/reprocessar`, { method: 'POST', body: '{}' }); closeModal(); toast('Documentos regenerados'); onSave && onSave(); contractEditor(id, onSave); }
    catch (e) { toast(e.message, 'error'); }
  };

  wrap.querySelector('#save-ct').onclick = async () => {
    try { await saveDocs(); closeModal(); toast('Documentos salvos'); onSave && onSave(); } catch (e) { toast(e.message, 'error'); }
  };

  // Assinatura via ZapSign — cola o link e gera a orientação ao cliente
  const zapMsg = (link) => {
    const nome = (ct.client_name || '').split(' ')[0];
    return `Olá${nome ? ', ' + nome : ''}!\n\n`
      + `Segue o link para assinatura do seu *Contrato de Prestação de Serviços Advocatícios* (conforme a proposta aceita), da *Procuração* e da *Declaração de Hipossuficiência*:\n\n`
      + `${link}\n\n`
      + `Ao abrir o link, você verá uma prévia de todos esses documentos. Leia com atenção, vá até a última página e clique em *Continuar*. A partir daí, você poderá assinar na própria tela do celular.\n\n`
      + `Em caso de dúvidas, nosso escritório fica à sua disposição.\n— Advocacia Letícia Barros`;
  };
  wrap.querySelector('#zap-msg').onclick = async () => {
    const link = wrap.querySelector('#zap-link').value.trim();
    if (!/^https?:\/\//i.test(link)) { toast('Cole um link válido do ZapSign', 'error'); return; }
    wrap.querySelector('#zap-text').value = zapMsg(link);
    try { await saveDocs({ zapsign_link: link }); toast('Link salvo — contrato marcado como enviado para assinatura'); onSave && onSave(); }
    catch (e) { toast(e.message, 'error'); }
  };
  wrap.querySelector('#zap-copy').onclick = async () => {
    const t = wrap.querySelector('#zap-text').value || zapMsg(wrap.querySelector('#zap-link').value.trim());
    try { await navigator.clipboard.writeText(t); toast('Mensagem copiada'); }
    catch { const ta = wrap.querySelector('#zap-text'); ta.select(); document.execCommand('copy'); toast('Mensagem copiada'); }
  };
  wrap.querySelector('#zap-wpp').onclick = () => {
    const link = wrap.querySelector('#zap-link').value.trim();
    if (!/^https?:\/\//i.test(link)) { toast('Cole um link válido do ZapSign', 'error'); return; }
    window.open('https://wa.me/?text=' + encodeURIComponent(zapMsg(link)), '_blank');
  };
  const zapSigned = wrap.querySelector('#zap-signed');
  if (zapSigned) zapSigned.onclick = async () => {
    if (!confirm('Confirmar que o cliente já assinou no ZapSign? Isso cria o processo na esteira e gera os honorários no financeiro.')) return;
    try {
      const link = wrap.querySelector('#zap-link').value.trim();
      const r = await saveDocs({ status: 'assinado', zapsign_link: link || undefined });
      closeModal(); toast('Contrato assinado! Processo criado + honorários gerados.'); onSave && onSave();
      if (r.created_case_id) { location.hash = '#cases'; }
    } catch (e) { toast(e.message, 'error'); }
  };
  const loadCtSigs = async () => {
    const box = wrap.querySelector('#ct-sign-status'); if (!box) return;
    const sigs = await api(`/api/contracts/${id}/signatures`).catch(() => []);
    box.innerHTML = sigs.length ? `<div style="margin-top:8px"><strong style="font-size:12px;color:var(--navy)">Assinaturas</strong>${sigs.map((s) => {
      const url = location.origin + '/assinar.html?token=' + s.token;
      return `<div class="mini-row"><span>${s.signer_name || 'Aguardando assinatura'} ${s.status === 'assinado' ? `<small style="color:var(--green)">· assinado (cód. ${s.verification_code})</small>` : ''}</span>
        <span>${s.status === 'assinado' ? `<a class="btn-sm" href="/verificar.html?codigo=${s.verification_code}" target="_blank">Termo</a>`
          : `<button class="btn-sm" data-copy="${url}">Copiar link</button> <a class="btn-sm" href="https://wa.me/?text=${encodeURIComponent('Assine seu contrato: ' + url)}" target="_blank">WhatsApp</a>`}</span></div>`;
    }).join('')}</div>` : '';
    box.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy); toast('Link copiado'); });
  };
  const sendBtn = wrap.querySelector('#send-sign');
  if (sendBtn) sendBtn.onclick = async () => {
    try { await saveDocs(); await api(`/api/contracts/${id}/sign-request`, { method: 'POST', body: '{}' });
      toast('Link de assinatura criado — envie ao cliente'); loadCtSigs(); } catch (e) { toast(e.message, 'error'); }
  };
  const signBtn = wrap.querySelector('#mark-signed');
  if (signBtn) signBtn.onclick = async () => {
    try { const r = await saveDocs({ status: 'assinado' }); closeModal();
      toast('Contrato assinado! Processo criado + honorários gerados.'); onSave && onSave();
      if (r.created_case_id) { location.hash = '#cases'; }
    } catch (e) { toast(e.message, 'error'); }
  };
  loadCtSigs();
  openModal('Produção de documentos', wrap);
}

async function clientHistory(clientId) {
  const tl = await api(`/api/clients/${clientId}/timeline`);
  const items = tl.length ? tl.map((e) => `<div class="notif-item">
      <strong>${e.description}</strong>
      <div style="display:flex;justify-content:space-between;margin-top:4px">
        <small>${e.case_number ? 'Proc. ' + e.case_number + ' · ' : ''}${e.by_name || ''}</small>
        <small>${fmtDate(e.created_at)}</small>
      </div></div>`).join('') : '<div class="empty">Sem histórico ainda</div>';
  const wrap = el(`<div><div class="mini-list">${items}</div></div>`);
  openModal('Histórico do cliente', wrap);
}

function showClientCredentials(cred, processNumber) {
  const wrap = el(`<div class="form-grid">
    <div style="background:var(--green-bg);border-radius:10px;padding:14px">
      <strong style="color:var(--green)">Processo protocolado — nº ${processNumber}</strong>
    </div>
    <p style="font-size:14px;color:var(--text-soft)">Foi criado o acesso do cliente ao portal. <strong>Repasse estas credenciais ao cliente</strong> (WhatsApp/pessoalmente):</p>
    <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:14px;font-family:monospace">
      <div>crm.advogadaleticiabarros.com.br</div>
      <div>Login: <strong>${cred.login}</strong></div>
      <div>Senha: <strong>${cred.password}</strong></div>
    </div>
    <small style="color:var(--text-muted)">O cliente verá o andamento do processo e o histórico no portal. Oriente-o a trocar a senha no primeiro acesso.</small>
    <button class="btn-primary" id="cred-ok">Entendi, copiei</button>
  </div>`);
  wrap.querySelector('#cred-ok').onclick = closeModal;
  openModal('Acesso do cliente gerado', wrap);
}

async function processForm(onSave) {
  const [clients, lawyers, tri] = await Promise.all([
    api('/api/clients?limit=100'), api('/api/lawyers'), api('/api/processes/tribunais'),
  ]);
  const triOpts = Object.entries(tri.tribunais).map(([k, v]) => ({ v: k, t: `${v.sigla} — ${v.nome}` }));
  const form = el(`<form class="form-grid">
    ${field('Número do processo (CNJ) *', 'process_number')}
    ${field('Cliente', 'client_id', { options: [{ v:'', t:'— nenhum —' }, ...clients.data.map((c) => ({ v: c.id, t: c.name }))] })}
    ${field('Advogado responsável', 'lawyer_id', { options: lawyers.map((l) => ({ v: l.id, t: `${l.name} (OAB ${l.oab_number||'?'})` })) })}
    <div class="form-row">${field('Área', 'judicial_area', { options: AREAS })}${field('Tribunal', 'court_alias', { options: [{v:'',t:'— automático pela área —'}, ...triOpts] })}</div>
    ${field('Fonte', 'source', { options: [['datajud','DataJud (consulta automática)'],['manual','Manual']].map(([v,t])=>({v,t})) })}
    <button type="submit" class="btn-primary">Cadastrar e monitorar</button>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    if (!body.client_id) delete body.client_id;
    if (!body.court_alias) delete body.court_alias;
    try { await api('/api/processes', { method: 'POST', body: JSON.stringify(body) });
      closeModal(); toast('Processo cadastrado'); onSave(); } catch (err) { toast(err.message, 'error'); }
  };
  openModal('Monitorar processo', form);
}

async function movDetail(m, procId, onSave) {
  const full = `${m.title ? m.title + '\n\n' : ''}${m.description || ''}`.trim();
  const wrap = el(`<div class="form-grid">
    <button class="btn-sm" id="mov-back" style="align-self:flex-start">‹ Voltar ao processo</button>
    <small style="color:var(--text-muted)">${fmtDate(m.movement_date)} · ${m.source || ''}</small>
    <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:14px;white-space:pre-wrap;font-size:13.5px;line-height:1.65;max-height:52vh;overflow:auto">${(full || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn-sm" id="mov-copy">Copiar movimentação</button>
      <button class="btn-gold btn-sm" id="mov-resumo">Resumo para o cliente</button>
    </div>
    <div id="mov-resumo-box"></div>
  </div>`);
  wrap.querySelector('#mov-back').onclick = () => { closeModal(); processDetail(procId, onSave); };
  wrap.querySelector('#mov-copy').onclick = async () => { try { await navigator.clipboard.writeText(full); } catch {} toast('Movimentação copiada'); };
  wrap.querySelector('#mov-resumo').onclick = async () => {
    const box = wrap.querySelector('#mov-resumo-box');
    box.innerHTML = '<div class="spinner"></div>';
    try {
      const r = await api('/api/ai/generate', { method: 'POST', body: JSON.stringify({ type: 'resumo_cliente', inputs: { movimentacao: m.description || m.title || '' } }) });
      if (r.auto && r.result) {
        box.innerHTML = `<strong style="font-size:13px;color:var(--navy)">Resumo para o cliente (sem juridiquês)</strong>
          <textarea id="mr-text" rows="5" style="margin-top:6px">${r.result}</textarea>
          <div style="display:flex;gap:6px;margin-top:6px"><button class="btn-sm" id="mr-copy">Copiar</button><button class="btn-gold btn-sm" id="mr-wpp">WhatsApp</button></div>`;
        wrap.querySelector('#mr-copy').onclick = async () => { try { await navigator.clipboard.writeText(wrap.querySelector('#mr-text').value); } catch {} toast('Resumo copiado'); };
        wrap.querySelector('#mr-wpp').onclick = () => window.open('https://wa.me/?text=' + encodeURIComponent(wrap.querySelector('#mr-text').value), '_blank');
      } else {
        box.innerHTML = `<p class="sub">IA automática não configurada. Copie o texto abaixo e cole no ChatGPT/Claude para gerar o resumo:</p>
          <textarea id="mr-prompt" rows="6" style="margin-top:6px">${(r.prompt || '').replace(/</g, '&lt;')}</textarea>
          <button class="btn-sm" id="mr-pcopy" style="margin-top:6px">Copiar prompt</button>`;
        wrap.querySelector('#mr-pcopy').onclick = async () => { try { await navigator.clipboard.writeText(wrap.querySelector('#mr-prompt').value); } catch {} toast('Prompt copiado'); };
      }
    } catch (e) { box.innerHTML = `<p class="sub" style="color:var(--red)">${e.message}</p>`; }
  };
  openModal('Movimentação', wrap);
}

async function processDetail(id, onSave) {
  const p = await api('/api/processes/' + id);
  const clamp = (s) => { s = (s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); return s.length > 150 ? s.slice(0, 150) + '…' : s; };
  const movs = (p.movements || []).map((m, i) => `<div class="mov-row" data-mi="${i}" style="padding:10px 8px;border-bottom:1px solid var(--border-soft);cursor:pointer;border-radius:8px">
    <small style="color:var(--text-muted)">${fmtDate(m.movement_date)} · ${m.source}</small>
    <div style="font-size:13px"><strong>${(m.title || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</strong> ${m.description ? '— ' + clamp(m.description) : ''}</div>
    <small style="color:var(--gold)">abrir na íntegra ›</small></div>`).join('') || '<p class="empty">Sem movimentações ainda</p>';
  const wrap = el(`<div class="form-grid">
    <div><strong style="font-size:17px">${esc(p.process_number)}</strong> <button type="button" class="btn-copy" data-copy="${esc(p.process_number)}" title="Copiar número" style="background:none;border:1px solid var(--border);border-radius:6px;cursor:pointer;padding:3px 6px;line-height:0">${svgIcon('clipboard')}</button><br>
      <small style="color:var(--text-muted)">${p.court || ''} · ${p.client_name || ''}</small></div>
    <div>${badge(p.status)} ${p.judicial_area ? badge(p.judicial_area) : ''} · última sync ${p.last_sync_at ? fmtDate(p.last_sync_at) : 'nunca'}</div>
    <button class="btn-primary" id="sync-now">Sincronizar agora</button>
    <hr style="border:none;border-top:1px solid var(--border)">
    <strong style="font-size:13px">Movimentações (${(p.movements||[]).length}) — clique para ver na íntegra</strong>
    <div style="max-height:340px;overflow-y:auto">${movs}</div>
  </div>`);
  wrap.querySelectorAll('.mov-row').forEach((row) => row.onclick = () => { const m = p.movements[Number(row.dataset.mi)]; closeModal(); movDetail(m, id, onSave); });
  wrap.querySelector('#sync-now').onclick = async () => {
    wrap.querySelector('#sync-now').textContent = 'Consultando…';
    try {
      const r = await api(`/api/processes/${id}/sync`, { method: 'POST' });
      const msg = r.status === 'nova_movimentacao' ? `${r.newMovements} nova(s) movimentação(ões)!`
        : r.status === 'sem_novidade' ? 'Sem novidades' : r.status === 'nao_encontrado' ? 'Processo não encontrado na fonte'
        : (r.message || 'Erro na consulta');
      toast(msg, r.status === 'erro' ? 'error' : 'success');
      closeModal(); processDetail(id, onSave);
    } catch (e) { toast(e.message, 'error'); wrap.querySelector('#sync-now').textContent = 'Sincronizar agora'; }
  };
  openModal('Processo monitorado', wrap);
}

async function lawyerForm(id, onSave) {
  let l = { name: 'Letícia Elias Barros', oab_number: '', oab_uf: 'ES', email: '', phone: '', monitoring_enabled: 1 };
  if (id) l = (await api('/api/lawyers')).find((x) => String(x.id) === String(id)) || l;
  const form = el(`<form class="form-grid">
    ${field('Nome *', 'name', { value: l.name })}
    <div class="form-row">${field('Número da OAB', 'oab_number', { value: l.oab_number })}${field('UF', 'oab_uf', { value: l.oab_uf })}</div>
    <div class="form-row">${field('E-mail', 'email', { value: l.email, type: 'email' })}${field('Telefone', 'phone', { value: l.phone })}</div>
    ${field('Endereço do escritório (usado nos contratos)', 'address', { value: l.address || '' })}
    <label style="flex-direction:row;align-items:center;gap:8px">
      <input type="checkbox" id="law-mon" ${l.monitoring_enabled ? 'checked' : ''} style="width:auto"> Monitoramento ativo
    </label>
    <button type="submit" class="btn-primary">Salvar</button>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    body.monitoring_enabled = form.querySelector('#law-mon').checked;
    try { await api(id ? '/api/lawyers/' + id : '/api/lawyers', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
      closeModal(); toast('Advogado salvo'); onSave(); } catch (err) { toast(err.message, 'error'); }
  };
  openModal(id ? 'Editar advogado / OAB' : 'Novo advogado', form);
}

function formatDocHtml(text) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = String(text || '').split('\n');
  let html = ''; let inSig = false; let sigOpen = false; let titleDone = false;
  const closeSig = () => { if (sigOpen) { html += '</div>'; sigOpen = false; } };
  for (const raw of lines) {
    const t = raw.trim();
    // Linha de assinatura: abre um bloco que NÃO pode quebrar entre páginas.
    if (/^_{5,}$/.test(t)) {
      closeSig();
      html += '<div class="sig-block"><div class="sig-line"></div>';
      sigOpen = true; inSig = true; continue;
    }
    // Dentro do bloco de assinatura: nomes/cargos (ignora linhas em branco).
    if (inSig) { if (t) html += `<p class="sig-name">${esc(t)}</p>`; continue; }
    if (!t) { html += '<div class="sp"></div>'; continue; }
    if (!titleDone && /^(CONTRATO|PROCURAÇÃO|DECLARAÇÃO)/i.test(t) && t === t.toUpperCase()) { html += `<h1 class="doc-title">${esc(t)}</h1>`; titleDone = true; continue; }
    if (/^CL[ÁA]USULA\b/i.test(t)) { html += `<p class="clause">${esc(t)}</p>`; continue; }
    const mp = t.match(/^(PAR[ÁA]GRAFO[^-]*-)\s*([\s\S]*)$/i);
    if (mp) { html += `<p class="para"><strong>${esc(mp[1])}</strong> ${esc(mp[2])}</p>`; continue; }
    const ml = t.match(/^(CONTRATANTE|CONTRATADA|OUTORGANTE|OUTORGADO\(A\)|OUTORGADA|DECLARANTE):([\s\S]*)$/i);
    if (ml) { html += `<p class="party"><strong>${esc(ml[1])}:</strong>${esc(ml[2])}</p>`; continue; }
    html += `<p class="body">${esc(t)}</p>`;
  }
  closeSig();
  return html;
}

function docTableHtml(content, logo) {
  return `<table class="page">
      <thead><tr><td>
        <div class="lh-header">
          <div class="brand"><img src="${logo}" onerror="this.style.display='none'">
            <div><div class="name">LETÍCIA BARROS</div><div class="sub">Advocacia &amp; Consultoria</div></div></div>
          <div class="oab">OAB Nº 39.948 - ES</div>
        </div>
      </td></tr></thead>
      <tfoot><tr><td><div class="lh-foot-spacer"></div></td></tr></tfoot>
      <tbody><tr><td><div class="content">${formatDocHtml(content)}</div></td></tr></tbody>
    </table>`;
}

function dataExtensoHoje() {
  const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const d = new Date();
  return `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
}

// Impressão com papel timbrado da marca (fichas/relatórios) — elegante e consistente
function printBranded(docTitle, subtitle, innerHtml) {
  const w = window.open('', '_blank');
  if (!w) { toast('Permita pop-ups para imprimir', 'error'); return; }
  const clean = String(innerHtml || '').replace(/var\(--[a-z0-9-]+\)/gi, '#33475b');
  const today = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(docTitle)}</title>
  <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@500;600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    @page { margin: 1.6cm 1.8cm; }
    * { box-sizing: border-box; }
    body { font-family: 'Inter', Arial, sans-serif; font-size: 11.5pt; line-height: 1.55; color: #232323; margin: 0; max-width: 900px; }
    .lh { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #c19a4e; padding-bottom: 12px; }
    .lh img { width: 52px; height: 52px; object-fit: contain; }
    .lh .nm { font-family: 'EB Garamond', Georgia, serif; font-size: 20pt; color: #1f3047; line-height: 1; }
    .lh .sb { font-size: 8.5pt; letter-spacing: 2px; text-transform: uppercase; color: #c19a4e; font-weight: 600; margin-top: 3px; }
    h1 { font-family: 'EB Garamond', Georgia, serif; font-size: 16pt; color: #1f3047; margin: 16px 0 2px; }
    .sub { color: #6b6252; font-size: 10pt; margin-bottom: 8px; }
    h3 { font-family: 'EB Garamond', Georgia, serif; font-size: 13pt; color: #1f3047; border-bottom: 1px solid #ddd; margin: 16px 0 6px; padding-bottom: 3px; }
    div { margin: 2px 0; } small { color: #6b6252; }
    span[style*="background"] { background: #f2ead3 !important; color: #5a4a1e !important; }
    .ft { margin-top: 26px; border-top: 1px solid #ddd; padding-top: 8px; font-size: 8.5pt; color: #8a8271; display: flex; justify-content: space-between; }
    .no-print { text-align: center; margin: 18px 0; }
    @media print { .no-print, button { display: none !important; } h3, .lh { page-break-after: avoid; } }
  </style></head>
  <body>
    <div class="lh"><img src="${location.origin}/logo.png" alt=""><div><div class="nm">Letícia Barros</div><div class="sb">Advocacia &amp; Consultoria</div></div></div>
    <h1>${esc(docTitle)}</h1>${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ''}
    ${clean}
    <div class="ft"><span>Documento gerado em ${today}</span><span>Advocacia Letícia Barros</span></div>
    <div class="no-print"><button onclick="window.print()" style="padding:10px 24px;font-size:14px;cursor:pointer;background:#c19a4e;color:#fff;border:none;border-radius:8px;font-weight:600">Imprimir / Salvar PDF</button></div>
  </body></html>`);
  w.document.close(); w.focus(); setTimeout(() => { try { w.print(); } catch {} }, 500);
}

function printDoc(title, content) { printDocs([{ title, content }]); }

function printDocs(docs) {
  const w = window.open('', '_blank');
  if (!w) { toast('Permita pop-ups para gerar o PDF', 'error'); return; }
  const logo = location.origin + '/logo.png';
  const titulo = docs.length > 1 ? 'Documentos' : (docs[0] && docs[0].title) || 'Documento';
  const hoje = dataExtensoHoje(); // data da impressão/download
  const blocks = docs.map((d, i) => {
    const c = String(d.content || '').split('[DATA]').join(hoje).split('{{data_extenso}}').join(hoje);
    return `<div class="docwrap"${i > 0 ? ' style="page-break-before:always"' : ''}>${docTableHtml(c, logo)}</div>`;
  }).join('');
  w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>${titulo}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&display=swap" rel="stylesheet">
    <style>
      @page { margin: 1.5cm 1.8cm; }
      * { box-sizing: border-box; }
      body { font-family: 'Times New Roman', Georgia, serif; font-size: 12pt; line-height: 1.7; color: #1a1a1a; margin: 0; }
      @media screen { body { background: #f5f5f5; } .page { background: #fff; max-width: 21cm; margin: 16px auto; padding: 1.5cm 1.8cm; box-shadow: 0 2px 14px rgba(0,0,0,.15); } }
      table.page { width: 100%; border-collapse: collapse; }
      thead td, tfoot td, tbody td { padding: 0; border: 0; }
      .lh-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #B8943F; padding-bottom: 6px; margin-bottom: 18px; }
      .lh-header .brand { display: flex; align-items: center; gap: 11px; }
      .lh-header img { height: 1.4cm; width: auto; }
      .lh-header .name { font-family: 'Cormorant Garamond', serif; font-size: 22pt; font-weight: 700; color: #2b2b2b; letter-spacing: 1.5px; line-height: 1; }
      .lh-header .sub { font-size: 7.5pt; color: #B8943F; letter-spacing: 3px; text-transform: uppercase; margin-top: 3px; }
      .lh-header .oab { font-size: 9.5pt; color: #555; white-space: nowrap; letter-spacing: .5px; }
      .lh-spacer-top { height: 0.5cm; }
      .lh-foot-spacer { height: 1.15cm; }
      .lh-footer-fixed { position: fixed; bottom: 0.7cm; left: 1.8cm; right: 1.8cm; background: #fff; border-top: 1px solid #B8943F; padding-top: 6px; text-align: center; font-size: 8.5pt; color: #555; }
      .lh-footer-fixed .sep { color: #B8943F; margin: 0 6px; }
      .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 12cm; height: auto; opacity: 0.035; z-index: -1; }
      .content { font-size: 12pt; line-height: 1.6; }
      .content .doc-title { text-align: center; font-size: 13.5pt; font-weight: bold; text-transform: uppercase; letter-spacing: .5px; margin: 0 0 20px; }
      .content .clause { font-weight: bold; margin: 16px 0 5px; }
      .content .para { margin: 8px 0; text-align: justify; }
      .content .party { margin: 6px 0; text-align: justify; }
      .content .body { margin: 9px 0; text-align: justify; }
      .content .sp { height: 5px; }
      .content .sig-block { break-inside: avoid; page-break-inside: avoid; margin-top: 56px; text-align: center; }
      .content .sig-block:first-of-type { margin-top: 36px; }
      .content .sig-line { width: 62%; margin: 0 auto 6px; border-bottom: 1px solid #333; }
      .content .sig-name { text-align: center; margin: 0; line-height: 1.5; }
      .docwrap + .docwrap { page-break-before: always; }
      @media print { .no-print { display: none; } .content .clause, .content .sig-line { page-break-inside: avoid; } }
    </style></head><body>
    <img class="watermark" src="${location.origin}/logo-sem-fundo.png" onerror="this.onerror=null;this.src='${logo}'">
    <div class="lh-footer-fixed">(27) 99515-1402 | (44) 99101-1402<span class="sep">·</span>advogadaleticia.barros@gmail.com<span class="sep">·</span>@adv.leticiabarros2</div>
    ${blocks}
    <div class="no-print" style="text-align:center;margin:20px 0"><button onclick="window.print()" style="padding:10px 24px;font-size:14px;cursor:pointer">Imprimir / Salvar PDF</button></div>
    </body></html>`);
  w.document.close();
  setTimeout(() => w.focus(), 400);
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ── Init ──
// Copiar com um clique qualquer elemento com [data-copy] (ex.: número do processo)
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-copy]');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  try { navigator.clipboard.writeText(b.dataset.copy); toast('Copiado: ' + b.dataset.copy); } catch { toast('Copie manualmente', 'error'); }
});
$('#login-form').onsubmit = login;

// Mostrar/ocultar a senha digitada (olho mágico)
const eyeBtn = $('#login-eye');
if (eyeBtn) eyeBtn.onclick = () => {
  const inp = $('#login-password');
  const mostrando = inp.type === 'text';
  inp.type = mostrando ? 'password' : 'text';
  $('#eye-open').style.display = mostrando ? '' : 'none';
  $('#eye-off').style.display = mostrando ? 'none' : '';
  inp.focus();
};

const forgotBtn = $('#forgot-link');
if (forgotBtn) forgotBtn.onclick = async () => {
  const email = ($('#login-email').value || '').trim() || prompt('Digite seu e-mail para recuperar a senha:');
  if (!email) return;
  try {
    const r = await api('/api/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) });
    alert(r.message || 'Se o e-mail estiver cadastrado, você receberá um link de redefinição.');
  } catch (e) { alert('Não foi possível enviar o pedido agora. Tente novamente.'); }
};

// ── Redefinição de senha via link do e-mail (#redefinir=<token>) ────────────
(function resetViaLink() {
  const m = location.hash.match(/^#redefinir=([a-f0-9]{64})$/i);
  if (!m) return;
  const token = m[1];
  const card = document.querySelector('.login-card');
  if (!card) return;
  // Garante a tela de redefinição mesmo com sessão salva neste navegador
  TOKEN = null; USER = null;
  localStorage.removeItem('crm_token'); localStorage.removeItem('crm_user');
  card.innerHTML = `
    <h2>Criar nova senha</h2>
    <p class="login-hint">Escolha a sua nova senha de acesso (mínimo de 8 caracteres)</p>
    <form id="reset-form">
      <label>Nova senha
        <input type="password" id="reset-p1" required minlength="8" autocomplete="new-password" placeholder="••••••••" />
      </label>
      <label>Repita a nova senha
        <input type="password" id="reset-p2" required minlength="8" autocomplete="new-password" placeholder="••••••••" />
      </label>
      <label style="display:flex;gap:8px;align-items:center;font-size:13px;font-weight:400;cursor:pointer">
        <input type="checkbox" id="reset-show" style="width:auto"> Mostrar senha
      </label>
      <button type="submit" class="btn-primary">Salvar nova senha</button>
      <p id="reset-error" class="error-msg"></p>
    </form>`;
  $('#reset-show').onchange = (e) => {
    const t = e.target.checked ? 'text' : 'password';
    $('#reset-p1').type = t; $('#reset-p2').type = t;
  };
  $('#reset-form').onsubmit = async (e) => {
    e.preventDefault();
    const p1 = $('#reset-p1').value, p2 = $('#reset-p2').value;
    if (p1 !== p2) { $('#reset-error').textContent = 'As senhas não conferem.'; return; }
    try {
      const r = await api('/api/auth/reset', { method: 'POST', body: JSON.stringify({ token, password: p1 }) });
      alert(r.message || 'Senha redefinida! Entre com a nova senha.');
      location.hash = ''; location.reload();
    } catch (err) { $('#reset-error').textContent = err.message; }
  };
})();
$('#logout-btn').onclick = logout;
$('#bell-btn').onclick = openNotifications;
if ($('#discover-btn')) $('#discover-btn').onclick = discoverNow;
const navToggle = $('#nav-toggle');
if (navToggle) navToggle.onclick = () => document.body.classList.toggle('nav-open');
const navOverlay = $('#nav-overlay');
if (navOverlay) navOverlay.onclick = () => document.body.classList.remove('nav-open');
const sbCollapse = $('#sidebar-collapse');
if (sbCollapse) sbCollapse.onclick = () => setSidebarCollapsed(!document.body.classList.contains('sidebar-collapsed'));
initAppearance();
const fsBtn = $('#fullscreen-btn');
if (fsBtn) {
  const fsSync = () => { const on = !!document.fullscreenElement; fsBtn.innerHTML = svgIcon(on ? 'minimize' : 'expand'); fsBtn.title = on ? 'Sair da tela cheia' : 'Tela cheia'; };
  fsBtn.onclick = () => {
    if (document.fullscreenElement) { document.exitFullscreen && document.exitFullscreen(); }
    else { const el = document.documentElement; (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el); }
  };
  document.addEventListener('fullscreenchange', fsSync);
  document.addEventListener('keydown', (e) => { if (e.key === 'F11') { e.preventDefault(); fsBtn.click(); } });
}
$('#modal-close').onclick = closeModal;
$('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };
window.addEventListener('hashchange', router);

// ── Tabelas viram cartões no mobile: rotula cada célula com o seu cabeçalho ──
function labelTableCells(table) {
  const ths = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
  if (!ths.length) return;
  table.querySelectorAll('tbody tr').forEach((tr) => {
    [...tr.children].forEach((td, i) => {
      if (i < ths.length && !td.hasAttribute('data-label')) td.setAttribute('data-label', ths[i]);
    });
  });
}
function enhanceTables(root) { (root || document).querySelectorAll('table').forEach(labelTableCells); }
if ('MutationObserver' in window) {
  let _raf;
  new MutationObserver(() => {
    cancelAnimationFrame(_raf);
    _raf = requestAnimationFrame(() => enhanceTables(document));
  }).observe(document.body, { childList: true, subtree: true });
}

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
