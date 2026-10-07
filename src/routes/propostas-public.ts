import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { logActivity } from '../services/JourneyService';
import { notificationService } from '../services/NotificationService';
import { buildTemplate, buildProcuracao, buildDeclaracao, montarEndereco, formaPagamentoTexto, PartyData } from '../services/contractTemplates';
import { getEscritorio } from '../services/escritorio';
import { ensurePartnerLawyersColumn } from '../services/propostaSchema';
import { sendText, sendPixButton } from '../services/uazapiInstance';

const moneyBR = (v: number) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

// Mensagem de boas-vindas + dados de pagamento, disparada pro WhatsApp do
// cliente assim que ele aceita a proposta (best-effort — nunca impede o
// aceite de seguir se o envio falhar).
function mensagemAceite(nome: string, entrada: number): string {
  const primeiroNome = (nome || '').trim().split(' ')[0] || '';
  const bloco = [
    `Olá${primeiroNome ? ', ' + primeiroNome : ''}! Você aceitou nossa proposta, muito obrigada pela confiança. Já estamos formalizando o contrato, a procuração e os demais documentos.`,
  ];
  if (entrada > 0) {
    bloco.push(
      `*Pagamento da entrada*\nValor: ${moneyBR(entrada)}\nChave PIX (CPF): 13451070723\nBanco: Nubank\nTitular: Leticia Elias Barros`,
      `*Confira sempre o nome do titular antes de transferir.* Não nos responsabilizamos por valores enviados por engano para contas de terceiros, usamos somente a chave PIX informada aqui.`
    );
  }
  bloco.push(
    `*Canais oficiais do escritório* (salve para contato):\n• (44) 99101-1402\n• (27) 99515-1402\n• advogadaleticia.barros@gmail.com`,
    `Nos siga nas redes sociais para acompanhar o dia a dia:\n📷 https://www.instagram.com/adv.leticiabarros2/`,
    `E acompanhe nosso blog para ficar por dentro dos seus direitos:\n🔗 https://advogadaleticiabarros.com.br/blog/index.html`,
    `Em breve entraremos em contato com os próximos passos. Qualquer dúvida, é só chamar por aqui.`
  );
  return bloco.join('\n\n');
}

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

// ── Monitoramento do link: abertura (visita) e sinais periódicos ────────────
// POST /proposta/:token/visita → abre uma visita e avisa a equipe no sino.
router.post('/proposta/:token/visita', async (req: Request, res: Response) => {
  const [[p]] = await db.query(
    `SELECT p.id, p.user_id, p.lead_id, COALESCE(p.contact_name, l.name) AS nome
       FROM propostas p LEFT JOIN leads l ON l.id = p.lead_id WHERE p.public_token = ?`, [req.params.token]) as any;
  if (!p) { res.status(404).json({ error: 'Proposta não encontrada' }); return; }
  const { dispositivo } = await import('../services/propostaVisitas');
  const chave = (await import('crypto')).randomUUID();
  const disp = dispositivo(req.get('user-agent'));
  await db.query('INSERT INTO proposta_visitas (proposta_id, chave, dispositivo) VALUES (?, ?, ?)', [p.id, chave, disp]);
  await db.query(
    'UPDATE propostas SET visualizada_em = COALESCE(visualizada_em, NOW()), ultima_visualizacao_em = NOW() WHERE id = ?', [p.id]);
  const [[c]] = await db.query('SELECT COUNT(*) AS n FROM proposta_visitas WHERE proposta_id = ?', [p.id]) as any;
  const n = Number(c.n);
  const [equipe] = await db.query("SELECT id FROM users WHERE role IN ('admin','advogado','comercial') AND active = 1") as any;
  for (const u of equipe) {
    await db.query(
      `INSERT INTO notifications (user_id, title, message, notification_type, channel, scheduled_at, status)
       VALUES (?, ?, ?, 'proposta_aberta', 'sistema', NOW(), 'pendente')`,
      [u.id, `👀 ${p.nome || 'Cliente'} ${n === 1 ? 'abriu a proposta' : `reabriu a proposta (${n}ª vez)`}`,
       `Pelo ${disp}. Acompanhe o tempo de leitura na conversa do WhatsApp.`]).catch(() => {});
  }
  res.status(201).json({ chave });
});

// POST /proposta/:token/visita/:chave/sinal { segundos, scroll } — a cada ~15s com a página visível.
router.post('/proposta/:token/visita/:chave/sinal', async (req: Request, res: Response) => {
  const { segundosDoSinal, scrollValido } = await import('../services/propostaVisitas');
  const seg = segundosDoSinal(req.body?.segundos);
  const scroll = scrollValido(req.body?.scroll);
  // Só aceita sinal de visita existente DESTA proposta; o tempo creditado nunca
  // passa do tempo real desde o sinal anterior (+2s de folga) — não dá pra inflar.
  await db.query(
    `UPDATE proposta_visitas v JOIN propostas p ON p.id = v.proposta_id
        SET v.segundos = v.segundos + LEAST(?, TIMESTAMPDIFF(SECOND, v.ultimo_sinal_em, NOW()) + 2),
            v.scroll_max = GREATEST(v.scroll_max, ?), v.ultimo_sinal_em = NOW()
      WHERE v.chave = ? AND p.public_token = ?`,
    [seg, scroll, req.params.chave, req.params.token]);
  res.status(204).end();
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
  const formaPagamento = formaPagamentoTexto(parcelamento, honorarios);
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
    {
      // Uma pessoa = uma ficha (CPF, nome sem acento, telefone, e-mail); completa só o que falta.
      const { encontrarOuCriarCliente } = await import('../services/fichaUnica');
      clientId = (await encontrarOuCriarCliente({ nome, cpf, email, phone, address: endereco, notes: 'Cliente da proposta aceita.', createdBy: p.user_id })).id;
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

  if (phone) {
    let digits = String(phone).replace(/\D/g, '');
    if (digits.length <= 11) digits = '55' + digits;
    const entrada = Number(parcelamento?.entrada) || 0;
    sendText(digits, mensagemAceite(nome, entrada), 'Automático — aceite de proposta')
      .then(() => {
        // Botão nativo de pagamento PIX, além do texto — mais fácil pro
        // cliente pagar sem digitar/copiar a chave manualmente.
        if (entrada > 0) sendPixButton(digits, '13451070723', 'Leticia Elias Barros', 'CPF', 'Automático — aceite de proposta').catch(() => {});
      })
      .catch(() => {});
  }

  res.json({ success: true, contract_id: contractId });
});

export default router;
