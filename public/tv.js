// ─────────────────────────────────────────────────────────────
// Painel da TV do escritório (/tv) — 19/11/2026, pedido da Jessica:
// "monitorar tudo através de uma TV no escritório, principalmente o
// escritório virtual, com os agentes trabalhando, interativo pelo controle
// remoto"; "monitoramento de mensagens do WhatsApp também"; "escolher com o
// controle o que eu quero ver".
//
// Página à parte do CRM, só leitura. Usa o mesmo login do CRM (crm_token no
// navegador da TV) e renova a sessão sozinha (X-Renew-Token).
// Escrito em JavaScript antigo de propósito (sem async/await, encadeamento
// opcional, coalescência nula nem spread): navegador de TV costuma ser velho.
// ─────────────────────────────────────────────────────────────
(function () {
  'use strict';

  var VISTAS = [
    { id: 'geral', nome: 'Painel geral' },
    { id: 'escritorio', nome: 'Escritório virtual' },
    { id: 'whatsapp', nome: 'WhatsApp' },
    { id: 'hoje', nome: 'Hoje' },
  ];
  var ROTACAO_SEG = 30;                 // tempo de cada painel na rotação
  var PAUSA_AO_USAR_MS = 3 * 60000;     // mexeu no controle: a rotação espera
  var DISCRETO_VOLTA_MS = 2 * 60000;    // modo completo do WhatsApp desliga sozinho
  var FECHA_JANELA_MS = 4 * 60000;      // janela aberta e ninguém mexe: fecha
  var STATUS = {
    trabalhando: { nome: 'Trabalhando agora', cor: 'var(--green)' },
    parado: { nome: 'Em pausa', cor: 'var(--amber)' },
    erro: { nome: 'Com erro', cor: 'var(--red)' },
    desligado: { nome: 'Desligado', cor: 'var(--gray)' },
  };

  // ── Guardar preferências da TV (pode falhar em navegador restrito) ──
  function ler(chave, padrao) { try { var v = localStorage.getItem(chave); return v === null ? padrao : v; } catch (e) { return padrao; } }
  function gravar(chave, v) { try { localStorage.setItem(chave, v); } catch (e) { /* sem armazenamento: segue sem lembrar */ } }

  function apagar(chave) { try { localStorage.removeItem(chave); } catch (e) { /* segue */ } }

  // A TV entra sem login (19/11/2026): mostra um código, alguém libera pelo
  // celular e a TV guarda a chave dela (tv_chave). O login do CRM, se existir
  // neste navegador, também vale.
  var CHAVE_TV = ler('tv_chave', null);
  var TOKEN = ler('crm_token', null);
  var est = {
    vista: ler('tv_vista', 'geral'),
    rotacao: ler('tv_rotacao', '1') === '1',
    discreto: true,
    pausaAte: 0,
    decorrido: 0,
    camada: null,          // null | 'menu' | 'detalhe'
    ultimoToque: Date.now(),
    chaveFoco: null,
    dados: { escritorio: null, whatsapp: null, hoje: null },
    atualizadoEm: null,
    timerDiscreto: null,
    sons: ler('tv_sons', '1') === '1',
    liberado: false,        // o navegador só deixa tocar som e abrir tela cheia depois de uma tecla
    desdeAvisos: null,      // "agora" do servidor na última pergunta de avisos
    ultimosAvisos: [],      // para a lista do painel Hoje
    filaAvisos: [],
    whatsappConectado: null,
    abertaEm: Date.now(),
  };
  if (!VISTAS.some(function (v) { return v.id === est.vista; })) est.vista = 'geral';

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function iniciais(nome) {
    var p = String(nome || '').replace(/^(Dra?\.|Sr\.|Sra\.)\s+/i, '').trim().split(/\s+/);
    return ((p[0] || '?').charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : '')).toUpperCase();
  }
  function ha(iso) {
    if (!iso) return '';
    var min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return 'há ' + min + ' min';
    var h = Math.floor(min / 60);
    if (h < 24) return 'há ' + h + 'h';
    var d = Math.floor(h / 24);
    return d === 1 ? 'ontem' : 'há ' + d + ' dias';
  }
  function espera(min) {
    if (min < 60) return min + ' min';
    if (min < 24 * 60) { var h = Math.floor(min / 60), m = min % 60; return h + 'h' + (m ? ' ' + (m < 10 ? '0' : '') + m : ''); }
    var d = Math.floor(min / 1440); return d + (d === 1 ? ' dia' : ' dias');
  }
  function classeEspera(min) { return min < 30 ? 'ok' : min < 120 ? 'atencao' : 'ruim'; }
  function hora(iso) { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }); }
  function plural(n, um, varios) { return n + ' ' + (n === 1 ? um : varios); }

  // ── Conversa com o CRM ──
  function api(caminho) {
    if (!CHAVE_TV && !TOKEN) return Promise.reject(new Error('sem acesso'));
    var cab = CHAVE_TV ? { 'X-TV-Chave': CHAVE_TV } : { Authorization: 'Bearer ' + TOKEN };
    return fetch(caminho, { headers: cab, cache: 'no-store' }).then(function (r) {
      var novo = r.headers.get('X-Renew-Token');
      if (novo) { TOKEN = novo; gravar('crm_token', novo); }
      if (r.status === 401) {
        // TV desligada no celular ou login vencido: volta a pedir código.
        if (CHAVE_TV) { CHAVE_TV = null; apagar('tv_chave'); } else { TOKEN = null; }
        mostrarPareamento(); throw new Error('sessao');
      }
      if (r.status === 403) { var e = new Error('sem-acesso'); e.semAcesso = true; throw e; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      $('avisoRede').style.display = 'none';
      return r.json();
    }, function (e) { $('avisoRede').style.display = 'block'; throw e; });
  }

  function carregarEscritorio() {
    return api('/api/tv/escritorio').then(function (d) { est.dados.escritorio = d; marcarAtualizado(); }).catch(function () {});
  }
  function carregarWhatsapp() {
    return api('/api/tv/whatsapp?discreto=' + (est.discreto ? '1' : '0')).then(function (d) {
      if (est.whatsappConectado === true && d.conectado === false) avisar({ tipo: 'erro', som: 'alerta', icone: '📵', titulo: 'O WhatsApp do escritório caiu', texto: 'Reconecte em WhatsApp → Conexão no CRM' });
      if (est.whatsappConectado === false && d.conectado === true) avisar({ tipo: 'protocolo', som: 'ping', icone: '✅', titulo: 'WhatsApp conectado de novo', texto: '' });
      est.whatsappConectado = d.conectado;
      est.dados.whatsapp = d; marcarAtualizado();
    })
      .catch(function (e) { if (e && e.semAcesso) est.dados.whatsapp = { semAcesso: true }; });
  }
  function carregarHoje() {
    return api('/api/tv/hoje').then(function (d) { est.dados.hoje = d; marcarAtualizado(); }).catch(function () {});
  }
  function carregarAvisos() {
    return api('/api/tv/avisos' + (est.desdeAvisos ? '?desde=' + encodeURIComponent(est.desdeAvisos) : '')).then(function (d) {
      est.desdeAvisos = d.agora;
      (d.avisos || []).forEach(avisar);
    }).catch(function () {});
  }

  // ── Sons de aviso: gerados aqui mesmo (sem arquivo), um para cada tipo ──
  var audio = null;
  function liberarSom() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx && !audio) audio = new Ctx();
      if (audio && audio.resume) audio.resume();
    } catch (e) { audio = null; }
  }
  function tom(freq, inicio, dur, forma, vol) {
    var t = audio.currentTime + inicio, o = audio.createOscillator(), g = audio.createGain();
    o.type = forma; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(audio.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }
  var SONS = {
    // processo protocolado: arpejo de comemoração
    festa: function () { [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) { tom(f, i * 0.12, 0.5, 'triangle', 0.3); }); tom(1318.5, 0.5, 0.9, 'sine', 0.18); },
    // agente chamando / aprovação / audiência: campainha de dois tons
    chamado: function () { tom(880, 0, 0.9, 'sine', 0.3); tom(1760, 0, 0.5, 'sine', 0.06); tom(659.25, 0.35, 1.2, 'sine', 0.3); tom(1318.5, 0.35, 0.6, 'sine', 0.06); },
    // conversa esperando: "plim-plim" curto
    ping: function () { tom(1046.5, 0, 0.25, 'sine', 0.25); tom(1318.5, 0.15, 0.4, 'sine', 0.25); },
    // erro / WhatsApp caiu: dois bipes graves, duas vezes
    alerta: function () { tom(440, 0, 0.3, 'square', 0.1); tom(349.23, 0.35, 0.45, 'square', 0.1); tom(440, 0.9, 0.3, 'square', 0.1); tom(349.23, 1.25, 0.45, 'square', 0.1); },
  };
  function horaDeSom() {
    var h = Number(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' }).slice(0, 2));
    return h >= 7 && h < 21;
  }
  function tocar(som, forcar) {
    if (!audio || !SONS[som] || (!forcar && (!est.sons || !horaDeSom()))) return;
    try { SONS[som](); } catch (e) { /* som indisponível nesta TV */ }
  }

  // ── Avisos na tela: um por vez a cada 3s, cada um fica 15s ──
  function avisar(a) {
    est.ultimosAvisos.unshift({ a: a, em: new Date().toISOString() });
    est.ultimosAvisos = est.ultimosAvisos.slice(0, 12);
    est.filaAvisos.push(a);
    if (est.vista === 'hoje') desenhar();
  }
  function proximoAviso() {
    var a = est.filaAvisos.shift();
    if (!a) return;
    var caixa = $('avisos'), el = document.createElement('div');
    el.className = 'aviso ' + a.tipo;
    el.innerHTML = '<span class="ic">' + esc(a.icone) + '</span><div><b>' + esc(a.titulo) + '</b>' + (a.texto ? '<small>' + esc(a.texto) + '</small>' : '') + '</div>';
    caixa.insertBefore(el, caixa.firstChild);
    while (caixa.children.length > 3) caixa.removeChild(caixa.lastChild);
    tocar(a.som);
    setTimeout(function () { el.className += ' sai'; setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 450); }, 15000);
  }

  function marcarAtualizado() { est.atualizadoEm = new Date().toISOString(); desenhar(); }
  function carregarTudo() { carregarEscritorio(); carregarWhatsapp(); carregarHoje(); }

  // ── Desenho dos painéis ──
  function desenharAbas() {
    $('abas').innerHTML = VISTAS.map(function (v, i) {
      return '<button class="aba focavel' + (v.id === est.vista ? ' ativa' : '') + '" data-chave="aba-' + v.id + '" data-ir="' + v.id + '"><span class="num">' + (i + 1) + '</span>' + esc(v.nome) + '</button>';
    }).join('') + '<button class="aba focavel" data-chave="aba-menu" data-acao="menu"><span class="num">0</span>Menu</button>';
  }

  function contarStatus(agentes) {
    var c = { trabalhando: 0, parado: 0, erro: 0, desligado: 0 };
    agentes.forEach(function (a) { c[a.status] = (c[a.status] || 0) + 1; });
    return c;
  }

  function carregando(texto) { return '<p class="vazio">' + esc(texto || 'Carregando…') + '</p>'; }

  function vistaGeral() {
    var esc1 = est.dados.escritorio, wa = est.dados.whatsapp, hj = est.dados.hoje;
    var col1 = carregando(), col2 = carregando(), col3 = carregando();

    if (esc1) {
      var ag = esc1.agentes || [], c = contarStatus(ag);
      var destaque = ag.filter(function (a) { return a.status === 'erro'; }).concat(ag.filter(function (a) { return a.status === 'trabalhando'; })).slice(0, 6);
      col1 = '<div class="grande" style="color:var(--green)">' + c.trabalhando + '</div><div class="sub">' + plural(c.trabalhando, 'agente trabalhando agora', 'agentes trabalhando agora') +
        ' · ' + c.parado + ' em pausa' + (c.erro ? ' · <b style="color:var(--red)">' + plural(c.erro, 'com erro', 'com erro') + '</b>' : '') + '</div>' +
        (destaque.length ? destaque.map(function (a) {
          var u = a.ultima || {};
          return '<div class="linha"><div class="t"><span style="color:' + STATUS[a.status].cor + '">●</span> ' + esc(a.nome) + '<small>' + esc(u.texto || a.resumo || '') + '</small></div><span class="q">' + esc(ha(u.em)) + '</span></div>';
        }).join('') : '<p class="vazio">Equipe em pausa no momento.</p>');
    }

    if (wa && wa.semAcesso) col2 = '<p class="vazio">Este usuário não tem acesso ao WhatsApp.</p>';
    else if (wa) {
      col2 = (wa.alerta ? '<div class="alerta">' + esc(wa.alerta) + '</div>' : '') +
        '<div class="grande" style="color:' + (wa.totalAguardando ? 'var(--amber)' : 'var(--green)') + '">' + wa.totalAguardando + '</div>' +
        '<div class="sub">' + plural(wa.totalAguardando, 'conversa esperando resposta', 'conversas esperando resposta') +
        (wa.totalAguardando ? ' · a mais antiga há ' + espera(wa.maiorEsperaMin) : '') + '</div>' +
        '<div class="linha"><div class="t">Recebidas hoje</div><span class="q">' + wa.recebidasHoje + '</span></div>' +
        '<div class="linha"><div class="t">Enviadas hoje</div><span class="q">' + wa.enviadasHoje + '</span></div>' +
        '<div class="linha"><div class="t">Mensagens para aprovar</div><span class="q">' + wa.rascunhosPendentes + '</span></div>' +
        '<div class="linha"><div class="t">Conexão</div><span class="q" style="color:' + (wa.conectado === false ? 'var(--red)' : 'var(--green)') + '">' + (wa.conectado === false ? 'Desconectado' : wa.conectado ? 'Conectado' : '—') + '</span></div>';
    }

    if (hj || esc1) {
      var itens = (hj && hj.itens) || [], saude = (hj && hj.saude) || [];
      var falhas = saude.filter(function (s) { return !s.ok; });
      var chefe = esc1 && esc1.chefe;
      col3 = (chefe ? '<div class="sub" style="font-size:1.05rem;color:var(--text)">' + esc(chefe.frase) + '</div>' : '') +
        (itens.length ? itens.slice(0, 5).map(function (i) {
          return '<div class="linha"><div class="t"><span style="color:' + (i.nivel === 'critico' ? 'var(--red)' : i.nivel === 'atencao' ? 'var(--amber)' : 'var(--blue)') + '">●</span> ' + esc(i.titulo) + '<small>' + esc(i.detalhe) + '</small></div></div>';
        }).join('') : (hj ? '<p class="vazio">Nada pendente para hoje.</p>' : '')) +
        (hj ? '<div class="linha"><div class="t">Sistema</div><span class="q" style="color:' + (falhas.length ? 'var(--red)' : 'var(--green)') + '">' +
          (falhas.length ? plural(falhas.length, 'ponto com problema', 'pontos com problema') : 'tudo funcionando') + '</span></div>' : '');
    }

    return '<div class="colunas">' +
      '<div class="coluna focavel" data-chave="g-esc" data-ir="escritorio"><h3>Escritório virtual</h3>' + col1 + '<div class="rodape-col">OK para ver a sala inteira</div></div>' +
      '<div class="coluna focavel" data-chave="g-wa" data-ir="whatsapp"><h3>WhatsApp</h3>' + col2 + '<div class="rodape-col">OK para ver as conversas</div></div>' +
      '<div class="coluna focavel" data-chave="g-hoje" data-ir="hoje"><h3>Hoje</h3>' + col3 + '<div class="rodape-col">OK para ver tudo de hoje</div></div>' +
      '</div>';
  }

  function vistaEscritorio() {
    var d = est.dados.escritorio;
    if (!d) return carregando('Carregando o escritório virtual…');
    var setores = d.setores || [], ordem = {}, corSetor = {};
    setores.forEach(function (s, i) { ordem[s.id] = i; corSetor[s.id] = s.cor; });
    var ag = (d.agentes || []).slice().sort(function (a, b) { return (ordem[a.setor] == null ? 99 : ordem[a.setor]) - (ordem[b.setor] == null ? 99 : ordem[b.setor]); });
    var c = contarStatus(ag), chefe = d.chefe || {};
    var html = '<div class="rolagem">' +
      '<div class="chefe"><div class="avatar">LB</div><div><b>Dra. Letícia · CEO</b><p>' + esc(chefe.frase || '') + '</p></div>' +
      '<div class="contagem"><div><b style="color:var(--green)">' + c.trabalhando + '</b><span>trabalhando</span></div><div><b style="color:var(--amber)">' + c.parado + '</b><span>em pausa</span></div>' +
      '<div><b style="color:' + (c.erro ? 'var(--red)' : 'var(--muted)') + '">' + c.erro + '</b><span>com erro</span></div><div><b>' + (chefe.total || 0) + '</b><span>para conferir</span></div></div></div>' +
      '<div class="legenda">' + Object.keys(STATUS).map(function (k) { return '<span><i style="background:' + STATUS[k].cor + '"></i>' + STATUS[k].nome + '</span>'; }).join('') +
      setores.map(function (s) { return '<span><i style="background:' + esc(s.cor) + ';border-radius:.15rem"></i>' + esc(s.nome) + '</span>'; }).join('') + '</div>' +
      '<div class="sala">' + ag.map(function (a) {
        var u = a.ultima || {};
        return '<div class="agente focavel ' + esc(a.status) + '" data-chave="ag-' + esc(a.id) + '" data-agente="' + esc(a.id) + '" style="--setor:' + esc(corSetor[a.setor] || a.cor) + '">' +
          '<div class="cab"><div class="ini" style="background:' + esc(a.cor) + '">' + esc(iniciais(a.nome)) + '<i></i></div><div style="min-width:0"><div class="nome">' + esc(a.nome) + '</div><div class="cargo">' + esc(a.cargo) + '</div></div></div>' +
          '<div class="faz">' + esc(u.texto || a.resumo || '') + '</div>' +
          '<div class="quando"><span>' + esc(a.status === 'trabalhando' ? 'Trabalhando' : STATUS[a.status] ? STATUS[a.status].nome : a.status) + '</span><em>' + esc(ha(u.em)) + '</em></div></div>';
      }).join('') + '</div></div>';
    return html;
  }

  function vistaWhatsapp() {
    var w = est.dados.whatsapp;
    if (!w) return carregando('Carregando o WhatsApp…');
    if (w.semAcesso) return '<p class="vazio">Este usuário do CRM não tem acesso ao WhatsApp. Entre na TV com um usuário que tenha.</p>';
    var num = function (valor, rotulo, classe) { return '<div class="numero ' + (classe || '') + '"><b>' + valor + '</b><span>' + rotulo + '</span></div>'; };
    var botao = '<button class="botao focavel" data-chave="wa-discreto" data-acao="discreto">' +
      (w.discreto ? '🔒 Modo discreto ligado — OK para mostrar nomes e mensagens' : '👁 Mostrando nomes e mensagens — OK para esconder (volta sozinho em 2 min)') + '</button>';
    var aguardando = w.aguardando.length ? w.aguardando.map(function (c, i) {
      return '<li class="conversa focavel" data-chave="wa-ag-' + i + '"><div class="bola">' + esc(iniciais(c.nome)) + '</div><div class="meio"><b>' + esc(c.nome) + '</b>' +
        (c.previa ? '<small>' + esc(c.previa) + '</small>' : '<small>esperando a nossa resposta</small>') + '</div>' +
        (c.naoLidas ? '<span class="naolidas">' + c.naoLidas + '</span>' : '') + '<span class="espera ' + classeEspera(c.esperaMin) + '">' + espera(c.esperaMin) + '</span></li>';
    }).join('') : '<p class="vazio">Ninguém esperando resposta. 👏</p>';
    var recentes = w.recentes.length ? w.recentes.map(function (c, i) {
      return '<li class="conversa focavel" data-chave="wa-rc-' + i + '"><span class="seta ' + (c.deMim ? 'out' : 'in') + '">' + (c.deMim ? '↗' : '↙') + '</span><div class="meio"><b>' + esc(c.nome) + '</b>' +
        '<small>' + (c.previa ? esc(c.previa) : (c.deMim ? 'nós respondemos' : 'mensagem recebida')) + '</small></div><span class="espera ok">' + hora(c.em) + '</span></li>';
    }).join('') : '<p class="vazio">Sem conversas nos últimos 3 dias.</p>';
    return '<div class="rolagem">' + (w.alerta ? '<div class="alerta">⚠ ' + esc(w.alerta) + '</div>' : '') +
      '<div class="numeros">' +
      num(w.conectado === false ? 'Off' : w.conectado ? 'On' : '—', 'Conexão do WhatsApp', w.conectado === false ? 'ruim' : 'bom') +
      num(w.recebidasHoje, 'Recebidas hoje') + num(w.enviadasHoje, 'Enviadas hoje') +
      num(w.totalAguardando, 'Esperando resposta', w.totalAguardando ? 'atencao' : 'bom') +
      num(w.totalAguardando ? espera(w.maiorEsperaMin) : '—', 'Maior espera', w.totalAguardando ? classeEspera(w.maiorEsperaMin) : '') +
      num(w.rascunhosPendentes, 'Mensagens para aprovar', w.rascunhosPendentes ? 'atencao' : '') +
      '</div><div style="margin-bottom:1rem">' + botao + '</div>' +
      '<div class="colunas" style="height:auto"><div class="coluna"><h3>Esperando resposta (a mais antiga primeiro)</h3><ul class="lista">' + aguardando + '</ul></div>' +
      '<div class="coluna"><h3>Movimento recente</h3><ul class="lista">' + recentes + '</ul></div></div></div>';
  }

  function vistaHoje() {
    var h = est.dados.hoje, e = est.dados.escritorio;
    if (!h) return carregando('Carregando o dia…');
    var itens = h.itens || [], saude = h.saude || [];
    return '<div class="colunas"><div class="coluna" style="flex:1.6"><h3>O que precisa de atenção hoje</h3>' +
      (e && e.chefe ? '<p class="sub">' + esc(e.chefe.frase) + '</p>' : '') +
      '<div class="rolagem" style="flex:1;min-height:0">' + (itens.length ? itens.map(function (i, n) {
        return '<div class="item focavel ' + esc(i.nivel) + '" data-chave="hj-' + esc(i.id || n) + '" data-item="' + n + '"><span class="ic">' + esc(i.icone) + '</span><div><b>' + esc(i.titulo) + '</b><small>' + esc(i.detalhe) + '</small></div></div>';
      }).join('') : '<p class="vazio">Nada pendente para hoje. 🎉</p>') + '</div></div>' +
      '<div class="coluna"><h3>Saúde do sistema</h3><div class="saude">' + saude.map(function (s) {
        return '<div><i style="background:' + (s.ok ? 'var(--green)' : 'var(--red)') + '"></i>' + esc(s.nome) + '</div>';
      }).join('') + '</div>' +
      (saude.some(function (s) { return !s.ok; }) ? '<h3 style="margin-top:1rem">Como resolver</h3>' + saude.filter(function (s) { return !s.ok; }).map(function (s) {
        return '<div class="linha"><div class="t" style="white-space:normal"><b>' + esc(s.nome) + '</b><small style="white-space:normal">' + esc(s.comoResolver) + '</small></div></div>';
      }).join('') : '<p class="vazio">Tudo funcionando.</p>') +
      '<h3 style="margin-top:1rem">Últimos avisos</h3>' + (est.ultimosAvisos.length ? est.ultimosAvisos.slice(0, 6).map(function (x) {
        return '<div class="linha"><div class="t">' + esc(x.a.icone) + ' ' + esc(x.a.titulo) + (x.a.texto ? '<small>' + esc(x.a.texto) + '</small>' : '') + '</div><span class="q">' + hora(x.em) + '</span></div>';
      }).join('') : '<p class="vazio">Nenhum aviso desde que a TV ligou.</p>') + '</div></div>';
  }

  var DESENHO = { geral: vistaGeral, escritorio: vistaEscritorio, whatsapp: vistaWhatsapp, hoje: vistaHoje };

  function desenhar() {
    desenharAbas();
    VISTAS.forEach(function (v) {
      var el = $('v-' + v.id);
      if (v.id === est.vista) { el.innerHTML = DESENHO[v.id](); el.className = 'vista ativa'; } else { el.className = 'vista'; el.innerHTML = ''; }
    });
    restaurarFoco();
    desenharEstado();
  }

  function desenharEstado() {
    var txt;
    if (!est.rotacao) txt = 'Rotação desligada';
    else if (Date.now() < est.pausaAte) txt = 'Rotação pausada enquanto você usa o controle';
    else txt = 'Próximo painel em ' + Math.max(0, ROTACAO_SEG - est.decorrido) + 's<span class="barra-rot"><i style="width:' + Math.min(100, est.decorrido / ROTACAO_SEG * 100) + '%"></i></span>';
    $('estado').innerHTML = (est.atualizadoEm ? 'Atualizado às ' + hora(est.atualizadoEm) + ' · ' : '') + txt;
  }

  // ── Foco e navegação pelo controle ──
  function areaAtiva() {
    if ($('entrada').className.indexOf('aberta') > -1) return [$('entrada')];
    if (est.camada === 'menu') return [$('menu')];
    if (est.camada === 'detalhe') return [$('detalhe')];
    return [$('abas'), $('v-' + est.vista)];
  }
  function focaveis() {
    var lista = [];
    areaAtiva().forEach(function (a) { Array.prototype.forEach.call(a.querySelectorAll('.focavel'), function (el) { lista.push(el); }); });
    return lista;
  }
  function focoAtual() { return document.querySelector('.focavel.foco'); }
  function focar(el) {
    var velho = focoAtual();
    if (velho) velho.classList.remove('foco');
    if (!el) return;
    el.classList.add('foco');
    est.chaveFoco = el.getAttribute('data-chave');
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { el.scrollIntoView(false); }
  }
  function restaurarFoco() {
    var lista = focaveis();
    if (!lista.length) return;
    var alvo = null;
    for (var i = 0; i < lista.length; i++) if (est.chaveFoco && lista[i].getAttribute('data-chave') === est.chaveFoco) { alvo = lista[i]; break; }
    if (!alvo) {
      // Sem foco anterior: primeiro item do painel (não a aba), para o OK já fazer algo útil.
      var doPainel = lista.filter(function (el) { return !el.classList.contains('aba'); });
      alvo = doPainel[0] || lista[0];
    }
    focar(alvo);
  }
  function mover(direcao) {
    var lista = focaveis(), atual = focoAtual();
    if (!atual || lista.indexOf(atual) < 0) { restaurarFoco(); return; }
    var r = atual.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var melhor = null, melhorNota = Infinity;
    lista.forEach(function (el) {
      if (el === atual) return;
      var o = el.getBoundingClientRect(), ox = o.left + o.width / 2, oy = o.top + o.height / 2;
      var dx = ox - cx, dy = oy - cy, principal, lateral;
      if (direcao === 'direita') { if (o.left < r.right - 4 && dx <= 4) return; principal = dx; lateral = dy; }
      else if (direcao === 'esquerda') { if (o.right > r.left + 4 && dx >= -4) return; principal = -dx; lateral = dy; }
      else if (direcao === 'baixo') { if (o.top < r.bottom - 4 && dy <= 4) return; principal = dy; lateral = dx; }
      else { if (o.bottom > r.top + 4 && dy >= -4) return; principal = -dy; lateral = dx; }
      if (principal <= 0) return;
      var nota = principal + Math.abs(lateral) * 2.5;
      if (nota < melhorNota) { melhorNota = nota; melhor = el; }
    });
    if (melhor) focar(melhor);
  }

  function irPara(id) {
    if (!DESENHO[id]) return;
    est.vista = id; est.decorrido = 0; est.chaveFoco = null; gravar('tv_vista', id);
    desenhar();
  }
  function proxima(passo) {
    var i = 0;
    for (var k = 0; k < VISTAS.length; k++) if (VISTAS[k].id === est.vista) i = k;
    irPara(VISTAS[(i + passo + VISTAS.length) % VISTAS.length].id);
  }

  // ── Menu ──
  function abrirMenu() {
    if (!est.camada) est.chaveAntesDaJanela = est.chaveFoco;
    est.camada = 'menu';
    var op = function (chave, num, texto, extra, attrs) {
      return '<button class="opcao focavel" data-chave="m-' + chave + '" ' + attrs + '><span class="num">' + num + '</span>' + texto + (extra ? '<em>' + extra + '</em>' : '') + '</button>';
    };
    $('menu').innerHTML = '<h2>O que você quer ver?</h2>' +
      VISTAS.map(function (v, i) { return op(v.id, i + 1, esc(v.nome), v.id === est.vista ? 'na tela' : '', 'data-ir="' + v.id + '"'); }).join('') +
      '<h3 style="margin-top:.8rem">Ajustes</h3>' +
      op('rotacao', '▶', 'Rotação automática dos painéis', est.rotacao ? 'ligada' : 'desligada', 'data-acao="rotacao"') +
      op('discreto', '🔒', 'Modo discreto do WhatsApp', est.discreto ? 'ligado' : 'desligado', 'data-acao="discreto"') +
      op('sons', '🔔', 'Sons de aviso (7h às 21h)', est.sons ? 'ligados' : 'desligados', 'data-acao="sons"') +
      op('testarsom', '♪', 'Testar os sons', '', 'data-acao="testarsom"') +
      op('atualizar', '↻', 'Atualizar agora', '', 'data-acao="atualizar"') +
      op('tela', '⛶', 'Tela cheia', '', 'data-acao="telacheia"') +
      op('fechar', '✕', 'Fechar o menu', 'Voltar', 'data-acao="fechar"');
    $('camadaMenu').className = 'camada aberta';
    est.chaveFoco = 'm-' + est.vista;
    restaurarFoco();
  }
  function fecharCamadas() {
    est.camada = null;
    $('camadaMenu').className = 'camada';
    $('camadaDetalhe').className = 'camada';
    est.chaveFoco = est.chaveAntesDaJanela || null;
    desenhar();
  }

  // ── Janela de detalhe (agente ou item de hoje) ──
  function abrirDetalhe(html) {
    est.chaveAntesDaJanela = est.chaveFoco;
    est.camada = 'detalhe';
    $('detalhe').innerHTML = html + '<div style="margin-top:1rem"><button class="botao focavel" data-chave="d-fechar" data-acao="fechar">Fechar (Voltar)</button></div>';
    $('camadaDetalhe').className = 'camada aberta';
    est.chaveFoco = 'd-fechar';
    restaurarFoco();
  }
  function detalheAgente(id) {
    var a = null;
    ((est.dados.escritorio && est.dados.escritorio.agentes) || []).forEach(function (x) { if (x.id === id) a = x; });
    if (!a) return;
    var topo = '<div class="cab" style="display:flex;align-items:center;margin-bottom:.8rem"><div class="ini" style="width:3.2rem;height:3.2rem;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;margin-right:1rem;background:' + esc(a.cor) + '">' + esc(iniciais(a.nome)) + '</div>' +
      '<div><h2 style="margin:0">' + esc(a.nome) + '</h2><span style="color:var(--muted)">' + esc(a.cargo) + ' · ' + esc(a.depto || '') + '</span></div>' +
      '<span style="margin-left:auto;font-weight:600;color:' + STATUS[a.status].cor + '">● ' + esc(STATUS[a.status].nome) + '</span></div>' +
      '<p class="sub">' + esc(a.descricao) + '</p>' +
      ((a.metricas || []).length ? '<div class="numeros">' + a.metricas.slice(0, 4).map(function (m) { return '<div class="numero"><b>' + esc(m.n) + '</b><span>' + esc(m.rotulo) + '</span></div>'; }).join('') + '</div>' : '');
    abrirDetalhe(topo + '<h3>O que fez por último</h3><div class="historico" id="historico">' + carregando() + '</div>');
    api('/api/tv/agente/' + encodeURIComponent(id)).then(function (d) {
      var el = $('historico');
      if (!el || est.camada !== 'detalhe') return;
      var h = (d.historico || []).slice(0, 9);
      el.innerHTML = h.length ? h.map(function (x) {
        return '<div class="linha"><div class="t' + (x.erro ? ' erro' : '') + '">' + esc(x.texto) + '</div><span class="q">' + esc(ha(x.em)) + '</span></div>';
      }).join('') : '<p class="vazio">Nenhuma atividade registrada na última semana.</p>';
    }).catch(function () { var el = $('historico'); if (el) el.innerHTML = '<p class="vazio">Não deu para carregar o histórico agora.</p>'; });
  }
  function detalheItemHoje(n) {
    var i = ((est.dados.hoje && est.dados.hoje.itens) || [])[n];
    if (!i) return;
    abrirDetalhe('<h2>' + esc(i.icone) + ' ' + esc(i.titulo) + '</h2><p class="sub" style="font-size:1.1rem">' + esc(i.detalhe) + '</p>' +
      '<p class="sub" style="color:var(--muted)">Para resolver, abra o CRM no computador: ' + esc(i.acao ? i.acao.label : '') + '.</p>');
  }

  // ── Ações do OK ──
  function alternarDiscreto() {
    est.discreto = !est.discreto;
    clearTimeout(est.timerDiscreto);
    if (!est.discreto) est.timerDiscreto = setTimeout(function () { est.discreto = true; carregarWhatsapp(); }, DISCRETO_VOLTA_MS);
    carregarWhatsapp();
  }
  function telaCheia() {
    var d = document.documentElement, f = d.requestFullscreen || d.webkitRequestFullscreen;
    if (f) try { f.call(d); } catch (e) { /* TV sem tela cheia pelo navegador */ }
  }
  function ativar(el) {
    if (!el) return;
    var ir = el.getAttribute('data-ir'), acao = el.getAttribute('data-acao'), agente = el.getAttribute('data-agente'), item = el.getAttribute('data-item');
    if (ir) { if (est.camada) { est.camada = null; $('camadaMenu').className = 'camada'; } irPara(ir); return; }
    if (agente) { detalheAgente(agente); return; }
    if (item !== null) { detalheItemHoje(Number(item)); return; }
    if (acao === 'menu') abrirMenu();
    else if (acao === 'fechar') fecharCamadas();
    else if (acao === 'novocodigo') { parear(); }
    else if (acao === 'rotacao') { est.rotacao = !est.rotacao; gravar('tv_rotacao', est.rotacao ? '1' : '0'); est.decorrido = 0; abrirMenu(); est.chaveFoco = 'm-rotacao'; restaurarFoco(); desenharEstado(); }
    else if (acao === 'discreto') { alternarDiscreto(); if (est.camada === 'menu') { abrirMenu(); est.chaveFoco = 'm-discreto'; restaurarFoco(); } }
    else if (acao === 'sons') { est.sons = !est.sons; gravar('tv_sons', est.sons ? '1' : '0'); if (est.sons) tocar('ping', true); abrirMenu(); est.chaveFoco = 'm-sons'; restaurarFoco(); }
    else if (acao === 'testarsom') {
      liberarSom();
      ['festa', 'chamado', 'ping', 'alerta'].forEach(function (s, i) { setTimeout(function () { tocar(s, true); }, i * 2200); });
    }
    else if (acao === 'atualizar') { carregarTudo(); fecharCamadas(); }
    else if (acao === 'telacheia') { telaCheia(); fecharCamadas(); }
  }

  // Teclas do controle remoto. Cada TV manda códigos diferentes:
  // LG webOS: Voltar = 461; Samsung Tizen: Voltar = 10009; botões coloridos 403–406;
  // canal +/- = 427/428 (ou PageUp/PageDown); play/pausa = 415/19/10252.
  function teclaDe(e) {
    var k = e.key, c = e.keyCode;
    if (k === 'ArrowUp' || c === 38) return 'cima';
    if (k === 'ArrowDown' || c === 40) return 'baixo';
    if (k === 'ArrowLeft' || c === 37) return 'esquerda';
    if (k === 'ArrowRight' || c === 39) return 'direita';
    if (k === 'Enter' || c === 13) return 'ok';
    if (k === 'Escape' || k === 'Backspace' || k === 'BrowserBack' || k === 'GoBack' || c === 27 || c === 8 || c === 461 || c === 10009 || c === 166) return 'voltar';
    if (c >= 48 && c <= 57) return 'n' + (c - 48);
    if (c >= 96 && c <= 105) return 'n' + (c - 96);
    if (c === 403) return 'n1';
    if (c === 404) return 'n2';
    if (c === 405) return 'n3';
    if (c === 406) return 'n4';
    if (c === 33 || c === 427) return 'proxima';
    if (c === 34 || c === 428) return 'anterior';
    if (c === 415 || c === 19 || c === 10252 || c === 179 || k === 'MediaPlayPause') return 'rotacao';
    if (k === 'm' || k === 'M' || k === 'ContextMenu' || c === 93) return 'menu';
    return null;
  }

  document.addEventListener('keydown', function (e) {
    var t = teclaDe(e);
    if (!t) return;
    e.preventDefault();
    est.ultimoToque = Date.now();
    if ($('entrada').className.indexOf('aberta') > -1) { if (t === 'ok') ativar(focoAtual()); return; }
    if (!est.liberado) { comecar(); return; }
    est.pausaAte = Date.now() + PAUSA_AO_USAR_MS;
    est.decorrido = 0;
    if (t === 'cima' || t === 'baixo' || t === 'esquerda' || t === 'direita') mover(t);
    else if (t === 'ok') ativar(focoAtual());
    else if (t === 'voltar') { if (est.camada) fecharCamadas(); else abrirMenu(); }
    else if (t === 'menu' || t === 'n0') { if (est.camada === 'menu') fecharCamadas(); else abrirMenu(); }
    else if (t.charAt(0) === 'n') { var v = VISTAS[Number(t.slice(1)) - 1]; if (v) { if (est.camada) { est.camada = null; $('camadaMenu').className = 'camada'; $('camadaDetalhe').className = 'camada'; } irPara(v.id); } }
    else if (t === 'proxima') proxima(1);
    else if (t === 'anterior') proxima(-1);
    else if (t === 'rotacao') { est.rotacao = !est.rotacao; gravar('tv_rotacao', est.rotacao ? '1' : '0'); }
    desenharEstado();
  });
  // Mouse "mágico" (LG) e toque também funcionam.
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('.focavel') : null;
    if (!est.liberado && $('entrada').className.indexOf('aberta') < 0) { comecar(); return; }
    if (!el) return;
    est.pausaAte = Date.now() + PAUSA_AO_USAR_MS;
    focar(el); ativar(el);
  });
  document.addEventListener('mousemove', function () { document.body.style.cursor = 'default'; });

  // ── Relógio, rotação e atualização ──
  function relogio() {
    var agora = new Date();
    $('hora').textContent = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    $('data').textContent = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' });
  }
  function tique() {
    relogio();
    if (est.camada && Date.now() - est.ultimoToque > FECHA_JANELA_MS) fecharCamadas();
    if (est.rotacao && !est.camada && Date.now() >= est.pausaAte) {
      est.decorrido++;
      if (est.decorrido >= ROTACAO_SEG) proxima(1);
    }
    desenharEstado();
  }

  // Primeiro toque no controle: o navegador só libera som e tela cheia depois de uma tecla.
  function comecar() {
    est.liberado = true;
    liberarSom();
    telaCheia();
    $('comecar').className = 'comecar';
  }

  // ── Liberar esta TV por código (sem login na TV) ──
  var pareando = null; // { segredo, timer }
  function postar(caminho, corpo) {
    return fetch(caminho, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo || {}), cache: 'no-store' })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) { var e = new Error(d.error || 'HTTP ' + r.status); e.status = r.status; throw e; } return d; }); });
  }
  function mostrarPareamento() {
    if (pareando) return;
    $('entrada').className = 'entrada aberta';
    $('comecar').className = 'comecar';
    pareando = { segredo: null, timer: null };
    parear();
  }
  function parear() {
    if (!pareando) pareando = { segredo: null, timer: null };
    clearInterval(pareando.timer);
    postar('/api/public/tv/parear').then(function (d) {
      pareando.segredo = d.segredo;
      var c = String(d.codigo);
      $('pareamento').innerHTML = '<div class="qr"><img src="' + esc(d.qr) + '" alt="Código QR para liberar a TV" /></div>' +
        '<div><h2>Liberar esta TV</h2><div class="codigo">' + esc(c.slice(0, 3) + ' ' + c.slice(3)) + '</div>' +
        '<ol><li>No celular <b>já logado no CRM</b>, aponte a câmera para o código QR.</li>' +
        '<li>Ou abra <b>' + esc(location.host) + '/tv/liberar</b> e digite o código.</li>' +
        '<li>Toque em <b>Liberar a TV</b>. Pronto: não pede mais.</li></ol>' +
        '<p class="vale">O código muda a cada 10 minutos. Ninguém precisa digitar senha na TV.</p></div>';
      pareando.timer = setInterval(conferirPareamento, 3000);
    }).catch(function () {
      $('pareamento').innerHTML = '<div><h2>Liberar esta TV</h2><p>Não deu para gerar o código agora. Tentando de novo em 1 minuto…</p></div>';
      pareando.timer = setTimeout(parear, 60000);
    });
  }
  function conferirPareamento() {
    if (!pareando || !pareando.segredo) return;
    postar('/api/public/tv/situacao', { segredo: pareando.segredo }).then(function (d) {
      if (!pareando) return;
      if (d.situacao === 'liberada') {
        clearInterval(pareando.timer);
        CHAVE_TV = pareando.segredo; gravar('tv_chave', CHAVE_TV);
        pareando = null;
        $('entrada').className = 'entrada';
        iniciar();
        carregarTudo();
      } else if (d.situacao !== 'aguardando') parear(); // venceu: código novo
    }).catch(function () { /* sem rede: tenta no próximo ciclo */ });
  }

  // Tela acesa: pede ao navegador para não apagar a tela (quando a TV deixa).
  function manterAcesa() {
    try { if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(function () {}); } catch (e) { /* sem suporte */ }
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { manterAcesa(); carregarTudo(); } });

  relogio();
  var iniciada = false;
  function iniciar() {
    desenhar();
    if (!est.liberado) $('comecar').className = 'comecar aberta';
    if (iniciada) return;
    iniciada = true;
    carregarTudo();
    carregarAvisos();
    manterAcesa();
    rotinas();
  }
  if (CHAVE_TV || TOKEN) iniciar(); else mostrarPareamento();

  function rotinas() {
  setInterval(tique, 1000);
  setInterval(carregarEscritorio, 30000);
  setInterval(carregarWhatsapp, 30000);
  setInterval(carregarAvisos, 30000);
  setInterval(proximoAviso, 3000);
  setInterval(carregarHoje, 120000);
  // Recarrega uma vez por dia, às 4h (ninguém olhando): pega a versão nova do CRM e
  // limpa a memória da TV. Recarregar sai da tela cheia, por isso não durante o dia.
  setInterval(function () {
    var h = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' }).slice(0, 2);
    if (h === '04' && Date.now() - est.abertaEm > 2 * 3600000) location.reload();
  }, 60000);
  }
})();
