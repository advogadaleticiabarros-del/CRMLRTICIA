import { db } from '../config/database';

/**
 * Cliente de IA compartilhado (grátis se houver chave Gemini/Groq).
 *
 * DIVISÃO DE TRABALHO (configurável por chamada):
 *  - 'gemini'  → REDAÇÃO de peças/minutas (organiza fatos, identifica pedidos,
 *                estrutura a peça, gera o rascunho). É o cérebro que escreve.
 *  - 'groq'    → o "outro": ANÁLISE/triagem rápida da intimação, classificação,
 *                resumos. Trabalho de leitura, não de redação.
 *
 * Cada chamada tenta primeiro o provedor preferido e cai no outro se ele não
 * estiver configurado ou falhar. Sem nenhuma chave, devolve { ok:false } e o
 * fluxo manual (colar resposta) continua valendo.
 *
 * 'openai' é um terceiro provedor opcional (em teste) — usado só quando
 * explicitamente preferido, nunca entra no fallback automático de
 * gemini/groq (que seguem grátis e são a base padrão do escritório).
 */
type Provider = 'gemini' | 'groq' | 'openai' | 'openai-smart';

async function callGemini(prompt: string): Promise<{ ok: boolean; text?: string; message?: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, message: 'sem_gemini' };
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  const d: any = await r.json();
  if (!r.ok) return { ok: false, message: d?.error?.message || 'Erro Gemini' };
  const text = d?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
  return { ok: true, text };
}

async function callGroq(prompt: string): Promise<{ ok: boolean; text?: string; message?: string }> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { ok: false, message: 'sem_groq' };
  // A família Llama saiu do catálogo da Groq (confirmado via GET /models —
  // "llama-3.3-70b-versatile" não existe mais na conta). openai/gpt-oss-120b
  // é o modelo de maior porte disponível hoje, equivalente em capacidade.
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
  });
  const d: any = await r.json();
  if (!r.ok) return { ok: false, message: d?.error?.message || 'Erro Groq' };
  return { ok: true, text: d?.choices?.[0]?.message?.content || '' };
}

// Dois níveis de modelo OpenAI (GPT-5.6), conforme decidido com a advogada:
// LUNA é o padrão pra praticamente tudo (US$0,20/US$1,20 por milhão de
// tokens — barato o bastante pra usar com liberdade); SOL só entra quando
// alguém pedir explicitamente o nível mais forte pra um caso "muito
// extremo" (nenhum ponto do sistema escala pra SOL sozinho hoje).
async function callOpenAI(prompt: string, tier: 'default' | 'smart' = 'default'): Promise<{ ok: boolean; text?: string; message?: string }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, message: 'sem_openai' };
  const model = tier === 'smart'
    ? (process.env.OPENAI_MODEL_SMART || 'gpt-5.6-sol')
    : (process.env.OPENAI_MODEL || 'gpt-5.6-luna');
  const body: Record<string, unknown> = { model, messages: [{ role: 'user', content: prompt }] };
  if (tier === 'default') body.reasoning_effort = 'low';
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const d: any = await r.json();
  if (!r.ok) return { ok: false, message: d?.error?.message || 'Erro OpenAI' };
  return { ok: true, text: d?.choices?.[0]?.message?.content || '' };
}

/**
 * Executa um prompt no provedor preferido, com fallback automático no outro.
 * @param prefer  'gemini' para redigir peças, 'groq' para análise/triagem,
 *                'openai' (GPT-5.6 Luna) e 'openai-smart' (GPT-5.6 Sol) —
 *                sem fallback automático de/para gemini/groq nesses casos.
 */
export async function aiComplete(
  prompt: string,
  prefer: Provider = 'gemini'
): Promise<{ ok: boolean; text?: string; message?: string }> {
  if (prefer === 'openai' || prefer === 'openai-smart') {
    const r = await callOpenAI(prompt, prefer === 'openai-smart' ? 'smart' : 'default');
    return r;
  }
  const order: Provider[] = prefer === 'groq' ? ['groq', 'gemini'] : ['gemini', 'groq'];
  let lastMsg = 'sem_chave';
  for (const p of order) {
    try {
      const r = p === 'gemini' ? await callGemini(prompt) : await callGroq(prompt);
      if (r.ok) return r;
      lastMsg = r.message || lastMsg;
      // 'sem_gemini'/'sem_groq' → só significa "não configurado", tenta o próximo.
    } catch (e: any) {
      lastMsg = e.message;
    }
  }
  return { ok: false, message: lastMsg };
}

/** Há provedor de IA configurado? (define se o estagiário roda automaticamente) */
export function aiConfigured(): boolean {
  return !!(process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY);
}

/**
 * Lê um ARQUIVO (PDF/imagem) com o Gemini multimodal e extrai o conteúdo e os
 * dados relevantes para uma peça — SEM inventar. Requer GEMINI_API_KEY (o Groq
 * não lê arquivos). Usado para analisar os anexos dos clientes.
 */
export async function aiExtractFromFile(
  base64: string, mimeType: string, instruction: string
): Promise<{ ok: boolean; text?: string; message?: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, message: 'A leitura de documentos exige GEMINI_API_KEY' };
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: instruction }, { inline_data: { mime_type: mimeType, data: base64 } }] }] }),
    });
    const d: any = await r.json();
    if (!r.ok) return { ok: false, message: d?.error?.message || 'Erro Gemini (visão)' };
    const text = d?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
    return { ok: true, text };
  } catch (e: any) { return { ok: false, message: e.message }; }
}

/** Tipos canônicos de peça usados para casar o modelo do escritório. */
export const PIECE_TYPES: { value: string; label: string }[] = [
  { value: 'peticao_inicial', label: 'Petição inicial' },
  { value: 'contestacao', label: 'Contestação' },
  { value: 'replica', label: 'Réplica' },
  { value: 'recurso', label: 'Recurso' },
  { value: 'manifestacao', label: 'Manifestação' },
  { value: 'cumprimento_sentenca', label: 'Cumprimento de sentença' },
  { value: 'peticao_simples', label: 'Petição simples' },
];

const semAcento = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Normaliza um texto livre de tipo ("Contestação", "réplica"...) para o valor canônico. */
export function normalizePieceType(raw: string): string | null {
  const t = semAcento(raw);
  if (!t) return null;
  if (t.includes('contesta')) return 'contestacao';
  if (t.includes('replica') || t.includes('impugna')) return 'replica';
  if (t.includes('cumprimento') && t.includes('sentenc')) return 'cumprimento_sentenca';
  if (t.includes('recurso') || t.includes('apela') || t.includes('agravo') || t.includes('embargos')) return 'recurso';
  if (t.includes('manifesta')) return 'manifestacao';
  if (t.includes('inicial') || t.includes('exordial')) return 'peticao_inicial';
  if (t.includes('peticao') || t.includes('simples')) return 'peticao_simples';
  return null;
}

/**
 * Procura na biblioteca do escritório (document_templates) um modelo de PEÇA
 * que case com o tipo informado. Retorna o texto do modelo para servir de
 * esqueleto/estilo à redação da IA. Match por piece_type canônico.
 */
export async function findOfficeModel(rawType: string): Promise<{ id: number; name: string; content: string } | null> {
  const canon = normalizePieceType(rawType);
  if (!canon) return null;
  try {
    const [rows] = await db.query(
      'SELECT id, name, content FROM document_templates WHERE piece_type = ? AND content IS NOT NULL AND content <> "" ORDER BY updated_at DESC LIMIT 1',
      [canon]
    ) as any;
    return rows?.[0] || null;
  } catch { return null; /* coluna piece_type pode não existir antes da migration 047 */ }
}

/**
 * Reúne o CONTEXTO do processo para alimentar a redação da peça: descrição do
 * caso + trechos dos documentos do GED vinculados (petições, decisões, provas).
 * Limita o tamanho para não estourar o contexto do modelo.
 */
async function coletarContextoDoCaso(caseId: number | null, clientId: number | null): Promise<string> {
  if (!caseId) return '';
  const partes: string[] = [];
  try {
    const [[c]] = await db.query('SELECT title, description, legal_area FROM cases WHERE id = ?', [caseId]) as any;
    if (c?.title) partes.push(`Caso: ${c.title}${c.legal_area ? ' (' + c.legal_area + ')' : ''}`);
    if (c?.description) partes.push(`Contexto do caso: ${c.description}`);
  } catch { /* ignora */ }
  try {
    const [docs] = await db.query(
      `SELECT name, type, content FROM documents
        WHERE case_id = ? AND content IS NOT NULL AND content <> ''
        ORDER BY created_at DESC LIMIT 8`,
      [caseId]
    ) as any;
    for (const d of docs || []) {
      const txt = String(d.content || '').replace(/\s+/g, ' ').trim();
      if (txt) partes.push(`— Documento "${d.name || d.type}": ${txt.slice(0, 1500)}`);
    }
  } catch { /* documents pode não ter conteúdo textual */ }
  const full = partes.join('\n');
  return full.slice(0, 9000); // teto de segurança
}

/**
 * Estagiário IA: para um prazo detectado a partir de intimação DJEN, gera
 * automaticamente (1) uma ANÁLISE/triagem (Groq) salva no próprio prazo
 * (ai_summary) e (2) uma MINUTA da peça (Gemini) salva como documento de IA
 * (ai_draft_id). A minuta é redigida com base na intimação + nos documentos do
 * processo (fatos, pedidos, fundamentos) para revisão final antes do protocolo.
 * Best-effort: qualquer falha é silenciosa e nunca derruba o monitoramento.
 */
export async function runEstagiarioForDeadline(opts: {
  detectedDeadlineId: number;
  clientId: number | null;
  caseId?: number | null;
  processId?: number | null;
  movementText: string;
  suggestedType: string;
  suggestedDays: number;
}): Promise<{ ok: boolean; minutaId?: number; message?: string }> {
  if (!aiConfigured()) return { ok: false, message: 'Nenhuma IA configurada (defina GEMINI_API_KEY ou GROQ_API_KEY)' };
  const { detectedDeadlineId, clientId, movementText, suggestedType, suggestedDays } = opts;
  const teor = (movementText || '').trim();
  if (!teor) return { ok: false, message: 'Sem texto da intimação para gerar a minuta' };

  try {
    const [[client]] = clientId
      ? await db.query('SELECT name, cpf_cnpj FROM clients WHERE id = ?', [clientId]) as any
      : [[null]];
    const [[lawyer]] = await db.query(
      "SELECT name, oab_number, oab_uf FROM lawyers WHERE active = 1 ORDER BY id LIMIT 1"
    ) as any;
    const adv = lawyer
      ? `${lawyer.name}, OAB ${lawyer.oab_number || ''}${lawyer.oab_uf ? '/' + lawyer.oab_uf : ''}`
      : 'a advogada responsável';

    // Resolve o caso (para puxar documentos do processo).
    let caseId = opts.caseId ?? null;
    if (!caseId && opts.processId) {
      const [[lp]] = await db.query('SELECT case_id FROM legal_processes WHERE id = ?', [opts.processId]) as any;
      caseId = lp?.case_id ?? null;
    }

    // 1) ANÁLISE / triagem — Groq (o "outro"): leitura rápida da intimação.
    const analisePrompt = `Você é assistente jurídico(a) experiente. Leia a intimação/decisão abaixo e responda em tópicos curtos e objetivos, sem inventar nada fora do texto:
1) RESUMO em 2-4 linhas, em linguagem simples.
2) PRAZO: o tipo provável é "${suggestedType}" (${suggestedDays} dias úteis) — confirme se faz sentido ou sugira o correto.
3) PRÓXIMA AÇÃO recomendada.
4) RISCO/ATENÇÃO: pontos críticos.

INTIMAÇÃO:
${teor}`;
    const analise = await aiComplete(analisePrompt, 'openai');
    if (analise.ok && analise.text) {
      await db.query('UPDATE detected_deadlines SET ai_summary = ? WHERE id = ?', [analise.text, detectedDeadlineId]);
    }

    // 2) MINUTA — Gemini: redige a peça lendo os documentos do processo e,
    //    quando houver, SEGUINDO O MODELO DO ESCRITÓRIO para o tipo de peça.
    const contexto = await coletarContextoDoCaso(caseId, clientId);
    const modelo = await findOfficeModel(suggestedType);
    const blocoModelo = modelo
      ? `\nMODELO DO ESCRITÓRIO — "${modelo.name}" (SIGA fielmente esta estrutura, estilo e cláusulas; substitua os campos {{...}} e adapte ao caso concreto):\n${modelo.content}\n`
      : '';
    const minutaPrompt = `Você é advogado(a) brasileiro(a) redigindo uma peça para protocolo. Sua tarefa:
1) Leia a intimação e os DOCUMENTOS DO PROCESSO abaixo.
2) Identifique fatos relevantes, pedidos e fundamentos jurídicos aplicáveis.
3) ${modelo ? 'Redija a MINUTA SEGUINDO O MODELO DO ESCRITÓRIO abaixo (mesma estrutura e estilo), preenchendo-o com os dados do caso.' : `Redija a MINUTA de ${suggestedType}, em português jurídico formal, bem estruturada (endereçamento, síntese fática, fundamentação com base legal pertinente, pedidos e fecho).`} Deixe fundamentada e pronta para REVISÃO FINAL antes do protocolo.
REGRAS ANTI-INVENÇÃO (obrigatórias): use SOMENTE o que está no texto/autos. É PROIBIDO inventar, inferir ou completar dados. NUNCA crie/complete CPF, CNPJ, RG, nº de processo/benefício, endereços, valores ou datas — se não constar, escreva [colchete a preencher]. Dados da parte contrária só se afirmam se constarem de documento; caso contrário, "[a comprovar]". Número que pareça inválido/incompleto → "[conferir]". Na dúvida, prefira o [colchete] a afirmar.

Cliente: ${client?.name || '[cliente]'}${client?.cpf_cnpj ? ', CPF/CNPJ ' + client.cpf_cnpj : ''}
Advogada subscritora: ${adv}
${blocoModelo}${contexto ? `\nDOCUMENTOS DO PROCESSO (contexto):\n${contexto}\n` : ''}
INTIMAÇÃO A RESPONDER:
${teor}`;
    const minuta = await aiComplete(minutaPrompt, 'openai');
    if (minuta.ok && minuta.text) {
      const [[admin]] = await db.query(
        "SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1"
      ) as any;
      if (admin?.id) {
        const title = `Minuta automática — ${suggestedType}${client?.name ? ' — ' + client.name : ''}`;
        const [r] = await db.query(
          `INSERT INTO ai_generations (user_id, type, title, prompt, result, status, client_id, case_id)
           VALUES (?, 'minuta_auto', ?, ?, ?, 'completed', ?, ?)`,
          [admin.id, title, minutaPrompt, minuta.text, clientId ?? null, caseId ?? null]
        ) as any;
        await db.query('UPDATE detected_deadlines SET ai_draft_id = ? WHERE id = ?', [r.insertId, detectedDeadlineId]);

        // Arquiva a minuta no GED do caso (só quando há cliente: documents.client_id é NOT NULL).
        if (clientId) {
          await db.query(
            `INSERT INTO documents (client_id, case_id, name, type, folder, content, status, created_by)
             VALUES (?, ?, ?, 'ia', 'processos', ?, 'pendente', ?)`,
            [clientId, caseId, title, minuta.text, admin.id]
          );
        }
        return { ok: true, minutaId: r.insertId };
      }
    }
    return { ok: false, message: minuta.message || 'A IA não retornou a minuta' };
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Falha ao gerar a minuta' };
  }
}

export interface MovementAiSummary {
  resumo: string;
  acao: string;
  prazo_interno: string;
  prioridade: 'Alta' | 'Média' | 'Baixa';
}

/** Extrai os 4 campos da resposta em texto da IA. Nunca lança — na dúvida, devolve valores vazios/Baixa. */
export function parseMovementAiResponse(texto: string): MovementAiSummary {
  const campo = (rotulo: string) => {
    const m = texto.match(new RegExp(`${rotulo}:\\s*(.+)`, 'i'));
    return m ? m[1].trim() : '';
  };
  const prioridadeRaw = campo('PRIORIDADE');
  const prioridade: MovementAiSummary['prioridade'] =
    prioridadeRaw === 'Alta' || prioridadeRaw === 'Média' ? prioridadeRaw : 'Baixa';
  return {
    resumo: campo('RESUMO'),
    acao: campo('AÇÃO'),
    prazo_interno: campo('PRAZO INTERNO'),
    prioridade,
  };
}

/**
 * Interpreta UMA movimentação processual para o briefing matinal (seção 4 do
 * spec) — reaproveita o mesmo padrão de análise do Estagiário IA
 * (runEstagiarioForDeadline), mas roda para toda movimentação nova do dia,
 * não só as que geram prazo detectado.
 */
export async function interpretarMovimentacao(
  movementId: number,
  texto: string
): Promise<{ ok: boolean; summary?: MovementAiSummary; message?: string }> {
  const teor = (texto || '').trim();
  if (!teor) return { ok: false, message: 'Sem texto da movimentação' };
  const prompt = `Você é assistente jurídico(a) experiente. Leia a movimentação processual abaixo e responda EXATAMENTE neste formato, sem texto fora dele:
RESUMO: <1-2 linhas, linguagem simples>
AÇÃO: <ação necessária, ou "nenhuma" se for andamento de rotina sem exigir providência>
PRAZO INTERNO: <data sugerida dd/mm/aaaa, ou "sem prazo">
PRIORIDADE: <Alta, Média ou Baixa>

MOVIMENTAÇÃO:
${teor}`;
  const r = await aiComplete(prompt, 'groq');
  if (!r.ok || !r.text) return { ok: false, message: r.message || 'IA indisponível' };
  const summary = parseMovementAiResponse(r.text);
  await db.query('UPDATE process_movements SET ai_summary = ? WHERE id = ?', [JSON.stringify(summary), movementId]);
  return { ok: true, summary };
}

// ── Qualificação automática de lead (área, urgência, faixa de valor) ────────
// Mesmo padrão de interpretarMovimentacao/parseMovementAiResponse acima:
// prompt com campos rotulados em texto plano, parser tolerante por regex,
// fallback conservador se o campo não bater no formato esperado.
const LEGAL_AREAS_VALIDAS = ['trabalhista', 'gestante', 'familia', 'civel', 'previdenciario', 'consumidor', 'outro'];

export interface LeadQualification {
  legal_area: string | null;
  ai_urgency: 'alta' | 'media' | 'baixa' | null;
  ai_value_range: 'alto' | 'medio' | 'baixo' | null;
}

export function parseLeadQualification(texto: string): LeadQualification {
  const campo = (rotulo: string) => {
    const m = texto.match(new RegExp(`${rotulo}:\\s*(.+)`, 'i'));
    return m ? m[1].trim().toLowerCase() : '';
  };

  const areaRaw = campo('ÁREA').normalize('NFD').replace(/[̀-ͯ]/g, ''); // remove acento
  const legal_area = LEGAL_AREAS_VALIDAS.includes(areaRaw) ? areaRaw : null;

  const urgenciaRaw = campo('URGÊNCIA');
  let ai_urgency: LeadQualification['ai_urgency'] = null;
  if (urgenciaRaw === 'alta') ai_urgency = 'alta';
  else if (urgenciaRaw === 'média' || urgenciaRaw === 'media') ai_urgency = 'media';
  else if (urgenciaRaw) ai_urgency = 'baixa'; // qualquer outra coisa dita (inclusive "baixa") vira o default conservador

  const faixaRaw = campo('FAIXA DE VALOR');
  let ai_value_range: LeadQualification['ai_value_range'] = null;
  if (faixaRaw === 'alto') ai_value_range = 'alto';
  else if (faixaRaw === 'médio' || faixaRaw === 'medio') ai_value_range = 'medio';
  else if (faixaRaw === 'baixo') ai_value_range = 'baixo';
  // qualquer outra coisa (inclusive vazio) fica null — sem inventar faixa

  return { legal_area, ai_urgency, ai_value_range };
}

/**
 * Qualifica um lead novo pela IA: sugere área (só grava se o lead ainda
 * não tiver uma), urgência comercial e faixa de valor estimado. Nunca
 * lança exceção — chamado fire-and-forget na criação do lead (ver
 * src/routes/lead-public.ts e src/routes/leads.ts).
 */
export async function qualificarLead(
  leadId: number,
  texto: string
): Promise<{ ok: boolean; qualification?: LeadQualification; message?: string }> {
  const teor = (texto || '').trim();
  if (teor.length < 15) return { ok: false, message: 'Texto insuficiente para qualificar' };

  const prompt = `Você é assistente comercial de um escritório de advocacia. Leia o relato de um lead (possível cliente) abaixo e responda EXATAMENTE neste formato, sem texto fora dele:
ÁREA: <uma destas: trabalhista, gestante, familia, civel, previdenciario, consumidor, outro>
URGÊNCIA: <Alta, Média ou Baixa — o quão rápido esse lead precisa ser atendido comercialmente>
FAIXA DE VALOR: <Alto, Médio ou Baixo — estimativa qualitativa do potencial financeiro do caso>

RELATO DO LEAD:
${teor}`;

  const r = await aiComplete(prompt, 'groq');
  if (!r.ok || !r.text) return { ok: false, message: r.message || 'IA indisponível' };

  const qualification = parseLeadQualification(r.text);

  try {
    if (qualification.legal_area) {
      await db.query(
        'UPDATE leads SET legal_area = COALESCE(legal_area, ?), ai_urgency = ?, ai_value_range = ? WHERE id = ?',
        [qualification.legal_area, qualification.ai_urgency, qualification.ai_value_range, leadId]
      );
    } else {
      await db.query(
        'UPDATE leads SET ai_urgency = ?, ai_value_range = ? WHERE id = ?',
        [qualification.ai_urgency, qualification.ai_value_range, leadId]
      );
    }
  } catch (e: any) {
    return { ok: false, message: e.message };
  }

  return { ok: true, qualification };
}

// ── Extração de dados de nomeação dativa a partir do teor da publicação ────
// Mesmo padrão de interpretarMovimentacao/qualificarLead: prompt com campos
// rotulados em texto plano, parser tolerante por regex. Usado quando o
// monitoramento (DJEN/OAB) encontra uma publicação com termos de nomeação
// dativa (ver DATIVA_NOMEACAO_RE em monitoringService.ts) — a IA só EXTRAI o
// que já está escrito na decisão, nunca decide se é ou não uma nomeação.
export interface DativeNominationExtraction {
  juizo: string;
  comarca: string;
  vara: string;
  qualificacao_parte: string;
  decisao_id: string;
  assunto: string;
}

export function parseDativeNominationExtraction(texto: string): DativeNominationExtraction {
  const campo = (rotulo: string) => {
    const m = texto.match(new RegExp(`${rotulo}:\\s*(.+)`, 'i'));
    const v = m ? m[1].trim() : '';
    return /^(vazio|n\/?a|nenhum|n[ãa]o informad[oa])$/i.test(v) ? '' : v;
  };
  return {
    juizo: campo('JUIZO'),
    comarca: campo('COMARCA'),
    vara: campo('VARA'),
    qualificacao_parte: campo('QUALIFICACAO_PARTE'),
    decisao_id: campo('DECISAO_ID'),
    assunto: campo('ASSUNTO'),
  };
}

export async function extrairNomeacaoDativa(
  texto: string
): Promise<{ ok: boolean; extraction?: DativeNominationExtraction; message?: string }> {
  const teor = (texto || '').trim().slice(0, 8000);
  if (!teor) return { ok: false, message: 'Sem texto da publicação' };

  const prompt = `Você é assistente jurídico(a). O texto abaixo é uma decisão/publicação judicial que nomeia a advogada como defensora dativa. Extraia SOMENTE o que estiver escrito no texto e responda EXATAMENTE neste formato, sem texto fora dele (use "vazio" quando não encontrar):
JUIZO: <cabeçalho do juízo em maiúsculas, ex.: DO 1º JUIZADO ESPECIAL CÍVEL DE CARIACICA/ES>
COMARCA: <cidade/UF, ex.: Cariacica/ES>
VARA: <nome da vara/juízo, ex.: 1º Juizado Especial Cível>
QUALIFICACAO_PARTE: <papel processual da parte assistida em maiúsculas, ex.: REQUERIDA, RÉU, RECORRIDA>
DECISAO_ID: <número do Id do documento da decisão nos autos, se mencionado>
ASSUNTO: <o que deve ser feito após o prazo, breve, ex.: apresentação de contestação>

TEXTO:
${teor}`;

  const r = await aiComplete(prompt, 'openai');
  if (!r.ok || !r.text) return { ok: false, message: r.message || 'IA indisponível' };
  return { ok: true, extraction: parseDativeNominationExtraction(r.text) };
}
