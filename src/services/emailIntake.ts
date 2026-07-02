import { db } from '../config/database';
import { aiComplete } from './aiAssistant';
import { logTimeline } from './TimelineService';
import { ajustarEntradaParceria } from './partnerEntry';

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
/** "contra parte" = banco/instituição adversa. Cada contraparte distinta = um caso. */

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

/**
 * Chama a IA para transformar o e-mail (ASSUNTO + CORPO) em cliente + casos.
 * Análise minuciosa: pode haver mais de um caso com CONTRAPARTES diferentes
 * (bancos/instituições distintas), e a informação pode estar no assunto e/ou
 * no corpo. Cada contraparte/produto distinto vira um caso separado.
 */
export async function parseEmail(subject: string | null, rawText: string): Promise<ParsedIntake | null> {
  const teor = (rawText || '').trim();
  const assunto = (subject || '').trim();
  if (!teor && !assunto) return null;
  const prompt = `Você é um assistente de um escritório de advocacia, minucioso na leitura. Um parceiro INDICA clientes por e-mail. Extraia os dados para cadastro lendo o ASSUNTO e o CORPO — informações importantes (nome do cliente, bancos, produtos) podem estar em qualquer um dos dois.

REGRA CRÍTICA — separe por CONTRAPARTE: se houver mais de um banco/instituição adversa OU mais de um produto (ex.: RCC, RMC, empréstimo pessoal, cartão consignado), gere UM CASO PARA CADA. Ex.: "Cartões Consignados Banco PAN (RCC) e Agibank (RMC) — Maria Benedita" = 2 casos: (1) consumidor, banco "Banco PAN", tipo "RCC"; (2) consumidor, banco "Agibank", tipo "RMC". Não junte contrapartes diferentes no mesmo caso.

Responda SOMENTE com JSON válido, sem comentários, neste formato exato:
{"cliente":{"nome":"","cpf":"","email":"","telefone":""},"casos":[{"area":"","banco":"","tipo":"","descricao":""}]}

Regras:
- "area" deve ser uma destas: ${AREAS.join(', ')}. Cobrança/banco/cartão/empréstimo = "consumidor". Se não souber, use "outro".
- "banco": a instituição adversa (contraparte) daquele caso. "tipo": o produto/natureza (ex.: "RCC", "RMC", "empréstimo pessoal", "cartão consignado", "revisional"). "descricao": 1 frase resumindo o caso.
- Não invente dados. Campos desconhecidos ficam vazios. O nome do cliente costuma vir após um travessão no assunto ou identificado no corpo.

ASSUNTO: ${assunto || '(vazio)'}

CORPO:
${teor || '(vazio)'}`;
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


/**
 * Registra uma importação PENDENTE (não cria cliente/casos ainda).
 * Idempotente por source_message_id (não duplica o mesmo e-mail).
 */
export async function enqueueIntake(opts: {
  rawText: string; source?: string; sourceMessageId?: string | null;
  fromEmail?: string | null; subject?: string | null; partnerId?: number | null; createdBy?: number | null;
  attachments?: any[] | null;
}): Promise<{ id: number; parsed: ParsedIntake | null; duplicated?: boolean }> {
  if (opts.sourceMessageId) {
    const [[exists]] = await db.query('SELECT id FROM email_imports WHERE source_message_id = ?', [opts.sourceMessageId]) as any;
    if (exists) return { id: exists.id, parsed: null, duplicated: true };
  }
  const parsed = await parseEmail(opts.subject || null, opts.rawText);
  const partner = await resolvePartner(opts.partnerId);
  const atts = opts.attachments && opts.attachments.length ? JSON.stringify(opts.attachments) : null;
  const [r] = await db.query(
    `INSERT INTO email_imports (source, source_message_id, from_email, subject, raw_text, parsed_json, attachments_json, partner_id, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendente', ?)`,
    [opts.source || 'manual', opts.sourceMessageId || null, opts.fromEmail || null, opts.subject || null,
     opts.rawText, parsed ? JSON.stringify(parsed) : null, atts, partner?.id || null, opts.createdBy || null]
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

  // Entrada da parceria (100% do escritório) — POR CLIENTE: 1 caso = R$100,
  // 2+ casos = R$130 total. Lança só a diferença que faltar. Venc. +7 dias.
  let entrada = 0;
  if (novos > 0 && partner) {
    entrada = await ajustarEntradaParceria(clientId, partner, caseIds[0] ?? null, actorId);
  }

  await db.query("UPDATE email_imports SET status = 'confirmado', client_id = ?, confirmed_at = NOW() WHERE id = ?", [clientId, id]);
  await logTimeline({
    clientId, caseId: caseIds[0] ?? null, eventType: 'parceria_importada',
    description: `Importado do e-mail (${partner?.name || 'parceria'}) — ${parsed.casos.length} caso(s)${entrada ? ` · entrada R$ ${entrada.toFixed(2)}` : ''}.`,
    userId: actorId,
  });
  return { clientId, caseIds, entrada };
}
