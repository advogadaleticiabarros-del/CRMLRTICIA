// ── Mesa do caso (produção) ─────────────────────────────────────────────────
// Tela cheia de trabalho, aberta ao clicar num card de "Peças em produção":
// régua de etapas com "o que fazer agora", o caso à esquerda, a peça no centro
// (editável e formatável, com versões e comparação) e pendências + linha do
// tempo à direita. Usa os globais de app.js (api, esc, toast, openModal,
// uiPrompt, uiConfirm, fmtDate, money, parseMoneyBR, USER…). Dados em
// src/routes/mesa.ts; regras em src/services/mesaCaso.ts.
(function () {
  const COLCHETE = /\[[^[\]\n]*[A-Za-zÀ-ÿ][^[\]\n]*\]/g;
  const contar = (t) => (String(t || '').match(COLCHETE) || []).length;
  const hora = (d) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const area = (a) => (typeof AREA_LABELS !== 'undefined' && AREA_LABELS[a]) || a || '';
  const S = (d) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I = {
    voltar: S('<path d="M15 18l-6-6 6-6"/>'),
    seguir: S('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    ok: S('<path d="M5 12l5 5L20 7"/>'),
    falta: S('<circle cx="12" cy="12" r="8"/>'),
    alerta: S('<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/>'),
    esq: S('<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>'),
    cen: S('<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>'),
    jus: S('<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>'),
    num: S('<path d="M10 6h10M10 12h10M10 18h10M4 5h1v3M4 12h2l-2 3h2"/>'),
    lista: S('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'),
    recuo: S('<path d="M10 6h10M10 12h10M10 18h10M3 9l3 3-3 3"/>'),
    tirarRecuo: S('<path d="M10 6h10M10 12h10M10 18h10M6 9l-3 3 3 3"/>'),
    desfazer: S('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>'),
    refazer: S('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/>'),
    enviar: S('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3"/>'),
  };

  // Destaca os [campos a preencher] sem mudar o texto (o destaque sai antes de salvar).
  function marcarColchetes(root) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && n.parentElement.closest('mark.mesa-colchete') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nos = []; while (w.nextNode()) nos.push(w.currentNode);
    for (const n of nos) {
      const t = n.nodeValue; COLCHETE.lastIndex = 0;
      if (!COLCHETE.test(t)) continue;
      COLCHETE.lastIndex = 0;
      const frag = document.createDocumentFragment(); let i = 0, m;
      while ((m = COLCHETE.exec(t))) {
        if (m.index > i) frag.appendChild(document.createTextNode(t.slice(i, m.index)));
        const mk = document.createElement('mark'); mk.className = 'mesa-colchete'; mk.textContent = m[0]; frag.appendChild(mk);
        i = m.index + m[0].length;
      }
      if (i < t.length) frag.appendChild(document.createTextNode(t.slice(i)));
      n.replaceWith(frag);
    }
  }
  function htmlLimpo(root) {
    const c = root.cloneNode(true);
    c.querySelectorAll('mark').forEach((m) => m.replaceWith(...m.childNodes));
    return c.innerHTML;
  }
  // Colar do Word, do Jusbrasil ou de um PDF: fica só a formatação de peça.
  function limparColagem(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const OK = { P: 'p', DIV: 'p', BR: 'br', B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', H1: 'h3', H2: 'h3', H3: 'h3', H4: 'h3', UL: 'ul', OL: 'ol', LI: 'li', BLOCKQUOTE: 'blockquote', TABLE: 'table', TBODY: 'tbody', THEAD: 'thead', TR: 'tr', TD: 'td', TH: 'th' };
    const FORA = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH', 'HEAD', 'TITLE', 'META', 'LINK']);
    const out = (n) => {
      if (n.nodeType === 3) return esc(n.nodeValue);
      if (n.nodeType !== 1 || FORA.has(n.tagName)) return '';
      const dentro = [...n.childNodes].map(out).join('');
      const t = OK[n.tagName]; if (!t) return dentro;
      if (t === 'br') return '<br>';
      const al = (n.style && n.style.textAlign) || n.getAttribute('align') || '';
      return ['p', 'h3', 'li', 'td', 'th'].includes(t) && /^(left|center|right|justify)$/.test(al) ? `<${t} style="text-align:${al}">${dentro}</${t}>` : `<${t}>${dentro}</${t}>`;
    };
    return [...doc.body.childNodes].map(out).join('');
  }

  window.mesaDoCaso = async function mesaDoCaso(caseId, aoMudar) {
    const anterior = document.querySelector('.mesa');
    if (anterior) anterior.remove();
    const voltarFoco = document.activeElement;
    const ov = document.createElement('div');
    ov.className = 'mesa'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Mesa do caso');
    ov.innerHTML = '<div class="mesa-carregando" aria-live="polite"><div class="spinner"></div><span>Abrindo o caso…</span></div>';
    document.body.appendChild(ov); document.body.classList.add('mesa-aberta');

    const st = { d: null, prod: null, vendo: null, aba: 'caso', aoLado: false, docId: null, doc: null, comparar: false, sujo: false, salvando: false, deNovo: false, timer: null, mudou: false, usuarios: null, cursor: 0 };
    const q = (s) => ov.querySelector(s);
    const podeAtribuir = typeof USER !== 'undefined' && USER && ['admin', 'advogado'].includes(USER.role);

    async function carregar() {
      const [d, prod] = await Promise.all([api('/api/mesa/' + caseId), api(`/api/cases/${caseId}/production`).catch(() => null)]);
      st.d = d; st.prod = prod;
      // 1ª carga (ou etapa nova): abre no trabalho da etapa.
      if (st.vendo === null) { st.vendo = d.atual >= 0 ? d.atual : 0; st.aba = d.aba || 'caso'; st.aoLado = !!d.parecerAoLado; }
      if (!st.docId || !d.pecas.some((p) => p.id === st.docId)) {
        const ult = d.pecas[d.pecas.length - 1];
        st.docId = ult ? ult.id : null; st.doc = null;
      }
    }

    function onKey(e) {
      if (e.key !== 'Escape') return;
      const modal = document.querySelector('#modal');
      if ((modal && !modal.classList.contains('hidden')) || document.querySelector('#uid-ok')) return;
      fechar();
    }
    async function fechar() {
      clearTimeout(st.timer);
      if (st.sujo) await salvar().catch(() => {});
      document.removeEventListener('keydown', onKey, true);
      ov.remove(); document.body.classList.remove('mesa-aberta');
      if (voltarFoco && voltarFoco.focus) try { voltarFoco.focus(); } catch {}
      if (st.mudou && aoMudar) aoMudar();
    }
    // Captura: roda antes do Esc dos modais, para um Esc fechar só o modal que está por cima.
    document.addEventListener('keydown', onKey, true);

    try { await carregar(); } catch (e) {
      document.removeEventListener('keydown', onKey, true); ov.remove(); document.body.classList.remove('mesa-aberta');
      toast(e.message || 'Não foi possível abrir o caso', 'error'); return;
    }

    ov.innerHTML = `
      <header class="mesa-topo"></header>
      <nav class="mesa-jornada" aria-label="Etapas da produção"></nav>
      <section class="mesa-agora" aria-live="polite"></section>
      <div class="mesa-corpo">
        <aside class="mesa-rail mesa-rail-esq" aria-label="O caso"></aside>
        <main class="mesa-centro"></main>
        <aside class="mesa-rail mesa-rail-dir" aria-label="Pendências e linha do tempo"></aside>
      </div>`;

    // ── topo ────────────────────────────────────────────────────────────────
    function renderTopo() {
      const { caso: c, etapas, atual, conjunta } = st.d;
      const prox = atual >= 0 ? etapas[atual + 1] : null;
      const emProducao = !['protocolado', 'concluido', 'recusado'].includes(c.production_stage) && c.production_started_at;
      const dias = Number(c.sla_days) || 0;
      const sub = [c.title, area(c.legal_area), c.partner_name ? `parceria ${c.partner_name}` : '',
        conjunta ? `peça conjunta dos casos ${conjunta.casos.map((x) => '#' + x.id).join(' e ')}` : ''].filter(Boolean).map(esc).join(' · ');
      q('.mesa-topo').innerHTML = `
        <button type="button" class="mesa-voltar" data-acao="fechar">${I.voltar}Quadro</button>
        <div class="mesa-quem"><h1>${esc(c.client_name || c.title || 'Caso')}</h1><p>${sub}</p></div>
        ${emProducao ? `<div class="mesa-prazo${dias > 10 ? ' estourou' : ''}" title="Prazo de 10 dias, pausado enquanto houver pendência aberta">Prazo <span class="mesa-sla" aria-hidden="true"><span style="width:${Math.min(100, dias * 10)}%"></span></span><b>${dias} de 10 dias</b></div>` : ''}
        ${c.production_stage !== 'recusado' ? '<button type="button" class="mesa-btn mesa-btn-sm mesa-perigo" data-acao="recusar">Recusar caso</button>' : ''}
        ${prox ? `<button type="button" class="mesa-btn mesa-btn-pri" data-acao="avancar">Avançar para ${esc(prox.nome)}${I.seguir}</button>` : ''}`;
    }

    function renderJornada() {
      const { etapas } = st.d;
      const fases = [...new Set(etapas.map((e) => e.faseNome))];
      q('.mesa-jornada').innerHTML = fases.map((f) => `
        <div class="mesa-fase"><span class="mesa-fase-nome">${esc(f)}</span><div class="mesa-fase-passos">
          ${etapas.map((e, i) => (e.faseNome !== f ? '' : `<button type="button" class="mesa-passo ${e.estado}${i === st.vendo ? ' vendo' : ''}" data-acao="etapa" data-i="${i}" ${e.estado === 'atual' ? 'aria-current="step"' : ''}><span class="n">${e.estado === 'feito' ? I.ok : i + 1}</span>${esc(e.nome)}</button>`)).join('')}
        </div></div>`).join('');
    }

    function renderAgora() {
      const { caso: c, etapas } = st.d;
      if (c.production_stage === 'recusado') {
        q('.mesa-agora').innerHTML = `<div class="mesa-agora-txt"><strong class="mesa-recusado">Caso recusado${c.rejected_at ? ' em ' + fmtDate(c.rejected_at) : ''}</strong><p>Fica travado até alguém reverter a recusa. A peça e os documentos continuam aqui para consulta.</p></div><button type="button" class="mesa-btn" data-acao="reverter">Reverter a recusa</button>`;
        return;
      }
      const e = etapas[st.vendo];
      const rot = { atual: 'Agora', feito: 'Feito', depois: 'Depois' }[e.estado];
      q('.mesa-agora').innerHTML = `
        <div class="mesa-agora-txt"><strong>${rot} · Etapa ${st.vendo + 1} de ${etapas.length} · ${esc(e.nome)}</strong><p>${esc(e.fazer)}</p></div>
        ${e.criterios.length ? `<div class="mesa-pronto"><span class="mesa-rotulo">Pronto para avançar quando</span>
          ${e.criterios.map((k) => { const ok = e.estado === 'feito' || k.ok; return `<span class="mesa-crit${ok ? ' ok' : ''}">${ok ? I.ok : I.falta}${esc(k.txt)}</span>`; }).join('')}</div>` : ''}`;
    }

    // ── coluna da esquerda: o caso ─────────────────────────────────────────
    async function renderEsq() {
      const { caso: c, partes, checklist } = st.d;
      const contrarias = partes.filter((p) => p.papel === 'contraria');
      let labels = []; try { labels = Array.isArray(st.prod?.production_labels) ? st.prod.production_labels : (st.prod?.production_labels ? JSON.parse(st.prod.production_labels) : []); } catch {}
      if (podeAtribuir && !st.usuarios) st.usuarios = (await api('/api/users').catch(() => [])).filter((u) => ['estagiario', 'parceiro', 'advogado', 'admin'].includes(u.role) && u.active);
      const ck = checklist && checklist.total ? checklist : null;
      q('.mesa-rail-esq').innerHTML = `
        <section class="mesa-bloco"><h2>Partes</h2>
          <div class="mesa-parte"><b>${esc(c.client_name || '—')}</b><small>Cliente</small></div>
          ${contrarias.length ? contrarias.map((p) => `<div class="mesa-parte"><b>${esc(p.nome)}</b><small>Parte contrária${p.cpf_cnpj ? ' · ' + esc(p.cpf_cnpj) : ' · CPF/CNPJ a cadastrar'}</small></div>`).join('')
            : '<p class="mesa-vazio">Nenhuma parte contrária cadastrada. Sem ela, a peça não junta os casos contra a mesma empresa.</p>'}
          <div class="mesa-acoes"><button type="button" class="mesa-btn mesa-btn-sm" data-acao="partes">Editar partes</button><button type="button" class="mesa-btn mesa-btn-sm" data-acao="ficha">Ficha completa</button></div>
        </section>
        <section class="mesa-bloco"><h2>Valores e datas</h2>
          <div class="mesa-linha"><span>Valor da causa</span><b>${Number(c.valor_causa) ? money(c.valor_causa) : '—'}</b></div>
          <div class="mesa-linha"><span>Prescrição</span><b${c.prescricao_data ? ' class="mesa-alerta"' : ''}>${c.prescricao_data ? fmtDate(c.prescricao_data) : 'não informada'}</b></div>
          ${c.case_number ? `<div class="mesa-linha"><span>Nº do processo</span><b>${esc(c.case_number)}</b></div>` : ''}
          <div class="mesa-acoes"><button type="button" class="mesa-btn mesa-btn-sm" data-acao="valor-causa">Editar valor da causa</button><button type="button" class="mesa-btn mesa-btn-sm" data-acao="processo">Prazos e movimentações</button></div>
        </section>
        <section class="mesa-bloco"><h2>Documentos</h2>
          ${ck ? `<div class="mesa-prog" role="img" aria-label="${ck.completos} de ${ck.total} documentos"><span style="width:${Math.round((ck.completos / ck.total) * 100)}%"></span></div>
            <div class="mesa-linha"><span>Checklist</span><b>${ck.completos} de ${ck.total}</b></div>` : ''}
          <div class="mesa-linha"><span>No caso</span><b>${st.d.documentos.length}</b></div>
          ${st.d.rascunhosPendentes ? `<div class="mesa-linha"><span>Mensagens ao cliente</span><b class="mesa-alerta">${st.d.rascunhosPendentes} para aprovar</b></div>` : ''}
          <div class="mesa-acoes"><button type="button" class="mesa-btn mesa-btn-sm" data-acao="aba" data-aba="docs">Ver documentos e coleta</button></div>
        </section>
        <section class="mesa-bloco"><h2>Organização</h2>
          ${podeAtribuir ? `<label class="mesa-campo-rot" for="mesa-resp">Responsável</label><select id="mesa-resp" data-salvar="resp"><option value="">Sem responsável</option>${(st.usuarios || []).map((u) => `<option value="${u.id}" ${u.id == c.production_assignee ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>`
            : `<div class="mesa-linha"><span>Responsável</span><b>${esc(c.assignee_name || '—')}</b></div>`}
          <span class="mesa-campo-rot">Etiquetas</span>
          <div class="mesa-tags">${labels.length ? labels.map((l, i) => `<span class="mesa-tag">${esc(l)}<button type="button" data-acao="rm-label" data-i="${i}" aria-label="Tirar a etiqueta ${esc(l)}">×</button></span>`).join('') : '<span class="mesa-vazio">nenhuma</span>'}</div>
          <div class="mesa-campo"><input id="mesa-nova-label" type="text" placeholder="Nova etiqueta" aria-label="Nova etiqueta"><button type="button" class="mesa-btn mesa-btn-sm" data-acao="add-label">Adicionar</button></div>
        </section>`;
    }

    // ── coluna da direita: pendências e linha do tempo ─────────────────────
    function renderDir() {
      const notas = (st.prod && st.prod.notes) || [];
      const pend = notas.filter((n) => n.kind === 'pendencia' && !n.resolved);
      const KIND = { observacao: 'Observação', pendencia: 'Pendência resolvida', atualizacao: 'Atualização' };
      const eventos = [
        ...((st.prod && st.prod.journey) || []).map((j) => ({ quando: j.created_at, quem: j.actor_name || 'Sistema', texto: (j.title ? j.title + (j.description ? ': ' + j.description : '') : j.description) || j.event_type })),
        ...notas.filter((n) => !(n.kind === 'pendencia' && !n.resolved)).map((n) => ({ quando: n.created_at, quem: n.author_name || KIND[n.kind] || 'Equipe', texto: n.text })),
      ].sort((a, b) => new Date(b.quando) - new Date(a.quando)).slice(0, 80);
      let dia = '';
      const tempo = eventos.map((e) => {
        const d = fmtDate(e.quando); const cab = d !== dia ? `<span class="mesa-dia">${d === fmtDate(new Date()) ? 'Hoje' : d}</span>` : ''; dia = d;
        return `${cab}<div class="mesa-ev"><time>${hora(e.quando)}</time><div><b>${esc(e.quem)}</b> ${esc(e.texto)}</div></div>`;
      }).join('');
      q('.mesa-rail-dir').innerHTML = `
        <section class="mesa-bloco"><h2>Pendências · ${pend.length}</h2>
          ${pend.length ? pend.map((n) => `<div class="mesa-pend">${I.alerta}<div>${esc(n.text)}<small>${esc(n.author_name || '')} · ${fmtDate(n.created_at)}</small></div><button type="button" class="mesa-btn mesa-btn-sm" data-acao="resolver" data-id="${n.id}">Resolver</button></div>`).join('')
            : '<p class="mesa-vazio">Nada pendente. O prazo corre normalmente.</p>'}
          <div class="mesa-campo"><input id="mesa-nova-pend" type="text" placeholder="O que falta?" aria-label="Nova pendência"><button type="button" class="mesa-btn mesa-btn-sm" data-acao="add-pend">Adicionar</button></div>
          <p class="mesa-dica">Pendência aberta pausa o prazo e, em caso de parceria, avisa o parceiro.</p>
        </section>
        <section class="mesa-bloco"><h2>Recado no portal do cliente</h2>
          <textarea id="mesa-recado" rows="3" data-salvar="recado" aria-label="Recado ao cliente" placeholder="Ex.: Sua petição está sendo finalizada.">${esc(st.prod?.client_message || '')}</textarea>
          <label class="mesa-campo-rot" for="mesa-obs">Observação no card do quadro</label>
          <textarea id="mesa-obs" rows="2" data-salvar="obs" placeholder="Ex.: cliente pediu urgência">${esc(st.prod?.production_obs || '')}</textarea>
          <p class="mesa-dica">Salva sozinho ao sair do campo.</p>
        </section>
        <section class="mesa-bloco"><h2>Linha do tempo</h2>
          <div class="mesa-campo" style="margin:0 0 8px"><input id="mesa-atualizacao" type="text" placeholder="Escrever uma atualização" aria-label="Nova atualização"><button type="button" class="mesa-btn mesa-btn-sm" data-acao="registrar">Registrar</button></div>
          <div class="mesa-tempo">${tempo || '<p class="mesa-vazio">Sem registros ainda.</p>'}</div>
        </section>`;
    }

    // ── centro ──────────────────────────────────────────────────────────────
    function renderCentro() {
      const { pecas, documentos, revisao } = st.d;
      const aba = (k, t, extra) => `<button type="button" role="tab" class="mesa-aba${st.aba === k ? ' on' : ''}" aria-selected="${st.aba === k}" data-acao="aba" data-aba="${k}">${t}${extra ? `<span class="mesa-cont">${extra}</span>` : ''}</button>`;
      q('.mesa-centro').innerHTML = `
        <div class="mesa-abas" role="tablist" aria-label="Conteúdo do caso">
          ${aba('caso', 'Caso', st.d.analise && st.d.analise.graves ? `${st.d.analise.graves} ${st.d.analise.graves === 1 ? 'ponto grave' : 'pontos graves'}` : '')}${aba('docs', 'Documentos', documentos.length)}${aba('peca', 'Peça', pecas.length ? `${pecas.length} ${pecas.length === 1 ? 'versão' : 'versões'}` : '')}${aba('rev', 'Revisão', revisao ? '' : '')}${aba('calc', 'Cálculos')}${aba('dossie', 'Dossiê da peça')}
        </div>
        <div class="mesa-painel" role="tabpanel"></div>`;
      const p = q('.mesa-painel');
      if (st.aba === 'peca') renderPeca(p);
      else if (st.aba === 'caso') renderCaso(p);
      else if (st.aba === 'dossie') renderLeitura(p, st.d.dossie, 'O dossiê aparece quando a equipe montar a petição: fontes lidas, cálculos e o motivo do modelo escolhido.');
      else if (st.aba === 'rev') renderRevisao(p);
      else if (st.aba === 'calc') renderCalculos(p);
      else renderDocs(p);
    }

    function pecaAtual() { return st.d.pecas.find((x) => x.id === st.docId) || null; }

    function renderVersoes() {
      const box = q('.mesa-versoes'); if (!box) return;
      const p = pecaAtual();
      box.innerHTML = `
        <div class="mesa-seg" role="group" aria-label="Versões da petição">
          ${st.d.pecas.map((x) => `<button type="button" class="${x.id === st.docId ? 'on' : ''}" data-acao="versao" data-doc="${x.id}" aria-pressed="${x.id === st.docId}">v${x.versao} · ${x.origem === 'dra' ? 'sua edição' : 'equipe'}<small>${x.final_em ? 'versão final' : fmtDate(x.updated_at || x.created_at)}</small></button>`).join('')}
        </div>
        ${p && p.origem === 'dra' ? `<button type="button" class="mesa-btn mesa-btn-sm" data-acao="comparar">${st.comparar ? 'Voltar ao texto' : 'Comparar com a versão da equipe'}</button>` : ''}
        ${p && p.final_em ? '<span class="mesa-tag mesa-tag-ok">Versão final · travada</span>' : ''}
        ${st.d.revisao && !st.comparar ? `<button type="button" class="mesa-btn mesa-btn-sm${st.aoLado ? ' mesa-ligado' : ''}" data-acao="ao-lado" aria-pressed="${st.aoLado}">${st.aoLado ? 'Esconder o parecer' : 'Parecer da revisão ao lado'}</button>` : ''}
        <span class="mesa-espaco"></span>
        <button type="button" class="mesa-btn mesa-btn-sm" data-acao="nova-versao" title="A equipe lê tudo de novo e monta outra versão"${st.d.gerandoPeca ? ' disabled' : ''}>${st.d.gerandoPeca ? 'Gerando a nova versão…' : 'Pedir nova versão à equipe'}</button>
        ${p ? `<button type="button" class="mesa-btn mesa-btn-sm" data-acao="final">${p.final_em ? 'Destravar para editar' : 'Marcar como versão final'}</button>` : ''}`;
    }

    async function renderPeca(box) {
      if (!st.d.pecas.length) {
        const cedo = ['em_analise', 'separacao_documentos'].includes(st.d.caso.production_stage);
        box.innerHTML = `<div class="mesa-vazio-grande"><h3>A petição ainda não foi montada</h3>
          <p>${cedo ? 'A equipe monta a petição sozinha quando o caso entra em Criação inicial: lê os documentos e a conversa, calcula os valores e escolhe o modelo do cofre.' : 'A equipe ainda não entregou a petição deste caso.'}</p>
          <button type="button" class="mesa-btn mesa-btn-pri" data-acao="nova-versao">Pedir à equipe para montar agora</button></div>`;
        return;
      }
      const p = pecaAtual();
      const travada = !!(p && p.final_em);
      box.innerHTML = `<div class="mesa-versoes"></div><div class="mesa-trabalho"></div>`;
      renderVersoes();
      const area = q('.mesa-trabalho');
      if (st.comparar && p && p.origem === 'dra') { renderComparar(area, p); return; }
      area.innerHTML = `
        <div class="mesa-ferr" role="toolbar" aria-label="Formatação da peça">
          <select class="mesa-estilo" aria-label="Estilo do parágrafo" ${travada ? 'disabled' : ''}><option value="p">Parágrafo</option><option value="h3">Título de seção</option><option value="blockquote">Citação</option></select>
          <span class="mesa-fsep"></span>
          <button type="button" class="mesa-fb" data-acao="fmt" data-cmd="bold" aria-label="Negrito" title="Negrito (Ctrl+B)"><b>N</b></button>
          <button type="button" class="mesa-fb" data-acao="fmt" data-cmd="italic" aria-label="Itálico" title="Itálico (Ctrl+I)"><i>I</i></button>
          <button type="button" class="mesa-fb" data-acao="fmt" data-cmd="underline" aria-label="Sublinhado" title="Sublinhado (Ctrl+U)"><u>S</u></button>
          <span class="mesa-fsep"></span>
          <button type="button" class="mesa-fb" data-acao="fmt" data-cmd="justifyLeft" aria-label="Alinhar à esquerda">${I.esq}</button>
          <button type="button" class="mesa-fb" data-acao="fmt" data-cmd="justifyCenter" aria-label="Centralizar">${I.cen}</button>
          <button type="button" class="mesa-fb" data-acao="fmt" data-cmd="justifyFull" aria-label="Justificar">${I.jus}</button>
          <span class="mesa-fsep"></span>
          <button type="button" class="mesa-fb" data-acao="fmt" data-cmd="insertOrderedList" aria-label="Lista numerada">${I.num}</button>
          <button type="button" class="mesa-fb" data-acao="fmt" data-cmd="insertUnorderedList" aria-label="Lista com marcadores">${I.lista}</button>
          <button type="button" class="mesa-fb" data-acao="fmt" data-cmd="indent" aria-label="Aumentar recuo">${I.recuo}</button>
          <button type="button" class="mesa-fb" data-acao="fmt" data-cmd="outdent" aria-label="Diminuir recuo">${I.tirarRecuo}</button>
          <span class="mesa-fsep"></span>
          <button type="button" class="mesa-fb" data-acao="fmt" data-cmd="undo" aria-label="Desfazer" title="Desfazer (Ctrl+Z)">${I.desfazer}</button>
          <button type="button" class="mesa-fb" data-acao="fmt" data-cmd="redo" aria-label="Refazer" title="Refazer (Ctrl+Y)">${I.refazer}</button>
          <span class="mesa-campos"><span class="mesa-campos-n"></span><button type="button" class="mesa-btn mesa-btn-sm" data-acao="proximo">Próximo</button></span>
        </div>
        ${p && p.origem === 'equipe' && !travada ? '<p class="mesa-aviso-versao">Esta é a versão da equipe. Ao editar, o CRM cria a sua versão e esta fica intacta para a equipe comparar e aprender.</p>' : ''}
        ${travada ? '<p class="mesa-aviso-versao">Versão final travada. Para mudar, clique em "Destravar para editar".</p>' : ''}
        <div class="${st.aoLado && st.d.revisao ? 'mesa-lado' : ''}">
          <div class="mesa-fundo"><div class="mesa-papel" ${travada ? 'contenteditable="false"' : 'contenteditable="true"'} spellcheck="true" lang="pt-BR" role="textbox" aria-multiline="true" aria-label="Texto da petição"><p class="mesa-carregando-txt">Carregando a peça…</p></div></div>
          ${st.aoLado && st.d.revisao ? `<aside class="mesa-parecer" aria-label="Parecer da revisão"><div class="mesa-parecer-cab"><strong>Parecer da revisão</strong><span>${fmtDate(st.d.revisao.created_at)} às ${hora(st.d.revisao.created_at)}</span><button type="button" class="mesa-btn mesa-btn-sm" data-acao="revisar">Revisar de novo</button></div><article class="mesa-leitura"><p class="mesa-vazio">Carregando o parecer…</p></article></aside>` : ''}
        </div>
        <div class="mesa-rodape">
          <span class="mesa-status" aria-live="polite"></span>
          <button type="button" class="mesa-btn mesa-btn-sm" data-acao="copiar-texto">Copiar sem formatação</button>
          <button type="button" class="mesa-btn mesa-btn-pri" data-acao="copiar-jus">Copiar para o Jusbrasil</button>
        </div>`;
      const papel = q('.mesa-papel');
      const parecer = q('.mesa-parecer .mesa-leitura');
      if (parecer) api(`/api/mesa/documento/${st.d.revisao.id}`).then((r) => { parecer.innerHTML = r.html; }).catch((e) => { parecer.innerHTML = `<p class="mesa-vazio">${esc(e.message)}</p>`; });
      try {
        st.doc = await api(`/api/mesa/documento/${st.docId}`);
        if (!q('.mesa-papel') || q('.mesa-papel') !== papel) return;
        papel.innerHTML = st.doc.html || '<p><br></p>';
        marcarColchetes(papel);
        atualizarCampos(); status(st.sujo ? 'Alterações não salvas' : (p.origem === 'dra' ? `Salvo em ${fmtDate(p.updated_at)} às ${hora(p.updated_at)}` : 'Versão da equipe'));
      } catch (e) { papel.innerHTML = `<p>Não foi possível abrir a peça: ${esc(e.message)}</p>`; return; }
      q('.mesa-estilo').onchange = (e) => { papel.focus(); document.execCommand('formatBlock', false, e.target.value); e.target.value = 'p'; aoEditar(); };
      papel.addEventListener('input', aoEditar);
      papel.addEventListener('paste', (e) => {
        const cd = e.clipboardData; if (!cd) return;
        e.preventDefault();
        const html = cd.getData('text/html');
        if (html) document.execCommand('insertHTML', false, limparColagem(html));
        else document.execCommand('insertText', false, cd.getData('text/plain'));
      });
      papel.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); clearTimeout(st.timer); salvar(); }
      });
    }

    function status(txt, erro) { const s = q('.mesa-status'); if (s) { s.textContent = txt; s.classList.toggle('erro', !!erro); } }
    function atualizarCampos() {
      const papel = q('.mesa-papel'); const n = papel ? contar(papel.innerText) : 0;
      const b = q('.mesa-campos'); if (!b) return;
      b.classList.toggle('zero', !n);
      q('.mesa-campos-n').textContent = n ? `${n} ${n === 1 ? 'campo' : 'campos'} a preencher` : 'Nenhum campo a preencher';
      b.querySelector('button').disabled = !n;
    }
    function aoEditar() {
      st.sujo = true; status('Alterações não salvas…'); atualizarCampos();
      clearTimeout(st.timer); st.timer = setTimeout(salvar, 1500);
    }
    async function salvar() {
      const papel = q('.mesa-papel');
      if (!st.sujo || !papel || !st.docId) return;
      if (st.salvando) { st.deNovo = true; return; }
      st.salvando = true; st.sujo = false; status('Salvando…');
      try {
        const r = await api(`/api/mesa/documento/${st.docId}/edicao`, { method: 'POST', body: JSON.stringify({ html: htmlLimpo(papel) }) });
        st.mudou = true;
        if (r.id !== st.docId) {
          st.docId = r.id; await carregar(); st.doc = { ...(st.doc || {}), id: r.id };
          renderVersoes(); renderAgora(); renderDir();
          const av = q('.mesa-aviso-versao'); if (av) av.remove();
          if (r.criada) toast('A sua versão foi criada. A versão da equipe ficou intacta para comparar.');
        }
        status(`Salvo às ${hora(r.salvo_em || new Date())}`);
      } catch (e) {
        st.sujo = true; status(`Não salvou (${e.message}). Tento de novo na próxima alteração; Ctrl+S salva agora.`, true);
      } finally {
        st.salvando = false;
        if (st.deNovo) { st.deNovo = false; salvar(); }
      }
    }

    async function renderComparar(box, p) {
      box.innerHTML = '<div class="mesa-carregando"><div class="spinner"></div><span>Comparando as versões…</span></div>';
      let r;
      try { r = await api(`/api/mesa/documento/${p.id}/comparar`); } catch (e) { box.innerHTML = `<p class="mesa-vazio">${esc(e.message)}</p>`; return; }
      const seg = (s, lado) => s.map((x) => (x.tipo === 'igual' ? esc(x.t) : lado === 'esq' ? `<del class="mesa-saiu">${esc(x.t)}</del>` : `<ins class="mesa-entrou">${esc(x.t)}</ins>`)).join('').replace(/\n/g, '<br>');
      const licoes = st.d.licoes.filter((l) => l.document_id === p.id);
      const base = st.d.pecas.find((x) => x.id === p.versao_de);
      box.innerHTML = `
        <div class="mesa-cmp-cab"><span>${r.pares.length ? `${r.pares.length} ${r.pares.length === 1 ? 'trecho mudou' : 'trechos mudaram'} · ${r.iguais} ${r.iguais === 1 ? 'parágrafo igual' : 'parágrafos iguais'} não aparecem` : 'As duas versões estão iguais.'}</span>
          <span class="mesa-legenda"><del class="mesa-saiu">saiu</del> <ins class="mesa-entrou">entrou</ins></span></div>
        ${r.pares.length ? `<div class="mesa-cmp"><div class="mesa-cmp-tit">v${base ? base.versao : '?'} · equipe</div><div class="mesa-cmp-tit">v${p.versao} · sua edição</div>
          ${r.pares.map((x) => `<div class="mesa-cmp-col">${seg(x.esq, 'esq') || '<span class="mesa-vazio">(nada)</span>'}</div><div class="mesa-cmp-col">${seg(x.dir, 'dir') || '<span class="mesa-vazio">(removido)</span>'}</div>`).join('')}</div>` : ''}
        <section class="mesa-aprende">
          <div class="mesa-aprende-cab"><div><h3>O que a equipe aprende com a sua versão</h3>
            <p>O redator e a Laya comparam as versões e anotam onde a da equipe errou. Regra aprovada vale para as próximas peças de ${esc(area(st.d.caso.legal_area) || 'mesma área')}; "Só neste caso" fica só aqui.</p></div>
            <span class="mesa-tag mesa-tag-azul">${st.d.regrasDaArea} ${st.d.regrasDaArea === 1 ? 'regra aprendida' : 'regras aprendidas'} na área</span></div>
          ${licoes.length ? licoes.map((l) => `<div class="mesa-licao"><div class="mesa-licao-txt"><strong>${esc(l.titulo)}</strong><p>${esc(l.mudou)}</p><div class="mesa-regra"><span>Regra proposta</span>${esc(l.regra)}</div></div>
              <div class="mesa-acoes">${l.decisao === 'pendente'
                ? `<button type="button" class="mesa-btn mesa-btn-sm mesa-btn-pri" data-acao="licao" data-id="${l.id}" data-decisao="regra">Aprovar como regra</button><button type="button" class="mesa-btn mesa-btn-sm" data-acao="licao" data-id="${l.id}" data-decisao="caso">Só neste caso</button>`
                : `<span class="mesa-tag ${l.decisao === 'regra' ? 'mesa-tag-ok' : ''}">${l.decisao === 'regra' ? 'Regra aprovada' : 'Só neste caso'}</span><button type="button" class="mesa-btn mesa-btn-sm" data-acao="licao" data-id="${l.id}" data-decisao="pendente">Desfazer</button>`}</div></div>`).join('')
            : `<p class="mesa-vazio">${r.pares.length ? 'A equipe ainda não comparou esta versão. Ela compara sozinha quando você marca a versão final, ou agora:' : 'Sem diferenças, nada a aprender.'}</p>`}
          ${r.pares.length ? `<div><button type="button" class="mesa-btn mesa-btn-sm" data-acao="aprender">${licoes.length ? 'Comparar de novo' : 'Pedir à equipe para comparar agora'}</button></div>` : ''}
        </section>`;
    }

    async function renderLeitura(box, ref, vazio, extra) {
      if (!ref) { box.innerHTML = `<div class="mesa-vazio-grande"><p>${esc(vazio)}</p>${extra || ''}</div>`; return; }
      box.innerHTML = '<div class="mesa-carregando"><div class="spinner"></div></div>';
      try {
        const d = await api(`/api/mesa/documento/${ref.id}`);
        box.innerHTML = `<div class="mesa-leitura-cab"><span>${esc(d.name)} · ${fmtDate(ref.created_at)} às ${hora(ref.created_at)}</span>${extra || ''}</div><article class="mesa-leitura">${d.html}</article>`;
      } catch (e) { box.innerHTML = `<p class="mesa-vazio">${esc(e.message)}</p>`; }
    }
    function renderCalculos(box) {
      const pl = st.d.planilha, dm = st.d.demonstrativo;
      const baixar = (dm && dm.tem_arquivo ? '<button type="button" class="mesa-btn mesa-btn-sm" data-acao="baixar-demonstrativo">Baixar demonstrativo de descontos (PDF)</button>' : '')
        + (pl && pl.tem_arquivo ? '<button type="button" class="mesa-btn mesa-btn-sm" data-acao="baixar-planilha">Baixar planilha (.xlsx)</button>' : '');
      renderLeitura(box, pl || dm, 'A planilha aparece quando a equipe montar a petição: o Calculista pega os descontos lidos nos extratos, aplica a devolução simples ou em dobro, a correção monetária e os juros de mora, mês a mês.', baixar);
    }
    function renderRevisao(box) {
      const botao = '<button type="button" class="mesa-btn mesa-btn-sm" data-acao="revisar">Revisar de novo agora</button>';
      renderLeitura(box, st.d.revisao, 'A revisão automática roda logo depois que a equipe monta a petição e quando o caso entra em Revisão inicial.', botao);
    }
    // ── aba Caso: relato, análise da Dra. Helena e, depois do protocolo, o resumo ──
    function renderCaso(box) {
      const { caso: c, analise, pecas, documentos } = st.d;
      const final = pecas.find((p) => p.final_em) || null;
      const protocolado = ['protocolado', 'concluido'].includes(c.production_stage) || !!c.case_number;
      const relatoDoc = documentos.find((d) => /^Relato do cliente/i.test(d.name));
      const NIVEL = { grave: ['mesa-tag mesa-tag-grave', 'Grave'], atencao: ['mesa-tag mesa-tag-atencao', 'Atenção'] };
      box.innerHTML = `<div class="mesa-secoes">
        ${c.production_stage === 'recusado' ? `<section class="mesa-secao"><h3>Motivo da recusa</h3><p class="mesa-relato">${esc(c.rejection_reason || '—')}</p></section>` : ''}
        ${protocolado ? `<section class="mesa-secao"><h3>Protocolo</h3>
          <dl class="mesa-dados">
            <div><dt>Nº do processo</dt><dd>${c.case_number ? esc(c.case_number) : 'não informado'}</dd></div>
            <div><dt>Protocolado em</dt><dd>${c.protocoled_at ? fmtDate(c.protocoled_at) : '—'}</dd></div>
            <div><dt>Versão protocolada</dt><dd>${final ? `v${final.versao} · ${final.origem === 'dra' ? 'sua edição' : 'equipe'}` : 'nenhuma marcada como final'}</dd></div>
            <div><dt>Valor da causa</dt><dd>${Number(c.valor_causa) ? money(c.valor_causa) : '—'}</dd></div>
            <div><dt>Acompanhamento nos tribunais</dt><dd>${st.d.monitorado ? 'ativo' : 'ainda não'}</dd></div>
          </dl>
          <div class="mesa-acoes">${final ? `<button type="button" class="mesa-btn mesa-btn-sm" data-acao="ver-final" data-doc="${final.id}">Abrir a versão protocolada</button>` : ''}<button type="button" class="mesa-btn mesa-btn-sm" data-acao="processo">Prazos e movimentações</button></div>
          <p class="mesa-dica">Depois do protocolo, o processo segue em Prazos e movimentações; a produção termina aqui.</p>
        </section>` : ''}
        ${c.unido_ao_caso ? `<div class="mesa-aviso mesa-aviso-azul"><span>Este pedido faz parte do processo do caso #${c.unido_ao_caso}: a peça, o prazo e o protocolo são de lá.</span><button type="button" class="mesa-btn mesa-btn-sm" data-acao="abrir-caso" data-id="${c.unido_ao_caso}">Abrir o processo</button></div>` : ''}
        ${st.d.grupo ? `<section class="mesa-secao"><h3>Pedidos neste processo · ${st.d.grupo.casos.length}</h3>
          <p class="mesa-dica">Mesmo banco e mesma tese: uma peça só e um protocolo só.</p>
          ${st.d.grupo.casos.map((x) => `<div class="mesa-doc"><div class="mesa-doc-nome">#${x.id} — ${esc(x.title || 'sem título')}<small>${x.familia ? esc(x.familia) : 'tese não identificada'}${x.id === st.d.grupo.principal ? ' · card do processo' : ''}</small></div>
            ${x.id !== st.d.grupo.principal ? `<button type="button" class="mesa-btn mesa-btn-sm" data-acao="separar" data-id="${x.id}">Separar</button>` : ''}</div>`).join('')}
        </section>` : ''}
        <section class="mesa-secao"><h3>Relato do cliente</h3>
          ${c.relato ? `<p class="mesa-relato">${esc(c.relato)}</p>` : '<p class="mesa-vazio">Sem resumo do atendimento cadastrado.</p>'}
          ${relatoDoc ? `<div class="mesa-relato-doc"><span class="mesa-rotulo">Relato escrito pela Dra. Camila a partir do WhatsApp</span><article class="mesa-leitura mesa-relato-txt"><p class="mesa-vazio">Carregando…</p></article></div>` : ''}
        </section>
        <section class="mesa-secao"><div class="mesa-secao-cab"><h3>Análise dos documentos · Dra. Helena</h3><button type="button" class="mesa-btn mesa-btn-sm" data-acao="analisar">${analise ? 'Analisar de novo' : 'Pedir a análise agora'}</button></div>
          ${analise ? `<p class="mesa-dica">${analise.documentos} ${analise.documentos === 1 ? 'documento lido' : 'documentos lidos'} em ${fmtDate(analise.created_at)} · ${analise.graves} ${analise.graves === 1 ? 'ponto grave' : 'pontos graves'} · ${analise.atencao} de atenção</p>
            ${analise.achados.length ? `<ul class="mesa-achados">${analise.achados.map((a) => { const n = NIVEL[a.nivel]; return `<li class="mesa-achado"><span class="${n ? n[0] : 'mesa-tag'}">${n ? n[1] : 'Informação'}</span><div>${a.tema ? `<b>${esc(a.tema)}:</b> ` : ''}${esc(a.texto)}${a.fontes && a.fontes.length ? `<small>Fonte: ${esc(a.fontes.join(', '))}</small>` : ''}</div></li>`; }).join('')}</ul>`
              : '<p class="mesa-vazio">Nada fora do lugar: os documentos batem com a história contada.</p>'}`
            : '<p class="mesa-vazio">A Dra. Helena confere cada documento contra a história contada: nome, CPF, datas, valores, documento ilegível ou cortado. Ela roda sozinha quando os documentos ficam completos.</p>'}
        </section>
        <section class="mesa-secao mesa-contratos" aria-live="polite"><div class="mesa-secao-cab"><h3>Contratos nos documentos</h3></div><p class="mesa-vazio">Carregando…</p></section>
      </div>`;
      const alvo = box.querySelector('.mesa-relato-txt');
      if (alvo) api(`/api/mesa/documento/${relatoDoc.id}`).then((r) => { alvo.innerHTML = r.html; }).catch((e) => { alvo.innerHTML = `<p class="mesa-vazio">${esc(e.message)}</p>`; });
      renderContratos(box.querySelector('.mesa-contratos'));
    }

    // Contratos lidos nos documentos (todos os bancos) e em qual processo cada um entra.
    // Sem escolha, vale a regra: só o banco do réu e a mesma tese (services/contratosDoCaso.ts).
    // Uma peça por banco (regra da Jessica, 30/10/2026): RMC de um banco e RCC de outro são peças diferentes.
    function conferenciaHtml(c) {
      if (!c || !c.lidos) return '';
      const problemas = c.problemas.filter((p) => p.tipo !== 'nao_lidos');
      const pecas = c.bancos.map((b) => `<li><b>${esc(b.banco)}</b>: ${esc(b.tipos.join(' e '))} → ${b.acoes.length ? b.acoes.map((id) => `processo #${id}`).join(', ') : '<b>sem processo</b>'}</li>`).join('');
      return `<div class="${problemas.length ? 'mesa-aviso' : 'mesa-dica'}" role="${problemas.length ? 'alert' : 'status'}"><b>Uma peça por banco</b> (cartões RMC/RCC nos extratos)
        <ul>${pecas}</ul>${problemas.length ? `<ul>${problemas.map((p) => `<li>${esc(p.texto)}</li>`).join('')}</ul>` : '<p>Conferido: cada banco tem a sua peça.</p>'}</div>`;
    }
    async function renderContratos(sec) {
      if (!sec) return;
      let inv;
      try { inv = await api(`/api/mesa/${caseId}/contratos`); } catch (e) { sec.innerHTML = `<h3>Contratos nos documentos</h3><p class="mesa-vazio">${esc(e.message)}</p>`; return; }
      const reus = inv.reus.length ? inv.reus.join(', ') : 'o réu do processo';
      const cab = `<div class="mesa-secao-cab"><h3>Contratos nos documentos${inv.total ? ` · ${inv.total}` : ''}</h3><button type="button" class="mesa-btn mesa-btn-sm" data-acao="ler-contratos">${inv.total ? 'Ler de novo' : 'Ler os contratos agora'}</button></div>`;
      if (!inv.total) {
        sec.innerHTML = `${cab}<p class="mesa-vazio">O extrato do INSS traz todos os contratos do cliente, de todos os bancos. Peça a leitura: a Dra. Helena lista cada contrato com o tipo (RMC, RCC, empréstimo) e o banco, e você diz em qual processo cada um entra.</p>`;
        return;
      }
      const opcoes = (l) => {
        const v = l.fora ? 'fora' : (l.case_id != null ? String(l.case_id) : 'auto');
        const o = (val, txt) => `<option value="${val}"${v === String(val) ? ' selected' : ''}>${esc(txt)}</option>`;
        return o('auto', 'Automático (banco e tese)')
          + inv.processos.map((p) => o(p.id, `${p.id === inv.principal ? 'Este processo' : 'Processo'} #${p.id} — ${p.title || 'sem título'}`)).join('')
          + o('fora', 'Fora de qualquer peça');
      };
      const detalhe = (l) => [l.data && `contratado em ${l.data}`, l.parcela != null && `parcela ${money(l.parcela)}`, l.valor_liberado != null && `liberado ${money(l.valor_liberado)}`, l.situacao, l.fonte && `fonte: ${l.fonte}`].filter(Boolean).join(' · ');
      sec.innerHTML = `${cab}
        <p class="mesa-dica">Na peça deste processo entram só os contratos de ${esc(reus)} da mesma tese, ou os que você escolher. Nesta peça: <b>${inv.entram} de ${inv.total}</b>.</p>
        ${inv.entram === 0 ? `<div class="mesa-aviso mesa-aviso-linha">Nenhum contrato de ${esc(reus)} nos documentos lidos. Confira o réu e os documentos antes de gerar a peça.</div>` : ''}
        ${conferenciaHtml(inv.conferencia)}
        ${inv.grupos.map((g) => `<div class="mesa-contratos-banco"><h4>${esc(g.banco)}${g.doReu ? ' <span class="mesa-tag mesa-tag-azul">réu deste processo</span>' : ''}</h4>
          ${g.contratos.map((l) => `<div class="mesa-doc"><div class="mesa-doc-nome"><b>${esc(l.nomeTipo)}</b> · nº ${esc(l.numero || 'sem número')}<small>${esc(detalhe(l))}</small>
            <span class="mesa-tag${l.entra ? ' mesa-tag-ok' : ''}">${l.entra ? 'Entra nesta peça' : 'Fora desta peça'}</span> <small class="mesa-contrato-motivo">${esc(l.motivo)}${l.origem === 'dra' ? '' : ' (automático)'}</small></div>
            <select class="mesa-estilo" data-contrato="${l.id}" aria-label="Processo do contrato ${esc(l.numero || l.nomeTipo)}">${opcoes(l)}</select></div>`).join('')}
        </div>`).join('')}
        <p class="mesa-dica">${inv.lidoEm ? `Última leitura em ${fmtDate(inv.lidoEm)}. ` : ''}Mudou o processo de algum contrato? Peça uma nova versão da peça para valer.</p>`;
    }
    async function mudarContrato(sel) {
      sel.disabled = true;
      try {
        await api(`/api/mesa/contrato/${sel.dataset.contrato}`, { method: 'PUT', body: JSON.stringify({ destino: sel.value }) });
        st.mudou = true; toast('Contrato associado. Peça uma nova versão da peça para valer.');
      } catch (e) { toast(e.message, 'error'); }
      renderContratos(q('.mesa-contratos'));
    }

    // ── aba Documentos: checklist, coleta da Dra. Camila, envio e lista ────────
    function renderDocs(box) {
      const { checklist, coleta, documentos: docs } = st.d;
      const ck = checklist && checklist.total ? checklist : null;
      const n = st.d.rascunhosPendentes;
      box.innerHTML = `<div class="mesa-secoes">
        ${n ? `<div class="mesa-aviso"><span>${n} ${n === 1 ? 'mensagem ao cliente espera' : 'mensagens ao cliente esperam'} a sua aprovação (pedidos e cobranças de documentos).</span><button type="button" class="mesa-btn mesa-btn-sm" data-acao="ir-aprovar">Abrir Mensagens para aprovar</button></div>` : ''}
        <section class="mesa-secao"><div class="mesa-secao-cab"><h3>${ck ? esc(ck.titulo || 'Checklist de documentos') : 'Checklist de documentos'}</h3>${ck ? `<span class="mesa-cont-grande">${ck.completos} de ${ck.total}</span>` : ''}</div>
          ${ck ? `<div class="mesa-prog" role="img" aria-label="${ck.completos} de ${ck.total} documentos"><span style="width:${Math.round((ck.completos / ck.total) * 100)}%"></span></div>
            <div class="mesa-ck-grade">${ck.itens.map((i) => `<button type="button" class="mesa-ck${i.done ? ' ok' : ''}" data-acao="ck" data-label="${esc(i.label)}" data-done="${i.done ? 1 : 0}" ${i.doc ? `disabled title="Encontrado: ${esc(i.doc)}"` : `aria-pressed="${i.done ? 'true' : 'false'}" title="${i.done ? 'Desmarcar' : 'Marcar como recebido'}"`}>${i.done ? I.ok : I.falta}<span>${esc(i.label)}${i.doc ? `<small>${esc(i.doc)}</small>` : ''}</span></button>`).join('')}</div>
            <p class="mesa-dica">Clique para marcar o que já está com você. Os que mostram o nome do arquivo foram encontrados sozinhos.</p>`
            : '<p class="mesa-vazio">Sem checklist para esta área.</p>'}
        </section>
        ${coleta ? `<section class="mesa-secao"><div class="mesa-secao-cab"><h3>Coleta com o cliente · Dra. Camila</h3><span class="mesa-tag${coleta.concluida ? ' mesa-tag-ok' : ''}">${coleta.concluida ? `completa em ${fmtDate(coleta.concluidoEm)}` : `${coleta.recebidos} de ${coleta.total} chegaram`}</span></div>
          <p class="mesa-dica">Pedido preparado em ${fmtDate(coleta.pedidoEm)}.${coleta.cobrancas.length ? ` Cobranças preparadas: ${coleta.cobrancas.map((x) => `${x.rotulo} (${fmtDate(x.em)})`).join(', ')}.` : ''} Nada sai ao cliente sem a sua aprovação.</p>
          <div class="mesa-ck-grade">${coleta.itens.map((i) => `<div class="mesa-ck${i.recebido ? ' ok' : ''}">${i.recebido ? I.ok : I.falta}<span>${esc(i.label)}</span></div>`).join('')}</div>
        </section>` : ''}
        <section class="mesa-secao"><h3>Enviar arquivos</h3>
          <label class="mesa-envio" for="mesa-arquivos">${I.enviar}<span><b>Escolha os arquivos</b> ou arraste para cá</span><small>PDF, foto ou Word, até 15 MB cada. A equipe lê os arquivos ao montar a peça.</small>
            <input id="mesa-arquivos" type="file" multiple accept=".pdf,image/*,.doc,.docx" data-arquivos></label>
          <label class="mesa-campo-rot" for="mesa-drive">Pasta do Drive</label>
          <div class="mesa-campo"><input id="mesa-drive" type="url" data-salvar="drive" placeholder="Cole o link da pasta" value="${esc(st.prod?.drive_folder_url || '')}"><button type="button" class="mesa-btn mesa-btn-sm" data-acao="ler-pasta" title="A pasta é lida sozinha a cada 30 minutos; use para puxar agora o que você acabou de pôr nela">Atualizar da pasta</button></div>
        </section>
        <section class="mesa-secao"><h3>Documentos do caso · ${docs.length}</h3>
          <div class="mesa-docs">${docs.length ? [...docs].reverse().map((d) => `
            <div class="mesa-doc"><div class="mesa-doc-nome">${esc(d.name)}<small>${esc(d.type || 'documento')} · ${fmtDate(d.created_at)}${d.case_id !== st.d.caso.id ? ` · caso #${d.case_id}` : ''}</small></div>
              ${Number(d.tem_texto) ? '<span class="mesa-tag mesa-tag-ok">lido pela equipe</span>' : (Number(d.tem_arquivo) || d.file_url ? '<span class="mesa-tag">arquivo</span>' : '')}
              <button type="button" class="mesa-btn mesa-btn-sm" data-acao="abrir-doc" data-id="${d.id}">Abrir</button>
              <button type="button" class="mesa-btn mesa-btn-sm${Number(d.visible_to_client) ? ' mesa-ligado' : ''}" data-acao="portal" data-id="${d.id}" data-on="${Number(d.visible_to_client) ? 1 : 0}" aria-pressed="${Number(d.visible_to_client) ? 'true' : 'false'}">${Number(d.visible_to_client) ? 'No portal do cliente' : 'Liberar no portal'}</button>
            </div>`).join('') : '<p class="mesa-vazio">Nenhum documento neste caso ainda. Envie acima, cole a pasta do Drive ou peça ao cliente pelo WhatsApp.</p>'}</div>
        </section>
      </div>`;
    }

    async function enviarArquivos(lista) {
      const arquivos = [...(lista || [])];
      if (!arquivos.length) return;
      if (!st.d.caso.client_id) { toast('O caso não tem cliente cadastrado; não dá para guardar arquivos.', 'error'); return; }
      const rot = q('.mesa-envio span');
      let ok = 0;
      for (let i = 0; i < arquivos.length; i++) {
        const f = arquivos[i];
        if (f.size > 15 * 1024 * 1024) { toast(`${f.name}: maior que 15 MB, não enviado`, 'error'); continue; }
        if (rot) rot.textContent = `Enviando ${i + 1} de ${arquivos.length}: ${f.name}…`;
        try {
          const base64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new Error('não consegui ler o arquivo')); r.readAsDataURL(f); });
          await api('/api/documents', { method: 'POST', body: JSON.stringify({ client_id: st.d.caso.client_id, case_id: caseId, name: f.name, type: 'anexo', folder: 'processos', status: 'recebido', file_base64: base64, mime: f.type || 'application/octet-stream' }) });
          ok++;
        } catch (e) { toast(`${f.name}: ${e.message}`, 'error'); }
      }
      if (ok) { st.mudou = true; toast(`${ok} ${ok === 1 ? 'arquivo enviado' : 'arquivos enviados'} para o caso`); }
      await recarregar(false); renderCentro();
    }

    function renderTudo() { renderTopo(); renderJornada(); renderAgora(); renderEsq(); renderDir(); renderCentro(); }
    // ── geração da peça: botão travado + barra de progresso até a versão chegar (30/10/2026) ──
    // Pedido da Jessica: "trave o botão depois do primeiro clique, até chegar a versão" e
    // "uma barra mostrando que a versão está sendo gerada". A etapa vem do servidor.
    const ger = { timer: null, el: null, antes: 0 };
    function decorrido(desde) {
      const s = Math.max(0, Math.round((Date.now() - new Date(desde).getTime()) / 1000)), m = Math.floor(s / 60);
      return m ? `${m} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
    }
    function barraGeracao(a) {
      const btn = q('[data-acao="nova-versao"]');
      if (btn) { btn.disabled = !!a; btn.textContent = a ? 'Gerando a nova versão…' : 'Pedir nova versão à equipe'; }
      if (!a) { if (ger.el) { ger.el.remove(); ger.el = null; } return; }
      if (!ger.el) { ger.el = document.createElement('div'); ger.el.className = 'mesa-gerando'; ger.el.setAttribute('role', 'status'); ov.appendChild(ger.el); }
      const pct = Math.min(97, Math.round(((a.passo - 0.5) / a.total) * 100));
      ger.el.innerHTML = `
        <div class="mesa-gerando-topo"><strong>Gerando a nova versão da peça</strong><span>${esc(decorrido(a.desde))}</span></div>
        <div class="mesa-gerando-barra" role="progressbar" aria-label="Andamento da geração" aria-valuemin="0" aria-valuemax="${a.total}" aria-valuenow="${a.passo}"><span style="width:${pct}%"></span></div>
        <div class="mesa-gerando-etapa">Etapa ${a.passo} de ${a.total}: ${esc(a.rotulo)}</div>
        <small>Leva cerca de 5 a 10 minutos. Pode continuar trabalhando; o botão fica travado até a versão chegar.</small>`;
    }
    async function verificarGeracao() {
      clearTimeout(ger.timer);
      if (!ov.isConnected) return;
      let s;
      try { s = await api(`/api/cases/${caseId}/peticao-inicial/status`); } catch { ger.timer = setTimeout(verificarGeracao, 8000); return; }
      if (!ov.isConnected) return;
      if (s.gerando) { st.d.gerandoPeca = s.andamento; barraGeracao(s.andamento); ger.timer = setTimeout(verificarGeracao, 4000); return; }
      const estava = !!st.d.gerandoPeca;
      st.d.gerandoPeca = null; barraGeracao(null);
      if (!estava) return;
      st.mudou = true;
      await recarregar(false); st.docId = null; await carregar(); st.doc = null; renderCentro();
      if (st.d.pecas.length > ger.antes) toast(`A nova versão chegou (v${st.d.pecas[st.d.pecas.length - 1].versao}).`);
      else toast('A geração terminou sem versão nova. Veja o motivo no sino.', 'error');
    }
    function acompanharGeracao(a) { ger.antes = st.d.pecas.length; st.d.gerandoPeca = a; barraGeracao(a); ger.timer = setTimeout(verificarGeracao, 3000); }

    async function recarregar(tudo) { await carregar(); if (tudo) renderTudo(); else { renderTopo(); renderJornada(); renderAgora(); renderDir(); renderEsq(); } }

    // ── ações ───────────────────────────────────────────────────────────────
    async function avancar() {
      const { etapas, atual } = st.d; const prox = etapas[atual + 1]; if (!prox) return;
      const body = { stage: prox.key };
      if (prox.key === 'protocolado') {
        const num = await uiPrompt('Número do processo (obrigatório para protocolar):');
        if (!num || !num.trim()) { toast('O número do processo é obrigatório', 'error'); return; }
        body.case_number = num.trim();
        const vc = await uiPrompt('Valor da causa (R$), só para registro do protocolo (deixe vazio para pular):');
        if (vc && vc.trim()) body.valor_causa = vc.trim();
      }
      if (st.sujo) await salvar();
      try {
        const r = await api(`/api/cases/${caseId}/production-stage`, { method: 'PATCH', body: JSON.stringify(body) });
        st.mudou = true;
        toast(prox.key === 'criacao_inicial' ? 'A equipe começou a montar a petição. Você será avisada no sino.' : prox.key === 'revisao_inicial' ? 'A revisão automática começou. Você será avisada no sino.' : `Caso em ${prox.nome}`);
        if (r && r.credentials && typeof showClientCredentials === 'function') showClientCredentials(r.credentials, r.case_number);
        st.vendo = null; await recarregar(true);
      } catch (e) {
        if (e.pendencias && Array.isArray(e.pendencias)) toast(`Resolva antes de avançar:\n${e.pendencias.join('\n')}`, 'error');
        else toast(e.message, 'error');
      }
    }
    function recusar() {
      const rf = el(`<form class="form-grid">
        <p style="font-size:13px;color:var(--text-muted)">O caso vai para a coluna Recusado e fica travado; só volta com "Reverter a recusa".</p>
        <label>Motivo da recusa *<textarea name="reason" rows="3" required></textarea></label>
        <label>Observações (opcional)<textarea name="notes" rows="3"></textarea></label>
        <button type="submit" class="btn-primary" style="background:var(--red,#c0392b);border-color:var(--red,#c0392b)">Recusar caso</button></form>`);
      rf.onsubmit = async (e) => {
        e.preventDefault();
        const reason = rf.querySelector('[name=reason]').value.trim(), notes = rf.querySelector('[name=notes]').value.trim();
        if (!reason) { toast('Informe o motivo da recusa', 'error'); return; }
        try { await api(`/api/cases/${caseId}/reject`, { method: 'POST', body: JSON.stringify({ reason, notes }) }); closeModal(); toast('Caso recusado'); st.mudou = true; await recarregar(true); }
        catch (err) { toast(err.message, 'error'); }
      };
      openModal('Recusar caso', rf);
    }
    function aoFecharModal(cb) {
      const m = document.querySelector('#modal'); if (!m) return;
      const obs = new MutationObserver(() => { if (m.classList.contains('hidden')) { obs.disconnect(); cb(); } });
      obs.observe(m, { attributes: true, attributeFilter: ['class'] });
    }
    async function copiarJus() {
      const papel = q('.mesa-papel'); if (!papel) return;
      const n = contar(papel.innerText);
      if (n && !await uiConfirm(`Ainda há ${n} ${n === 1 ? 'campo' : 'campos'} a preencher (em amarelo). Copiar assim mesmo?`)) return;
      if (st.sujo) { clearTimeout(st.timer); await salvar(); }
      const html = `<div style="font-family:'Times New Roman',Times,serif;font-size:12pt;line-height:1.5">${htmlLimpo(papel)}</div>`;
      const texto = papel.innerText;
      let ok = false;
      try {
        if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
          await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([texto], { type: 'text/plain' }) })]);
          ok = true;
        }
      } catch {}
      if (!ok) {
        const sel = window.getSelection(); const r = document.createRange(); r.selectNodeContents(papel);
        sel.removeAllRanges(); sel.addRange(r); try { ok = document.execCommand('copy'); } catch {} sel.removeAllRanges();
      }
      if (!ok) { toast('O navegador não deixou copiar. Selecione o texto (Ctrl+A) e copie (Ctrl+C).', 'error'); return; }
      toast('Copiada com a formatação. Cole no editor do Jusbrasil.');
      const p = pecaAtual();
      api(`/api/cases/${caseId}/production-notes`, { method: 'POST', body: JSON.stringify({ kind: 'atualizacao', text: `Petição copiada para o Jusbrasil (v${p ? p.versao : '?'}).` }) })
        .then(() => recarregar(false)).catch(() => {});
    }
    async function salvarCampo(tipo, valor) {
      const corpo = { drive: { drive_folder_url: valor }, recado: { client_message: valor }, obs: { production_obs: valor }, resp: { assignee: valor || null } }[tipo];
      if (!corpo) return;
      try {
        await api(`/api/cases/${caseId}/production-meta`, { method: 'PATCH', body: JSON.stringify(corpo) });
        st.mudou = true;
        toast({ drive: 'Pasta do Drive salva', recado: 'Recado salvo no portal do cliente', obs: 'Observação salva no card', resp: 'Responsável atualizado' }[tipo]);
        if (st.prod) Object.assign(st.prod, { drive: { drive_folder_url: valor }, recado: { client_message: valor }, obs: { production_obs: valor }, resp: { production_assignee: valor } }[tipo]);
      } catch (e) { toast(e.message, 'error'); }
    }

    const ACOES = {
      fechar: () => fechar(),
      avancar: () => avancar(),
      recusar: () => recusar(),
      reverter: async () => {
        if (!await uiConfirm('Reverter a recusa? O caso volta para a etapa em que estava.')) return;
        try { await api(`/api/cases/${caseId}/reject/revert`, { method: 'POST', body: '{}' }); st.mudou = true; st.vendo = null; await recarregar(true); toast('Recusa revertida'); }
        catch (e) { toast(e.message, 'error'); }
      },
      etapa: (b) => { st.vendo = Number(b.dataset.i); renderJornada(); renderAgora(); },
      aba: async (b) => { if (st.sujo) { clearTimeout(st.timer); await salvar(); } st.aba = b.dataset.aba; renderCentro(); },
      versao: async (b) => { if (st.sujo) { clearTimeout(st.timer); await salvar(); } st.docId = Number(b.dataset.doc); st.doc = null; st.comparar = false; renderCentro(); },
      comparar: async () => { if (st.sujo) { clearTimeout(st.timer); await salvar(); } st.comparar = !st.comparar; renderCentro(); },
      'ao-lado': async () => { if (st.sujo) { clearTimeout(st.timer); await salvar(); } st.aoLado = !st.aoLado; renderCentro(); },
      'abrir-caso': async (b) => { const outro = Number(b.dataset.id); await fechar(); mesaDoCaso(outro, aoMudar); },
      separar: async (b) => {
        if (!await uiConfirm(`Separar o pedido #${b.dataset.id}? Ele volta a ser um card próprio e terá peça e processo separados.`)) return;
        try { await api(`/api/mesa/${b.dataset.id}/separar`, { method: 'POST', body: '{}' }); st.mudou = true; toast('Pedido separado'); await recarregar(false); renderCentro(); }
        catch (e) { toast(e.message, 'error'); }
      },
      'ler-contratos': async (b) => {
        b.disabled = true;
        try { await api(`/api/mesa/${caseId}/contratos/levantar`, { method: 'POST', body: '{}' }); toast('A Dra. Helena está lendo os contratos. Você será avisada no sino.'); }
        catch (e) { toast(e.message, 'error'); b.disabled = false; }
      },
      'ver-final': (b) => { st.aba = 'peca'; st.docId = Number(b.dataset.doc); st.comparar = false; renderCentro(); },
      'ir-aprovar': async () => { await fechar(); location.hash = '#escritorio'; },
      analisar: async (b) => {
        b.disabled = true;
        try { await api(`/api/mesa/${caseId}/analisar`, { method: 'POST', body: '{}' }); toast('A Dra. Helena está lendo os documentos. Você será avisada no sino.'); }
        catch (e) { toast(e.message, 'error'); b.disabled = false; }
      },
      final: async () => {
        const p = pecaAtual(); if (!p) return;
        if (st.sujo) { clearTimeout(st.timer); await salvar(); }
        try {
          await api(`/api/mesa/documento/${p.id}/final`, { method: 'POST', body: JSON.stringify({ final: !p.final_em }) });
          st.mudou = true; toast(p.final_em ? 'Versão destravada para editar' : (p.origem === 'dra' ? 'Versão final marcada. A equipe vai comparar com a versão dela e anotar o que aprender.' : 'Versão final marcada'));
          await recarregar(false); st.doc = null; renderCentro();
        } catch (e) { toast(e.message, 'error'); }
      },
      'nova-versao': async (b) => {
        if (st.d.gerandoPeca) { toast('A nova versão já está sendo gerada. Acompanhe pela barra.'); return; }
        // Sempre confirma antes (gera custo de IA e uma versão nova).
        const msg = st.d.pecas.length
          ? 'Gerar uma nova versão da peça? A equipe lê tudo de novo e monta outra versão (leva alguns minutos e usa a IA). As versões atuais continuam guardadas.'
          : 'Gerar a petição agora? A equipe lê os documentos, faz os cálculos e redige (leva alguns minutos e usa a IA).';
        if (!await uiConfirm(msg)) return;
        b.disabled = true;
        try {
          await api(`/api/cases/${caseId}/peticao-inicial`, { method: 'POST', body: '{}' });
          st.mudou = true;
          acompanharGeracao({ desde: new Date().toISOString(), etapa: 'inicio', rotulo: 'Começando', passo: 1, total: 9 });
        } catch (e) {
          toast(e.message, 'error');
          if (/sendo gerada/i.test(e.message)) { ger.antes = st.d.pecas.length; st.d.gerandoPeca = st.d.gerandoPeca || { desde: new Date().toISOString(), etapa: 'inicio', rotulo: 'Começando', passo: 1, total: 9 }; verificarGeracao(); } else b.disabled = false;
        }
      },
      fmt: (b) => { const papel = q('.mesa-papel'); if (!papel || papel.getAttribute('contenteditable') !== 'true') return; papel.focus(); document.execCommand(b.dataset.cmd, false, null); aoEditar(); },
      proximo: () => {
        const ms = ov.querySelectorAll('.mesa-papel mark.mesa-colchete'); if (!ms.length) return;
        const m = ms[st.cursor % ms.length]; st.cursor = (st.cursor % ms.length) + 1;
        m.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const r = document.createRange(); r.selectNodeContents(m); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      },
      'copiar-jus': () => copiarJus(),
      'copiar-texto': async () => {
        const papel = q('.mesa-papel'); if (!papel) return;
        try { await navigator.clipboard.writeText(papel.innerText); toast('Texto copiado sem formatação'); } catch { toast('Selecione o texto (Ctrl+A) e copie (Ctrl+C).', 'error'); }
      },
      licao: async (b) => {
        try { await api(`/api/mesa/licao/${b.dataset.id}`, { method: 'POST', body: JSON.stringify({ decisao: b.dataset.decisao }) }); await carregar(); renderCentro(); }
        catch (e) { toast(e.message, 'error'); }
      },
      aprender: async (b) => {
        const p = pecaAtual(); if (!p) return;
        b.disabled = true; b.textContent = 'A equipe está comparando…';
        try { await api(`/api/mesa/documento/${p.id}/aprender`, { method: 'POST', body: '{}' }); await carregar(); renderCentro(); }
        catch (e) { toast(e.message, 'error'); b.disabled = false; b.textContent = 'Tentar de novo'; }
      },
      revisar: async () => {
        try { await api(`/api/mesa/${caseId}/revisar`, { method: 'POST', body: '{}' }); toast('A revisão começou. Você será avisada no sino.'); }
        catch (e) { toast(e.message, 'error'); }
      },
      'baixar-demonstrativo': () => {
        const dm = st.d.demonstrativo; if (!dm) return;
        downloadDocFile(dm.id, `${dm.name.replace(/[\\/:*?"<>|]/g, '')}.pdf`);
      },
      'baixar-planilha': () => {
        const pl = st.d.planilha; if (!pl) return;
        downloadDocFile(pl.id, `${pl.name.replace(/[\\/:*?"<>|]/g, '')}.xlsx`);
      },
      'abrir-doc': async (b) => {
        const d = st.d.documentos.find((x) => x.id === Number(b.dataset.id)); if (!d) return;
        if (Number(d.tem_texto)) {
          try {
            const g = await api(`/api/mesa/documento/${d.id}`);
            openModal(g.name || 'Documento', el(`<article class="mesa-leitura mesa-leitura-modal">${g.html}</article>`), { wide: true });
          } catch (e) { toast(e.message, 'error'); }
        } else if (Number(d.tem_arquivo)) downloadDocFile(d.id, d.name);
        else if (d.file_url) window.open(d.file_url, '_blank', 'noopener');
        else toast('Este documento não tem texto nem arquivo', 'error');
      },
      portal: async (b) => {
        const on = b.dataset.on !== '1';
        try { await api(`/api/documents/${b.dataset.id}`, { method: 'PUT', body: JSON.stringify({ visible_to_client: on }) }); toast(on ? 'Liberado no portal do cliente' : 'Oculto do portal'); await carregar(); renderCentro(); }
        catch (e) { toast(e.message, 'error'); }
      },
      ck: async (b) => {
        try { await api(`/api/cases/${caseId}/checklist`, { method: 'PATCH', body: JSON.stringify({ label: b.dataset.label, checked: b.dataset.done !== '1' }) }); await recarregar(false); renderCentro(); }
        catch (e) { toast(e.message, 'error'); }
      },
      partes: async () => {
        try {
          const c = await api('/api/cases/' + caseId); const box = el('<div></div>');
          renderPartesCaso(box, c); openModal('Partes do processo', box);
          aoFecharModal(() => { st.mudou = true; recarregar(false); });
        } catch (e) { toast(e.message, 'error'); }
      },
      ficha: () => fichaCompleta(caseId),
      processo: () => { caseDetail(caseId, () => recarregar(false)); aoFecharModal(() => recarregar(false)); },
      'valor-causa': async () => {
        const atual = Number(st.d.caso.valor_causa) || '';
        const novo = await uiPrompt('Valor da causa (R$): o que está em aberto na demanda.', atual ? String(atual).replace('.', ',') : '');
        if (novo === null) return;
        try { await api('/api/cases/' + caseId, { method: 'PUT', body: JSON.stringify({ valor_causa: parseMoneyBR(novo) }) }); st.mudou = true; toast('Valor da causa atualizado'); await recarregar(false); }
        catch (e) { toast(e.message, 'error'); }
      },
      'ler-pasta': async (b) => {
        const url = q('#mesa-drive').value.trim();
        if (!url) { toast('Cole o link da pasta do Drive primeiro', 'error'); return; }
        b.disabled = true; b.textContent = 'Lendo…';
        try {
          await api(`/api/cases/${caseId}/production-meta`, { method: 'PATCH', body: JSON.stringify({ drive_folder_url: url }) });
          await api(`/api/cases/${caseId}/analisar-documentos`, { method: 'POST' });
          toast('Lendo a pasta em segundo plano. Você será avisada no sino quando os documentos entrarem.');
          b.textContent = 'Lendo em segundo plano…';
          st.mudou = true;
        } catch (e) { toast(e.message, 'error'); b.disabled = false; b.textContent = 'Atualizar da pasta'; }
      },
      resolver: async (b) => {
        try { await api(`/api/cases/production-notes/${b.dataset.id}/resolve`, { method: 'PATCH', body: '{}' }); st.mudou = true; await recarregar(false); }
        catch (e) { toast(e.message, 'error'); }
      },
      'add-pend': async () => {
        const v = q('#mesa-nova-pend').value.trim(); if (!v) return;
        try { await api(`/api/cases/${caseId}/production-notes`, { method: 'POST', body: JSON.stringify({ kind: 'pendencia', text: v }) }); st.mudou = true; await recarregar(false); }
        catch (e) { toast(e.message, 'error'); }
      },
      registrar: async () => {
        const v = q('#mesa-atualizacao').value.trim(); if (!v) return;
        try { await api(`/api/cases/${caseId}/contexto`, { method: 'POST', body: JSON.stringify({ text: v }) }); await recarregar(false); }
        catch (e) { toast(e.message, 'error'); }
      },
      'add-label': async () => {
        const v = q('#mesa-nova-label').value.trim(); if (!v) return;
        let labels = []; try { labels = Array.isArray(st.prod?.production_labels) ? st.prod.production_labels : JSON.parse(st.prod?.production_labels || '[]'); } catch {}
        try { await api(`/api/cases/${caseId}/production-meta`, { method: 'PATCH', body: JSON.stringify({ labels: [...labels, v] }) }); st.mudou = true; await recarregar(false); }
        catch (e) { toast(e.message, 'error'); }
      },
      'rm-label': async (b) => {
        let labels = []; try { labels = Array.isArray(st.prod?.production_labels) ? st.prod.production_labels : JSON.parse(st.prod?.production_labels || '[]'); } catch {}
        try { await api(`/api/cases/${caseId}/production-meta`, { method: 'PATCH', body: JSON.stringify({ labels: labels.filter((_, i) => i !== Number(b.dataset.i)) }) }); st.mudou = true; await recarregar(false); }
        catch (e) { toast(e.message, 'error'); }
      },
    };

    // A seleção de texto não pode se perder ao clicar num botão de formatação.
    ov.addEventListener('mousedown', (e) => { if (e.target.closest('.mesa-fb')) e.preventDefault(); });
    ov.addEventListener('click', (e) => {
      const b = e.target.closest('[data-acao]'); if (!b || !ov.contains(b) || b.disabled) return;
      const f = ACOES[b.dataset.acao]; if (f) f(b);
    });
    ov.addEventListener('change', (e) => {
      if (e.target.matches('[data-arquivos]')) { enviarArquivos(e.target.files); return; }
      if (e.target.matches('[data-contrato]')) { mudarContrato(e.target); return; }
      const t = e.target.closest('[data-salvar]'); if (t) salvarCampo(t.dataset.salvar, t.value.trim());
    });
    ov.addEventListener('dragover', (e) => { const z = e.target.closest('.mesa-envio'); if (z) { e.preventDefault(); z.classList.add('arrastando'); } });
    ov.addEventListener('dragleave', (e) => { const z = e.target.closest('.mesa-envio'); if (z) z.classList.remove('arrastando'); });
    ov.addEventListener('drop', (e) => {
      const z = e.target.closest('.mesa-envio'); if (!z) return;
      e.preventDefault(); z.classList.remove('arrastando'); enviarArquivos(e.dataTransfer && e.dataTransfer.files);
    });
    ov.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
      const mapa = { 'mesa-nova-pend': 'add-pend', 'mesa-atualizacao': 'registrar', 'mesa-nova-label': 'add-label' };
      const a = mapa[e.target.id]; if (a) { e.preventDefault(); ACOES[a](); }
    });

    renderTudo();
    if (st.d.gerandoPeca) acompanharGeracao(st.d.gerandoPeca);
    ov.tabIndex = -1; ov.focus({ preventScroll: true });
  };
})();
