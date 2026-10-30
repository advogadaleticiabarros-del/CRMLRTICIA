// ─────────────────────────────────────────────────────────────
// Painel de tarefas: barra de acompanhamento e confirmação de conclusão
// (pedido da Jessica, 30/10/2026: "toda ação preciso de confirmação de conclusão,
// pode colocar barras também para acompanhamento, exemplo leitura de documentos,
// atualização de pasta, tudo que eu precise esperar para finalizar").
//
// Fica no canto da tela, em qualquer página, inclusive por cima da Mesa do caso.
// Mostra cada tarefa demorada com a etapa, a barra e o tempo. Quando termina, a
// confirmação ("Concluído" ou "Não concluído" com o motivo) fica até a pessoa dar OK.
// As tarefas vêm do servidor (GET /api/tarefas); uma tela que começa uma tarefa
// chama acompanharTarefas() para a barra aparecer na hora.
// ─────────────────────────────────────────────────────────────
(function () {
  const RAPIDO = 2500, PARADO = 20000;
  const st = { timer: null, el: null, conhecidas: new Map(), sumidas: [], recolhido: false, falhas: 0, parado: false };
  const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pode = () => typeof TOKEN !== 'undefined' && TOKEN && typeof USER !== 'undefined' && USER && USER.role !== 'parceiro_portal';

  function tempo(s) {
    const m = Math.floor(s / 60);
    return m ? `${m} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
  }

  function cartao(t) {
    const fim = t.estado !== 'rodando';
    const ok = t.estado === 'concluida';
    const barra = t.pct == null
      ? '<div class="tarefa-barra indeterminada" role="progressbar" aria-label="Em andamento"><span></span></div>'
      : `<div class="tarefa-barra" role="progressbar" aria-label="Andamento" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${t.pct}"><span style="width:${t.pct}%"></span></div>`;
    const cab = fim
      ? `<span class="tarefa-selo ${ok ? 'ok' : 'erro'}">${ok ? '✓ Concluído' : '✕ Não concluído'}</span>`
      : `<span class="tarefa-selo">${t.pct != null ? `${t.pct}%` : 'Em andamento'}</span>`;
    return `<article class="tarefa ${fim ? (ok ? 'tarefa-ok' : 'tarefa-erro') : ''}" data-id="${e(t.id)}">
      <header>${cab}<span class="tarefa-tempo">${e(tempo(t.segundos))}</span></header>
      <strong class="tarefa-titulo">${e(t.titulo)}</strong>
      ${fim ? '' : barra}
      <p class="tarefa-rotulo">${e(fim ? (t.resultado || '') : t.rotulo)}</p>
      ${fim ? `<div class="tarefa-acoes">${t.caseId ? `<button type="button" class="btn-sm" data-tarefa-abrir="${t.caseId}">Abrir o caso</button>` : ''}<button type="button" class="btn-sm" data-tarefa-ok="${e(t.id)}">OK</button></div>` : ''}
    </article>`;
  }

  function render(lista) {
    const todas = [...lista, ...st.sumidas];
    if (!todas.length) { if (st.el) { st.el.remove(); st.el = null; } document.body.style.removeProperty('--tarefas-h'); return; }
    if (!st.el) {
      st.el = document.createElement('section');
      st.el.className = 'tarefas-painel';
      st.el.setAttribute('aria-label', 'Tarefas em andamento');
      st.el.setAttribute('aria-live', 'polite');
      st.el.addEventListener('click', aoClicar);
      document.body.appendChild(st.el);
    }
    const rodando = todas.filter((t) => t.estado === 'rodando').length;
    const terminadas = todas.length - rodando;
    const resumo = rodando
      ? `${rodando} ${rodando === 1 ? 'tarefa em andamento' : 'tarefas em andamento'}${terminadas ? ` · ${terminadas} ${terminadas === 1 ? 'terminada' : 'terminadas'}` : ''}`
      : `${terminadas} ${terminadas === 1 ? 'tarefa terminada' : 'tarefas terminadas'}`;
    st.el.classList.toggle('recolhido', st.recolhido);
    st.el.innerHTML = `
      <div class="tarefas-topo">
        <button type="button" class="tarefas-resumo" data-tarefa-recolher aria-expanded="${!st.recolhido}">${rodando ? '<span class="tarefas-pulso" aria-hidden="true"></span>' : ''}${e(resumo)}</button>
        ${terminadas > 1 && !st.recolhido ? '<button type="button" class="tarefas-todas" data-tarefa-ok-todas>OK em todas</button>' : ''}
      </div>
      ${st.recolhido ? '' : `<div class="tarefas-lista">${todas.map(cartao).join('')}</div>`}`;
    document.body.style.setProperty('--tarefas-h', `${st.el.offsetHeight + 12}px`);
  }

  async function aoClicar(ev) {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-tarefa-recolher')) { st.recolhido = !st.recolhido; return atualizar(); }
    if (b.dataset.tarefaAbrir) {
      const id = Number(b.dataset.tarefaAbrir);
      if (typeof window.mesaDoCaso === 'function') window.mesaDoCaso(id);
      else if (typeof caseDetail === 'function') caseDetail(id);
      return;
    }
    if (b.dataset.tarefaOk) {
      const id = b.dataset.tarefaOk;
      st.sumidas = st.sumidas.filter((t) => t.id !== id);
      b.disabled = true;
      if (!id.startsWith('local-')) await api(`/api/tarefas/${encodeURIComponent(id)}/ok`, { method: 'POST', body: '{}' }).catch(() => {});
      return atualizar();
    }
    if (b.hasAttribute('data-tarefa-ok-todas')) {
      st.sumidas = []; b.disabled = true;
      await api('/api/tarefas/ok', { method: 'POST', body: '{}' }).catch(() => {});
      return atualizar();
    }
  }

  async function atualizar() {
    clearTimeout(st.timer);
    if (!pode() || st.parado) { render([]); return; }
    let lista;
    try { lista = (await api('/api/tarefas')).tarefas || []; st.falhas = 0; }
    catch (err) {
      if (err && err.status === 403) { st.parado = true; render([]); return; } // conta sem acesso
      st.falhas++; st.timer = setTimeout(atualizar, Math.min(30000, RAPIDO * 2 ** st.falhas)); return;
    }
    // Tarefa que rodava e sumiu do servidor: o CRM reiniciou no meio (publicação).
    const ids = new Set(lista.map((t) => t.id));
    for (const [id, t] of st.conhecidas) {
      if (!ids.has(id) && t.estado === 'rodando') {
        st.sumidas.push({ ...t, id: `local-${id}`, estado: 'falhou', pct: 100,
          resultado: t.tipo === 'peca'
            ? 'O sistema foi atualizado no meio. A geração da peça é retomada sozinha; o aviso chega no sino.'
            : 'O sistema foi atualizado no meio e a tarefa parou. Peça de novo.' });
      }
    }
    // A confirmação de conclusão também chega como aviso rápido, para quem está em outra tela.
    for (const t of lista) {
      const antes = st.conhecidas.get(t.id);
      if (antes && antes.estado === 'rodando' && t.estado !== 'rodando' && typeof toast === 'function') {
        toast(t.estado === 'concluida' ? `Concluído: ${t.titulo}` : `Não concluído: ${t.titulo}`, t.estado === 'concluida' ? 'success' : 'error');
        document.dispatchEvent(new CustomEvent('tarefa-terminou', { detail: t }));
      }
    }
    st.conhecidas = new Map(lista.map((t) => [t.id, t]));
    render(lista);
    st.timer = setTimeout(atualizar, lista.some((t) => t.estado === 'rodando') ? RAPIDO : PARADO);
  }

  /** Chame depois de pedir uma ação demorada: a barra aparece na hora. */
  window.acompanharTarefas = () => { st.parado = false; st.recolhido = false; atualizar(); };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(atualizar, 800));
  else setTimeout(atualizar, 800);
})();
