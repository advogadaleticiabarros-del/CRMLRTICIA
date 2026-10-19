import crypto from 'crypto';
import { db } from '../config/database';
import { sendText } from './uazapiInstance';
import { registrarAcaoAgente } from './usoIa';
import { aiComplete } from './aiAssistant';
import { linkProposta, textoEnvioProposta } from './propostaWhatsapp';
import { COMANDANTES_PADRAO } from './assistenteRegras';
import {
  valoresDeTabela, aplicarPolitica, POLITICA_PADRAO, montarHonorarios, mensagemAprovacao, interpretarComandoProposta,
  proximoPassoContrato, mensagemLembreteAssinatura, checklistDoCaso, itensRecebidos, mensagemPedidoDocumentos,
  mensagemCobrancaDocumentos, marcoCobranca,
  type PoliticaParcelamento, type TabelaHonorarios, type PropostaAceita, type ItemDocumento,
} from './esteiraComercial';
import { referenciaOab, textoReferencia } from './tabelaOabRj';
import { calcularCapacidade, linhaCapacidade, interpretarComandoMontar } from './copilotoComercial';

/**
 * Esteira comercial com banco e WhatsApp (regras em esteiraComercial.ts).
 * Ao cliente só saem: pedido de dados/documentos e lembretes (status neutro,
 * decisão da Dra. de 14/10/2026). A proposta só vai depois do "aprovar" dela.
 */

/** Número da Dra. Letícia: quem aprova propostas. */
export const NUMERO_DRA = COMANDANTES_PADRAO.split(',')[0];

const foneWa = (p: string | null | undefined) => {
  let d = String(p || '').replace(/\D/g, '');
  if (d && d.length <= 11) d = '55' + d;
  return d.length >= 12 ? d : null;
};
const isoMaisDias = (dias: number) => new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);

/** "Este passo já foi feito?" — true só na primeira vez (trava contra mensagem repetida). */
async function marcar(ref: string, marco: string): Promise<boolean> {
  const [r] = await db.query('INSERT IGNORE INTO esteira_avisos (ref, marco) VALUES (?, ?)', [ref, marco]) as any;
  return r.affectedRows === 1;
}

export async function configuracao(): Promise<{ tabela: TabelaHonorarios; politica: PoliticaParcelamento }> {
  const [rows] = await db.query("SELECT setting_key, setting_value FROM office_settings WHERE setting_key IN ('tabela_honorarios','politica_parcelamento')").catch(() => [[]]) as any;
  const ler = (k: string) => { try { return JSON.parse(rows.find((r: any) => r.setting_key === k)?.setting_value || 'null'); } catch { return null; } };
  return { tabela: ler('tabela_honorarios') || {}, politica: { ...POLITICA_PADRAO, ...(ler('politica_parcelamento') || {}) } };
}

export async function historicoAceitas(): Promise<PropostaAceita[]> {
  const [rows] = await db.query("SELECT legal_area, honorarios FROM propostas WHERE status = 'aceita' AND aceito_em >= NOW() - INTERVAL 365 DAY").catch(() => [[]]) as any;
  return rows.map((r: any) => {
    let h: any = {};
    try { h = typeof r.honorarios === 'string' ? JSON.parse(r.honorarios) : r.honorarios || {}; } catch { /* honorário antigo sem JSON */ }
    const p = h?.parcelamento || {};
    return { area: r.legal_area, total: Number(p.total) || 0, entrada: Number(p.entrada) || 0, parcelas: Number(p.parcelas) || 1 };
  });
}

// ── Produtor de proposta ────────────────────────────────────────────────────

/** Casos em que a pessoa já é parte contrária (mesmo CPF/CNPJ ou mesmo nome). */
async function conflitosDeInteresse(nome: string, cpf: string | null): Promise<string[]> {
  const doc = String(cpf || '').replace(/\D/g, '');
  const [rows] = await db.query(
    `SELECT c.title FROM case_partes p JOIN cases c ON c.id = p.case_id
      WHERE p.papel = 'contraria' AND ((? <> '' AND REGEXP_REPLACE(COALESCE(p.cpf_cnpj,''), '[^0-9]', '') = ?) OR UPPER(TRIM(p.nome)) = UPPER(TRIM(?)))
      LIMIT 5`, [doc, doc, nome || '']).catch(() => [[]]) as any;
  return rows.map((r: any) => `${r.title} (parte contrária)`);
}

const COLUNAS_LEAD = `l.id, l.user_id, l.client_id, l.name, l.phone, l.email, l.cpf_cnpj, l.street, l.cep, l.legal_area, l.case_summary, l.notes,
  l.capacidade_sinais`;

/** Monta UMA proposta (rascunho), manda à Dra. aprovar e pede ao cliente os dados que faltam. */
async function produzirUma(l: any, cfg: { tabela: TabelaHonorarios; politica: PoliticaParcelamento }, hist: PropostaAceita[]): Promise<number> {
  const resumo = String(l.case_summary || l.notes || '').trim() || null;
  const ref = referenciaOab(l.legal_area, resumo);
  const v = valoresDeTabela(l.legal_area, hist, cfg.tabela, ref);
  const parc = aplicarPolitica(v, cfg.politica);
  const honorarios = montarHonorarios({ exito: v.exito, parcelamento: parc }, parc.total ? isoMaisDias(30) : null);
  const [ins] = await db.query(
    `INSERT INTO propostas (user_id, client_id, lead_id, title, valor, status, validade, description, legal_area, contact_name, cpf, phone, email, honorarios, observacoes)
     VALUES (?, ?, ?, ?, ?, 'rascunho', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [l.user_id, l.client_id ?? null, l.id, `Proposta — ${l.name}`, parc.total, isoMaisDias(15), resumo, l.legal_area,
     l.name, l.cpf_cnpj || null, l.phone || null, l.email || null, JSON.stringify(honorarios),
     `Produzida pelo agente Produtor de proposta${v.origem === 'oab_rj' && ref ? ` (referência OAB/RJ ${ref.codigo})` : ''}; aguardando aprovação da Dra. no WhatsApp.`]) as any;
  const conflitos = await conflitosDeInteresse(l.name, l.cpf_cnpj);
  let capacidade: string | null = null;
  try {
    const s = typeof l.capacidade_sinais === 'string' ? JSON.parse(l.capacidade_sinais) : l.capacidade_sinais;
    if (s?.sinais) capacidade = linhaCapacidade(calcularCapacidade(s.sinais));
  } catch { /* sem qualificação ainda */ }
  await sendText(NUMERO_DRA, mensagemAprovacao({
    id: ins.insertId, nome: l.name, area: l.legal_area, tipoCausa: null, resumo, exito: v.exito, parcelamento: parc, origem: v.origem, conflitos,
    referencia: v.origem === 'oab_rj' ? textoReferencia(ref) : null, capacidade,
  }), 'Agente Produtor de proposta');
  registrarAcaoAgente('produtor', `montou a proposta nº ${ins.insertId} de ${l.name} e pediu aprovação à Dra.`);
  // Dados que o contrato vai precisar: pede uma vez ao possível cliente.
  const fone = foneWa(l.phone);
  if (fone && (!l.cpf_cnpj || (!l.street && !l.cep)) && await marcar(`lead:${l.id}`, 'dados_pedidos')) {
    const primeiro = String(l.name || '').split(/\s+/)[0];
    await sendText(fone, `Olá, ${primeiro}! Para prepararmos sua proposta e o contrato, me envie por aqui, por favor: nome completo, CPF, RG, estado civil, profissão e endereço com CEP. Obrigada!`, 'Agente Produtor de proposta');
  }
  return ins.insertId;
}

/** Possíveis clientes em "documentação pendente" sem proposta: pede dados, monta a proposta e manda à Dra. aprovar. */
export async function produzirPropostas(limite = 3) {
  const [leads] = await db.query(
    `SELECT ${COLUNAS_LEAD}
       FROM leads l
      WHERE l.status = 'documentacao_pendente' AND l.legal_area IS NOT NULL AND l.updated_at >= NOW() - INTERVAL 30 DAY
        AND NOT EXISTS (SELECT 1 FROM propostas p WHERE p.lead_id = l.id)
      ORDER BY l.updated_at ASC LIMIT ?`, [limite]) as any;
  if (!leads.length) return { produzidas: 0 };
  const cfg = await configuracao();
  const hist = await historicoAceitas();
  let produzidas = 0;
  for (const l of leads) {
    if (!(await marcar(`lead:${l.id}`, 'proposta_produzida'))) continue;
    await produzirUma(l, cfg, hist);
    produzidas++;
  }
  return { produzidas };
}

/** "montar proposta 45" (pedido da Dra., sugerido pelo Dr. Otávio): monta agora para o possível cliente 45. */
export async function montarPropostaDoLead(leadId: number): Promise<string> {
  const [[l]] = await db.query(`SELECT ${COLUNAS_LEAD} FROM leads l WHERE l.id = ?`, [leadId]) as any;
  if (!l) return `Não achei o possível cliente nº ${leadId}.`;
  if (!l.legal_area) return `${l.name} ainda está sem área do direito no CRM. Preencha a área e mande de novo.`;
  const [[ja]] = await db.query("SELECT id, status FROM propostas WHERE lead_id = ? AND status IN ('rascunho','enviada','em_negociacao') ORDER BY id DESC LIMIT 1", [leadId]) as any;
  if (ja) return `${l.name} já tem a proposta nº ${ja.id} (${ja.status}). Use *aprovar ${ja.id}*, *ajustar ${ja.id} …* ou *recusar ${ja.id}*.`;
  await marcar(`lead:${l.id}`, 'proposta_produzida');
  const id = await produzirUma(l, await configuracao(), await historicoAceitas());
  return `✅ A Dra. Bianca montou a proposta nº ${id} de ${l.name}. O resumo para aprovar acabou de chegar aqui.`;
}

async function propostaPorId(id: number) {
  const [[p]] = await db.query(
    `SELECT p.id, p.lead_id, p.status, p.title, p.public_token, p.honorarios, p.legal_area, p.tipo_causa, p.description,
            COALESCE(p.contact_name, l.name) AS nome, COALESCE(NULLIF(p.phone,''), l.phone) AS fone
       FROM propostas p LEFT JOIN leads l ON l.id = p.lead_id WHERE p.id = ?`, [id]) as any;
  return p || null;
}

/**
 * Resposta da Dra. no WhatsApp ("aprovar 123", "ajustar 123 entrada 500, 5x", "recusar 123").
 * null = não é comando de proposta (o assistente segue normal).
 */
export async function comandoProposta(phone: string, texto: string): Promise<string | null> {
  const leadMontar = interpretarComandoMontar(texto);
  if (leadMontar) {
    if (String(phone).replace(/\D/g, '').slice(-8) !== NUMERO_DRA.slice(-8)) return 'Só a Dra. Letícia pede para montar proposta.';
    return montarPropostaDoLead(leadMontar);
  }
  const cmd = interpretarComandoProposta(texto);
  if (!cmd) return null;
  const p = await propostaPorId(cmd.id);
  if (!p) return `Não achei a proposta nº ${cmd.id}.`;
  if (String(phone).replace(/\D/g, '').slice(-8) !== NUMERO_DRA.slice(-8)) return 'Só a Dra. Letícia aprova propostas. A mensagem de aprovação está no WhatsApp dela.';
  if (!['rascunho', 'enviada', 'em_negociacao'].includes(p.status)) return `A proposta nº ${cmd.id} está como "${p.status}". Nada foi alterado.`;

  if (cmd.acao === 'recusar') {
    await db.query("DELETE FROM propostas WHERE id = ? AND status = 'rascunho'", [p.id]);
    registrarAcaoAgente('produtor', `descartou a proposta nº ${p.id} a pedido da Dra.`);
    return `🗑️ Proposta nº ${p.id} de ${p.nome} descartada. Não enviei nada ao cliente.`;
  }

  if (cmd.acao === 'ajustar') {
    let h: any = {};
    try { h = typeof p.honorarios === 'string' ? JSON.parse(p.honorarios) : p.honorarios || {}; } catch { /* sem honorários */ }
    const atual = h.parcelamento || {};
    // Primeiro número válido: o que a Dra. pediu, senão o que já estava, senão o padrão.
    const num = (...xs: any[]) => xs.map(Number).find((x) => Number.isFinite(x)) ?? 0;
    const exito = num(cmd.ajustes.exito, h.values?.exito, 30);
    // O ajuste é decisão da Dra.: só a matemática das parcelas, sem os limites da política.
    const parc = aplicarPolitica({
      total: num(cmd.ajustes.total, atual.total, 0),
      entrada: num(cmd.ajustes.entrada, atual.entrada, 0),
      parcelas: num(cmd.ajustes.parcelas, atual.parcelas, 1),
    }, { entradaMinPct: 0, maxParcelas: 60, parcelaMinima: 0 });
    const nova = montarHonorarios({ exito, parcelamento: parc }, parc.total ? (atual.primeiro_vencimento || isoMaisDias(30)) : null);
    await db.query('UPDATE propostas SET honorarios = ?, valor = ? WHERE id = ?', [JSON.stringify(nova), parc.total, p.id]);
    registrarAcaoAgente('produtor', `ajustou a proposta nº ${p.id} conforme a Dra.`);
    return mensagemAprovacao({ id: p.id, nome: p.nome, area: p.legal_area, tipoCausa: p.tipo_causa, resumo: null, exito, parcelamento: parc, origem: 'tabela' })
      .replace('Proposta pronta para aprovar', 'Proposta ajustada');
  }

  const fone = foneWa(p.fone);
  if (!fone) return `A proposta nº ${p.id} de ${p.nome} está aprovada, mas o cliente não tem telefone cadastrado. Envie o link pelo CRM.`;
  let token = p.public_token;
  if (!token) { token = crypto.randomUUID(); await db.query('UPDATE propostas SET public_token = ? WHERE id = ?', [token, p.id]); }
  const ok = await sendText(fone, textoEnvioProposta(p.nome || '', p.title || '', linkProposta(token)), 'Agente Produtor de proposta (aprovada pela Dra.)');
  if (!ok) return '⚠️ Não consegui enviar agora (WhatsApp desconectado?). Tente "aprovar" de novo em instantes.';
  await db.query("UPDATE propostas SET enviada_em = COALESCE(enviada_em, NOW()), status = IF(status = 'rascunho', 'enviada', status) WHERE id = ?", [p.id]);
  if (p.lead_id) await db.query("UPDATE leads SET status = 'proposta' WHERE id = ? AND status IN ('triagem','atendimento_inicial','reuniao','documentacao_pendente')", [p.lead_id]).catch(() => {});
  registrarAcaoAgente('produtor', `enviou a proposta nº ${p.id} a ${p.nome} depois da aprovação da Dra.`);
  return `✅ Proposta nº ${p.id} enviada para ${p.nome}. O follow-up de 48h, 5 e 7 dias segue sozinho.`;
}

// ── Fechador de contrato ────────────────────────────────────────────────────

export async function acompanharContratos() {
  const [rows] = await db.query(
    `SELECT c.id, c.status, c.updated_at, c.created_at, c.title, COALESCE(cl.name, l.name) AS nome, COALESCE(cl.phone, l.phone) AS fone
       FROM contracts c LEFT JOIN clients cl ON cl.id = c.client_id LEFT JOIN leads l ON l.id = c.lead_id
      WHERE c.status IN ('em_producao','finalizado','enviado_assinatura') AND c.updated_at >= NOW() - INTERVAL 30 DAY`) as any;
  let avisos = 0, lembretes = 0;
  for (const c of rows) {
    const passo = proximoPassoContrato({ status: c.status, desde: c.updated_at }, new Date());
    if (!passo) continue;
    // "Contrato fechado" só para contrato criado agora, não para um antigo que só foi editado.
    if (passo.marco === 'revisao_d0' && Date.now() - new Date(c.created_at).getTime() > 2 * 86400000) continue;
    if (!(await marcar(`contrato:${c.id}`, passo.marco))) continue;
    if (passo.acao === 'avisar_dra') {
      const texto = passo.marco === 'revisao_d0'
        ? `🤝 *Contrato fechado: ${c.nome || c.title}*\nA proposta foi aceita e o contrato, a procuração e a declaração já estão prontos para a sua revisão (CRM → Contratos, nº ${c.id}).\nDepois de revisar, gere o link de assinatura: eu lembro a cliente de assinar. A Dra. Camila já está pedindo os documentos.`
        : passo.marco === 'revisao_d1'
          ? `📄 O contrato de *${c.nome || c.title}* está pronto há mais de 1 dia esperando a sua revisão (CRM → Contratos, nº ${c.id}). Depois de revisar, gere o link de assinatura.`
          : `✍️ O contrato de *${c.nome || c.title}* foi enviado há 7 dias e ainda não foi assinado. Vale ligar para o cliente.`;
      await sendText(NUMERO_DRA, texto, 'Agente Fechador de contrato');
      registrarAcaoAgente('fechador', passo.marco === 'revisao_d0' ? `avisou a Dra. do contrato fechado de ${c.nome} para revisar`
        : passo.marco === 'revisao_d1' ? `lembrou a Dra. de revisar o contrato de ${c.nome}` : `avisou a Dra.: contrato de ${c.nome} parado há 7 dias`);
      avisos++;
    } else {
      const fone = foneWa(c.fone);
      if (!fone) continue;
      await sendText(fone, mensagemLembreteAssinatura(c.nome), 'Agente Fechador de contrato');
      registrarAcaoAgente('fechador', `lembrou ${c.nome} de assinar o contrato`);
      lembretes++;
    }
  }
  return { avisos, lembretes };
}

// ── Coletor de documentos e provas ──────────────────────────────────────────

/** Itens que só valem "se tiver": não travam a conclusão da coleta. */
const opcional = (i: ItemDocumento) => /se tiver|se já saiu/i.test(i.label);

async function nomesDosArquivos(clientId: number, caseId: number): Promise<string[]> {
  const [docs] = await db.query('SELECT name FROM documents WHERE case_id = ? OR client_id = ?', [caseId, clientId]) as any;
  const [media] = await db.query('SELECT file_name AS name FROM whatsapp_media WHERE client_id = ?', [clientId]).catch(() => [[]]) as any;
  return [...docs, ...media].map((d: any) => String(d.name || ''));
}

/** Relato do cliente para o depoimento, a partir das conversas e áudios transcritos no WhatsApp. */
async function gerarRelato(coleta: any, nome: string, fone: string | null): Promise<number | null> {
  if (!fone) return null;
  // Áudios e imagens já chegam transcritos/descritos dentro do próprio body.
  const [msgs] = await db.query(
    `SELECT from_me, body FROM whatsapp_messages
      WHERE RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 8) = ? ORDER BY msg_time ASC LIMIT 400`, [fone.slice(-8)]) as any;
  const linhas = msgs.map((m: any) => `${m.from_me ? 'Escritório' : 'Cliente'}: ${String(m.body || '').replace(/\s+/g, ' ').slice(0, 600)}`)
    .filter((l: string) => l.length > 12);
  if (!linhas.length) return null;
  const r = await aiComplete(`Você é assistente jurídico(a). A partir da conversa de WhatsApp abaixo entre o escritório e ${nome}, escreva o RELATO DO CLIENTE para preparar o depoimento e a petição: fatos em ordem cronológica, datas, valores, nomes de pessoas citadas (testemunhas, chefes), provas mencionadas e o que ainda falta esclarecer. Use SOMENTE o que está na conversa; não invente. Marque [confirmar] o que estiver incerto.

CONVERSA:
${linhas.join('\n').slice(0, 24000)}`, 'openai');
  if (!r.ok || !r.text) return null;
  const [[admin]] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1") as any;
  const [ins] = await db.query(
    `INSERT INTO documents (client_id, case_id, name, type, folder, content, status, created_by) VALUES (?, ?, ?, 'ia', 'processos', ?, 'pendente', ?)`,
    [coleta.client_id, coleta.case_id, `Relato do cliente (WhatsApp) — ${nome}`, r.text, admin?.id ?? null]) as any;
  return ins.insertId;
}

export async function coletarDocumentos() {
  let pedidos = 0, cobrancas = 0, concluidas = 0;
  // 0) O caso nasceu (contrato assinado) para uma coleta que começou no aceite: liga os dois.
  const [semCaso] = await db.query(
    `SELECT cd.id, cs.id AS case_id, cd.concluido_em FROM coletas_documentos cd
       JOIN cases cs ON cs.origin_contract_id = cd.contract_id
      WHERE cd.case_id IS NULL AND cd.contract_id IS NOT NULL`).catch(() => [[]]) as any;
  for (const s of semCaso) {
    await db.query('UPDATE coletas_documentos SET case_id = ? WHERE id = ? AND case_id IS NULL', [s.case_id, s.id]).catch(() => {});
    // Documentos já completos antes do caso existir: a Dra. Helena confere agora.
    if (s.concluido_em) await import('./analistaServico').then((m) => m.analisarCaso(s.case_id)).catch(() => {});
  }

  // 1) Proposta aceita (contrato criado) ou caso novo → pede a lista de documentos e provas.
  //    Desde 19/10/2026 começa no ACEITE, sem esperar a assinatura: "fechamos o contrato,
  //    os agentes precisam entrar em ação". Uma coleta por contrato e por caso.
  const [novos] = await db.query(
    `SELECT ct.id AS contract_id, cs.id AS case_id, ct.client_id, COALESCE(cs.legal_area, ct.area) AS legal_area, cl.name, cl.phone, ct.lead_id
       FROM contracts ct JOIN clients cl ON cl.id = ct.client_id
       LEFT JOIN cases cs ON cs.origin_contract_id = ct.id
      WHERE ct.status IN ('em_producao','finalizado','enviado_assinatura','assinado')
        -- Só contrato recém-fechado: em 19/10/2026 a 1ª rodada pegou contratos de 12 dias
        -- atrás e mandou boas-vindas atrasadas (Mailza, Rozimaria). Os antigos seguem pelo caso.
        AND ct.created_at >= NOW() - INTERVAL 3 DAY
        AND NOT EXISTS (SELECT 1 FROM coletas_documentos cd WHERE cd.contract_id = ct.id OR (cs.id IS NOT NULL AND cd.case_id = cs.id))
     UNION
     SELECT cs.origin_contract_id AS contract_id, cs.id AS case_id, cs.client_id, cs.legal_area, cl.name, cl.phone, ct.lead_id
       FROM cases cs JOIN clients cl ON cl.id = cs.client_id JOIN contracts ct ON ct.id = cs.origin_contract_id
      WHERE cs.origin_contract_id IS NOT NULL AND cs.created_at >= NOW() - INTERVAL 30 DAY
        AND NOT EXISTS (SELECT 1 FROM coletas_documentos cd WHERE cd.case_id = cs.id OR cd.contract_id = cs.origin_contract_id)
      LIMIT 10`) as any;
  for (const c of novos) {
    const [[lead]] = c.lead_id ? await db.query('SELECT case_summary, notes FROM leads WHERE id = ?', [c.lead_id]) as any : [[null]];
    const [[prop]] = c.lead_id ? await db.query('SELECT description FROM propostas WHERE lead_id = ? ORDER BY id DESC LIMIT 1', [c.lead_id]) as any : [[null]];
    const assunto = [lead?.case_summary, lead?.notes, prop?.description].filter(Boolean).join(' ');
    const itens = checklistDoCaso(c.legal_area, assunto);
    const [ins] = await db.query('INSERT IGNORE INTO coletas_documentos (case_id, contract_id, client_id, area, itens) VALUES (?, ?, ?, ?, ?)',
      [c.case_id ?? null, c.contract_id ?? null, c.client_id, c.legal_area, JSON.stringify(itens)]) as any;
    if (!ins.affectedRows) continue; // outra rodada já criou
    const fone = foneWa(c.phone);
    if (fone) {
      await sendText(fone, mensagemPedidoDocumentos(c.name, itens), 'Agente Coletor de documentos');
      registrarAcaoAgente('coletor', `pediu os documentos e provas do caso a ${c.name}`);
      pedidos++;
    }
  }
  // 2) Confere o que chegou, cobra o que falta e fecha quando completo.
  const [abertas] = await db.query(
    `SELECT cd.*, cl.name, cl.phone FROM coletas_documentos cd JOIN clients cl ON cl.id = cd.client_id WHERE cd.concluido_em IS NULL`) as any;
  for (const co of abertas) {
    const itens: ItemDocumento[] = typeof co.itens === 'string' ? JSON.parse(co.itens) : co.itens;
    const status = itensRecebidos(itens, await nomesDosArquivos(co.client_id, co.case_id));
    const faltam = status.filter((i) => !i.recebido && !opcional(i));
    const fone = foneWa(co.phone);
    if (!faltam.length) {
      const relato = await gerarRelato(co, co.name, fone).catch(() => null);
      await db.query('UPDATE coletas_documentos SET concluido_em = NOW(), relato_doc_id = ? WHERE id = ?', [relato, co.id]);
      await sendText(NUMERO_DRA, `📁 Documentos completos: *${co.name}*. ${relato ? 'O relato do cliente (das conversas do WhatsApp) já está nos documentos do caso.' : ''} O caso pode ir para a criação da peça.`, 'Agente Coletor de documentos');
      registrarAcaoAgente('coletor', `reuniu todos os documentos de ${co.name}${relato ? ' e escreveu o relato do cliente' : ''}`);
      // Documentos completos: a Dra. Helena confere cada um contra a história contada.
      // Sem caso ainda (coleta começou no aceite): a análise roda quando o caso for ligado (passo 0).
      if (co.case_id) await import('./analistaServico').then((m) => m.analisarCaso(co.case_id)).catch((e) => console.error('[analista] falhou:', e?.message || e));
      concluidas++;
      continue;
    }
    const marco = marcoCobranca(co.pedido_em, new Date());
    if (!marco || !(await marcar(`coleta:${co.id}`, marco))) continue;
    if (fone) {
      await sendText(fone, mensagemCobrancaDocumentos(co.name, faltam), 'Agente Coletor de documentos');
      registrarAcaoAgente('coletor', `cobrou ${faltam.length} documento(s) de ${co.name}`);
      cobrancas++;
    }
    if (marco === 'docs_d10') {
      await sendText(NUMERO_DRA, `📁 *${co.name}* ainda não mandou ${faltam.length} documento(s) depois de 10 dias:\n${faltam.map((i) => `• ${i.label}`).join('\n')}`, 'Agente Coletor de documentos');
    }
  }
  return { pedidos, cobrancas, concluidas };
}
