import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { cpfCnpjValido } from '../utils/cpfCnpj';
import { nomesParecidos } from '../utils/nomeSimilar';

const router = Router();

const TIPOS = ['PF', 'PJ'];
const STATUSES = ['ativo', 'inativo', 'prospecto'];

// ── GET /api/clients/conflito — checagem de conflito de interesses ──────────
// Antes de cadastrar alguém, procura o nome/CPF em: clientes, leads, títulos e
// descrições de casos (partes contrárias costumam aparecer ali) e assistidos
// de demandas dativas. Aviso, não trava — a decisão é da advogada.
router.get('/conflito', async (req: Request, res: Response) => {
  const nome = String(req.query.nome || '').trim();
  const cpf = String(req.query.cpf || '').replace(/\D/g, '');
  if (nome.length < 4 && cpf.length < 11) { res.json({ achados: [] }); return; }

  const achados: { tipo: string; nome: string; detalhe: string }[] = [];
  const like = `%${nome}%`;

  if (nome.length >= 4 || cpf.length >= 11) {
    const [cli] = await db.query(
      `SELECT id, name, cpf_cnpj, status FROM clients
        WHERE ${nome.length >= 4 ? 'name LIKE ?' : '1=0'} ${cpf.length >= 11 ? "OR REPLACE(REPLACE(REPLACE(COALESCE(cpf_cnpj,''),'.',''),'-',''),'/','') = ?" : ''}
        LIMIT 10`,
      [...(nome.length >= 4 ? [like] : []), ...(cpf.length >= 11 ? [cpf] : [])]
    ) as any;
    const idsCli = new Set(cli.map((r: any) => r.id));
    for (const r of cli) achados.push({ tipo: 'cliente', nome: r.name, detalhe: `já é cliente (${r.status})${r.cpf_cnpj ? ' · ' + r.cpf_cnpj : ''}` });

    // Grafia parecida (achado da auditoria do módulo Clientes, 23/09/2026): a
    // busca acima é substring exato — não pega "Ricrado" pra quem digitou
    // "Ricardo". Busca candidatos que começam com a mesma letra e filtra por
    // distância de edição (nomesParecidos), sem duplicar quem já entrou pela
    // busca exata. Não resolve apelido nem nome de solteira/casada — isso
    // exigiria um dicionário de sinônimos, fora de escopo aqui.
    if (nome.length >= 4) {
      const [candidatosCli] = await db.query(
        'SELECT id, name, cpf_cnpj, status FROM clients WHERE name LIKE ? LIMIT 50', [`${nome[0]}%`]
      ) as any;
      for (const r of candidatosCli) {
        if (idsCli.has(r.id) || !nomesParecidos(nome, r.name)) continue;
        idsCli.add(r.id);
        achados.push({ tipo: 'cliente', nome: r.name, detalhe: `já é cliente (${r.status})${r.cpf_cnpj ? ' · ' + r.cpf_cnpj : ''} — grafia parecida` });
      }
    }

    const [lds] = await db.query(
      `SELECT id, name, stage FROM leads WHERE ${nome.length >= 4 ? 'name LIKE ?' : '1=0'} LIMIT 10`,
      nome.length >= 4 ? [like] : []
    ).catch(() => [[]]) as any;
    const idsLead = new Set(lds.map((r: any) => r.id));
    for (const r of lds) achados.push({ tipo: 'lead', nome: r.name, detalhe: `lead no funil (${r.stage || '—'})` });

    if (nome.length >= 4) {
      const [candidatosLead] = await db.query(
        'SELECT id, name, stage FROM leads WHERE name LIKE ? LIMIT 50', [`${nome[0]}%`]
      ).catch(() => [[]]) as any;
      for (const r of candidatosLead) {
        if (idsLead.has(r.id) || !nomesParecidos(nome, r.name)) continue;
        idsLead.add(r.id);
        achados.push({ tipo: 'lead', nome: r.name, detalhe: `lead no funil (${r.stage || '—'}) — grafia parecida` });
      }
    }
  }

  if (nome.length >= 4) {
    const [cs] = await db.query(
      `SELECT c.id, c.title, cl.name AS client_name FROM cases c
        LEFT JOIN clients cl ON cl.id = c.client_id
        WHERE c.title LIKE ? OR c.description LIKE ? LIMIT 10`, [like, like]
    ) as any;
    for (const r of cs) achados.push({ tipo: 'caso', nome: r.title, detalhe: `citado em caso de ${r.client_name || 'cliente'} — possível parte contrária` });

    const [dat] = await db.query(
      `SELECT id, assisted_name, comarca FROM dative_cases WHERE assisted_name LIKE ? LIMIT 10`, [like]
    ).catch(() => [[]]) as any;
    for (const r of dat) achados.push({ tipo: 'dativo', nome: r.assisted_name, detalhe: `assistido em demanda dativa (${r.comarca})` });
  }

  res.json({ achados });
});

// ── GET /api/clients — lista com busca e paginação ──────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const search = (req.query.search as string)?.trim();
  const status = req.query.status as string;
  const tipo   = req.query.tipo as string;
  const from   = req.query.from as string;
  const to     = req.query.to as string;
  const page   = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset = (page - 1) * limit;

  const where: string[] = [];
  const params: any[] = [];

  if (search) {
    where.push('(name LIKE ? OR cpf_cnpj LIKE ? OR email LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (status && STATUSES.includes(status)) { where.push('status = ?'); params.push(status); }
  if (tipo && TIPOS.includes(tipo))        { where.push('tipo = ?');   params.push(tipo); }
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { where.push('created_at >= ?'); params.push(from); }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to))     { where.push('created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(to); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM clients ${whereSql}`,
    params
  ) as any;

  const [rows] = await db.query(
    `SELECT id, name, tipo, cpf_cnpj, email, phone, status, is_dative, areas, created_at,
            (SELECT COUNT(*) FROM legal_processes lp
              WHERE lp.client_id = clients.id AND lp.last_movement_at >= (NOW() - INTERVAL 30 DAY)) AS movs_recentes
     FROM clients ${whereSql}
     ORDER BY (SELECT MAX(lp.last_movement_at) FROM legal_processes lp WHERE lp.client_id = clients.id) DESC, name ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ) as any;

  res.json({ data: rows, total, page, limit, pages: Math.ceil(total / limit) });
});

// ── GET /api/clients/:id — detalhe com resumo ───────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  const [rows] = await db.query('SELECT * FROM clients WHERE id = ?', [id]) as any;
  if (!rows.length) {
    res.status(404).json({ error: 'Cliente não encontrado' });
    return;
  }

  // LGPD: registra o acesso à ficha do cliente (best-effort, não bloqueia)
  import('../services/accessLog')
    .then(({ logAccess }) => logAccess({ userId: req.user!.id, userName: req.user!.name, clientId: Number(id), action: 'ficha_cliente', ip: req.ip }))
    .catch(() => {});

  const [[resumo]] = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM cases WHERE client_id = ? AND status = 'ativo')           AS processos_ativos,
      (SELECT COUNT(*) FROM propostas WHERE client_id = ? AND status IN ('enviada','em_negociacao')) AS propostas_abertas,
      (SELECT COALESCE(SUM(valor),0) FROM installments WHERE client_id = ? AND status = 'pendente')  AS a_receber
  `, [id, id, id]) as any;

  res.json({ ...rows[0], resumo });
});

// ── GET /api/clients/:id/timeline — histórico do cliente (ficha) ────────────
router.get('/:id/timeline', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT t.event_type, t.description, t.created_at, u.name AS by_name,
            c.case_number, c.title AS case_title
     FROM client_timeline t
     LEFT JOIN users u ON u.id = t.created_by
     LEFT JOIN cases c ON c.id = t.case_id
     WHERE t.client_id = ? ORDER BY t.created_at DESC LIMIT 100`,
    [req.params.id]
  ) as any;
  res.json(rows);
});

// ── GET /api/clients/:id/ficha — ficha completa do cliente (consolidada) ────
router.get('/:id/ficha', async (req: Request, res: Response) => {
  const id = req.params.id;
  const [[c]] = await db.query('SELECT * FROM clients WHERE id = ?', [id]) as any;
  if (!c) { res.status(404).json({ error: 'Cliente não encontrado' }); return; }

  // LGPD: registra o acesso (best-effort, não bloqueia) — mesmo padrão de
  // GET /:id. Achado da auditoria do módulo Clientes (23/09/2026): o
  // frontend abre o cliente por AQUI (/ficha), não por GET /:id — só a rota
  // simples gerava log, então o dado mais sensível (CPF, endereço,
  // financeiro, documentos) não tinha nenhuma trilha de auditoria.
  import('../services/accessLog')
    .then(({ logAccess }) => logAccess({ userId: req.user!.id, userName: req.user!.name, clientId: Number(id), action: 'ficha_cliente', ip: req.ip }))
    .catch(() => {});

  const [[lead]] = await db.query(
    'SELECT rg, marital_status, profession, case_summary FROM leads WHERE client_id = ? ORDER BY created_at DESC LIMIT 1', [id]
  ) as any;

  const qualificacao = [
    c.name, 'brasileiro(a)', lead?.marital_status || '', lead?.profession || '',
    lead?.rg ? `portador(a) do RG nº ${lead.rg}` : '',
    c.cpf_cnpj ? `inscrito(a) no CPF nº ${c.cpf_cnpj}` : '',
    c.address ? `residente e domiciliado(a) em ${c.address}` : '',
    c.email ? `e-mail: ${c.email}` : '',
  ].filter((x) => x && String(x).trim()).join(', ');

  const q = async (sql: string) => { try { const [r] = await db.query(sql, [id]) as any; return r; } catch { return []; } };
  const [cases, installments, receitas, documents, timeline] = await Promise.all([
    q('SELECT id, title, case_number, legal_area, phase, status, production_stage, production_started_at FROM cases WHERE client_id = ? ORDER BY created_at DESC'),
    q('SELECT numero, valor, due_date, status FROM installments WHERE client_id = ? ORDER BY due_date ASC'),
    q("SELECT description, valor, tipo, status, due_date FROM financial_records WHERE client_id = ? AND tipo = 'receita' ORDER BY due_date ASC"),
    q("SELECT name, type, folder, status, created_at FROM documents WHERE client_id = ? ORDER BY created_at DESC"),
    q('SELECT description, created_at FROM client_timeline WHERE client_id = ? ORDER BY created_at DESC LIMIT 100'),
  ]);

  let a_receber = 0, pago = 0;
  for (const i of installments as any[]) { const v = Number(i.valor) || 0; if (i.status === 'pago') pago += v; else if (['pendente', 'vencido'].includes(i.status)) a_receber += v; }
  for (const r of receitas as any[]) { const v = Number(r.valor) || 0; if (r.status === 'pago') pago += v; else if (['pendente', 'vencido'].includes(r.status)) a_receber += v; }

  res.json({
    client: { id: c.id, name: c.name, tipo: c.tipo, cpf_cnpj: c.cpf_cnpj, email: c.email, phone: c.phone, address: c.address, status: c.status, notes: c.notes, areas: c.areas },
    header: { qualificacao }, case_summary: lead?.case_summary || '',
    cases, installments, receitas, documents, timeline, financeiro: { a_receber, pago },
  });
});

// ── GET /api/clients/:id/exportar-lgpd — portabilidade (LGPD art. 18) ───────
// Achado da auditoria do módulo Clientes (23/09/2026): a lei garante ao
// titular o direito de pedir tudo que o escritório guarda sobre ele — antes
// disso, atender esse pedido exigia consultar o banco direto. Reúne cadastro,
// processos, financeiro, metadados de documento (não o arquivo em si — fica
// no MEGA/GED) e histórico num pacote só, e baixa como arquivo (não fica só
// na tela). O próprio acesso à exportação também vira log de auditoria.
router.get('/:id/exportar-lgpd', async (req: Request, res: Response) => {
  const id = req.params.id;
  const [[c]] = await db.query('SELECT * FROM clients WHERE id = ?', [id]) as any;
  if (!c) { res.status(404).json({ error: 'Cliente não encontrado' }); return; }

  import('../services/accessLog')
    .then(({ logAccess }) => logAccess({ userId: req.user!.id, userName: req.user!.name, clientId: Number(id), action: 'exportacao_lgpd', ip: req.ip }))
    .catch(() => {});

  const [[lead]] = await db.query(
    'SELECT rg, marital_status, profession, case_summary, source FROM leads WHERE client_id = ? ORDER BY created_at DESC LIMIT 1', [id]
  ) as any;

  const q = async (sql: string) => { try { const [r] = await db.query(sql, [id]) as any; return r; } catch { return []; } };
  const [cases, installments, receitas, documents, timeline] = await Promise.all([
    q('SELECT title, case_number, legal_area, phase, status FROM cases WHERE client_id = ? ORDER BY created_at DESC'),
    q('SELECT numero, valor, due_date, status FROM installments WHERE client_id = ? ORDER BY due_date ASC'),
    q("SELECT description, valor, tipo, status, due_date FROM financial_records WHERE client_id = ? AND tipo = 'receita' ORDER BY due_date ASC"),
    q("SELECT name, type, folder, status, created_at FROM documents WHERE client_id = ? ORDER BY created_at DESC"),
    q('SELECT description, created_at FROM client_timeline WHERE client_id = ? ORDER BY created_at DESC LIMIT 500'),
  ]);

  const pacote = {
    exportado_em: new Date().toISOString(),
    finalidade: 'Portabilidade de dados pessoais — LGPD art. 18',
    titular: {
      nome: c.name, tipo: c.tipo, cpf_cnpj: c.cpf_cnpj, email: c.email, phone: c.phone,
      endereco: c.address, data_nascimento: c.birth_date, status: c.status,
      rg: lead?.rg || null, estado_civil: lead?.marital_status || null, profissao: lead?.profession || null,
      origem_do_relacionamento: lead?.source || null,
    },
    processos: cases,
    parcelas: installments,
    receitas,
    documentos: documents,
    historico: timeline,
  };

  const nomeArquivo = `dados-${c.name}-${id}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80) + '.json';
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
  res.send(JSON.stringify(pacote, null, 2));
});

// ── POST /api/clients — criar ───────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const { name, tipo, cpf_cnpj, email, phone, address, notes, status, birth_date, lgpd_consent } = req.body;

  if (!name || !String(name).trim()) {
    res.status(400).json({ error: 'O nome é obrigatório' });
    return;
  }

  // Achado da auditoria do módulo Clientes (23/09/2026): o campo aceitava
  // qualquer texto, sem checar o dígito verificador — dá pra digitar um
  // número que nem existe. Vazio continua permitido (campo opcional).
  if (!cpfCnpjValido(cpf_cnpj)) {
    res.status(400).json({ error: 'CPF/CNPJ inválido — confira os números digitados' });
    return;
  }

  const finalTipo   = TIPOS.includes(tipo) ? tipo : 'PF';
  const finalStatus = STATUSES.includes(status) ? status : 'ativo';

  // Achado da auditoria do módulo Clientes (23/09/2026): não havia registro
  // formal do consentimento do titular pro tratamento dos próprios dados —
  // só existia opt-in de newsletter pra lead. Campo opcional, marcado manual.
  const lgpdConsentAt = lgpd_consent ? new Date() : null;

  const [result] = await db.query(
    `INSERT INTO clients (name, tipo, cpf_cnpj, email, phone, address, notes, status, birth_date, lgpd_consent_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name.trim(), finalTipo, cpf_cnpj ?? null, email ?? null, phone ?? null,
     address ?? null, notes ?? null, finalStatus, birth_date || null, lgpdConsentAt, req.user!.id]
  ) as any;

  const [rows] = await db.query('SELECT * FROM clients WHERE id = ?', [result.insertId]) as any;
  res.status(201).json(rows[0]);
});

// ── PUT /api/clients/:id — atualizar ────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, tipo, cpf_cnpj, email, phone, address, notes, status, birth_date, lgpd_consent } = req.body;

  const [existing] = await db.query('SELECT id FROM clients WHERE id = ?', [id]) as any;
  if (!existing.length) {
    res.status(404).json({ error: 'Cliente não encontrado' });
    return;
  }

  if (name !== undefined && !String(name).trim()) {
    res.status(400).json({ error: 'O nome não pode ser vazio' });
    return;
  }

  if (cpf_cnpj !== undefined && !cpfCnpjValido(cpf_cnpj)) {
    res.status(400).json({ error: 'CPF/CNPJ inválido — confira os números digitados' });
    return;
  }

  const fields: string[] = [];
  const params: any[] = [];
  const setIf = (col: string, val: any, valid = true) => {
    if (val !== undefined && valid) { fields.push(`${col} = ?`); params.push(val); }
  };

  setIf('name', name?.trim?.());
  setIf('tipo', tipo, TIPOS.includes(tipo));
  setIf('cpf_cnpj', cpf_cnpj);
  setIf('email', email);
  setIf('phone', phone);
  setIf('address', address);
  setIf('notes', notes);
  setIf('status', status, STATUSES.includes(status));
  setIf('birth_date', birth_date || null);
  // Marcar o consentimento nunca sobrescreve uma data já registrada
  // (COALESCE — a data de verdade é sempre a 1ª vez que foi dado);
  // desmarcar registra a revogação (NULL), direito do titular.
  if (lgpd_consent !== undefined) {
    fields.push(lgpd_consent ? 'lgpd_consent_at = COALESCE(lgpd_consent_at, NOW())' : 'lgpd_consent_at = NULL');
  }

  if (!fields.length) {
    res.status(400).json({ error: 'Nenhum campo válido para atualizar' });
    return;
  }

  params.push(id);
  await db.query(`UPDATE clients SET ${fields.join(', ')} WHERE id = ?`, params);

  const [rows] = await db.query('SELECT * FROM clients WHERE id = ?', [id]) as any;
  res.json(rows[0]);
});

// ── PATCH /api/clients/:id/status — ativar/inativar ─────────────────────────
router.patch('/:id/status', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!STATUSES.includes(status)) {
    res.status(400).json({ error: `status deve ser um de: ${STATUSES.join(', ')}` });
    return;
  }

  const [result] = await db.query('UPDATE clients SET status = ? WHERE id = ?', [status, id]) as any;
  if (!result.affectedRows) {
    res.status(404).json({ error: 'Cliente não encontrado' });
    return;
  }

  res.json({ success: true, id: Number(id), status });
});

export default router;
