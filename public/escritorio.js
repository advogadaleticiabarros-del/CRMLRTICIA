// ── Escritório virtual + Métricas da IA ─────────────────────────────────────
// Usa os globais de app.js (api, el, esc, $, openModal, toast, USER) e registra
// a rota em ROUTES. Sala isométrica em SVG com os agentes em estilo minifigura:
// quem está trabalhando digita na mesa, quem está parado circula (café,
// biblioteca, pebolim, videogame), quem está desligado cochila e quem deu erro
// fica na mesa com alerta. A pessoa logada anda pelas setas ou clicando no
// chão e, perto de um agente, vê o trabalho dele ou o chama ao gabinete.
// Os nós SVG são criados uma vez e só reposicionados a cada quadro, para as
// animações de CSS (digitar, andar, piscar) não reiniciarem.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const LARG = 62, ALT = 36, W = 22, D = 10;
  const COLS = 4, ESPACO = 2.3, LIN_ESP = 1.75;
  const ESPINHA_X = 9.7, ALA_X = 15.4, CORREDOR_ALA_Y = 3.85;
  const VELOCIDADE = 1.5;
  const AMARELO = '#f6c90e', AMARELO_SOMBRA = '#d9ac00';
  const COR_STATUS = { trabalhando: '#22c55e', parado: '#eab308', desligado: '#94a3b8', erro: '#ef4444' };
  const ROTULO_STATUS = { trabalhando: 'Trabalhando agora', parado: 'Parado', desligado: 'Desligado', erro: 'Com erro' };
  const COR_TEXTO_STATUS = { trabalhando: '#16a34a', parado: '#ca8a04', desligado: '#64748b', erro: '#dc2626' };

  const iso = (x, y) => ({ x: (x - y) * LARG, y: (x + y) * ALT });
  const pts = (...p) => p.map((q) => `${q.x},${q.y}`).join(' ');
  const up = (p, k) => ({ x: p.x, y: p.y - k });
  const r1 = (n) => Math.round(n * 10) / 10;
  const ANG = r1(Math.atan2(ALT, LARG) * 180 / Math.PI);

  // ── Lugares ───────────────────────────────────────────────────────────────
  const VAGAS = [
    { id: 'cafe1', atividade: 'cafe', p: { x: 13.8, y: 3.2 } },
    { id: 'cafe2', atividade: 'cafe', p: { x: 14.6, y: 3.2 } },
    { id: 'livro1', atividade: 'biblioteca', p: { x: 11.1, y: 1.0 } },
    { id: 'livro2', atividade: 'biblioteca', p: { x: 12.7, y: 1.0 } },
    { id: 'pebolim1', atividade: 'pebolim', p: { x: 11.4, y: 4.6 } },
    { id: 'pebolim2', atividade: 'pebolim', p: { x: 11.4, y: 6.2 } },
    { id: 'game1', atividade: 'videogame', p: { x: 13.2, y: 6.5 } },
    { id: 'game2', atividade: 'videogame', p: { x: 14.0, y: 6.5 } },
    { id: 'cafe3', atividade: 'cafe', p: { x: 12.6, y: 8.9 } },
  ];
  const mesaDe = (i) => {
    const col = i % COLS, lin = Math.floor(i / COLS);
    const bx = 0.9 + col * ESPACO, by = 1.0 + lin * LIN_ESP;
    return { bx, by, lin, assento: { x: bx + 0.62, y: by - 0.38 } };
  };
  const corredorDaLinha = (lin) => 1.0 + lin * LIN_ESP - 0.75;
  const MESA_REUNIAO = { x: 18.7, y: 1.7 };
  const LUGARES_REUNIAO = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    return { x: MESA_REUNIAO.x + Math.cos(a) * 1.8, y: MESA_REUNIAO.y + Math.sin(a) * 1.1 };
  });
  const MESA_DRA = { x: 18.2, y: 5.6, w: 1.8, d: 0.75 };
  const CADEIRA_DRA = { x: 19.1, y: 5.25 };
  const LUGARES_SALA = [{ x: 18.3, y: 7.2 }, { x: 19.3, y: 7.2 }, { x: 17.4, y: 7.0 }, { x: 20.2, y: 7.0 }, { x: 18.8, y: 8.0 }];

  function saida(p, lin) {
    if (p.x > ALA_X) return [{ x: 15.9, y: p.y }, { x: 15.9, y: CORREDOR_ALA_Y }, { x: ESPINHA_X, y: CORREDOR_ALA_Y }];
    if (lin !== null && lin !== undefined) return [{ x: p.x, y: corredorDaLinha(lin) }, { x: ESPINHA_X, y: corredorDaLinha(lin) }];
    return [{ x: ESPINHA_X, y: p.y }];
  }
  const rota = (de, para, linDe, linPara) => [...saida(de, linDe), ...saida(para, linPara).reverse(), para];

  function andar(e, passo) {
    e.andando = e.caminho.length > 0;
    let resta = passo;
    while (resta > 0 && e.caminho.length) {
      const alvo = e.caminho[0], dx = alvo.x - e.pos.x, dy = alvo.y - e.pos.y, dist = Math.hypot(dx, dy);
      if (dist <= resta) { e.pos = { ...alvo }; e.caminho.shift(); resta -= dist; }
      else { e.pos = { x: e.pos.x + (dx / dist) * resta, y: e.pos.y + (dy / dist) * resta }; resta = 0; }
    }
  }

  // ── Peças ─────────────────────────────────────────────────────────────────
  function caixa(x, y, w, d, h, topo, esq, dir, z = 0) {
    const a = iso(x, y), b = iso(x + w, y), c = iso(x + w, y + d), e = iso(x, y + d);
    return `<g><polygon points="${pts(up(e, z), up(c, z), up(c, z + h), up(e, z + h))}" fill="${esq}"/>`
      + `<polygon points="${pts(up(b, z), up(c, z), up(c, z + h), up(b, z + h))}" fill="${dir}"/>`
      + `<polygon points="${pts(up(a, z + h), up(b, z + h), up(c, z + h), up(e, z + h))}" fill="${topo}"/></g>`;
  }

  // Todos de terno (escritório de advocacia): a cor do agente vai na gravata
  // (eles) ou no lenço/broche (elas) e no crachá.
  const VISUAL = {
    laya:        { cabelo: 'ondulado', corCabelo: '#6b21a8', feminina: true, terno: '#1e1b4b' },
    secretaria:  { cabelo: 'coque', corCabelo: '#3f2a1d', feminina: true, extra: 'oculos', terno: '#831843' },
    leitor:      { cabelo: 'curto', corCabelo: '#1c1917', feminina: false, extra: 'oculos', terno: '#1e293b' },
    djen:        { cabelo: 'curto', corCabelo: '#78350f', feminina: false, terno: '#1e3a8a', pele: '#c68642', peleSombra: '#a0692f' },
    tribunais:   { cabelo: 'chanel', corCabelo: '#9ca3af', feminina: true, extra: 'oculos', terno: '#334155' },
    email:       { cabelo: 'curto', corCabelo: '#2b2b2b', feminina: false, terno: '#164e63' },
    carteira:    { cabelo: 'curto', corCabelo: '#292524', feminina: false, terno: '#3f3f46', pele: '#e0ac69', peleSombra: '#b8864b' },
    prazos:      { cabelo: 'rabo', corCabelo: '#111827', feminina: true, extra: 'headset', terno: '#111827' },
    estagiario:  { cabelo: 'cacheado', corCabelo: '#1c1410', feminina: false, terno: '#475569', pele: '#8d5524', peleSombra: '#6b3f1b' },
    agenda:      { cabelo: 'longo', corCabelo: '#b45309', feminina: true, terno: '#4c1d95' },
    financeiro:  { cabelo: 'curto', corCabelo: '#3f2a1d', feminina: false, extra: 'oculos', terno: '#14532d' },
    comercial:   { cabelo: 'longo', corCabelo: '#1f1a17', feminina: true, terno: '#7c2d12' },
    whatsapp:    { cabelo: 'curto', corCabelo: '#1c1917', feminina: false, extra: 'headset', terno: '#1f2937' },
    assistente:  { cabelo: 'blackpower', corCabelo: '#1c1410', feminina: true, extra: 'headset', terno: '#0f172a', pele: '#7a4a2a', peleSombra: '#5a3520' },
    parcerias:   { cabelo: 'ondulado', corCabelo: '#7c2d12', feminina: true, terno: '#581c87' },
    relatorios:  { cabelo: 'chanel', corCabelo: '#facc15', feminina: true, extra: 'oculos', terno: '#374151' },
    guardiao:    { cabelo: 'curto', corCabelo: '#57534e', feminina: false, terno: '#18181b' },
    pesquisador: { cabelo: 'rabo', corCabelo: '#5b3a1a', feminina: true, extra: 'oculos', terno: '#115e59' },
    verificador: { cabelo: 'chanel', corCabelo: '#1f1a17', feminina: true, terno: '#881337', pele: '#8d5524', peleSombra: '#6b3f1b' },
    testador:    { cabelo: 'curto', corCabelo: '#57534e', feminina: false, extra: 'headset', terno: '#292524' },
    voce:        { cabelo: 'longo', corCabelo: '#5a3825', feminina: true, terno: '#1e293b' },
  };

  function cabelo(tipo, cor, corAgente) {
    switch (tipo) {
      case 'rabo': return `<g><path d="M -12 -64 Q -12 -80 0 -80 Q 12 -80 12 -64 L 12 -60 Q 0 -70 -12 -60 Z" fill="${cor}"/><path class="rabo" d="M 10 -72 Q 26 -70 22 -50 Q 20 -44 16 -46 Q 18 -60 9 -64 Z" fill="${cor}"/><circle cx="11" cy="-70" r="2.5" fill="${corAgente}"/></g>`;
      case 'coque': return `<g><path d="M -12 -63 Q -12 -79 0 -79 Q 12 -79 12 -63 L 12 -59 Q 0 -68 -12 -59 Z" fill="${cor}"/><circle cx="0" cy="-83" r="7" fill="${cor}"/></g>`;
      case 'longo': return `<path d="M -13 -62 Q -13 -80 0 -80 Q 13 -80 13 -62 L 14 -36 L 9 -36 L 9 -58 Q 0 -66 -9 -58 L -9 -36 L -14 -36 Z" fill="${cor}"/>`;
      case 'bone': return `<g><path d="M -12 -66 Q -12 -80 0 -80 Q 12 -80 12 -66 Z" fill="#1d4ed8"/><path d="M -12 -66 L 18 -66 Q 20 -63 16 -62 L -12 -62 Z" fill="#1e3a8a"/><text x="0" y="-70" font-size="6" font-weight="800" fill="#fff" text-anchor="middle">LB</text></g>`;
      case 'moicano': return `<path d="M -4 -70 L -6 -86 L -2 -80 L 0 -92 L 2 -80 L 6 -88 L 5 -70 Z" fill="${cor}"/>`;
      case 'blackpower': return `<g><circle cx="0" cy="-68" r="21" fill="${cor}"/>${[[-15, -80], [-6, -87], [5, -87], [14, -80], [-19, -67], [19, -67], [-16, -54], [16, -54]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6" fill="${cor}"/>`).join('')}</g>`;
      case 'curto': return `<g><path d="M -12 -66 Q -12 -81 0 -81 Q 12 -81 12 -66 L 12 -62 L 10 -62 L 10 -67 Q 0 -73 -10 -67 L -10 -62 L -12 -62 Z" fill="${cor}"/><path d="M -6 -80 Q 2 -86 8 -79 Q 2 -81 -6 -80 Z" fill="${cor}"/></g>`;
      case 'cacheado': return `<g>${[-14, -8, -1, 6, 13, -12, 12, -15, 15].map((dx, i) => `<circle cx="${dx}" cy="${i < 5 ? -78 + Math.abs(dx) * 0.2 : i < 7 ? -64 : -52}" r="${i < 5 ? 7 : 6}" fill="${cor}"/>`).join('')}</g>`;
      case 'ondulado': return `<g><path d="M -13 -62 Q -14 -80 0 -80 Q 14 -80 13 -62 Q 16 -54 12 -46 Q 16 -40 11 -36 L 9 -58 Q 0 -66 -9 -58 L -11 -36 Q -16 -40 -12 -46 Q -16 -54 -13 -62 Z" fill="${cor}"/><path d="M 6 -79 Q 13 -70 12 -48" stroke="#f472b6" stroke-width="2.4" fill="none"/></g>`;
      case 'chanel': return `<path d="M -13 -62 Q -13 -80 0 -80 Q 13 -80 13 -62 L 14 -50 L 8 -50 L 8 -60 Q 0 -67 -8 -60 L -8 -50 L -14 -50 Z" fill="${cor}"/>`;
      default: return `<rect x="-6" y="-75" width="12" height="5" rx="1.5" fill="${AMARELO}"/>`;
    }
  }

  /** Minifigura. Origem: sentado = altura do tampo; em pé = pés no chão. */
  function minifig(id, cor, pose, atraso) {
    const v = VISUAL[id] || { corCabelo: '#333', feminina: true, terno: '#1e293b' };
    const terno = v.terno || '#1e293b';
    const emPe = ['andando', 'cafe', 'lendo', 'pebolim', 'empe'].includes(pose);
    const d = `style="animation-delay:${atraso}s"`;
    const bracos = pose === 'digitando' || pose === 'pebolim' || pose === 'jogando' ? 'bracos-rapidos' : pose === 'andando' ? 'bracos-andando' : '';
    const cabecaLonga = ['longo', 'ondulado', 'blackpower'].includes(v.cabelo);
    const pele = v.pele || AMARELO, peleSombra = v.peleSombra || AMARELO_SOMBRA;
    const xicara = pose === 'cafe' || pose === 'sentado';
    return `<g class="fig pose-${pose}" ${d}>`
      + (emPe ? `<g><ellipse cx="0" cy="0" rx="15" ry="5" fill="rgba(15,23,42,.18)"/>
          <g class="perna perna-e" ${d}><rect x="-12" y="-24" width="11" height="24" rx="2" fill="${terno}"/><rect x="-12" y="-4" width="11" height="4" rx="1" fill="#111"/></g>
          <g class="perna perna-d" ${d}><rect x="1" y="-24" width="11" height="24" rx="2" fill="${terno}"/><rect x="1" y="-4" width="11" height="4" rx="1" fill="#111"/></g>
          <rect x="-14" y="-28" width="28" height="5" rx="1.5" fill="${terno}"/></g>` : '')
      + `<g${emPe ? ' transform="translate(0 -14)"' : ''}>
        <g transform="translate(-13 -42)"><g class="braco braco-e ${bracos}" ${d}><path d="M 0 0 Q -7 6 -6 18 L 0 20 Q -1 10 4 4 Z" fill="${terno}"/><path d="M -6.4 16.5 L 0.2 18.5 L 0 20 L -6 18 Z" fill="#fff"/><circle cx="-3" cy="22" r="4.2" fill="${pele}"/><circle cx="-3" cy="24" r="1.8" fill="${peleSombra}"/></g></g>
        <g transform="translate(13 -42)"><g class="braco braco-d ${bracos} ${xicara ? 'gole' : ''}" ${d}><path d="M 0 0 Q 7 6 6 18 L 0 20 Q 1 10 -4 4 Z" fill="${terno}"/><path d="M 6.4 16.5 L -0.2 18.5 L 0 20 L 6 18 Z" fill="#fff"/><circle cx="3" cy="22" r="4.2" fill="${pele}"/><circle cx="3" cy="24" r="1.8" fill="${peleSombra}"/>
          ${xicara ? '<g><rect x="-1" y="14" width="8" height="8" rx="1.5" fill="#fff" stroke="#cbd5e1"/><path d="M 7 16 q 3 2 0 4" stroke="#cbd5e1" fill="none"/></g>' : ''}</g></g>
        <path d="M -12 -46 L 12 -46 L 16 -14 L -16 -14 Z" fill="${terno}"/>
        <path d="M -6.5 -46 L 6.5 -46 L 0 -31 Z" fill="#fff"/>
        ${v.feminina
          ? `<path d="M -5 -46 Q 0 -40 5 -46 L 3 -42 Q 0 -38 -3 -42 Z" fill="${cor}"/><circle cx="7" cy="-37" r="2" fill="${cor}"/>`
          : `<path d="M -1.8 -45 L 1.8 -45 L 2.8 -40 L 0 -31 L -2.8 -40 Z" fill="${cor}"/><path d="M -1.8 -45 L 1.8 -45 L 1.2 -43 L -1.2 -43 Z" fill="rgba(0,0,0,.25)"/>`}
        <path d="M -6.5 -46 L -1 -33 L -8 -38 L -10 -46 Z" fill="rgba(0,0,0,.28)"/>
        <path d="M 6.5 -46 L 1 -33 L 8 -38 L 10 -46 Z" fill="rgba(0,0,0,.28)"/>
        <circle cx="0" cy="-26" r="1.1" fill="rgba(255,255,255,.55)"/><circle cx="0" cy="-20" r="1.1" fill="rgba(255,255,255,.55)"/>
        <path d="M -12 -46 L 12 -46 L 12.6 -42 L -12.6 -42 Z" fill="rgba(255,255,255,.12)"/>
        ${pose === 'lendo' ? `<g><path d="M -14 -26 L 0 -22 L 14 -26 L 14 -12 L 0 -8 L -14 -12 Z" fill="#fff" stroke="#94a3b8"/><path d="M 0 -22 V -8" stroke="#94a3b8"/><path d="M -14 -26 L 0 -22 L 14 -26" stroke="${cor}" stroke-width="2" fill="none"/></g>` : ''}
        ${pose === 'jogando' ? '<g><rect x="-10" y="-24" width="20" height="9" rx="4" fill="#111827"/><circle cx="-5" cy="-19.5" r="1.5" fill="#22c55e"/><circle cx="5" cy="-19.5" r="1.5" fill="#ef4444"/></g>' : ''}
        <rect x="-5" y="-49" width="10" height="4" fill="${peleSombra}"/>
        <g class="cabeca" ${d}>
          ${cabecaLonga ? cabelo(v.cabelo, v.corCabelo, cor) : ''}
          <rect x="-11" y="-72" width="22" height="24" rx="6" fill="${pele}"/>
          <rect x="-11" y="-72" width="5" height="24" rx="3" fill="rgba(255,255,255,.25)"/>
          <g class="olhos" ${d}><ellipse cx="-4.5" cy="-61" rx="1.7" ry="2.1" fill="#111"/><ellipse cx="4.5" cy="-61" rx="1.7" ry="2.1" fill="#111"/>
            ${v.feminina ? '<path d="M -7 -63.5 l -1.6 -1.4 M 7 -63.5 l 1.6 -1.4" stroke="#111" stroke-width="0.9"/>' : ''}</g>
          ${pose === 'dormindo'
            ? '<path d="M -3 -54 q 3 1.5 6 0" stroke="#111" stroke-width="1.2" fill="none"/>'
            : `<path d="${pose === 'pebolim' || pose === 'jogando' ? 'M -5 -56 q 5 7 10 0 Z' : 'M -5 -55 q 5 5 10 0'}" stroke="${v.feminina ? '#dc2626' : '#111'}" stroke-width="${v.feminina ? 1.8 : 1.3}" fill="${pose === 'pebolim' || pose === 'jogando' ? '#fff' : 'none'}" stroke-linecap="round"/>`}
          ${v.feminina ? '<circle cx="-8" cy="-56" r="2" fill="#fb923c" opacity="0.45"/><circle cx="8" cy="-56" r="2" fill="#fb923c" opacity="0.45"/>' : ''}
          ${v.extra === 'oculos' ? '<g stroke="#111" stroke-width="1" fill="rgba(255,255,255,.35)"><circle cx="-4.5" cy="-61" r="3.6"/><circle cx="4.5" cy="-61" r="3.6"/><path d="M -1 -61 h 2"/></g>' : ''}
          ${!cabecaLonga ? cabelo(v.cabelo, v.corCabelo, cor) : ''}
          ${cabecaLonga ? `<path d="M -11 -64 Q -11 -80 0 -80 Q 11 -80 11 -64 Q 4 -72 -11 -64 Z" fill="${v.corCabelo}"/>` : ''}
          ${v.extra === 'headset' ? '<g><path d="M -13 -62 Q -13 -84 0 -84 Q 13 -84 13 -62" stroke="#111827" stroke-width="2" fill="none"/><rect x="-15" y="-65" width="4" height="8" rx="2" fill="#111827"/><path d="M -13 -58 Q -10 -52 -4 -52" stroke="#111827" stroke-width="1.3" fill="none"/></g>' : ''}
        </g>
        ${pose === 'dormindo' ? `<g class="zzz" ${d}><text x="14" y="-80" font-size="10" font-weight="800" fill="#64748b">z</text><text x="20" y="-90" font-size="13" font-weight="800" fill="#64748b">z</text></g>` : ''}
      </g></g>`;
  }

  function quebrar(texto, max = 26, linhas = 2) {
    const out = [''];
    for (const w of String(texto).split(/\s+/)) {
      if ((out[out.length - 1] + ' ' + w).trim().length > max) {
        if (out.length === linhas) { out[out.length - 1] = out[out.length - 1].replace(/.{0,2}$/, '…'); break; }
        out.push(w);
      } else out[out.length - 1] = (out[out.length - 1] + ' ' + w).trim();
    }
    return out;
  }

  // ── Cenário fixo ──────────────────────────────────────────────────────────
  function fundo() {
    const P = 140;
    const jA = iso(0, 1.2), jB = iso(0, 3.2);
    const placa = (t, x) => { const p = up(iso(x, 0), 124); return `<text x="${r1(p.x)}" y="${r1(p.y)}" font-size="11" font-weight="800" fill="#3730a3" text-anchor="middle" transform="rotate(${ANG} ${r1(p.x)} ${r1(p.y)})">${t}</text>`; };
    const a = up(iso(1.4, 0), 112), b = up(iso(7.4, 0), 112), c = up(iso(7.4, 0), 76), e = up(iso(1.4, 0), 76);
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2 + 22;
    const cantos = [iso(0, 0), iso(W, 0), iso(W, D), iso(0, D)];
    return `<polygon points="${pts(iso(0, 0), iso(W, 0), up(iso(W, 0), P), up(iso(0, 0), P))}" fill="#c7d2fe"/>
      <polygon points="${pts(iso(0, 0), iso(0, D), up(iso(0, D), P), up(iso(0, 0), P))}" fill="#e0e7ff"/>
      <polygon points="${pts(iso(0, 0), iso(W, 0), up(iso(W, 0), 14), up(iso(0, 0), 14))}" fill="#a5b4fc"/>
      <polygon id="ev-janela" points="${pts(up(jA, 118), up(jB, 118), up(jB, 50), up(jA, 50))}" fill="#7dd3fc" stroke="#fff" stroke-width="5"/>
      <g id="ev-astro"></g>
      <polyline points="${pts(up(iso(0, 2.2), 118), up(iso(0, 2.2), 50))}" stroke="#fff" stroke-width="4"/>
      <g><polygon points="${pts(a, b, c, e)}" fill="#1e293b"/>
        <text x="${r1(cx)}" y="${r1(cy)}" fill="#e7c77d" font-size="14" font-weight="900" text-anchor="middle" letter-spacing="2" transform="rotate(${ANG} ${r1(cx)} ${r1(cy - 5)})">LETÍCIA BARROS · ADVOCACIA</text></g>
      ${placa('📚 BIBLIOTECA JURÍDICA', 11.8)}${placa('☕ COPA', 14.4)}${placa('🤝 SALA DE REUNIÃO', 18.7)}
      <g id="ev-relogio"></g>
      <polygon points="${pts(...cantos)}" fill="#fde7c4"/>
      ${Array.from({ length: W + 1 }, (_, i) => `<polyline points="${pts(iso(i, 0), iso(i, D))}" stroke="#f3d3a1" stroke-width="1.2" fill="none"/>`).join('')}
      ${Array.from({ length: D + 1 }, (_, i) => `<polyline points="${pts(iso(0, i), iso(W, i))}" stroke="#f3d3a1" stroke-width="1.2" fill="none"/>`).join('')}
      <polygon points="${pts(iso(10.3, 4.2), iso(15.0, 4.2), iso(15.0, 7.4), iso(10.3, 7.4))}" fill="#c4b5fd" opacity="0.45"/>
      <text x="${r1(iso(12.7, 7.4).x)}" y="${r1(iso(12.7, 7.4).y + 14)}" font-size="11" font-weight="800" fill="#6d28d9" text-anchor="middle">🎮 CANTO DO DESCANSO</text>
      <polygon points="${pts(iso(ALA_X + 0.2, 4.6), iso(W - 0.2, 4.6), iso(W - 0.2, D - 0.2), iso(ALA_X + 0.2, D - 0.2))}" fill="#fef3c7" opacity="0.7"/>`;
  }

  function moveis() {
    const itens = [];
    const vidro = (a, b, alto = 44) => `<polygon points="${pts(iso(a.x, a.y), iso(b.x, b.y), up(iso(b.x, b.y), alto), up(iso(a.x, a.y), alto))}" fill="#bfdbfe" opacity="0.35" stroke="#93c5fd" stroke-width="1.5"/>`;
    const planta = (x, y) => { const b = iso(x + 0.22, y + 0.22); return caixa(x, y, 0.45, 0.45, 22, '#b45309', '#92400e', '#78350f') + `<g class="planta">${[-14, 0, 14, -7, 7].map((dx, i) => `<ellipse cx="${r1(b.x + dx)}" cy="${r1(b.y - 36 - (i > 2 ? 12 : 0))}" rx="9" ry="16" fill="${i % 2 ? '#15803d' : '#22c55e'}"/>`).join('')}</g>`; };
    const cores = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316', '#06b6d4'];
    [10.4, 12.0].forEach((x, i) => itens.push({ k: x + 0.3, html: caixa(x, 0.1, 1.5, 0.35, 96, '#78350f', '#92400e', '#7c2d12')
      + [18, 42, 66].map((z, j) => Array.from({ length: 7 }, (_, k) => { const b = iso(x + 0.12 + k * 0.19, 0.45); return `<rect x="${r1(b.x - 4)}" y="${r1(b.y - z - 20 + (k % 3))}" width="7" height="${18 - (k % 3)}" rx="1" fill="${cores[(k + j + i) % 7]}"/>`; }).join('')).join('') }));
    const vap = iso(13.95, 2.47);
    itens.push({ k: 13.6 + 2.2 + 0.6, html: caixa(13.6, 2.2, 1.3, 0.6, 34, '#e5e7eb', '#9ca3af', '#6b7280') + caixa(13.75, 2.3, 0.45, 0.35, 26, '#1f2937', '#111827', '#0b1220', 34)
      + [0, 0.8, 1.6].map((t) => `<circle class="vapor" style="animation-delay:${t}s" cx="${r1(vap.x)}" cy="${r1(vap.y - 66)}" r="4" fill="#fff" opacity="0"/>`).join('')
      + `<text x="${r1(iso(14.5, 2.5).x)}" y="${r1(iso(14.5, 2.5).y - 38)}" font-size="14">🥐</text>` });
    itens.push({ k: 11.4 + 5.4, html: caixa(10.6, 5.0, 1.6, 0.8, 30, '#16a34a', '#166534', '#14532d')
      + `<polygon points="${pts(up(iso(10.7, 5.08), 30.5), up(iso(12.1, 5.08), 30.5), up(iso(12.1, 5.72), 30.5), up(iso(10.7, 5.72), 30.5))}" fill="#22c55e" stroke="#fff" stroke-width="1.2"/>`
      + [10.95, 11.25, 11.55, 11.85].map((x, i) => `<g class="vareta" style="animation-delay:${i * 0.2}s"><polyline points="${pts(up(iso(x, 4.85), 36), up(iso(x, 5.95), 36))}" stroke="#9ca3af" stroke-width="2"/><circle cx="${r1(iso(x, 5.4).x)}" cy="${r1(iso(x, 5.4).y - 36)}" r="3" fill="${i % 2 ? '#ef4444' : '#2563eb'}"/></g>`).join('')
      + `<circle class="bolinha" cx="${r1(iso(11.4, 5.4).x)}" cy="${r1(iso(11.4, 5.4).y - 32)}" r="2.2" fill="#fff"/>` });
    itens.push({ k: 13.5 + 4.8, html: caixa(12.9, 4.6, 1.5, 0.35, 20, '#475569', '#334155', '#1e293b')
      + `<polygon points="${pts(up(iso(13.0, 4.85), 26), up(iso(14.3, 4.85), 26), up(iso(14.3, 4.85), 64), up(iso(13.0, 4.85), 64))}" fill="#0f172a"/>`
      + `<polygon class="tela-game" points="${pts(up(iso(13.08, 4.87), 29), up(iso(14.22, 4.87), 29), up(iso(14.22, 4.87), 61), up(iso(13.08, 4.87), 61))}" fill="#7c3aed"/>`
      + `<text x="${r1(iso(13.65, 4.87).x)}" y="${r1(iso(13.65, 4.87).y - 40)}" font-size="12" text-anchor="middle">🏎️</text>` });
    itens.push({ k: 13.6 + 6.95, html: caixa(12.8, 6.75, 1.8, 0.5, 16, '#f472b6', '#db2777', '#be185d') + caixa(12.8, 7.05, 1.8, 0.2, 34, '#ec4899', '#be185d', '#9d174d') });
    itens.push({ k: 12.6 + 9.6, html: caixa(12.3, 9.4, 0.6, 0.25, 26, '#e5e7eb', '#9ca3af', '#6b7280') + `<text x="${r1(iso(12.6, 9.5).x)}" y="${r1(iso(12.6, 9.5).y - 30)}" font-size="13" text-anchor="middle">☕</text>` });
    itens.push({ k: 0.5 + D - 0.5, html: planta(0.25, D - 0.8) });
    itens.push({ k: 14.9 + 0.6, html: planta(14.7, 0.2) });
    // Sala de reunião (fundo da ala direita)
    itens.push({ k: ALA_X + 1.6, html: vidro({ x: ALA_X, y: 0 }, { x: ALA_X, y: 2.9 }) });
    itens.push({ k: ALA_X + 3.6 + 2, html: vidro({ x: 16.3, y: 3.35 }, { x: W, y: 3.35 }) });
    const cm = iso(MESA_REUNIAO.x, MESA_REUNIAO.y);
    itens.push({ k: MESA_REUNIAO.x + MESA_REUNIAO.y, html: `<ellipse cx="${r1(cm.x)}" cy="${r1(cm.y - 22)}" rx="100" ry="52" fill="#92400e"/><ellipse cx="${r1(cm.x)}" cy="${r1(cm.y - 28)}" rx="100" ry="52" fill="#b45309"/><ellipse cx="${r1(cm.x)}" cy="${r1(cm.y - 28)}" rx="72" ry="35" fill="#c2702a" opacity="0.5"/><text x="${r1(cm.x)}" y="${r1(cm.y - 24)}" font-size="10" font-weight="800" fill="#fde68a" text-anchor="middle">REUNIÃO</text>` });
    itens.push({ k: 0, html: `<polygon points="${pts(up(iso(17.3, 0), 118), up(iso(20.2, 0), 118), up(iso(20.2, 0), 60), up(iso(17.3, 0), 60))}" fill="#fff" stroke="#94a3b8" stroke-width="3"/>`
      + [0, 1, 2].map((k) => `<polyline points="${pts(up(iso(17.6, 0), 104 - k * 13), up(iso(19.2 - k * 0.3, 0), 104 - k * 13))}" stroke="${['#2563eb', '#16a34a', '#ef4444'][k]}" stroke-width="3"/>`).join('') });
    // Gabinete da Dra. Letícia (frente da ala direita)
    itens.push({ k: ALA_X + 4.6 + 1, html: vidro({ x: 16.3, y: 4.35 }, { x: W, y: 4.35 }) });
    itens.push({ k: ALA_X + 6.0, html: vidro({ x: ALA_X, y: 4.8 }, { x: ALA_X, y: D }) });
    itens.push({ k: CADEIRA_DRA.x + CADEIRA_DRA.y - 0.4, html: caixa(CADEIRA_DRA.x - 0.35, CADEIRA_DRA.y - 0.3, 0.7, 0.15, 58, '#111827', '#1f2937', '#0b1220') });
    itens.push({ k: MESA_DRA.x + MESA_DRA.y + 0.6, html: caixa(MESA_DRA.x, MESA_DRA.y, MESA_DRA.w, MESA_DRA.d, 32, '#78350f', '#5c2a0c', '#4a2109')
      + caixa(MESA_DRA.x + 0.2, MESA_DRA.y + 0.15, 0.45, 0.35, 2, '#94a3b8', '#64748b', '#475569', 32)
      + `<text x="${r1(iso(MESA_DRA.x + 1.3, MESA_DRA.y + 0.35).x)}" y="${r1(iso(MESA_DRA.x + 1.3, MESA_DRA.y + 0.35).y - 36)}" font-size="14">⚖️</text>` });
    itens.push({ k: 21.3 + 5.0, html: caixa(21.2, 4.6, 0.35, 1.4, 90, '#1e3a8a', '#1e40af', '#172554')
      + [16, 40, 64].map((z) => Array.from({ length: 6 }, (_, k) => { const b = iso(21.2, 4.75 + k * 0.2); return `<rect x="${r1(b.x - 2)}" y="${r1(b.y - z - 18 + (k % 2))}" width="6" height="16" rx="1" fill="${['#b91c1c', '#1e3a8a', '#15803d', '#a16207', '#7c2d12', '#334155'][k]}"/>`; }).join('')).join('') });
    itens.push({ k: 16.0 + 9.4, html: planta(15.8, 9.2) });
    return itens;
  }

  // ── Tela ──────────────────────────────────────────────────────────────────
  const CSS = `
    .ev-wrap{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:8px;position:relative;overflow:auto}
    .ev-wrap svg{display:block;width:100%;height:auto;min-width:760px}
    .ev-barra{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 12px}
    .ev-chip{display:inline-flex;align-items:center;gap:6px;border:1.5px solid var(--border);background:var(--surface);color:var(--text);border-radius:999px;padding:7px 14px;font-weight:700;font-size:13px;cursor:pointer}
    .ev-chip .bola{width:9px;height:9px;border-radius:50%}
    .ev-chip.cheio{border:0;color:#fff}
    .ev-resumo{display:inline-flex;gap:6px;align-items:center;border:1px solid var(--border);border-radius:999px;padding:7px 14px;font-weight:700;font-size:13px;background:var(--surface)}
    .ev-zoom{position:absolute;top:14px;right:14px;display:flex;gap:6px;align-items:center;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:4px 8px;font-weight:700;font-size:12px;z-index:2}
    .ev-zoom button{border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:6px;width:26px;height:26px;cursor:pointer;font-weight:800}
    .ev-legenda{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--text-muted);margin-top:8px}
    .ev-legenda span{display:inline-flex;gap:5px;align-items:center}
    .ev-legenda i{width:9px;height:9px;border-radius:50%;display:inline-block}
    .ev-hist{list-style:none;margin:10px 0 0;padding:0;max-height:340px;overflow:auto}
    .ev-hist li{border-bottom:1px solid var(--border);padding:8px 2px;font-size:13px;display:flex;gap:10px}
    .ev-hist time{color:var(--text-muted);white-space:nowrap;font-size:12px;min-width:92px}
    .ev-hist .erro{color:var(--red)}
    .pi-abas{display:flex;gap:6px;margin:4px 0 14px}
    .pi-abas button{border:1.5px solid var(--border);background:var(--surface);color:var(--text);border-radius:999px;padding:6px 14px;font-weight:700;cursor:pointer}
    .pi-abas button.on{background:var(--navy);color:var(--surface);border-color:var(--navy)}
    .pi-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px}
    .pi-kpi{border:1px solid var(--border);border-radius:12px;padding:12px;background:var(--surface)}
    .pi-kpi small{display:block;color:var(--text-muted);font-weight:700;font-size:12px}
    .pi-kpi b{display:block;font-size:26px;color:var(--navy);margin:2px 0}
    .pi-kpi span{font-size:11.5px;color:var(--text-muted)}
    .pi-grade{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px}
    .pi-card{border:1px solid var(--border);border-radius:12px;padding:12px;background:var(--surface)}
    .pi-card h4{margin:0 0 10px;font-size:14px;color:var(--navy)}
    .pi-barra{display:grid;grid-template-columns:118px 1fr 40px;gap:8px;align-items:center;font-size:12.5px;margin:6px 0}
    .pi-barra .trilho{background:var(--border);border-radius:6px;height:10px;overflow:hidden}
    .pi-barra .trilho i{display:block;height:100%;border-radius:6px}
    .pi-barra b{text-align:right}
    .pi-vazio{color:var(--text-muted);font-size:12.5px}
    .pi-tabela{width:100%;font-size:12.5px;border-collapse:collapse}
    .pi-tabela td{border-bottom:1px solid var(--border);padding:5px 4px}
    .pi-tabela td:last-child{text-align:right;font-weight:700}
    @media (max-width:600px){.pi-barra{grid-template-columns:96px 1fr 34px}}
    .ev-cartoes{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-top:14px}
    .ev-cartao{border:1px solid var(--border);border-radius:12px;padding:12px;background:var(--surface);cursor:pointer;display:flex;flex-direction:column;gap:6px;min-height:150px;text-align:left;color:var(--text);font:inherit}
    .ev-cartao:hover{border-color:var(--gold)}
    .ev-cartao:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
    .ev-cartao header{display:flex;align-items:center;gap:7px}
    .ev-cartao header b{font-size:14px;flex:1}
    .ev-cartao header .bola{width:9px;height:9px;border-radius:50%;flex:none}
    .ev-cartao header small{font-size:11px;font-weight:700;white-space:nowrap}
    .ev-cartao .faz{font-size:12px;color:#5b7bb4;line-height:1.35}
    .ev-cartao .nums{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;color:var(--text-muted);margin-top:2px}
    .ev-cartao .nums b{color:var(--text);font-size:14px;margin-right:3px}
    .ev-cartao .ult{margin-top:auto;font-size:11.5px;color:#5b7bb4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  `;
  const CSS_SALA = `
    .bracos-rapidos.braco-e{animation:ev-digita .38s ease-in-out infinite alternate}
    .bracos-rapidos.braco-d{animation:ev-digita .38s ease-in-out infinite alternate-reverse}
    @keyframes ev-digita{from{transform:rotate(-6deg)}to{transform:rotate(8deg)}}
    .bracos-andando.braco-e{animation:ev-balanco .5s ease-in-out infinite alternate}
    .bracos-andando.braco-d{animation:ev-balanco .5s ease-in-out infinite alternate-reverse}
    @keyframes ev-balanco{from{transform:rotate(-18deg)}to{transform:rotate(18deg)}}
    .pose-andando .perna-e{animation:ev-passo .5s ease-in-out infinite alternate}
    .pose-andando .perna-d{animation:ev-passo .5s ease-in-out infinite alternate-reverse}
    @keyframes ev-passo{from{transform:translateY(0)}to{transform:translateY(-4px)}}
    .pose-andando{animation:ev-quica .25s ease-in-out infinite alternate}
    @keyframes ev-quica{to{transform:translateY(-2px)}}
    .pose-digitando .cabeca,.pose-jogando .cabeca,.pose-pebolim .cabeca{animation:ev-balanca 2.4s ease-in-out infinite}
    @keyframes ev-balanca{0%,100%{transform:rotate(0)}30%{transform:rotate(-4deg)}60%{transform:rotate(3deg)}}
    .gole{animation:ev-gole 6s ease-in-out infinite}
    @keyframes ev-gole{0%,60%,100%{transform:rotate(0)}70%,82%{transform:rotate(-120deg)}}
    .olhos{animation:ev-pisca 4.5s infinite;transform-origin:0 -61px}
    @keyframes ev-pisca{0%,93%,100%{transform:scaleY(1)}96%{transform:scaleY(.1)}}
    .pose-dormindo .cabeca{transform:rotate(14deg) translateY(4px)}
    .pose-dormindo .olhos{animation:none;transform:scaleY(.12)}
    .zzz{animation:ev-sobe 2.6s ease-in infinite}
    @keyframes ev-sobe{0%{opacity:0;transform:translate(0,6px)}30%{opacity:1}100%{opacity:0;transform:translate(6px,-14px)}}
    .rabo{transform-origin:10px -66px;animation:ev-rabo 1.8s ease-in-out infinite}
    @keyframes ev-rabo{50%{transform:rotate(8deg)}}
    .tela-linhas{animation:ev-rola 1.2s linear infinite}
    @keyframes ev-rola{from{transform:translateY(0)}to{transform:translateY(-6px)}}
    .icone{animation:ev-flutua 3.2s ease-out infinite;opacity:0}
    @keyframes ev-flutua{0%{opacity:0;transform:translateY(0) scale(.6)}15%{opacity:1;transform:translateY(-6px) scale(1)}100%{opacity:0;transform:translateY(-46px) scale(.9)}}
    .balao{animation:ev-pop .5s cubic-bezier(.3,1.6,.5,1) both;transform-box:fill-box;transform-origin:50% 100%}
    @keyframes ev-pop{from{transform:scale(.4);opacity:0}to{transform:scale(1);opacity:1}}
    .vapor{animation:ev-vapor 2.4s ease-out infinite}
    @keyframes ev-vapor{0%{opacity:0;transform:translateY(0)}30%{opacity:.8}100%{opacity:0;transform:translateY(-22px)}}
    .planta{transform-origin:50% 100%;transform-box:fill-box;animation:ev-vento 5s ease-in-out infinite}
    @keyframes ev-vento{50%{transform:rotate(3deg)}}
    .vareta{animation:ev-vareta .6s ease-in-out infinite alternate}
    @keyframes ev-vareta{to{transform:translate(3px,-2px)}}
    .bolinha{animation:ev-bola 1.6s ease-in-out infinite alternate}
    @keyframes ev-bola{to{transform:translate(38px,20px)}}
    .tela-game{animation:ev-game 1.5s steps(3) infinite}
    @keyframes ev-game{33%{fill:#db2777}66%{fill:#2563eb}}
    .diamante{animation:ev-diamante 2.6s ease-in-out infinite;transform-box:fill-box;transform-origin:50% 50%}
    @keyframes ev-diamante{0%,100%{transform:translateY(0) rotate(-4deg)}50%{transform:translateY(-7px) rotate(4deg)}}
    .luz-trabalhando,.luz-erro,.aura{animation:ev-pulsa 1.4s ease-in-out infinite}
    @keyframes ev-pulsa{50%{opacity:.35}}
    .mesa{cursor:pointer}
    @media (prefers-reduced-motion:reduce){.fig,.fig *,.icone,.balao,.vapor,.planta,.vareta,.bolinha,.tela-game,.diamante,.zzz{animation:none!important}}
  `;
  function garantirCss() {
    if (document.getElementById('escritorio-css')) return;
    const s = document.createElement('style'); s.id = 'escritorio-css'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  const novo = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };

  // Agente desenhado na mesa: cadeira, boneco (se sentado), mesa, monitor, crachá.
  function htmlMesa(a, i, sentado, pose) {
    const { bx, by } = mesaDe(i);
    const nb = iso(bx + 0.12, by + 0.2), topoMesa = iso(bx + 0.62, by + 0.12);
    const trabalhando = a.status === 'trabalhando';
    return caixa(bx + 0.32, by - 0.2, 0.6, 0.1, 44, '#4338ca', '#3730a3', '#312e81')
      + (sentado ? `<g transform="translate(${r1(topoMesa.x)} ${r1(topoMesa.y - 30)})">${minifig(a.id, a.cor, pose, -(i * 0.37))}</g>` : '')
      + caixa(bx, by, 1.2, 0.7, 30, '#fef3c7', '#e5c07b', '#d4a857')
      + caixa(bx + 0.1, by + 0.15, 0.35, 0.4, 2, '#94a3b8', '#64748b', '#475569', 30)
      + `<polygon points="${pts(up(nb, 32), up(iso(bx + 0.12, by + 0.55), 32), up(iso(bx + 0.12, by + 0.55), 58), up(nb, 58))}" fill="#1e293b"/>`
      + `<polygon points="${pts(up(nb, 35), up(iso(bx + 0.12, by + 0.52), 35), up(iso(bx + 0.12, by + 0.52), 55), up(nb, 55))}" fill="${a.status === 'desligado' ? '#0f172a' : a.status === 'erro' ? '#ef4444' : '#38bdf8'}"/>`
      + (a.status !== 'desligado' ? `<g class="${trabalhando && sentado ? 'tela-linhas' : ''}">${[0, 1, 2].map((k) => `<line x1="${r1(nb.x - 3 - k)}" y1="${r1(nb.y - 50 + k * 5)}" x2="${r1(nb.x - 13 - k)}" y2="${r1(nb.y - 44 + k * 5)}" stroke="#e0f2fe" stroke-width="1.4"/>`).join('')}</g>` : '')
      + caixa(bx + 0.95, by + 0.45, 0.12, 0.12, 9, '#fff', a.cor, a.cor, 30)
      + (trabalhando && sentado ? ['⚖️', '📄', '✅'].map((ic, k) => `<text class="icone" style="animation-delay:${k * 1.05 - i * 0.3}s" x="${r1(topoMesa.x + 26 + k * 4)}" y="${r1(topoMesa.y - 40)}" font-size="13">${ic}</text>`).join('') : '')
      + (a.status === 'erro' && sentado ? `<text x="${r1(topoMesa.x + 24)}" y="${r1(topoMesa.y - 52)}" font-size="16">⚠️</text>` : '');
  }

  function htmlCracha(a) {
    const balao = a.status === 'trabalhando' && a.ultima ? quebrar(a.ultima.texto) : null;
    return `<rect x="-52" y="-12" width="104" height="22" rx="11" fill="#0f172a" opacity="0.92"/>
      <circle cx="-40" cy="-1" r="6.5" fill="${a.cor}"/><text x="-40" y="2" font-size="7.5" font-weight="800" fill="#fff" text-anchor="middle">${esc(a.nome[0])}</text>
      <text x="3" y="3" fill="#f8fafc" font-size="11" font-weight="700" text-anchor="middle">${esc(a.nome)}</text>
      <circle class="luz-${a.status}" cx="42" cy="-1" r="4.2" fill="${COR_STATUS[a.status]}"/>
      ${a.id === 'laya' ? `<g transform="translate(0 -34)"><g class="diamante"><polygon points="-11,-4 -6,-11 6,-11 11,-4 0,11" fill="#a5f3fc" stroke="#0891b2" stroke-width="1.2" stroke-linejoin="round"/><polygon points="-11,-4 11,-4 0,11" fill="#67e8f9"/><polygon points="-6,-11 -2,-4 2,-4 6,-11" fill="#ecfeff"/></g></g>` : ''}
      ${balao ? `<g class="balao"><rect x="-92" y="${-22 - balao.length * 14 - (a.id === 'laya' ? 26 : 0)}" width="184" height="${balao.length * 14 + 10}" rx="10" fill="#fff" stroke="${a.cor}" stroke-width="1.5"/>${balao.map((l, k) => `<text x="0" y="${-22 - balao.length * 14 - (a.id === 'laya' ? 26 : 0) + 16 + k * 14}" font-size="11" fill="#0f172a" text-anchor="middle">${esc(l)}</text>`).join('')}</g>` : ''}`;
  }

  function montarSala(container, agentesIniciais, aoSelecionar) {
    const svg = novo('svg', { role: 'img', 'aria-label': 'Escritório virtual com os agentes do escritório', preserveAspectRatio: 'xMidYMid meet' });
    const cantos = [iso(0, 0), iso(W, 0), iso(W, D), iso(0, D)];
    const minX = cantos[3].x - 20, maxX = cantos[1].x + 20, minY = cantos[0].y - 200, maxY = cantos[2].y + 20;
    svg.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
    const estilo = novo('style'); estilo.textContent = CSS_SALA; svg.appendChild(estilo);
    const gFundo = novo('g'); gFundo.innerHTML = fundo(); svg.appendChild(gFundo);
    const camada = novo('g'); svg.appendChild(camada);
    const gRotulos = novo('g', { style: 'pointer-events:none' }); svg.appendChild(gRotulos);
    const gPerto = novo('g'); svg.appendChild(gPerto);
    container.appendChild(svg);

    // Placa do gabinete
    const pl = up(iso(19.2, 4.35), 58);
    gRotulos.insertAdjacentHTML('beforeend', `<g><rect x="${r1(pl.x - 104)}" y="${r1(pl.y - 12)}" width="208" height="22" rx="5" fill="#0f172a"/><text x="${r1(pl.x)}" y="${r1(pl.y + 3)}" font-size="10" font-weight="800" fill="#e7c77d" text-anchor="middle">GABINETE DA DRA. LETÍCIA BARROS</text></g>`);

    const nos = []; // { k, node }
    for (const m of moveis()) { const g = novo('g'); g.innerHTML = m.html; nos.push({ k: m.k, node: g }); camada.appendChild(g); }

    let agentes = agentesIniciais;
    const estados = {};
    const porId = {};
    const criarAgente = (a, i) => {
      const m = mesaDe(i);
      const mesa = novo('g', { class: 'mesa', tabindex: '0', role: 'button', 'aria-label': `Mesa de ${a.nome}` });
      mesa.addEventListener('click', (ev) => { ev.stopPropagation(); aoSelecionar(a.id); });
      mesa.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); aoSelecionar(a.id); } });
      const fig = novo('g', { style: 'cursor:pointer' });
      fig.addEventListener('click', (ev) => { ev.stopPropagation(); aoSelecionar(a.id); });
      const tag = novo('g');
      gRotulos.appendChild(tag);
      const regMesa = { k: m.bx + m.by + 0.6, node: mesa }, regFig = { k: 0, node: fig };
      nos.push(regMesa, regFig); camada.appendChild(mesa); camada.appendChild(fig);
      porId[a.id] = { mesa, fig, tag, regFig, assinaturaMesa: '', assinaturaFig: '', assinaturaTag: '' };
      estados[a.id] = { pos: { ...m.assento }, caminho: [], atividade: 'mesa', vaga: null, ate: performance.now() + 3000 + Math.random() * 6000, andando: false, chamado: null };
    };
    agentes.forEach(criarAgente);

    // Pessoa logada
    const eu = { pos: { x: 17.0, y: 8.6 }, caminho: [], andando: false };
    const figEu = novo('g'); const regEu = { k: 0, node: figEu }; nos.push(regEu); camada.appendChild(figEu);
    const tagEu = novo('g'); gRotulos.appendChild(tagEu);
    const meuNome = (typeof USER !== 'undefined' && USER?.name ? String(USER.name).split(' ')[0] : 'Você');
    let assinaturaEu = '';
    const teclas = new Set();
    const chamados = {};

    const ignora = (ev) => { const t = ev.target; return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
    const baixa = (ev) => {
      if (ignora(ev) || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(ev.key) || !document.body.contains(svg)) return;
      ev.preventDefault(); teclas.add(ev.key); eu.caminho = [];
    };
    const sobe = (ev) => teclas.delete(ev.key);
    window.addEventListener('keydown', baixa); window.addEventListener('keyup', sobe);
    svg.addEventListener('click', (ev) => {
      if (ev.target.closest && ev.target.closest('[data-acao]')) return;
      const ctm = svg.getScreenCTM(); if (!ctm) return;
      const pt = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(ctm.inverse());
      const gx = (pt.x / LARG + pt.y / ALT) / 2, gy = (pt.y / ALT - pt.x / LARG) / 2;
      if (gx < 0.2 || gy < 0.2 || gx > W - 0.2 || gy > D - 0.2) return;
      eu.caminho = rota(eu.pos, { x: gx, y: gy }, null, null);
    });
    gPerto.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-acao]'); if (!b) return;
      ev.stopPropagation();
      const id = b.getAttribute('data-id'), acao = b.getAttribute('data-acao');
      if (acao === 'ver') aoSelecionar(id);
      else if (acao === 'chamar') chamados[id] = 'sala';
      else if (acao === 'liberar') delete chamados[id];
      assinaturaPerto = '';
    });
    let assinaturaPerto = '';

    const relogio = gFundo.querySelector('#ev-relogio'), janela = gFundo.querySelector('#ev-janela'), astro = gFundo.querySelector('#ev-astro');
    const pr = up(iso(8.6, 0), 92);
    let ultimoSegundo = -1;
    const desenharRelogio = () => {
      const agora = new Date();
      if (agora.getSeconds() === ultimoSegundo) return;
      ultimoSegundo = agora.getSeconds();
      const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(agora));
      const mi = agora.getUTCMinutes(), s = agora.getUTCSeconds();
      relogio.innerHTML = `<g transform="translate(${r1(pr.x)} ${r1(pr.y)})"><ellipse rx="20" ry="22" fill="#fff" stroke="#1e293b" stroke-width="3"/>
        ${Array.from({ length: 12 }, (_, i) => `<circle cx="${r1(Math.sin(i * Math.PI / 6) * 15)}" cy="${r1(-Math.cos(i * Math.PI / 6) * 16)}" r="1.2" fill="#334155"/>`).join('')}
        <line x1="0" y1="0" x2="0" y2="-9" stroke="#0f172a" stroke-width="3" stroke-linecap="round" transform="rotate(${(h % 12) * 30 + mi * 0.5})"/>
        <line x1="0" y1="0" x2="0" y2="-14" stroke="#0f172a" stroke-width="2" stroke-linecap="round" transform="rotate(${mi * 6 + s * 0.1})"/>
        <line x1="0" y1="2" x2="0" y2="-15" stroke="#ef4444" stroke-width="1" transform="rotate(${s * 6})"/><circle r="2" fill="#ef4444"/></g>`;
      if (s === 0 || !astro.innerHTML) {
        const dia = h >= 6 && h < 18, tarde = h >= 17 && h < 19;
        const ceu = dia ? (tarde ? '#fdba74' : '#7dd3fc') : '#1e1b4b';
        janela.setAttribute('fill', ceu);
        const jA = iso(0, 1.2), jB = iso(0, 3.2), jM = { x: (jA.x + jB.x) / 2, y: (jA.y + jB.y) / 2 };
        astro.innerHTML = dia ? `<circle cx="${r1(jM.x - 14)}" cy="${r1(jM.y - 96)}" r="9" fill="#fde047"/>`
          : `<circle cx="${r1(jM.x - 14)}" cy="${r1(jM.y - 96)}" r="8" fill="#f8fafc"/><circle cx="${r1(jM.x - 10)}" cy="${r1(jM.y - 99)}" r="7" fill="${ceu}"/>`;
      }
    };

    let vivo = true, ultimo = performance.now(), ordemAnterior = '';
    const quadro = () => {
      if (!vivo) return;
      if (!document.body.contains(svg)) { parar(); return; }
      const agoraMs = performance.now();
      const dt = Math.min(0.12, (agoraMs - ultimo) / 1000);
      ultimo = agoraMs;
      const ocupadas = new Set(Object.values(estados).map((e) => e.vaga).filter(Boolean));
      let naSala = 0;
      const cabecas = {};
      agentes.forEach((a, i) => {
        const m = mesaDe(i), e = estados[a.id], r = porId[a.id];
        if (!e || !r) return;
        const naMesa = e.atividade === 'mesa' && !e.caminho.length;
        const irPara = (atividade, destino, vaga) => {
          e.caminho = rota(e.pos, destino, naMesa ? m.lin : null, atividade === 'mesa' ? m.lin : null);
          e.atividade = atividade; e.vaga = vaga; e.ate = agoraMs + 9000 + Math.random() * 9000;
        };
        const chamado = chamados[a.id] || null;
        if (chamado) {
          if (e.chamado !== chamado) {
            e.chamado = chamado;
            irPara(chamado, chamado === 'reuniao' ? LUGARES_REUNIAO[i % LUGARES_REUNIAO.length] : LUGARES_SALA[naSala % LUGARES_SALA.length], null);
          }
          if (chamado === 'sala') naSala++;
        } else {
          if (e.chamado) { e.chamado = null; e.ate = agoraMs; }
          if (a.status !== 'parado' && e.atividade !== 'mesa') irPara('mesa', m.assento, null);
          else if (a.status === 'parado' && !e.caminho.length && agoraMs > e.ate) {
            const livres = VAGAS.filter((v) => !ocupadas.has(v.id));
            if (!naMesa && Math.random() < 0.35) irPara('mesa', m.assento, null);
            else if (livres.length) { const v = livres[Math.floor(Math.random() * livres.length)]; ocupadas.add(v.id); irPara(v.atividade, v.p, v.id); }
            else e.ate = agoraMs + 4000;
          }
        }
        andar(e, VELOCIDADE * dt);

        const sentado = e.atividade === 'mesa' && !e.andando && Math.hypot(e.pos.x - m.assento.x, e.pos.y - m.assento.y) < 0.05;
        const poseMesa = a.status === 'desligado' ? 'dormindo' : a.status === 'trabalhando' ? 'digitando' : 'sentado';
        const assMesa = `${sentado}|${poseMesa}|${a.status}|${a.cor}`;
        if (assMesa !== r.assinaturaMesa) { r.mesa.innerHTML = htmlMesa(a, i, sentado, poseMesa); r.assinaturaMesa = assMesa; }

        let pose = 'andando';
        if (!e.andando) pose = { cafe: 'cafe', biblioteca: 'lendo', pebolim: 'pebolim', videogame: 'jogando', reuniao: 'empe', sala: 'empe' }[e.atividade] || 'andando';
        const sofa = pose === 'jogando';
        const assFig = sentado ? 'oculto' : `${pose}|${a.cor}`;
        if (assFig !== r.assinaturaFig) { r.fig.innerHTML = sentado ? '' : minifig(a.id, a.cor, pose, -(i * 0.37)); r.assinaturaFig = assFig; }
        const p = iso(e.pos.x, e.pos.y);
        if (!sentado) r.fig.setAttribute('transform', `translate(${r1(p.x)} ${r1(p.y - (sofa ? 16 : 0))})`);
        r.regFig.k = e.pos.x + e.pos.y + (sofa ? 0.2 : 0);

        const topoMesa = iso(m.bx + 0.62, m.by + 0.12);
        const cab = sentado ? { x: topoMesa.x, y: topoMesa.y - 122 } : { x: p.x, y: p.y - (sofa ? 16 : 0) - 106 };
        cabecas[a.id] = cab;
        const assTag = `${a.status}|${a.ultima?.texto || ''}|${a.nome}`;
        if (assTag !== r.assinaturaTag) { r.tag.innerHTML = htmlCracha(a); r.assinaturaTag = assTag; }
        r.tag.setAttribute('transform', `translate(${r1(cab.x)} ${r1(cab.y)})`);
      });

      // Pessoa logada: setas movem livremente; clique segue o caminho.
      if (teclas.size) {
        const v = 2.2 * dt; let dx = 0, dy = 0;
        if (teclas.has('ArrowUp')) { dx -= v; dy -= v; }
        if (teclas.has('ArrowDown')) { dx += v; dy += v; }
        if (teclas.has('ArrowLeft')) { dx -= v; dy += v; }
        if (teclas.has('ArrowRight')) { dx += v; dy -= v; }
        eu.pos = { x: Math.min(W - 0.3, Math.max(0.3, eu.pos.x + dx * 0.7)), y: Math.min(D - 0.3, Math.max(0.3, eu.pos.y + dy * 0.7)) };
        eu.andando = true;
      } else andar(eu, 2.0 * dt);
      const pe = iso(eu.pos.x, eu.pos.y);
      const assEu = eu.andando ? 'andando' : 'empe';
      if (assEu !== assinaturaEu) {
        figEu.innerHTML = `<ellipse cx="0" cy="0" rx="22" ry="8" fill="none" stroke="#e7c77d" stroke-width="2.5" class="aura"/>${minifig('voce', '#2a3f5f', assEu, 0)}`;
        tagEu.innerHTML = `<rect x="-52" y="-124" width="104" height="22" rx="11" fill="#e7c77d"/><text x="0" y="-109" font-size="11" font-weight="800" fill="#0f172a" text-anchor="middle">⭐ ${esc(meuNome)} (você)</text>`;
        assinaturaEu = assEu;
      }
      figEu.setAttribute('transform', `translate(${r1(pe.x)} ${r1(pe.y)})`);
      tagEu.setAttribute('transform', `translate(${r1(pe.x)} ${r1(pe.y)})`);
      regEu.k = eu.pos.x + eu.pos.y + 0.05;

      // Agente mais perto (até 1,5 célula): ver o trabalho ou chamar ao gabinete.
      let perto = null;
      agentes.forEach((a) => {
        const e = estados[a.id]; if (!e) return;
        const d = Math.hypot(e.pos.x - eu.pos.x, e.pos.y - eu.pos.y);
        if (d < 1.5 && (!perto || d < perto.d)) perto = { a, p: e.pos, d };
      });
      const assPerto = perto && !eu.andando ? `${perto.a.id}|${chamados[perto.a.id] || ''}` : '';
      if (assPerto !== assinaturaPerto) {
        if (!assPerto) gPerto.innerHTML = '';
        else {
          const { a, p } = perto, c = iso(p.x, p.y), bx = c.x + 34, by = c.y - 150;
          const botoes = [['ver', '👀 Ver trabalho'], chamados[a.id] ? ['liberar', '✅ Liberar'] : ['chamar', '📞 Chamar ao gabinete']];
          gPerto.innerHTML = `<g class="balao"><rect x="${r1(bx)}" y="${r1(by)}" width="176" height="78" rx="12" fill="#fff" stroke="${a.cor}" stroke-width="2"/>
            <text x="${r1(bx + 12)}" y="${r1(by + 20)}" font-size="12" font-weight="800" fill="#0f172a">${esc(a.nome)} · ${esc(a.cargo)}</text>
            ${botoes.map(([acao, t], k) => `<g data-acao="${acao}" data-id="${a.id}" style="cursor:pointer"><rect x="${r1(bx + 10)}" y="${r1(by + 28 + k * 24)}" width="156" height="20" rx="6" fill="${k === 0 ? a.cor : '#0f172a'}"/><text x="${r1(bx + 88)}" y="${r1(by + 42 + k * 24)}" font-size="11" font-weight="700" fill="#fff" text-anchor="middle">${t}</text></g>`).join('')}</g>`;
        }
        assinaturaPerto = assPerto;
      }

      // Profundidade: reordena só quando a ordem muda.
      nos.sort((x, y) => x.k - y.k);
      const ordem = nos.map((n) => n.k.toFixed(2)).join(',');
      if (ordem !== ordemAnterior) { nos.forEach((n) => camada.appendChild(n.node)); ordemAnterior = ordem; }
      desenharRelogio();
      setTimeout(() => requestAnimationFrame(quadro), 40);
    };
    const parar = () => { vivo = false; window.removeEventListener('keydown', baixa); window.removeEventListener('keyup', sobe); };
    requestAnimationFrame(quadro);

    return {
      atualizar(novos) {
        const ids = new Set(agentes.map((x) => x.id));
        agentes = novos;
        novos.forEach((a, i) => { if (!ids.has(a.id)) criarAgente(a, i); });
      },
      reunir(sim) {
        for (const k of Object.keys(chamados)) delete chamados[k];
        if (sim) agentes.filter((a) => a.status !== 'desligado').forEach((a) => { chamados[a.id] = 'reuniao'; });
      },
      parar,
    };
  }

  // ── Painel de um agente ───────────────────────────────────────────────────
  const haQuanto = (iso) => {
    const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    const h = Math.round(min / 60);
    return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} d`;
  };
  const quando = (iso) => iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  async function abrirAgente(id) {
    const corpo = el('<div><div class="spinner"></div></div>');
    openModal('Agente', corpo, { wide: true });
    try {
      const r = await api(`/api/escritorio/agente/${encodeURIComponent(id)}`);
      const a = r.agente;
      $('#modal-title').textContent = `${a.nome} · ${a.cargo}`;
      corpo.innerHTML = `
        <p style="margin:0 0 8px"><span class="ev-chip" style="cursor:default"><span class="bola" style="background:${COR_STATUS[a.status]}"></span>${ROTULO_STATUS[a.status]}</span>
          <span style="color:var(--text-muted);font-size:13px;margin-left:8px">${a.depto} · ${a.execucoes24h} ação(ões) nas últimas 24h</span></p>
        <p style="font-size:14.5px;line-height:1.55">${esc(a.descricao)}</p>
        ${a.ultima ? `<p style="font-size:13.5px"><b>Última ação:</b> ${esc(a.ultima.texto)} ${a.ultima.em ? `<small style="color:var(--text-muted)">(${quando(a.ultima.em)})</small>` : ''}</p>` : ''}
        ${r.rotinas.length ? `<p style="font-size:12px;color:var(--text-muted)">Rotinas: ${r.rotinas.map(esc).join(', ')}</p>` : ''}
        <h4 style="margin:14px 0 0;color:var(--navy)">Trabalho recente</h4>
        ${r.historico.length ? `<ul class="ev-hist">${r.historico.map((h) => `<li><time>${quando(h.em)}</time><span class="${h.erro ? 'erro' : ''}">${h.erro ? '❌ ' : ''}${esc(h.texto)}</span></li>`).join('')}</ul>`
          : `<p class="pi-vazio">${a.emConstrucao ? 'Este agente ainda está em construção.' : 'Nada registrado nos últimos dias.'}</p>`}`;
    } catch (e) { corpo.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  // ── Métricas da IA ────────────────────────────────────────────────────────
  const ROT_PRAZO = { confirmado: '✅ Confirmados', descartado: '🗑️ Descartados (já tratados)', a_confirmar: '⏳ A confirmar' };
  const ROT_DECISAO = { sim: '✅ Favoráveis', parcial: '🟡 Em parte', nao: '❌ Desfavoráveis', indefinido: '⚪ Sem cliente vinculado' };
  const ROT_PROPOSTA = { rascunho: 'Rascunho', enviada: 'Enviada', em_negociacao: 'Em negociação', aceita: 'Aceita', recusada: 'Recusada', expirada: 'Expirada' };
  const barras = (itens, cor, rotulos = {}) => {
    const max = Math.max(1, ...itens.map((x) => x.n));
    return itens.length ? itens.map((x) => `<div class="pi-barra"><span>${esc(rotulos[x.rotulo] || x.rotulo || x.nome)}</span><div class="trilho"><i style="width:${Math.round((x.n / max) * 100)}%;background:${x.cor || cor}"></i></div><b>${x.n}</b></div>`).join('')
      : '<p class="pi-vazio">Nada no período.</p>';
  };
  const colunas = (serie, cor) => {
    const max = Math.max(1, ...serie.map((s) => s.chamadas));
    const w = 300, h = 90, larg = w / serie.length;
    const dd = (d) => d.slice(8, 10) + '/' + d.slice(5, 7);
    return `<svg viewBox="0 0 ${w} ${h + 16}" style="width:100%;height:auto" role="img" aria-label="Chamadas por dia">
      ${serie.map((s, i) => { const bh = Math.round((s.chamadas / max) * h); return `<rect x="${r1(i * larg + larg * 0.15)}" y="${h - bh}" width="${r1(larg * 0.7)}" height="${bh}" rx="1.5" fill="${cor}"><title>${dd(s.dia)}: ${s.chamadas}</title></rect>`; }).join('')}
      <text x="0" y="${h + 13}" font-size="9" fill="currentColor" opacity=".6">${serie[0] ? dd(serie[0].dia) : ''}</text>
      <text x="${w}" y="${h + 13}" font-size="9" fill="currentColor" opacity=".6" text-anchor="end">hoje</text></svg>`;
  };

  async function abrirPainelIa(dias = 30) {
    const corpo = el('<div><div class="spinner"></div></div>');
    openModal('📊 Métricas da IA', corpo, { wide: true });
    const carregar = async (d) => {
      corpo.innerHTML = '<div class="spinner"></div>';
      try {
        const m = await api(`/api/escritorio/painel-ia?dias=${d}`);
        const k = m.kpis;
        const tile = (rot, val, sub) => `<div class="pi-kpi"><small>${rot}</small><b>${val}</b><span>${sub}</span></div>`;
        corpo.innerHTML = `
          <p style="margin:0 0 6px;color:var(--text-muted);font-size:13px">Os agentes, o trabalho que fizeram, as suas intervenções e o uso das IAs.</p>
          <div class="pi-abas">${[7, 30, 90].map((x) => `<button data-dias="${x}" class="${x === d ? 'on' : ''}">Últimos ${x} dias</button>`).join('')}</div>
          <div class="pi-kpis">
            ${tile('Possíveis clientes', k.leads, `${k.leadsQualificados} qualificados pela IA · ${k.leadsConvertidos} viraram clientes`)}
            ${tile('Decisões lidas', k.decisoesLidas, 'sentenças e acórdãos resumidos à Dra.')}
            ${tile('Movimentações analisadas', k.movimentacoesAnalisadas, `de ${k.movimentacoesRecebidas} recebidas dos tribunais`)}
            ${tile('Suas intervenções', k.intervencoes, `${k.prazosConfirmados} prazos confirmados · ${k.prazosDescartados} descartados`)}
            ${tile('Laya acionada', k.layaAcionada, `${k.layaDecidiuSozinha} decisão(ões) sozinha, sem IA paga`)}
            ${tile('IA sem custo', k.percentualSemCusto + '%', `${k.iaPaga} chamadas à OpenAI (paga) de ${k.iaTotal}`)}
          </div>
          <div class="pi-grade">
            <div class="pi-card"><h4>Trabalho por agente</h4>${barras(m.trabalhoPorAgente.filter((x) => x.n).slice(0, 10).map((x) => ({ ...x, rotulo: x.nome })), '#2563eb')}</div>
            <div class="pi-card"><h4>Prazos detectados: o que aconteceu</h4>${barras(m.prazos, '#7c3aed', ROT_PRAZO)}</div>
            <div class="pi-card"><h4>Leitura das decisões: resultado</h4>${barras(m.decisoes, '#0ea5e9', ROT_DECISAO)}</div>
            <div class="pi-card"><h4>Propostas: status</h4>${barras(m.propostas, '#ea580c', ROT_PROPOSTA)}</div>
            <div class="pi-card"><h4>Automações (estagiário e outras)</h4>${barras(m.automacoes, '#475569')}</div>
            <div class="pi-card"><h4>Chamadas à IA paga (OpenAI) por dia</h4>${colunas(m.seriePaga, '#2563eb')}</div>
            <div class="pi-card"><h4>Laya (grátis) acionada por dia</h4>${colunas(m.serieLaya, '#db2777')}</div>
            <div class="pi-card"><h4>IA grátis (Groq e Gemini) por dia</h4>${colunas(m.serieGratis, '#16a34a')}</div>
          </div>
          <details style="margin-top:12px"><summary style="cursor:pointer;font-weight:700">Ver os números em tabela</summary>
            <table class="pi-tabela" style="margin-top:8px"><tbody>
              ${Object.entries(m.uso.porProvedor).map(([p, n]) => `<tr><td>Chamadas · ${esc(p)}</td><td>${n}</td></tr>`).join('')}
              ${m.trabalhoPorAgente.map((x) => `<tr><td>${esc(x.nome)} · ${esc(x.cargo)}</td><td>${x.n}</td></tr>`).join('')}
              <tr><td>Minutas do Estagiário</td><td>${k.minutasEstagiario}</td></tr>
            </tbody></table></details>`;
        corpo.querySelectorAll('[data-dias]').forEach((b) => b.onclick = () => carregar(Number(b.dataset.dias)));
      } catch (e) { corpo.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
    };
    await carregar(dias);
  }

  // ── Rota ──────────────────────────────────────────────────────────────────
  Object.assign(ROUTES, {
    async escritorio(page) {
      garantirCss();
      const r = await api('/api/escritorio');
      page.innerHTML = `
        <div class="page-header"><div><h2>Escritório virtual</h2>
          <p class="sub">Ande com as setas do teclado ou clicando no chão. Chegue perto de um agente para ver o trabalho dele ou chamá-lo ao gabinete.</p></div></div>
        <div class="ev-barra" id="ev-barra"></div>
        <div class="ev-wrap"><div class="ev-zoom"><button type="button" id="ev-menos" aria-label="Diminuir">−</button><span id="ev-zv">100%</span><button type="button" id="ev-mais" aria-label="Aumentar">+</button></div><div id="ev-sala"></div></div>
        <div class="ev-legenda">${Object.entries(ROTULO_STATUS).map(([s, t]) => `<span><i style="background:${COR_STATUS[s]}"></i>${t}</span>`).join('')}</div>
        <div class="ev-cartoes" id="ev-cartoes"></div>`;
      let agentes = r.agentes;
      const sala = montarSala($('#ev-sala'), agentes, abrirAgente);
      let reunidos = false;
      const DESTAQUES = ['laya', 'secretaria', 'leitor', 'djen', 'prazos', 'estagiario'];
      const desenharBarra = (quandoAtualizou) => {
        const trab = agentes.filter((a) => a.status === 'trabalhando').length;
        const erros = agentes.filter((a) => a.status === 'erro').length;
        $('#ev-barra').innerHTML = `
          <span class="ev-resumo">👥 ${agentes.length} agentes · <span style="color:var(--green)">${trab} trabalhando</span>${erros ? ` · <span style="color:var(--red)">${erros} com erro</span>` : ''}</span>
          <small style="color:var(--text-muted)">atualizado ${quandoAtualizou}</small>
          ${DESTAQUES.map((id) => agentes.find((a) => a.id === id)).filter(Boolean).map((a) => `<button type="button" class="ev-chip" data-agente="${a.id}" style="border-color:${a.cor};color:${a.cor}"><span class="bola" style="background:${COR_STATUS[a.status]}"></span>${esc(a.nome)} · ${esc(a.cargo)}</button>`).join('')}
          <button type="button" class="ev-chip cheio" id="ev-metricas" style="background:#2563eb">📊 Métricas da IA</button>
          <button type="button" class="ev-chip cheio" id="ev-reunir" style="background:#b45309">🤝 ${reunidos ? 'Encerrar reunião' : 'Reunir a equipe'}</button>`;
        $('#ev-barra').querySelectorAll('[data-agente]').forEach((b) => b.onclick = () => abrirAgente(b.dataset.agente));
        $('#ev-metricas').onclick = () => abrirPainelIa();
        $('#ev-reunir').onclick = () => { reunidos = !reunidos; sala.reunir(reunidos); desenharBarra(quandoAtualizou); };
      };
      const desenharCartoes = () => {
        const caixa = $('#ev-cartoes');
        caixa.innerHTML = agentes.map((a) => `
          <button type="button" class="ev-cartao" data-agente="${a.id}" aria-label="${esc(a.nome)}: ${ROTULO_STATUS[a.status]}">
            <header><span class="bola" style="background:${a.cor}"></span><b>${esc(a.nome)}</b>
              <small style="color:${COR_TEXTO_STATUS[a.status]}">● ${ROTULO_STATUS[a.status]}</small></header>
            <div class="faz">${esc(a.cargo)} · ${esc(a.resumo || '')}</div>
            ${(a.metricas || []).length ? `<div class="nums">${a.metricas.map((m) => `<span><b>${m.n}</b>${esc(m.rotulo)}</span>`).join('')}</div>` : ''}
            <div class="ult" title="${esc(a.ultima?.texto || '')}">${a.ultima ? `${esc(a.ultima.texto)}${a.ultima.em ? ` · ${haQuanto(a.ultima.em)}` : ''}` : 'Aguardando a primeira tarefa'}</div>
          </button>`).join('');
        caixa.querySelectorAll('[data-agente]').forEach((b) => b.onclick = () => abrirAgente(b.dataset.agente));
      };
      desenharBarra('agora');
      desenharCartoes();
      let zoom = 1;
      const svg = $('#ev-sala svg');
      const aplicarZoom = () => { svg.style.width = `${zoom * 100}%`; $('#ev-zv').textContent = `${Math.round(zoom * 100)}%`; };
      $('#ev-menos').onclick = () => { zoom = Math.max(0.6, zoom - 0.2); aplicarZoom(); };
      $('#ev-mais').onclick = () => { zoom = Math.min(2, zoom + 0.2); aplicarZoom(); };
      // Atualiza o status a cada 30 s enquanto a tela estiver aberta.
      const timer = setInterval(async () => {
        if (!document.body.contains(svg)) { clearInterval(timer); return; }
        try { const n = await api('/api/escritorio'); agentes = n.agentes; sala.atualizar(agentes); desenharBarra('agora'); desenharCartoes(); } catch { /* tenta de novo na próxima */ }
      }, 30000);
    },
  });
  window.abrirPainelIa = abrirPainelIa;
})();
