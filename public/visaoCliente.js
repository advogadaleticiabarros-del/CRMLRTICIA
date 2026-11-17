// ── Visão completa do cliente (18/10/2026) ──────────────────────────────────
// Pedido da Jessica: na página inicial, pesquisar um cliente e ver TUDO dele —
// se é dativo, parceria ou próprio, processos e números, financeiro, acordos e
// repasses, movimentações, prazos, audiências, propostas, contratos e
// documentos. Usa os globais de app.js (api, el, esc, money, openModal, toast,
// waBtn, procNumHtml, AREA_LABELS, fichaCliente). Dados: GET /api/clients/:id/visao.
(function () {
  // "2026-10-18" vira 18/10/2026 sem o fuso jogar para o dia anterior.
  const dataBr = (v) => {
    if (!v) return '—';
    const s = String(v);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m && s.length <= 10) return `${m[3]}/${m[2]}/${m[1]}`;
    const d = new Date(s.replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  };
  const dataHora = (v) => {
    if (!v) return '—';
    const d = new Date(String(v).replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  const vazio = (t) => `<p class="pi-vazio" style="margin:6px 0">${t}</p>`;
  const COR_REL = { dativo: '#7c3aed', parceria: '#0369a1', proprio: '#15803d' };
  const STATUS_PT = {
    pendente: 'pendente', cumprido: 'cumprido', cancelado: 'cancelado', ativo: 'ativo', arquivado: 'arquivado', suspenso: 'suspenso', baixado: 'baixado',
    nomeada: 'nomeada', em_andamento: 'em andamento', concluida: 'concluída', aguardando_liberacao_requerimento: 'aguardando requerimento', a_receber: 'a receber', paga: 'paga', recusada: 'recusada',
    previsto: 'previsto', recebido: 'recebido', repassado: 'repassado', processando: 'processando',
    rascunho: 'rascunho', enviada: 'enviada', em_negociacao: 'em negociação', aceita: 'aceita', expirada: 'expirada',
    em_producao: 'em produção', finalizado: 'finalizado', enviado_assinatura: 'enviado p/ assinatura', assinado: 'assinado',
  };
  const st = (s) => `<span class="badge ${esc(s || '')}">${esc(STATUS_PT[s] || String(s || '—').replace(/_/g, ' '))}</span>`;
  const tabela = (cab, linhas) => `<div class="table-wrap"><table><thead><tr>${cab.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${linhas.join('')}</tbody></table></div>`;

  // ── Busca da página inicial ──────────────────────────────────────────────
  window.montarBuscaCliente = function (container) {
    if (!container) return;
    container.innerHTML = `
      <div class="card" style="padding:14px 16px;margin-bottom:14px">
        <label for="vc-busca" style="display:block;font-weight:700;color:var(--navy);margin-bottom:6px">🔎 Pesquisar cliente</label>
        <div style="position:relative">
          <input id="vc-busca" type="search" autocomplete="off" placeholder="Nome, CPF, telefone ou número do processo"
            style="width:100%;font-size:15px;padding:11px 12px" aria-describedby="vc-busca-ajuda">
          <div id="vc-resultados" role="listbox" style="position:absolute;left:0;right:0;top:100%;z-index:30;background:var(--card,#fff);border:1px solid var(--border);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);display:none;max-height:360px;overflow:auto"></div>
        </div>
        <small id="vc-busca-ajuda" style="color:var(--text-muted)">Abre tudo do cliente: dativo, parceria ou próprio, processos, financeiro, acordos, movimentações, prazos e documentos.</small>
      </div>`;
    const inp = container.querySelector('#vc-busca');
    const box = container.querySelector('#vc-resultados');
    let ultimo = '';
    let seq = 0;
    const fechar = () => { box.style.display = 'none'; };
    const buscar = async () => {
      const termo = inp.value.trim();
      if (termo === ultimo) return;
      ultimo = termo;
      if (termo.length < 2) { fechar(); return; }
      const minha = ++seq;
      try {
        const r = await api(`/api/clients/busca-360?q=${encodeURIComponent(termo)}`);
        if (minha !== seq) return; // chegou a resposta de uma busca antiga
        box.innerHTML = r.length
          ? r.map((c) => `<button type="button" role="option" data-id="${c.id}" style="display:block;width:100%;text-align:left;padding:10px 12px;border:0;border-bottom:1px solid var(--border-soft);background:none;cursor:pointer">
              <b>${esc(c.name)}</b> <small style="color:var(--text-muted)">${esc(c.cpf_cnpj || '')}${c.phone ? ' · ' + esc(c.phone) : ''}</small><br>
              <small style="color:var(--text-muted)">encontrado por ${esc(c.motivo)}</small></button>`).join('')
          : '<div style="padding:12px;color:var(--text-muted)">Nenhum cliente encontrado.</div>';
        box.style.display = 'block';
        box.querySelectorAll('[data-id]').forEach((b) => b.onclick = () => { fechar(); inp.value = ''; ultimo = ''; window.visaoCliente(Number(b.dataset.id)); });
      } catch (e) { box.innerHTML = `<div style="padding:12px;color:var(--red)">${esc(e.message)}</div>`; box.style.display = 'block'; }
    };
    let t;
    inp.oninput = () => { clearTimeout(t); t = setTimeout(buscar, 250); };
    inp.onkeydown = (e) => {
      if (e.key === 'Escape') { fechar(); return; }
      if (e.key === 'Enter') { const p = box.querySelector('[data-id]'); if (p) { e.preventDefault(); p.click(); } }
    };
    document.addEventListener('click', (e) => { if (!container.contains(e.target)) fechar(); });
  };

  // ── Visão completa ───────────────────────────────────────────────────────
  window.visaoCliente = async function (id) {
    const corpo = el('<div><div class="spinner"></div></div>');
    openModal('Cliente', corpo, { wide: true });
    let v;
    try { v = await api(`/api/clients/${id}/visao`); } catch (e) { corpo.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const c = v.cliente, f = v.financeiro;
    const titulo = document.querySelector('#modal-title');
    if (titulo) titulo.textContent = c.name;

    const kpi = (rotulo, valor, cor, dica) => `<div class="card" style="padding:10px 12px;min-width:140px;flex:1" title="${esc(dica || '')}"><small style="color:var(--text-muted)">${rotulo}</small><div style="font-size:18px;font-weight:800;color:${cor || 'var(--navy)'}">${valor}</div></div>`;
    const kpis = [
      kpi('A receber (sua parte)', money(f.aReceber), null, 'Honorários e lançamentos em aberto, sem a parte do parceiro'),
      f.vencido ? kpi('Vencido', money(f.vencido), 'var(--red)') : '',
      kpi('Recebido', money(f.recebido), 'var(--green)'),
      f.acordos.total ? kpi('Acordos', money(f.acordos.total), null, `Honorários dos acordos: ${money(f.acordos.honorarios)}`) : '',
      f.repasseCliente.pendente ? kpi('Repasse ao cliente pendente', money(f.repasseCliente.pendente), '#b45309') : '',
      (f.dativo.aReceber || f.dativo.recebido) ? kpi('Dativo (Estado)', `${money(f.dativo.aReceber)} a receber`, '#7c3aed', `Já recebido do Estado: ${money(f.dativo.recebido)}`) : '',
      f.parteParceiroAReceber ? kpi('Parte do parceiro (a receber)', money(f.parteParceiroAReceber), '#0369a1') : '',
    ].join('');

    const abas = {
      processos: { rotulo: `Processos (${v.processos.length + v.casos.length + v.dativos.length})`, html: () => [
        v.casos.length ? `<h4 style="margin:4px 0">Casos do escritório</h4>${tabela(['Nº do processo', 'Caso', 'Área', 'Tipo', 'Fase / etapa', 'Status'], v.casos.map((x) =>
          `<tr><td>${procNumHtml(x.case_number)}</td><td>${esc(x.title || '—')}</td><td>${esc(AREA_LABELS[x.legal_area] || x.legal_area || '—')}</td>
           <td>${x.partner_id ? `<span style="color:#0369a1;font-weight:700">Parceria</span>${x.partner_name ? `<br><small>${esc(x.partner_name)}</small>` : ''}` : '<span style="color:#15803d;font-weight:700">Próprio</span>'}</td>
           <td>${esc(x.phase || '—')}${x.production_stage ? `<br><small>${esc(String(x.production_stage).replace(/_/g, ' '))}</small>` : ''}</td><td>${st(x.status)}</td></tr>`))}` : '',
        v.processos.length ? `<h4 style="margin:12px 0 4px">Processos monitorados nos tribunais</h4>${tabela(['Nº do processo', 'Tribunal', 'Fase', 'Última movimentação', 'Monitorando', 'Status'], v.processos.map((p) =>
          `<tr><td>${procNumHtml(p.process_number)}</td><td>${esc(p.court_alias || p.court || '—')}</td><td>${esc(p.phase || '—')}</td><td>${dataBr(p.last_movement_at)}</td><td>${p.monitoring_enabled ? 'sim' : 'não'}</td><td>${st(p.status)}</td></tr>`))}` : '',
        v.dativos.length ? `<h4 style="margin:12px 0 4px">Dativo (nomeações do juízo)</h4>${tabela(['Nº do processo', 'Comarca / vara', 'Assunto', 'Nomeação', 'Valor', 'Status'], v.dativos.map((d) =>
          `<tr><td>${procNumHtml(d.process_number)}</td><td>${esc(d.comarca || '—')}${d.vara ? `<br><small>${esc(d.vara)}</small>` : ''}</td><td>${esc(d.assunto || d.area || '—')}</td>
           <td>${dataBr(d.nomeacao_date)}</td><td>${money(d.arbitrated_value || d.estimated_value)}${d.arbitrated_value ? '<br><small>arbitrado</small>' : d.estimated_value ? '<br><small>estimado</small>' : ''}</td><td>${st(d.status)}</td></tr>`))}` : '',
      ].join('') || vazio('Nenhum processo ou caso vinculado.') },

      financeiro: { rotulo: `Financeiro (${v.lancamentos.length})`, html: () => v.lancamentos.length
        ? tabela(['Vencimento', 'Descrição', 'Processo', 'Valor', 'Sua parte', 'Situação'], v.lancamentos.map((r) =>
          `<tr><td>${dataBr(r.vencimento)}</td><td>${esc(r.descricao || '—')}</td><td>${r.processo ? procNumHtml(r.processo) : '—'}</td><td>${money(r.valor)}</td>
           <td>${r.parceiro ? `${money(r.seu)}<br><small>parceiro ${money(r.parceiro)}</small>` : money(r.seu ?? r.valor)}</td>
           <td>${r.recebido ? `<span style="color:var(--green);font-weight:700">recebido</span>${r.pago_em ? `<br><small>${dataBr(r.pago_em)}</small>` : ''}` : r.vencido ? '<span style="color:var(--red);font-weight:700">vencido</span>' : 'a receber'}</td></tr>`))
        : vazio('Nenhum lançamento financeiro.') },

      acordos: { rotulo: `Acordos e repasses (${v.acordos.length})`, html: () => [
        v.acordos.length ? tabela(['Processo', 'Parte contrária', 'Valor do acordo', 'Parcelas', 'Honorários', 'Status'], v.acordos.map((a) =>
          `<tr><td>${a.process_number ? procNumHtml(a.process_number) : '—'}${a.is_extrajudicial ? '<br><small>extrajudicial</small>' : ''}</td><td>${esc(a.opposing_party || '—')}</td>
           <td>${money(a.total_agreement_value)}${a.entrada_value ? `<br><small>entrada ${money(a.entrada_value)}</small>` : ''}</td><td>${esc(a.installments_count || '—')}${a.first_due_date ? `<br><small>1ª em ${dataBr(a.first_due_date)}</small>` : ''}</td>
           <td>${money(a.honorarium_value)}${a.honorarium_percentage ? `<br><small>${esc(a.honorarium_percentage)}%</small>` : ''}</td><td>${st(a.status)}</td></tr>`)) : vazio('Nenhum acordo.'),
        v.repassesCliente.length ? `<h4 style="margin:12px 0 4px">Repasses ao cliente</h4>${tabela(['Parcela', 'Previsto', 'Bruto', 'Honorários', 'Líquido ao cliente', 'Status'], v.repassesCliente.map((x) =>
          `<tr><td>${esc(x.tranche_label || '—')}</td><td>${dataBr(x.data_prevista)}</td><td>${money(x.valor_bruto)}</td><td>${money(x.valor_honorarios)}</td><td><b>${money(x.valor_liquido)}</b></td>
           <td>${st(x.status)}${x.data_repasse ? `<br><small>${dataBr(x.data_repasse)}</small>` : ''}</td></tr>`))}` : '',
        v.repassesParceiro.length ? `<h4 style="margin:12px 0 4px">Repasses ao parceiro</h4>${tabela(['Parceiro', 'Tipo', 'Valor', 'Vencimento', 'Status'], v.repassesParceiro.map((x) =>
          `<tr><td>${esc(x.parceiro || '—')}</td><td>${esc(x.tipo || '—')}</td><td>${money(x.valor)}</td><td>${dataBr(x.data_vencimento)}</td><td>${st(x.status)}</td></tr>`))}` : '',
        v.pagamentosDativo.length ? `<h4 style="margin:12px 0 4px">Pagamentos do Estado (dativo)</h4>${tabela(['Referência', 'Previsto', 'Recebido em', 'Valor', 'Status'], v.pagamentosDativo.map((x) =>
          `<tr><td>${esc(x.reference || '—')}</td><td>${dataBr(x.expected_date)}</td><td>${dataBr(x.received_date)}</td><td>${money(x.value)}</td><td>${st(x.status)}</td></tr>`))}` : '',
      ].join('') },

      movimentacoes: { rotulo: `Movimentações (${v.movimentacoes.length})`, html: () => v.movimentacoes.length
        ? `<ul class="ev-hist" style="max-height:none">${v.movimentacoes.map((m) => `<li><time>${dataBr(m.data)}</time><span>${m.process_number ? `<small style="color:var(--text-muted)">${esc(m.process_number)}</small><br>` : ''}${esc(m.description || '—')}</span></li>`).join('')}</ul>`
        : vazio('Nenhuma movimentação registrada.') },

      prazos: { rotulo: `Prazos e audiências (${v.prazos.length + v.audiencias.length})`, html: () => [
        v.audiencias.length ? `<h4 style="margin:4px 0">Audiências</h4>${tabela(['Data', 'Audiência', 'Local'], v.audiencias.map((a) => `<tr><td>${dataHora(a.data)}</td><td>${esc(a.titulo)}</td><td>${esc(a.local || '—')}</td></tr>`))}` : '',
        v.prazos.length ? `<h4 style="margin:12px 0 4px">Prazos</h4>${tabela(['Data', 'Prazo', 'Prioridade', 'Status'], v.prazos.map((p) => `<tr><td>${dataBr(p.deadline_date)}</td><td>${esc(p.description || '—')}</td><td>${esc(p.priority || '—')}</td><td>${st(p.status)}</td></tr>`))}` : '',
      ].join('') || vazio('Nenhum prazo ou audiência.') },

      propostas: { rotulo: `Propostas e contratos (${v.propostas.length + v.contratos.length})`, html: () => [
        v.propostas.length ? `<h4 style="margin:4px 0">Propostas</h4>${tabela(['Data', 'Proposta', 'Valor', 'Status'], v.propostas.map((p) => `<tr><td>${dataBr(p.created_at)}</td><td>${esc(p.title || '—')}</td><td>${money(p.valor)}</td><td>${st(p.status)}${p.aceito_em ? `<br><small>aceita em ${dataBr(p.aceito_em)}</small>` : ''}</td></tr>`))}` : '',
        v.contratos.length ? `<h4 style="margin:12px 0 4px">Contratos</h4>${tabela(['Data', 'Contrato', 'Área', 'Valor', 'Status'], v.contratos.map((x) => `<tr><td>${dataBr(x.created_at)}</td><td>${esc(x.title || '—')}</td><td>${esc(AREA_LABELS[x.area] || x.area || '—')}</td><td>${money(x.value)}</td><td>${st(x.status)}</td></tr>`))}` : '',
      ].join('') || vazio('Nenhuma proposta ou contrato.') },

      documentos: { rotulo: `Documentos (${v.documentos.length})`, html: () => v.documentos.length
        ? tabela(['Data', 'Documento', 'Pasta', 'Status'], v.documentos.map((d) => `<tr><td>${dataBr(d.created_at)}</td><td>${esc(d.name)}</td><td>${esc(String(d.folder || d.type || '—').replace(/_/g, ' '))}</td><td>${st(d.status)}</td></tr>`))
        : vazio('Nenhum documento.') },

      linha: { rotulo: 'Linha do tempo', html: () => v.linhaDoTempo.length
        ? `<ul class="ev-hist" style="max-height:none">${v.linhaDoTempo.map((e) => `<li><time>${dataBr(e.data)}</time><span>${{ movimentacao: '⚖️', prazo: '⏰', audiencia: '🏛️', pagamento: '💰', registro: '📝' }[e.tipo] || '•'} ${e.ref ? `<small style="color:var(--text-muted)">${esc(e.ref)}</small> ` : ''}${esc(e.texto)}</span></li>`).join('')}</ul>`
        : vazio('Nada registrado ainda.') },

      cadastro: { rotulo: 'Cadastro', html: () => {
        const linha = (k, val) => (val ? `<div><strong>${k}:</strong> ${esc(val)}</div>` : '');
        const ultima = v.whatsapp && v.whatsapp[0];
        return `<div style="display:grid;gap:4px;font-size:14px">${linha('Nome', c.name)}${linha('CPF/CNPJ', c.cpf_cnpj)}${linha('RG', c.rg)}${linha('Nascimento', c.birth_date ? dataBr(String(c.birth_date).slice(0, 10)) : '')}
          ${linha('Estado civil', c.estado_civil ? String(c.estado_civil).replace(/_/g, ' ') : '')}${linha('Profissão', c.profissao)}${linha('E-mail', c.email)}
          ${c.phone ? `<div><strong>Telefone:</strong> ${esc(c.phone)} ${waBtn(c.phone, 'WhatsApp')}</div>` : ''}${linha('Endereço', c.address)}${linha('Status', c.status)}
          <div><strong>LGPD:</strong> ${c.lgpd ? 'autorização registrada' : '<span style="color:#b45309">sem autorização registrada</span>'}</div>
          ${c.resumo ? `<div style="margin-top:6px"><strong>Resumo do caso (atendimento):</strong><div style="white-space:pre-wrap">${esc(c.resumo)}</div></div>` : ''}
          ${c.notes ? `<div style="margin-top:6px"><strong>Observações:</strong><div style="white-space:pre-wrap">${esc(c.notes)}</div></div>` : ''}
          ${ultima ? `<div style="margin-top:6px"><strong>Última conversa no WhatsApp:</strong> <small>${dataHora(ultima.msg_time)} · ${ultima.from_me ? 'escritório' : 'cliente'}</small><div style="color:var(--text-muted)">${esc(String(ultima.body || '').slice(0, 200))}</div></div>` : ''}</div>`;
      } },
    };

    corpo.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
        ${v.relacoes.length ? v.relacoes.map((r) => `<span title="${esc(r.detalhe)}" style="background:${COR_REL[r.tipo]};color:#fff;font-weight:700;font-size:12.5px;padding:4px 10px;border-radius:999px">${esc(r.rotulo)} <span style="font-weight:500;opacity:.9">· ${esc(r.detalhe)}</span></span>`).join('')
          : '<span class="badge">sem caso vinculado</span>'}
        <span style="color:var(--text-muted);font-size:13px">${esc(c.cpf_cnpj || 'sem CPF')}${c.phone ? ' · ' + esc(c.phone) : ''}</span>
        <span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">
          ${c.phone ? waBtn(c.phone, 'WhatsApp') : ''}
          <button type="button" class="btn-sm" id="vc-ficha">Abrir ficha</button>
        </span>
      </div>
      ${v.alertas.length ? `<div class="card" style="padding:10px 12px;margin-bottom:10px;border-left:4px solid var(--red)">${v.alertas.map((a) => `<div style="font-size:13.5px;${a.nivel === 'urgente' ? 'color:var(--red);font-weight:700' : ''}">${a.nivel === 'urgente' ? '🚨' : '⚠️'} ${esc(a.texto)}</div>`).join('')}</div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">${kpis}</div>
      <div class="tabs" id="vc-abas" style="flex-wrap:wrap">${Object.entries(abas).map(([k, a], i) => `<button type="button" class="tab${i === 0 ? ' active' : ''}" data-aba="${k}">${a.rotulo}</button>`).join('')}</div>
      <div id="vc-conteudo" style="max-height:52vh;overflow:auto;padding-top:8px"></div>`;
    const mostrar = (k) => {
      corpo.querySelectorAll('#vc-abas .tab').forEach((b) => b.classList.toggle('active', b.dataset.aba === k));
      corpo.querySelector('#vc-conteudo').innerHTML = abas[k].html();
    };
    corpo.querySelectorAll('#vc-abas .tab').forEach((b) => b.onclick = () => mostrar(b.dataset.aba));
    const btnFicha = corpo.querySelector('#vc-ficha');
    if (btnFicha) btnFicha.onclick = () => { if (typeof fichaCliente === 'function') fichaCliente(c.id, () => window.visaoCliente(c.id)); };
    mostrar('processos');
  };
})();
