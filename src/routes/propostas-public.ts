import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { logActivity } from '../services/JourneyService';
import { notificationService } from '../services/NotificationService';
import { buildTemplate, buildProcuracao, buildDeclaracao, montarEndereco, formaPagamentoTexto, PartyData } from '../services/contractTemplates';
import { getEscritorio } from '../services/escritorio';
import { ensurePartnerLawyersColumn } from '../services/propostaSchema';

const router = Router();
const AREAS = ['trabalhista', 'gestante', 'familia', 'civel', 'previdenciario', 'consumidor', 'outro'];

// ── GET /api/public/proposta/:token — proposta para o cliente (sem login) ────
router.get('/proposta/:token', async (req: Request, res: Response) => {
  const hasPartnerColumn = await ensurePartnerLawyersColumn();
  const partnerSelect = hasPartnerColumn ? 'p.partner_lawyers' : 'NULL AS partner_lawyers';
  const [rows] = await db.query(
    `SELECT p.title, p.contact_name, p.legal_area, p.tipo_causa, p.description, p.valor,
            p.validade, p.observacoes, p.honorarios, p.dependentes, ${partnerSelect}, p.status, p.aceito_em, p.created_at,
            u.name AS advogada_nome
       FROM propostas p
       LEFT JOIN users u ON u.id = p.user_id
      WHERE p.public_token = ?`, [req.params.token]
  ) as any;
  if (!rows.length) { res.status(404).json({ error: 'Proposta não encontrada' }); return; }
  res.json(rows[0]);
});

// ── POST /api/public/proposta/:token/aceitar — cliente aceita ────────────────
// Registra o aceite e dispara a ESTEIRA DE PRODUÇÃO DE CONTRATO: gera o contrato
// de prestação de serviços, a procuração e a declaração de hipossuficiência.
router.post('/proposta/:token/aceitar', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT id, user_id, lead_id, client_id, contact_name, cpf, phone, email, legal_area, tipo_causa, description, valor, honorarios, title, aceito_em
       FROM propostas WHERE public_token = ?`,
    [req.params.token]
  ) as any;
  if (!rows.length) { res.status(404).json({ error: 'Proposta não encontrada' }); return; }
  const p = rows[0];
  if (p.aceito_em) { res.json({ success: true, already: true }); return; }

  // Honorários aceitos na proposta → Cláusula 2ª adaptada + valor do contrato
  let honorarios: any = null;
  let parcelamento: any = null;
  try {
    honorarios = typeof p.honorarios === 'string' ? JSON.parse(p.honorarios) : p.honorarios;
    if (honorarios?.parcelamento && Number(honorarios.parcelamento.total) > 0) parcelamento = honorarios.parcelamento;
  } catch {}
  const formaPagamento = formaPagamentoTexto(parcelamento);
  const valorContrato = parcelamento ? Number(parcelamento.total) : (Number(p.valor) || undefined);

  // Dados completos já cadastrados no lead (nome, CPF, RG, estado civil, profissão, endereço)
  let lead: any = null;
  if (p.lead_id) {
    const [lr] = await db.query(
      `SELECT name, cpf_cnpj, rg, marital_status, profession, cep, street, number, neighborhood, city, state, phone, email
         FROM leads WHERE id = ?`, [p.lead_id]
    ) as any;
    lead = lr[0] || null;
  }
  const nome = p.contact_name || lead?.name || '';
  const cpf = p.cpf || lead?.cpf_cnpj || null;
  const phone = p.phone || lead?.phone || null;
  const email = p.email || lead?.email || null;
  const endereco = montarEndereco(lead || {});
  const party: PartyData = {
    name: nome, cpf, rg: lead?.rg, estadoCivil: lead?.marital_status, profissao: lead?.profession, endereco, email, phone,
  };

  // 1) Garante o cliente (parte representada) — sem duplicar (dedup por nome)
  let clientId: number | null = p.client_id ?? null;
  if (!clientId && nome) {
    const [found] = await db.query('SELECT id FROM clients WHERE LOWER(name) = LOWER(?) LIMIT 1', [nome]) as any;
    if (found.length) {
      clientId = found[0].id;
      // completa dados que estiverem vazios
      await db.query(
        `UPDATE clients SET cpf_cnpj = COALESCE(cpf_cnpj, ?), phone = COALESCE(phone, ?), email = COALESCE(email, ?), address = COALESCE(address, ?) WHERE id = ?`,
        [cpf, phone, email, endereco, clientId]
      );
    } else {
      const [ins] = await db.query(
        "INSERT INTO clients (name, tipo, cpf_cnpj, email, phone, address, status, notes, created_by) VALUES (?, 'PF', ?, ?, ?, ?, 'ativo', 'Cliente da proposta aceita.', ?)",
        [nome, cpf, email, phone, endereco, p.user_id]
      ) as any;
      clientId = ins.insertId;
    }
    await db.query('UPDATE propostas SET client_id = ? WHERE id = ?', [clientId, p.id]);
  }

  // 2) Esteira de produção: contrato + procuração + declaração (sem duplicar)
  const area = AREAS.includes(p.legal_area) ? p.legal_area : 'outro';
  let contractId: number | null = null;
  const [existing] = await db.query(
    'SELECT id FROM contracts WHERE (lead_id <=> ? OR client_id <=> ?) AND title LIKE ? LIMIT 1',
    [p.lead_id ?? null, clientId, `Contrato — ${nome || ''}%`]
  ) as any;
  if (existing.length) {
    contractId = existing[0].id;
  } else {
    const adv = await getEscritorio();
    const content = buildTemplate({ party, area, value: valorContrato, formaPagamento, honorarios, tipoCausa: p.tipo_causa, descricao: p.description, contratada: adv });
    const [c] = await db.query(
      `INSERT INTO contracts (user_id, client_id, lead_id, area, title, content, procuracao_content, declaracao_content, value, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'em_producao')`,
      [p.user_id, clientId, p.lead_id ?? null, area, `Contrato — ${nome || 'cliente'}`,
       content, buildProcuracao(party, adv), buildDeclaracao(party, { trabalhista: area === 'trabalhista' }), valorContrato || null]
    ) as any;
    contractId = c.insertId;
  }

  // 3) Marca aceite, move o lead e registra
  await db.query("UPDATE propostas SET aceito_em = NOW(), status = 'aceita' WHERE id = ?", [p.id]);
  if (p.lead_id) await db.query("UPDATE leads SET status = 'fechada', analise_since = NULL WHERE id = ?", [p.lead_id]);

  await logActivity({
    leadId: p.lead_id ?? null, clientId,
    actorId: p.user_id, actorName: p.contact_name || 'Cliente',
    eventType: 'proposal_status', title: 'Proposta ACEITA pelo cliente',
    description: `${p.title} — aceite pelo link. Contrato, procuração e declaração de hipossuficiência gerados (esteira de produção).`,
  });
  const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
  for (const a of admins) {
    await notificationService.create({
      userId: a.id, clientId: clientId ?? undefined, title: 'Proposta aceita — contrato em produção',
      message: `${p.contact_name || 'O cliente'} aceitou a proposta. Contrato, procuração e declaração gerados para revisão e assinatura.`,
      notificationType: 'proposta_aceita', channel: 'sistema', scheduledAt: new Date(),
    });
  }

  res.json({ success: true, contract_id: contractId });
});

export default router;
