/**
 * Esteira comercial do escritório virtual. Três agentes, regras puras
 * (tests/esteiraComercial.test.mjs); banco e WhatsApp em esteiraComercialServico.ts.
 *
 * - Produtor de proposta: valor de tabela (tabela da Dra. ou, sem ela, a
 *   mediana das propostas aceitas da área), política de parcelamento, resumo
 *   para a Dra. aprovar no WhatsApp e leitura de "aprovar/ajustar/recusar".
 * - Fechador de contrato: próximo passo até a assinatura.
 * - Coletor de documentos e provas: lista conforme a área e o assunto falado,
 *   mensagens ao cliente (só pedido e lembrete, sem conteúdo jurídico) e marcos de cobrança.
 */

const semAcento = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const r2 = (n: number) => Math.round(n * 100) / 100;

// ── Produtor de proposta ────────────────────────────────────────────────────

export interface ValoresTabela { total: number; entrada: number; parcelas: number; exito: number; origem: 'tabela' | 'oab_rj' | 'historico' | 'padrao' }
export type TabelaHonorarios = Record<string, { total: number; entrada: number; parcelas: number; exito: number }>;
export interface PropostaAceita { area: string; total: number; entrada: number; parcelas: number }

/** Êxito padrão do escritório: 30% + sucumbência (regra da Dra.). */
export const EXITO_PADRAO = 30;

const mediana = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };

/**
 * Ordem: a tabela da Dra. → a referência da OAB/RJ (parâmetro escolhido em
 * 16/10/2026) → a mediana das propostas aceitas → só êxito.
 * OAB/RJ "fixo": 1/3 de entrada (art. 22, §3º, do Estatuto, citado na própria
 * tabela) e o resto em 4x, provisório até a Dra. definir as regras de pagamento.
 * OAB/RJ "percentual" (reclamante): só êxito, como o escritório já cobra.
 */
export function valoresDeTabela(area: string, historico: PropostaAceita[], tabela: TabelaHonorarios,
  referencia?: { sugerido: number; tipo: 'fixo' | 'percentual' } | null): ValoresTabela {
  const t = tabela[area];
  if (t && (t.total > 0 || t.exito > 0)) return { total: t.total, entrada: t.entrada, parcelas: t.parcelas, exito: t.exito || EXITO_PADRAO, origem: 'tabela' };
  if (referencia) {
    if (referencia.tipo === 'percentual') return { total: 0, entrada: 0, parcelas: 1, exito: EXITO_PADRAO, origem: 'oab_rj' };
    const total = r2(referencia.sugerido);
    return { total, entrada: r2(total / 3), parcelas: 4, exito: EXITO_PADRAO, origem: 'oab_rj' };
  }
  const h = historico.filter((x) => x.area === area && x.total > 0);
  if (h.length) {
    return {
      total: mediana(h.map((x) => x.total)), entrada: mediana(h.map((x) => x.entrada)),
      parcelas: Math.max(1, mediana(h.map((x) => x.parcelas))), exito: EXITO_PADRAO, origem: 'historico',
    };
  }
  return { total: 0, entrada: 0, parcelas: 1, exito: EXITO_PADRAO, origem: 'padrao' };
}

export interface PoliticaParcelamento { entradaMinPct: number; maxParcelas: number; parcelaMinima: number }
/** Ponto de partida até a Dra. definir a dela em Configurações. */
export const POLITICA_PADRAO: PoliticaParcelamento = { entradaMinPct: 0, maxParcelas: 10, parcelaMinima: 100 };

export interface Parcelamento { total: number; entrada: number; parcelas: number; valor_parcela: number; ultima_parcela: number }

export function aplicarPolitica(v: { total: number; entrada: number; parcelas: number }, p: PoliticaParcelamento): Parcelamento {
  const total = r2(Math.max(0, v.total));
  if (!total) return { total: 0, entrada: 0, parcelas: 0, valor_parcela: 0, ultima_parcela: 0 };
  const entrada = r2(Math.min(total, Math.max(v.entrada || 0, (total * (p.entradaMinPct || 0)) / 100)));
  const restante = r2(total - entrada);
  if (!restante) return { total, entrada, parcelas: 0, valor_parcela: 0, ultima_parcela: 0 };
  let parcelas = Math.min(Math.max(1, Math.floor(v.parcelas || 1)), Math.max(1, p.maxParcelas));
  while (parcelas > 1 && restante / parcelas < p.parcelaMinima) parcelas--;
  const base = Math.floor((restante / parcelas) * 100) / 100;
  return { total, entrada, parcelas, valor_parcela: base, ultima_parcela: r2(restante - base * (parcelas - 1)) };
}

/** Honorários no mesmo formato da tela de propostas (o contrato lê daqui). */
export function montarHonorarios(o: { exito: number; parcelamento: Parcelamento }, primeiroVencimento: string | null) {
  const base = { modalidades: ['exito'], values: { exito: o.exito }, meios: ['pix'] as string[] };
  if (!o.parcelamento.total) return { ...base, parcelamento: { total: 0 }, apenas_exito: true };
  return {
    ...base,
    parcelamento: {
      total: o.parcelamento.total, entrada: o.parcelamento.entrada, entrada_data: null,
      parcelas: o.parcelamento.parcelas, primeiro_vencimento: primeiroVencimento,
      valor_parcela: o.parcelamento.valor_parcela, ultima_parcela: o.parcelamento.ultima_parcela,
    },
  };
}

const ORIGEM_PT = { tabela: 'tabela do escritório', oab_rj: 'tabela de honorários da OAB/RJ', historico: 'média das propostas aceitas da área', padrao: 'sem tabela para a área: só êxito' };

export function mensagemAprovacao(d: {
  id: number; nome: string; area: string; tipoCausa: string | null; resumo: string | null;
  exito: number; parcelamento: Parcelamento; origem: ValoresTabela['origem'];
  /** Casos em que a pessoa aparece como parte contrária (checagem de conflito de interesses). */
  conflitos?: string[];
  /** Linha de qualificação do Dr. Otávio (chance de fechar, capacidade, potencial). */
  capacidade?: string | null;
  /** Item da tabela da OAB/RJ usado como parâmetro. */
  referencia?: string | null;
}): string {
  const p = d.parcelamento;
  const valores = p.total
    ? [
      `Honorários iniciais: *${reais(p.total)}*`,
      p.entrada ? `• Entrada: ${reais(p.entrada)}` : null,
      p.parcelas ? `• ${p.parcelas}x de ${reais(p.valor_parcela)}${p.ultima_parcela !== p.valor_parcela ? ` (última de ${reais(p.ultima_parcela)})` : ''}` : null,
    ]
    : ['Sem honorários iniciais (só êxito).'];
  return [
    `📝 *Proposta pronta para aprovar* (nº ${d.id})`,
    `Cliente: *${d.nome}*`,
    `Área: ${d.area}${d.tipoCausa ? ` · ${d.tipoCausa}` : ''}`,
    d.resumo ? `Caso: ${d.resumo.slice(0, 300)}` : null,
    '',
    ...valores,
    `Êxito: ${d.exito}% + sucumbência`,
    `_Valores: ${ORIGEM_PT[d.origem]}._`,
    d.referencia || null,
    d.capacidade ? `\n${d.capacidade}` : null,
    d.conflitos === undefined ? null
      : d.conflitos.length ? `\n⚠️ *CONFLITO DE INTERESSES:* esta pessoa é parte contrária em: ${d.conflitos.join('; ')}. Confira antes de aprovar.`
        : '✔️ Conflito de interesses: nenhum (não é parte contrária em caso do escritório).',
    '',
    `Responda *aprovar ${d.id}* para eu enviar ao cliente,`,
    `*ajustar ${d.id} total 1500, entrada 500, 5x, êxito 30%* para mudar,`,
    `ou *recusar ${d.id}*.`,
  ].filter((x) => x !== null).join('\n');
}

export interface ComandoProposta { acao: 'aprovar' | 'ajustar' | 'recusar'; id: number; ajustes: { total?: number; entrada?: number; parcelas?: number; exito?: number } }

const valorBR = (s: string) => {
  const t = s.replace(/[^\d.,]/g, '');
  const n = t.includes(',') ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t.replace(/\.(?=\d{3}\b)/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

export function interpretarComandoProposta(texto: string): ComandoProposta | null {
  const t = semAcento(texto).trim();
  const m = t.match(/^(aprovar|aprovo|aprova|aprovado|recusar|recuso|recusa|ajustar|ajusta|ajuste)\s+(?:a\s+)?(?:proposta\s+)?(?:n[o.]?\s*)?(\d+)\b(.*)$/);
  if (!m) return null;
  const acao = m[1].startsWith('aprov') ? 'aprovar' : m[1].startsWith('recus') ? 'recusar' : 'ajustar';
  const ajustes: ComandoProposta['ajustes'] = {};
  if (acao === 'ajustar') {
    const resto = m[3];
    const tot = resto.match(/(?:total|valor)\s*(?:de\s*)?(r\$\s*)?([\d.,]+)/);
    const ent = resto.match(/entrada\s*(?:de\s*)?(r\$\s*)?([\d.,]+)/);
    const par = resto.match(/(\d+)\s*(?:x\b|vezes|parcelas)/);
    const exi = resto.match(/exito\s*(?:de\s*)?(\d+)/);
    if (tot) ajustes.total = valorBR(tot[2]);
    if (ent) ajustes.entrada = valorBR(ent[2]);
    if (par) ajustes.parcelas = Number(par[1]);
    if (exi) ajustes.exito = Number(exi[1]);
  }
  return { acao, id: Number(m[2]), ajustes };
}

// ── Fechador de contrato ────────────────────────────────────────────────────

/** Esperando a assinatura do cliente: o link foi enviado (o CRM grava 'enviado_assinatura'; 'finalizado' é o antigo). */
export const AGUARDANDO_ASSINATURA = ['enviado_assinatura', 'finalizado'];

export function proximoPassoContrato(c: { status: string; desde: Date | string }, agora: Date): { acao: 'avisar_dra' | 'lembrar_cliente'; marco: string } | null {
  const dias = (agora.getTime() - new Date(c.desde).getTime()) / 86400000;
  // Proposta aceita → contrato pronto: avisa a Dra. NA HORA para revisar (19/10/2026;
  // antes só avisava depois de 1 dia) e de novo se passar de 1 dia sem revisão.
  if (c.status === 'em_producao') return dias >= 1 ? { acao: 'avisar_dra', marco: 'revisao_d1' } : { acao: 'avisar_dra', marco: 'revisao_d0' };
  // Até 19/10/2026 só olhava 'finalizado' e o CRM grava 'enviado_assinatura' ao mandar
  // o link: os lembretes de assinatura nunca eram enviados.
  if (AGUARDANDO_ASSINATURA.includes(c.status)) {
    if (dias >= 7) return { acao: 'avisar_dra', marco: 'assinatura_d7' };
    if (dias >= 3) return { acao: 'lembrar_cliente', marco: 'assinatura_d3' };
    if (dias >= 1) return { acao: 'lembrar_cliente', marco: 'assinatura_d1' };
  }
  return null;
}

export function mensagemLembreteAssinatura(nome: string): string {
  const primeiro = String(nome || '').trim().split(/\s+/)[0];
  return `Olá${primeiro ? `, ${primeiro}` : ''}! Passando para lembrar que o seu contrato com o escritório da Dra. Letícia Barros está esperando a sua assinatura pelo link que enviamos. Se tiver qualquer dúvida ou não encontrar o link, é só me chamar por aqui.`;
}

// ── Coletor de documentos e provas ──────────────────────────────────────────

export interface ItemDocumento { label: string; keys: string[] }

const BASE: ItemDocumento[] = [
  { label: 'Documento com foto (RG ou CNH), frente e verso', keys: ['rg', 'cnh', 'identidade', 'documento com foto', 'habilitacao'] },
  { label: 'Comprovante de endereço recente (dos últimos 3 meses)', keys: ['residencia', 'endereco', 'comprovante de res', 'conta de luz', 'conta de agua'] },
];

const TRABALHO: ItemDocumento[] = [
  { label: 'Carteira de Trabalho Digital em PDF, mostrando o contrato com a empresa', keys: ['ctps', 'carteira de trabalho', 'carteira digital'] },
  { label: 'Extrato do FGTS em PDF (aplicativo FGTS ou site da Caixa)', keys: ['fgts'] },
  { label: 'Holerites ou contracheques', keys: ['holerite', 'contracheque', 'contra-cheque'] },
  { label: 'Termo de rescisão (TRCT), se já saiu da empresa', keys: ['trct', 'rescisao'] },
];

const POR_AREA: Record<string, ItemDocumento[]> = {
  trabalhista: TRABALHO,
  gestante: [...TRABALHO, { label: 'Exame de gravidez e ultrassom com a data', keys: ['gravidez', 'beta', 'hcg', 'ultrassom', 'usg'] }],
  previdenciario: [
    { label: 'Extrato CNIS (aplicativo Meu INSS), em PDF', keys: ['cnis'] },
    { label: 'Laudos, exames e atestados médicos', keys: ['laudo', 'exame', 'atestado'] },
    { label: 'Carta de indeferimento do INSS, se tiver', keys: ['indeferimento', 'carta do inss'] },
  ],
  familia: [
    { label: 'Certidão de nascimento ou de casamento', keys: ['certidao'] },
    { label: 'Comprovantes de renda e das despesas', keys: ['renda', 'despesa', 'holerite', 'contracheque'] },
  ],
  consumidor: [
    { label: 'Extrato bancário mostrando os descontos', keys: ['extrato'] },
    { label: 'Contrato, fatura ou cobrança questionada', keys: ['contrato', 'fatura', 'cobranca', 'emprestimo', 'cartao'] },
    { label: 'Protocolos de atendimento (banco, loja, Procon)', keys: ['protocolo', 'procon'] },
  ],
};

const TESTEMUNHAS: ItemDocumento = { label: 'Nome e telefone de testemunhas', keys: ['testemunha'] };
const PROVAS_POR_ASSUNTO: Array<{ re: RegExp; itens: ItemDocumento[] }> = [
  { re: /hora[s]? extra|jornada|intervalo|almoco|plantao|escala/, itens: [{ label: 'Registros de ponto, escalas ou mensagens com os horários de entrada e saída', keys: ['ponto', 'jornada', 'escala', 'horario'] }] },
  { re: /assedio|humilh|xing|ameac|gritar|grita|constrang/, itens: [{ label: 'Prints e áudios das conversas com o chefe ou a empresa', keys: ['print', 'audio', 'conversa'] }, TESTEMUNHAS] },
  { re: /acidente|lesao|machuc|afastad/, itens: [{ label: 'CAT (comunicação de acidente de trabalho), atestados e exames', keys: ['cat', 'acidente', 'atestado'] }] },
  { re: /insalubr|periculos|quimic|barulho|calor|epi/, itens: [{ label: 'Fotos do local de trabalho e dos equipamentos de proteção (EPI)', keys: ['foto', 'epi'] }] },
  { re: /salario atrasad|nao pag|sem pagar|atraso de salario|deposito/, itens: [{ label: 'Extratos bancários mostrando os depósitos de salário', keys: ['extrato bancario', 'extrato'] }] },
  { re: /demiss|mandad|dispens|justa causa|desligad/, itens: [{ label: 'Aviso de dispensa ou a mensagem da demissão', keys: ['aviso', 'dispensa', 'demissao'] }] },
  { re: /sem carteira|sem registro|vinculo|informal|nao assin/, itens: [{ label: 'Provas de que trabalhava lá: fotos, mensagens, crachá, uniforme, comprovantes de pagamento', keys: ['cracha', 'uniforme', 'foto', 'comprovante de pagamento'] }, TESTEMUNHAS] },
];

const SEMPRE: ItemDocumento[] = [
  { label: 'Relatos e conversas de WhatsApp sobre o caso (prints ou áudios)', keys: ['print', 'whatsapp', 'conversa', 'audio', 'relato'] },
  { label: 'Transcrição da reunião (ou a gravação), se tiver', keys: ['transcricao', 'reuniao', 'gravacao'] },
];

/** Documentos e provas do caso conforme a área e o assunto falado pelo cliente. */
export function checklistDoCaso(area: string | null, assunto: string | null): ItemDocumento[] {
  const a = semAcento(area || '');
  const texto = semAcento(assunto || '');
  const lista = [...BASE, ...(POR_AREA[a] || [])];
  for (const p of PROVAS_POR_ASSUNTO) if (p.re.test(texto)) lista.push(...p.itens);
  lista.push(...SEMPRE);
  const vistos = new Set<string>();
  return lista.filter((i) => (vistos.has(i.label) ? false : (vistos.add(i.label), true)));
}

/** Marca o que já chegou, pelo nome do arquivo ou pelo texto lido do documento. */
export function itensRecebidos(lista: ItemDocumento[], arquivos: string[]): Array<ItemDocumento & { recebido: boolean }> {
  const nomes = arquivos.map(semAcento);
  return lista.map((i) => ({ ...i, recebido: nomes.some((n) => i.keys.some((k) => n.includes(semAcento(k)))) }));
}

export function mensagemPedidoDocumentos(nome: string, itens: ItemDocumento[]): string {
  const primeiro = String(nome || '').trim().split(/\s+/)[0];
  return [
    `Olá${primeiro ? `, ${primeiro}` : ''}! Aqui é do escritório da Dra. Letícia Barros. Seja bem-vindo(a)! 😊`,
    'Para darmos andamento ao seu caso, precisamos destes documentos:',
    ...itens.map((i) => `• ${i.label}`),
    '',
    'Pode mandar por aqui mesmo, em foto ou PDF. A Carteira de Trabalho e o FGTS em PDF você baixa nos aplicativos *Carteira de Trabalho Digital* e *FGTS*.',
    'Se tiver conversas, áudios ou fotos que mostrem o que aconteceu, mande também. Qualquer dúvida, é só chamar.',
  ].join('\n');
}

export function mensagemCobrancaDocumentos(nome: string, faltam: ItemDocumento[]): string {
  const primeiro = String(nome || '').trim().split(/\s+/)[0];
  return [
    `Olá${primeiro ? `, ${primeiro}` : ''}! Passando para lembrar que ainda faltam estes documentos para o seu caso:`,
    ...faltam.map((i) => `• ${i.label}`),
    '',
    'Assim que puder, mande por aqui mesmo (foto ou PDF). Obrigada!',
  ].join('\n');
}

/** Cobrança dos documentos que faltam: D+2, D+5 e D+10 depois do pedido. */
export function marcoCobranca(pedidoEm: Date | string, agora: Date): 'docs_d2' | 'docs_d5' | 'docs_d10' | null {
  const dias = (agora.getTime() - new Date(pedidoEm).getTime()) / 86400000;
  if (dias >= 10) return 'docs_d10';
  if (dias >= 5) return 'docs_d5';
  if (dias >= 2) return 'docs_d2';
  return null;
}
