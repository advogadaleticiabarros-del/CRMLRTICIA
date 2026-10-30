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
          ${protocolada ? '' : `<label class="btn-sm lote-enviar-final" title="Revisou no Word? Envie aqui: vira a versão final e vai no kit como está">Enviar a peça revisada (versão final)<input type="file" data-acao="enviar-final" accept=".docx,.pdf" class="lote-arquivo-oculto"></label>`}
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
        const envFinal = card.querySelector('[data-acao="enviar-final"]');
        if (envFinal) envFinal.onchange = async () => {
          const f = envFinal.files[0];
          if (!f) return;
          if (!/\.(docx|pdf)$/i.test(f.name)) { toast('Envie a peça em Word (.docx) ou PDF', 'error'); return; }
          if (f.size > 15 * 1024 * 1024) { toast('Arquivo maior que 15 MB', 'error'); return; }
          const base64 = await new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = erro; r.readAsDataURL(f); });
          try {
            const r2 = await api(`/api/lote/${clientId}/acao/${id}/versao-final`, { method: 'POST', body: JSON.stringify({ name: f.name, file_base64: base64, mime: f.type || '' }) });
            toast(`Guardada como versão final: ${r2.nome}. Já vai no kit.`); mudou = true; await recarregar();
          } catch (err) { toast(err.message, 'error'); }
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
