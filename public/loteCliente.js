// ── Card único do cliente (produção) ────────────────────────────────────────
// Pedido da Jessica (30/10/2026): "tudo centralizado em um único card, mesmo que
// vamos fazer vários processos distintos para protocolar... documentos renomeados
// e as peças prontas para que eu revise e protocole um a um".
// Cliente com 2+ ações antes do protocolo aparece no quadro como UM card; ao clicar,
// abre esta tela: o que falta (comum a todas as ações), as ações (uma peça por
// banco) com a situação, o kit de protocolo e "Protocolar", e os documentos do
// cliente com o nome padrão. Cada ação continua abrindo a Mesa do caso.
// Usa os globais de app.js (api, esc, toast, uiPrompt, TOKEN, fmtDate). Dados em
// src/routes/lote.ts; regras em src/services/loteProducao.ts.
(function () {
  const ETAPA = {
    em_analise: 'Em análise', separacao_documentos: 'Separação de documentos', criacao_inicial: 'Criação inicial',
    revisao_inicial: 'Revisão inicial', aguardando_protocolo: 'Aguardando protocolo', protocolado: 'Protocolado', concluido: 'Concluído', recusado: 'Recusado',
  };
  const SIT = {
    faltam_documentos: ['Faltam documentos', 'grave'], em_preparo: ['Peça ainda não gerada', 'neutro'], revisar: ['Peça para revisar', 'ambar'],
    pronta: ['Pronta para protocolar', 'ok'], protocolada: ['Protocolada', 'feito'], recusada: ['Recusada', 'neutro'],
  };
  const e = (s) => (typeof esc === 'function' ? esc(s) : String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));

  async function baixar(url, nomePadrao) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!res.ok) { let m = 'Não foi possível gerar o kit'; try { m = (await res.json()).error || m; } catch {} throw new Error(m); }
    const cd = res.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename\*=UTF-8''([^;]+)/);
    const nome = m ? decodeURIComponent(m[1]) : nomePadrao;
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ── Colar a peça revisada ─────────────────────────────────────────────────
  // O que vem colado (Word, Jusbrasil, e-mail) vira uma lista de parágrafos com o tipo
  // (título, citação, item), o alinhamento e os trechos em negrito/itálico/sublinhado.
  // O servidor só recebe esse dado (nunca HTML) e monta o .docx no papel timbrado.
  const BLOCO = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'TR', 'UL', 'OL', 'TABLE', 'TBODY', 'THEAD', 'SECTION', 'ARTICLE', 'PRE']);
  const FORA = new Set(['SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'META', 'LINK', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'OBJECT', 'EMBED']);
  const ALINHA = { left: 'left', center: 'center', right: 'right', justify: 'justify' };
  const alinhamentoDe = (n) => ALINHA[String((n.style && n.style.textAlign) || n.getAttribute('align') || '').toLowerCase()] || '';
  // Recuo à esquerda em cm (o Word marca a citação com recuo, não com <blockquote>).
  const recuoCm = (n) => {
    const m = String((n.style && n.style.marginLeft) || '').match(/^([\d.]+)(cm|mm|pt|px|in)$/);
    if (!m) return 0;
    const v = Number(m[1]);
    return { cm: v, mm: v / 10, pt: v / 28.35, px: v / 37.8, in: v * 2.54 }[m[2]];
  };

  function blocosDoNo(raiz) {
    const out = []; let cur = null;
    const abrir = (tipo, al) => { cur = { tipo, alinhamento: al, runs: [] }; out.push(cur); };
    const andar = (n, fmt, tipo, al) => {
      if (n.nodeType === 3) {
        const t = n.nodeValue.replace(/[\s\u00a0]+/g, ' ');
        if (!t.trim() && !cur) return;
        if (!cur) abrir(tipo, al);
        cur.runs.push({ t, ...fmt });
        return;
      }
      if (n.nodeType !== 1 || FORA.has(n.tagName)) return;
      if (n.tagName === 'BR') { cur = null; return; }
      const st = n.style || {};
      const f = {
        b: !!(fmt.b || /^(B|STRONG)$/.test(n.tagName) || /bold|[6-9]00/.test(st.fontWeight || '')),
        i: !!(fmt.i || /^(I|EM)$/.test(n.tagName) || st.fontStyle === 'italic'),
        u: !!(fmt.u || n.tagName === 'U' || /underline/.test(st.textDecoration || st.textDecorationLine || '')),
      };
      if (BLOCO.has(n.tagName)) {
        const t2 = (n.dataset && n.dataset.tipo) || (/^H\d$/.test(n.tagName) ? 'titulo' : n.tagName === 'LI' ? 'item'
          : n.tagName === 'BLOCKQUOTE' || recuoCm(n) >= 2.5 ? 'citacao' : tipo);
        const al2 = alinhamentoDe(n) || al;
        cur = null;
        [...n.childNodes].forEach((c) => andar(c, f, t2, al2));
        cur = null;
        return;
      }
      [...n.childNodes].forEach((c) => andar(c, f, tipo, al));
    };
    andar(raiz, { b: false, i: false, u: false }, 'p', '');
    // Junta trechos iguais e tira espaços das pontas.
    return out.map((p) => {
      const runs = [];
      for (const r of p.runs) {
        const ult = runs[runs.length - 1];
        if (ult && ult.b === r.b && ult.i === r.i && ult.u === r.u) ult.t += r.t; else runs.push({ ...r });
      }
      if (runs.length) { runs[0].t = runs[0].t.replace(/^\s+/, ''); runs[runs.length - 1].t = runs[runs.length - 1].t.replace(/\s+$/, ''); }
      return { ...p, runs: runs.filter((r) => r.t).map((r) => ({ t: r.t, ...(r.b ? { b: true } : {}), ...(r.i ? { i: true } : {}), ...(r.u ? { u: true } : {}) })) };
    }).filter((p) => p.runs.some((r) => r.t.trim()));
  }

  const blocosDoTexto = (texto) => String(texto || '').replace(/\r/g, '').split('\n').filter((l) => l.trim()).map((l) => ({ tipo: 'p', alinhamento: '', runs: [{ t: l.trim() }] }));

  function htmlDosBlocos(blocos) {
    const run = (r) => { let h = e(r.t); if (r.u) h = `<u>${h}</u>`; if (r.i) h = `<i>${h}</i>`; if (r.b) h = `<b>${h}</b>`; return h; };
    return blocos.map((p) => `<p data-tipo="${p.tipo}" class="lc-${p.tipo}"${p.alinhamento ? ` style="text-align:${p.alinhamento}"` : ''}>${p.runs.map(run).join('')}</p>`).join('');
  }

  function abrirColar(acao, aoGuardar) {
    const caixa = el(`<div class="lote-colar">
      <p class="lote-sub">Cole aqui a peça revisada de <b>${e(acao.reu || 'esta ação')}</b> (do Word, do Jusbrasil ou de onde estiver). O CRM põe no <b>papel timbrado</b>, em Times 12, espaçamento 1,5, recuo de 2,5 cm, títulos centralizados em negrito e o fecho preso à assinatura. Ela vira a versão final e vai no kit.</p>
      <div class="lote-colar-folha" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Peça revisada" data-vazia="Clique aqui e cole (Ctrl+V)"></div>
      <div class="lote-colar-rodape"><span class="lote-colar-status" aria-live="polite"></span>
        <button type="button" class="btn-sm" data-acao="cancelar">Cancelar</button>
        <button type="button" class="btn-primary" data-acao="guardar">Guardar como versão final</button></div>
    </div>`);
    const folha = caixa.querySelector('.lote-colar-folha');
    const status = caixa.querySelector('.lote-colar-status');
    const contar = () => { const n = blocosDoNo(folha).length; status.textContent = n ? `${n} parágrafo(s)` : ''; };
    folha.addEventListener('paste', (ev) => {
      ev.preventDefault();
      const html = ev.clipboardData.getData('text/html');
      const blocos = html ? blocosDoNo(new DOMParser().parseFromString(html, 'text/html').body) : blocosDoTexto(ev.clipboardData.getData('text/plain'));
      folha.innerHTML = htmlDosBlocos(blocos);
      contar();
    });
    folha.addEventListener('input', contar);
    caixa.querySelector('[data-acao="cancelar"]').onclick = () => closeModal();
    const guardar = caixa.querySelector('[data-acao="guardar"]');
    guardar.onclick = async () => {
      const paragrafos = blocosDoNo(folha);
      if (!paragrafos.length) { toast('Cole a peça antes de guardar', 'error'); return; }
      guardar.disabled = true; guardar.textContent = 'Pondo no papel timbrado…';
      try {
        const r = await api(`/api/lote/${acao.clienteId}/acao/${acao.id}/versao-final`, { method: 'POST', body: JSON.stringify({ paragrafos }) });
        closeModal(); toast(`Versão final guardada no papel timbrado: ${r.nome}. Já vai no kit.`);
        await aoGuardar();
      } catch (err) { toast(err.message, 'error'); guardar.disabled = false; guardar.textContent = 'Guardar como versão final'; }
    };
    openModal(`Peça revisada · ${acao.reu || 'ação'}`, caixa, { wide: true });
    setTimeout(() => folha.focus(), 40);
  }
  window.__loteColar = { blocosDoNo, blocosDoTexto, htmlDosBlocos };

  window.mesaDoCliente = async function mesaDoCliente(clientId, aoMudar) {
    document.querySelector('.lote-cli')?.remove();
    const voltarFoco = document.activeElement;
    const ov = document.createElement('div');
    ov.className = 'lote-cli'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Card do cliente');
    ov.innerHTML = '<div class="mesa-carregando" aria-live="polite"><div class="spinner"></div><span>Abrindo o cliente…</span></div>';
    document.body.appendChild(ov); document.body.classList.add('lote-aberto');
    let lote = null, mudou = false;
    const q = (s) => ov.querySelector(s);

    function onKey(ev) {
      if (ev.key !== 'Escape' || document.querySelector('.mesa')) return;
      const modal = document.querySelector('#modal');
      if ((modal && !modal.classList.contains('hidden')) || document.querySelector('#uid-ok')) return;
      fechar();
    }
    function fechar() {
      document.removeEventListener('keydown', onKey, true);
      ov.remove(); document.body.classList.remove('lote-aberto');
      if (voltarFoco && voltarFoco.focus) try { voltarFoco.focus(); } catch {}
      if (mudou && aoMudar) aoMudar();
    }
    document.addEventListener('keydown', onKey, true);

    async function carregar() { lote = await api(`/api/lote/${clientId}`); }

    const chip = (sit) => `<span class="lote-chip lote-${SIT[sit][1]}">${SIT[sit][0]}</span>`;

    function faltasHtml() {
      if (!lote.faltamComuns.length) return '<p class="lote-ok">Documentos comuns completos: servem a todas as ações.</p>';
      const trava = lote.faltamComuns.filter((f) => f.bloqueia), resto = lote.faltamComuns.filter((f) => !f.bloqueia);
      return `${trava.map((f) => `<div class="lote-trava" role="alert"><b>Travado: falta o ${e(f.rotulo)}.</b> Por quê: ${e(f.motivo)}.</div>`).join('')}
        ${resto.length ? `<p class="lote-falta">Falta também: ${resto.map((f) => `<b>${e(f.rotulo)}</b> <small>(${e(f.motivo)})</small>`).join(' · ')}</p>` : ''}`;
    }

    function acaoHtml(a, i) {
      const protocolada = a.situacao === 'protocolada';
      const peca = a.peca ? `Peça v${a.peca.versao}${a.peca.final ? ' · <b>versão final</b>' : ''}` : 'Sem peça';
      const anexos = a.kit.length ? `${a.kit.length} anexo(s)` : 'nenhum anexo';
      return `<article class="lote-acao" data-id="${a.id}">
        <div class="lote-acao-n">${i + 1}</div>
        <div class="lote-acao-corpo">
          <h3>${e(a.reu || a.titulo || `Caso #${a.id}`)}</h3>
          <p>${e(a.nomeFamilia || 'Tese não identificada')} · ${e(ETAPA[a.production_stage] || a.production_stage || '')}${a.case_number ? ` · nº <b>${e(a.case_number)}</b>` : ''}</p>
          <p class="lote-acao-meta">${chip(a.situacao)} <span>${peca}</span> <span>${anexos}${a.planilha ? ' + planilha' : ''}</span></p>
          <details class="lote-kit"><summary>Ver o kit de protocolo</summary>
            <ol>${a.kit.map((k) => `<li>${e(k.nome)}${!k.temArquivo ? ' <small class="lote-aviso">sem arquivo no CRM: juntar à parte</small>' : ''}<small>chegou como ${e(k.original)}</small></li>`).join('') || '<li>Nenhum anexo ainda.</li>'}</ol>
          </details>
        </div>
        <div class="lote-acao-botoes">
          <button type="button" class="btn-sm" data-acao="abrir">Abrir a mesa</button>
          ${a.peca && !a.peca.final && !protocolada ? `<button type="button" class="btn-sm" data-acao="final">Marcar a v${a.peca.versao} como final</button>` : ''}
          ${protocolada ? '' : '<button type="button" class="btn-sm" data-acao="colar" title="Cole a peça revisada: o CRM põe no papel timbrado, na formatação das peças">Colar a peça revisada (versão final)</button>'}
          ${a.peca ? '<button type="button" class="btn-sm" data-acao="peca">Baixar a peça (timbrado)</button>' : ''}
          <button type="button" class="btn-sm" data-acao="kit">Baixar o kit (.zip)</button>
          ${protocolada ? '' : `<button type="button" class="btn-primary btn-sm" data-acao="protocolar"${a.situacao === 'pronta' ? '' : ' title="A peça ainda não está marcada como versão final"'}>Protocolar</button>`}
        </div>
      </article>`;
    }

    function docsHtml() {
      const visiveis = lote.documentos.filter((d) => d.escopo !== 'interno');
      const reu = (id) => { const a = lote.acoes.find((x) => x.id === id); return a ? (a.reu || `#${id}`) : `#${id}`; };
      const linha = (d) => `<li><span>${e(d.padrao || d.original)}</span>${d.padrao && d.padrao !== d.original ? `<small>chegou como ${e(d.original)}</small>` : ''}
        ${d.escopo === 'acao' ? `<small class="lote-bancos">${d.acoes.length ? d.acoes.map(reu).map(e).join(', ') : '<b>sem ação: anexe no card do banco certo</b>'}</small>` : ''}</li>`;
      const comuns = visiveis.filter((d) => d.escopo === 'comum'), deAcao = visiveis.filter((d) => d.escopo === 'acao');
      const aPadronizar = visiveis.filter((d) => d.padrao && d.padrao !== d.original).length;
      return `<div class="lote-docs-cab"><span>${visiveis.length} documento(s) do cliente</span>
          ${aPadronizar ? `<button type="button" class="btn-sm" data-acao="padronizar">Dar o nome padrão a ${aPadronizar} documento(s)</button>` : ''}</div>
        <h4>Comuns a todas as ações</h4><ul class="lote-docs">${comuns.map(linha).join('') || '<li>Nenhum.</li>'}</ul>
        <h4>De um banco</h4><ul class="lote-docs">${deAcao.map(linha).join('') || '<li>Nenhum.</li>'}</ul>
        <label class="lote-enviar">Enviar documento do cliente (vale para todas as ações)
          <input type="file" multiple data-acao="enviar" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"></label>`;
    }

    function render() {
      const r = lote.resumo;
      ov.innerHTML = `
        <header class="mesa-topo">
          <button type="button" class="mesa-voltar" data-acao="fechar">← Voltar ao quadro</button>
          <div class="mesa-quem"><h1>${e(lote.cliente)}</h1>
            <p>${r.total} ${r.total === 1 ? 'ação' : 'ações'} (uma peça por banco) · ${r.prontas} pronta(s) · ${r.protocoladas} protocolada(s)${r.travadas ? ` · <b>${r.travadas} travada(s)</b>` : ''}</p></div>
        </header>
        <main class="lote-corpo">
          <section class="lote-bloco"><h2>O que falta</h2>${faltasHtml()}</section>
          <section class="lote-bloco"><h2>Ações para protocolar, uma a uma</h2>
            <p class="lote-sub">Revise a peça na mesa, marque a versão final, baixe o kit e protocole. RMC e RCC do mesmo banco podem ir juntos (faixa "processo único" do quadro).</p>
            <div class="lote-acoes">${lote.acoes.map(acaoHtml).join('')}</div></section>
          <section class="lote-bloco"><h2>Documentos do cliente</h2>${docsHtml()}</section>
        </main>`;
      q('[data-acao="fechar"]').onclick = fechar;
      ov.querySelectorAll('.lote-acao').forEach((card) => {
        const id = Number(card.dataset.id);
        const a = lote.acoes.find((x) => x.id === id);
        card.querySelector('[data-acao="abrir"]').onclick = () => mesaDoCaso(id, async () => { mudou = true; await recarregar(); });
        card.querySelector('[data-acao="kit"]').onclick = async (ev) => {
          const b = ev.currentTarget; b.disabled = true; const t = b.textContent; b.textContent = 'Montando o kit…';
          try { await baixar(`/api/lote/${clientId}/acao/${id}/kit`, 'kit.zip'); toast('Kit baixado: peça em Word, anexos renomeados e LEIA-ME'); } catch (err) { toast(err.message, 'error'); }
          b.disabled = false; b.textContent = t;
        };
        const fin = card.querySelector('[data-acao="final"]');
        if (fin) fin.onclick = async () => {
          fin.disabled = true;
          try { await api(`/api/mesa/documento/${a.peca.docId}/final`, { method: 'POST', body: JSON.stringify({ final: true }) }); toast(`v${a.peca.versao} marcada como versão final`); mudou = true; await recarregar(); }
          catch (err) { toast(err.message, 'error'); fin.disabled = false; }
        };
        const colar = card.querySelector('[data-acao="colar"]');
        if (colar) colar.onclick = () => abrirColar({ ...a, clienteId: clientId }, async () => { mudou = true; await recarregar(); });
        const baixarPeca = card.querySelector('[data-acao="peca"]');
        if (baixarPeca) baixarPeca.onclick = async () => {
          baixarPeca.disabled = true;
          try { await baixar(`/api/lote/${clientId}/acao/${id}/peca`, 'peca.docx'); } catch (err) { toast(err.message, 'error'); }
          baixarPeca.disabled = false;
        };
        const prot = card.querySelector('[data-acao="protocolar"]');
        if (prot) prot.onclick = async () => {
          if (a.situacao !== 'pronta' && !(await uiConfirm(`A peça de ${a.reu || 'esta ação'} ainda não está marcada como versão final. Protocolar mesmo assim?`))) return;
          const num = await uiPrompt(`Número do processo de ${a.reu || 'esta ação'}:`);
          if (!num || !num.trim()) return;
          try {
            await api(`/api/cases/${id}/production-stage`, { method: 'PATCH', body: JSON.stringify({ stage: 'protocolado', case_number: num.trim() }) });
            toast('Protocolada · próxima ação'); mudou = true; await recarregar();
          } catch (err) { toast(err.message, 'error'); }
        };
      });
      const pad = q('[data-acao="padronizar"]');
      if (pad) pad.onclick = async () => {
        pad.disabled = true;
        try { const r2 = await api(`/api/lote/${clientId}/padronizar`, { method: 'POST', body: '{}' }); toast(`${r2.renomeados} documento(s) com o nome padrão. O nome de chegada fica guardado.`); mudou = true; await recarregar(); } catch (err) { toast(err.message, 'error'); pad.disabled = false; }
      };
      const env = q('[data-acao="enviar"]');
      if (env) env.onchange = async () => {
        const arquivos = [...env.files];
        for (const f of arquivos) {
          if (f.size > 15 * 1024 * 1024) { toast(`${f.name}: maior que 15 MB`, 'error'); continue; }
          const base64 = await new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = erro; r.readAsDataURL(f); });
          try { await api('/api/documents', { method: 'POST', body: JSON.stringify({ client_id: clientId, name: f.name, type: 'anexo', folder: 'processos', status: 'recebido', file_base64: base64, mime: f.type || 'application/octet-stream' }) }); }
          catch (err) { toast(`${f.name}: ${err.message}`, 'error'); }
        }
        toast(`${arquivos.length} arquivo(s) enviado(s)`); mudou = true; await recarregar();
      };
    }

    async function recarregar() { try { await carregar(); render(); } catch (err) { toast(err.message, 'error'); } }

    try { await carregar(); } catch (err) {
      document.removeEventListener('keydown', onKey, true); ov.remove(); document.body.classList.remove('lote-aberto');
      toast(err.message || 'Não foi possível abrir o cliente', 'error'); return;
    }
    render();
    q('[data-acao="fechar"]')?.focus();
  };
})();
