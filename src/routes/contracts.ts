import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { db } from '../config/database';
import { logTimeline } from '../services/TimelineService';
import { onContractSigned } from '../services/contractFlow';

const router = Router();

const AREAS = ['trabalhista', 'gestante', 'familia', 'civel', 'previdenciario', 'consumidor', 'outro'];
const STATUSES = ['rascunho', 'em_producao', 'finalizado', 'enviado_assinatura', 'assinado', 'cancelado'];

function buildProcuracao(clientName: string): string {
  return `PROCURAÇÃO AD JUDICIA ET EXTRA

OUTORGANTE: ${clientName || '[NOME DO CLIENTE]'}, [nacionalidade], [estado civil], [profissão], inscrito(a) no CPF sob nº [CPF], RG nº [RG], residente e domiciliado(a) em [ENDEREÇO].

OUTORGADA: Advocacia Letícia Barros, advogada inscrita na OAB/[UF] sob nº [Nº OAB], com escritório em [ENDEREÇO DO ESCRITÓRIO].

PODERES: Pelo presente instrumento, o(a) OUTORGANTE nomeia e constitui sua bastante procuradora a OUTORGADA, a quem confere os poderes da cláusula "ad judicia et extra", para o foro em geral, em qualquer Juízo, Instância ou Tribunal, podendo propor as ações competentes e defendê-lo(a) nas contrárias, seguindo umas e outras até final decisão, usando os recursos legais e acompanhando-os, conferindo ainda poderes especiais para confessar, desistir, transigir, firmar compromissos ou acordos, receber e dar quitação, agindo em conjunto ou separadamente, podendo ainda substabelecer esta a outrem, com ou sem reserva de iguais poderes.

[CIDADE], [DATA].


_______________________________________
${clientName || '[NOME DO CLIENTE]'}
OUTORGANTE`;
}

function buildDeclaracao(clientName: string): string {
  return `DECLARAÇÃO DE HIPOSSUFICIÊNCIA

Eu, ${clientName || '[NOME DO CLIENTE]'}, [nacionalidade], [estado civil], [profissão], inscrito(a) no CPF sob nº [CPF], RG nº [RG], residente e domiciliado(a) em [ENDEREÇO], DECLARO, sob as penas da lei, para fins de concessão dos benefícios da JUSTIÇA GRATUITA, nos termos do art. 98 e seguintes do Código de Processo Civil e da Lei nº 1.060/50, que não possuo condições de arcar com as custas, despesas processuais e honorários advocatícios sem prejuízo do sustento próprio e de minha família.

Por ser expressão da verdade, firmo a presente declaração.

[CIDADE], [DATA].


_______________________________________
${clientName || '[NOME DO CLIENTE]'}
DECLARANTE`;
}

// Objeto do contrato por área jurídica
const AREA_OBJECT: Record<string, string> = {
  trabalhista: 'a propositura e/ou acompanhamento de reclamação trabalhista, visando ao recebimento das verbas e direitos trabalhistas devidos ao CONTRATANTE.',
  gestante: 'a defesa dos direitos da gestante, incluindo estabilidade gravídica, licença-maternidade e reversão de demissão irregular.',
  familia: 'a atuação em demanda de direito de família (divórcio, guarda, pensão alimentícia ou inventário), conforme a necessidade do CONTRATANTE.',
  civel: 'o patrocínio de ação cível, incluindo cobrança, reparação de danos e responsabilidade civil em favor do CONTRATANTE.',
  previdenciario: 'o requerimento administrativo e/ou judicial de benefício previdenciário junto ao INSS em favor do CONTRATANTE.',
  consumidor: 'a defesa dos direitos do consumidor, incluindo cobranças indevidas, vícios de produto/serviço e reparação de danos.',
  outro: 'a prestação de serviços advocatícios conforme objeto a ser detalhado entre as partes.',
};

function buildTemplate(opts: { clientName: string; area: string; value?: number }): string {
  const obj = AREA_OBJECT[opts.area] ?? AREA_OBJECT.outro;
  const valorStr = opts.value ? `R$ ${Number(opts.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '[VALOR DOS HONORÁRIOS]';
  return `CONTRATO DE PRESTAÇÃO DE SERVIÇOS ADVOCATÍCIOS

CONTRATANTE: ${opts.clientName || '[NOME DO CLIENTE]'}, [nacionalidade], [estado civil], [profissão], inscrito(a) no CPF sob nº [CPF], residente e domiciliado(a) em [ENDEREÇO].

CONTRATADA: Advocacia Letícia Barros, inscrita na OAB/[UF] sob nº [Nº OAB], com escritório em [ENDEREÇO DO ESCRITÓRIO].

CLÁUSULA 1ª — DO OBJETO
O presente contrato tem por objeto ${obj}

CLÁUSULA 2ª — DAS OBRIGAÇÕES DA CONTRATADA
A CONTRATADA obriga-se a empregar todo o zelo e diligência no patrocínio da causa, mantendo o CONTRATANTE informado sobre o andamento.

CLÁUSULA 3ª — DOS HONORÁRIOS
Pelos serviços, o CONTRATANTE pagará à CONTRATADA o valor de ${valorStr}, na forma e condições ajustadas: [FORMA DE PAGAMENTO / PARCELAS].
Os honorários de sucumbência, quando houver, pertencem à CONTRATADA.

CLÁUSULA 4ª — DA VIGÊNCIA E RESCISÃO
O presente contrato vigora até o trânsito em julgado da demanda, podendo ser rescindido nos termos da legislação aplicável e do Estatuto da OAB.

CLÁUSULA 5ª — DO FORO
Fica eleito o foro da Comarca de [COMARCA] para dirimir quaisquer questões oriundas deste contrato.

[CIDADE], [DATA].


_______________________________        _______________________________
        CONTRATANTE                              CONTRATADA

⚠️ Minuta para revisão e complementação antes da assinatura.`;
}

// ── GET /api/contracts ──────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const status = req.query.status as string;
  const where: string[] = ['ct.user_id = ?'];
  const params: any[] = [req.user!.id];
  if (status && STATUSES.includes(status)) { where.push('ct.status = ?'); params.push(status); }

  const [rows] = await db.query(
    `SELECT ct.id, ct.title, ct.area, ct.value, ct.status, ct.created_at, c.name AS client_name
     FROM contracts ct LEFT JOIN clients c ON c.id = ct.client_id
     WHERE ${where.join(' AND ')} ORDER BY ct.created_at DESC`,
    params
  ) as any;
  res.json(rows);
});

// ── GET /api/contracts/:id ──────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT ct.*, c.name AS client_name FROM contracts ct
     LEFT JOIN clients c ON c.id = ct.client_id WHERE ct.id = ? AND ct.user_id = ?`,
    [req.params.id, req.user!.id]
  ) as any;
  if (!rows.length) { res.status(404).json({ error: 'Contrato não encontrado' }); return; }
  res.json(rows[0]);
});

// ── POST /api/contracts/from-lead/:leadId — fecha o lead e gera o contrato ──
router.post('/from-lead/:leadId', async (req: Request, res: Response) => {
  const { leadId } = req.params;
  const [leads] = await db.query('SELECT * FROM leads WHERE id = ? AND user_id = ?', [leadId, req.user!.id]) as any;
  if (!leads.length) { res.status(404).json({ error: 'Lead não encontrado' }); return; }
  const lead = leads[0];

  // já existe contrato para este lead?
  const [existing] = await db.query('SELECT id FROM contracts WHERE lead_id = ?', [leadId]) as any;
  if (existing.length) {
    await db.query("UPDATE leads SET status = 'fechada', analise_since = NULL WHERE id = ?", [leadId]);
    res.status(200).json({ id: existing[0].id, alreadyExisted: true });
    return;
  }

  const area = AREAS.includes(lead.legal_area) ? lead.legal_area : 'outro';
  const content = buildTemplate({ clientName: lead.name, area, value: req.body.value });

  const [result] = await db.query(
    `INSERT INTO contracts (user_id, client_id, lead_id, area, title, content, procuracao_content, declaracao_content, value, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'rascunho')`,
    [req.user!.id, lead.client_id ?? null, leadId, area,
     `Contrato — ${lead.name}`, content, buildProcuracao(lead.name), buildDeclaracao(lead.name), req.body.value ?? null]
  ) as any;

  await db.query("UPDATE leads SET status = 'fechada', analise_since = NULL WHERE id = ?", [leadId]);

  if (lead.client_id) {
    await logTimeline({ clientId: lead.client_id, contractId: result.insertId, eventType: 'contrato_gerado',
      description: 'Contrato, procuração e declaração de hipossuficiência gerados.', userId: req.user!.id });
  }

  const [rows] = await db.query('SELECT * FROM contracts WHERE id = ?', [result.insertId]) as any;
  res.status(201).json(rows[0]);
});

// ── POST /api/contracts — criar manual (modelo por área) ────────────────────
router.post('/', async (req: Request, res: Response) => {
  const { client_id, title, area, value, content } = req.body;
  const finalArea = AREAS.includes(area) ? area : 'outro';

  let clientName = '';
  if (client_id) {
    const [c] = await db.query('SELECT name FROM clients WHERE id = ?', [client_id]) as any;
    clientName = c[0]?.name ?? '';
  }
  const finalContent = content || buildTemplate({ clientName, area: finalArea, value });

  const [result] = await db.query(
    `INSERT INTO contracts (user_id, client_id, area, title, content, procuracao_content, declaracao_content, value, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'rascunho')`,
    [req.user!.id, client_id ?? null, finalArea, title || `Contrato — ${clientName || finalArea}`,
     finalContent, buildProcuracao(clientName), buildDeclaracao(clientName), value ?? null]
  ) as any;
  const [rows] = await db.query('SELECT * FROM contracts WHERE id = ?', [result.insertId]) as any;
  res.status(201).json(rows[0]);
});

// ── PUT /api/contracts/:id — editar conteúdo/status ─────────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [existingRows] = await db.query('SELECT * FROM contracts WHERE id = ? AND user_id = ?', [id, req.user!.id]) as any;
  if (!existingRows.length) { res.status(404).json({ error: 'Contrato não encontrado' }); return; }
  const before = existingRows[0];

  const fields: string[] = [];
  const params: any[] = [];
  const setIf = (col: string, val: any, valid = true) => {
    if (val !== undefined && valid) { fields.push(`${col} = ?`); params.push(val); }
  };
  setIf('title', req.body.title);
  setIf('content', req.body.content);
  setIf('procuracao_content', req.body.procuracao_content);
  setIf('declaracao_content', req.body.declaracao_content);
  setIf('value', req.body.value !== undefined ? Number(req.body.value) : undefined);
  setIf('area', req.body.area, AREAS.includes(req.body.area));
  setIf('status', req.body.status, STATUSES.includes(req.body.status));

  if (!fields.length) { res.status(400).json({ error: 'Nenhum campo válido para atualizar' }); return; }
  params.push(id);
  await db.query(`UPDATE contracts SET ${fields.join(', ')} WHERE id = ?`, params);

  // Ao ASSINAR: cria o processo na esteira + gera honorários no financeiro (sem retrabalho)
  let createdCaseId: number | null = null;
  if (req.body.status === 'assinado' && before.status !== 'assinado' && before.client_id) {
    const r = await onContractSigned(Number(id), req.user!.id, req.user!.name);
    createdCaseId = r.caseId;
  } else if (req.body.status === 'enviado_assinatura' && before.status !== 'enviado_assinatura' && before.client_id) {
    await logTimeline({ clientId: before.client_id, contractId: Number(id),
      eventType: 'contrato_enviado', description: 'Contrato enviado para assinatura.', userId: req.user!.id });
  }

  const [rows] = await db.query('SELECT * FROM contracts WHERE id = ?', [id]) as any;
  res.json({ ...rows[0], created_case_id: createdCaseId });
});

// ── Assinatura eletrônica do contrato (link público) ────────────────────────
router.post('/:id/sign-request', async (req: Request, res: Response) => {
  const [[ct]] = await db.query('SELECT id, content FROM contracts WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]) as any;
  if (!ct) { res.status(404).json({ error: 'Contrato não encontrado' }); return; }
  const token = crypto.randomUUID();
  const code = crypto.randomBytes(5).toString('hex').toUpperCase();
  await db.query(
    `INSERT INTO signature_requests (contract_id, token, verification_code, signer_name, signer_cpf, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [req.params.id, token, code, req.body?.signer_name ?? null, req.body?.signer_cpf ?? null, req.user!.id]
  );
  // marca o contrato como enviado para assinatura
  await db.query("UPDATE contracts SET status = 'enviado_assinatura' WHERE id = ? AND status <> 'assinado'", [req.params.id]);
  res.status(201).json({ token, verification_code: code, path: `/assinar.html?token=${token}` });
});

router.get('/:id/signatures', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT id, token, verification_code, signer_name, status, signed_at FROM signature_requests
      WHERE contract_id = ? ORDER BY created_at DESC`, [req.params.id]
  ) as any;
  res.json(rows);
});

export default router;
