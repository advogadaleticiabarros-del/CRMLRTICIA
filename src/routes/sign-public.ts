import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { db } from '../config/database';
import { logTimeline } from '../services/TimelineService';
import { onContractSigned } from '../services/contractFlow';

// Roteador PÚBLICO (sem autenticação) — o signatário acessa por link/código.
const router = Router();

function maskCpf(cpf: string | null): string {
  if (!cpf) return '';
  const d = String(cpf).replace(/\D/g, '');
  if (d.length < 5) return '***';
  return `${d.slice(0, 3)}.***.**${d.slice(-2)}`;
}

// ── GET /api/public/sign/:token — carrega o documento para assinar ──────────
router.get('/sign/:token', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT s.id, s.status, s.signer_name, s.verification_code, s.signed_at,
            COALESCE(d.name, ct.title) AS document_name, COALESCE(d.content, ct.content) AS content
       FROM signature_requests s
       LEFT JOIN documents d ON d.id = s.document_id
       LEFT JOIN contracts ct ON ct.id = s.contract_id
      WHERE s.token = ?`, [req.params.token]
  ) as any;
  if (!rows.length) { res.status(404).json({ error: 'Solicitação de assinatura não encontrada' }); return; }
  const r = rows[0];
  res.json({
    document_name: r.document_name,
    content: r.content || '',
    signer_name: r.signer_name || '',
    status: r.status,
    verification_code: r.status === 'assinado' ? r.verification_code : null,
    signed_at: r.signed_at,
  });
});

// ── POST /api/public/sign/:token — registra a assinatura ────────────────────
router.post('/sign/:token', async (req: Request, res: Response) => {
  const { signer_name, signer_cpf, signer_email, signer_phone, signature_image,
          selfie_image, consent_lgpd, geo, opened_at } = req.body;
  if (!signer_name || !String(signer_name).trim()) { res.status(400).json({ error: 'Informe seu nome completo' }); return; }
  const cpfDigits = String(signer_cpf || '').replace(/\D/g, '');
  if (cpfDigits.length < 11) { res.status(400).json({ error: 'Informe um CPF válido' }); return; }
  if (!consent_lgpd) { res.status(400).json({ error: 'É necessário aceitar os termos e a política de privacidade (LGPD).' }); return; }
  if (!signature_image || !String(signature_image).startsWith('data:image')) { res.status(400).json({ error: 'Faça sua assinatura na tela' }); return; }

  const [rows] = await db.query(
    `SELECT s.*, COALESCE(d.content, ct.content) AS content
       FROM signature_requests s
       LEFT JOIN documents d ON d.id = s.document_id
       LEFT JOIN contracts ct ON ct.id = s.contract_id
      WHERE s.token = ?`, [req.params.token]
  ) as any;
  if (!rows.length) { res.status(404).json({ error: 'Solicitação não encontrada' }); return; }
  const reqRow = rows[0];
  if (reqRow.status === 'assinado') { res.status(409).json({ error: 'Documento já assinado', verification_code: reqRow.verification_code }); return; }
  if (reqRow.status === 'cancelado') { res.status(409).json({ error: 'Solicitação cancelada' }); return; }

  const docHash = crypto.createHash('sha256').update(String(reqRow.content || '')).digest('hex');
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';
  const ua = String(req.headers['user-agent'] || '').slice(0, 500);
  const nowIso = new Date().toISOString();
  const lat = geo && geo.lat != null ? Number(geo.lat) : null;
  const lng = geo && geo.lng != null ? Number(geo.lng) : null;
  const acc = geo && geo.accuracy != null ? Math.round(Number(geo.accuracy)) : null;

  const eventLog = [
    { evento: 'Documento disponibilizado para assinatura', data_utc: new Date(reqRow.created_at).toISOString() },
    ...(opened_at ? [{ evento: 'Documento aberto pelo signatário', data_utc: String(opened_at) }] : []),
    { evento: 'Aceite "Li e concordo" e manifestação de vontade', data_utc: nowIso },
    { evento: 'Assinatura manuscrita registrada', data_utc: nowIso },
    { evento: 'Assinatura concluída', data_utc: nowIso, ip, user_agent: ua, geolocalizacao: (lat != null && lng != null) ? `${lat}, ${lng} (±${acc ?? '?'}m)` : 'não autorizada', hash_sha256: docHash },
  ];

  await db.query(
    `UPDATE signature_requests
       SET signer_name = ?, signer_cpf = ?, signer_email = ?, signer_phone = ?, signature_image = ?, selfie_image = ?,
           doc_hash = ?, consent_lgpd = 1, geo_lat = ?, geo_lng = ?, geo_accuracy = ?, event_log = ?,
           status = 'assinado', signed_at = NOW(), signer_ip = ?, signer_ua = ?
     WHERE id = ?`,
    [signer_name.trim(), cpfDigits, signer_email || null, String(signer_phone || '').replace(/\D/g, '') || null,
     signature_image, (selfie_image && String(selfie_image).startsWith('data:image')) ? selfie_image : null,
     docHash, lat, lng, acc, JSON.stringify(eventLog), ip, ua, reqRow.id]
  );

  if (reqRow.document_id) {
    await db.query("UPDATE documents SET status = 'assinado' WHERE id = ?", [reqRow.document_id]);
    const [[doc]] = await db.query('SELECT client_id, case_id, name FROM documents WHERE id = ?', [reqRow.document_id]) as any;
    if (doc?.client_id) {
      await logTimeline({ clientId: doc.client_id, caseId: doc.case_id ?? null, eventType: 'documento_assinado',
        description: `Documento assinado eletronicamente: ${doc.name} (cód. ${reqRow.verification_code})`, userId: null });
    }
  }

  // Contrato assinado → dispara o fluxo (cria processo na esteira + honorários no financeiro)
  if (reqRow.contract_id) {
    await onContractSigned(reqRow.contract_id, reqRow.created_by || 0, null);
  }

  res.json({ success: true, verification_code: reqRow.verification_code });
});

// ── GET /api/public/verify/:code — validação pública (Relatório de Auditoria) ──
router.get('/verify/:code', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT s.verification_code, s.signer_name, s.signer_cpf, s.signer_email, s.signer_phone,
            s.signed_at, s.created_at, s.doc_hash, s.signer_ip, s.signer_ua,
            s.geo_lat, s.geo_lng, s.geo_accuracy, s.consent_lgpd, s.event_log,
            s.signature_image, s.selfie_image,
            COALESCE(d.name, ct.title) AS document_name, COALESCE(d.content, ct.content) AS content
       FROM signature_requests s
       LEFT JOIN documents d ON d.id = s.document_id
       LEFT JOIN contracts ct ON ct.id = s.contract_id
      WHERE s.verification_code = ? AND s.status = 'assinado'`, [req.params.code]
  ) as any;
  if (!rows.length) { res.status(404).json({ error: 'Código não encontrado ou documento ainda não assinado' }); return; }
  const r = rows[0];
  let eventos: any[] = [];
  try { eventos = typeof r.event_log === 'string' ? JSON.parse(r.event_log) : (r.event_log || []); } catch {}
  res.json({
    valido: true,
    document_name: r.document_name,
    content: r.content || '',
    signer_name: r.signer_name,
    signer_cpf: maskCpf(r.signer_cpf),
    signer_email: r.signer_email || '',
    signer_phone: r.signer_phone || '',
    signed_at: r.signed_at,
    created_at: r.created_at,
    doc_hash: r.doc_hash,
    signer_ip: r.signer_ip,
    signer_ua: r.signer_ua,
    geo: (r.geo_lat != null && r.geo_lng != null) ? { lat: r.geo_lat, lng: r.geo_lng, accuracy: r.geo_accuracy } : null,
    consent_lgpd: !!r.consent_lgpd,
    eventos,
    verification_code: r.verification_code,
    signature_image: r.signature_image,
    selfie_image: r.selfie_image || null,
  });
});

export default router;
