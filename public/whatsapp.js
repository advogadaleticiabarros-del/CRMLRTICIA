// ============================================================================
// whatsapp.js — módulo WhatsApp (fila, conversas estilo WhatsApp Web, conexão QR)
// Extraído do app.js (modularização). Carregado DEPOIS do app.js no index.html;
// usa os globais (api, $, esc, money, kpi, fmt*, el, openModal, field, svgIcon,
// toast, closeModal, fileHref) e registra a rota em ROUTES.
// ============================================================================

// Visualizador de imagem na própria janela — pedido explícito pra parar de
// abrir anexo de foto numa aba nova do navegador. Clicar fora (no fundo
// escurecido) ou Esc fecha e volta pra mensagem; botão de baixar usa o
// atributo download (mesma origem — funciona direto, sem popup bloqueado).
function abrirImagemLightbox(url) {
  const ov = document.createElement('div');
  ov.className = 'wa-lightbox';
  ov.innerHTML = `
    <img src="${esc(url)}" alt="Imagem" class="wa-lightbox-img">
    <div class="wa-lightbox-bar">
      <a href="${esc(url)}" download class="btn-icon" title="Baixar imagem">${svgIcon('download')}</a>
      <button type="button" class="btn-icon" id="wa-lightbox-close" title="Fechar (Esc)">${svgIcon('x')}</button>
    </div>`;
  document.body.appendChild(ov);
  const fechar = () => { ov.remove(); document.removeEventListener('keydown', onEsc); };
  ov.addEventListener('click', (e) => { if (e.target === ov) fechar(); }); // só o fundo, não a imagem/barra
  ov.querySelector('#wa-lightbox-close').onclick = fechar;
  const onEsc = (e) => { if (e.key === 'Escape') fechar(); };
  document.addEventListener('keydown', onEsc);
}

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

// Auditoria — 2 seções: mensagens apagadas (quem/quando/texto/motivo) e a
// fila de envio (antes uma aba própria "Fila" no topo do módulo — reunida
// aqui porque as duas são "conferência do que aconteceu/vai acontecer",
// não atendimento do dia a dia; ver pedido explícito de simplificar a
// barra do WhatsApp pra só Contatos + Conversas).
const AUD_CTX = { cobranca: ['Cobrança', 'var(--amber)'], audiencia: ['Audiência', 'var(--red)'], protocolo: ['Protocolo', 'var(--green)'], avulsa: ['Avulsa', 'var(--text-muted)'] };
async function abrirAuditoriaModal() {
  let secao = 'apagadas';
  const body = el(`<div>
    <div class="tabs" id="aud-tabs" style="margin-bottom:14px">
      <button type="button" class="tab" data-sec="saude">Saúde do WhatsApp</button>
      <button type="button" class="tab active" data-sec="apagadas">Mensagens apagadas</button>
      <button type="button" class="tab" data-sec="fila">Fila de envio</button>
    </div>
    <div id="aud-body"><div class="spinner"></div></div>
  </div>`);
  openModal('Auditoria', body, { wide: true });

  // Painel de saúde da integração — junta o que já existe de verdade (status
  // ao vivo, última mensagem recebida como indício de que o webhook está
  // funcionando, e o histórico de falhas que já é gravado hoje). Números de
  // falha são "pelo menos N" (avisos são limitados a 1 a cada 30min — ver
  // comentário no backend, GET /api/whatsapp-instance/saude), não a contagem
  // exata — deixa isso explícito na tela em vez de fingir precisão que não existe.
  const fmtRelativo = (iso) => {
    if (!iso) return 'nunca';
    const diffMin = Math.floor((Date.now() - new Date(iso)) / 60000);
    if (diffMin < 1) return 'agora mesmo';
    if (diffMin < 60) return `há ${diffMin} min`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `há ${diffH}h`;
    return `há ${Math.floor(diffH / 24)} dia(s)`;
  };
  const renderSaude = async () => {
    const box = $('#aud-body');
    box.innerHTML = '<div class="spinner"></div>';
    const s = await api('/api/whatsapp-instance/saude').catch(() => null);
    if (!s) { box.innerHTML = '<div class="empty">Não foi possível carregar os dados de saúde agora.</div>'; return; }
    box.innerHTML = `
      <div class="kpi-grid" style="margin-bottom:16px">
        <div class="kpi"><div class="label">Conexão</div><div class="value" style="color:${s.connected ? 'var(--green)' : 'var(--red)'}">${s.connected ? 'Conectado' : 'Desconectado'}</div></div>
        <div class="kpi"><div class="label">Última mensagem recebida</div><div class="value" style="font-size:16px">${fmtRelativo(s.ultima_mensagem_recebida)}</div></div>
        <div class="kpi"><div class="label">Envio automático hoje</div><div class="value" style="font-size:16px">${s.sentToday || 0}/30</div></div>
        <div class="kpi"><div class="label">Falhas de mídia (7 dias)</div><div class="value ${s.falhas.midia_7d ? 'money' : ''}">${s.falhas.midia_7d}</div></div>
        <div class="kpi"><div class="label">Falhas de envio (7 dias)</div><div class="value ${s.falhas.envio_7d ? 'money' : ''}">${s.falhas.envio_7d}</div></div>
      </div>
      ${!s.connected ? `<div class="card" style="padding:14px 16px;border-left:3px solid var(--red);margin-bottom:16px">
          <strong style="color:var(--red)">Instância desconectada.</strong>
          ${s.lastError ? ` Último erro: ${esc(s.lastError)}` : ' Conecte novamente em Configurações → Conexão do WhatsApp.'}
        </div>` : ''}
      <p class="sub" style="margin-bottom:12px">Os avisos de falha de mídia e de envio automático são limitados a 1 a cada 30 minutos — os números acima são "pelo menos", não a contagem exata de cada falha. Falha de transcrição de áudio e erros genéricos do webhook ainda não ficam registrados aqui, só no log do servidor.</p>
      ${s.recentes.length ? `<div class="card"><div style="padding:12px 16px;border-bottom:1px solid var(--border)"><strong style="color:var(--navy)">Avisos recentes</strong></div>
        ${s.recentes.map((r) => `<div class="mini-row" style="padding:10px 16px;border-bottom:1px solid var(--border-soft);align-items:flex-start">
          <span><strong style="color:var(--navy-deep)">${esc(r.titulo)}</strong><br><small style="color:var(--text-muted)">${esc(r.mensagem)}</small></span>
          <small style="color:var(--text-muted);white-space:nowrap">${fmtDateTime(r.quando)}</small>
        </div>`).join('')}</div>` : '<div class="empty">Nenhuma falha registrada nos últimos 30 dias.</div>'}`;
  };

  const renderApagadas = async () => {
    const box = $('#aud-body');
    box.innerHTML = '<div class="spinner"></div>';
    const rows = await api('/api/whatsapp-instance/messages/deletions').catch(() => []);
    box.innerHTML = rows.length ? `
      <table><thead><tr><th>Quando</th><th>Telefone</th><th>Quem apagou</th><th>Texto original</th><th>Motivo</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td style="white-space:nowrap">${fmtDateTime(r.deleted_at)}</td>
        <td>+${esc(r.phone)}</td>
        <td>${esc(r.deleted_by_name || '—')}</td>
        <td>${esc(r.body_original || '—')}</td>
        <td>${esc(r.reason)}</td>
      </tr>`).join('')}</tbody></table>`
      : '<div class="empty">Nenhuma mensagem apagada ainda.</div>';
  };

  const renderFila = async () => {
    const box = $('#aud-body');
    box.innerHTML = '<div class="spinner"></div>';
    const [d, st] = await Promise.all([
      api('/api/whatsapp-queue'),
      api('/api/whatsapp-instance/status').catch(() => ({ connected: false })),
    ]);
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px;flex-wrap:wrap">
        <div class="kpi-grid" style="margin:0"><div class="kpi"><div class="label">Aguardando envio</div><div class="value ${d.pendentes.length ? 'money' : ''}">${d.pendentes.length}</div></div></div>
        <button class="btn-gold btn-sm" id="aud-gerar">Gerar agora</button>
      </div>
      <div id="aud-fila-list"></div>
      ${d.enviadas.length ? `<div class="card" style="margin-top:16px"><div style="padding:12px 16px;border-bottom:1px solid var(--border)"><strong style="color:var(--navy)">Enviadas recentemente</strong></div>
        ${d.enviadas.map((e) => `<div class="mini-row" style="padding:8px 16px"><span>${esc(e.recipient_name)} <span class="badge">${(AUD_CTX[e.context] || AUD_CTX.avulsa)[0]}</span></span><small style="color:var(--text-muted)">${fmtDateTime(e.sent_at)}</small></div>`).join('')}</div>` : ''}`;

    box.querySelector('#aud-gerar').onclick = async () => {
      try { const r = await api('/api/whatsapp-queue/gerar', { method: 'POST', body: '{}' }); toast(r.created ? `${r.created} mensagem(ns) preparadas` : 'Nada novo para preparar'); renderFila(); }
      catch (e) { toast(e.message, 'error'); }
    };

    $('#aud-fila-list').innerHTML = d.pendentes.length ? d.pendentes.map((m) => {
      const [ctxLabel, ctxColor] = AUD_CTX[m.context] || AUD_CTX.avulsa;
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

    box.querySelectorAll('[data-send]').forEach((b) => b.onclick = async () => {
      const texto = box.querySelector(`[data-msg="${b.dataset.send}"]`).value;
      try {
        if (st && st.connected) {
          await api(`/api/whatsapp-instance/chats/${b.dataset.phone}/send`, { method: 'POST', body: JSON.stringify({ text: texto }) });
          await api(`/api/whatsapp-queue/${b.dataset.send}/enviada`, { method: 'POST', body: '{}' });
          toast('Enviada pela instância ✓');
        } else {
          window.open(`https://wa.me/${b.dataset.phone}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
          await api(`/api/whatsapp-queue/${b.dataset.send}/enviada`, { method: 'POST', body: '{}' });
        }
        renderFila();
      } catch (e) { toast(e.message, 'error'); }
    });
    box.querySelectorAll('[data-done]').forEach((b) => b.onclick = async () => {
      try { await api(`/api/whatsapp-queue/${b.dataset.done}/enviada`, { method: 'POST', body: '{}' }); toast('Marcada como enviada'); renderFila(); } catch (e) { toast(e.message, 'error'); }
    });
    box.querySelectorAll('[data-skip]').forEach((b) => b.onclick = async () => {
      try { await api(`/api/whatsapp-queue/${b.dataset.skip}/descartar`, { method: 'POST', body: '{}' }); renderFila(); } catch (e) { toast(e.message, 'error'); }
    });
  };

  const RENDER_SEC = { saude: renderSaude, apagadas: renderApagadas, fila: renderFila };
  body.querySelectorAll('[data-sec]').forEach((btn) => btn.onclick = () => {
    if (secao === btn.dataset.sec) return;
    secao = btn.dataset.sec;
    body.querySelectorAll('[data-sec]').forEach((b) => b.classList.toggle('active', b.dataset.sec === secao));
    RENDER_SEC[secao]();
  });

  await renderApagadas();
}

Object.assign(ROUTES, {
  // ── WhatsApp — módulo completo: conversas (instância) e contatos (Kanban).
  // Fila de envio e Conexão viraram Auditoria → "Fila de envio" e
  // Configurações → "Conexão do WhatsApp", respectivamente — pedido
  // explícito pra deixar só o essencial do dia a dia aqui na frente.
  async whatsapp(page) {
    // Padrão passa a ser a central de atendimento (3 painéis) — o quadro
    // Kanban de etapas ("Contatos") continua existindo, mas só como 2ª
    // visualização acessível pelo botão de alternância no cabeçalho, não
    // mais a aba que abre primeiro (pedido explícito: "não quero Kanban"
    // como tela principal).
    let tab = 'conversas';
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

    // Mesma lógica/limiares de src/services/whatsappSeveridade.ts — ver spec
    // docs/superpowers/specs/2026-08-21-whatsapp-conversas-redesign.md. Reescrita aqui
    // porque este arquivo é servido direto ao navegador, sem build step.
    // Compartilhada entre a aba Conversas e os cards do quadro Kanban (Contatos).
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

    const shell = async () => {
      if (chatTimer) { clearInterval(chatTimer); chatTimer = null; }
      const st = await api('/api/whatsapp-instance/status').catch(() => ({ connected: false }));
      const focoTotal = document.body.classList.contains('foco-total');
      page.innerHTML = `
        <div class="page-header">${focoTotal ? '<a href="' + esc(location.pathname) + '" class="foco-voltar">← Voltar ao CRM</a>' : ''}<div><h2>Central de Atendimento<span class="wa-status-dot ${st.connected ? 'on' : ''}" style="display:inline-block;vertical-align:middle;margin-left:9px" title="${st.connected ? `Instância conectada (${esc(st.me || '')}) — envio automático ${st.autoSend ? 'LIGADO' : 'desligado'} · ${st.sentToday || 0}/30 hoje` : 'Instância desconectada — conecte em Configurações'}"></span></h2><p class="sub" id="wa-contagem">WhatsApp</p></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${focoTotal ? '' : `<button class="btn-ghost" id="wa-tela-cheia" title="Abre numa aba separada, sem menu lateral">${svgIcon('expand')}Tela cheia</button>`}
            <div class="wa-view-toggle" id="wa-view-toggle" role="tablist" aria-label="Alternar visualização">
              <button type="button" class="wa-view-opt ${tab === 'conversas' ? 'active' : ''}" data-wtab="conversas" title="Lista de conversas">${svgIcon('chat', 'ic-xs')}Lista</button>
              <button type="button" class="wa-view-opt ${tab === 'contatos' ? 'active' : ''}" data-wtab="contatos" title="Quadro por etapas">${svgIcon('kanban', 'ic-xs')}Quadro</button>
            </div>
            ${tab === 'contatos' ? '<button class="btn-gold btn-sm" id="wc-nova-etapa">+ Nova etapa</button>' : ''}
            <button class="btn-gold" id="wa-nova">+ Nova conversa</button>
          </div></div>
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
      // escondido via CSS quando .page-header já tem o seu próprio. O
      // botão de alternância (#wa-view-toggle) já nasce dentro da faixa de
      // ações do cabeçalho — diferente do antigo `.tabs`, não precisa mais
      // ser movido pra lá em tela-cheia.
      page.querySelectorAll('[data-wtab]').forEach((b) => b.onclick = () => { tab = b.dataset.wtab; shell(); });
      const telaCheiaBtn = $('#wa-tela-cheia');
      if (telaCheiaBtn) telaCheiaBtn.onclick = () => window.open(location.pathname + '?foco=1#whatsapp', '_blank', 'noopener');
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
        openModal('Nova conversa de WhatsApp', form);
      };
      if (tab === 'conversas') await tabConversas();
      else await tabContatos();
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
      let filtroEtiqueta = '';  // etiqueta/setor selecionado na barra de ações
      let filtroResp = '';      // id do responsável selecionado (vazio = todos)
      // Abas horizontais acima da lista — "amei essa parte" (pedido explícito
      // da usuária pra reduzir ruído visual quando há muitas conversas abertas).
      // Deriva 100% do que já vinha em cada conversa (archived, não-lidas e
      // quem mandou a última mensagem) — sem coluna nova no banco:
      //   todas        → tudo, incl. arquivadas
      //   naolidas     → unread > 0
      //   atendimento  → não arquivada (em andamento, respondida ou não)
      //   finalizadas  → conversa arquivada
      let aba = 'atendimento';
      // Preferência da usuária pra Ficha do contato (aberta/fechada) — LEMBRADA
      // entre conversas, nunca recalculada a cada clique. Antes, abrirChat()
      // decidia sozinho "abrir se a tela for larga" toda vez que uma conversa
      // era aberta, o que reabria a ficha mesmo logo depois de a usuária
      // fechá-la — o grid pulava de 2 pra 3 colunas a cada clique num contato
      // (o "a tela muda de tamanho" reportado). Agora só muda quando ELA pede.
      let ctxAberta = window.innerWidth >= 1100;
      // Foco na conversa — esconde a lista à esquerda (a coluna toda, não só
      // colapsa) pra sobrar mais espaço só pro histórico de mensagens.
      // Pedido explícito: "ajustar essa parte pra maior ou menor e até
      // minimizar, deixar só a tela da conversa". Persiste entre trocas de
      // conversa igual ctxAberta, pelo mesmo motivo (escolha da usuária, não
      // recalculada a cada clique).
      let focoConversa = false;
      // Barra de busca/filtros — colapsável (mesmo pedido acima, "maior ou
      // menor"). Persiste entre sessões (localStorage), não só na aba atual.
      let toolbarColapsada = false;
      try { toolbarColapsada = localStorage.getItem('wa_toolbar_colapsada') === '1'; } catch { /* opcional */ }
      let qtdMsgs = 0;          // p/ detectar novidade no polling
      let listaHtmlAtual = '';  // p/ pular re-render quando nada mudou (evita piscar/pesar)
      let ultimaInteracaoLista = 0; // p/ não deixar o polling reordenar a lista embaixo do dedo logo após um clique

      // Equipe (pro filtro "Responsável" da barra de ações) — só quem pode
      // atribuir atendente (admin/advogado) teria motivo pra ver essa lista
      // completa, mas o FILTRO em si é só leitura, então mostra pra todo
      // mundo (mesma regra de "Meus atendimentos", que qualquer um usava).
      const equipe = await api('/api/users').catch(() => []);
      const equipeAtiva = equipe.filter((u) => u.active);

      body.innerHTML = `
        <div class="toolbar" id="wa-toolbar">
          <div class="wa-toolbar-fields" id="wa-toolbar-fields" style="${toolbarColapsada ? 'display:none' : 'display:contents'}">
            <input id="waq" placeholder="Buscar por nome, telefone ou assunto…" autocomplete="off" style="min-width:220px;flex:1 1 220px">
            <select id="waf-status" title="Filtrar por status">
              <option value="todas">Status: Todas</option>
              <option value="naolidas">Não lidas</option>
              <option value="atendimento">Em atendimento</option>
              <option value="finalizadas">Finalizadas</option>
            </select>
            <select id="waf-resp" title="Filtrar por responsável">
              <option value="">Responsável: Todos</option>
              <option value="${USER.id}">Meus atendimentos</option>
              ${equipeAtiva.filter((u) => u.id !== USER.id).map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}
            </select>
            <select id="waf-etq" title="Filtrar por etiqueta/setor"><option value="">Etiqueta: Todas</option></select>
          </div>
          <span class="spacer"></span>
          <small id="wa-toolbar-label" style="color:var(--text-muted);display:${toolbarColapsada ? 'inline' : 'none'}">Busca e filtros minimizados</small>
          <span class="wa-toolbar-fields" id="wa-toolbar-fields-2" style="${toolbarColapsada ? 'display:none' : 'display:contents'}">
            <button type="button" class="btn-icon btn-icon-sm" id="wa-agenda-btn" title="Agenda telefônica">${svgIcon('users', 'ic-xs')}</button>
            <button type="button" class="btn-icon btn-icon-sm" id="wa-auditoria-btn" title="Auditoria de mensagens apagadas">${svgIcon('info', 'ic-xs')}</button>
          </span>
          <button type="button" class="btn-icon btn-icon-sm" id="wa-toolbar-toggle" aria-expanded="${toolbarColapsada ? 'false' : 'true'}" title="${toolbarColapsada ? 'Mostrar busca e filtros' : 'Minimizar busca e filtros'}">${svgIcon(toolbarColapsada ? 'chevronDown' : 'chevronUp', 'ic-xs')}</button>
        </div>
        <div class="wa-shell" id="wa-shell">
        <div class="wa-side">
          <div class="wa-head-col">
            <span class="wa-head-col-title">Conversas</span>
            <span class="wa-head-col-unread" id="wa-unread-total"></span>
          </div>
          <div class="wa-pastas" id="wap-tabs"></div>
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

      // Selects de filtro da barra de ações (Status/Responsável/Etiqueta) —
      // o de Etiqueta precisa ser reconstruído a cada renderFiltros() porque
      // a lista de etiquetas existentes muda conforme as conversas chegam;
      // Status/Responsável já vêm prontos no HTML inicial (opções fixas).
      const renderFiltros = () => {
        renderAbas();
        const sel = $('#waf-etq'); if (!sel) return;
        const atual = sel.value;
        const ets = todasEtiquetas();
        sel.innerHTML = `<option value="">Etiqueta: Todas</option>${ets.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}`;
        if (ets.includes(atual)) sel.value = atual; // preserva a seleção entre polls
      };

      const correspondeAba = (c, ab) => {
        const arquivada = !!Number(c.archived);
        if (ab === 'naolidas') return Number(c.unread) > 0;
        if (ab === 'atendimento') return !arquivada;
        if (ab === 'finalizadas') return arquivada;
        return true; // 'todas'
      };

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

      // Abas horizontais — 1 botão único por aba, com contador. Refeito a
      // cada renderFiltros() (mesmos pontos de chamada já cobrem todo lugar
      // que muda `chats`, incl. o polling), então os contadores nunca ficam
      // desatualizados. O select "Status" da barra de ações controla a MESMA
      // variável `aba` — os dois são só 2 entradas pro mesmo estado.
      const mudarAba = (nova) => {
        if (aba === nova) return;
        aba = nova;
        const selStatus = $('#waf-status'); if (selStatus) selStatus.value = aba;
        renderAbas(); renderLista();
      };
      const renderAbas = () => {
        const box = $('#wap-tabs'); if (!box) return;
        const cont = { todas: chats.length, naolidas: 0, atendimento: 0, finalizadas: 0 };
        chats.forEach((c) => {
          if (Number(c.unread) > 0) cont.naolidas++;
          if (Number(c.archived)) cont.finalizadas++; else cont.atendimento++;
        });
        const ABAS = [['todas', 'Todas'], ['naolidas', 'Não lidas'], ['atendimento', 'Em atendimento'], ['finalizadas', 'Finalizadas']];
        box.innerHTML = ABAS.map(([v, t]) => `<button type="button" class="wa-pasta-tab ${aba === v ? 'active' : ''}" data-pasta="${v}">${t}<span class="wa-pasta-count">${cont[v]}</span></button>`).join('');
        box.querySelectorAll('[data-pasta]').forEach((b) => b.onclick = () => mudarAba(b.dataset.pasta));
        const selStatus = $('#waf-status'); if (selStatus) selStatus.value = aba;
      };

      const renderLista = () => {
        const q = busca.toLowerCase();
        let vis = chats.filter((c) => {
          if (q && !(String(c.client_name || '').toLowerCase().includes(q) || String(c.phone).includes(q) || String(c.last_body || '').toLowerCase().includes(q))) return false;
          if (!correspondeAba(c, aba)) return false;
          if (filtroEtiqueta && !parseLabels(c.labels).includes(filtroEtiqueta)) return false;
          if (filtroResp && Number(c.assigned_user_id) !== Number(filtroResp)) return false;
          return true;
        });
        vis = [...vis].sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (new Date(b.last_time) - new Date(a.last_time)));
        const html = vis.length ? vis.map((c) => {
          const nome = c.client_name || c.push_name || '+' + c.phone;
          const tags = parseLabels(c.labels);
          const sev = severidadeConversa(c);
          const et = etiquetaPendencia(c);
          return `<div class="wa-item sev-${sev} ${ativo && ativo.phone === c.phone ? 'on' : ''}" data-chat="${esc(c.phone)}" role="button" tabindex="0" aria-label="Abrir conversa com ${esc(nome)}">
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
        }).join('') : `<div class="wa-empty">${aba === 'finalizadas' ? 'Nenhuma conversa finalizada' : 'Nenhuma conversa encontrada'}</div>`;
        const totalNaoLidas = chats.reduce((s, c) => s + Number(c.unread || 0), 0);
        const elUnread = $('#wa-unread-total');
        if (elUnread) elUnread.textContent = totalNaoLidas ? `${totalNaoLidas} não lida${totalNaoLidas > 1 ? 's' : ''}` : '';
        const elContagem = $('#wa-contagem');
        if (elContagem) elContagem.textContent = `${vis.length} conversa${vis.length === 1 ? '' : 's'} encontrada${vis.length === 1 ? '' : 's'}`;
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
        $('#wal').querySelectorAll('[data-chat]').forEach((r) => {
          const abrir = () => {
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
          };
          r.onclick = abrir;
          // Item é um <div role="button">, não um <button>/<a> — sem isso,
          // dá pra chegar nele com Tab mas não dá pra abrir com o teclado.
          r.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } };
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
              // Sem <a target="_blank"> de propósito: abre no visualizador da
              // própria janela (ver abrirImagemLightbox/ligarLightbox), não
              // numa aba nova — pedido explícito.
              anexo = `<br><img src="${url}" class="wa-anexo-img" loading="lazy" alt="Imagem recebida" style="cursor:pointer">`;
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
        const [cx, notasResp] = await Promise.all([
          api(`/api/whatsapp-instance/chats/${ativo.phone}/context`).catch(() => null),
          api(`/api/whatsapp-instance/chats/${ativo.phone}/notes`).catch(() => ({ notes: '' })),
        ]);
        if (!cx) { box.innerHTML = '<div class="wa-empty">Não foi possível carregar os dados deste contato.</div>'; return; }
        const STG = { separacao_documentos: 'Separação de docs', criacao_inicial: 'Criação inicial', revisao_inicial: 'Revisão inicial', aguardando_protocolo: 'Aguard. protocolo', protocolado: 'Protocolado', concluido: 'Concluído' };
        const bloco = (t, inner) => `<div style="padding:8px 14px;border-bottom:1px solid var(--border-soft)"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:4px">${t}</div>${inner}</div>`;
        let html = '';
        // Linha do card padrão de dados ("rótulo: valor"), usada nos cards
        // PROCESSO e FINANCEIRO abaixo — mesmo formato nos dois, só muda a cor
        // quando `alerta` é true (prazo perto / parcela vencida).
        const linha = (rotulo, valor, alerta) => `<div style="display:flex;justify-content:space-between;gap:10px;font-size:12.5px;padding:3px 0"><span style="color:var(--text-muted)">${rotulo}</span><strong style="color:${alerta ? 'var(--red)' : 'var(--navy-deep)'}">${valor}</strong></div>`;
        // ── Identificação — nome, telefone, e-mail, tipo de contato, área
        // jurídica, responsável, origem (lead), status do atendimento e
        // última interação, tudo num bloco só no topo da ficha (pedido
        // explícito do redesign — antes ficava espalhado/faltando).
        const cChat = chats.find((x) => x.phone === ativo.phone) || {};
        const tipoContato = cx.client ? 'Cliente' : (cx.lead ? 'Lead' : 'Contato não cadastrado');
        const statusAtendimento = Number(cChat.archived) ? 'Finalizada' : (Number(cChat.unread) > 0 ? 'Não lida' : 'Em atendimento');
        const areaJuridica = cx.client ? (cx.cases || []).map((k) => k.legal_area).find(Boolean) : cx.lead?.legal_area;
        html += bloco('Identificação', `<strong style="color:var(--navy-deep);font-size:13.5px">${esc(cx.client?.name || cx.lead?.name || ativo.name)}</strong>
          <div style="margin-top:6px">
            ${linha('Telefone', '+' + esc(ativo.phone))}
            ${cx.client?.email ? linha('E-mail', esc(cx.client.email)) : ''}
            ${cx.client?.cpf_cnpj ? linha('CPF/CNPJ', esc(cx.client.cpf_cnpj)) : ''}
            ${linha('Tipo de contato', tipoContato)}
            ${areaJuridica ? linha('Área jurídica', esc(areaJuridica)) : ''}
            ${cChat.assigned_user_name ? linha('Responsável', esc(cChat.assigned_user_name)) : ''}
            ${!cx.client && cx.lead?.source ? linha('Origem do lead', esc(cx.lead.source)) : ''}
            ${linha('Status do atendimento', statusAtendimento)}
            ${linha('Última interação', cx.ultima_resposta ? fmtDateTime(cx.ultima_resposta) : 'nunca respondeu')}
          </div>`);

        if (cx.client) {
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
        } else {
          const sug = cx.lead_sugerido;
          html += bloco('Cadastro', `<small style="color:var(--text-muted)">Número não cadastrado.</small>
            ${sug ? `<div style="margin-top:8px;padding:8px 10px;background:var(--surface);border:1px solid var(--gold);border-radius:6px;font-size:12.5px"><strong style="color:var(--navy);display:flex;align-items:center">${svgIcon('ia', 'ic-inline')}Parece um caso novo</strong><br>${esc(sug.resumo)}</div>` : ''}
            <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px"><button class="btn-gold btn-sm" id="wa-mklead">+ Cadastrar como lead</button><button class="btn-sm" id="wa-vincular-cliente">Vincular a cliente existente</button></div>`);
        }

        // ── Etiquetas — chips editáveis direto na ficha (antes só dava pra
        // editar pelo menu "⋯ Mais ações"; a lógica de salvar é a mesma).
        const etiquetasAtuais = parseLabels(cChat.labels);
        html += bloco('Etiquetas', `<div class="wa-chip-row" id="wa-ctx-chips">
          ${etiquetasAtuais.map((t) => `<span class="wa-tag wa-tag-removable" style="background:${cor(t)}">${esc(t)}<button type="button" data-rm-tag="${esc(t)}" aria-label="Remover etiqueta ${esc(t)}">×</button></span>`).join('')}
          <button type="button" class="wa-chip-add" id="wa-ctx-add-tag">+ etiqueta</button>
        </div>`);

        // ── Notas internas — nota nativa do WhatsApp Business (sincroniza lá
        // também), já existia o endpoint no backend, só faltava esta tela.
        html += bloco('Notas internas', `
          <textarea id="wa-ctx-notas" rows="3" style="width:100%;font-size:12.5px;line-height:1.5;font-family:inherit;resize:vertical" placeholder="Anotações internas da equipe sobre este contato…">${esc(notasResp?.notes || '')}</textarea>
          <button type="button" class="btn-sm" id="wa-ctx-notas-salvar" style="margin-top:6px">Salvar nota</button>`);

        // ── Vínculos no CRM — todos os processos do cliente (o card
        // "Processo" acima só destaca o mais recente).
        html += bloco('Vínculos no CRM', (cx.cases || []).length ? `
          <div style="display:flex;flex-direction:column;gap:5px">
            ${cx.cases.map((k) => `<div style="font-size:12.5px;color:var(--navy-deep)">${svgIcon('briefcase', 'ic-xs')} ${esc(k.title || 'Processo')}${k.case_number ? ' · nº ' + esc(k.case_number) : ''}</div>`).join('')}
          </div>` : '<small style="color:var(--text-muted)">Nenhum processo vinculado ainda</small>');

        html += `<div style="padding:12px 14px;display:flex;flex-direction:column;gap:6px">
          <button type="button" class="btn-gold btn-sm" id="wa-ctx-gerar-proposta" ${cx.lead ? '' : 'disabled title="Só disponível pra quem já é lead — cadastre como lead primeiro"'}>${svgIcon('file', 'ic-xs')}Gerar proposta</button>
          <button type="button" class="btn-sm" id="wa-ctx-abrir-cadastro" ${(cx.client || cx.lead) ? '' : 'disabled title="Ainda não é cliente nem lead"'}>${svgIcon('file', 'ic-xs')}Abrir cadastro</button>
          <button type="button" class="btn-sm" data-conv="tarefa">${svgIcon('clock', 'ic-xs')}Criar tarefa</button>
          <button type="button" class="btn-sm" id="wa-ctx-vincular-processo" ${cx.client ? '' : 'disabled title="Vincule a um cliente primeiro"'}>${svgIcon('briefcase', 'ic-xs')}Vincular processo</button>
        </div>`;

        html += bloco('Converter conversa em…', `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
            <button class="btn-sm" data-conv="tarefa">+ Tarefa</button>
            <button class="btn-sm" data-conv="prazo" ${(cx.cases || []).length ? '' : 'disabled title="Precisa de um processo"'}>+ Prazo</button>
            <button class="btn-sm" data-conv="compromisso">+ Compromisso</button>
            <button class="btn-sm" data-conv="anotacao" ${cx.client ? '' : 'disabled title="Precisa ser cliente"'}>+ Anotação</button>
          </div>`);
        html += `<div style="padding:12px 14px"><button class="wa-ctx-primary" id="wa-resumo">${svgIcon('ia')}Resumir conversa com IA</button></div>`;
        // Grade de ações rápidas + arquivar — mesma referência visual aprovada
        // (grade 2x2 + botão vermelho cheio embaixo). Não duplica lógica: cada
        // botão só aciona o mesmo item do menu "⋯ Mais ações" do cabeçalho,
        // que já faz a chamada real de API.
        html += `<div class="wa-ctx-actions">
            <button type="button" class="wa-ctx-qbtn" data-quick="assign">${svgIcon('users', 'ic-xs')}Atendente</button>
            <button type="button" class="wa-ctx-qbtn" data-quick="pdf">${svgIcon('printer', 'ic-xs')}Histórico</button>
            <button type="button" class="wa-ctx-qbtn" data-quick="label">${svgIcon('tag', 'ic-xs')}Etiquetas</button>
            <button type="button" class="wa-ctx-qbtn wa-ctx-qbtn-danger" data-quick="block">${svgIcon('x', 'ic-xs')}${ativo.blocked ? 'Desbloquear' : 'Bloquear'}</button>
          </div>
          <button type="button" class="wa-ctx-final" data-quick="archive">${svgIcon('archive', 'ic-xs')}${Number(chats.find((x) => x.phone === ativo.phone)?.archived) ? 'Desarquivar conversa' : 'Arquivar conversa'}</button>`;
        box.innerHTML = `<div style="padding:10px 14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
            <strong style="font-size:13px;color:var(--navy)">Detalhes do contato</strong>
            <button class="btn-icon btn-icon-sm" id="wa-ctx-agenda" title="Salvar na agenda telefônica">${svgIcon('users', 'ic-xs')}</button>
          </div>` + html;
        // Simula o clique no item correspondente do menu "⋯ Mais ações" (mesmo
        // cabeçalho da conversa) — reusa 100% da lógica de lá, sem reimplementar.
        box.querySelectorAll('[data-quick]').forEach((btn) => btn.onclick = () => {
          $('#wa-mais')?.click();
          requestAnimationFrame(() => $(`#wa-mais-menu [data-acao="${btn.dataset.quick}"]`)?.click());
        });
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

        // Etiquetas — chips editáveis inline, reaproveita a mesma rota já
        // usada pelo menu "⋯ Mais ações → Etiquetas".
        const salvarEtiquetas = async (lista) => {
          try {
            await api(`/api/whatsapp-instance/chats/${ativo.phone}/labels`, { method: 'POST', body: JSON.stringify({ labels: lista }) });
            renderContexto(); await atualizar(true);
          } catch (e) { toast(e.message, 'error'); }
        };
        box.querySelector('#wa-ctx-add-tag').onclick = async () => {
          const nova = await uiPrompt('Nova etiqueta:');
          if (!nova || !nova.trim()) return;
          if (etiquetasAtuais.includes(nova.trim())) { toast('Essa etiqueta já existe nesta conversa', 'error'); return; }
          await salvarEtiquetas([...etiquetasAtuais, nova.trim()]);
        };
        box.querySelectorAll('[data-rm-tag]').forEach((b) => b.onclick = () => salvarEtiquetas(etiquetasAtuais.filter((t) => t !== b.dataset.rmTag)));

        // Notas internas — nota nativa do WhatsApp Business (endpoint já existia).
        box.querySelector('#wa-ctx-notas-salvar').onclick = async (e) => {
          const btn = e.currentTarget;
          const texto = box.querySelector('#wa-ctx-notas').value;
          btn.disabled = true; btn.textContent = 'Salvando…';
          try {
            await api(`/api/whatsapp-instance/chats/${ativo.phone}/notes`, { method: 'POST', body: JSON.stringify({ notes: texto }) });
            toast('Nota salva');
          } catch (err) { toast(err.message, 'error'); }
          btn.disabled = false; btn.textContent = 'Salvar nota';
        };

        // Gerar proposta — mesmo formulário/endpoint da tela Leads (reusa
        // propostaForm, função global de app.js), só que aberto direto da
        // conversa. Busca o lead completo (GET /api/leads/:id, com
        // endereço/estado civil/profissão — o /context da conversa só traz
        // um resumo do lead) pra chegar com o mesmo pré-preenchimento que
        // já tinha na ficha do lead.
        const gp = box.querySelector('#wa-ctx-gerar-proposta');
        if (gp && cx.lead) gp.onclick = async () => {
          gp.disabled = true;
          try {
            const leadCompleto = await api('/api/leads/' + cx.lead.id);
            propostaForm(() => {}, leadCompleto);
          } catch (e) { toast(e.message, 'error'); }
          gp.disabled = false;
        };

        // Abrir cadastro — cliente já tem ficha própria (reaproveitada de
        // Clientes); lead ainda não tem modal dedicado, então leva pra tela.
        box.querySelector('#wa-ctx-abrir-cadastro').onclick = () => {
          if (cx.client) { fichaCliente(cx.client.id); return; }
          if (cx.lead) { location.hash = '#leads'; toast('Abra o card deste lead no Funil de Leads para editar'); }
        };

        // Vincular processo — cria um processo novo já vinculado ao cliente
        // desta conversa (reusa POST /api/cases, mesmo endpoint da tela
        // Processos), sem duplicar o formulário completo de lá.
        const vp = box.querySelector('#wa-ctx-vincular-processo');
        if (vp && cx.client) vp.onclick = () => {
          const form = el(`<form class="form-grid">
            ${field('Título *', 'title', { value: `Processo — ${cx.client.name}` })}
            ${field('Nº do processo', 'case_number')}
            ${field('Área jurídica', 'legal_area', { options: [['trabalhista','Trabalhista'],['previdenciario','Previdenciário'],['consumidor','Consumidor'],['familia','Família'],['civel','Cível'],['gestante','Gestante'],['outro','Outro']].map(([v, t]) => ({ v, t })) })}
            <button type="submit" class="btn-primary">Vincular processo</button>
          </form>`);
          form.onsubmit = async (ev) => {
            ev.preventDefault();
            const b = Object.fromEntries(new FormData(form));
            if (!b.title.trim()) { toast('Informe o título', 'error'); return; }
            try {
              await api('/api/cases', { method: 'POST', body: JSON.stringify({ ...b, client_id: cx.client.id }) });
              closeModal(); toast('Processo vinculado'); renderContexto();
            } catch (e) { toast(e.message, 'error'); }
          };
          openModal('Vincular processo desta conversa', form);
        };

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
        $('#wa-shell').classList.toggle('foco-conversa', focoConversa);
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
            <button class="btn-icon ${focoConversa ? 'on' : ''}" id="wa-foco-conversa" title="${focoConversa ? 'Mostrar a lista de conversas' : 'Minimizar lista — ver só esta conversa'}">${svgIcon(focoConversa ? 'minimize' : 'expand', 'ic-xs')}</button>
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
            <button type="button" class="btn-icon" id="wa-sugerir-horario" title="Sugerir próximos horários livres da agenda">📅</button>
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

        // Imagem recebida/enviada — abre num visualizador na própria janela
        // (clique fora fecha e volta pra mensagem) em vez de nova aba, com
        // botão de baixar. Religada junto de ligarAcoesMsg() logo abaixo,
        // mesma razão: precisa rodar de novo depois de cada redesenho de #wam.
        const ligarLightbox = () => {
          $('#wam').querySelectorAll('.wa-anexo-img').forEach((img) => img.onclick = () => abrirImagemLightbox(img.src));
        };

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
        ligarLightbox();

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
          ligarTranscricao(); ligarAcoesMsg(); ligarLightbox();
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
          else { buscaChatTermo = ''; buscaChatIdx = 0; $('#wam').innerHTML = renderMsgs(msgs); ligarTranscricao(); ligarAcoesMsg(); ligarLightbox(); }
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
        $('#wa-sugerir-horario').onclick = async () => {
          const btn = $('#wa-sugerir-horario');
          btn.disabled = true;
          try {
            const r = await api('/api/whatsapp-instance/proximos-horarios?n=2');
            if (!r.texto_sugerido) { toast('Nenhum horário livre encontrado nos próximos dias — confira a agenda', 'error'); return; }
            const inp = $('#wa-reply [name=text]');
            inp.value = r.texto_sugerido;
            inp.dispatchEvent(new Event('input')); // reajusta a altura da caixa de texto
            inp.focus();
          } catch (e) { toast(e.message, 'error'); }
          finally { btn.disabled = false; }
        };
        // Título amigável + prioridade de exibição pras respostas prontas mais
        // usadas — a Uazapi (dona dos atalhos) só guarda shortCut/texto, sem
        // campo de título ou ordem própria, então isso é resolvido aqui, no
        // front, por atalho conhecido. "documentos" é o pedido de dados pra
        // montar a proposta — sempre aparece primeiro na lista.
        const RESPOSTA_TITULO_PT = { documentos: 'Montar proposta' };
        const RESPOSTA_PRIORIDADE = ['documentos'];
        $('#wa-modelos').onclick = async () => {
          const tplsBrutos = await api('/api/whatsapp-instance/quickreplies').catch(() => []);
          const tpls = [...tplsBrutos].sort((a, b) => {
            const ia = RESPOSTA_PRIORIDADE.indexOf(a.shortCut || a.shortcut || '');
            const ib = RESPOSTA_PRIORIDADE.indexOf(b.shortCut || b.shortcut || '');
            return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
          });
          const primeiroNome = (ativo.name.startsWith('+') ? '' : ativo.name).split(' ')[0] || '';
          const wrap = el(`<div>
            <div style="display:flex;flex-direction:column;gap:8px;max-height:46vh;overflow:auto">
              ${tpls.map((t) => { const sc = t.shortCut || t.shortcut || ''; const titulo = RESPOSTA_TITULO_PT[sc]; return `<div style="border:1px solid var(--border);border-radius:8px;padding:10px 12px">
                <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline">
                  <strong style="font-size:13px;color:var(--navy-deep)">${titulo ? esc(titulo) + ' · ' : ''}/${esc(sc)}</strong>
                  <span style="white-space:nowrap"><button class="btn-gold btn-sm" data-usar="${t.id}">Usar</button> <button class="btn-ghost btn-sm" data-editar-tpl="${t.id}">${svgIcon('edit', 'ic-xs')}</button> <button class="btn-ghost btn-sm" data-apagar="${t.id}">${svgIcon('x', 'ic-xs')}</button></span>
                </div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:4px">${esc(String(t.text || '').slice(0, 110))}…</div>
              </div>`; }).join('') || '<div class="empty">Nenhuma resposta pronta ainda</div>'}
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
        // Foco na conversa — esconde a coluna da lista (não só recolhe:
        // some de vez, sobrando só a conversa, e a ficha se ainda estiver
        // aberta). Pedido explícito da usuária pra "deixar apenas a tela
        // da conversa". Igual ctxAberta, é lembrado entre conversas.
        $('#wa-foco-conversa').onclick = () => {
          focoConversa = !focoConversa;
          $('#wa-foco-conversa').classList.toggle('on', focoConversa);
          $('#wa-foco-conversa').title = focoConversa ? 'Mostrar a lista de conversas' : 'Minimizar lista — ver só esta conversa';
          $('#wa-foco-conversa').innerHTML = svgIcon(focoConversa ? 'minimize' : 'expand', 'ic-xs');
          $('#wa-shell').classList.toggle('foco-conversa', focoConversa);
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
      $('#waf-status').value = aba;
      $('#waf-status').onchange = (e) => mudarAba(e.target.value);
      $('#waf-resp').onchange = (e) => { filtroResp = e.target.value; renderLista(); };
      $('#waf-etq').onchange = (e) => { filtroEtiqueta = e.target.value; renderLista(); };
      $('#wa-agenda-btn').onclick = () => abrirAgendaModal((phone) => { abrirFonePendente = { phone }; shell(); });
      $('#wa-auditoria-btn').onclick = () => abrirAuditoriaModal();
      $('#wa-toolbar-toggle').onclick = () => {
        toolbarColapsada = !toolbarColapsada;
        try { localStorage.setItem('wa_toolbar_colapsada', toolbarColapsada ? '1' : '0'); } catch { /* opcional */ }
        const modoTexto = toolbarColapsada ? 'none' : 'contents';
        $('#wa-toolbar-fields').style.display = modoTexto;
        $('#wa-toolbar-fields-2').style.display = modoTexto;
        $('#wa-toolbar-label').style.display = toolbarColapsada ? 'inline' : 'none';
        const btn = $('#wa-toolbar-toggle');
        btn.title = toolbarColapsada ? 'Mostrar busca e filtros' : 'Minimizar busca e filtros';
        btn.setAttribute('aria-expanded', toolbarColapsada ? 'false' : 'true');
        btn.innerHTML = svgIcon(toolbarColapsada ? 'chevronDown' : 'chevronUp', 'ic-xs');
        ajustarAltura(); // a barra mudou de altura — o quadro precisa recalcular o espaço que sobra
      };
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
      const corEtiquetaKanban = (s) => WA_CORES[[...String(s)].reduce((a, ch) => a + ch.charCodeAt(0), 0) % WA_CORES.length];
      const body = $('#wa-body');
      const elContagem = $('#wa-contagem'); if (elContagem) elContagem.textContent = 'Quadro por etapas de atendimento';
      // "+ Nova etapa" mora no cabeçalho da página agora (junto de "+ Nova
      // conversa"), não numa faixa própria acima do quadro — essa faixa só
      // continha um botão sozinho alinhado à direita, um vão de espaço
      // "flutuante" sem função (reportado: "não quero esse espaço
      // sobrando acima"). O quadro agora começa direto abaixo do cabeçalho.
      body.innerHTML = `
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

      // Altura calculada de verdade (mesmo cálculo da aba Conversas,
      // ajustarAltura acima) — sem isso o quadro parava numa altura de
      // conteúdo qualquer, deixando metade da tela em branco embaixo,
      // mesmo em monitores grandes (reportado: "não usa a tela inteira").
      // Cada coluna (.kf-col) já estica pra bater com essa altura (flex
      // padrão), e .kf-cards (flex:1 só dentro de #wc-board — ver CSS)
      // ocupa o que sobrar depois do cabeçalho da coluna, com scroll
      // interno próprio.
      const ajustarAlturaQuadro = () => {
        if (tab !== 'contatos') { window.removeEventListener('resize', ajustarAlturaQuadro); return; }
        const wrapEl = $('.kanban-wrap');
        if (!wrapEl) return;
        const topo = wrapEl.getBoundingClientRect().top;
        const folga = document.body.classList.contains('foco-total') ? 10 : 24;
        wrapEl.style.height = Math.max(360, window.innerHeight - topo - folga) + 'px';
      };
      ajustarAlturaQuadro();
      window.addEventListener('resize', ajustarAlturaQuadro);

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
            <div class="kf-head wc-head">
              <span class="wc-head-title">
                <span class="wc-dot" style="background:${esc(s.color)}"></span>
                <span data-editar-etapa="${s.id}" class="wa-etapa-editar" title="Renomear/apagar etapa">${esc(s.name)}${svgIcon('edit', 'ic-xs')}</span>
              </span>
              <span class="kf-count">${(board[s.id] || []).length}</span>
            </div>
            <div class="kf-cards" data-stage="${s.id}">
              ${(board[s.id] || []).map((c) => {
                const sev = severidadeConversa(c);
                const et = etiquetaPendencia(c);
                const tags = c.labels || [];
                return `
                <div class="kf-card wc-card" draggable="true" data-phone="${esc(c.phone)}" data-nome="${esc(c.name)}" data-cliente="${c.client_id || ''}" data-stage="${s.id}">
                  <div class="wc-row1">
                    <span class="wc-avatar" style="background:${waCor(c.name)}">${waIniciais(c.name)}</span>
                    <span class="wc-name">${esc(c.name)}</span>
                  </div>
                  <div class="wc-prev">${Number(c.last_from_me) ? '✓ ' : ''}${esc(String(c.last_body || '').slice(0, 60))}</div>
                  ${et ? `<span class="wa-pill wa-pill-${sev}">${svgIcon(et.icone, 'ic-xs')}${esc(et.texto)}</span>` : ''}
                  <div class="wc-foot">
                    <span class="wc-tagdots">${tags.map((t) => `<span class="wc-tagdot" style="background:${corEtiquetaKanban(t)}" title="${esc(t)}"></span>`).join('')}</span>
                    <span class="wc-foot-right">
                      <span class="wc-meta">${c.assigned_user_name ? esc(c.assigned_user_name) + ' · ' : ''}${c.last_time ? waFmtDia(c.last_time) : ''}</span>
                      ${Number(c.unread) ? `<span class="wc-unread">${c.unread}</span>` : ''}
                      <select class="kf-move" draggable="false" data-phone="${esc(c.phone)}" data-from="${s.id}" title="Mover para outra etapa">
                        ${stages.map((s2) => `<option value="${s2.id}" ${s2.id === s.id ? 'selected' : ''}>${esc(s2.name)}</option>`).join('')}
                      </select>
                    </span>
                  </div>
                </div>`;
              }).join('') || '<div class="kf-empty">Nenhum contato nesta etapa</div>'}
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
            // Ia pra uma prévia (modal pequeno) e só depois — com mais um
            // clique — abria a conversa de fato. Pedido explícito: clicar no
            // card já deve abrir a janela completa direto, sem passo do meio.
            abrirFonePendente = { phone: card.dataset.phone }; tab = 'conversas'; shell();
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
    await shell();
  },
});
