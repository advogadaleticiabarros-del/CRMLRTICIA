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
 */
type Provider = 'gemini' | 'groq';

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
  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
  });
  const d: any = await r.json();
  if (!r.ok) return { ok: false, message: d?.error?.message || 'Erro Groq' };
  return { ok: true, text: d?.choices?.[0]?.message?.content || '' };
}

/**
 * Executa um prompt no provedor preferido, com fallback automático no outro.
 * @param prefer  'gemini' para redigir peças, 'groq' para análise/triagem.
 */
export async function aiComplete(
  prompt: string,
  prefer: Provider = 'gemini'
): Promise<{ ok: boolean; text?: string; message?: string }> {
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
    const analise = await aiComplete(analisePrompt, 'groq');
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
Use [colchetes] apenas onde faltar informação que não está nos autos. Não invente fatos.

Cliente: ${client?.name || '[cliente]'}${client?.cpf_cnpj ? ', CPF/CNPJ ' + client.cpf_cnpj : ''}
Advogada subscritora: ${adv}
${blocoModelo}${contexto ? `\nDOCUMENTOS DO PROCESSO (contexto):\n${contexto}\n` : ''}
INTIMAÇÃO A RESPONDER:
${teor}`;
    const minuta = await aiComplete(minutaPrompt, 'gemini');
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
