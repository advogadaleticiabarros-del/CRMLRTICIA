/**
 * Dra. Lívia, atendente do WhatsApp do escritório. Escreve no tom de voz da
 * Dra. (guia aprendido das conversas reais), faz as perguntas certas da área
 * e encaminha o que é jurídico. Começa em modo rascunho: a equipe aprova antes
 * de sair. Regras puras — tests/atendenteSociedade.test.mjs.
 */

/** Perguntas de primeiro atendimento por área (boas práticas de intake jurídico, adaptadas). */
export const PERGUNTAS_POR_AREA: Record<string, string[]> = {
  trabalhista: [
    'Qual o nome da empresa e o que ela faz?', 'Qual era a sua função?', 'Qual a data de admissão e, se já saiu, a data de saída?',
    'Qual era o seu salário?', 'A carteira foi assinada desde o começo?', 'Como foi a saída: pediu demissão, foi dispensado(a) ou por justa causa?',
    'O que ficou sem pagar (rescisão, FGTS, horas extras…)?', 'Tem mensagens, fotos ou testemunhas do que aconteceu?',
  ],
  gestante: [
    'Quando foi a dispensa?', 'Com quantas semanas de gestação você estava na data da dispensa?', 'A empresa sabia da gravidez?',
    'Qual era o seu salário e a sua função?', 'A carteira estava assinada?', 'Você tem o exame de gravidez e o ultrassom com a data?',
  ],
  previdenciario: [
    'Qual benefício você precisa (aposentadoria, auxílio-doença, BPC, pensão…)?', 'Já fez o pedido no INSS? Foi negado? Quando?',
    'Qual a sua idade e quanto tempo de contribuição você tem?', 'Tem laudos, exames e atestados médicos?', 'Consegue entrar no Meu INSS?',
  ],
  familia: [
    'O assunto é pensão, guarda, visitas ou divórcio?', 'Quantos filhos e qual a idade de cada um?', 'Qual a renda do outro responsável, se souber?',
    'Já existe algum acordo ou processo sobre isso?', 'Onde as crianças moram hoje?',
  ],
  consumidor: [
    'Qual banco ou empresa?', 'O que aconteceu e desde quando?', 'Qual o valor cobrado ou descontado?', 'Já reclamou com a empresa ou no Procon? Tem o protocolo?',
  ],
  civel: ['O que aconteceu e quando?', 'Quem é a outra parte?', 'Há contrato, recibos ou mensagens sobre isso?', 'Qual o valor envolvido?'],
  geral: ['Me conta com calma o que aconteceu?', 'Quando foi?', 'Quem é a outra parte (empresa ou pessoa)?', 'Tem algum documento ou mensagem sobre isso?'],
};

export interface CtxResposta { comandante: boolean; parceiro: boolean; texto: string; ultimaHumanaHaMin: number | null }

/** A Lívia só entra quando não é a Dra./Jessica, nem parceiro, nem só emoji, e ninguém da equipe falou nas últimas 2h. */
export function deveResponder(c: CtxResposta): boolean {
  if (c.comandante || c.parceiro) return false;
  if (!/[\p{L}\d]/u.test(String(c.texto || ''))) return false;
  if (c.ultimaHumanaHaMin !== null && c.ultimaHumanaHaMin < 120) return false;
  return true;
}

export interface ContatoAtendente {
  tipo: 'cliente' | 'possivel_cliente' | 'novo';
  nome: string | null;
  area: string | null;
  processos: Array<{ numero: string | null; ultimaMov: string | null }>;
}

export function montarPromptAtendente(d: { guia: string; correcoes: string[]; contato: ContatoAtendente; conversa: string[]; perguntas: string[]; perguntaSutil?: string | null }): string {
  const c = d.contato;
  const quem = c.tipo === 'cliente' ? `CLIENTE do escritório: ${c.nome || 'sem nome'}${c.area ? ` (área ${c.area})` : ''}.`
    : c.tipo === 'possivel_cliente' ? `POSSÍVEL CLIENTE já cadastrado: ${c.nome || 'sem nome'}${c.area ? ` (área ${c.area})` : ''}.`
      : 'Contato NOVO (ainda não cadastrado).';
  return `Você é a Dra. Lívia, atendente do escritório de advocacia da Dra. Letícia Barros (Vitória/ES), no WhatsApp.
Escreva a PRÓXIMA mensagem do escritório, como uma pessoa da equipe, no tom de voz abaixo.

${d.guia || 'Tom: acolhedor, próximo, linguagem simples, mensagens curtas.'}

${d.correcoes.length ? `CORREÇÕES QUE A DRA. JÁ FEZ NAS SUAS RESPOSTAS (siga sempre):\n${d.correcoes.map((x) => `- ${x}`).join('\n')}\n` : ''}
QUEM ESTÁ FALANDO: ${quem}
${c.processos.length ? `PROCESSOS (status para responder "como está meu processo", em linguagem simples):\n${c.processos.map((p) => `- ${p.numero || 's/ nº'}: ${p.ultimaMov || 'sem movimentação recente'}`).join('\n')}` : ''}

PERGUNTAS CERTAS PARA ESTE TIPO DE CASO (faça no máximo 2 por mensagem, só as que ainda não foram respondidas):
${d.perguntas.map((p) => `- ${p}`).join('\n')}
${d.perguntaSutil ? `
PERGUNTA SUTIL (para a Dra. saber a melhor forma de atender): quando o caso já estiver entendido e a conversa permitir, encaixe com naturalidade, no lugar de uma das perguntas acima:
- ${d.perguntaSutil}
Uma por vez, com leveza, sem citar valores e sem parecer interrogatório. Se a pessoa estiver aflita ou com urgência, deixe para depois.
` : ''}
REGRAS (obrigatórias):
- Você NUNCA dá opinião jurídica, nunca diz se a pessoa "tem direito" e nunca promete resultado.
- Nunca fale de honorários, valores ou percentuais: diga que a Dra. explica isso na proposta.
- Sobre o processo, só diga o status neutro (a última movimentação, em palavras simples). Prazo, chance ou estratégia: "a Dra. vai te explicar".
- Prazo correndo, audiência próxima, intimação recebida, demissão de gestante ou benefício cortado = URGENTE: acolha e diga que a Dra. vai retornar com prioridade.
- Uma mensagem curta, no tom da Dra. Não use juridiquês. Não invente nada que não esteja na conversa.

CONVERSA (mais recentes por último):
${d.conversa.join('\n').slice(-8000)}

Responda SOMENTE com JSON:
{"resposta":"texto da mensagem","intencao":"novo_caso"|"andamento"|"documentos"|"agendar"|"financeiro"|"outro",
 "area":"trabalhista|gestante|previdenciario|familia|consumidor|civel|outro|null","urgente":true|false,"motivo_urgencia":"…",
 "encaminhar":"dra"|"bianca"|"camila"|null}`;
}

const INTENCOES = ['novo_caso', 'andamento', 'documentos', 'agendar', 'financeiro', 'outro'] as const;
export interface RespostaAtendente {
  resposta: string; intencao: typeof INTENCOES[number]; area: string | null; urgente: boolean; motivo_urgencia: string; encaminhar: 'dra' | 'bianca' | 'camila' | null;
}

export function parseRespostaAtendente(texto: string): RespostaAtendente | null {
  const limpo = String(texto || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  if (!limpo.startsWith('{')) return null;
  let o: any;
  try { o = JSON.parse(limpo); } catch { return null; }
  const resposta = typeof o?.resposta === 'string' ? o.resposta.trim() : '';
  if (!resposta) return null;
  const intencao = (INTENCOES as readonly string[]).includes(o.intencao) ? o.intencao : 'outro';
  const enc = ['dra', 'bianca', 'camila'].includes(o.encaminhar) ? o.encaminhar : null;
  return {
    resposta: resposta.slice(0, 1500), intencao, area: typeof o.area === 'string' && o.area !== 'null' ? o.area : null,
    urgente: o.urgente === true, motivo_urgencia: typeof o.motivo_urgencia === 'string' ? o.motivo_urgencia.trim() : '', encaminhar: enc,
  };
}

/** O que a Dra. precisa olhar antes de liberar: promessa de resultado ou valores na resposta. */
export function alertasDaResposta(resposta: string): string[] {
  const t = String(resposta || '').toLowerCase();
  const out: string[] = [];
  if (/vai ganhar|garant|com certeza (vai|ganha)|causa ganha|100%|sem risco/.test(t)) out.push('promete resultado');
  if (/r\$|honor[aá]rio|\b\d+\s?%|valor da consulta/.test(t)) out.push('fala de valores');
  return out;
}
