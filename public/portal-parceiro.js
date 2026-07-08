// ============================================================================
// portal-parceiro.js — telas do PORTAL DO PARCEIRO (papel parceiro_portal)
// Extraído do app.js (modularização). Carregado DEPOIS do app.js no index.html;
// usa os globais do app.js (api, $, esc, money, kpi, fmt*, stepperHtml, badge,
// el, openModal, svgIcon, printBranded) e registra as rotas em ROUTES.
// ============================================================================

Object.assign(ROUTES, {
  // ── Portal do PARCEIRO (papel parceiro_portal) — somente leitura ──
  async ppcases(page) {
    const [me, cases] = await Promise.all([api('/api/partner-portal/me'), api('/api/partner-portal/cases')]);
    page.innerHTML = `
      <div class="page-header"><div><h2>Olá, ${esc(me.name || 'Parceiro')}</h2><p class="sub">Acompanhe os casos que você indicou</p></div></div>
      <div class="kpi-grid">
        ${kpi('Casos ativos', me.resumo.casos_ativos)}
        ${kpi('Repasse a receber', money(me.resumo.repasse_a_receber), 'money')}
        ${kpi('Repasse recebido', money(me.resumo.repasse_recebido), 'money')}
      </div>
      <div class="card" style="margin-top:16px"><div style="padding:14px 18px;border-bottom:1px solid var(--border)"><strong style="color:var(--navy)">Taxas de entrada</strong><small style="color:var(--text-muted);margin-left:8px">o que devo ao escritório</small></div><div id="pp-entradas"><div class="spinner"></div></div></div>
      <div id="pp-cases"></div>`;
    $('#pp-cases').innerHTML = cases.length ? cases.map((c) => {
      const atras = !['protocolado', 'concluido'].includes(c.production_stage) && Number(c.sla_days) > 10;
      return `<div class="card" style="padding:18px;margin-bottom:14px;margin-top:14px">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline">
          <span style="min-width:0"><strong style="font-size:15.5px;color:var(--navy-deep)">${esc(c.client_name || '—')}</strong>${c.title ? ` <span style="color:var(--text-muted);font-size:13px">· ${esc(c.title)}</span>` : ''}</span>
          <small style="color:var(--text-muted)">${c.case_number ? 'Processo ' + esc(c.case_number) : 'Em preparação'}</small>
        </div>
        ${stepperHtml(c)}
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;font-size:13px">
          <span>SLA: <strong style="color:${atras ? 'var(--red)' : 'var(--text)'}">${['protocolado', 'concluido'].includes(c.production_stage) ? 'concluído' : (c.sla_days ?? 0) + '/10 dias'}</strong></span>
          ${c.valor_causa ? `<span>Valor da causa: <strong style="color:var(--navy-deep)">${money(c.valor_causa)}</strong></span>` : ''}
          <span>Valor do processo: <strong>${money(c.valor_processo)}</strong></span>
          <span>Seu repasse: <strong style="color:var(--gold)">${money(c.repasse_parceiro)}</strong></span>
        </div>
        <div style="margin-top:12px"><button class="btn-sm" data-ppcase="${c.id}">Ver detalhes</button></div>
      </div>`;
    }).join('') : '<div class="empty" style="padding:16px">Nenhum caso indicado ainda</div>';
    page.querySelectorAll('[data-ppcase]').forEach((b) => b.onclick = () => partnerCaseDetail(b.dataset.ppcase));
    api('/api/partner-portal/entradas').then((e) => {
      if (!e.rows.length) { $('#pp-entradas').innerHTML = '<div class="empty" style="padding:16px">Nenhuma taxa de entrada lançada</div>'; return; }
      $('#pp-entradas').innerHTML = `<div style="padding:8px 12px">` + e.rows.map((r) => {
        const st = r.status === 'pago' ? '<span class="badge pago">pago</span>' : (r.due_date && r.due_date.split('T')[0] < new Date().toISOString().split('T')[0] ? '<span class="badge vencido">vencido</span>' : '<span class="badge">pendente</span>');
        return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 6px;border-bottom:1px solid var(--border)">
          <div><strong style="font-size:14px">${esc(r.client_name || '—')}</strong>${r.case_number ? ` <small style="color:var(--text-muted)">· Proc. ${esc(r.case_number)}</small>` : ''}
            <div style="font-size:12px;color:var(--text-muted)">${esc(r.description)} · vence ${fmtDate(r.due_date)}</div></div>
          <div style="display:flex;align-items:center;gap:8px"><strong style="font-size:15px;color:var(--navy-deep)">${money(r.valor)}</strong>${st}</div>
        </div>`;
      }).join('') + `<div style="padding:12px 6px;font-size:13px;color:var(--text-muted)">Total devido: <strong style="color:var(--red)">${money(e.total_devido)}</strong> · Total pago: <strong style="color:var(--green)">${money(e.total_pago)}</strong></div></div>`;
    }).catch(() => { $('#pp-entradas').innerHTML = '<div class="empty" style="padding:16px">—</div>'; });
  },

  // Módulo próprio: linha do tempo de todos os casos do parceiro
  // (registros do escritório + movimentações do tribunal via monitoramento).
  async ppupdates(page) {
    const tl = await api('/api/partner-portal/timeline').catch(() => []);
    page.innerHTML = `
      <div class="page-header"><div><h2>Atualizações</h2><p class="sub">Tudo o que aconteceu nos seus casos, do mais recente ao mais antigo</p></div></div>
      <div id="ppu-list"></div>`;
    $('#ppu-list').innerHTML = tl.length ? tl.map((e) => `
      <div class="card" style="padding:14px 18px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline">
          <span style="min-width:0"><strong style="color:var(--navy-deep)">${esc(e.client_name || '—')}</strong>${e.case_title ? ` <span style="color:var(--text-muted);font-size:13px">· ${esc(e.case_title)}</span>` : ''}</span>
          <small style="color:var(--text-muted)">${fmtDate(e.movement_date || e.created_at)}</small>
        </div>
        <div style="font-size:13.5px;margin-top:6px">${esc(e.description)}</div>
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
          ${e.case_number ? `<span class="badge">Proc. ${esc(e.case_number)}</span>` : ''}
          ${e.origem === 'tribunal' ? '<span class="badge" style="background:var(--gold-soft,#efe3c8);color:var(--navy)">movimentação do tribunal</span>' : '<span class="badge">atualização do escritório</span>'}
        </div>
      </div>`).join('') : '<div class="empty">Sem atualizações ainda — assim que houver movimentação nos seus casos, ela aparece aqui.</div>';
  },

  // Fichas dos clientes indicados — preenchidas com o que o escritório já tem (sem contato)
  async ppclients(page) {
    const fichas = await api('/api/partner-portal/clients').catch(() => []);
    const STAGE_PT = { separacao_documentos: 'Separação de docs', criacao_inicial: 'Criação inicial', revisao_inicial: 'Revisão inicial', aguardando_protocolo: 'Aguardando protocolo', protocolado: 'Protocolado', concluido: 'Concluído' };
    page.innerHTML = `
      <div class="page-header"><div><h2>Fichas dos Clientes</h2><p class="sub">Os clientes que você indicou, com os dados que o escritório já possui</p></div></div>
      <div id="ppc-list"></div>`;
    const linha = (rotulo, valor) => valor ? `<div style="display:flex;gap:8px;font-size:13px;padding:3px 0"><span style="color:var(--text-muted);min-width:110px">${rotulo}</span><strong>${esc(String(valor))}</strong></div>` : '';
    $('#ppc-list').innerHTML = fichas.length ? fichas.map((f) => `
      <div class="card" style="padding:18px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline">
          <strong style="font-size:16px;color:var(--navy-deep)">${esc(f.name)}</strong>
          <small style="color:var(--text-muted)">cliente desde ${fmtDate(f.cliente_desde)}</small>
        </div>
        <div style="margin-top:10px">
          ${linha('CPF/CNPJ', f.cpf_cnpj)}
          ${linha('RG', f.rg)}
          ${linha('Profissão', f.profissao)}
          ${linha('Estado civil', f.estado_civil)}
          ${linha('Endereço', f.endereco)}
        </div>
        <div style="margin-top:12px"><strong style="font-size:12px;color:var(--navy)">Processos desta parceria</strong>
          ${(f.cases || []).map((c) => `
            <div class="mini-row" style="align-items:baseline">
              <span style="min-width:0">${esc(c.title || '—')}${c.case_number ? `<br><small style="color:var(--text-muted)">nº ${esc(c.case_number)}</small>` : ''}</span>
              <span style="text-align:right;white-space:nowrap">${c.valor_causa ? `<strong style="color:var(--navy-deep)">${money(c.valor_causa)}</strong> · ` : ''}<span class="badge">${STAGE_PT[c.production_stage] || c.production_stage || '—'}</span></span>
            </div>`).join('')}
        </div>
      </div>`).join('') : '<div class="empty">Nenhum cliente indicado ainda.</div>';
  },

  // Agenda de audiências dos casos do parceiro (alertas automáticos 7 e 3 dias antes)
  async ppagenda(page) {
    const evs = await api('/api/partner-portal/agenda').catch(() => []);
    page.innerHTML = `
      <div class="page-header"><div><h2>Audiências</h2><p class="sub">Audiências marcadas nos seus casos — você recebe alerta e e-mail 7 e 3 dias antes</p></div></div>
      <div id="ppa-list"></div>`;
    $('#ppa-list').innerHTML = evs.length ? evs.map((e) => {
      const start = new Date(e.start_datetime);
      const online = !!(e.video_link && String(e.video_link).trim());
      const urg = Number(e.dias) <= 3;
      return `<div class="card" style="padding:16px 18px;margin-bottom:12px;border-left:3px solid ${urg ? 'var(--red)' : 'var(--gold)'}">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline">
          <span style="min-width:0"><strong style="color:var(--navy-deep)">${esc(e.client_name || '—')}</strong>${e.case_title ? ` <span style="color:var(--text-muted);font-size:13px">· ${esc(e.case_title)}</span>` : ''}</span>
          <strong style="color:${urg ? 'var(--red)' : 'var(--navy)'};font-size:13px">${Number(e.dias) === 0 ? 'HOJE' : `em ${e.dias} dia${Number(e.dias) > 1 ? 's' : ''}`}</strong>
        </div>
        <div style="margin-top:8px;font-size:14px"><strong>${fmtDateTime(e.start_datetime)}</strong> <span class="badge" style="margin-left:6px;${online ? 'background:var(--gold-soft,#efe3c8);color:var(--navy)' : ''}">${online ? 'ONLINE' : 'presencial'}</span></div>
        <div style="margin-top:6px;font-size:13px;color:var(--text-muted)">
          ${e.case_number ? `Proc. ${esc(e.case_number)} · ` : ''}${esc(e.title || 'Audiência')}
          ${!online && e.location ? `<br>Local: ${esc(e.location)}` : ''}
        </div>
        ${online && e.video_link ? `<div style="margin-top:10px"><a class="btn-gold btn-sm" style="text-decoration:none" href="${esc(e.video_link)}" target="_blank" rel="noopener">Abrir link da audiência</a> <small style="color:var(--text-muted);margin-left:6px">oriente o cliente a entrar 15 min antes</small></div>`
          : `<div style="margin-top:8px;font-size:12.5px;color:var(--text-muted)">Oriente o cliente a chegar 30 min antes, com documento com foto.</div>`}
      </div>`;
    }).join('') : '<div class="empty">Nenhuma audiência futura nos seus casos.</div>';
  },

  async ppfin(page) {
    const [rows, entradas] = await Promise.all([
      api('/api/partner-portal/financial'),
      api('/api/partner-portal/entradas').catch(() => ({ rows: [], total_devido: 0, total_pago: 0 })),
    ]);
    const aReceber = rows.filter((r) => ['pendente', 'processando'].includes(r.status)).reduce((s, r) => s + Number(r.valor), 0);
    page.innerHTML = `
      <div class="page-header"><div><h2>Financeiro</h2><p class="sub">Repasses a receber e taxas de entrada</p></div>
        <button class="btn-ghost" id="pp-extrato">Baixar extrato do mês</button></div>
      <div class="kpi-grid">
        ${kpi('Repasse a receber', money(aReceber), 'money')}
        ${kpi('Taxas pendentes', money(entradas.total_devido), 'money')}
        ${kpi('Taxas pagas', money(entradas.total_pago), 'money')}
      </div>
      <div class="card" style="margin-bottom:20px">
        <div style="padding:14px 18px;border-bottom:1px solid var(--border)"><strong style="color:var(--navy)">Repasses — o que o escritório me deve</strong></div>
        <div id="pp-fin"></div>
      </div>
      <div class="card">
        <div style="padding:14px 18px;border-bottom:1px solid var(--border)"><strong style="color:var(--navy)">Taxas de entrada — o que devo ao escritório</strong></div>
        <div id="pp-entradas-fin"></div>
      </div>`;
    $('#pp-fin').innerHTML = rows.length ? `
      <table><thead><tr><th>Cliente / Caso</th><th>Tipo</th><th>Valor</th><th>Vencimento</th><th>Status</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td><strong>${esc(r.client_name || '—')}</strong><br><small style="color:var(--text-muted)">${esc(r.case_title || r.case_number || '')}</small></td>
        <td>${esc(r.tipo || '—')}</td><td><strong>${money(r.valor)}</strong></td>
        <td>${fmtDate(r.data_vencimento)}</td>
        <td>${r.status === 'repassado' ? `<span class="badge pago">recebido${r.data_repasse ? ' em ' + fmtDate(r.data_repasse) : ''}</span>${r.comprovante_url ? ` <a class="btn-sm" style="text-decoration:none" href="${esc(r.comprovante_url)}" target="_blank" rel="noopener">Comprovante</a>` : ''}`
          : r.status === 'cancelado' ? '<span class="badge cancelado">cancelado</span>'
          : '<span class="badge">a receber</span>'}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty" style="padding:16px">Nenhum repasse registrado ainda</div>';
    // Extrato do mês — janela de impressão com o papel timbrado (salvar como PDF)
    $('#pp-extrato').onclick = () => {
      const mesRef = new Date();
      const mes = mesRef.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      const ym = mesRef.toISOString().slice(0, 7);
      const noMes = (d) => d && String(d).slice(0, 7) === ym;
      const repMes = rows.filter((r) => noMes(r.data_vencimento) || noMes(r.data_repasse));
      const entMes = entradas.rows.filter((r) => noMes(r.due_date) || noMes(r.paid_at));
      const tbl = (cab, linhas) => linhas.length
        ? `<table style="width:100%;border-collapse:collapse;margin:8px 0 18px">${cab}${linhas}</table>`
        : '<p style="color:#777;font-size:13px;margin:6px 0 18px">Nenhum lançamento neste mês.</p>';
      printBranded(`Extrato da parceria — ${mes}`, 'Documento informativo (não fiscal)', `
        <h3 style="margin:14px 0 4px">Repasses</h3>
        ${tbl('<tr><th style="text-align:left;border-bottom:1px solid #ccc;padding:6px">Cliente / Caso</th><th style="text-align:right;border-bottom:1px solid #ccc;padding:6px">Valor</th><th style="text-align:left;border-bottom:1px solid #ccc;padding:6px">Status</th></tr>',
          repMes.map((r) => `<tr><td style="padding:6px;border-bottom:1px solid #eee">${esc(r.client_name || '')} — ${esc(r.case_title || r.case_number || '')}</td><td style="padding:6px;text-align:right;border-bottom:1px solid #eee">${money(r.valor)}</td><td style="padding:6px;border-bottom:1px solid #eee">${r.status === 'repassado' ? 'recebido em ' + fmtDate(r.data_repasse) : r.status}</td></tr>`).join(''))}
        <h3 style="margin:14px 0 4px">Taxas de entrada</h3>
        ${tbl('<tr><th style="text-align:left;border-bottom:1px solid #ccc;padding:6px">Cliente</th><th style="text-align:right;border-bottom:1px solid #ccc;padding:6px">Valor</th><th style="text-align:left;border-bottom:1px solid #ccc;padding:6px">Status</th></tr>',
          entMes.map((r) => `<tr><td style="padding:6px;border-bottom:1px solid #eee">${esc(r.client_name || '')}</td><td style="padding:6px;text-align:right;border-bottom:1px solid #eee">${money(r.valor)}</td><td style="padding:6px;border-bottom:1px solid #eee">${r.status}</td></tr>`).join(''))}
        <p style="margin-top:10px"><strong>Totais do mês:</strong>
          repasses recebidos ${money(repMes.filter((r) => r.status === 'repassado').reduce((s, r) => s + Number(r.valor), 0))} ·
          a receber ${money(repMes.filter((r) => ['pendente', 'processando'].includes(r.status)).reduce((s, r) => s + Number(r.valor), 0))} ·
          entradas devidas ${money(entMes.filter((r) => r.status !== 'pago').reduce((s, r) => s + Number(r.valor), 0))}</p>
        <p style="color:#777;font-size:12px">Use "Imprimir → Salvar como PDF" para arquivar este extrato.</p>`);
    };
    $('#pp-entradas-fin').innerHTML = entradas.rows.length ? `
      <table><thead><tr><th>Cliente / Proc.</th><th>Descrição</th><th>Valor</th><th>Vencimento</th><th>Status</th></tr></thead>
      <tbody>${entradas.rows.map((r) => {
        const vencida = r.status !== 'pago' && r.due_date && r.due_date.split('T')[0] < new Date().toISOString().split('T')[0];
        return `<tr>
          <td><strong>${esc(r.client_name || '—')}</strong>${r.case_number ? `<br><small style="color:var(--text-muted)">Proc. ${esc(r.case_number)}</small>` : ''}</td>
          <td><small>${esc(r.description)}</small></td>
          <td><strong>${money(r.valor)}</strong></td>
          <td>${fmtDate(r.due_date)}</td>
          <td>${r.status === 'pago' ? '<span class="badge pago">pago</span>' : vencida ? '<span class="badge vencido">vencido</span>' : '<span class="badge">pendente</span>'}</td>
        </tr>`;
      }).join('')}</tbody></table>`
      : '<div class="empty" style="padding:16px">Nenhuma taxa lançada ainda</div>';
  },
});

// Detalhe do caso para o PARCEIRO — ficha SEM contato do cliente + movimentações + financeiro
async function partnerCaseDetail(id) {
  const c = await api('/api/partner-portal/cases/' + id);
  const movs = (c.movements || []).map((m) =>
    `<div style="padding:9px 0;border-bottom:1px solid var(--border-soft)"><small style="color:var(--text-muted)">${fmtDate(m.movement_date || m.created_at)}</small><div style="font-size:13.5px">${esc(m.description)}</div></div>`).join('') || '<p class="empty">Sem movimentações registradas</p>';
  const parc = (c.installments || []).map((i) =>
    `<div class="mini-row"><span>${i.numero ? i.numero + 'ª' : 'Parcela'} · venc. ${fmtDate(i.due_date)}</span><span><strong>${money(i.valor)}</strong> ${badge(i.status)}</span></div>`).join('') || '<small style="color:var(--text-muted)">Sem parcelas</small>';
  const rep = (c.repasses || []).map((r) =>
    `<div class="mini-row"><span>${esc(r.tipo || 'repasse')} · venc. ${fmtDate(r.data_vencimento)}</span><span><strong style="color:var(--gold)">${money(r.valor)}</strong> ${r.status === 'repassado' ? '<span class="badge pago">recebido</span>' : r.status === 'cancelado' ? '<span class="badge cancelado">cancelado</span>' : '<span class="badge pendente">a receber</span>'}${r.comprovante_url ? ` <a class="btn-sm" style="text-decoration:none" href="${esc(r.comprovante_url)}" target="_blank" rel="noopener">Comprovante</a>` : ''}</span></div>`).join('') || '<small style="color:var(--text-muted)">Sem repasses ainda</small>';
  const pend = (c.pendencias || []).map((p) =>
    `<div style="padding:7px 10px;border-left:3px solid var(--red);background:var(--surface);border-radius:6px;margin-top:6px;font-size:13px">⚠ ${esc(p.text)}<br><small style="color:var(--text-muted)">${fmtDate(p.created_at)}</small></div>`).join('');
  const wrap = el(`<div>
    <div><strong style="font-size:18px;color:var(--navy-deep)">${esc(c.client_name || 'Cliente')}</strong>${c.title ? ` <span style="color:var(--text-muted);font-size:14px">· ${esc(c.title)}</span>` : ''}<br>
      <small style="color:var(--text-muted)">${esc(c.legal_area || '')}${c.case_number ? ' · Processo ' + esc(c.case_number) : ' · Em preparação'}${c.valor_causa ? ' · Valor da causa: ' + money(c.valor_causa) : ''}</small></div>
    ${stepperHtml(c)}
    ${pend ? `<div style="margin-top:12px"><strong style="font-size:13px;color:var(--red)">Pendências — precisamos de você</strong>${pend}</div>` : ''}
    ${c.resumo ? `<div class="client-msg">${esc(c.resumo)}</div>` : ''}
    <div style="margin-top:16px"><strong style="font-size:13px;color:var(--navy)">Financeiro do processo</strong><div style="margin-top:6px">${parc}</div></div>
    <div style="margin-top:14px"><strong style="font-size:13px;color:var(--navy)">Seus repasses</strong><div style="margin-top:6px">${rep}</div></div>
    <div style="margin-top:16px"><button class="btn-sm" id="ppd-toggle" type="button">Ver movimentações do processo</button>
      <div id="ppd-movs" style="display:none;max-height:300px;overflow-y:auto;margin-top:8px">${movs}</div></div>
  </div>`);
  wrap.querySelector('#ppd-toggle').onclick = (e) => {
    const box = wrap.querySelector('#ppd-movs');
    const open = box.style.display === 'none';
    box.style.display = open ? 'block' : 'none';
    e.target.textContent = open ? 'Ocultar movimentações' : 'Ver movimentações do processo';
  };
  openModal('Caso indicado', wrap);
}
