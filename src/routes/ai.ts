import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { logActivity } from '../services/JourneyService';

const router = Router();

// ── Modelos de prompt (a IA recebe estes prompts prontos) ───────────────────
interface TemplateDef {
  type: string;
  label: string;
  fields: { name: string; label: string; type?: string }[];
  build: (ctx: { client: any; proc: any; lawyer: any; inputs: Record<string, string> }) => string;
}

const advogada = (l: any) => l ? `${l.name}, OAB ${l.oab_number || ''}${l.oab_uf ? '/' + l.oab_uf : ''}` : 'a advogada responsável';
const clienteLinha = (c: any) => c ? `${c.name}${c.cpf_cnpj ? ', CPF/CNPJ ' + c.cpf_cnpj : ''}${c.address ? ', residente em ' + c.address : ''}` : 'o(a) cliente';

const TEMPLATES: TemplateDef[] = [
  {
    type: 'peticao_inicial', label: 'Petição Inicial',
    fields: [
      { name: 'area', label: 'Área/competência' },
      { name: 'fatos', label: 'Fatos do caso', type: 'textarea' },
      { name: 'pedido', label: 'Pedido(s)', type: 'textarea' },
      { name: 'valor_causa', label: 'Valor da causa' },
    ],
    build: ({ client, lawyer, inputs }) => `Você é advogado(a) brasileiro(a) experiente. Redija uma PETIÇÃO INICIAL completa, técnica e fundamentada (com endereçamento, qualificação das partes, dos fatos, do direito com fundamentos legais e jurisprudência pertinente, dos pedidos, valor da causa e fecho).

Cliente (autor): ${clienteLinha(client)}
Advogada subscritora: ${advogada(lawyer)}
Área/competência: ${inputs.area || '—'}
Valor da causa: ${inputs.valor_causa || 'a estimar'}

FATOS:
${inputs.fatos || '—'}

PEDIDOS:
${inputs.pedido || '—'}

Escreva em português jurídico formal, pronta para protocolo. Use [colchetes] onde faltar informação.`,
  },
  {
    type: 'contestacao', label: 'Contestação',
    fields: [
      { name: 'resumo_acao', label: 'Resumo da ação/pedido do autor', type: 'textarea' },
      { name: 'teses', label: 'Teses de defesa (preliminares e mérito)', type: 'textarea' },
    ],
    build: ({ client, lawyer, inputs }) => `Você é advogado(a) brasileiro(a). Redija uma CONTESTAÇÃO completa e fundamentada (preliminares se cabíveis, mérito com impugnação específica dos fatos, fundamentos legais e jurisprudência, pedidos).

Cliente (réu): ${clienteLinha(client)}
Advogada subscritora: ${advogada(lawyer)}

RESUMO DA AÇÃO:
${inputs.resumo_acao || '—'}

TESES DE DEFESA A DESENVOLVER:
${inputs.teses || '—'}

Português jurídico formal, pronta para protocolo. Use [colchetes] onde faltar informação.`,
  },
  {
    type: 'resumo_intimacao', label: 'Resumo de intimação/decisão',
    fields: [{ name: 'texto', label: 'Cole o texto da intimação/decisão/publicação', type: 'textarea' }],
    build: ({ inputs }) => `Você é assistente jurídico(a). Leia a intimação/decisão abaixo e responda de forma objetiva:
1) RESUMO em 3-5 linhas (linguagem simples).
2) PRAZO: qual é, em quantos dias, e a data-limite estimada.
3) PRÓXIMA AÇÃO recomendada.
4) RISCO/ATENÇÃO: pontos críticos.

TEXTO:
${inputs.texto || '—'}`,
  },
  {
    type: 'parecer', label: 'Parecer jurídico',
    fields: [{ name: 'consulta', label: 'Consulta / pergunta jurídica', type: 'textarea' }],
    build: ({ client, lawyer, inputs }) => `Você é advogado(a) brasileiro(a). Elabore um PARECER JURÍDICO estruturado (ementa, relatório, fundamentação com base legal e jurisprudência, conclusão objetiva).

Consulente: ${clienteLinha(client)}
Subscritor(a): ${advogada(lawyer)}

CONSULTA:
${inputs.consulta || '—'}

Português jurídico formal.`,
  },
  {
    type: 'email_cobranca', label: 'E-mail/Mensagem de cobrança',
    fields: [
      { name: 'valor', label: 'Valor em aberto' },
      { name: 'vencimento', label: 'Vencimento' },
      { name: 'tom', label: 'Tom (cordial/firme)' },
    ],
    build: ({ client, lawyer, inputs }) => `Escreva uma mensagem de cobrança ${inputs.tom || 'cordial e profissional'} para o cliente, lembrando do valor em aberto, sem ser agressiva, oferecendo canais de negociação.

Cliente: ${client?.name || '[cliente]'}
Valor em aberto: ${inputs.valor || '[valor]'}
Vencimento: ${inputs.vencimento || '[data]'}
Escritório: ${advogada(lawyer)}

Tom respeitoso. Forneça uma versão curta (WhatsApp) e uma versão formal (e-mail).`,
  },
];

const findTpl = (t: string) => TEMPLATES.find((x) => x.type === t);

// ── Geração automática OPCIONAL (grátis se houver chave Gemini/Groq) ────────
async function autoGenerate(prompt: string): Promise<{ ok: boolean; text?: string; message?: string }> {
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

// ── GET /api/ai/templates ───────────────────────────────────────────────────
router.get('/templates', (_req: Request, res: Response) => {
  res.json(TEMPLATES.map((t) => ({ type: t.type, label: t.label, fields: t.fields })));
  });

// ── GET /api/ai — lista de gerações ─────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT g.id, g.type, g.title, g.status, g.created_at, c.name AS client_name
       FROM ai_generations g LEFT JOIN clients c ON c.id = g.client_id
      WHERE g.user_id = ? ORDER BY g.created_at DESC LIMIT 200`, [req.user!.id]
  ) as any;
  res.json(rows);
});

router.get('/config', (_req: Request, res: Response) => {
  res.json({ auto: !!(process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY) });
});

router.get('/:id', async (req: Request, res: Response) => {
  const [rows] = await db.query('SELECT * FROM ai_generations WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]) as any;
  if (!rows.length) { res.status(404).json({ error: 'Geração não encontrada' }); return; }
  res.json(rows[0]);
});

// ── POST /api/ai/generate — monta o prompt (e tenta auto se houver chave) ───
router.post('/generate', async (req: Request, res: Response) => {
  const { type, client_id, case_id, inputs } = req.body;
  const tpl = findTpl(type);
  if (!tpl) { res.status(400).json({ error: 'Tipo inválido' }); return; }

  let client: any = null, proc: any = null;
  if (client_id) { const [[c]] = await db.query('SELECT * FROM clients WHERE id = ?', [client_id]) as any; client = c; }
  if (case_id) { const [[p]] = await db.query('SELECT * FROM cases WHERE id = ?', [case_id]) as any; proc = p; }
  const [[lawyer]] = await db.query("SELECT name, oab_number, oab_uf FROM lawyers WHERE active = 1 ORDER BY id LIMIT 1") as any;

  const prompt = tpl.build({ client, proc, lawyer, inputs: inputs || {} });
  const title = `${tpl.label}${client ? ' — ' + client.name : ''}`;

  // Tenta geração automática (grátis) se houver chave configurada
  const auto = await autoGenerate(prompt);
  const result = auto.ok ? (auto.text || '') : '';
  const status = auto.ok ? 'completed' : 'pending';

  const [r] = await db.query(
    `INSERT INTO ai_generations (user_id, type, title, prompt, result, status, client_id, case_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user!.id, type, title, prompt, result, status, client_id ?? null, case_id ?? null]
  ) as any;

  res.status(201).json({ id: r.insertId, prompt, title, auto: auto.ok, result, auto_message: auto.ok ? null : auto.message });
});

// ── POST /api/ai/:id/result — salvar a resposta colada do ChatGPT/Claude ────
router.post('/:id/result', async (req: Request, res: Response) => {
  const { result } = req.body;
  if (!result || !String(result).trim()) { res.status(400).json({ error: 'Cole a resposta da IA' }); return; }
  const [[g]] = await db.query('SELECT type, title, client_id, case_id FROM ai_generations WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]) as any;
  if (!g) { res.status(404).json({ error: 'Geração não encontrada' }); return; }

  await db.query("UPDATE ai_generations SET result = ?, status = 'completed' WHERE id = ?", [result, req.params.id]);

  if (g.client_id) {
    await logActivity({ clientId: g.client_id, caseId: g.case_id, actorId: req.user!.id, actorName: req.user!.name,
      eventType: 'ia_gerada', title: 'Documento gerado por IA', description: g.title || g.type });
  }
  res.json({ success: true });
});

// ── POST /api/ai/:id/save-document — salva o resultado como documento GED ───
router.post('/:id/save-document', async (req: Request, res: Response) => {
  const [[g]] = await db.query('SELECT * FROM ai_generations WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]) as any;
  if (!g) { res.status(404).json({ error: 'Geração não encontrada' }); return; }
  if (!g.result) { res.status(400).json({ error: 'Sem conteúdo para salvar' }); return; }
  if (!g.client_id) { res.status(400).json({ error: 'Vincule a um cliente para salvar como documento' }); return; }
  const [r] = await db.query(
    `INSERT INTO documents (client_id, case_id, name, type, folder, content, status, created_by)
     VALUES (?, ?, ?, 'ia', 'processos', ?, 'pendente', ?)`,
    [g.client_id, g.case_id ?? null, g.title || 'Documento IA', g.result, req.user!.id]
  ) as any;
  res.status(201).json({ success: true, document_id: r.insertId });
});

router.delete('/:id', async (req: Request, res: Response) => {
  const [r] = await db.query('DELETE FROM ai_generations WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]) as any;
  if (!r.affectedRows) { res.status(404).json({ error: 'Geração não encontrada' }); return; }
  res.json({ success: true });
});

export default router;
