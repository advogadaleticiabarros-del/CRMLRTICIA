// ============================================================================
// whatsapp.js — módulo WhatsApp (fila, conversas estilo WhatsApp Web, conexão QR)
// Extraído do app.js (modularização). Carregado DEPOIS do app.js no index.html;
// usa os globais (api, $, esc, money, kpi, fmt*, el, openModal, field, svgIcon,
// toast, closeModal, fileHref) e registra a rota em ROUTES.
// ============================================================================

Object.assign(ROUTES, {
  // ── WhatsApp — módulo completo: fila, conversas (instância) e conexão QR ──
  async whatsapp(page) {
    const CTX = { cobranca: ['Cobrança', 'var(--amber)'], audiencia: ['Audiência', 'var(--red)'], protocolo: ['Protocolo', 'var(--green)'], avulsa: ['Avulsa', 'var(--text-muted)'] };
    let tab = 'fila';
    let chatTimer = null;

    const shell = async () => {
      if (chatTimer) { clearInterval(chatTimer); chatTimer = null; }
      const st = await api('/api/whatsapp-instance/status').catch(() => ({ connected: false }));
      page.innerHTML = `
        <div class="page-header"><div><h2>WhatsApp</h2><p class="sub">${st.connected ? `Instância conectada (${esc(st.me || '')}) — envio automático ${st.autoSend ? 'LIGADO' : 'desligado'} · ${st.sentToday || 0}/30 hoje` : 'Instância desconectada — a fila usa o wa.me (1 clique) até você conectar'}</p></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn-ghost" id="wa-gerar">Gerar agora</button><button class="btn-gold" id="wa-nova">+ Nova mensagem</button></div></div>
        <div class="tabs" style="margin-bottom:14px">
          <button class="tab ${tab === 'fila' ? 'active' : ''}" data-wtab="fila">Fila</button>
          <button class="tab ${tab === 'conversas' ? 'active' : ''}" data-wtab="conversas">Conversas</button>
          <button class="tab ${tab === 'conexao' ? 'active' : ''}" data-wtab="conexao">Conexão</button>
        </div>
        <div id="wa-body"><div class="spinner"></div></div>`;
      page.querySelectorAll('[data-wtab]').forEach((b) => b.onclick = () => { tab = b.dataset.wtab; shell(); });
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
          if (!confirm('Desconectar a instância? Será preciso escanear o QR de novo.')) return;
          await api('/api/whatsapp-instance/disconnect', { method: 'POST', body: '{}' }).catch(() => {});
        };
        const auto = body.querySelector('#wac-auto');
        if (auto) auto.onclick = async () => { await api('/api/whatsapp-instance/auto', { method: 'POST', body: JSON.stringify({ on: !s.autoSend }) }).catch(() => {}); };
      };
      render(st);
      // Atualiza status/QR a cada 3s enquanto estiver nesta aba
      chatTimer = setInterval(async () => {
        if (tab !== 'conexao') { clearInterval(chatTimer); chatTimer = null; return; }
        const s = await api('/api/whatsapp-instance/status').catch(() => null);
        if (s) render(s);
      }, 3000);
    };

    // ── Aba CONVERSAS: experiência estilo WhatsApp Web dentro do CRM ──
    const tabConversas = async () => {
      const body = $('#wa-body');
      const CORES = ['#e17076', '#7bc862', '#65aadd', '#a695e7', '#ee7aae', '#6ec9cb', '#faa774', '#54a3b8'];
      const cor = (s) => CORES[[...String(s)].reduce((a, ch) => a + ch.charCodeAt(0), 0) % CORES.length];
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
      let qtdMsgs = 0;          // p/ detectar novidade no polling

      body.innerHTML = `<div class="wa-shell" id="wa-shell">
        <div class="wa-side">
          <div class="wa-search"><input id="waq" placeholder="Buscar conversa…" autocomplete="off"></div>
          <div class="wa-filters" id="waf"></div>
          <div class="wa-list" id="wal"></div>
        </div>
        <div class="wa-pane" id="wap"><div class="wa-empty">Escolha uma conversa ao lado 💬</div></div>
        <div class="wa-ctx" id="wa-ctx"></div>
      </div>`;

      const todasEtiquetas = () => [...new Set(chats.flatMap((c) => parseLabels(c.labels)))];

      const renderFiltros = () => {
        const ets = todasEtiquetas();
        $('#waf').innerHTML = [`<button class="wa-filter ${!filtro ? 'on' : ''}" data-f="">Todas</button>`,
          ...ets.map((t) => `<button class="wa-filter ${filtro === t ? 'on' : ''}" data-f="${esc(t)}" style="${filtro === t ? `background:${cor(t)};border-color:${cor(t)}` : ''}">${esc(t)}</button>`)].join('');
        $('#waf').querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { filtro = b.dataset.f; renderFiltros(); renderLista(); });
      };

      const renderLista = () => {
        const q = busca.toLowerCase();
        const vis = chats.filter((c) => {
          if (q && !(String(c.client_name || '').toLowerCase().includes(q) || String(c.phone).includes(q))) return false;
          if (filtro && !parseLabels(c.labels).includes(filtro)) return false;
          return true;
        });
        $('#wal').innerHTML = vis.length ? vis.map((c) => {
          const nome = c.client_name || '+' + c.phone;
          const tags = parseLabels(c.labels);
          return `<div class="wa-item ${ativo && ativo.phone === c.phone ? 'on' : ''}" data-chat="${esc(c.phone)}">
            <div class="wa-ava" style="background:${cor(nome)}">${iniciais(nome)}</div>
            <div class="wa-item-mid">
              <div class="wa-item-name">${esc(nome)}</div>
              <div class="wa-item-prev">${Number(c.last_from_me) ? '✓ ' : ''}${esc(String(c.last_body || '').slice(0, 52))}</div>
              ${tags.length ? `<div class="wa-tags">${tags.map((t) => `<span class="wa-tag" style="background:${cor(t)}">${esc(t)}</span>`).join('')}</div>` : ''}
            </div>
            <div class="wa-item-right">
              <div class="wa-item-time">${fmtDia(c.last_time) === 'Hoje' ? fmtHora(c.last_time) : fmtDia(c.last_time)}</div>
              ${Number(c.unread) ? `<span class="wa-unread">${c.unread}</span>` : ''}
            </div>
          </div>`;
        }).join('') : '<div class="wa-empty">Nenhuma conversa encontrada</div>';
        $('#wal').querySelectorAll('[data-chat]').forEach((r) => r.onclick = () => {
          const c = chats.find((x) => x.phone === r.dataset.chat);
          abrirChat(c);
        });
      };

      const renderMsgs = (msgs) => {
        let dia = '';
        return msgs.map((m) => {
          const d = fmtDia(m.msg_time);
          const sep = d !== dia ? `<div class="wa-day">${d}</div>` : '';
          dia = d;
          const ehAudio = m.media_mime && (String(m.media_mime).startsWith('audio/'));
          const anexo = m.media_id && m.media_url
            ? `<br><a href="${esc(m.media_url)}" target="_blank" rel="noopener" style="font-size:12px;font-weight:600">📎 Abrir anexo</a>${ehAudio && !String(m.body).includes('📝 Transcrição:') ? ` <button type="button" class="btn-sm" data-transcrever="${m.media_id}" style="font-size:11px;padding:2px 8px;margin-left:6px">Transcrever áudio</button>` : ''}`
            : '';
          return `${sep}<div class="wa-bub ${Number(m.from_me) ? 'out' : 'in'}">${esc(m.body)}${anexo}<span class="wa-time">${fmtHora(m.msg_time)}</span></div>`;
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
        if (cx.client) {
          html += bloco('Cliente', `<strong style="color:var(--navy-deep)">${esc(cx.client.name)}</strong>${cx.client.cpf_cnpj ? `<br><small style="color:var(--text-muted)">CPF: ${esc(cx.client.cpf_cnpj)}</small>` : ''}`);
          html += bloco('Processos', (cx.cases || []).length ? cx.cases.map((c) => `<div style="font-size:12.5px;margin-bottom:6px"><strong>${esc(c.title || '—')}</strong><br><small style="color:var(--text-muted)">${c.case_number ? 'nº ' + esc(c.case_number) + ' · ' : ''}${STG[c.production_stage] || c.production_stage || c.status || ''}</small></div>`).join('') : '<small style="color:var(--text-muted)">Nenhum processo</small>');
          html += bloco('Próxima audiência', cx.audiencia ? `<strong style="font-size:13px">${fmtDateTime(cx.audiencia.start_datetime)}</strong><br><small style="color:var(--text-muted)">${cx.audiencia.video_link ? 'ONLINE' : esc(cx.audiencia.location || 'presencial')}</small>` : '<small style="color:var(--text-muted)">Nenhuma marcada</small>');
          const f = cx.financeiro || {};
          html += bloco('Honorários', Number(f.pendentes)
            ? `<strong style="color:${Number(f.vencidas) ? 'var(--red)' : 'var(--navy-deep)'}">${money(f.valor_aberto)}</strong> <small style="color:var(--text-muted)">em aberto (${f.pendentes} parcela${f.pendentes > 1 ? 's' : ''}${Number(f.vencidas) ? ` · ${f.vencidas} vencida${f.vencidas > 1 ? 's' : ''}` : ''})</small>`
            : '<small style="color:var(--green)">✓ Nada em aberto</small>');
        } else if (cx.lead) {
          html += bloco('Lead', `<strong style="color:var(--navy-deep)">${esc(cx.lead.name)}</strong><br><small style="color:var(--text-muted)">${esc(cx.lead.legal_area || '')} · ${esc(cx.lead.status || '')}</small>`);
        } else {
          html += bloco('Contato', `<small style="color:var(--text-muted)">Número não cadastrado.</small><div style="margin-top:8px"><button class="btn-gold btn-sm" id="wa-mklead">+ Cadastrar como lead</button></div>`);
        }
        html += bloco('Última resposta do contato', cx.ultima_resposta ? `<small>${fmtDateTime(cx.ultima_resposta)}</small>` : '<small style="color:var(--text-muted)">nunca respondeu</small>');
        html += `<div style="padding:12px 14px"><button class="btn-sm" id="wa-resumo" style="width:100%">✨ Resumir conversa com IA</button></div>`;
        box.innerHTML = `<div style="padding:10px 14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center"><strong style="font-size:13px;color:var(--navy)">Ficha do contato</strong><button class="btn-sm" id="wa-ctx-close">✕</button></div>` + html;
        box.querySelector('#wa-ctx-close').onclick = () => $('#wa-shell').classList.remove('ctx-open');

        const mk = box.querySelector('#wa-mklead');
        if (mk) mk.onclick = () => {
          const form = el(`<form class="form-grid">
            ${field('Nome *', 'name', { value: ativo.name.startsWith('+') ? '' : ativo.name })}
            ${field('Área', 'legal_area', { options: [['trabalhista','Trabalhista'],['previdenciario','Previdenciário'],['consumidor','Consumidor'],['familia','Família'],['civel','Cível'],['gestante','Gestante'],['outro','Outro']].map(([v, t]) => ({ v, t })) })}
            ${field('Origem', 'source', { options: [['whatsapp','WhatsApp'],['instagram','Instagram'],['google','Google'],['indicacao','Indicação'],['outro','Outro']].map(([v, t]) => ({ v, t })) })}
            ${field('Observações', 'notes', { type: 'textarea' })}
            <div style="display:flex;gap:8px"><button type="button" class="btn-ghost" id="lead-ia" style="flex:1">✨ Preencher com IA</button><button type="submit" class="btn-primary" style="flex:1">Cadastrar lead</button></div>
          </form>`);
          form.querySelector('#lead-ia').onclick = async (ev) => {
            ev.target.disabled = true; ev.target.textContent = 'Lendo a conversa…';
            try {
              const r = await api(`/api/whatsapp-instance/chats/${ativo.phone}/extrair`, { method: 'POST', body: '{}' });
              if (r.nome) form.querySelector('[name=name]').value = r.nome;
              if (r.area) form.querySelector('[name=legal_area]').value = r.area;
              if (r.resumo) form.querySelector('[name=notes]').value = r.resumo;
              toast('Dados extraídos da conversa ✨');
            } catch (e) { toast(e.message, 'error'); }
            ev.target.disabled = false; ev.target.textContent = '✨ Preencher com IA';
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

        const rs = box.querySelector('#wa-resumo');
        if (rs) rs.onclick = async () => {
          rs.disabled = true; rs.textContent = 'Lendo a conversa…';
          try {
            const r = await api(`/api/whatsapp-instance/chats/${ativo.phone}/resumo`, { method: 'POST', body: '{}' });
            openModal('Resumo da conversa (IA)', el(`<div>
              <div style="white-space:pre-wrap;font-size:13.5px;line-height:1.65;max-height:60vh;overflow:auto;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px">${esc(r.resumo)}</div>
              <button class="btn-sm" style="margin-top:10px" onclick="navigator.clipboard.writeText(this.previousElementSibling.textContent).then(()=>{})">Copiar resumo</button>
            </div>`));
          } catch (e) { toast(e.message, 'error'); }
          rs.disabled = false; rs.textContent = '✨ Resumir conversa com IA';
        };
      };

      const abrirChat = async (c, manterInput) => {
        ativo = { phone: c.phone, name: c.client_name || '+' + c.phone, client_id: c.client_id, labels: parseLabels(c.labels) };
        $('#wa-shell').classList.add('chat-open');
        const msgs = await api('/api/whatsapp-instance/chats/' + c.phone).catch(() => []);
        qtdMsgs = msgs.length;
        api(`/api/whatsapp-instance/chats/${c.phone}/read`, { method: 'POST', body: '{}' }).catch(() => {});
        c.unread = 0;
        const textoAtual = manterInput || '';
        $('#wap').innerHTML = `
          <div class="wa-head">
            <button class="btn-ghost btn-sm" id="wa-back" style="display:none">←</button>
            <div class="wa-ava" style="background:${cor(ativo.name)};width:36px;height:36px;flex:0 0 36px;font-size:13px">${iniciais(ativo.name)}</div>
            <div style="flex:1;min-width:0">
              <strong style="color:var(--navy-deep);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(ativo.name)}</strong>
              <small style="color:var(--text-muted)">+${esc(ativo.phone)}${ativo.client_id ? ' · cliente do escritório' : ''}</small>
            </div>
            <div class="wa-tags" id="wah-tags">${ativo.labels.map((t) => `<span class="wa-tag" style="background:${cor(t)}">${esc(t)}</span>`).join('')}</div>
            <button class="btn-sm" id="wa-label">🏷 Etiquetas</button>
            <button class="btn-sm" id="wa-pdf" title="Gerar PDF da conversa (juntar ao processo)">🖨</button>
            <button class="btn-sm" id="wa-info" title="Ficha do contato">ℹ</button>
          </div>
          <div class="wa-msgs" id="wam">${renderMsgs(msgs)}</div>
          <form class="wa-input" id="wa-reply">
            <button type="button" class="btn-sm" id="wa-modelos" title="Mensagens prontas" style="flex:0 0 auto;border-radius:20px">⚡</button>
            <input name="text" placeholder="Digite uma mensagem" autocomplete="off" value="${esc(textoAtual)}">
            <button class="wa-send" type="submit" title="Enviar">➤</button>
          </form>`;
        const box = $('#wam'); box.scrollTop = box.scrollHeight;
        if (window.innerWidth < 760) { const bk = $('#wa-back'); bk.style.display = ''; bk.onclick = () => { ativo = null; $('#wa-shell').classList.remove('chat-open'); renderLista(); }; }

        // Transcrever áudio (Whisper) — a transcrição fica gravada na mensagem
        box.querySelectorAll('[data-transcrever]').forEach((b) => b.onclick = async () => {
          b.disabled = true; b.textContent = 'Transcrevendo…';
          try {
            await api(`/api/whatsapp-instance/media/${b.dataset.transcrever}/transcricao`, { method: 'POST', body: '{}' });
            toast('Áudio transcrito ✓'); await atualizar(true);
          } catch (e) { toast(e.message, 'error'); b.disabled = false; b.textContent = 'Transcrever áudio'; }
        });

        // PDF da conversa — com papel timbrado, pronto para juntar ao processo
        $('#wa-pdf').onclick = () => {
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

        // Mensagens prontas (modelos jurídicos) — {{nome}} vira o primeiro nome
        $('#wa-modelos').onclick = async () => {
          const tpls = await api('/api/whatsapp-instance/templates').catch(() => []);
          const primeiroNome = (ativo.name.startsWith('+') ? '' : ativo.name).split(' ')[0] || '';
          const wrap = el(`<div>
            <div style="display:flex;flex-direction:column;gap:8px;max-height:46vh;overflow:auto">
              ${tpls.map((t) => `<div style="border:1px solid var(--border);border-radius:8px;padding:10px 12px">
                <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline">
                  <strong style="font-size:13px;color:var(--navy-deep)">${esc(t.title)}</strong>
                  <span style="white-space:nowrap"><button class="btn-gold btn-sm" data-usar="${t.id}">Usar</button> <button class="btn-ghost btn-sm" data-apagar="${t.id}">×</button></span>
                </div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:4px">${esc(t.body.slice(0, 110))}…</div>
              </div>`).join('') || '<div class="empty">Nenhum modelo ainda</div>'}
            </div>
            <hr style="border:none;border-top:1px solid var(--border);margin:12px 0">
            <form id="tpl-novo" class="form-grid">
              ${field('Título do novo modelo', 'title')}
              ${field('Mensagem (use {{nome}} para o nome do cliente)', 'body', { type: 'textarea' })}
              <button type="submit" class="btn-sm">+ Salvar novo modelo</button>
            </form>
          </div>`);
          wrap.querySelectorAll('[data-usar]').forEach((b) => b.onclick = () => {
            const t = tpls.find((x) => x.id == b.dataset.usar);
            const inp = $('#wa-reply [name=text]');
            inp.value = t.body.replace(/\{\{nome\}\}/g, primeiroNome || 'cliente');
            closeModal(); inp.focus();
          });
          wrap.querySelectorAll('[data-apagar]').forEach((b) => b.onclick = async () => {
            if (!confirm('Apagar este modelo?')) return;
            await api('/api/whatsapp-instance/templates/' + b.dataset.apagar, { method: 'DELETE' }).catch(() => {});
            closeModal(); $('#wa-modelos').click();
          });
          wrap.querySelector('#tpl-novo').onsubmit = async (ev) => {
            ev.preventDefault();
            const b2 = Object.fromEntries(new FormData(ev.target));
            if (!b2.title || !b2.body) { toast('Preencha título e mensagem', 'error'); return; }
            try { await api('/api/whatsapp-instance/templates', { method: 'POST', body: JSON.stringify(b2) }); toast('Modelo salvo'); closeModal(); $('#wa-modelos').click(); }
            catch (e) { toast(e.message, 'error'); }
          };
          openModal('Mensagens prontas', wrap);
        };
        // Painel de contexto: abre sozinho em telas largas; botão ℹ alterna
        $('#wa-info').onclick = () => { $('#wa-shell').classList.toggle('ctx-open'); if ($('#wa-shell').classList.contains('ctx-open')) renderContexto(); };
        if (window.innerWidth >= 1100 && !manterInput) { $('#wa-shell').classList.add('ctx-open'); renderContexto(); }
        else if ($('#wa-shell').classList.contains('ctx-open')) renderContexto();
        $('#wa-reply').onsubmit = async (ev) => {
          ev.preventDefault();
          const inp = $('#wa-reply [name=text]');
          const texto = inp.value.trim(); if (!texto) return;
          inp.value = '';
          try { await api(`/api/whatsapp-instance/chats/${ativo.phone}/send`, { method: 'POST', body: JSON.stringify({ text: texto }) }); await atualizar(true); }
          catch (e) { toast(e.message, 'error'); inp.value = texto; }
        };
        $('#wa-label').onclick = () => {
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
      };

      // Atualização (polling suave a cada 6s — lista e conversa aberta)
      const atualizar = async (forcarChat) => {
        // Busca com 3+ letras vale também para o CONTEÚDO das mensagens (servidor)
        const q = busca.trim().length >= 3 ? `?q=${encodeURIComponent(busca.trim())}` : '';
        chats = await api('/api/whatsapp-instance/chats' + q).catch(() => chats);
        renderFiltros(); renderLista();
        if (ativo) {
          const c = chats.find((x) => x.phone === ativo.phone);
          const msgs = await api('/api/whatsapp-instance/chats/' + ativo.phone).catch(() => null);
          if (msgs && (forcarChat || msgs.length !== qtdMsgs)) {
            const digitando = $('#wa-reply [name=text]')?.value || '';
            await abrirChat(c || { phone: ativo.phone, client_name: ativo.name, client_id: ativo.client_id, labels: JSON.stringify(ativo.labels) }, digitando);
          }
        }
      };

      let buscaTimer = null;
      $('#waq').oninput = (e) => {
        busca = e.target.value; renderLista();
        clearTimeout(buscaTimer);
        buscaTimer = setTimeout(() => atualizar(false), 400); // busca no conteúdo (servidor)
      };
      await atualizar(false);
      if (!chats.length) $('#wal').innerHTML = '<div class="wa-empty">Nenhuma conversa ainda.<br>Com a instância conectada, tudo que chegar e sair aparece aqui.</div>';
      chatTimer = setInterval(() => { if (tab === 'conversas') atualizar(false); else { clearInterval(chatTimer); chatTimer = null; } }, 6000);
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
