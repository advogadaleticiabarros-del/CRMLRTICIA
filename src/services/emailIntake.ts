import { db } from '../config/database';
import { aiComplete } from './aiAssistant';
import { logTimeline } from './TimelineService';

/**
 * Importação de clientes/casos a partir do e-mail do parceiro (Infinity Law).
 * A IA (Groq — leitura/triagem) lê o corpo do e-mail e devolve UM cliente com
 * UM OU MAIS casos (ex.: Maria Benedita com 2 demandas de consumidor: um
 * empréstimo pessoal e outro RCC/RMC, de bancos diferentes). Fica na fila
 * (email_imports) como PENDENTE para revisão humana antes de criar de fato.
 */

const AREAS = ['trabalhista', 'gestante', 'familia', 'civel', 'previdenciario', 'consumidor', 'outro'];

export interface ParsedCase { area: string; banco?: string; tipo?: string; descricao?: string; }
export interface ParsedIntake {
  cliente: { nome: string; cpf?: string; email?: string; telefone?: string };
  casos: ParsedCase[];
}

/** Extrai o primeiro bloco JSON de um texto (a IA às vezes embrulha em ```json). */
function extractJson(text: string): any {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

/** Chama a IA para transformar o corpo do e-mail em estrutura cliente+casos. */
export async function parseEmailBody(rawText: string): Promise<ParsedIntake | null> {
  const teor = (rawText || '').trim();
  if (!teor) return null;
  const prompt = `Você é um assistente de um escritório de advocacia. Leia o e-mail abaixo, enviado por um parceiro que INDICA clientes, e extraia os dados para cadastro. O e-mail pode conter MAIS DE UM CASO do MESMO cliente (ex.: dois processos de consumidor, um de "empréstimo pessoal" e outro de "RCC e RMC", de bancos diferentes) — nesse caso devolva um caso para cada demanda.

Responda SOMENTE com JSON válido, sem comentários, neste formato exato:
{"cliente":{"nome":"","cpf":"","email":"","telefone":""},"casos":[{"area":"","banco":"","tipo":"","descricao":""}]}

Regras:
- "area" deve ser uma destas: ${AREAS.join(', ')}. Se não souber, use "outro".
- "banco": nome do banco/instituição, se citado. "tipo": a natureza da demanda (ex.: "empréstimo pessoal", "RCC e RMC", "revisional"). "descricao": 1 frase resumindo o caso.
- Não invente dados que não estão no e-mail. Campos desconhecidos ficam vazios.
- Se houver 2 demandas distintas, gere 2 objetos em "casos".

E-MAIL:
${teor}`;
  const r = await aiComplete(prompt, 'groq'); // leitura/triagem → Groq
  if (!r.ok || !r.text) return null;
  const j = extractJson(r.text);
  if (!j || !j.cliente || !j.cliente.nome) return null;
  const casos: ParsedCase[] = Array.isArray(j.casos) && j.casos.length ? j.casos : [{ area: 'outro' }];
  return {
    cliente: {
      nome: String(j.cliente.nome).trim(),
      cpf: j.cliente.cpf ? String(j.cliente.cpf).trim() : undefined,
      email: j.cliente.email ? String(j.cliente.email).trim() : undefined,
      telefone: j.cliente.telefone ? String(j.cliente.telefone).trim() : undefined,
    },
    casos: casos.map((c) => ({
      area: AREAS.includes(String(c.area)) ? String(c.area) : 'outro',
      banco: c.banco ? String(c.banco).trim() : undefined,
      tipo: c.tipo ? String(c.tipo).trim() : undefined,
      descricao: c.descricao ? String(c.descricao).trim() : undefined,
    })),
  };
}

/** Título distinto por demanda: "Tipo — Banco" (evita casos genéricos iguais). */
export function tituloCaso(nome: string, c: ParsedCase): string {
  const partes = [c.tipo, c.banco].filter(Boolean).join(' — ');
  return partes ? `${nome} · ${partes}` : nome;
}

/** Acha o parceiro Infinity (ou o primeiro cadastrado) para vincular a entrada. */
async function resolvePartner(partnerId?: number | null): Promise<any> {
  if (partnerId) {
    const [[p]] = await db.query('SELECT * FROM partners WHERE id = ?', [partnerId]) as any;
    if (p) return p;
  }
  const [[inf]] = await db.query("SELECT * FROM partners WHERE LOWER(name) LIKE '%infinity%' ORDER BY active DESC, id LIMIT 1") as any;
  if (inf) return inf;
  const [[any]] = await db.query('SELECT * FROM partners ORDER BY active DESC, id LIMIT 1') as any;
  return any || null;
}

function entradaValor(p: any, n: number): number {
  const single = Number(p?.entry_value_single) || 100;
  const double = Number(p?.entry_value_double) || 130;
  if (n <= 1) return single;
  if (n === 2) return double;
  return double + (n - 2) * single;
}

/**
 * Registra uma importação PENDENTE (não cria cliente/casos ainda).
 * Idempotente por source_message_id (não duplica o mesmo e-mail).
 */
export async function enqueueIntake(opts: {
  rawText: string; source?: string; sourceMessageId?: string | null;
  fromEmail?: string | null; subject?: string | null; partnerId?: number | null; createdBy?: number | null;
}): Promise<{ id: number; parsed: ParsedIntake | null; duplicated?: boolean }> {
  if (opts.sourceMessageId) {
    const [[exists]] = await db.query('SELECT id FROM email_imports WHERE source_message_id = ?', [opts.sourceMessageId]) as any;
    if (exists) return { id: exists.id, parsed: null, duplicated: true };
  }
  const parsed = await parseEmailBody(opts.rawText);
  const partner = await resolvePartner(opts.partnerId);
  const [r] = await db.query(
    `INSERT INTO email_imports (source, source_message_id, from_email, subject, raw_text, parsed_json, partner_id, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pendente', ?)`,
    [opts.source || 'manual', opts.sourceMessageId || null, opts.fromEmail || null, opts.subject || null,
     opts.rawText, parsed ? JSON.stringify(parsed) : null, partner?.id || null, opts.createdBy || null]
  ) as any;
  return { id: r.insertId, parsed };
}

/**
 * Confirma uma importação: cria (ou reaproveita) o cliente e cria os casos na
 * esteira de produção, com a entrada da parceria. Anti-duplicação: cliente por
 * CPF/nome; cada caso por assinatura (cliente + título). Reaproveita a lógica
 * da parceria (entrada 100% do escritório).
 */
export async function confirmIntake(id: number, actorId: number, override?: ParsedIntake): Promise<{ clientId: number; caseIds: number[]; entrada: number }> {
  const [[imp]] = await db.query('SELECT * FROM email_imports WHERE id = ?', [id]) as any;
  if (!imp) throw new Error('Importação não encontrada');
  if (imp.status === 'confirmado' && imp.client_id) {
    const [rows] = await db.query('SELECT id FROM cases WHERE client_id = ?', [imp.client_id]) as any;
    return { clientId: imp.client_id, caseIds: rows.map((x: any) => x.id), entrada: 0 };
  }
  const parsed: ParsedIntake = override
    || (imp.parsed_json ? (typeof imp.parsed_json === 'string' ? JSON.parse(imp.parsed_json) : imp.parsed_json) : null);
  if (!parsed || !parsed.cliente?.nome) throw new Error('Sem dados estruturados para confirmar. Edite e tente novamente.');

  const partner = await resolvePartner(imp.partner_id);
  const nome = parsed.cliente.nome.trim();

  // Cliente — dedup por CPF (se houver) ou por nome.
  let clientId: number;
  let found: any[] = [];
  if (parsed.cliente.cpf) {
    [found] = await db.query('SELECT id FROM clients WHERE cpf_cnpj = ? LIMIT 1', [parsed.cliente.cpf]) as any;
  }
  if (!found.length) {
    [found] = await db.query('SELECT id FROM clients WHERE LOWER(name) = LOWER(?) LIMIT 1', [nome]) as any;
  }
  if (found.length) {
    clientId = found[0].id;
    await db.query(
      'UPDATE clients SET cpf_cnpj = COALESCE(cpf_cnpj, ?), email = COALESCE(email, ?), phone = COALESCE(phone, ?) WHERE id = ?',
      [parsed.cliente.cpf || null, parsed.cliente.email || null, parsed.cliente.telefone || null, clientId]
    );
  } else {
    const [ins] = await db.query(
      "INSERT INTO clients (name, tipo, cpf_cnpj, email, phone, status, notes, created_by) VALUES (?, 'PF', ?, ?, ?, 'ativo', ?, ?)",
      [nome, parsed.cliente.cpf || null, parsed.cliente.email || null, parsed.cliente.telefone || null,
       `Cliente indicado pela parceria ${partner?.name || ''} (importado do e-mail).`, actorId]
    ) as any;
    clientId = ins.insertId;
  }

  // Casos — um por demanda, título distinto, anti-duplicação por título.
  const labels = JSON.stringify([`Parceria: ${partner?.name || 'Parceiro'}`]);
  const caseIds: number[] = [];
  const areasSet = new Set<string>();
  let novos = 0;
  for (const c of parsed.casos) {
    const title = tituloCaso(nome, c);
    const [dup] = await db.query('SELECT id FROM cases WHERE client_id = ? AND title = ? LIMIT 1', [clientId, title]) as any;
    if (dup.length) { caseIds.push(dup[0].id); continue; }
    const desc = [c.descricao, c.banco ? `Banco: ${c.banco}` : null, c.tipo ? `Tipo: ${c.tipo}` : null].filter(Boolean).join(' · ') || null;
    const [cr] = await db.query(
      `INSERT INTO cases (user_id, client_id, partner_id, title, legal_area, status, production_stage, production_started_at, production_labels, description)
       VALUES (?, ?, ?, ?, ?, 'ativo', 'separacao_documentos', NOW(), ?, ?)`,
      [actorId, clientId, partner?.id || null, title, c.area, labels, desc]
    ) as any;
    caseIds.push(cr.insertId);
    areasSet.add(c.area);
    novos++;
  }

  // Etiqueta o cliente com as áreas dos casos.
  try {
    const [[cl]] = await db.query('SELECT areas FROM clients WHERE id = ?', [clientId]) as any;
    let arr: string[] = [];
    try { arr = cl?.areas ? (typeof cl.areas === 'string' ? JSON.parse(cl.areas) : cl.areas) : []; } catch {}
    if (!Array.isArray(arr)) arr = [];
    for (const a of areasSet) if (!arr.includes(a)) arr.push(a);
    await db.query('UPDATE clients SET areas = ? WHERE id = ?', [JSON.stringify(arr), clientId]);
  } catch { /* migration 046 pode não ter rodado */ }

  // Entrada da parceria (100% do escritório), vencimento 7 dias após o lançamento.
  let entrada = 0;
  if (novos > 0 && partner) {
    entrada = entradaValor(partner, parsed.casos.length);
    await db.query(
      `INSERT INTO financial_records (user_id, client_id, case_id, tipo, description, valor, status, due_date)
       VALUES (?, ?, ?, 'receita', ?, ?, 'pendente', DATE_ADD(CURDATE(), INTERVAL 7 DAY))`,
      [actorId, clientId, caseIds[0] ?? null,
       `Entrada parceria ${partner.name} — ${nome} (${parsed.casos.length} protocolo${parsed.casos.length > 1 ? 's' : ''})`, entrada]
    );
  }

  await db.query("UPDATE email_imports SET status = 'confirmado', client_id = ?, confirmed_at = NOW() WHERE id = ?", [clientId, id]);
  await logTimeline({
    clientId, caseId: caseIds[0] ?? null, eventType: 'parceria_importada',
    description: `Importado do e-mail (${partner?.name || 'parceria'}) — ${parsed.casos.length} caso(s)${entrada ? ` · entrada R$ ${entrada.toFixed(2)}` : ''}.`,
    userId: actorId,
  });
  return { clientId, caseIds, entrada };
}
