/**
 * Dr. Otávio, copiloto comercial da Dra.:
 *  1) Qualificação em %: a partir da conversa, estima a capacidade de o
 *     possível cliente pagar, o potencial do caso para o escritório e a chance
 *     de fechar, e diz quais perguntas sutis ainda faltam (a Lívia faz).
 *     A IA só extrai os sinais; a conta é regra fixa daqui.
 *  2) Copiloto: quando a conversa que a Dra. (ou a equipe) está tendo mostra
 *     intenção de proposta ("quanto custa?", "vou te mandar a proposta"),
 *     sugere à Dra., em particular, valores, forma de pagamento e a próxima
 *     mensagem. Nada vai ao cliente: um atendimento só, conduzido pela Dra.
 * Regras puras — tests/copilotoComercial.test.mjs.
 */

const semAcento = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ── Intenção de proposta na conversa ────────────────────────────────────────

export interface MsgConversa { from_me: number | boolean; body: string; humano: boolean }

const CLIENTE_QUER = /quanto (custa|fica|sai|cobra|e (o|a) (consulta|processo|acao))|qual (e )?(o )?valor|valor (da|do|pra|para) (acao|processo|consulta|contratar)|honorario|como (funciona|e|fica) o pagamento|forma(s)? de pagamento|da (pra|para) parcelar|parcela(r|mento)|cobra(m)? quanto|quero (contratar|fechar|entrar com|seguir com)|vou (te |la )?contratar|pode (dar entrada|entrar com|seguir)|vamos (fazer|entrar|seguir|fechar)|como (faco|faz) pra contratar|manda (a|o) (proposta|contrato)/;
const ESCRITORIO_PROPOE = /(vou|vamos|irei) (te |lhe )?(mandar|enviar|montar|preparar|fazer|passar) (a |uma |sua |a sua )?proposta|proposta de honorario|(o )?valor dos honorario|nossos honorario|fechar (o )?contrato|vou (te )?passar (o )?valor|contrato de honorario|(te|lhe) (mando|envio) (o )?contrato/;

/** Olha só as últimas 8 mensagens: intenção antiga não volta a disparar. */
export function detectarIntencaoProposta(msgs: MsgConversa[]): { intencao: boolean; quem: 'cliente' | 'escritorio' | null; gatilho: string } {
  for (const x of [...msgs].slice(-8).reverse()) {
    const t = semAcento(x.body);
    if (!x.from_me && CLIENTE_QUER.test(t)) return { intencao: true, quem: 'cliente', gatilho: String(x.body).slice(0, 200) };
    if (x.from_me && x.humano && ESCRITORIO_PROPOE.test(t)) return { intencao: true, quem: 'escritorio', gatilho: String(x.body).slice(0, 200) };
  }
  return { intencao: false, quem: null, gatilho: '' };
}

// ── Qualificação em % ───────────────────────────────────────────────────────

export type SituacaoTrabalho = 'empregado_clt' | 'autonomo' | 'servidor' | 'aposentado_beneficio' | 'informal' | 'desempregado';
export interface SinaisCapacidade {
  situacao_trabalho?: SituacaoTrabalho | null;
  renda_mensal?: number | null;
  /** Tem rescisão, FGTS, acordo ou atrasados a receber (paga a entrada com isso). */
  verbas_a_receber?: boolean | null;
  valor_estimado_causa?: number | null;
  urgencia_dor?: 'alta' | 'media' | 'baixa' | null;
  /** Decide sozinho(a)? */
  decisor?: boolean | null;
  engajamento?: 'alto' | 'medio' | 'baixo' | null;
  preferencia_pagamento?: 'pix' | 'cartao' | 'parcelado' | 'so_exito' | null;
  objecao_preco?: boolean | null;
  mora_fora?: boolean | null;
}

const SITUACOES: SituacaoTrabalho[] = ['empregado_clt', 'autonomo', 'servidor', 'aposentado_beneficio', 'informal', 'desempregado'];
const SINAIS_PRINCIPAIS = ['situacao_trabalho', 'renda_mensal', 'verbas_a_receber', 'valor_estimado_causa', 'urgencia_dor', 'decisor', 'engajamento', 'preferencia_pagamento'] as const;

/** Perguntas sutis e simples (a Lívia usa no máximo uma por mensagem, nunca falando de valores). */
export const PERGUNTAS_SUTIS: Partial<Record<typeof SINAIS_PRINCIPAIS[number], string>> = {
  situacao_trabalho: 'E hoje, você está trabalhando em algum lugar?',
  renda_mensal: 'Pra eu entender melhor o seu caso: qual era o seu salário, mais ou menos?',
  verbas_a_receber: 'Quando você saiu, chegou a receber a rescisão ou sacar o FGTS?',
  decisor: 'Tem mais alguém que participa dessa decisão com você, ou é só você?',
  preferencia_pagamento: 'Pra Dra. já pensar no melhor formato pra você: o que fica mais tranquilo, Pix, cartão ou dividir?',
  urgencia_dor: 'E como isso está te afetando hoje? Está precisando resolver com urgência?',
};

export interface ResultadoCapacidade {
  capacidade: number; potencial: number; fechamento: number; faixa: 'alta' | 'media' | 'baixa';
  modalidade: string; confianca: number; motivos: string[]; faltam: string[];
}

const limitar = (n: number) => Math.max(5, Math.min(95, Math.round(n)));

export function calcularCapacidade(s: SinaisCapacidade): ResultadoCapacidade {
  const motivos: string[] = [];
  let cap = 50;
  const somaCap = (n: number, porque: string) => { cap += n; motivos.push(`${n > 0 ? '+' : ''}${n} capacidade: ${porque}`); };
  switch (s.situacao_trabalho) {
    case 'empregado_clt': somaCap(20, 'trabalha com carteira'); break;
    case 'servidor': somaCap(20, 'servidor público'); break;
    case 'autonomo': somaCap(10, 'autônomo com renda'); break;
    case 'aposentado_beneficio': somaCap(5, 'recebe aposentadoria ou benefício'); break;
    case 'informal': somaCap(-5, 'trabalho informal'); break;
    case 'desempregado': somaCap(-15, 'desempregado(a)'); break;
  }
  if (s.renda_mensal != null) {
    const r = s.renda_mensal;
    if (r >= 5000) somaCap(20, 'renda acima de R$ 5 mil');
    else if (r >= 3000) somaCap(12, 'renda entre R$ 3 e 5 mil');
    else if (r >= 1800) somaCap(5, 'renda em torno de 1,5 salário mínimo');
    else somaCap(-10, 'renda baixa');
  }
  if (s.verbas_a_receber === true) somaCap(10, 'tem verbas a receber (pode pagar a entrada com elas)');
  if (s.verbas_a_receber === false) somaCap(-3, 'não tem verbas a receber agora');
  if (s.preferencia_pagamento === 'cartao') somaCap(8, 'prefere cartão');
  if (s.preferencia_pagamento === 'pix') somaCap(5, 'prefere Pix');
  if (s.preferencia_pagamento === 'parcelado') somaCap(3, 'prefere parcelar');
  if (s.preferencia_pagamento === 'so_exito') somaCap(-15, 'só consegue pagar no êxito');
  if (s.objecao_preco === true) somaCap(-10, 'achou caro');
  if (s.decisor === false) somaCap(-5, 'depende de outra pessoa para decidir');

  let pot = 40;
  const somaPot = (n: number, porque: string) => { pot += n; motivos.push(`${n > 0 ? '+' : ''}${n} potencial: ${porque}`); };
  if (s.valor_estimado_causa != null) {
    const v = s.valor_estimado_causa;
    if (v >= 50000) somaPot(40, 'causa acima de R$ 50 mil');
    else if (v >= 20000) somaPot(30, 'causa entre R$ 20 e 50 mil');
    else if (v >= 10000) somaPot(20, 'causa entre R$ 10 e 20 mil');
    else if (v >= 5000) somaPot(10, 'causa entre R$ 5 e 10 mil');
    else if (v < 3000) somaPot(-15, 'causa pequena');
  }
  if (s.urgencia_dor === 'alta') somaPot(10, 'urgência alta');
  if (s.urgencia_dor === 'baixa') somaPot(-5, 'pouca urgência');
  if (s.verbas_a_receber === true) somaPot(5, 'há verbas em discussão');
  if (s.mora_fora === true) somaPot(-5, 'mora fora (atendimento à distância)');

  const capacidade = limitar(cap), potencial = limitar(pot);
  const eng = s.engajamento === 'alto' ? 85 : s.engajamento === 'medio' ? 60 : s.engajamento === 'baixo' ? 30 : 55;
  const fechamento = limitar(0.4 * capacidade + 0.3 * potencial + 0.3 * eng - (s.decisor === false ? 5 : 0));
  const faixa = fechamento >= 70 ? 'alta' : fechamento >= 40 ? 'media' : 'baixa';
  const modalidade = capacidade >= 65 ? 'Entrada + parcelas pela tabela, com êxito no final'
    : potencial >= 55 && capacidade < 45 ? 'Só êxito (30%) ou entrada simbólica: a capacidade de pagar agora é baixa, mas o caso vale'
      : 'Entrada menor, mais parcelas e êxito no final';
  const faltam = SINAIS_PRINCIPAIS.filter((k) => s[k] == null);
  return { capacidade, potencial, fechamento, faixa, modalidade, confianca: Math.round(((SINAIS_PRINCIPAIS.length - faltam.length) / SINAIS_PRINCIPAIS.length) * 100) / 100, motivos, faltam };
}

const PRIORIDADE_PERGUNTA = ['situacao_trabalho', 'renda_mensal', 'verbas_a_receber', 'urgencia_dor', 'decisor', 'preferencia_pagamento'] as const;

export function perguntasQueFaltam(r: ResultadoCapacidade, max = 1): string[] {
  return PRIORIDADE_PERGUNTA.filter((k) => r.faltam.includes(k) && PERGUNTAS_SUTIS[k]).slice(0, max).map((k) => PERGUNTAS_SUTIS[k]!);
}

export function promptSinaisCapacidade(conversa: string[], area: string | null): string {
  return `Leia a conversa de WhatsApp entre um escritório de advocacia e um possível cliente${area ? ` (área ${area})` : ''}.
Extraia SOMENTE o que a conversa mostra, para avaliar se a pessoa consegue contratar. Não invente; o que não aparece fica null.
Responda SOMENTE com JSON:
{"situacao_trabalho":"${SITUACOES.join('|')}|null",
 "renda_mensal":"valor em reais ou null",
 "verbas_a_receber":true|false|null,
 "valor_estimado_causa":"estimativa do que o cliente pode receber, em reais, se der para estimar pelo que ele contou (ex.: salário x meses de verbas), ou null",
 "urgencia_dor":"alta|media|baixa|null",
 "decisor":true|false|null,
 "engajamento":"alto|medio|baixo|null",
 "preferencia_pagamento":"pix|cartao|parcelado|so_exito|null",
 "objecao_preco":true|false|null,
 "mora_fora":true|false|null}
"engajamento": alto = responde rápido, manda documentos, faz perguntas; baixo = some, respostas curtas.
"mora_fora": mora fora do Espírito Santo.

CONVERSA:
${conversa.join('\n').slice(-12000)}`;
}

const jsonDe = (s: string): any => {
  const limpo = String(s || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  if (!limpo.startsWith('{')) return null;
  try { return JSON.parse(limpo); } catch { return null; }
};

function reaisDe(v: any): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null;
  const t = semAcento(String(v ?? ''));
  if (!t || t === 'null') return null;
  const mil = /\bmil\b|\bk\b/.test(t);
  let n = t.replace(/[^\d,.]/g, '');
  if (!n) return null;
  if (n.includes(',')) n = n.replace(/\./g, '').replace(',', '.');
  else if (/\.\d{3}$/.test(n)) n = n.replace(/\./g, '');
  const x = Number(n) * (mil ? 1000 : 1);
  return Number.isFinite(x) ? x : null;
}

export function parseSinais(s: string): SinaisCapacidade {
  const o = jsonDe(s);
  if (!o || typeof o !== 'object') return {};
  const umDe = <T extends string>(v: any, xs: readonly T[]): T | null => (xs.includes(v) ? v : null);
  const bool = (v: any) => (v === true || v === false ? v : null);
  return {
    situacao_trabalho: umDe(o.situacao_trabalho, SITUACOES),
    renda_mensal: reaisDe(o.renda_mensal),
    verbas_a_receber: bool(o.verbas_a_receber),
    valor_estimado_causa: reaisDe(o.valor_estimado_causa),
    urgencia_dor: umDe(o.urgencia_dor, ['alta', 'media', 'baixa'] as const),
    decisor: bool(o.decisor),
    engajamento: umDe(o.engajamento, ['alto', 'medio', 'baixo'] as const),
    preferencia_pagamento: umDe(o.preferencia_pagamento, ['pix', 'cartao', 'parcelado', 'so_exito'] as const),
    objecao_preco: bool(o.objecao_preco),
    mora_fora: bool(o.mora_fora),
  };
}

const CONFIANCA_PT = (c: number) => (c >= 0.7 ? 'alta' : c >= 0.4 ? 'média' : 'baixa');

/** Uma linha para a Dra. (aprovação de proposta, copiloto, telas). */
export function linhaCapacidade(r: ResultadoCapacidade): string {
  return `📊 Chance de fechar: ${r.fechamento}% · capacidade de pagar ${r.capacidade}% · potencial do caso ${r.potencial}% (confiança ${CONFIANCA_PT(r.confianca)})\nForma sugerida: ${r.modalidade}`;
}

// ── Copiloto ────────────────────────────────────────────────────────────────

export function promptCopiloto(d: { guia: string; nome: string; area: string | null; conversa: string[]; cap: ResultadoCapacidade; sugestao: string }): string {
  return `Você é o Dr. Otávio, copiloto comercial da Dra. Letícia Barros (advocacia, Vitória/ES). A Dra. está conversando no WhatsApp com ${d.nome}${d.area ? ` (área ${d.area})` : ''} e a conversa chegou na hora da proposta.
Sugira À DRA. (não ao cliente) a próxima mensagem dela, no tom de voz abaixo, conduzindo para fechar o contrato com ética: sem prometer resultado nem prazo, sem pressão, explicando que o processo tem dia para começar mas não tem dia para terminar, se o assunto for tempo.
Se faltar informação para a proposta, a mensagem pode fazer UMA pergunta sutil (sem falar de valores ainda, se a Dra. não falou).

${d.guia || 'Tom: acolhedor, próximo, linguagem simples, mensagens curtas.'}

QUALIFICAÇÃO: ${linhaCapacidade(d.cap)}
SUGESTÃO DE PROPOSTA: ${d.sugestao}

CONVERSA (mais recentes por último):
${d.conversa.join('\n').slice(-8000)}

Responda SOMENTE com JSON: {"proxima_mensagem":"texto para a Dra. enviar","pontos":["até 3 observações curtas para a Dra. (o que destacar, o que evitar)"]}`;
}

export function parseSugestaoCopiloto(s: string): { proxima_mensagem: string; pontos: string[] } {
  const o = jsonDe(s);
  return {
    proxima_mensagem: typeof o?.proxima_mensagem === 'string' ? o.proxima_mensagem.trim().slice(0, 1200) : '',
    pontos: Array.isArray(o?.pontos) ? o.pontos.filter((x: any) => typeof x === 'string' && x.trim()).map((x: string) => x.trim().slice(0, 240)).slice(0, 3) : [],
  };
}

const brl = (n: number) => `R$ ${Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ORIGEM_PT: Record<string, string> = { tabela: 'tabela do escritório', historico: 'média das propostas aceitas da área', padrao: 'sem tabela para a área: só êxito' };

export interface SugestaoValores { total: number; entrada: number; parcelas: number; valorParcela: number; exito: number; origem: string }

export function mensagemCopiloto(d: {
  nome: string; leadId: number | null; area: string | null; gatilho: string; quem: 'cliente' | 'escritorio' | null;
  cap: ResultadoCapacidade; sugestao: SugestaoValores | null; proximaMensagem: string; pontos: string[];
}): string {
  const s = d.sugestao;
  const valores = s
    ? (s.total
      ? `Honorários ${brl(s.total)}${s.entrada ? ` · entrada ${brl(s.entrada)}` : ''}${s.parcelas ? ` · ${s.parcelas}x de ${brl(s.valorParcela)}` : ''} · êxito ${s.exito}%`
      : `Só êxito: ${s.exito}% + sucumbência`) + ` _(${ORIGEM_PT[s.origem] || s.origem})_`
    : null;
  const perguntas = perguntasQueFaltam(d.cap, 2);
  return [
    `💡 *Copiloto — ${d.nome}*${d.area ? ` (${d.area})` : ''}`,
    `Na conversa: "${String(d.gatilho).replace(/\s+/g, ' ').slice(0, 160)}" ${d.quem === 'cliente' ? '(o cliente quer saber/contratar)' : '(a senhora falou em proposta)'}`,
    '',
    linhaCapacidade(d.cap),
    valores ? `💰 Sugestão: ${valores}` : null,
    d.pontos.length ? `\n${d.pontos.map((p) => `• ${p}`).join('\n')}` : null,
    d.proximaMensagem ? `\n✍️ *Próxima mensagem sugerida:*\n"${d.proximaMensagem}"` : null,
    perguntas.length ? `\n❓ Ainda falta saber: ${perguntas.join(' / ')}` : null,
    '',
    d.leadId
      ? `Para a Dra. Bianca montar e mandar para a sua aprovação: *montar proposta ${d.leadId}*`
      : 'Este contato ainda não está cadastrado como possível cliente: cadastre no CRM para eu montar a proposta.',
  ].filter((l) => l !== null).join('\n');
}

/** "montar proposta 45" (45 = nº do possível cliente) → 45. */
export function interpretarComandoMontar(texto: string): number | null {
  const m = semAcento(texto).trim().match(/^montar\s+(?:a\s+)?proposta\s+(?:do\s+(?:lead|cliente)\s+)?(?:n[oº.]?\s*)?(\d+)\b/);
  return m ? Number(m[1]) : null;
}
