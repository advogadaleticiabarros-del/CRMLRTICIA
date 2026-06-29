import { db } from '../config/database';

/**
 * Cliente de IA compartilhado (grátis se houver chave Gemini/Groq).
 * Reusado pelo módulo de IA Jurídica (rota) e pelo "estagiário" automático
 * do monitoramento. Sem chave configurada, devolve { ok:false } e o fluxo
 * manual (colar resposta) continua valendo.
 */
export async function aiComplete(prompt: string): Promise<{ ok: boolean; text?: string; message?: string }> {
  const gemini = process.env.GEMINI_API_KEY;
  const groq = process.env.GROQ_API_KEY;
  try {
    if (gemini) {
      const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${gemini}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      });
      const d: any = await r.json();
      if (!r.ok) return { ok: false, message: d?.error?.message || 'Erro Gemini' };
      const text = d?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
      return { ok: true, text };
    }
    if (groq) {
      const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groq}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
      });
      const d: any = await r.json();
      if (!r.ok) return { ok: false, message: d?.error?.message || 'Erro Groq' };
      return { ok: true, text: d?.choices?.[0]?.message?.content || '' };
    }
    return { ok: false, message: 'sem_chave' };
  } catch (e: any) {
    return { ok: false, message: e.message };
  }
}

/** Há provedor de IA configurado? (define se o estagiário roda automaticamente) */
export function aiConfigured(): boolean {
  return !!(process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY);
}

/**
 * Estagiário IA: para um prazo detectado a partir de intimação DJEN, gera
 * automaticamente (1) uma análise/triagem salva no próprio prazo (ai_summary)
 * e (2) uma minuta da peça salva como documento de IA (ai_draft_id).
 * Best-effort: qualquer falha é silenciosa e nunca derruba o monitoramento.
 */
export async function runEstagiarioForDeadline(opts: {
  detectedDeadlineId: number;
  clientId: number | null;
  caseId?: number | null;
  movementText: string;
  suggestedType: string;
  suggestedDays: number;
}): Promise<void> {
  if (!aiConfigured()) return;
  const { detectedDeadlineId, clientId, movementText, suggestedType, suggestedDays } = opts;
  const teor = (movementText || '').trim();
  if (!teor) return;

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

    // 1) Análise / triagem (fica no próprio prazo)
    const analisePrompt = `Você é assistente jurídico(a) experiente. Leia a intimação/decisão abaixo e responda em tópicos curtos e objetivos, sem inventar nada fora do texto:
1) RESUMO em 2-4 linhas, em linguagem simples.
2) PRAZO: o tipo provável é "${suggestedType}" (${suggestedDays} dias úteis) — confirme se faz sentido ou sugira o correto.
3) PRÓXIMA AÇÃO recomendada.
4) RISCO/ATENÇÃO: pontos críticos.

INTIMAÇÃO:
${teor}`;
    const analise = await aiComplete(analisePrompt);
    if (analise.ok && analise.text) {
      await db.query('UPDATE detected_deadlines SET ai_summary = ? WHERE id = ?', [analise.text, detectedDeadlineId]);
    }

    // 2) Minuta da peça (vira documento de IA)
    const minutaPrompt = `Você é advogado(a) brasileiro(a). Redija a MINUTA de ${suggestedType} em resposta à intimação abaixo: português jurídico formal, fundamentada (com base legal pertinente), pronta para revisão e protocolo. Use [colchetes] onde faltar informação.

Cliente: ${client?.name || '[cliente]'}${client?.cpf_cnpj ? ', CPF/CNPJ ' + client.cpf_cnpj : ''}
Advogada subscritora: ${adv}

INTIMAÇÃO:
${teor}`;
    const minuta = await aiComplete(minutaPrompt);
    if (minuta.ok && minuta.text) {
      const [[admin]] = await db.query(
        "SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1"
      ) as any;
      if (admin?.id) {
        const title = `Minuta automática — ${suggestedType}${client?.name ? ' — ' + client.name : ''}`;
        const [r] = await db.query(
          `INSERT INTO ai_generations (user_id, type, title, prompt, result, status, client_id, case_id)
           VALUES (?, 'minuta_auto', ?, ?, ?, 'completed', ?, ?)`,
          [admin.id, title, minutaPrompt, minuta.text, clientId ?? null, opts.caseId ?? null]
        ) as any;
        await db.query('UPDATE detected_deadlines SET ai_draft_id = ? WHERE id = ?', [r.insertId, detectedDeadlineId]);
      }
    }
  } catch { /* estagiário é best-effort */ }
}
