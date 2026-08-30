// ============================================================================
// whatsapp.js — módulo WhatsApp (fila, conversas estilo WhatsApp Web, conexão QR)
// Extraído do app.js (modularização). Carregado DEPOIS do app.js no index.html;
// usa os globais (api, $, esc, money, kpi, fmt*, el, openModal, field, svgIcon,
// toast, closeModal, fileHref) e registra a rota em ROUTES.
// ============================================================================

// Avatar consistente em toda a tela de WhatsApp (Conversas + Kanban + drawer
// de pré-visualização) — mesma cor/iniciais pro mesmo nome, sempre.
// Tempo real (Socket.IO) — evita esperar até 6s de polling pra mensagem nova
// aparecer. Conecta uma vez por sessão (mesmo JWT do `api()`, em auth.token);
// se cair ou o socket.io.js não carregar (offline, bloqueado), o polling de
// fallback continua cobrindo — `waOnUpdate` é sempre opcional.
let waSocket = null;
let waOnUpdate = null; // reapontado por tabConversas() toda vez que a tela de Conversas é aberta
function waConectarSocket() {
  if (waSocket || typeof io === 'undefined' || !TOKEN) return;
  waSocket = io({ auth: { token: TOKEN } });
  waSocket.on('whatsapp:update', (data) => { if (waOnUpdate) waOnUpdate(data); });
}

// Paleta de avatar por contato — tons ligados à identidade do escritório
// (navy/dourado + vizinhos), não os pastéis genéricos de clone de app de
// chat de consumidor. Mesma função (distinguir contatos por cor).
const WA_CORES = ['#2a3f5f', '#a67a34', '#2f6b64', '#7a3b3b', '#5c3a63', '#52586b', '#3f5c46', '#8a6a2f'];
const waCor = (s) => WA_CORES[[...String(s)].reduce((a, ch) => a + ch.charCodeAt(0), 0) % WA_CORES.length];
const waIniciais = (n) => String(n || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const waFmtDia = (d) => {
  const dt = new Date(d), hoje = new Date();
  const ontem = new Date(hoje); ontem.setDate(hoje.getDate() - 1);
  if (dt.toDateString() === hoje.toDateString()) return dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (dt.toDateString() === ontem.toDateString()) return 'Ontem';
  return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

const AGENDA_CAT_PT = { forum: 'Fórum', parceiro: 'Parceiro', cliente: 'Cliente', outro: 'Outro' };

// Agenda telefônica do escritório (fórum, parceiros, clientes) — aberta pelo
// ícone ao lado da busca de conversas. onEscolher(phone) é chamado ao clicar
// em "Conversar" num contato (abre/inicia o chat com esse número).
async function abrirAgendaModal(onEscolher, prefill = null) {
  const body = el(`<div>
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <input id="ag-busca" placeholder="Buscar por nome ou telefone…" style="flex:1">
      <select id="ag-cat" style="max-width:140px"><option value="">Todas</option>${Object.entries(AGENDA_CAT_PT).map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>
      <button class="btn-gold btn-sm" id="ag-novo" type="button">+ Contato</button>
    </div>
    <div id="ag-lista"><div class="spinner"></div></div>
  </div>`);
  openModal('Agenda telefônica', body);

  const load = async () => {
    const q = body.querySelector('#ag-busca').value.trim();
    const cat = body.querySelector('#ag-cat').value;
    const params = new URLSearchParams(); if (q) params.set('q', q); if (cat) params.set('category', cat);
    const rows = await api('/api/phonebook?' + params.toString()).catch(() => []);
    const lista = body.querySelector('#ag-lista');
    lista.innerHTML = rows.length ? rows.map((c) => `
      <div class="mini-row" style="padding:10px 0;border-bottom:1px solid var(--border-soft)">
        <span><strong>${esc(c.name)}</strong> <span class="badge" style="background:var(--gold-soft,#efe3c8);color:var(--navy)">${AGENDA_CAT_PT[c.category] || c.category}</span>
          <br><small style="color:var(--text-muted)">+${esc(c.phone)}${c.notes ? ' · ' + esc(c.notes) : ''}</small></span>
        <span style="white-space:nowrap;display:flex;gap:6px">
          <button class="btn-sm" data-ag-conversar="${c.id}" data-phone="${esc(c.phone)}" type="button">Conversar</button>
          <button class="btn-icon btn-icon-sm" data-ag-editar="${c.id}" type="button" title="Editar">${svgIcon('edit', 'ic-xs')}</button>
          <button class="btn-icon btn-icon-sm" data-ag-apagar="${c.id}" type="button" title="Excluir">${svgIcon('trash', 'ic-xs')}</button>
        </span>
      </div>`).join('') : '<div class="empty">Nenhum contato na agenda.</div>';

    lista.querySelectorAll('[data-ag-conversar]').forEach((b) => b.onclick = () => { closeModal(); onEscolher(b.dataset.phone); });
    lista.querySelectorAll('[data-ag-editar]').forEach((b) => b.onclick = () => {
      const c = rows.find((r) => String(r.id) === b.dataset.agEditar);
      abrirAgendaForm(c, () => abrirAgendaModal(onEscolher));
    });
    lista.querySelectorAll('[data-ag-apagar]').forEach((b) => b.onclick = async () => {
      const c = rows.find((r) => String(r.id) === b.dataset.agApagar);
      if (!(await uiConfirm(`Excluir "${c?.name}" da agenda?`))) return;
      try { await api('/api/phonebook/' + b.dataset.agApagar, { method: 'DELETE' }); toast('Contato removido'); load(); }
      catch (e) { toast(e.message, 'error'); }
    });
  };
  body.querySelector('#ag-busca').oninput = () => load();
  body.querySelector('#ag-cat').onchange = () => load();
  body.querySelector('#ag-novo').onclick = () => abrirAgendaForm(prefill, () => abrirAgendaModal(onEscolher));
  await load();
}

// Formulário de novo contato / edição. `prefill` pode vir com name/phone já
// preenchidos (ex.: "Salvar contato" a partir de uma conversa aberta).
function abrirAgendaForm(prefill, onSave) {
  const editing = !!prefill?.id;
  const form = el(`<form class="form-grid">
    ${field('Nome *', 'name', { value: prefill?.name || '' })}
    ${field('Telefone (DDI+DDD+número) *', 'phone', { value: prefill?.phone || '' })}
    ${field('Categoria', 'category', { options: Object.entries(AGENDA_CAT_PT).map(([v, t]) => ({ v, t })), value: prefill?.category || 'outro' })}
    ${field('Observações', 'notes', { type: 'textarea', value: prefill?.notes || '' })}
    <button type="submit" class="btn-primary">${editing ? 'Salvar' : 'Adicionar à agenda'}</button>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(form));
    if (!b.name.trim()) { toast('Informe o nome', 'error'); return; }
    if (!b.phone.replace(/\D/g, '')) { toast('Informe o telefone', 'error'); return; }
    try {
      if (editing) await api('/api/phonebook/' + prefill.id, { method: 'PUT', body: JSON.stringify(b) });
      else await api('/api/phonebook', { method: 'POST', body: JSON.stringify(b) });
      closeModal(); toast(editing ? 'Contato atualizado' : 'Contato adicionado à agenda'); onSave();
    } catch (err) { toast(err.message, 'error'); }
  };
  openModal(editing ? 'Editar contato' : 'Novo contato na agenda', form);
}

// Auditoria de mensagens apagadas — quem, quando, o texto original e o motivo.
async function abrirAuditoriaModal() {
  const body = el('<div><div class="spinner"></div></div>');
  openModal('Auditoria — mensagens apagadas', body, { wide: true });
  const rows = await api('/api/whatsapp-instance/messages/deletions').catch(() => []);
  body.innerHTML = rows.length ? `
    <table><thead><tr><th>Quando</th><th>Telefone</th><th>Quem apagou</th><th>Texto original</th><th>Motivo</th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td style="white-space:nowrap">${fmtDateTime(r.deleted_at)}</td>
      <td>+${esc(r.phone)}</td>
      <td>${esc(r.deleted_by_name || '—')}</td>
      <td>${esc(r.body_original || '—')}</td>
      <td>${esc(r.reason)}</td>
    </tr>`).join('')}</tbody></table>`
    : '<div class="empty">Nenhuma mensagem apagada ainda.</div>';
}

// Pré-visualização de um contato a partir do Kanban — mostra avatar, nome e
// as últimas mensagens juntos, sem sair da tela de etapas. "Abrir conversa
// completa" leva pra aba Conversas de fato, quando ela quiser responder.
async function abrirPreviaContato(phone, nome, onAbrirConversa) {
  const body = el(`<div>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
      <div class="wc-ava" style="width:48px;height:48px;font-size:16px;background:${waCor(nome)}">${waIniciais(nome)}</div>
      <div><strong style="font-size:15px;color:var(--navy-deep)">${esc(nome)}</strong><br><small style="color:var(--text-muted)">+${esc(phone)}</small></div>
    </div>
    <div id="wcp-msgs" style="max-height:360px;overflow-y:auto;border:1px solid var(--border-soft);border-radius:8px;padding:10px;background:var(--surface-2)"><div class="spinner"></div></div>
    <button class="btn-gold" id="wcp-abrir" style="width:100%;margin-top:14px">${svgIcon('chat')} Abrir conversa completa</button>
  </div>`);
  openModal('Pré-visualização', body);
  body.querySelector('#wcp-abrir').onclick = () => { closeModal(); onAbrirConversa(); };

  const msgs = await api('/api/whatsapp-instance/chats/' + phone).catch(() => []);
  const ultimas = msgs.slice(-8);
  const box = body.querySelector('#wcp-msgs');
  box.innerHTML = ultimas.length ? ultimas.map((m) => `
    <div style="display:flex;${Number(m.from_me) ? 'justify-content:flex-end' : ''};margin-bottom:6px">
      <div style="max-width:80%;padding:6px 10px;border-radius:8px;font-size:12.5px;line-height:1.4;background:${Number(m.from_me) ? '#d9fdd3' : '#fff'};border:1px solid var(--border-soft)">
        ${esc(String(m.body || '').slice(0, 200))}
      </div>
    </div>`).join('') : '<div class="empty">Sem mensagens</div>';
  box.scrollTop = box.scrollHeight;
}

Object.assign(ROUTES, {
  // ── WhatsApp — módulo completo: fila, conversas (instância) e conexão QR ──
  async whatsapp(page) {
    const CTX = { cobranca: ['Cobrança', 'var(--amber)'], audiencia: ['Audiência', 'var(--red)'], protocolo: ['Protocolo', 'var(--green)'], avulsa: ['Avulsa', 'var(--text-muted)'] };
    let tab = 'fila';
    let chatTimer = null;
    let abrirFonePendente = null; // { phone, texto? } a abrir ao entrar em Conversas (clique num card do quadro, ou vindo de outra tela)

    // Vindo de outra tela (ex.: "Chamar no WhatsApp" na ficha do lead) — grava
    // no sessionStorage porque é OUTRA rota (o módulo é remontado do zero,
    // uma variável comum não atravessa). Lido só uma vez, aqui na entrada.
    try {
      const cross = sessionStorage.getItem('wa_abrir_pendente');
      if (cross) {
        sessionStorage.removeItem('wa_abrir_pendente');
        const d = JSON.parse(cross);
        if (d?.phone) { abrirFonePendente = d; tab = 'conversas'; }
      }
    } catch { /* opcional */ }

    const shell = async () => {
      if (chatTimer) { clearInterval(chatTimer); chatTimer = null; }
      const st = await api('/api/whatsapp-instance/status').catch(() => ({ connected: false }));
      const focoTotal = document.body.classList.contains('foco-total');
      page.innerHTML = `
        <div class="page-header">${focoTotal ? '<a href="' + esc(location.pathname) + '" class="foco-voltar">← Voltar ao CRM</a>' : ''}<div><h2>WhatsApp</h2><span class="wa-status-dot ${st.connected ? 'on' : ''}" title="${st.connected ? `Instância conectada (${esc(st.me || '')}) — envio automático ${st.autoSend ? 'LIGADO' : 'desligado'} · ${st.sentToday || 0}/30 hoje` : 'Instância desconectada — a fila usa o wa.me (1 clique) até você conectar'}"></span></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">${focoTotal ? '' : `<button class="btn-ghost" id="wa-tela-cheia" title="Abre numa aba separada, sem menu lateral">${svgIcon('expand')}Tela cheia</button>`}<button class="btn-ghost" id="wa-gerar">Gerar agora</button><button class="btn-gold" id="wa-nova">+ Nova mensagem</button></div></div>
        <div class="tabs" style="margin-bottom:14px">
          <button class="tab ${tab === 'fila' ? 'active' : ''}" data-wtab="fila">Fila</button>
          <button class="tab ${tab === 'conversas' ? 'active' : ''}" data-wtab="conversas">Conversas</button>
          <button class="tab ${tab === 'contatos' ? 'active' : ''}" data-wtab="contatos">Contatos</button>
          <button class="tab ${tab === 'conexao' ? 'active' : ''}" data-wtab="conexao">Conexão</button>
        </div>
        <div id="wa-body"><div class="spinner"></div></div>`;
      // Modo tela-cheia: cabeçalho denso em 1 linha só — o link "← Voltar
      // ao CRM" é criado DIRETO no template acima (não movido de fora),
      // porque page.innerHTML destrói o .page-header a cada shell(); mover
      // o .foco-voltar único (criado 1x pelo app.js, vive em document.body)
      // pra dentro dele o destruía junto no próximo render — a 2ª troca de
      // aba ficava sem o botão E sem a classe que evita o padding de
      // fallback (body.foco-total .page:not(:has(.page-header
      // .foco-voltar))), empurrando a página inteira pra baixo dali em
      // diante. O .foco-voltar original (fixed, em document.body) fica
      // escondido via CSS quando .page-header já tem o seu próprio.
      if (focoTotal) {
        const header = page.querySelector('.page-header');
        const tabsEl = page.querySelector('.tabs');
        const acoesEl = header.querySelector(':scope > div:last-child');
        if (tabsEl && acoesEl) header.insertBefore(tabsEl, acoesEl);
      }
      page.querySelectorAll('[data-wtab]').forEach((b) => b.onclick = () => { tab = b.dataset.wtab; shell(); });
      const telaCheiaBtn = $('#wa-tela-cheia');
      if (telaCheiaBtn) telaCheiaBtn.onclick = () => window.open(location.pathname + '?foco=1#whatsapp', '_blank', 'noopener');
      $('#wa-gerar').onclick = async () => {
        try { const r = await api('/api/whatsapp-queue/gerar', { method: 'POST', body: '{}' }); toast(r.created ? `${r.created} mensagem(ns) preparadas` : 'Nada novo para preparar'); shell(); }
        catch (e) { toast(e.message, 'error'); }
      };
      $('#wa-nova').onclick = async () => {
        const clients = await api('/api/clients?limit=100').catch(() => ({ data: [] }));
        const form = el(`<form class="form-grid">
          ${field('Cliente', 'client_id', { options: [{ v: '', t: '— avulso (digitar telefone) —' }, ...clients.data.map((c2) => ({ v: c2.id, t: c2.name }))] })}
          ${field('Nome *', 'name')}
          ${field('Telefone (DDD + número) *', 'phone')}
          ${field('Mensagem *', 'message', { type: 'textarea' })}
          <button type="submit" class="btn-primary">Adicionar à fila</button>
        </form>`);
        const sel = form.querySelector('[name=client_id]');
        sel.onchange = () => {
          const c2 = clients.data.find((x) => x.id == sel.value);
          if (c2) { form.querySelector('[name=name]').value = c2.name || ''; form.querySelector('[name=phone]').value = c2.phone || ''; }
        };
        form.onsubmit = async (ev) => {
          ev.preventDefault();
          const b = Object.fromEntries(new FormData(form));
          try {
            await api('/api/whatsapp-queue', { method: 'POST', body: JSON.stringify({ client_id: b.client_id || null, name: b.name, phone: b.phone, message: b.message }) });
            closeModal(); toast('Mensagem adicionada à fila'); shell();
          } catch (e) { toast(e.message, 'error'); }
        };
        openModal('Nova mensagem de WhatsApp', form);
      };
      if (tab === 'fila') await tabFila(st);
      else if (tab === 'conversas') await tabConversas();
      else if (tab === 'contatos') await tabContatos();
      else await tabConexao(st);
    };

    // ── Aba CONEXÃO: QR code / status / auto-envio ──
    const tabConexao = async (st) => {
      const body = $('#wa-body');
      const render = (s) => {
        body.innerHTML = `<div class="card" style="padding:22px;max-width:560px">
          ${s.connected ? `
            <div style="display:flex;align-items:center;gap:10px"><span class="badge pago">conectado</span><strong style="color:var(--navy-deep)">${esc(s.me || '')}</strong></div>
            <p class="sub" style="margin-top:10px">A fila é enviada automaticamente com pausa de segurança (1 mensagem a cada 1–2 min, máx. 30/dia). Hoje: <strong>${s.sentToday || 0}/30</strong>.</p>
            <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
              <button class="btn-sm" id="wac-auto">${s.autoSend ? 'Pausar envio automático' : 'Ligar envio automático'}</button>
              <button class="btn-ghost btn-sm" id="wac-off" style="color:var(--red)">Desconectar (apaga a sessão)</button>
            </div>`
          : s.qr ? `
            <strong style="color:var(--navy-deep)">Escaneie para conectar</strong>
            <p class="sub" style="margin:8px 0 14px">No celular: WhatsApp → Configurações → <strong>Aparelhos conectados</strong> → Conectar aparelho. Vale para qualquer número (principal ou chip dedicado).</p>
            <div style="text-align:center"><img src="${s.qr}" alt="QR Code" style="width:260px;max-width:100%;border:1px solid var(--border);border-radius:8px"></div>
            <p class="sub" style="margin-top:10px;text-align:center">O código renova sozinho — aguarde nesta tela após escanear.</p>`
          : `
            <strong style="color:var(--navy-deep)">Instância desconectada</strong>
            <p class="sub" style="margin:8px 0 14px">Conecte seu WhatsApp por QR code para: enviar a fila automaticamente, receber e responder conversas aqui no CRM. <strong>Atenção:</strong> conexão não-oficial (protocolo do WhatsApp Web) — use com moderação; um chip dedicado é o mais seguro.</p>
            <button class="btn-gold" id="wac-on">${s.connecting ? 'Gerando QR…' : 'Conectar (gerar QR code)'}</button>
            ${s.lastError ? `<p class="sub" style="color:var(--red);margin-top:8px">${esc(s.lastError)}</p>` : ''}`}
        </div>`;
        const on = body.querySelector('#wac-on');
        if (on) on.onclick = async () => { on.disabled = true; on.textContent = 'Gerando QR…'; await api('/api/whatsapp-instance/connect', { method: 'POST', body: '{}' }).catch(() => {}); };
        const off = body.querySelector('#wac-off');
        if (off) off.onclick = async () => {
          if (!(await uiConfirm('Desconectar a instância? Será preciso escanear o QR de novo.'))) return;
          await api('/api/whatsapp-instance/disconnect', { method: 'POST', body: '{}' }).catch(() => {});
        };
        const auto = body.querySelector('#wac-auto');
        if (auto) auto.onclick = async () => { await api('/api/whatsapp-instance/auto', { method: 'POST', body: JSON.stringify({ on: !s.autoSend }) }).catch(() => {}); };
      };
      render(st);
      // Atualiza status/QR a cada 3s enquanto estiver nesta aba. Só refaz a
      // tela inteira quando o "formato" muda (conectou, desconectou, QR
      // apareceu pela 1ª vez) — se já está mostrando QR e o novo status
      // também é QR, só troca a imagem no lugar. Sem isso, a tela inteira
      // piscava a cada 3s (recriava tudo, mesmo o QR sendo o mesmo).
      let lastShape = st.connected ? 'connected' : st.qr ? 'qr' : 'off';
      chatTimer = setInterval(async () => {
        if (tab !== 'conexao') { clearInterval(chatTimer); chatTimer = null; return; }
        const s = await api('/api/whatsapp-instance/status').catch(() => null);
        if (!s) return;
        const shape = s.connected ? 'connected' : s.qr ? 'qr' : 'off';
        if (shape === 'qr' && lastShape === 'qr') {
          const img = body.querySelector('img[alt="QR Code"]');
          if (img && s.qr && img.src !== s.qr) img.src = s.qr;
        } else {
          render(s);
        }
        lastShape = shape;
      }, 3000);
    };

    // ── Aba CONVERSAS: experiência estilo WhatsApp Web dentro do CRM ──
    const tabConversas = async () => {
      const body = $('#wa-body');
      const cor = (s) => WA_CORES[[...String(s)].reduce((a, ch) => a + ch.charCodeAt(0), 0) % WA_CORES.length];
      const iniciais = (n) => String(n || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
      const parseLabels = (l) => { try { const a = JSON.parse(l || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
      const fmtHora = (d) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const fmtDia = (d) => {
        const dt = new Date(d), hoje = new Date();
        const ontem = new Date(hoje); ontem.setDate(hoje.getDate() - 1);
        if (dt.toDateString() === hoje.toDateString()) return 'Hoje';
        if (dt.toDateString() === ontem.toDateString()) return 'Ontem';
        return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      };

      let chats = [];
      let ativo = null;         // { phone, name, client_id, labels }
      let busca = '';
      let filtro = '';          // etiqueta selecionada no filtro
      let mostrarMeus = false;  // filtro "Meus atendimentos" (assigned_user_id === USER.id)
      // Pastas horizontais acima da lista — "amei essa parte" (pedido explícito
      // da usuária pra reduzir ruído visual quando há muitas conversas abertas).
      // Deriva 100% do que já vinha em cada conversa (archived + quem mandou a
      // última mensagem) — sem coluna nova no banco, sem migration:
      //   fechados     → conversa arquivada
      //   aguardando   → a última mensagem foi do CONTATO (ainda sem resposta nossa)
      //   atendimento  → a última mensagem foi NOSSA (conversa em andamento)
      let pasta = 'atendimento';
      // Preferência da usuária pra Ficha do contato (aberta/fechada) — LEMBRADA
      // entre conversas, nunca recalculada a cada clique. Antes, abrirChat()
      // decidia sozinho "abrir se a tela for larga" toda vez que uma conversa
      // era aberta, o que reabria a ficha mesmo logo depois de a usuária
      // fechá-la — o grid pulava de 2 pra 3 colunas a cada clique num contato
      // (o "a tela muda de tamanho" reportado). Agora só muda quando ELA pede.
      let ctxAberta = window.innerWidth >= 1100;
      let qtdMsgs = 0;          // p/ detectar novidade no polling
      let listaHtmlAtual = '';  // p/ pular re-render quando nada mudou (evita piscar/pesar)
      let ultimaInteracaoLista = 0; // p/ não deixar o polling reordenar a lista embaixo do dedo logo após um clique

      body.innerHTML = `<div class="wa-shell" id="wa-shell">
        <div class="wa-side">
          <div class="wa-head-col">
            <span class="wa-head-col-title">Conversas</span>
            <span class="wa-head-col-unread" id="wa-unread-total"></span>
          </div>
          <div class="wa-search" style="display:flex;gap:6px;align-items:center">${svgIcon('search', 'ic-inline')}<input id="waq" placeholder="Buscar por cliente ou processo…" autocomplete="off"><button type="button" class="btn-icon btn-icon-sm" id="wa-agenda-btn" title="Agenda telefônica">${svgIcon('users', 'ic-xs')}</button><button type="button" class="btn-icon btn-icon-sm" id="wa-auditoria-btn" title="Auditoria de mensagens apagadas">${svgIcon('info', 'ic-xs')}</button></div>
          <div class="wa-pastas" id="wap-tabs"></div>
          <div class="wa-filters" id="waf"></div>
          <div class="wa-list" id="wal"></div>
        </div>
        <div class="wa-pane" id="wap">
          <div class="wa-empty wa-empty-inicial">
            <div class="wa-empty-badge">${svgIcon('scale')}</div>
            <strong>Central de conversas</strong>
            <p>Escolha uma conversa ao lado para ver o histórico, responder e organizar o atendimento.</p>
          </div>
        </div>
        <div class="wa-ctx" id="wa-ctx"></div>
      </div>`;

      // Altura calculada de verdade (topo do quadro até o fim da viewport),
      // em vez de um "calc(100vh - Npx)" fixo no CSS que não bate com a
      // altura real do cabeçalho/abas em cada tamanho de tela — por isso o
      // quadro ficava cortando a caixa de mensagem embaixo.
      const ajustarAltura = () => {
        if (tab !== 'conversas') { window.removeEventListener('resize', ajustarAltura); return; }
        const shellEl = $('#wa-shell');
        if (!shellEl) return;
        const topo = shellEl.getBoundingClientRect().top;
        // Em tela-cheia o quadro é edge-to-edge (sem moldura/cartão — ver
        // .foco-total .wa-shell no CSS), então não sobra folga nenhuma no
        // fundo; fora dela, mantém os 20px de respiro do "cartão" original.
        const folga = document.body.classList.contains('foco-total') ? 0 : 20;
        shellEl.style.height = Math.max(480, window.innerHeight - topo - folga) + 'px';
      };
      ajustarAltura();
      window.addEventListener('resize', ajustarAltura);

      const todasEtiquetas = () => [...new Set(chats.flatMap((c) => parseLabels(c.labels)))];

      // Botão único "Filtrar" + menu suspenso, no lugar da fileira de chips
      // sempre visível (ficava confusa: quebrava em várias linhas dentro de
      // uma caixa apertada com scroll vertical sem nenhum sinal de que dava
      // pra rolar — pedido explícito da usuária pra ficar "mais organizado,
      // menos coisas"). Mantém a mesma lógica de estado (filtro/arquivadas).
      const fecharMenuFiltro = () => {
        const m = $('#waf-menu'); if (m) m.remove();
        document.removeEventListener('click', onClickFora, true);
      };
      const onClickFora = (e) => { if (!e.target.closest('#waf')) fecharMenuFiltro(); };
      const renderFiltros = () => {
        // renderFiltros() também roda no polling (atualizar(), a cada 6s) —
        // se o menu estiver aberto nesse momento, o innerHTML abaixo apaga
        // #waf-menu do DOM sem passar por fecharMenuFiltro(), deixando o
        // listener onClickFora pendurado no document. Fecha primeiro.
        fecharMenuFiltro();
        renderPastas();
        const ets = todasEtiquetas();
        const meusN = chats.filter((c) => Number(c.assigned_user_id) === USER.id).length;
        const ativoLabel = mostrarMeus ? `Meus atendimentos (${meusN})` : (filtro || 'Todas');
        const nAtivos = (filtro || mostrarMeus) ? 1 : 0;
        $('#waf').innerHTML = `<button type="button" class="wa-filter-btn" id="waf-btn">${svgIcon('filter', 'ic-xs')}<span>${esc(ativoLabel)}</span>${nAtivos ? `<span class="wa-filter-count">${nAtivos}</span>` : ''}${svgIcon('chevronDown', 'ic-xs')}</button>`;
        $('#waf-btn').onclick = (e) => {
          e.stopPropagation();
          if ($('#waf-menu')) { fecharMenuFiltro(); return; }
          const opts = [`<div class="wa-filter-opt ${!filtro && !mostrarMeus ? 'active' : ''}" data-f="">${svgIcon('dot', 'ic-xs')}Todas</div>`,
            `<div class="wa-filter-opt ${mostrarMeus ? 'active' : ''}" data-meus="1">${svgIcon('users', 'ic-xs')} Meus atendimentos (${meusN})</div>`,
            ...ets.map((t) => `<div class="wa-filter-opt ${filtro === t ? 'active' : ''}" data-f="${esc(t)}"><span class="wa-filter-dot" style="background:${cor(t)}"></span>${esc(t)}</div>`)].join('');
          const menu = document.createElement('div');
          menu.className = 'wa-filter-menu'; menu.id = 'waf-menu'; menu.innerHTML = opts;
          $('#waf').appendChild(menu);
          menu.querySelectorAll('[data-f]').forEach((o) => o.onclick = () => { filtro = o.dataset.f; mostrarMeus = false; fecharMenuFiltro(); renderFiltros(); renderLista(); });
          const meusOpt = menu.querySelector('[data-meus]');
          if (meusOpt) meusOpt.onclick = () => { mostrarMeus = !mostrarMeus; filtro = ''; fecharMenuFiltro(); renderFiltros(); renderLista(); };
          document.addEventListener('click', onClickFora, true);
        };
      };

      // Mesma lógica/limiares de src/services/whatsappSeveridade.ts — ver spec
      // docs/superpowers/specs/2026-08-21-whatsapp-conversas-redesign.md. Reescrita aqui
      // porque este arquivo é servido direto ao navegador, sem build step.
      const severidadeAudiencia = (dias) => {
        if (dias === null || dias === undefined) return 'neutra';
        if (dias <= 2) return 'critica';
        if (dias <= 7) return 'atencao';
        return 'neutra';
      };
      const severidadeParcela = (dias) => {
        if (dias === null || dias === undefined) return 'neutra';
        if (dias <= 0) return 'critica';
        if (dias <= 3) return 'atencao';
        return 'neutra';
      };
      const PESO_SEV = { critica: 2, atencao: 1, neutra: 0 };
      const severidadeConversa = (c) => {
        const a = severidadeAudiencia(c.proxima_audiencia_dias);
        const p = severidadeParcela(c.parcela_vencendo_dias);
        return PESO_SEV[a] >= PESO_SEV[p] ? a : p;
      };
      const etiquetaPendencia = (c) => {
        const a = severidadeAudiencia(c.proxima_audiencia_dias);
        const p = severidadeParcela(c.parcela_vencendo_dias);
        if (a === 'neutra' && p === 'neutra') return null;
        if (PESO_SEV[a] >= PESO_SEV[p]) {
          const d = c.proxima_audiencia_dias;
          const texto = d === 0 ? 'Audiência hoje' : d === 1 ? 'Audiência amanhã' : `Audiência em ${d} dias`;
          return { icone: 'scale', texto };
        }
        const d = c.parcela_vencendo_dias;
        const texto = d < 0 ? 'Parcela atrasada' : d === 0 ? 'Parcela vence hoje' : `Parcela vence em ${d} dia${d === 1 ? '' : 's'}`;
        return { icone: 'banknote', texto };
      };
      const pastaDaConversa = (c) => Number(c.archived) ? 'fechados' : (Number(c.last_from_me) ? 'atendimento' : 'aguardando');

      // Cartão inline no topo do fluxo de mensagens — a informação crítica
      // (prazo de audiência perto, parcela vencendo) aparece NO MEIO da
      // conversa, no momento em que ela vai responder, em vez de só escondida
      // na Ficha do contato (que pode estar fechada). Reusa a mesma
      // severidade já calculada pra lista, sem chamada nova ao servidor.
      const cartaoInlinePendencia = (c) => {
        const sev = severidadeConversa(c);
        if (sev === 'neutra') return '';
        const et = etiquetaPendencia(c);
        if (!et) return '';
        return `<div class="wa-inline-card wa-inline-card-${sev}">
          <span class="wa-inline-card-icon">${svgIcon(et.icone)}</span>
          <span class="wa-inline-card-txt"><strong>${esc(et.texto)}</strong><br><small>Fique de olho antes de responder — veja os detalhes na ficha do contato.</small></span>
          <button type="button" class="btn-sm" id="wa-inline-card-ficha">Ver ficha</button>
        </div>`;
      };

      // Pastas horizontais — 1 botão único por pasta, com contador. Refeito a
      // cada renderFiltros() (mesmos pontos de chamada já cobrem todo lugar
      // que muda `chats`, incl. o polling), então os contadores nunca ficam
      // desatualizados.
      const renderPastas = () => {
        const box = $('#wap-tabs'); if (!box) return;
        const cont = { atendimento: 0, aguardando: 0, fechados: 0 };
        chats.forEach((c) => cont[pastaDaConversa(c)]++);
        const PASTAS = [['atendimento', 'Em atendimento'], ['aguardando', 'Aguardando'], ['fechados', 'Fechados']];
        box.innerHTML = PASTAS.map(([v, t]) => `<button type="button" class="wa-pasta-tab ${pasta === v ? 'active' : ''}" data-pasta="${v}">${t}<span class="wa-pasta-count">${cont[v]}</span></button>`).join('');
        box.querySelectorAll('[data-pasta]').forEach((b) => b.onclick = () => {
          if (pasta === b.dataset.pasta) return;
          pasta = b.dataset.pasta; renderPastas(); renderLista();
        });
      };

      const renderLista = () => {
        const q = busca.toLowerCase();
        let vis = chats.filter((c) => {
          if (q && !(String(c.client_name || '').toLowerCase().includes(q) || String(c.phone).includes(q))) return false;
          if (pastaDaConversa(c) !== pasta) return false;
          if (filtro && !parseLabels(c.labels).includes(filtro)) return false;
          if (mostrarMeus && Number(c.assigned_user_id) !== USER.id) return false;
          return true;
        });
        vis = [...vis].sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (new Date(b.last_time) - new Date(a.last_time)));
        const html = vis.length ? vis.map((c) => {
          const nome = c.client_name || c.push_name || '+' + c.phone;
          const tags = parseLabels(c.labels);
          const sev = severidadeConversa(c);
          const et = etiquetaPendencia(c);
          return `<div class="wa-item sev-${sev} ${ativo && ativo.phone === c.phone ? 'on' : ''}" data-chat="${esc(c.phone)}">
            <div class="wa-ava" style="background:${cor(nome)}">${iniciais(nome)}</div>
            <div class="wa-item-mid">
              <div class="wa-item-name">${Number(c.pinned) ? svgIcon('pin', 'ic-xs') + ' ' : ''}${esc(nome)}</div>
              <div class="wa-item-prev">${Number(c.last_from_me) ? '✓ ' : ''}${esc(String(c.last_body || '').slice(0, 52))}</div>
              ${tags.length ? `<div class="wa-tags">${tags.map((t) => `<span class="wa-tag" style="background:${cor(t)}">${esc(t)}</span>`).join('')}</div>` : ''}
              ${et ? `<span class="wa-pill wa-pill-${sev}">${svgIcon(et.icone, 'ic-xs')}${esc(et.texto)}</span>` : ''}
            </div>
            <div class="wa-item-right">
              <div class="wa-item-time">${fmtDia(c.last_time) === 'Hoje' ? fmtHora(c.last_time) : fmtDia(c.last_time)}</div>
              ${Number(c.unread) ? `<span class="wa-unread">${c.unread}</span>` : ''}
            </div>
          </div>`;
        }).join('') : `<div class="wa-empty">${pasta === 'fechados' ? 'Nenhuma conversa fechada' : 'Nenhuma conversa encontrada'}</div>`;
        const totalNaoLidas = chats.reduce((s, c) => s + Number(c.unread || 0), 0);
        const elUnread = $('#wa-unread-total');
        if (elUnread) elUnread.textContent = totalNaoLidas ? `${totalNaoLidas} não lida${totalNaoLidas > 1 ? 's' : ''}` : '';
        // Nada mudou desde o último render (comum no polling de 6s) — pula a
        // reconstrução do DOM. Isso é o que causava a piscada/oscilação e o
        // peso: a lista inteira era refeita mesmo sem mudança nenhuma.
        if (html === listaHtmlAtual) return;
        listaHtmlAtual = html;
        // innerHTML zera o scroll — sem isso, a lista "voltava sozinha pro
        // topo" a cada atualização (parecia que não dava pra rolar).
        const scrollAtual = $('#wal').scrollTop;
        $('#wal').innerHTML = html;
        $('#wal').scrollTop = scrollAtual;
        $('#wal').querySelectorAll('[data-chat]').forEach((r) => r.onclick = () => {
          ultimaInteracaoLista = Date.now();
          // Marca o item clicado como ativo na hora — sem isso, o destaque
          // (.on) só aparecia no próximo renderLista(), que só roda via
          // polling (a cada 6s, e travado por 1200ms logo após um clique):
          // clicar num 2º contato logo em seguida do 1º não mudava nada
          // visualmente por vários segundos.
          $('#wal').querySelectorAll('.wa-item.on').forEach((el) => el.classList.remove('on'));
          r.classList.add('on');
          const c = chats.find((x) => x.phone === r.dataset.chat);
          abrirChat(c);
        });
      };

      // Busca DENTRO da conversa aberta (client-side — as mensagens já estão
      // carregadas em memória). Cada ocorrência vira <mark data-hl="N"> em
      // ordem global na conversa, pra dar pra navegar "próxima/anterior" e
      // pular até ela — igual à busca em chat do WhatsApp de verdade.
      // Confirmação de leitura — mapeia o status bruto que a Uazapi manda
      // (varia de caixa/nome, por isso é por trecho, não igualdade exata) pro
      // ícone de sempre: ✓ enviado, ✓✓ entregue, ✓✓ azul lido.
      const statusIcone = (raw) => {
        if (!raw) return '<span class="wa-check" title="Enviado">✓</span>';
        const s = String(raw).toLowerCase();
        if (s.includes('read') || s.includes('played')) return '<span class="wa-check lido" title="Lido">✓✓</span>';
        if (s.includes('deliver') || s.includes('ack')) return '<span class="wa-check" title="Entregue">✓✓</span>';
        return '<span class="wa-check" title="Enviado">✓</span>';
      };

      // Marcadores de formatação do WhatsApp (*negrito*, _itálico_, ~tachado~,
      // ```monoespaçado```) — aplicado SEMPRE depois de esc(), nunca antes,
      // pra não abrir brecha de XSS via corpo de mensagem recebida.
      const formatarWaTexto = (h) => h
        .replace(/```([^`\n]+)```/g, '<code>$1</code>')
        .replace(/(^|[\s(])\*([^\n*]+)\*(?=[\s).,!?]|$)/g, '$1<b>$2</b>')
        .replace(/(^|[\s(])_([^\n_]+)_(?=[\s).,!?]|$)/g, '$1<i>$2</i>')
        .replace(/(^|[\s(])~([^\n~]+)~(?=[\s).,!?]|$)/g, '$1<s>$2</s>');

      const renderMsgs = (msgs, termoBusca, ativoIdx) => {
        let dia = '';
        let contador = 0;
        const termoEsc = termoBusca ? termoBusca.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
        return msgs.map((m) => {
          const d = fmtDia(m.msg_time);
          const sep = d !== dia ? `<div class="wa-day">${d}</div>` : '';
          dia = d;
          const mimeAnexo = m.media_mime ? String(m.media_mime) : '';
          const ehAudio = mimeAnexo.startsWith('audio/');
          let anexo = '';
          if (m.media_id && m.media_url) {
            const url = esc(m.media_url);
            if (mimeAnexo.startsWith('image/')) {
              anexo = `<br><a href="${url}" target="_blank" rel="noopener"><img src="${url}" class="wa-anexo-img" loading="lazy" alt="Imagem recebida"></a>`;
            } else if (ehAudio) {
              anexo = `<br><audio controls preload="none" class="wa-anexo-audio" src="${url}"></audio>`;
            } else if (mimeAnexo.startsWith('video/')) {
              anexo = `<br><video controls preload="none" class="wa-anexo-video" src="${url}"></video>`;
            } else {
              anexo = `<br><a href="${url}" target="_blank" rel="noopener" class="wa-anexo-link">${svgIcon('paperclip', 'ic-inline')}Abrir anexo</a>`;
            }
            if (ehAudio && !String(m.body).includes('📝 Transcrição:')) {
              anexo += ` <button type="button" class="btn-sm" data-transcrever="${m.media_id}" style="font-size:11px;padding:2px 8px;margin-left:6px">Transcrever áudio</button>`;
            }
          }
          const autor = Number(m.from_me) && m.sent_by ? `<div style="font-size:9.5px;color:rgba(0,0,0,.45);margin-bottom:2px">${esc(m.sent_by)}</div>` : '';
          let corpo = esc(m.body);
          if (termoEsc) {
            corpo = corpo.replace(new RegExp(termoEsc, 'gi'), (match) => {
              const i = contador++;
              return `<mark class="wa-hl${i === ativoIdx ? ' cur' : ''}" data-hl="${i}">${match}</mark>`;
            });
          }
          corpo = `<span class="wa-corpo">${formatarWaTexto(corpo)}</span>`;
          // Editar/apagar — só mensagem NOSSA, ainda não apagada (o WhatsApp só
          // deixa mexer no que você mesmo mandou, dentro do prazo dele).
          const podeMexer = Number(m.from_me) && m.body !== '🚫 Mensagem apagada';
          const podeResponder = m.body !== '🚫 Mensagem apagada';
          const botoesMexer = podeMexer ? `${!m.media_id ? `<button type="button" data-editar-msg="${m.id}" title="Editar">${svgIcon('edit', 'ic-xs')}</button>` : ''}<button type="button" data-apagar-msg="${m.id}" title="Apagar">${svgIcon('trash', 'ic-xs')}</button>` : '';
          const acoes = (podeResponder || botoesMexer)
            ? `<span class="wa-msg-acoes">${podeResponder ? `<button type="button" data-reagir-msg="${m.id}" data-phone="${ativo.phone}" title="Reagir">${svgIcon('smile', 'ic-xs')}</button><button type="button" data-responder-msg="${m.id}" title="Responder">${svgIcon('reply', 'ic-xs')}</button>` : ''}${botoesMexer}</span>`
            : '';
          const citacao = m.reply_to_body
            ? `<div class="wa-quote">${esc(String(m.reply_to_body).slice(0, 120))}</div>`
            : (m.reply_to_message_id ? `<div class="wa-quote wa-quote-sumiu">Mensagem original não encontrada</div>` : '');
          return `${sep}<div class="wa-bub ${Number(m.from_me) ? 'out' : 'in'}">${acoes}${autor}${citacao}${corpo}${anexo}<span class="wa-time">${fmtHora(m.msg_time)}${Number(m.from_me) ? ' ' + statusIcone(m.status) : ''}</span></div>`;
        }).join('') || '<div class="wa-empty">Sem mensagens</div>';
      };

      // ── Painel de contexto (ficha ao lado da conversa) ──
      const renderContexto = async () => {
        const box = $('#wa-ctx'); if (!box || !ativo) return;
        box.innerHTML = '<div class="spinner"></div>';
        const cx = await api(`/api/whatsapp-instance/chats/${ativo.phone}/context`).catch(() => null);
        if (!cx) { box.innerHTML = '<div class="wa-empty">—</div>'; return; }
        const STG = { separacao_documentos: 'Separação de docs', criacao_inicial: 'Criação inicial', revisao_inicial: 'Revisão inicial', aguardando_protocolo: 'Aguard. protocolo', protocolado: 'Protocolado', concluido: 'Concluído' };
        const bloco = (t, inner) => `<div style="padding:12px 14px;border-bottom:1px solid var(--border-soft)"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:6px">${t}</div>${inner}</div>`;
        let html = '';
        // Linha do card padrão de dados ("rótulo: valor"), usada nos cards
        // PROCESSO e FINANCEIRO abaixo — mesmo formato nos dois, só muda a cor
        // quando `alerta` é true (prazo perto / parcela vencida).
        const linha = (rotulo, valor, alerta) => `<div style="display:flex;justify-content:space-between;gap:10px;font-size:12.5px;padding:3px 0"><span style="color:var(--text-muted)">${rotulo}</span><strong style="color:${alerta ? 'var(--red)' : 'var(--navy-deep)'}">${valor}</strong></div>`;
        if (cx.client) {
          const area = (cx.cases || []).map((c) => c.legal_area).find(Boolean);
          html += bloco('Cliente', `<strong style="color:var(--navy-deep);font-size:13.5px">${esc(cx.client.name)}</strong>
            <div style="margin-top:6px">${linha('CPF', esc(cx.client.cpf_cnpj || '—'))}${linha('Área do direito', esc(area || '—'))}</div>`);

          // ── PROCESSO — nº, etapa e audiência, nesta ordem exata (pedido
          // explícito da usuária). Mostra o processo mais recente; se houver
          // mais de um, o restante fica listado embaixo sem tirar o destaque
          // dos 3 dados principais.
          const casoPrincipal = (cx.cases || [])[0] || null;
          const diasAud = cx.audiencia ? Math.ceil((new Date(cx.audiencia.start_datetime) - new Date()) / 86400000) : null;
          const audAlerta = diasAud !== null && diasAud <= 3;
          const audTexto = cx.audiencia
            ? (diasAud <= 0 ? 'hoje' : diasAud === 1 ? 'amanhã' : `em ${diasAud} dias`) + ` · ${fmtDateTime(cx.audiencia.start_datetime)}`
            : 'nenhuma marcada';
          html += bloco('Processo', casoPrincipal
            ? linha('Nº', esc(casoPrincipal.case_number || '—')) + linha('Etapa', esc(STG[casoPrincipal.production_stage] || casoPrincipal.production_stage || casoPrincipal.status || '—')) + linha('Audiência', audTexto, audAlerta)
              + ((cx.cases || []).length > 1 ? `<div style="margin-top:6px"><small style="color:var(--text-muted)">+ ${cx.cases.length - 1} outro${cx.cases.length - 1 > 1 ? 's' : ''} processo${cx.cases.length - 1 > 1 ? 's' : ''}</small></div>` : '')
            : '<small style="color:var(--text-muted)">Nenhum processo cadastrado</small>');

          // ── FINANCEIRO — parcelas em aberto e vencidas, nesta ordem exata.
          const f = cx.financeiro || {};
          html += bloco('Financeiro',
            linha('Parcelas em aberto', Number(f.pendentes) ? `${f.pendentes}${Number(f.valor_aberto) ? ' · ' + money(f.valor_aberto) : ''}` : '0')
            + linha('Vencida', Number(f.vencidas) || 0, Number(f.vencidas) > 0));

          html += `<div style="padding:12px 14px"><button class="wa-ctx-primary" id="wa-gerar-ia">${svgIcon('ia')}Gerar com IA a partir desta conversa</button></div>`;
          // ── Linha do tempo do caso (documentos, audiências, petições…) —
          // simplificada: reusa o mesmo endpoint da ficha do cliente
          // (/api/clients/:id/timeline), sem duplicar lógica no backend.
          html += `<div id="wa-ctx-timeline">${bloco('Linha do tempo', '<div class="spinner" style="margin:4px 0"></div>')}</div>`;
        } else if (cx.lead) {
          html += bloco('Lead', `<strong style="color:var(--navy-deep)">${esc(cx.lead.name)}</strong><br><small style="color:var(--text-muted)">${esc(cx.lead.legal_area || '')} · ${esc(cx.lead.status || '')}</small>`);
        } else {
          const sug = cx.lead_sugerido;
          html += bloco('Contato', `<small style="color:var(--text-muted)">Número não cadastrado.</small>
            ${sug ? `<div style="margin-top:8px;padding:8px 10px;background:var(--surface);border:1px solid var(--gold);border-radius:6px;font-size:12.5px"><strong style="color:var(--navy);display:flex;align-items:center">${svgIcon('ia', 'ic-inline')}Parece um caso novo</strong><br>${esc(sug.resumo)}</div>` : ''}
            <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px"><button class="btn-gold btn-sm" id="wa-mklead">+ Cadastrar como lead</button><button class="btn-sm" id="wa-vincular-cliente">Vincular a cliente existente</button></div>`);
        }
        html += bloco('Última resposta do contato', cx.ultima_resposta ? `<small>${fmtDateTime(cx.ultima_resposta)}</small>` : '<small style="color:var(--text-muted)">nunca respondeu</small>');
        html += bloco('Converter conversa em…', `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
            <button class="btn-sm" data-conv="tarefa">+ Tarefa</button>
            <button class="btn-sm" data-conv="prazo" ${(cx.cases || []).length ? '' : 'disabled title="Precisa de um processo"'}>+ Prazo</button>
            <button class="btn-sm" data-conv="compromisso">+ Compromisso</button>
            <button class="btn-sm" data-conv="anotacao" ${cx.client ? '' : 'disabled title="Precisa ser cliente"'}>+ Anotação</button>
          </div>`);
        html += `<div style="padding:12px 14px"><button class="wa-ctx-primary" id="wa-resumo">${svgIcon('ia')}Resumir conversa com IA</button></div>`;
        box.innerHTML = `<div style="padding:10px 14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
            <strong style="font-size:13px;color:var(--navy)">Ficha do contato</strong>
            <span style="display:flex;gap:4px">
              <button class="btn-icon btn-icon-sm" id="wa-ctx-agenda" title="Salvar na agenda telefônica">${svgIcon('users', 'ic-xs')}</button>
              <button class="btn-icon btn-icon-sm" id="wa-ctx-close" title="Fechar">${svgIcon('x', 'ic-xs')}</button>
            </span>
          </div>` + html;
        box.querySelector('#wa-ctx-close').onclick = () => { ctxAberta = false; $('#wa-shell').classList.remove('ctx-open'); $('#wa-info')?.classList.remove('on'); };
        if (cx.client) {
          const TL_ICONE = { documento: 'file', audiencia: 'scale', peticao: 'file', prazo: 'calendar', pagamento: 'banknote' };
          api(`/api/clients/${cx.client.id}/timeline`).then((eventos) => {
            const slot = box.querySelector('#wa-ctx-timeline');
            if (!slot) return; // usuária já trocou de conversa/fechou a ficha
            const itens = (eventos || []).slice(0, 8);
            slot.innerHTML = bloco('Linha do tempo', itens.length ? `
              <div style="display:flex;flex-direction:column;gap:10px">
                ${itens.map((e) => `<div style="display:flex;gap:8px;align-items:flex-start">
                  <span style="flex:0 0 auto;margin-top:1px;color:var(--gold)">${svgIcon(TL_ICONE[e.event_type] || 'dot', 'ic-xs')}</span>
                  <div style="min-width:0"><div style="font-size:12px;line-height:1.4">${esc(String(e.description || '').slice(0, 140))}</div>
                    <small style="color:var(--text-muted)">${fmtDateTime(e.created_at)}${e.case_number ? ' · nº ' + esc(e.case_number) : ''}</small></div>
                </div>`).join('')}
              </div>` : '<small style="color:var(--text-muted)">Sem eventos registrados ainda</small>');
          }).catch(() => {
            const slot = box.querySelector('#wa-ctx-timeline');
            if (slot) slot.innerHTML = '';
          });
        }
        box.querySelector('#wa-ctx-agenda').onclick = () => abrirAgendaForm(
          { name: cx.client?.name || cx.lead?.name || ativo.name || '', phone: ativo.phone, category: cx.client ? 'cliente' : 'outro' },
          () => renderContexto()
        );

        const mk = box.querySelector('#wa-mklead');
        if (mk) mk.onclick = () => {
          const sug = cx.lead_sugerido;
          const form = el(`<form class="form-grid">
            ${field('Nome *', 'name', { value: (sug && sug.nome) || (ativo.name.startsWith('+') ? '' : ativo.name) })}
            ${field('Área', 'legal_area', { value: (sug && sug.area) || '', options: [['trabalhista','Trabalhista'],['previdenciario','Previdenciário'],['consumidor','Consumidor'],['familia','Família'],['civel','Cível'],['gestante','Gestante'],['outro','Outro']].map(([v, t]) => ({ v, t })) })}
            ${field('Origem', 'source', { options: [['whatsapp','WhatsApp'],['instagram','Instagram'],['google','Google'],['indicacao','Indicação'],['outro','Outro']].map(([v, t]) => ({ v, t })) })}
            ${field('Observações', 'notes', { type: 'textarea', value: (sug && sug.resumo) || '' })}
            <div style="display:flex;gap:8px"><button type="button" class="btn-ghost" id="lead-ia" style="flex:1">${svgIcon('ia')}Preencher com IA</button><button type="submit" class="btn-primary" style="flex:1">Cadastrar lead</button></div>
          </form>`);
          form.querySelector('#lead-ia').onclick = async (ev) => {
            ev.target.disabled = true; ev.target.textContent = 'Lendo a conversa…';
            try {
              const r = await api(`/api/whatsapp-instance/chats/${ativo.phone}/extrair`, { method: 'POST', body: '{}' });
              if (r.nome) form.querySelector('[name=name]').value = r.nome;
              if (r.area) form.querySelector('[name=legal_area]').value = r.area;
              if (r.resumo) form.querySelector('[name=notes]').value = r.resumo;
              toast('Dados extraídos da conversa');
            } catch (e) { toast(e.message, 'error'); }
            ev.target.disabled = false; ev.target.innerHTML = `${svgIcon('ia')}Preencher com IA`;
          };
          form.onsubmit = async (ev) => {
            ev.preventDefault();
            const b = Object.fromEntries(new FormData(form));
            try {
              await api('/api/leads', { method: 'POST', body: JSON.stringify({ name: b.name, phone: ativo.phone, legal_area: b.legal_area, source: b.source, notes: b.notes || null }) });
              closeModal(); toast('Lead cadastrado — já aparece no funil'); renderContexto();
            } catch (e) { toast(e.message, 'error'); }
          };
          openModal('Novo lead a partir da conversa', form);
        };

        const vc = box.querySelector('#wa-vincular-cliente');
        if (vc) vc.onclick = async () => {
          const clientes = await api('/api/clients?limit=200').catch(() => ({ data: [] }));
          const form = el(`<form class="form-grid">
            ${field('Cliente *', 'client_id', { options: [{ v: '', t: '— selecione —' }, ...clientes.data.map((c2) => ({ v: c2.id, t: c2.name + (c2.phone ? ` · ${c2.phone}` : '') }))] })}
            <p class="sub">O número +${esc(ativo.phone)} passa a ser o telefone salvo desse cliente — é assim que o CRM reconhece de quem é a conversa.</p>
            <button type="submit" class="btn-primary">Vincular</button>
          </form>`);
          form.onsubmit = async (ev) => {
            ev.preventDefault();
            const b = Object.fromEntries(new FormData(form));
            if (!b.client_id) { toast('Selecione um cliente', 'error'); return; }
            const cliente = clientes.data.find((c2) => String(c2.id) === b.client_id);
            if (cliente?.phone && !(await uiConfirm(`${cliente.name} já tem o telefone ${cliente.phone} cadastrado. Substituir por +${ativo.phone}?`))) return;
            try {
              await api(`/api/whatsapp-instance/chats/${ativo.phone}/vincular-cliente`, { method: 'POST', body: JSON.stringify({ client_id: b.client_id }) });
              closeModal(); toast('Contato vinculado ao cliente'); renderContexto(); await atualizar(true);
            } catch (e) { toast(e.message, 'error'); }
          };
          openModal('Vincular a cliente existente', form);
        };

        // Converter a conversa em tarefa / prazo / compromisso / anotação
        box.querySelectorAll('[data-conv]').forEach((bt) => bt.onclick = () => {
          const tipo = bt.dataset.conv;
          const nomeRef = `WhatsApp — ${ativo.name}`;
          if (tipo === 'tarefa') {
            const form = el(`<form class="form-grid">
              ${field('Título *', 'title', { value: nomeRef })}
              <div class="form-row">${field('Vence em', 'due_date', { type: 'date' })}${field('Prioridade', 'priority', { options: [['media','Média'],['alta','Alta'],['baixa','Baixa']].map(([v, t]) => ({ v, t })) })}</div>
              ${field('Detalhes', 'description', { type: 'textarea' })}
              <button type="submit" class="btn-primary">Criar tarefa</button></form>`);
            form.onsubmit = async (ev) => {
              ev.preventDefault();
              const b = Object.fromEntries(new FormData(form));
              try { await api('/api/tasks', { method: 'POST', body: JSON.stringify({ ...b, client_id: cx.client?.id || null }) }); closeModal(); toast('Tarefa criada — veja em Prazos & Tarefas'); }
              catch (e) { toast(e.message, 'error'); }
            };
            openModal('Nova tarefa desta conversa', form);
          } else if (tipo === 'prazo') {
            const form = el(`<form class="form-grid">
              ${field('Processo *', 'case_id', { options: (cx.cases || []).map((k) => ({ v: k.id, t: `${k.title || ''}${k.case_number ? ' · ' + k.case_number : ''}` })) })}
              ${field('Descrição do prazo *', 'description', { value: `Prazo combinado no WhatsApp com ${ativo.name}` })}
              ${field('Data-limite *', 'deadline_date', { type: 'date' })}
              <button type="submit" class="btn-primary">Criar prazo</button></form>`);
            form.onsubmit = async (ev) => {
              ev.preventDefault();
              const b = Object.fromEntries(new FormData(form));
              try { await api('/api/deadlines', { method: 'POST', body: JSON.stringify(b) }); closeModal(); toast('Prazo criado — os alertas automáticos já valem para ele'); }
              catch (e) { toast(e.message, 'error'); }
            };
            openModal('Novo prazo desta conversa', form);
          } else if (tipo === 'compromisso') {
            const form = el(`<form class="form-grid">
              ${field('Título *', 'title', { value: `Reunião — ${ativo.name}` })}
              <div class="form-row">${field('Início *', 'start_datetime', { type: 'datetime-local' })}${field('Fim *', 'end_datetime', { type: 'datetime-local' })}</div>
              ${field('Tipo', 'event_type', { options: [['reuniao','Reunião'],['audiencia','Audiência'],['compromisso','Compromisso']].map(([v, t]) => ({ v, t })) })}
              ${field('Local ou link', 'location')}
              <button type="submit" class="btn-primary">Agendar</button></form>`);
            form.onsubmit = async (ev) => {
              ev.preventDefault();
              const b = Object.fromEntries(new FormData(form));
              if (!b.start_datetime || !b.end_datetime) { toast('Informe início e fim', 'error'); return; }
              try { await api('/api/calendar/events', { method: 'POST', body: JSON.stringify({ ...b, client_id: cx.client?.id || null }) }); closeModal(); toast('Compromisso na agenda (sincroniza com o Google)'); }
              catch (e) { toast(e.message, 'error'); }
            };
            openModal('Novo compromisso desta conversa', form);
          } else if (tipo === 'anotacao') {
            const form = el(`<form class="form-grid">
              ${field('Anotação para a timeline do cliente *', 'texto', { type: 'textarea' })}
              <button type="submit" class="btn-primary">Registrar anotação</button></form>`);
            form.onsubmit = async (ev) => {
              ev.preventDefault();
              const b = Object.fromEntries(new FormData(form));
              try { await api(`/api/whatsapp-instance/chats/${ativo.phone}/anotacao`, { method: 'POST', body: JSON.stringify(b) }); closeModal(); toast('Anotação registrada na jornada do cliente'); }
              catch (e) { toast(e.message, 'error'); }
            };
            openModal('Anotação desta conversa', form);
          }
        });

        const rs = box.querySelector('#wa-resumo');
        if (rs) rs.onclick = async () => {
          rs.disabled = true; rs.textContent = 'Lendo a conversa (áudios e fotos incluídos)…';
          try {
            const r = await api(`/api/whatsapp-instance/chats/${ativo.phone}/resumo`, { method: 'POST', body: '{}' });
            openModal('Resumo da conversa (IA)', el(`<div>
              <div style="white-space:pre-wrap;font-size:13.5px;line-height:1.65;max-height:60vh;overflow:auto;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px">${esc(r.resumo)}</div>
              <button class="btn-sm" style="margin-top:10px" onclick="navigator.clipboard.writeText(this.previousElementSibling.textContent).then(()=>{})">Copiar resumo</button>
            </div>`));
          } catch (e) { toast(e.message, 'error'); }
          rs.disabled = false; rs.innerHTML = `${svgIcon('ia')}Resumir conversa com IA`;
        };

        const gerarIaBtn = box.querySelector('#wa-gerar-ia');
        if (gerarIaBtn) gerarIaBtn.onclick = async () => {
          gerarIaBtn.disabled = true; gerarIaBtn.textContent = 'Lendo a conversa…';
          try {
            const r = await api(`/api/whatsapp-instance/chats/${ativo.phone}/resumo`, { method: 'POST', body: '{}' });
            // Templates com campo de texto livre único (resumo_intimacao/texto,
            // parecer/consulta, resumo_cliente/movimentacao) recebem o resumo já
            // pronto da conversa — a usuária revisa/edita antes de gerar.
            iaForm(null, { client_id: cx.client.id, prefill: { texto: r.resumo, consulta: r.resumo, movimentacao: r.resumo } });
          } catch (e) { toast(e.message, 'error'); }
          gerarIaBtn.disabled = false; gerarIaBtn.innerHTML = `${svgIcon('ia')}Gerar com IA a partir desta conversa`;
        };
      };

      const abrirChat = async (c, manterInput) => {
        ativo = { phone: c.phone, name: c.client_name || c.push_name || '+' + c.phone, client_id: c.client_id, labels: parseLabels(c.labels), blocked: !!Number(c.blocked), muted_until: c.muted_until };
        $('#wa-shell').classList.add('chat-open');
        const msgs = await api('/api/whatsapp-instance/chats/' + c.phone).catch(() => []);
        qtdMsgs = msgs.length;
        api(`/api/whatsapp-instance/chats/${c.phone}/read`, { method: 'POST', body: '{}' }).catch(() => {});
        c.unread = 0;
        const textoAtual = manterInput || '';
        let respondendoA = null; // { id, texto } — mensagem sendo citada na próxima resposta
        $('#wap').innerHTML = `
          <div class="wa-head">
            <button class="btn-ghost btn-sm" id="wa-back" style="display:none">←</button>
            <div class="wa-ava" style="background:${cor(ativo.name)};width:36px;height:36px;flex:0 0 36px;font-size:13px">${iniciais(ativo.name)}</div>
            <div style="flex:1;min-width:0">
              <strong style="color:var(--navy-deep);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(ativo.name)}</strong>
              <small style="color:var(--text-muted)">+${esc(ativo.phone)}${ativo.client_id ? ' · cliente do escritório' : ''}${c.assigned_user_name ? ' · atende: ' + esc(c.assigned_user_name) : ''}</small>
            </div>
            <div class="wa-tags" id="wah-tags">${ativo.labels.map((t) => `<span class="wa-tag" style="background:${cor(t)}">${esc(t)}</span>`).join('')}</div>
            <button class="btn-icon" id="wa-buscar-chat" title="Buscar nesta conversa">${svgIcon('search')}</button>
            <button class="btn-icon ${Number(c.pinned) || Number(c.archived) || c.assigned_user_id ? 'on' : ''}" id="wa-mais" title="Mais ações">${svgIcon('more')}</button>
            <button class="btn-ghost btn-sm wa-ficha-btn ${ctxAberta ? 'on' : ''}" id="wa-info" title="Mostrar/ocultar a ficha do contato">👤 Ficha</button>
          </div>
          <div class="wa-digitando" id="wa-digitando" style="display:none">digitando…</div>
          <div class="wa-search-chat" id="wa-search-chat" style="display:none">
            ${svgIcon('search', 'ic-inline')}
            <input id="wa-busca-chat-input" placeholder="Buscar nesta conversa…" autocomplete="off">
            <span id="wa-busca-chat-cont" style="font-size:12px;color:var(--text-muted);white-space:nowrap">0/0</span>
            <button type="button" class="btn-icon btn-icon-sm" id="wa-busca-chat-prev" title="Anterior">${svgIcon('chevronUp', 'ic-xs')}</button>
            <button type="button" class="btn-icon btn-icon-sm" id="wa-busca-chat-next" title="Próxima">${svgIcon('chevronDown', 'ic-xs')}</button>
            <button type="button" class="btn-icon btn-icon-sm" id="wa-busca-chat-fechar" title="Fechar busca">${svgIcon('x', 'ic-xs')}</button>
          </div>
          <div class="wa-msgs" id="wam">
            <div style="text-align:center;padding:4px 0 10px">
              <button type="button" class="btn-sm" id="wa-carregar-antigas">Carregar mensagens antigas</button>
            </div>
            ${cartaoInlinePendencia(c)}
            ${renderMsgs(msgs)}
          </div>
          <div class="wa-reply-banner" id="wa-reply-banner" style="display:none">
            <div class="wa-quote" id="wa-reply-banner-txt"></div>
            <button type="button" class="btn-icon btn-icon-sm" id="wa-reply-cancel" title="Cancelar resposta">${svgIcon('x', 'ic-xs')}</button>
          </div>
          <form class="wa-input" id="wa-reply">
            <button type="button" class="btn-icon" id="wa-modelos" title="Respostas prontas">⚡</button>
            <button type="button" class="btn-icon" id="wa-anexar" title="Enviar documento ou imagem">${svgIcon('paperclip')}</button>
            <textarea name="text" placeholder="Digite uma mensagem" autocomplete="off" rows="1">${esc(textoAtual)}</textarea>
            <button type="button" class="btn-icon" id="wa-gravar" title="Gravar áudio">${svgIcon('mic')}</button>
            <button class="wa-send" type="submit" title="Enviar">${svgIcon('send')}</button>
          </form>`;
        const box = $('#wam'); box.scrollTop = box.scrollHeight;
        if (window.innerWidth < 760) { const bk = $('#wa-back'); bk.style.display = ''; bk.onclick = () => { ativo = null; $('#wa-shell').classList.remove('chat-open'); renderLista(); }; }
        const btnAntigas = $('#wa-carregar-antigas');
        if (btnAntigas) btnAntigas.onclick = async () => {
          btnAntigas.disabled = true; btnAntigas.textContent = 'Pedindo ao WhatsApp…';
          try {
            await api(`/api/whatsapp-instance/chats/${c.phone}/historico`, { method: 'POST', body: JSON.stringify({ count: 50 }) });
            toast('Pedido enviado — as mensagens antigas chegam aos poucos');
          } catch (e) { toast(e.message, 'error'); }
          btnAntigas.disabled = false; btnAntigas.textContent = 'Carregar mensagens antigas';
        };

        // Transcrever áudio (Whisper) — a transcrição fica gravada na mensagem.
        // Função à parte porque a busca dentro da conversa (abaixo) redesenha
        // #wam e precisa religar esses botões de novo depois de cada busca.
        const ligarTranscricao = () => {
          $('#wam').querySelectorAll('[data-transcrever]').forEach((b) => b.onclick = async () => {
            b.disabled = true; b.textContent = 'Transcrevendo…';
            try {
              await api(`/api/whatsapp-instance/media/${b.dataset.transcrever}/transcricao`, { method: 'POST', body: '{}' });
              toast('Áudio transcrito ✓'); await atualizar(true);
            } catch (e) { toast(e.message, 'error'); b.disabled = false; b.textContent = 'Transcrever áudio'; }
          });
        };
        ligarTranscricao();

        // Editar/apagar mensagem enviada — mesma razão da função acima (precisa
        // religar depois de cada redesenho de #wam).
        const ligarAcoesMsg = () => {
          $('#wam').querySelectorAll('[data-responder-msg]').forEach((b) => b.onclick = () => {
            const atual = msgs.find((m) => String(m.id) === b.dataset.responderMsg);
            if (atual) iniciarResposta(atual.id, atual.body);
          });
          // Reagir com emoji — mesma bolha de emojis rápidos do WhatsApp de verdade.
          const REACOES_RAPIDAS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
          $('#wam').querySelectorAll('[data-reagir-msg]').forEach((b) => b.onclick = (e) => {
            e.stopPropagation();
            document.querySelector('.wa-reagir-menu')?.remove();
            const menu = document.createElement('div');
            menu.className = 'wa-filter-menu wa-reagir-menu';
            menu.style.padding = '6px 8px'; menu.style.display = 'flex'; menu.style.gap = '4px';
            menu.innerHTML = REACOES_RAPIDAS.map((emoji) => `<span style="cursor:pointer;font-size:19px;padding:2px" data-emoji="${emoji}">${emoji}</span>`).join('');
            const rect = b.getBoundingClientRect();
            menu.style.position = 'fixed'; menu.style.left = rect.left + 'px'; menu.style.top = (rect.bottom + 4) + 'px'; menu.style.zIndex = 50;
            document.body.appendChild(menu);
            const fechar = () => { menu.remove(); document.removeEventListener('click', fechar, true); };
            menu.querySelectorAll('[data-emoji]').forEach((s) => s.onclick = async (ev) => {
              ev.stopPropagation(); fechar();
              try {
                await api(`/api/whatsapp-instance/messages/${b.dataset.reagirMsg}/react`, { method: 'POST', body: JSON.stringify({ emoji: s.dataset.emoji, phone: b.dataset.phone }) });
                toast('Reação enviada');
              } catch (err) { toast(err.message, 'error'); }
            });
            setTimeout(() => document.addEventListener('click', fechar, true), 0);
          });
          $('#wam').querySelectorAll('[data-editar-msg]').forEach((b) => b.onclick = async () => {
            const msgId = b.dataset.editarMsg;
            const atual = msgs.find((m) => String(m.id) === msgId);
            const novo = await uiPrompt('Editar mensagem:', atual?.body || '');
            if (novo === null || !novo.trim() || novo === atual?.body) return;
            try {
              await api(`/api/whatsapp-instance/messages/${msgId}`, { method: 'PUT', body: JSON.stringify({ text: novo.trim() }) });
              toast('Mensagem editada'); await atualizar(true);
            } catch (e) { toast(e.message, 'error'); }
          });
          $('#wam').querySelectorAll('[data-apagar-msg]').forEach((b) => b.onclick = async () => {
            const motivo = await uiPrompt('Apagar esta mensagem para o contato também (não dá pra desfazer).\n\nInforme o motivo da exclusão (fica registrado na auditoria):');
            if (motivo === null) return;
            if (!motivo.trim()) { toast('O motivo é obrigatório para apagar', 'error'); return; }
            try {
              await api(`/api/whatsapp-instance/messages/${b.dataset.apagarMsg}`, { method: 'DELETE', body: JSON.stringify({ reason: motivo.trim() }) });
              toast('Mensagem apagada — registrado na auditoria'); await atualizar(true);
            } catch (e) { toast(e.message, 'error'); }
          });
        };
        ligarAcoesMsg();

        // Busca dentro da conversa aberta — filtra as mensagens já carregadas
        // em memória, sem ir ao servidor. Realça cada ocorrência e navega
        // entre elas (↑/↓), rolando até a mensagem.
        let buscaChatTermo = '';
        let buscaChatIdx = 0;
        const contarOcorrencias = (termo) => {
          if (!termo) return 0;
          const termoEsc = termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const re = new RegExp(termoEsc, 'gi');
          return msgs.reduce((total, m) => total + (esc(m.body).match(re) || []).length, 0);
        };
        const redesenharBusca = () => {
          const total = contarOcorrencias(buscaChatTermo);
          if (buscaChatIdx >= total) buscaChatIdx = Math.max(0, total - 1);
          $('#wam').innerHTML = renderMsgs(msgs, buscaChatTermo, buscaChatTermo ? buscaChatIdx : -1);
          $('#wa-busca-chat-cont').textContent = total ? `${buscaChatIdx + 1}/${total}` : '0/0';
          ligarTranscricao(); ligarAcoesMsg();
          if (buscaChatTermo && total) {
            const alvo = $('#wam').querySelector('mark.cur');
            if (alvo) alvo.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        };
        $('#wa-buscar-chat').onclick = () => {
          const bar = $('#wa-search-chat');
          const abrindo = bar.style.display === 'none';
          bar.style.display = abrindo ? 'flex' : 'none';
          if (abrindo) { $('#wa-busca-chat-input').focus(); }
          else { buscaChatTermo = ''; buscaChatIdx = 0; $('#wam').innerHTML = renderMsgs(msgs); ligarTranscricao(); ligarAcoesMsg(); }
        };
        $('#wa-busca-chat-fechar').onclick = () => { $('#wa-buscar-chat').click(); };
        $('#wa-busca-chat-input').oninput = (e) => { buscaChatTermo = e.target.value.trim(); buscaChatIdx = 0; redesenharBusca(); };
        $('#wa-busca-chat-next').onclick = () => {
          const total = contarOcorrencias(buscaChatTermo); if (!total) return;
          buscaChatIdx = (buscaChatIdx + 1) % total; redesenharBusca();
        };
        $('#wa-busca-chat-prev').onclick = () => {
          const total = contarOcorrencias(buscaChatTermo); if (!total) return;
          buscaChatIdx = (buscaChatIdx - 1 + total) % total; redesenharBusca();
        };
        $('#wa-busca-chat-input').onkeydown = (e) => {
          if (e.key === 'Enter') { e.preventDefault(); $(e.shiftKey ? '#wa-busca-chat-prev' : '#wa-busca-chat-next').click(); }
          if (e.key === 'Escape') { $('#wa-buscar-chat').click(); }
        };

        // Gravar e enviar áudio — reusa o mesmo /send-media do anexo (o
        // arquivo vira uma mensagem de voz na conversa, igual às recebidas).
        let gravador = null, gravando = false, chunksAudio = [];
        $('#wa-gravar').onclick = async () => {
          const btn = $('#wa-gravar');
          if (gravando) { gravador.stop(); return; }
          if (!navigator.mediaDevices?.getUserMedia) { toast('Este navegador não permite gravar áudio', 'error'); return; }
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            chunksAudio = [];
            gravador = new MediaRecorder(stream);
            gravador.ondataavailable = (e) => { if (e.data.size) chunksAudio.push(e.data); };
            gravador.onstop = async () => {
              stream.getTracks().forEach((t) => t.stop());
              gravando = false; btn.classList.remove('gravando');
              if (!chunksAudio.length) return;
              const blob = new Blob(chunksAudio, { type: gravador.mimeType || 'audio/webm' });
              if (blob.size < 500) { toast('Gravação muito curta'); return; }
              const b64 = await new Promise((ok, err) => {
                const r = new FileReader();
                r.onload = () => ok(r.result); r.onerror = err; r.readAsDataURL(blob);
              });
              try {
                await api(`/api/whatsapp-instance/chats/${ativo.phone}/send-media`, {
                  method: 'POST', body: JSON.stringify({ file_base64: b64, file_name: 'audio.webm', mime: blob.type, as_voice: true }),
                });
                toast('Áudio enviado'); await atualizar(true);
              } catch (e) { toast(e.message, 'error'); }
            };
            gravador.start();
            gravando = true; btn.classList.add('gravando');
            toast('Gravando… clique de novo pra enviar');
          } catch (e) {
            const msgs = {
              NotAllowedError: 'Permissão de microfone bloqueada — clique no cadeado/ícone ao lado do endereço do site e libere o microfone, depois recarregue a página.',
              PermissionDeniedError: 'Permissão de microfone bloqueada — clique no cadeado/ícone ao lado do endereço do site e libere o microfone, depois recarregue a página.',
              NotFoundError: 'Nenhum microfone encontrado neste dispositivo.',
              DevicesNotFoundError: 'Nenhum microfone encontrado neste dispositivo.',
              NotReadableError: 'O microfone está sendo usado por outro programa/aba — feche e tente de novo.',
            };
            toast(msgs[e?.name] || `Não consegui acessar o microfone (${e?.name || e?.message || 'erro desconhecido'})`, 'error');
          }
        };

        // PDF da conversa — com papel timbrado, pronto para juntar ao processo
        const acaoPdf = () => {
          let dia = '';
          const linhas = msgs.map((m) => {
            const d = fmtDia(m.msg_time);
            const sep = d !== dia ? `<div style="text-align:center;margin:14px 0 6px"><span style="font-size:11px;border:1px solid #ccc;border-radius:10px;padding:2px 10px;color:#555">${d}</span></div>` : '';
            dia = d;
            return `${sep}<div style="margin:6px 0;padding:8px 12px;border-radius:8px;max-width:75%;font-size:12.5px;line-height:1.5;border:1px solid #ddd;${Number(m.from_me) ? 'margin-left:auto;background:#eef7ea' : 'background:#fff'}">
              <div style="font-size:10px;color:#888;margin-bottom:3px">${Number(m.from_me) ? 'Escritório' : esc(ativo.name)} · ${fmtHora(m.msg_time)}</div>
              <div style="white-space:pre-wrap;word-break:break-word">${esc(m.body)}</div>
              ${m.media_id ? '<div style="font-size:10.5px;color:#888;margin-top:3px">[anexo recebido — arquivado nos Documentos do cliente]</div>' : ''}
            </div>`;
          }).join('');
          printBranded(
            `Registro de conversa de WhatsApp — ${ativo.name}`,
            `Contato +${ativo.phone} · ${msgs.length} mensagem(ns) · extraído do CRM em ${new Date().toLocaleString('pt-BR')}`,
            linhas + '<p style="color:#777;font-size:11px;margin-top:16px">Registro gerado pelo sistema de gestão do escritório para fins de documentação e prova. Use "Imprimir → Salvar como PDF".</p>');
        };
        // Rótulos do menu "⋯ Mais ações" que mudam de estado (fixar/arquivar) —
        // atualiza o texto sem precisar reabrir o menu inteiro.
        const atualizarLabelsMais = () => {
          const pinOpt = $('#wa-mais-menu [data-acao=pin] span'); if (pinOpt) pinOpt.textContent = Number(c.pinned) ? 'Desfixar conversa' : 'Fixar conversa';
          const arqOpt = $('#wa-mais-menu [data-acao=archive] span'); if (arqOpt) arqOpt.textContent = Number(c.archived) ? 'Desarquivar conversa' : 'Arquivar conversa';
        };

        // Respostas prontas (macros) — atalhos nativos da Uazapi
        // (/quickreply/*, ver src/services/uazapiInstance.ts), não uma tabela
        // à parte no CRM: assim o mesmo atalho digitado ("/saudacao") também
        // funciona no app oficial do WhatsApp Business, sincronizado.
        // {{nome}} no texto vira o primeiro nome do contato ao usar.
        $('#wa-modelos').onclick = async () => {
          const tpls = await api('/api/whatsapp-instance/quickreplies').catch(() => []);
          const primeiroNome = (ativo.name.startsWith('+') ? '' : ativo.name).split(' ')[0] || '';
          const wrap = el(`<div>
            <div style="display:flex;flex-direction:column;gap:8px;max-height:46vh;overflow:auto">
              ${tpls.map((t) => `<div style="border:1px solid var(--border);border-radius:8px;padding:10px 12px">
                <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline">
                  <strong style="font-size:13px;color:var(--navy-deep)">/${esc(t.shortCut || t.shortcut || '')}</strong>
                  <span style="white-space:nowrap"><button class="btn-gold btn-sm" data-usar="${t.id}">Usar</button> <button class="btn-ghost btn-sm" data-editar-tpl="${t.id}">${svgIcon('edit', 'ic-xs')}</button> <button class="btn-ghost btn-sm" data-apagar="${t.id}">${svgIcon('x', 'ic-xs')}</button></span>
                </div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:4px">${esc(String(t.text || '').slice(0, 110))}…</div>
              </div>`).join('') || '<div class="empty">Nenhuma resposta pronta ainda</div>'}
            </div>
            <hr style="border:none;border-top:1px solid var(--border);margin:12px 0">
            <form id="tpl-novo" class="form-grid">
              ${field('Atalho (sem a barra, ex.: saudacao)', 'shortCut')}
              ${field('Mensagem (use {{nome}} para o nome do cliente)', 'text', { type: 'textarea' })}
              <button type="submit" class="btn-sm">+ Salvar resposta pronta</button>
            </form>
          </div>`);
          wrap.querySelectorAll('[data-usar]').forEach((b) => b.onclick = () => {
            const t = tpls.find((x) => x.id == b.dataset.usar);
            const inp = $('#wa-reply [name=text]');
            inp.value = String(t.text || '').replace(/\{\{nome\}\}/g, primeiroNome || 'cliente');
            closeModal(); inp.focus();
          });
          wrap.querySelectorAll('[data-apagar]').forEach((b) => b.onclick = async () => {
            if (!(await uiConfirm('Apagar esta resposta pronta?'))) return;
            await api('/api/whatsapp-instance/quickreplies/' + b.dataset.apagar, { method: 'DELETE' }).catch(() => {});
            closeModal(); $('#wa-modelos').click();
          });
          wrap.querySelectorAll('[data-editar-tpl]').forEach((b) => b.onclick = () => {
            const t = tpls.find((x) => x.id == b.dataset.editarTpl);
            const ef = el(`<form class="form-grid">
              ${field('Atalho', 'shortCut', { value: t.shortCut || t.shortcut || '' })}
              ${field('Mensagem (use {{nome}} para o nome do cliente)', 'text', { type: 'textarea', value: t.text || '' })}
              <button type="submit" class="btn-primary">Salvar alterações</button>
            </form>`);
            ef.onsubmit = async (ev) => {
              ev.preventDefault();
              const b2 = Object.fromEntries(new FormData(ev.target));
              if (!b2.shortCut || !b2.text) { toast('Preencha o atalho e a mensagem', 'error'); return; }
              try {
                await api('/api/whatsapp-instance/quickreplies/' + t.id, { method: 'PUT', body: JSON.stringify(b2) });
                toast('Resposta pronta atualizada'); closeModal(); $('#wa-modelos').click();
              } catch (e) { toast(e.message, 'error'); }
            };
            openModal('Editar resposta pronta', ef);
          });
          wrap.querySelector('#tpl-novo').onsubmit = async (ev) => {
            ev.preventDefault();
            const b2 = Object.fromEntries(new FormData(ev.target));
            if (!b2.shortCut || !b2.text) { toast('Preencha o atalho e a mensagem', 'error'); return; }
            try { await api('/api/whatsapp-instance/quickreplies', { method: 'POST', body: JSON.stringify(b2) }); toast('Resposta pronta salva'); closeModal(); $('#wa-modelos').click(); }
            catch (e) { toast(e.message, 'error'); }
          };
          openModal('Respostas prontas', wrap);
        };

        // Enviar documento/imagem — do GED do cliente ou upload do computador
        $('#wa-anexar').onclick = async () => {
          const docs = ativo.client_id ? await api('/api/documents?client_id=' + ativo.client_id).catch(() => []) : [];
          const comArquivo = docs.filter((d) => d.has_data);
          const wrap = el(`<div>
            ${comArquivo.length ? `
              <strong style="font-size:13px;color:var(--navy)">Enviar um documento já no sistema</strong>
              <div style="display:flex;flex-direction:column;gap:6px;max-height:30vh;overflow:auto;margin:8px 0 16px">
                ${comArquivo.map((d) => `<button type="button" class="btn-sm" data-doc="${d.id}" style="text-align:left">${svgIcon('file')}${esc(d.name)}</button>`).join('')}
              </div>
              <hr style="border:none;border-top:1px solid var(--border);margin:12px 0">` : ''}
            <strong style="font-size:13px;color:var(--navy)">Ou enviar um arquivo do computador</strong>
            <form id="wa-anexo-form" class="form-grid" style="margin-top:8px">
              <input type="file" name="arquivo" accept="image/*,application/pdf,.doc,.docx">
              ${field('Legenda (opcional)', 'text')}
              <button type="submit" class="btn-primary">Enviar</button>
            </form>
          </div>`);
          const enviar = async (body) => {
            try {
              await api(`/api/whatsapp-instance/chats/${ativo.phone}/send-media`, { method: 'POST', body: JSON.stringify(body) });
              closeModal(); toast('Arquivo enviado'); await atualizar(true);
            } catch (e) { toast(e.message, 'error'); }
          };
          wrap.querySelectorAll('[data-doc]').forEach((b) => b.onclick = () => enviar({ document_id: b.dataset.doc }));
          wrap.querySelector('#wa-anexo-form').onsubmit = async (ev) => {
            ev.preventDefault();
            const fd = new FormData(ev.target);
            const arquivo = fd.get('arquivo');
            if (!arquivo || !arquivo.size) { toast('Escolha um arquivo', 'error'); return; }
            if (arquivo.size > 15 * 1024 * 1024) { toast('Arquivo maior que 15MB', 'error'); return; }
            const b64 = await new Promise((ok, err) => {
              const r = new FileReader();
              r.onload = () => ok(r.result); r.onerror = err; r.readAsDataURL(arquivo);
            });
            await enviar({ file_base64: b64, file_name: arquivo.name, mime: arquivo.type, text: fd.get('text') || '' });
          };
          openModal('Enviar arquivo', wrap);
        };
        const acaoPin = async () => {
          const novo = !Number(c.pinned);
          try {
            await api(`/api/whatsapp-instance/chats/${c.phone}/pin`, { method: 'POST', body: JSON.stringify({ pinned: novo }) });
            c.pinned = novo ? 1 : 0; toast(novo ? 'Conversa fixada' : 'Conversa desfixada');
            atualizarLabelsMais(); renderFiltros(); renderLista();
          } catch (e) { toast(e.message, 'error'); }
        };
        const acaoArchive = async () => {
          const novo = !Number(c.archived);
          try {
            await api(`/api/whatsapp-instance/chats/${c.phone}/archive`, { method: 'POST', body: JSON.stringify({ archived: novo }) });
            c.archived = novo ? 1 : 0; toast(novo ? 'Conversa arquivada' : 'Conversa desarquivada');
            if (novo) { ativo = null; $('#wa-shell').classList.remove('chat-open'); }
            atualizarLabelsMais(); renderFiltros(); renderLista();
          } catch (e) { toast(e.message, 'error'); }
        };
        // Painel de contexto (Ficha do contato) — o estado (aberta/fechada) é
        // uma ESCOLHA da usuária (ctxAberta, declarada lá em cima) que persiste
        // ao trocar de conversa. Antes disso, abrirChat forçava a reabertura
        // toda vez que uma conversa era clicada, mesmo logo após fechar — o
        // grid pulava de 2 pra 3 colunas a cada clique ("a tela muda de
        // tamanho"). Agora só muda quando a usuária clica no botão ℹ ou no X.
        // O botão funciona em qualquer largura (no mobile a ficha vira um
        // painel cheio por cima da tela — ver media query de .ctx-open no
        // CSS); só a "lembrança" entre conversas (abaixo) é exclusiva de
        // tela larga, onde a ficha é uma 3ª coluna fixa, não um overlay.
        $('#wa-info').onclick = () => {
          const abrir = !$('#wa-shell').classList.contains('ctx-open');
          ctxAberta = abrir;
          $('#wa-info').classList.toggle('on', abrir);
          $('#wa-shell').classList.toggle('ctx-open', abrir);
          if (abrir) renderContexto();
        };
        const cartaoFichaBtn = $('#wa-inline-card-ficha');
        if (cartaoFichaBtn) cartaoFichaBtn.onclick = () => {
          if ($('#wa-shell').classList.contains('ctx-open')) return; // já aberta
          $('#wa-info').click();
        };
        if (window.innerWidth >= 1100) {
          $('#wa-shell').classList.toggle('ctx-open', ctxAberta);
          if (ctxAberta) renderContexto();
        }
        const limparResposta = () => { respondendoA = null; $('#wa-reply-banner').style.display = 'none'; };
        const iniciarResposta = (id, texto) => {
          respondendoA = { id, texto };
          $('#wa-reply-banner-txt').textContent = String(texto || '').slice(0, 140);
          $('#wa-reply-banner').style.display = 'flex';
          $('#wa-reply [name=text]').focus();
        };
        $('#wa-reply-cancel').onclick = limparResposta;
        // Textarea multilinha: cresce sozinha (até 120px) conforme digita;
        // Enter envia, Shift+Enter quebra linha (igual ao WhatsApp Web).
        const taTexto = $('#wa-reply [name=text]');
        const ajustarAlturaTexto = () => { taTexto.style.height = 'auto'; taTexto.style.height = Math.min(taTexto.scrollHeight, 120) + 'px'; };
        ajustarAlturaTexto();
        taTexto.oninput = ajustarAlturaTexto;
        taTexto.onkeydown = (e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#wa-reply').requestSubmit(); }
        };
        $('#wa-reply').onsubmit = async (ev) => {
          ev.preventDefault();
          const inp = $('#wa-reply [name=text]');
          const texto = inp.value.trim(); if (!texto) return;
          inp.value = ''; ajustarAlturaTexto();
          const replyTo = respondendoA?.id; limparResposta();
          try {
            await api(`/api/whatsapp-instance/chats/${ativo.phone}/send`, { method: 'POST', body: JSON.stringify({ text: texto, ...(replyTo ? { reply_to: replyTo } : {}) }) });
            await atualizar(true);
          } catch (e) { toast(e.message, 'error'); inp.value = texto; ajustarAlturaTexto(); }
        };
        const acaoLabel = () => {
          const existentes = todasEtiquetas();
          const form = el(`<form class="form-grid">
            <p class="sub">Marque as etiquetas desta conversa (ou crie uma nova):</p>
            <div style="display:flex;flex-direction:column;gap:6px">
              ${existentes.map((t) => `<label style="display:flex;gap:8px;align-items:center;font-size:14px"><input type="checkbox" name="et" value="${esc(t)}" ${ativo.labels.includes(t) ? 'checked' : ''}> <span class="wa-tag" style="background:${cor(t)};font-size:11px">${esc(t)}</span></label>`).join('') || '<small style="color:var(--text-muted)">Nenhuma etiqueta criada ainda</small>'}
            </div>
            ${field('Nova etiqueta (opcional)', 'nova')}
            <button type="submit" class="btn-primary">Salvar etiquetas</button>
          </form>`);
          form.onsubmit = async (ev) => {
            ev.preventDefault();
            const marcadas = [...form.querySelectorAll('[name=et]:checked')].map((x) => x.value);
            const nova = form.querySelector('[name=nova]').value.trim();
            if (nova) marcadas.push(nova);
            try {
              await api(`/api/whatsapp-instance/chats/${ativo.phone}/labels`, { method: 'POST', body: JSON.stringify({ labels: marcadas }) });
              closeModal(); toast('Etiquetas salvas'); await atualizar(true);
            } catch (e) { toast(e.message, 'error'); }
          };
          openModal('Etiquetas da conversa', form);
        };
        // Atendente responsável — atribuição manual (não é fila automática).
        // Só admin/advogado veem a lista de equipe (mesma regra do
        // "responsável" no Kanban de produção dos processos).
        const acaoAssign = async () => {
          if (!['admin', 'advogado'].includes(USER.role)) { toast('Só admin/advogado podem atribuir atendente', 'error'); return; }
          const users = await api('/api/users').catch(() => []);
          const able = users.filter((u) => u.active);
          const form = el(`<form class="form-grid">
            ${field('Atendente responsável', 'user_id', { options: [{ v: '', t: '— sem atendente —' }, ...able.map((u) => ({ v: u.id, t: u.name }))], value: c.assigned_user_id || '' })}
            <button type="submit" class="btn-primary">Salvar</button>
          </form>`);
          form.onsubmit = async (ev) => {
            ev.preventDefault();
            const userId = form.querySelector('[name=user_id]').value || null;
            try {
              await api(`/api/whatsapp-instance/chats/${ativo.phone}/assign`, { method: 'POST', body: JSON.stringify({ user_id: userId }) });
              closeModal(); toast('Atendente atualizado'); await atualizar(true);
            } catch (e) { toast(e.message, 'error'); }
          };
          openModal('Atendente responsável', form);
        };

        // Menu suspenso simples de opções (silenciar/temporárias) — mesmo
        // visual do menu rápido de emoji de reação, ancorado no item clicado.
        const abrirSubmenu = (anchorEl, opcoes, onEscolher) => {
          document.querySelector('.wa-sub-menu')?.remove();
          const menu = document.createElement('div');
          menu.className = 'wa-filter-menu wa-sub-menu';
          menu.innerHTML = opcoes.map((o) => `<div class="wa-filter-opt" data-v="${o.v}">${esc(o.t)}</div>`).join('');
          const rect = anchorEl.getBoundingClientRect();
          menu.style.position = 'fixed'; menu.style.left = rect.left + 'px'; menu.style.top = (rect.bottom + 4) + 'px'; menu.style.zIndex = 60;
          document.body.appendChild(menu);
          const fechar = () => { menu.remove(); document.removeEventListener('click', fechar, true); };
          menu.querySelectorAll('[data-v]').forEach((o) => o.onclick = (ev) => { ev.stopPropagation(); fechar(); onEscolher(o.dataset.v); });
          setTimeout(() => document.addEventListener('click', fechar, true), 0);
        };

        // Silenciar notificações da conversa — sincroniza com o WhatsApp real.
        const acaoMute = (anchorEl) => {
          abrirSubmenu(anchorEl, [
            { v: '0', t: 'Remover silêncio' },
            { v: '8', t: 'Silenciar por 8 horas' },
            { v: '168', t: 'Silenciar por 1 semana' },
            { v: '-1', t: 'Silenciar sempre' },
          ], async (v) => {
            try {
              const r = await api(`/api/whatsapp-instance/chats/${ativo.phone}/mute`, { method: 'POST', body: JSON.stringify({ hours: Number(v) }) });
              ativo.muted_until = r.muted_until; toast(v === '0' ? 'Silêncio removido' : 'Conversa silenciada');
            } catch (e) { toast(e.message, 'error'); }
          });
        };

        // Mensagens temporárias (somem sozinhas depois de um tempo) — só chats privados.
        const acaoEphemeral = (anchorEl) => {
          abrirSubmenu(anchorEl, [
            { v: 'off', t: 'Desativar mensagens temporárias' },
            { v: '1d', t: 'Ativar — 24 horas' },
            { v: '7d', t: 'Ativar — 7 dias' },
            { v: '90d', t: 'Ativar — 90 dias' },
          ], async (v) => {
            try {
              await api(`/api/whatsapp-instance/chats/${ativo.phone}/ephemeral`, { method: 'POST', body: JSON.stringify({ duration: v }) });
              toast(v === 'off' ? 'Mensagens temporárias desativadas' : 'Mensagens temporárias ativadas');
            } catch (e) { toast(e.message, 'error'); }
          });
        };

        // Limpa a conversa (mensagens somem do WhatsApp e do CRM) — não deleta
        // o contato do WhatsApp, só o histórico. Ação destrutiva, pede confirmação.
        const acaoDelete = async () => {
          if (!await uiConfirm(`Limpar TODO o histórico da conversa com ${ativo.name || ativo.phone}? Isso apaga as mensagens do WhatsApp e do CRM — não dá pra desfazer.`)) return;
          try {
            await api(`/api/whatsapp-instance/chats/${ativo.phone}/delete`, { method: 'POST', body: JSON.stringify({}) });
            toast('Conversa limpa'); ativo = null; $('#wa-shell').classList.remove('chat-open'); await atualizar(true);
          } catch (e) { toast(e.message, 'error'); }
        };

        // Bloquear/desbloquear contato — ele para de conseguir mandar mensagem
        // pra instância (chamada real na Uazapi, não é só filtro local).
        const acaoBlock = async () => {
          const bloqueando = !ativo.blocked;
          if (bloqueando && !await uiConfirm(`Bloquear ${ativo.name || ativo.phone}? Ele(a) não vai conseguir mandar mensagem pra este número até você desbloquear.`)) return;
          try {
            await api(`/api/whatsapp-instance/chats/${ativo.phone}/block`, { method: 'POST', body: JSON.stringify({ block: bloqueando }) });
            ativo.blocked = bloqueando; toast(bloqueando ? 'Contato bloqueado' : 'Contato desbloqueado');
          } catch (e) { toast(e.message, 'error'); }
        };

        // Menu "⋯ Mais ações" — reúne fixar/arquivar/etiquetas/atendente/PDF/bloqueio
        // num único dropdown (mesmo padrão visual do menu de filtro da lista,
        // #waf-menu/.wa-filter-menu), no lugar de botões-ícone soltos no
        // cabeçalho — cabeçalho ficou poluído e genérico com tantos ícones.
        const fecharMenuMais = () => { const m = $('#wa-mais-menu'); if (m) m.remove(); document.removeEventListener('click', onClickForaMais, true); };
        const onClickForaMais = (e) => { if (!e.target.closest('#wa-mais')) fecharMenuMais(); };
        $('#wa-mais').onclick = (e) => {
          e.stopPropagation();
          if ($('#wa-mais-menu')) { fecharMenuMais(); return; }
          const item = (acao, icon, label) => `<div class="wa-filter-opt" data-acao="${acao}">${svgIcon(icon, 'ic-xs')}<span>${label}</span></div>`;
          const menu = document.createElement('div');
          menu.className = 'wa-filter-menu wa-mais-menu'; menu.id = 'wa-mais-menu';
          menu.innerHTML = [
            item('pin', 'pin', Number(c.pinned) ? 'Desfixar conversa' : 'Fixar conversa'),
            item('archive', 'archive', Number(c.archived) ? 'Desarquivar conversa' : 'Arquivar conversa'),
            item('label', 'tag', 'Etiquetas'),
            item('assign', 'users', 'Atendente responsável' + (c.assigned_user_name ? ` (${esc(c.assigned_user_name)})` : '')),
            item('pdf', 'printer', 'Gerar PDF da conversa'),
            item('mute', 'bell', ativo.muted_until ? 'Alterar silêncio…' : 'Silenciar conversa…'),
            item('ephemeral', 'clock', 'Mensagens temporárias…'),
            item('block', 'x', ativo.blocked ? 'Desbloquear contato' : 'Bloquear contato'),
            item('delete', 'trash', 'Limpar conversa'),
          ].join('');
          $('#wa-mais').closest('.wa-head').appendChild(menu);
          const acoes = {
            pin: acaoPin, archive: acaoArchive, label: acaoLabel, assign: acaoAssign, pdf: acaoPdf, block: acaoBlock,
            mute: (el) => acaoMute(el), ephemeral: (el) => acaoEphemeral(el), delete: acaoDelete,
          };
          menu.querySelectorAll('[data-acao]').forEach((o) => o.onclick = (ev) => {
            const rect = ev.currentTarget.getBoundingClientRect();
            const ancoraFantasma = { getBoundingClientRect: () => rect };
            fecharMenuMais(); acoes[o.dataset.acao](ancoraFantasma);
          });
          document.addEventListener('click', onClickForaMais, true);
        };
      };

      // Atualização (polling suave a cada 6s — lista e conversa aberta).
      // Trava por conversa-alvo: se o usuário trocar de conversa enquanto
      // este ciclo ainda está buscando dados da conversa ANTIGA, o resultado
      // chega depois e não pode mais ser aplicado — sem isso, um ciclo lento
      // sobrescrevia a conversa recém-aberta de volta pra anterior (o bug de
      // "oscilar para a conversa marcada" ao clicar).
      let cicloEmAndamento = false;
      const atualizar = async (forcarChat) => {
        if (cicloEmAndamento && !forcarChat) return; // evita empilhar ciclos de polling
        // Dá uma folga pro clique assentar antes de deixar o polling reordenar
        // a lista — é o que fazia clicar numa conversa "escorregar" pra outra.
        if (!forcarChat && Date.now() - ultimaInteracaoLista < 1200) return;
        cicloEmAndamento = true;
        try {
          // Busca com 3+ letras vale também para o CONTEÚDO das mensagens (servidor)
          const q = busca.trim().length >= 3 ? `?q=${encodeURIComponent(busca.trim())}` : '';
          const novosChats = await api('/api/whatsapp-instance/chats' + q).catch(() => null);
          if (novosChats) chats = novosChats;
          renderFiltros(); renderLista();
          if (ativo) {
            const alvo = ativo.phone;
            const c = chats.find((x) => x.phone === alvo);
            const msgs = await api('/api/whatsapp-instance/chats/' + alvo).catch(() => null);
            if (!ativo || ativo.phone !== alvo) return; // usuário já trocou de conversa — descarta
            if (msgs && (forcarChat || msgs.length !== qtdMsgs)) {
              const digitando = $('#wa-reply [name=text]')?.value || '';
              await abrirChat(c || { phone: alvo, client_name: ativo.name, client_id: ativo.client_id, labels: JSON.stringify(ativo.labels) }, digitando);
            }
          }
        } finally { cicloEmAndamento = false; }
      };

      // Liga o tempo real: quando o backend avisa que algo mudou (mensagem
      // nova/status, via webhook ou envio nosso), reusa o MESMO fluxo do
      // polling (atualizar) em vez de tentar remontar a mensagem à mão —
      // menos código, mesma lógica de dedupe/scroll/trava já testada.
      let waDigitandoTimer = null;
      waConectarSocket();
      waOnUpdate = (data) => {
        if (tab !== 'conversas' || !data?.phone) return;
        if (data.presence) {
          if (!ativo || ativo.phone !== data.phone) return;
          const ind = $('#wa-digitando'); if (!ind) return;
          clearTimeout(waDigitandoTimer);
          if (data.presence === 'digitando') {
            ind.style.display = 'block';
            waDigitandoTimer = setTimeout(() => { ind.style.display = 'none'; }, 6000);
          } else ind.style.display = 'none';
          return;
        }
        atualizar(!!(ativo && ativo.phone === data.phone));
      };

      let buscaTimer = null;
      $('#waq').oninput = (e) => {
        busca = e.target.value; renderLista();
        clearTimeout(buscaTimer);
        buscaTimer = setTimeout(() => atualizar(false), 400); // busca no conteúdo (servidor)
      };
      $('#wa-agenda-btn').onclick = () => abrirAgendaModal((phone) => { abrirFonePendente = { phone }; shell(); });
      $('#wa-auditoria-btn').onclick = () => abrirAuditoriaModal();
      await atualizar(false);
      if (!chats.length) $('#wal').innerHTML = '<div class="wa-empty">Nenhuma conversa ainda.<br>Com a instância conectada, tudo que chegar e sair aparece aqui.</div>';
      if (abrirFonePendente) {
        const alvo = abrirFonePendente;
        abrirFonePendente = null;
        const c = chats.find((x) => x.phone === alvo.phone);
        // Sem conversa ainda (lead novo, nunca mandou WhatsApp) — abre do
        // mesmo jeito, com um contato "em branco", pra já poder mandar a
        // primeira mensagem.
        abrirChat(c || { phone: alvo.phone, client_name: alvo.nome || ('+' + alvo.phone), client_id: null, labels: '[]' }, alvo.texto || '');
      }
      // Fallback: o Socket.IO já cobre o tempo real (ver waOnUpdate acima) —
      // este polling só existe pra não deixar a tela "travada" se o socket
      // cair (rede instável, servidor sem WebSocket liberado no proxy etc).
      chatTimer = setInterval(() => { if (tab === 'conversas') atualizar(false); else { clearInterval(chatTimer); chatTimer = null; waOnUpdate = null; } }, 20000);
    };

    // ── Aba CONTATOS: quadro Kanban de organização (etapas editáveis) ──
    const tabContatos = async () => {
      const body = $('#wa-body');
      body.innerHTML = `
        <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
          <button class="btn-gold btn-sm" id="wc-nova-etapa">+ Nova etapa</button>
        </div>
        <div class="kanban-wrap">
          <button type="button" class="kanban-nav kanban-nav-esq" id="wc-nav-esq" title="Coluna anterior">${svgIcon('chevronLeft')}</button>
          <div id="wc-board" class="kanban-fases"></div>
          <button type="button" class="kanban-nav kanban-nav-dir" id="wc-nav-dir" title="Próxima coluna">${svgIcon('chevronRight')}</button>
        </div>`;
      // Rolar com a roda do mouse SOBRE uma coluna move os cards daquela
      // coluna (scroll vertical próprio de .kf-cards) — não dá pra "ver as
      // laterais" assim, e foi exatamente esse o problema real reportado
      // (rolar com o mouse em cima de uma coluna cheia nunca chega a
      // deslizar o quadro). Por isso as setas fixas abaixo são a forma
      // principal de navegar; o wheel no fundo do quadro (fora das
      // colunas) continua funcionando como atalho extra.
      $('#wc-board').addEventListener('wheel', (e) => {
        if (e.deltaY === 0 || e.shiftKey) return;
        e.preventDefault();
        $('#wc-board').scrollLeft += e.deltaY;
      });
      const larguraColuna = () => (document.querySelector('.kf-col')?.offsetWidth || 240) + 12;
      $('#wc-nav-esq').onclick = () => $('#wc-board').scrollBy({ left: -larguraColuna(), behavior: 'smooth' });
      $('#wc-nav-dir').onclick = () => $('#wc-board').scrollBy({ left: larguraColuna(), behavior: 'smooth' });

      const load = async () => {
        const [stagesResp, boardResp] = await Promise.all([
          api('/api/whatsapp-instance/stages').catch(() => []),
          api('/api/whatsapp-instance/board').catch(() => ({ stages: [], board: {} })),
        ]);
        const stages = boardResp.stages && boardResp.stages.length ? boardResp.stages : stagesResp;
        const board = boardResp.board || {};

        if (!stages.length) {
          $('#wc-board').innerHTML = '<div class="empty">Nenhuma etapa criada ainda — clique em "+ Nova etapa" pra começar.</div>';
          return;
        }

        $('#wc-board').innerHTML = stages.map((s) => `
          <div class="kf-col" data-stage="${s.id}">
            <div class="kf-head" style="border-top:3px solid ${esc(s.color)}">
              <span data-editar-etapa="${s.id}" class="wa-etapa-editar" title="Renomear/apagar etapa">${esc(s.name)}${svgIcon('edit', 'ic-xs')}</span>
              <span class="kf-count">${(board[s.id] || []).length}</span>
            </div>
            <div class="kf-cards" data-stage="${s.id}">
              ${(board[s.id] || []).map((c) => `
                <div class="kf-card wc-card" draggable="true" data-phone="${esc(c.phone)}" data-nome="${esc(c.name)}" data-cliente="${c.client_id || ''}" data-stage="${s.id}">
                  ${Number(c.unread) ? `<span class="wc-unread">${c.unread}</span>` : ''}
                  <div class="wc-card-top">
                    <div class="wc-ava" style="background:${waCor(c.name)}">${waIniciais(c.name)}</div>
                    <div class="wc-info">
                      <strong>${esc(c.name)}</strong>
                      <small>${c.client_id ? '★ Cliente · ' : ''}+${esc(c.phone)}</small>
                    </div>
                    <span class="wc-time">${c.last_time ? waFmtDia(c.last_time) : ''}</span>
                  </div>
                  <div class="wc-prev">${Number(c.last_from_me) ? '✓ ' : ''}${esc(String(c.last_body || '').slice(0, 60))}</div>
                  <select class="kf-move" draggable="false" data-phone="${esc(c.phone)}" data-from="${s.id}" title="Mover para outra etapa">
                    ${stages.map((s2) => `<option value="${s2.id}" ${s2.id === s.id ? 'selected' : ''}>${esc(s2.name)}</option>`).join('')}
                  </select>
                </div>`).join('') || ''}
            </div>
          </div>`).join('');

        // Editar/apagar etapa
        $('#wc-board').querySelectorAll('[data-editar-etapa]').forEach((el2) => el2.onclick = async (e) => {
          e.stopPropagation();
          const id = el2.dataset.editarEtapa;
          const atual = stages.find((s) => String(s.id) === String(id));
          const novoNome = await uiPrompt('Nome da etapa (deixe vazio pra apagar a etapa):', atual?.name || '');
          if (novoNome === null) return;
          try {
            if (!novoNome.trim()) {
              if (!(await uiConfirm('Apagar esta etapa? Os contatos voltam para a 1ª coluna.'))) return;
              await api('/api/whatsapp-instance/stages/' + id, { method: 'DELETE' });
              toast('Etapa apagada');
            } else {
              await api('/api/whatsapp-instance/stages/' + id, { method: 'PUT', body: JSON.stringify({ name: novoNome.trim() }) });
              toast('Etapa atualizada');
            }
            load();
          } catch (err) { toast(err.message, 'error'); }
        });

        // Arrastar card entre colunas — move a etapa e já aplica a etiqueta
        const moverEtapa = async (phone, stageId, from) => {
          if (!phone || !stageId || String(stageId) === String(from)) return;
          try {
            await api(`/api/whatsapp-instance/chats/${phone}/stage`, { method: 'POST', body: JSON.stringify({ stage_id: stageId }) });
            toast('Contato movido — etiqueta aplicada');
            load();
          } catch (err) { toast(err.message, 'error'); load(); }
        };
        $('#wc-board').querySelectorAll('.kf-card').forEach((card) => {
          card.addEventListener('dragstart', (e) => {
            if (e.target.closest('.kf-move')) { e.preventDefault(); return; } // não deixa o menu virar "arrasto"
            e.dataTransfer.setData('text/plain', JSON.stringify({ phone: card.dataset.phone, from: card.dataset.stage })); card.style.opacity = '0.45';
          });
          card.addEventListener('dragend', () => { card.style.opacity = ''; });
          card.onclick = (e) => {
            if (e.target.closest('.kf-move')) return;
            abrirPreviaContato(card.dataset.phone, card.dataset.nome, () => {
              abrirFonePendente = { phone: card.dataset.phone }; tab = 'conversas'; shell();
            });
          };
        });
        // Mover pelo menu (mais confiável que arrastar — funciona em qualquer navegador/trackpad).
        // stopPropagation em mousedown/click: o card é "draggable", e sem isso o
        // navegador trata o clique no <select> como início de arrasto e o menu
        // não abre nem dispara o "change" direito.
        $('#wc-board').querySelectorAll('.kf-move').forEach((sel) => {
          sel.addEventListener('mousedown', (e) => e.stopPropagation());
          sel.addEventListener('click', (e) => e.stopPropagation());
          sel.onchange = () => moverEtapa(sel.dataset.phone, Number(sel.value), sel.dataset.from);
        });
        $('#wc-board').querySelectorAll('.kf-cards').forEach((zone) => {
          zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.style.outline = '2px dashed var(--gold)'; });
          zone.addEventListener('dragleave', () => { zone.style.outline = ''; });
          zone.addEventListener('drop', (e) => {
            e.preventDefault(); zone.style.outline = '';
            let d = {}; try { d = JSON.parse(e.dataTransfer.getData('text/plain')); } catch {}
            moverEtapa(d.phone, zone.dataset.stage, d.from);
          });
        });
      };

      $('#wc-nova-etapa').onclick = async () => {
        const nome = await uiPrompt('Nome da nova etapa:', '');
        if (!nome || !nome.trim()) return;
        try { await api('/api/whatsapp-instance/stages', { method: 'POST', body: JSON.stringify({ name: nome.trim() }) }); load(); }
        catch (e) { toast(e.message, 'error'); }
      };

      await load();
    };

    // ── Aba FILA (comportamento original + envio direto quando conectado) ──
    const tabFila = async (st) => {
      const d = await api('/api/whatsapp-queue');
      const body = $('#wa-body');
      body.innerHTML = `
        <div class="kpi-grid">${kpi('Aguardando envio', d.pendentes.length, d.pendentes.length ? 'money' : '')}</div>
        <div id="wa-list"></div>
        ${d.enviadas.length ? `<div class="card" style="margin-top:16px"><div style="padding:12px 16px;border-bottom:1px solid var(--border)"><strong style="color:var(--navy)">Enviadas recentemente</strong></div>
          ${d.enviadas.map((e) => `<div class="mini-row" style="padding:8px 16px"><span>${esc(e.recipient_name)} <span class="badge">${(CTX[e.context] || CTX.avulsa)[0]}</span></span><small style="color:var(--text-muted)">${fmtDateTime(e.sent_at)}</small></div>`).join('')}</div>` : ''}`;
      $('#wa-list').innerHTML = d.pendentes.length ? d.pendentes.map((m) => {
        const [ctxLabel, ctxColor] = CTX[m.context] || CTX.avulsa;
        return `<div class="card" style="padding:16px 18px;margin-bottom:12px;border-left:3px solid ${ctxColor}">
          <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline">
            <span><strong style="color:var(--navy-deep)">${esc(m.recipient_name)}</strong> <small style="color:var(--text-muted)">· ${esc(m.phone)}</small></span>
            <span class="badge" style="color:${ctxColor}">${ctxLabel}</span>
          </div>
          <textarea data-msg="${m.id}" style="width:100%;margin-top:10px;min-height:74px;font-size:13.5px;line-height:1.5">${esc(m.message)}</textarea>
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
            <button class="btn-gold btn-sm" data-send="${m.id}" data-phone="${esc(m.phone)}">${svgIcon('chat', 'ic-xs')} Enviar no WhatsApp</button>
            <button class="btn-sm" data-done="${m.id}">Já enviei ✓</button>
            <button class="btn-ghost btn-sm" data-skip="${m.id}">Descartar</button>
          </div>
        </div>`;
      }).join('') : '<div class="empty">Nenhuma mensagem aguardando. O sistema prepara cobranças e lembretes de audiência todo dia às 07h15 — ou clique em "Gerar agora".</div>';

      // Envia: pela INSTÂNCIA se conectada; senão abre o wa.me (1 clique)
      body.querySelectorAll('[data-send]').forEach((b) => b.onclick = async () => {
        const texto = body.querySelector(`[data-msg="${b.dataset.send}"]`).value;
        try {
          if (st && st.connected) {
            await api(`/api/whatsapp-instance/chats/${b.dataset.phone}/send`, { method: 'POST', body: JSON.stringify({ text: texto }) });
            await api(`/api/whatsapp-queue/${b.dataset.send}/enviada`, { method: 'POST', body: '{}' });
            toast('Enviada pela instância ✓');
          } else {
            window.open(`https://wa.me/${b.dataset.phone}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
            await api(`/api/whatsapp-queue/${b.dataset.send}/enviada`, { method: 'POST', body: '{}' });
          }
          shell();
        } catch (e) { toast(e.message, 'error'); }
      });
      body.querySelectorAll('[data-done]').forEach((b) => b.onclick = async () => {
        try { await api(`/api/whatsapp-queue/${b.dataset.done}/enviada`, { method: 'POST', body: '{}' }); toast('Marcada como enviada'); shell(); } catch (e) { toast(e.message, 'error'); }
      });
      body.querySelectorAll('[data-skip]').forEach((b) => b.onclick = async () => {
        try { await api(`/api/whatsapp-queue/${b.dataset.skip}/descartar`, { method: 'POST', body: '{}' }); shell(); } catch (e) { toast(e.message, 'error'); }
      });
    };

    await shell();
  },
});
