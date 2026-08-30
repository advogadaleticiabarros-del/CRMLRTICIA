import { google } from 'googleapis';
import { db } from '../config/database';
import { env } from '../config/env';
import { encrypt, decryptFields } from '../utils/crypto';
import { sendText } from './uazapiInstance';
import { aiComplete } from './aiAssistant';

/**
 * Item 7 do plano — "Plano B" do monitoramento processual: se uma
 * movimentação não chegar pelo caminho normal (DJEN/DataJud, ver
 * monitoringService.ts), tenta descobrir a mesma informação lendo os
 * e-mails de notificação que tribunais/PJe mandam direto para a caixa de
 * entrada da advogada — muitos tribunais notificam movimentação por e-mail
 * além (ou em vez) do DJEN.
 *
 * DECISÃO DE DESIGN (documentada porque não pôde ser confirmada com a
 * cliente antes de implementar — ela decide na hora de usar):
 *  - Conexão OAuth DEDICADA e separada de email_integration (Gmail do
 *    PARCEIRO — outra finalidade: captar indicação de cliente) e de
 *    google_accounts (Agenda, por usuário) — para não misturar escopos
 *    OAuth de propósitos diferentes numa mesma credencial. Cada conexão
 *    pede só o escopo que precisa (aqui: só gmail.readonly).
 *  - Linha única (id=1) em court_email_integration, no mesmo padrão de
 *    email_integration: é uma caixa de e-mail do ESCRITÓRIO conectada
 *    manualmente pela Dra. Letícia em Configurações — o sistema NUNCA
 *    assume nem hardcoda qual conta é essa; o consentimento OAuth do
 *    Google só acontece com ela logada de verdade.
 *  - O e-mail é só mais uma FONTE de movimentação: quando confirmado,
 *    entra na MESMA tabela process_movements que o DJEN usa (fonte =
 *    'email_monitoramento'), reaproveitando todo o pipeline de
 *    dedupe/prazo/aviso já existente em monitoringService.ts (saveMovements).
 *    Não existe uma tabela paralela de "movimentações" por e-mail.
 *  - court_email_messages é só o log/dedupe do SCAN do Gmail em si
 *    (idempotência — não reprocessar o mesmo e-mail a cada rodada do cron),
 *    não é uma segunda fonte de verdade de movimentação.
 */

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

// Mesmos números que já recebem os avisos automáticos de movimentação/
// eventos de alto valor no monitoramento (ver ESCRITORIO_WHATSAPP_NUMEROS
// em monitoringService.ts) — advogada (44) e assistente Jessica (27).
const ESCRITORIO_WHATSAPP_NUMEROS = ['5544991011402', '5527988798093'];

function oauth() {
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
}

export function getCourtEmailAuthUrl(state: string): string {
  return oauth().generateAuthUrl({ access_type: 'offline', prompt: 'consent', state, scope: SCOPES });
}

/** Troca o code por tokens e salva na integração (id=1). */
export async function saveCourtEmailTokens(code: string): Promise<void> {
  const client = oauth();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  let email: string | null = null;
  try { const { data } = await google.oauth2({ version: 'v2', auth: client }).userinfo.get(); email = data.email || null; } catch {}
  await db.query(
    `INSERT INTO court_email_integration (id, google_email, access_token, refresh_token, token_expiry, active)
     VALUES (1, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE google_email = VALUES(google_email), access_token = VALUES(access_token),
       refresh_token = COALESCE(VALUES(refresh_token), refresh_token), token_expiry = VALUES(token_expiry), active = 1`,
    // LGPD: tokens cifrados em repouso — dão acesso à caixa de e-mail conectada.
    [email, encrypt(tokens.access_token || null), encrypt(tokens.refresh_token || null),
     tokens.expiry_date ? new Date(tokens.expiry_date) : null]
  );
}

async function loadIntegration(): Promise<any> {
  const [[row]] = await db.query('SELECT * FROM court_email_integration WHERE id = 1') as any;
  return decryptFields(row || null, ['access_token', 'refresh_token']);
}

async function authedClient(): Promise<any> {
  const row = await loadIntegration();
  if (!row || !row.refresh_token) throw new Error('E-mail de monitoramento judicial não conectado');
  const client = oauth();
  client.setCredentials({
    access_token: row.access_token, refresh_token: row.refresh_token,
    expiry_date: row.token_expiry ? new Date(row.token_expiry).getTime() : undefined,
  });
  client.on('tokens', async (t) => {
    if (t.access_token) {
      await db.query('UPDATE court_email_integration SET access_token = ?, token_expiry = ? WHERE id = 1',
        [encrypt(t.access_token), t.expiry_date ? new Date(t.expiry_date) : null]);
    }
  });
  return client;
}

export async function getCourtEmailStatus(): Promise<any> {
  const row = await loadIntegration();
  if (!row) return { connected: false };
  return {
    connected: !!row.refresh_token, google_email: row.google_email, active: !!row.active,
    last_check_at: row.last_check_at, last_check_found: row.last_check_found,
  };
}

export async function disconnectCourtEmail(): Promise<void> {
  await db.query('UPDATE court_email_integration SET active = 0, access_token = NULL, refresh_token = NULL WHERE id = 1');
}

// ── Heurística de "isso parece e-mail de tribunal" ──────────────────────────
// É best-effort DE PROPÓSITO (a advogada foi avisada): melhor pegar alguns
// falsos positivos (que a extração de processo abaixo descarta, sem número
// não há o que fazer) do que perder uma notificação de verdade. Critérios,
// documentados para poderem ser ajustados com o tempo:
//  - remetente de domínio ".jus.br" (TJ/TRT/TRF/PJe/e-SAJ/Projudi costumam
//    notificar de um domínio .jus.br), OU
//  - assunto/corpo contendo termos típicos de notificação processual
//    (intimação, movimentação processual, publicação, PJe, andamento
//    processual, distribuição, citação).
const GMAIL_QUERY =
  '(from:*.jus.br OR subject:(intimação OR intimacao OR "movimentação processual" OR "movimentacao processual" ' +
  'OR publicação OR publicacao OR PJe OR "andamento processual" OR distribuição OR distribuicao OR citação OR citacao))';

/** Número de processo no formato CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO), com pontuação padrão. */
const CNJ_RE = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/;

export function extractProcessNumberFromText(text: string): string | null {
  const m = (text || '').match(CNJ_RE);
  return m ? m[0] : null;
}

function decodeB64(data?: string | null): string {
  if (!data) return '';
  try { return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch { return ''; }
}

/** Extrai um texto plano (corpo) razoável de uma mensagem Gmail (payload completo). */
function extractBody(payload: any): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return decodeB64(payload.body.data);
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return decodeB64(payload.body.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  }
  for (const p of payload.parts || []) {
    const t = extractBody(p);
    if (t) return t;
  }
  return '';
}

/**
 * Extração do trecho de movimentação por IA, quando o corpo do e-mail não
 * é curto/direto o bastante para simplesmente usar o corpo inteiro. Mesmo
 * estilo de extrairNomeacaoDativa/extrairArbitramentoDativo (aiAssistant.ts):
 * a IA só resume/isola o que já está escrito, não inventa nada.
 */
async function resumirMovimentacaoPorIA(texto: string): Promise<string | null> {
  const teor = (texto || '').trim().slice(0, 8000);
  if (!teor) return null;
  const prompt = `Você é assistente jurídico(a). O texto abaixo é um e-mail de notificação de tribunal/PJe sobre movimentação processual. Responda APENAS com um resumo objetivo (1 a 3 frases) do que foi movimentado/decidido, usando somente o que está escrito no texto. Se o texto não parecer conter uma movimentação processual de verdade, responda exatamente: SEM_MOVIMENTACAO

TEXTO:
${teor}`;
  const r = await aiComplete(prompt, 'openai');
  if (!r.ok || !r.text) return null;
  const resumo = r.text.trim();
  if (!resumo || /^SEM_MOVIMENTACAO/i.test(resumo)) return null;
  return resumo;
}

interface CandidateEmail {
  gmailMessageId: string; fromEmail: string; subject: string; body: string; date: string | null;
}

async function fetchCandidateEmails(maxResults = 30): Promise<CandidateEmail[]> {
  const auth = await authedClient();
  const gmail = google.gmail({ version: 'v1', auth });
  const list = await gmail.users.messages.list({ userId: 'me', q: GMAIL_QUERY, maxResults });
  const out: CandidateEmail[] = [];
  for (const m of list.data.messages || []) {
    if (!m.id) continue;
    const [[already]] = await db.query('SELECT id FROM court_email_messages WHERE gmail_message_id = ?', [m.id]) as any;
    if (already) continue; // já varrido nesta ou em rodada anterior — idempotência do scan
    try {
      const full = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
      const headers = full.data.payload?.headers || [];
      const from = headers.find((h) => h.name?.toLowerCase() === 'from')?.value || '';
      const subject = headers.find((h) => h.name?.toLowerCase() === 'subject')?.value || '';
      const date = headers.find((h) => h.name?.toLowerCase() === 'date')?.value || null;
      const body = extractBody(full.data.payload) || full.data.snippet || '';
      out.push({ gmailMessageId: m.id, fromEmail: from, subject, body, date });
    } catch { /* um e-mail com erro não trava o scan dos demais */ }
  }
  return out;
}

async function logScan(msg: CandidateEmail, status: string, detail: string | null, processNumber: string | null, processId: number | null): Promise<void> {
  try {
    await db.query(
      `INSERT INTO court_email_messages (gmail_message_id, from_email, subject, process_number, process_id, status, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [msg.gmailMessageId, msg.fromEmail?.slice(0, 255), msg.subject?.slice(0, 500), processNumber, processId, status, detail?.slice(0, 500) ?? null]
    );
  } catch { /* log é best-effort — nunca trava o scan */ }
}

interface ScanResult { verificados: number; novos: number; jaCapturadosPeloDjen: number; semProcessoIdentificado: number; }

/**
 * Roda a checagem: busca e-mails candidatos, extrai o número do processo e
 * o texto da movimentação, faz o CROSS-CHECK contra o que já chegou pelo
 * DJEN/DataJud e, se for realmente novidade, registra em process_movements
 * (fonte = 'email_monitoramento') reaproveitando o pipeline de dedupe/
 * prazo/aviso do monitoringService — e avisa no WhatsApp deixando claro que
 * a fonte foi e-mail.
 */
export async function runCourtEmailScan(): Promise<ScanResult> {
  const row = await loadIntegration();
  if (!row || !row.refresh_token || !row.active) {
    return { verificados: 0, novos: 0, jaCapturadosPeloDjen: 0, semProcessoIdentificado: 0 };
  }

  const emails = await fetchCandidateEmails();
  let novos = 0, jaCapturados = 0, semProcesso = 0;

  // saveMovements/detectDeadline/notificationService vêm do próprio
  // monitoringService — import tardio para evitar dependência circular
  // (monitoringService não conhece este arquivo).
  const { registrarMovimentacaoDeEmail } = await import('./monitoringService');

  for (const msg of emails) {
    const texto = `${msg.subject}\n${msg.body}`;
    const processNumber = extractProcessNumberFromText(texto);
    if (!processNumber) {
      semProcesso++;
      await logScan(msg, 'sem_processo_identificado', 'Regex CNJ não encontrou número de processo no e-mail', null, null);
      continue;
    }

    const [[proc]] = await db.query(
      'SELECT id, client_id, process_number FROM legal_processes WHERE process_number = ? LIMIT 1', [processNumber]
    ) as any;
    if (!proc) {
      // Processo mencionado no e-mail não está cadastrado no CRM — não dá
      // pra registrar movimentação sem um legal_processes.id (FK). Só loga.
      await logScan(msg, 'sem_processo_identificado', `Processo ${processNumber} não está cadastrado no CRM`, processNumber, null);
      semProcesso++;
      continue;
    }

    // Extração do texto da movimentação: primeiro tenta um resumo direto do
    // corpo (rápido, sem custo de IA); se o corpo for longo/pouco objetivo,
    // usa IA no mesmo estilo de extrairNomeacaoDativa (aiAssistant.ts).
    let descricao = msg.body.trim();
    if (descricao.length > 600 || descricao.length < 20) {
      const resumoIA = await resumirMovimentacaoPorIA(texto);
      if (resumoIA) descricao = resumoIA;
    }
    if (!descricao) {
      await logScan(msg, 'sem_processo_identificado', 'Sem texto de movimentação aproveitável', processNumber, proc.id);
      semProcesso++;
      continue;
    }

    const dataMovimento = msg.date ? new Date(msg.date) : new Date();
    const resultado = await registrarMovimentacaoDeEmail(proc.id, proc.process_number, proc.client_id ?? null, {
      movement_date: isNaN(dataMovimento.getTime()) ? null : dataMovimento.toISOString(),
      title: msg.subject?.slice(0, 500) || 'Movimentação recebida por e-mail',
      description: descricao,
    });

    if (resultado.jaCapturadoPeloDjen) {
      jaCapturados++;
      await logScan(msg, 'ja_capturado_djen', 'Movimentação equivalente já havia chegado pelo DJEN — não duplicado', processNumber, proc.id);
      continue;
    }
    if (!resultado.novo) {
      await logScan(msg, 'ignorado', 'Já registrada anteriormente (dedupe)', processNumber, proc.id);
      continue;
    }

    novos++;
    await logScan(msg, 'movimentacao_registrada', null, processNumber, proc.id);

    const resumo = [
      '📧 Movimentação encontrada por e-mail (não veio pelo DJEN)',
      '',
      `Processo: ${proc.process_number}`,
      `Trecho: ${descricao.replace(/\s+/g, ' ').trim().slice(0, 300)}`,
    ].join('\n');
    for (const num of ESCRITORIO_WHATSAPP_NUMEROS) await sendText(num, resumo).catch(() => {});
  }

  await db.query(
    'UPDATE court_email_integration SET last_check_at = NOW(), last_check_found = ? WHERE id = 1',
    [novos]
  );

  return { verificados: emails.length, novos, jaCapturadosPeloDjen: jaCapturados, semProcessoIdentificado: semProcesso };
}
