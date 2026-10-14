/**
 * Laya: modelo de decisão que roda no próprio servidor (serviço "laya" no PM2,
 * só em 127.0.0.1, endpoint /v1/systemone). É grátis: responde perguntas de
 * múltipla escolha sobre um texto, com a confiança de cada resposta. O CRM
 * pergunta à Laya primeiro e só chama a IA paga quando ela não tem certeza.
 * Sem LAYA_URL configurada, nada muda: tudo segue pela IA de sempre.
 */

export const CONFIANCA_MINIMA = 0.75;

const AREAS = ['trabalhista', 'gestante', 'familia', 'civel', 'previdenciario', 'consumidor', 'outro'] as const;
const URGENCIAS = ['alta', 'media', 'baixa'] as const;
const FAIXAS = ['alto', 'medio', 'baixo'] as const;

/** Perguntas da qualificação do possível cliente, no formato do /v1/systemone. */
export const PERGUNTAS_LEAD = {
  area: {
    type: 'choice', instructions: 'Qual a área do direito do caso que a pessoa relata?',
    criteria: {
      trabalhista: 'emprego, demissão, verbas rescisórias, horas extras, carteira assinada, assédio no trabalho',
      gestante: 'demitida grávida ou durante a licença-maternidade, estabilidade da gestante',
      familia: 'pensão alimentícia, guarda, divórcio, visitas, inventário',
      civel: 'contratos, cobrança, indenização, imóvel, vizinhança',
      previdenciario: 'INSS, aposentadoria, auxílio-doença, BPC/LOAS, pensão por morte, perícia do INSS',
      consumidor: 'banco, empréstimo, cartão, negativação, compra, plano de saúde, companhia aérea',
      outro: 'outro assunto ou não dá para saber',
    },
  },
  urgencia: {
    type: 'choice', instructions: 'Quão rápido o escritório precisa atender esta pessoa?',
    criteria: {
      alta: 'prazo correndo, audiência marcada, intimação recebida, demissão recente, benefício cortado, risco imediato',
      media: 'quer resolver logo, mas sem prazo nem risco imediato',
      baixa: 'só dúvida, pesquisa de preço ou caso antigo sem pressa',
    },
  },
  faixa: {
    type: 'choice', instructions: 'Qual o potencial financeiro do caso?',
    criteria: {
      alto: 'muitos anos de verbas, salário alto, aposentadoria com atrasados longos, dano grave',
      medio: 'verbas ou atrasados de alguns meses, indenização comum',
      baixo: 'valor pequeno, só orientação ou causa sem conteúdo econômico',
    },
  },
} as const;

export interface QualificacaoLaya {
  legal_area: string | null;
  ai_urgency: 'alta' | 'media' | 'baixa';
  ai_value_range: 'alto' | 'medio' | 'baixo';
}

function escolha<T extends readonly string[]>(res: any, chave: string, lista: T): T[number] | null {
  const a = res?.answers?.[chave];
  const c = a?.choice;
  const conf = Number(a?.confidence ?? a?.probabilities?.[c] ?? 0);
  if (!c || !(lista as readonly string[]).includes(c) || !(conf >= CONFIANCA_MINIMA)) return null;
  return c as T[number];
}

/** Qualificação só quando a Laya tem certeza nas três respostas; senão null (a IA paga decide). */
export function lerQualificacaoLaya(res: any): QualificacaoLaya | null {
  const area = escolha(res, 'area', AREAS);
  const urg = escolha(res, 'urgencia', URGENCIAS);
  const faixa = escolha(res, 'faixa', FAIXAS);
  if (!area || !urg || !faixa) return null;
  return { legal_area: area === 'outro' ? null : area, ai_urgency: urg, ai_value_range: faixa };
}

export interface DepsLaya {
  url: string;
  fetch: (url: string, init: any) => Promise<any>;
}

/** Faz a pergunta à Laya. null = não configurada, fora do ar ou erro (nunca lança). */
export async function perguntarLaya(state: string, questions: object, deps: DepsLaya): Promise<any | null> {
  if (!deps.url) return null;
  try {
    const r = await deps.fetch(`${deps.url.replace(/\/$/, '')}/v1/systemone`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, questions, model: 'multilingual' }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r?.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/** Dependências reais: LAYA_URL do .env e o fetch do Node. */
export function depsLayaPadrao(): DepsLaya {
  return { url: process.env.LAYA_URL || '', fetch: (u, i) => fetch(u, i) };
}
