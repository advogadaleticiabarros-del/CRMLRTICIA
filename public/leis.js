// ── Pesquisa de Leis ────────────────────────────────────────────────────────
// Usa os globais de app.js (api, el, esc, $, openModal, toast, USER, ROUTES).
// Três abas: Pesquisar (busca por palavras ou citação, atalhos dos códigos e o
// leitor da lei), Conferir citações (Dra. Vera) e Fundamentos para a peça
// (Dra. Júlia). Atalho direto: #leis?norma=ID&art=482.
(function () {
  const CSS = `
  .lx-status { color: var(--text-muted); font-size: 12.5px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .lx-busca { display: flex; gap: 8px; margin: 4px 0 10px; }
  .lx-busca input { flex: 1; font-size: 16px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); font-family: inherit; }
  .lx-busca input:focus, .lx-area:focus, .lx-sum-filtro:focus { outline: 2px solid var(--gold-soft); outline-offset: 1px; border-color: var(--gold); }
  .lx-filtros { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }
  .lx-filtro { border: 1px solid var(--border); background: var(--surface); color: var(--text-soft); border-radius: 18px; padding: 5px 12px; font-size: 12.5px; cursor: pointer; font-family: inherit; }
  .lx-filtro[aria-pressed="true"] { background: var(--navy-deep); border-color: var(--navy-deep); color: #fff; }
  .lx-vig { margin-left: 6px; font-size: 12.5px; color: var(--text-soft); display: inline-flex; gap: 6px; align-items: center; }
  .lx-atalhos { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 0 0 18px; font-size: 13px; }
  .lx-atalhos span { color: var(--text-muted); }
  .lx-atalhos button { background: none; border: 0; padding: 2px 0; color: var(--navy); cursor: pointer; font-family: 'Spectral', Georgia, serif; font-size: 15px; border-bottom: 1px solid transparent; }
  .lx-atalhos button:hover, .lx-atalhos button:focus-visible { border-bottom-color: var(--gold); outline: none; }
  .lx-lista { background: var(--surface); border: 1px solid var(--border-soft); border-radius: var(--radius); }
  .lx-item { padding: 14px 18px; border-top: 1px solid var(--border-soft); }
  .lx-item:first-child { border-top: 0; }
  .lx-item-topo { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
  .lx-rotulo { font-family: 'Spectral', Georgia, serif; font-size: 17px; font-weight: 600; color: var(--navy-deep); }
  .lx-norma { color: var(--text-soft); font-size: 13px; }
  .lx-trecho { margin: 6px 0 8px; color: var(--text); font-size: 14px; line-height: 1.6; max-width: 80ch; }
  .lx-trecho mark, .lx-texto mark { background: none; color: inherit; box-shadow: inset 0 -0.45em 0 rgba(224,192,116,.45); }
  .lx-acoes { display: flex; gap: 6px; flex-wrap: wrap; }
  .lx-tag { font-size: 11.5px; border-radius: 10px; padding: 1px 8px; background: #eef2f8; color: var(--navy); }
  .lx-tag.rev { background: var(--red-bg); color: var(--red); }
  .lx-tag.exato { background: var(--amber-bg); color: var(--amber); }
  .lx-vazio { padding: 28px 18px; color: var(--text-muted); }
  /* Leitor: a lei como página de um código impresso */
  .lx-leitor { display: grid; grid-template-columns: 210px minmax(0, 1fr); gap: 22px; }
  .lx-cab { grid-column: 1 / -1; border-bottom: 1px solid var(--border); padding-bottom: 12px; }
  .lx-cab p { margin: 4px 0 0; color: var(--text-soft); font-size: 13.5px; max-width: 80ch; }
  .lx-aviso { font-size: 12.5px; color: var(--text-muted); }
  .lx-sum { border-right: 1px solid var(--border-soft); padding-right: 12px; }
  .lx-sum-filtro { width: 100%; padding: 7px 10px; border: 1px solid var(--border); border-radius: 8px; font-family: inherit; font-size: 13px; margin-bottom: 8px; }
  .lx-sum ol { list-style: none; margin: 0; padding: 0; max-height: 56vh; overflow: auto; }
  .lx-sum button { display: block; width: 100%; text-align: left; background: none; border: 0; padding: 4px 8px; border-radius: 6px; cursor: pointer; font-family: 'Spectral', Georgia, serif; font-size: 14.5px; color: var(--text); }
  .lx-sum button:hover { background: var(--surface-2); }
  .lx-sum button[aria-current="true"] { background: var(--navy-deep); color: #fff; }
  .lx-sum button.rev { color: var(--text-muted); text-decoration: line-through; }
  .lx-sum .lx-parte { font-size: 11.5px; color: var(--text-muted); padding: 10px 8px 2px; }
  .lx-pagina { min-width: 0; }
  .lx-texto { font-family: 'Spectral', Georgia, serif; font-size: 17px; line-height: 1.75; color: var(--text); white-space: pre-line; max-width: 68ch; margin: 0 0 16px; }
  .lx-texto p { margin: 0 0 .6em; }
  .lx-citacao { font-size: 13px; color: var(--text-soft); margin-bottom: 10px; }
  .lx-nav { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  /* Conferência e fundamentos */
  .lx-area { width: 100%; min-height: 180px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 10px; font-family: inherit; font-size: 14px; line-height: 1.55; background: var(--surface); }
  .lx-linha-form { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0 16px; align-items: center; }
  .lx-linha-form select, .lx-linha-form input { padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; font-family: inherit; font-size: 13px; }
  .lx-placar { display: flex; gap: 18px; flex-wrap: wrap; margin: 0 0 10px; font-size: 13.5px; }
  .lx-placar b { font-size: 20px; font-family: 'Spectral', Georgia, serif; margin-right: 4px; }
  .lx-sim { display: inline-block; width: 1.4em; font-weight: 700; }
  .lx-sim.ok { color: var(--green); } .lx-sim.erro { color: var(--red); } .lx-sim.duvida { color: var(--amber); }
  .lx-item details { margin-top: 6px; }
  .lx-item summary { cursor: pointer; color: var(--navy); font-size: 13px; }
  .lx-item details .lx-texto { font-size: 15px; margin-top: 8px; }
  .lx-obs { color: var(--red); font-size: 13.5px; margin-top: 4px; }
  @media (max-width: 760px) {
    .lx-leitor { grid-template-columns: 1fr; }
    .lx-sum { border-right: 0; padding-right: 0; border-bottom: 1px solid var(--border-soft); padding-bottom: 10px; }
    .lx-sum ol { max-height: 180px; }
    .lx-texto { font-size: 16px; }
  }`;
  function garantirCss() {
    if (document.getElementById('leis-css')) return;
    const s = document.createElement('style'); s.id = 'leis-css'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  const ESFERAS = [
    ['', 'Tudo'], ['constituicao', 'Constituição'], ['federal', 'Leis federais'], ['estadual', 'Leis do ES'],
    ['jurisprudencia', 'Súmulas, OJs e temas'], ['regulador', 'INSS e MTE'],
  ];
  const NOME_ESFERA = { constituicao: 'Constituição', federal: 'Federal', estadual: 'ES', jurisprudencia: 'Jurisprudência', regulador: 'INSS/MTE' };
  const SITUACAO = {
    confere: ['ok', '✓', 'confere com o texto oficial'],
    artigo_revogado: ['erro', '✗', 'artigo revogado: não citar como vigente'],
    norma_revogada: ['erro', '✗', 'norma revogada ou cancelada: conferir o que a substituiu'],
    artigo_inexistente: ['erro', '✗', 'artigo não existe nessa norma: conferir o número'],
    fora_do_acervo: ['duvida', '?', 'fora do acervo: conferir manualmente na fonte oficial'],
  };

  const paragrafos = (t) => String(t || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('');
  const marcar = (t) => esc(t).replace(/\[\[/g, '<mark>').replace(/\]\]/g, '</mark>');
  const dataBr = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '');
  async function copiar(texto, aviso) {
    try { await navigator.clipboard.writeText(texto); }
    catch {
      const t = document.createElement('textarea'); t.value = texto; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } finally { t.remove(); }
    }
    toast(aviso || 'Copiado');
  }
  const linkFonte = (url) => (url && /^https?:\/\//.test(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">fonte oficial</a>` : '');

  // ── Leitor da lei ─────────────────────────────────────────────────────────
  async function abrirLei(normaId, numeroArtigo, dispositivoId) {
    let n;
    try { n = await api(`/api/leis/norma/${normaId}`); } catch (e) { toast(e.message, 'error'); return; }
    const corpo = el(`<div class="lx-leitor">
      <div class="lx-cab">
        ${n.ementa ? `<p>${esc(n.ementa)}</p>` : ''}
        <p>${n.revogada ? '<span class="lx-tag rev">revogada</span> ' : ''}${esc(n.versao || '')} ${linkFonte(n.fonte)}</p>
        <p class="lx-aviso">Texto convertido automaticamente da fonte oficial. Antes de protocolar, confira na fonte.</p>
      </div>
      <nav class="lx-sum" aria-label="Artigos">
        <input class="lx-sum-filtro" placeholder="Ir para o artigo…" aria-label="Filtrar artigos">
        <ol></ol>
      </nav>
      <section class="lx-pagina" aria-live="polite"><div class="spinner"></div></section>
    </div>`);
    const lista = corpo.querySelector('ol');
    const pagina = corpo.querySelector('.lx-pagina');
    const ds = n.dispositivos;
    const variasPartes = new Set(ds.map((d) => d.parte)).size > 1;
    let parteAtual = null;
    ds.forEach((d, i) => {
      if (variasPartes && d.parte !== parteAtual) {
        parteAtual = d.parte;
        const rot = n.caminho === 'constituicao.md' ? (d.principal ? 'Constituição' : 'ADCT') : (d.principal ? 'Texto principal' : 'Ato que aprova');
        lista.appendChild(el(`<li class="lx-parte">${rot}</li>`));
      }
      const li = el(`<li><button type="button" data-i="${i}" class="${d.revogado ? 'rev' : ''}">${esc(d.rotulo)}</button></li>`);
      lista.appendChild(li);
    });
    let atual = -1;
    async function mostrar(i) {
      if (i < 0 || i >= ds.length) return;
      atual = i;
      lista.querySelectorAll('button').forEach((b) => b.setAttribute('aria-current', String(Number(b.dataset.i) === i)));
      const botao = lista.querySelector(`button[data-i="${i}"]`);
      if (botao) botao.scrollIntoView({ block: 'nearest' });
      pagina.innerHTML = '<div class="spinner"></div>';
      try {
        const d = await api(`/api/leis/dispositivo/${ds[i].id}`);
        if (atual !== i) return;
        pagina.innerHTML = `
          <div class="lx-citacao">${esc(d.citacao)}${d.revogado ? ' <span class="lx-tag rev">revogado</span>' : ''}</div>
          <div class="lx-texto">${paragrafos(d.texto)}</div>
          <div class="lx-nav">
            <button type="button" class="btn-sm" data-a="ant" ${i === 0 ? 'disabled' : ''}>Anterior</button>
            <button type="button" class="btn-sm" data-a="prox" ${i === ds.length - 1 ? 'disabled' : ''}>Próximo</button>
            <button type="button" class="btn-sm" data-a="cit">Copiar citação</button>
            <button type="button" class="btn-sm" data-a="txt">Copiar texto</button>
          </div>`;
        pagina.querySelector('[data-a="ant"]').onclick = () => mostrar(i - 1);
        pagina.querySelector('[data-a="prox"]').onclick = () => mostrar(i + 1);
        pagina.querySelector('[data-a="cit"]').onclick = () => copiar(d.citacao, 'Citação copiada');
        pagina.querySelector('[data-a="txt"]').onclick = () => copiar(`${d.texto}\n\n(${d.citacao})`, 'Texto copiado');
      } catch (e) { pagina.innerHTML = `<div class="lx-vazio">${esc(e.message)}</div>`; }
    }
    lista.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) mostrar(Number(b.dataset.i)); });
    corpo.querySelector('.lx-sum-filtro').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase().replace(/^art(igo)?\.?\s*/, '');
      lista.querySelectorAll('li').forEach((li) => {
        const b = li.querySelector('button');
        li.hidden = !!q && (!b || !b.textContent.toLowerCase().replace(/^art\.\s*/, '').startsWith(q));
      });
    });
    openModal(n.apelido && n.apelido !== n.titulo ? `${n.apelido} — ${n.titulo}` : n.titulo, corpo, { wide: true });
    let inicio = 0;
    if (dispositivoId) inicio = Math.max(0, ds.findIndex((d) => d.id === Number(dispositivoId)));
    else if (numeroArtigo) {
      const alvo = String(numeroArtigo).toLowerCase().replace(/[º°o.]/g, '');
      const k = ds.findIndex((d) => d.principal && d.numero.toLowerCase() === alvo);
      inicio = k >= 0 ? k : 0;
    }
    if (ds.length) mostrar(inicio); else pagina.innerHTML = '<div class="lx-vazio">Esta norma não tem texto no acervo.</div>';
  }
  window.abrirLei = abrirLei;

  // ── Aba: Pesquisar ────────────────────────────────────────────────────────
  async function abaPesquisar(c, estado) {
    let esfera = '';
    let vigentes = false;
    c.innerHTML = `
      <form class="lx-busca" role="search">
        <input id="lx-q" type="search" autocomplete="off" aria-label="Pesquisar nas leis"
          placeholder="Palavras (justa causa abandono) ou citação (art 482 clt, súmula 331 tst, lei 8213 art 42)">
        <button class="btn-primary" type="submit" style="width:auto">Pesquisar</button>
      </form>
      <div class="lx-filtros">
        ${ESFERAS.map(([v, t]) => `<button type="button" class="lx-filtro" data-esfera="${v}" aria-pressed="${v === ''}">${t}</button>`).join('')}
        <label class="lx-vig"><input type="checkbox" id="lx-vig"> Só em vigor</label>
      </div>
      <div class="lx-atalhos" id="lx-atalhos"></div>
      <div id="lx-res"></div>`;
    api('/api/leis/atalhos').then((at) => {
      const box = $('#lx-atalhos');
      if (!box || !at.length) return;
      box.innerHTML = '<span>Abrir:</span>' + at.map((a) => `<button type="button" data-norma="${a.normaId}">${esc(a.apelido)}</button>`).join('');
      box.onclick = (e) => { const b = e.target.closest('[data-norma]'); if (b) abrirLei(b.dataset.norma); };
    }).catch(() => {});
    const res = $('#lx-res');
    res.innerHTML = `<div class="lx-vazio">${estado.normas.toLocaleString('pt-BR')} normas e ${estado.dispositivos.toLocaleString('pt-BR')} artigos e enunciados no acervo. Digite palavras ou uma citação.</div>`;
    let ultimo = 0;
    async function buscar() {
      const q = $('#lx-q').value.trim();
      if (q.length < 2) return;
      const meu = ++ultimo;
      res.innerHTML = '<div class="spinner"></div>';
      const p = new URLSearchParams({ q, ...(esfera ? { esferas: esfera } : {}), ...(vigentes ? { vigentes: '1' } : {}) });
      try {
        const { resultados } = await api(`/api/leis/buscar?${p}`);
        if (meu !== ultimo) return;
        if (!resultados.length) { res.innerHTML = '<div class="lx-lista"><div class="lx-vazio">Nada encontrado. Tente menos palavras, outra forma (rescisão, rescindir) ou tire o filtro.</div></div>'; return; }
        res.innerHTML = `<div class="lx-lista">${resultados.map((r, i) => `
          <article class="lx-item">
            <div class="lx-item-topo">
              <span class="lx-rotulo">${esc(r.rotulo)}</span>
              ${r.rotulo.startsWith(r.titulo) ? '' : `<span class="lx-norma">${esc(r.apelido && r.esfera !== 'constituicao' ? `${r.apelido} (${r.titulo})` : r.titulo)}</span>`}
              <span class="lx-tag">${NOME_ESFERA[r.esfera] || r.esfera}</span>
              ${r.exato ? '<span class="lx-tag exato">a citação digitada</span>' : ''}
              ${r.revogado || r.normaRevogada ? '<span class="lx-tag rev">revogado</span>' : ''}
            </div>
            <p class="lx-trecho">${marcar(r.trecho)}</p>
            <div class="lx-acoes">
              <button type="button" class="btn-sm" data-ler="${i}">Ler na lei</button>
              <button type="button" class="btn-sm" data-cit="${i}">Copiar citação</button>
            </div>
          </article>`).join('')}</div>`;
        res.onclick = async (e) => {
          const ler = e.target.closest('[data-ler]');
          if (ler) { const r = resultados[ler.dataset.ler]; abrirLei(r.normaId, null, r.dispositivoId); return; }
          const cit = e.target.closest('[data-cit]');
          if (cit) {
            const r = resultados[cit.dataset.cit];
            try { const d = await api(`/api/leis/dispositivo/${r.dispositivoId}`); copiar(d.citacao, 'Citação copiada'); } catch (er) { toast(er.message, 'error'); }
          }
        };
      } catch (e) { if (meu === ultimo) res.innerHTML = `<div class="lx-vazio">${esc(e.message)}</div>`; }
    }
    c.querySelector('form').onsubmit = (e) => { e.preventDefault(); buscar(); };
    c.querySelector('.lx-filtros').addEventListener('click', (e) => {
      const b = e.target.closest('[data-esfera]');
      if (!b) return;
      esfera = b.dataset.esfera;
      c.querySelectorAll('[data-esfera]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      buscar();
    });
    $('#lx-vig').onchange = (e) => { vigentes = e.target.checked; buscar(); };
    $('#lx-q').focus();
  }

  // ── Aba: Conferir citações (Dra. Vera) ────────────────────────────────────
  function abaConferir(c) {
    c.innerHTML = `
      <p class="sub" style="margin-bottom:10px">Cole a peça ou um trecho. A Dra. Vera confere cada lei, artigo, súmula, OJ e tema citados: se existe, se está em vigor e se o texto oficial sustenta o que a peça afirma.</p>
      <textarea class="lx-area" id="lx-peca" aria-label="Texto da peça" placeholder="Ex.: Nos termos do art. 477, § 8º, da CLT e da Súmula 331, IV, do TST…"></textarea>
      <div class="lx-linha-form"><button class="btn-primary" id="lx-conferir" type="button" style="width:auto">Conferir citações</button></div>
      <div id="lx-conf"></div>`;
    $('#lx-conferir').onclick = async () => {
      const texto = $('#lx-peca').value;
      const out = $('#lx-conf');
      out.innerHTML = '<div class="spinner"></div>';
      try {
        const r = await api('/api/leis/conferir', { method: 'POST', body: JSON.stringify({ texto }) });
        if (!r.itens.length) { out.innerHTML = '<div class="lx-lista"><div class="lx-vazio">Nenhuma citação de lei, súmula, OJ ou tema encontrada no texto.</div></div>'; return; }
        const k = r.contagem;
        out.innerHTML = `
          <div class="lx-placar">
            <span><b>${k.total}</b>citações</span>
            <span><b style="color:var(--green)">${k.confere}</b>conferem</span>
            <span><b style="color:var(--red)">${k.problemas}</b>com problema</span>
            <span><b style="color:var(--amber)">${k.sentido}</b>a rever o sentido</span>
          </div>
          <div class="lx-lista">${r.itens.map((x, i) => {
            const [cls, sim, rot] = SITUACAO[x.situacao] || SITUACAO.fora_do_acervo;
            const sentido = x.sustenta === 'nao' ? 'o texto oficial não sustenta o que a peça afirma' : x.sustenta === 'parcial' ? 'o texto oficial sustenta só em parte' : '';
            return `<article class="lx-item">
              <div class="lx-item-topo"><span class="lx-sim ${sentido ? 'duvida' : cls}" aria-hidden="true">${sentido ? '⚠' : sim}</span>
                <span class="lx-rotulo">${esc(x.trecho)}</span><span class="lx-norma">${esc(rot)}</span></div>
              ${x.citacao && x.citacao !== x.trecho ? `<div class="lx-norma">${esc(x.citacao)}</div>` : ''}
              ${sentido ? `<div class="lx-obs">${esc(sentido)}${x.observacao ? ': ' + esc(x.observacao) : ''}</div>` : ''}
              ${x.texto ? `<details><summary>Texto oficial</summary><div class="lx-texto">${paragrafos(x.texto)}</div>
                <div class="lx-acoes">${x.normaId ? `<button type="button" class="btn-sm" data-abrir="${i}">Abrir na lei</button>` : ''} ${linkFonte(x.fonte)}</div></details>` : ''}
            </article>`;
          }).join('')}</div>`;
        out.onclick = (e) => { const b = e.target.closest('[data-abrir]'); if (b) abrirLei(r.itens[b.dataset.abrir].normaId); };
      } catch (e) { out.innerHTML = `<div class="lx-vazio">${esc(e.message)}</div>`; }
    };
  }

  // ── Aba: Fundamentos para a peça (Dra. Júlia) ─────────────────────────────
  function abaFundamentos(c) {
    c.innerHTML = `
      <p class="sub" style="margin-bottom:10px">Descreva o caso. A Dra. Júlia separa os artigos, súmulas e temas que se aplicam e mostra só os que existem no acervo, com o texto oficial.</p>
      <textarea class="lx-area" id="lx-caso" aria-label="Descrição do caso" placeholder="Ex.: empregada demitida grávida, sem receber as verbas rescisórias, empresa terceirizada prestando serviço a um banco."></textarea>
      <div class="lx-linha-form">
        <select id="lx-area-sel" aria-label="Área">
          <option value="">Área</option><option>trabalhista</option><option>previdenciário</option><option>família</option><option>consumidor</option><option>cível</option>
        </select>
        <input id="lx-tipo" placeholder="Tipo de peça (ex.: petição inicial)" aria-label="Tipo de peça">
        <button class="btn-primary" id="lx-buscar-fund" type="button" style="width:auto">Separar fundamentos</button>
      </div>
      <div id="lx-fund"></div>`;
    $('#lx-buscar-fund').onclick = async () => {
      const out = $('#lx-fund');
      out.innerHTML = '<div class="spinner"></div>';
      try {
        const r = await api('/api/leis/fundamentos', { method: 'POST', body: JSON.stringify({ texto: $('#lx-caso').value, area: $('#lx-area-sel').value, tipo: $('#lx-tipo').value }) });
        if (!r.itens.length) { out.innerHTML = '<div class="lx-lista"><div class="lx-vazio">Nenhum fundamento conferido. Conte mais do caso (o que aconteceu, o que se pede) e tente de novo.</div></div>'; return; }
        out.innerHTML = `<div class="lx-linha-form" style="margin-top:0"><button type="button" class="btn-sm" id="lx-copiar-tudo">Copiar todos</button></div>
          <div class="lx-lista">${r.itens.map((f, i) => `<article class="lx-item">
            <div class="lx-item-topo"><span class="lx-rotulo">${esc(f.citacao)}</span></div>
            <p class="lx-trecho">${esc(f.texto.length > 420 ? f.texto.slice(0, 420) + '…' : f.texto)}</p>
            <div class="lx-acoes"><button type="button" class="btn-sm" data-cit="${i}">Copiar citação</button><button type="button" class="btn-sm" data-txt="${i}">Copiar texto</button> ${linkFonte(f.fonte)}</div>
          </article>`).join('')}</div>`;
        $('#lx-copiar-tudo').onclick = () => copiar(r.itens.map((f) => `${f.citacao}: "${f.texto.replace(/\s+/g, ' ').trim()}"`).join('\n\n'), 'Fundamentos copiados');
        out.querySelector('.lx-lista').onclick = (e) => {
          const a = e.target.closest('[data-cit]'); if (a) copiar(r.itens[a.dataset.cit].citacao, 'Citação copiada');
          const b = e.target.closest('[data-txt]'); if (b) { const f = r.itens[b.dataset.txt]; copiar(`${f.texto}\n\n(${f.citacao})`, 'Texto copiado'); }
        };
      } catch (e) { out.innerHTML = `<div class="lx-vazio">${esc(e.message)}</div>`; }
    };
  }

  // ── Rota ──────────────────────────────────────────────────────────────────
  Object.assign(ROUTES, {
    async leis(page) {
      garantirCss();
      const estado = await api('/api/leis/estado');
      const admin = USER && USER.role === 'admin';
      page.innerHTML = `
        <div class="page-header"><div><h2>Pesquisa de Leis</h2>
          <p class="sub">Constituição, leis e decretos federais, leis do ES, súmulas, OJs e temas do STF, STJ, TST e TNU e atos do INSS e do MTE, com o link da fonte oficial.</p></div></div>
        <div class="lx-status" id="lx-status"></div>
        <div class="tabs" id="lx-tabs" style="margin-top:12px">
          <button class="tab active" data-tab="pesquisar">Pesquisar</button>
          <button class="tab" data-tab="conferir">Conferir citações</button>
          <button class="tab" data-tab="fundamentos">Fundamentos para a peça</button>
        </div>
        <div id="lx-conteudo"></div>`;
      const status = $('#lx-status');
      status.innerHTML = estado.pronto
        ? `<span>${estado.normas.toLocaleString('pt-BR')} normas, atualizado em ${dataBr(estado.atualizadoEm)}${estado.atualizando ? ' (atualizando agora)' : ''}</span>`
        : `<span>${estado.atualizando ? 'O acervo está sendo baixado pela primeira vez (cerca de 10 minutos).' : 'O acervo ainda não foi baixado.'}</span>`;
      if (admin) {
        const b = el('<button type="button" class="btn-sm">Atualizar agora</button>');
        b.onclick = async () => { try { const r = await api('/api/leis/atualizar', { method: 'POST', body: '{}' }); toast(r.mensagem); } catch (e) { toast(e.message, 'error'); } };
        status.appendChild(b);
      }
      const conteudo = $('#lx-conteudo');
      if (!estado.pronto) { conteudo.innerHTML = '<div class="empty">Assim que o acervo terminar de baixar, a pesquisa aparece aqui. Volte em alguns minutos.</div>'; return; }
      const abas = { pesquisar: (c) => abaPesquisar(c, estado), conferir: abaConferir, fundamentos: abaFundamentos };
      const mostrar = (nome) => {
        document.querySelectorAll('#lx-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === nome));
        abas[nome](conteudo);
      };
      $('#lx-tabs').onclick = (e) => { const t = e.target.closest('.tab'); if (t) mostrar(t.dataset.tab); };
      mostrar('pesquisar');
      const p = new URLSearchParams(location.hash.split('?')[1] || '');
      if (p.get('norma')) abrirLei(p.get('norma'), p.get('art'));
    },
  });
})();
