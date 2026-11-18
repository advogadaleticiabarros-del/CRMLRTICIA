import { google } from 'googleapis';
import { db } from '../config/database';
import { env } from '../config/env';
import { encrypt, decryptFields } from '../utils/crypto';
import { sendText, avisarFalhaEnvioWhatsapp } from './uazapiInstance';
import { aiComplete } from './aiAssistant';
import { limparTextoJudicial } from './textCleanup';
import { ehEmailPush, lerMovimentosDoPush } from './pushTribunal';

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
    expirada: await (await import('./conexaoGoogle')).conexaoExpirada('monitoramento:processos-email'),
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
export const GMAIL_QUERY =
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

export interface CandidateEmail {
  gmailMessageId: string; fromEmail: string; subject: string; body: string; date: string | null;
  /** Corpo HTML original (o Push do PJe traz a tabela de movimentos aqui). */
  html?: string;
}

/** Corpo HTML bruto da mensagem (sem tirar as tags), se houver. */
function extractHtml(payload: any): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/html' && payload.body?.data) return decodeB64(payload.body.data);
  for (const p of payload.parts || []) {
    const t = extractHtml(p);
    if (t) return t;
  }
  return '';
}

/** Corpo em texto puro original (com as quebras de linha), se houver. */
function extractPlain(payload: any): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return decodeB64(payload.body.data);
  for (const p of payload.parts || []) {
    const t = extractPlain(p);
    if (t) return t;
  }
  return '';
}

/**
 * Busca+baixa (paginando pelo Gmail) os e-mails candidatos a movimentação de
 * tribunal na caixa conectada, usando a heurística de GMAIL_QUERY (ou uma
 * query customizada, se passada). Núcleo de busca/paginação REUTILIZADO por:
 *  - fetchCandidateEmails (abaixo) — o scan RECORRENTE (cron 2x/dia, item 7),
 *    que passa `excludeGmailId` para pular o que já varreu (idempotência via
 *    court_email_messages) — comportamento inalterado;
 *  - src/scripts/backfillClientesEmailMovimentacao.ts — a varredura ÚNICA/
 *    retroativa de pré-cadastro de clientes pedida pela Dra. Letícia
 *    (30/08/2026): NÃO passa `excludeGmailId` (quer TODO o histórico
 *    disponível na caixa, não só o que o cron ainda não viu) e, de propósito,
 *    nunca grava em court_email_messages nem em process_movements — quem
 *    registra a movimentação de verdade continua sendo só o scan recorrente,
 *    a partir de amanhã, como combinado com a cliente.
 *
 * `maxResults`: teto de mensagens a EXAMINAR no total (não por página) —
 * omitido/Infinity percorre todas as páginas que a query devolver.
 */
export async function fetchCourtEmailCandidates(opts?: {
  maxResults?: number;
  query?: string;
  excludeGmailId?: (gmailMessageId: string) => Promise<boolean>;
}): Promise<CandidateEmail[]> {
  const auth = await authedClient();
  const gmail = google.gmail({ version: 'v1', auth });
  const query = opts?.query ?? GMAIL_QUERY;
  const cap = opts?.maxResults ?? Infinity;
  const out: CandidateEmail[] = [];
  let pageToken: string | undefined;
  while (out.length < cap) {
    const pageSize = Math.min(500, cap - out.length);
    const list = await gmail.users.messages.list({
      userId: 'me', q: query, maxResults: Number.isFinite(pageSize) ? pageSize : 500, pageToken,
    });
    const ids = list.data.messages || [];
    if (!ids.length) break;
    for (const m of ids) {
      if (!m.id) continue;
      if (opts?.excludeGmailId && (await opts.excludeGmailId(m.id))) continue;
      try {
        const full = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
        const headers = full.data.payload?.headers || [];
        const from = headers.find((h) => h.name?.toLowerCase() === 'from')?.value || '';
        const subject = headers.find((h) => h.name?.toLowerCase() === 'subject')?.value || '';
        const date = headers.find((h) => h.name?.toLowerCase() === 'date')?.value || null;
        const body = extractBody(full.data.payload) || full.data.snippet || '';
        const html = extractHtml(full.data.payload) || extractPlain(full.data.payload) || undefined;
        out.push({ gmailMessageId: m.id, fromEmail: from, subject, body, date, html });
      } catch { /* um e-mail com erro não trava a varredura dos demais */ }
      if (out.length >= cap) break;
    }
    pageToken = list.data.nextPageToken || undefined;
    if (!pageToken) break;
  }
  return out;
}

// 60 por rodada (eram 30): o Push do TRT17 manda um e-mail por processo
// atualizado, e o Push não passa pela IA (é rápido).
async function fetchCandidateEmails(maxResults = 60): Promise<CandidateEmail[]> {
  return fetchCourtEmailCandidates({
    maxResults,
    // já varrido nesta ou em rodada anterior — idempotência do scan recorrente
    excludeGmailId: async (id) => {
      const [[already]] = await db.query('SELECT id FROM court_email_messages WHERE gmail_message_id = ?', [id]) as any;
      return !!already;
    },
  });
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
    // Corpo do e-mail às vezes chega como HTML bruto (tags e entidades não
    // decodificadas — mesmo problema do DJEN, ver textCleanup.ts) — limpa
    // uma vez aqui e reaproveita tanto pra extrair o nº do processo quanto
    // pro texto que vai pro resumo/WhatsApp abaixo.
    const corpoLimpo = limparTextoJudicial(msg.body);
    const texto = `${msg.subject}\n${corpoLimpo}`;
    const push = ehEmailPush(msg.fromEmail, msg.subject);
    // No Push o número certo está no assunto (o corpo pode citar outros).
    const processNumber = (push && extractProcessNumberFromText(msg.subject)) || extractProcessNumberFromText(texto);
    if (!processNumber) {
      semProcesso++;
      await logScan(msg, 'sem_processo_identificado', 'Regex CNJ não encontrou número de processo no e-mail', null, null);
      continue;
    }

    const [[proc]] = await db.query(
      "SELECT id, client_id, process_number FROM legal_processes WHERE REGEXP_REPLACE(process_number, '[^0-9]', '') = ? ORDER BY id LIMIT 1", [String(processNumber).replace(/\D/g, '')]
    ) as any;
    if (!proc) {
      // Processo mencionado no e-mail não está cadastrado no CRM — não dá
      // pra registrar movimentação sem um legal_processes.id (FK). Só loga.
      // O Push só chega de processo em que a Dra. atua: esses ficam listados em
      // "Processos que chegam por e-mail e não estão no CRM" (processosSemCadastro).
      await logScan(msg, 'sem_processo_identificado', `Processo ${processNumber} não está cadastrado no CRM${push ? ` (Push ${push.tribunal})` : ''}`, processNumber, null);
      semProcesso++;
      continue;
    }

    // Push do PJe (TRT17 e outros): cada linha da tabela vira um movimento,
    // com a data e o texto do tribunal, sem resumo de IA. Formato não
    // reconhecido → segue o caminho antigo abaixo.
    const movsPush = push ? lerMovimentosDoPush(msg.html || msg.body) : [];
    if (push && movsPush.length) {
      const { registrarMovimentoDoPush, buscarNomeCliente } = await import('./monitoringService');
      const entraram: string[] = [];
      let repetidos = 0;
      for (const mv of movsPush) {
        const r = await registrarMovimentoDoPush(proc.id, proc.process_number, proc.client_id ?? null, { ...mv, tribunal: push.tribunal });
        if (r.novo) entraram.push(mv.texto);
        else repetidos++;
      }
      if (!entraram.length) {
        jaCapturados++;
        await logScan(msg, 'ja_capturado_djen', `Push ${push.tribunal}: ${movsPush.length} movimento(s), todos já no CRM`, processNumber, proc.id);
        continue;
      }
      novos++;
      await logScan(msg, 'movimentacao_registrada', `Push ${push.tribunal}: ${entraram.length} novo(s), ${repetidos} já no CRM`, processNumber, proc.id);
      const clienteNome = await buscarNomeCliente(proc.client_id ?? null);
      const linhas = entraram.slice(0, 5).map((t) => `• ${t.replace(/\s+/g, ' ').slice(0, 160)}`);
      if (entraram.length > 5) linhas.push(`• … e mais ${entraram.length - 5}`);
      const aviso = [
        `📧 ${push.tribunal} — andamento novo (aviso Push por e-mail)`,
        '',
        `Processo: ${proc.process_number}`,
        clienteNome ? `Cliente: ${clienteNome}` : 'Processo ainda não vinculado a um cliente no CRM — confira em Processos.',
        ...linhas,
      ].join('\n');
      for (const num of ESCRITORIO_WHATSAPP_NUMEROS) {
        const ok = await sendText(num, aviso).catch(() => false);
        if (!ok) await avisarFalhaEnvioWhatsapp('email_judicial', num);
      }
      continue;
    }

    // Extração do texto da movimentação: primeiro tenta um resumo direto do
    // corpo (rápido, sem custo de IA); se o corpo for longo/pouco objetivo,
    // usa IA no mesmo estilo de extrairNomeacaoDativa (aiAssistant.ts).
    let descricao = corpoLimpo;
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

    // Mesma correção já aplicada ao aviso de marco processual (DJEN) em
    // 03/09/2026 — a mensagem só trazia o número do processo, mesmo quando
    // o processo já tinha cliente vinculado no CRM (bug reportado de novo,
    // agora neste fluxo separado de e-mail — ver docs/manual/14-runbook.md).
    const { buscarNomeCliente } = await import('./monitoringService');
    const clienteNome = await buscarNomeCliente(proc.client_id ?? null);
    const resumo = [
      '📧 Movimentação encontrada por e-mail (não veio pelo DJEN)',
      '',
      `Processo: ${proc.process_number}`,
      clienteNome ? `Cliente: ${clienteNome}` : 'Processo ainda não vinculado a um cliente no CRM — confira em Processos.',
      `Trecho: ${descricao.replace(/\s+/g, ' ').trim().slice(0, 300)}`,
    ].join('\n');
    for (const num of ESCRITORIO_WHATSAPP_NUMEROS) {
      const ok = await sendText(num, resumo).catch(() => false);
      if (!ok) await avisarFalhaEnvioWhatsapp('email_judicial', num);
    }
  }

  await db.query(
    'UPDATE court_email_integration SET last_check_at = NOW(), last_check_found = ? WHERE id = 1',
    [novos]
  );

  return { verificados: emails.length, novos, jaCapturadosPeloDjen: jaCapturados, semProcessoIdentificado: semProcesso };
}

export interface ProcessoSemCadastro {
  process_number: string; tribunal: string; emails: number; ultimo_em: string | Date; via_push: boolean;
}

/**
 * Processos que chegam pelos e-mails dos tribunais (sobretudo o Push do
 * TRT17, que só manda processo em que a Dra. atua) e ainda não estão no CRM.
 * Antes eram só descartados no log. Some da lista quando o processo é
 * cadastrado (a conferência é pelos dígitos do número).
 */
export async function processosSemCadastroPorEmail(): Promise<ProcessoSemCadastro[]> {
  const { sistemaDoProcesso } = await import('./termometroCasos');
  const [rows] = await db.query(
    `SELECT m.process_number, COUNT(*) AS emails, MAX(m.created_at) AS ultimo_em,
            MAX(m.detail LIKE '%(Push %') AS via_push
       FROM court_email_messages m
      WHERE m.status = 'sem_processo_identificado' AND m.process_number IS NOT NULL
        AND m.detail LIKE '%não está cadastrado%'
        AND NOT EXISTS (SELECT 1 FROM legal_processes lp
                         WHERE REGEXP_REPLACE(lp.process_number, '[^0-9]', '') = REGEXP_REPLACE(m.process_number, '[^0-9]', ''))
      GROUP BY m.process_number
      ORDER BY ultimo_em DESC
      LIMIT 200`
  ) as any;
  return (rows as any[]).map((r) => ({
    process_number: r.process_number,
    tribunal: sistemaDoProcesso(r.process_number).nome,
    emails: Number(r.emails),
    ultimo_em: r.ultimo_em,
    via_push: !!Number(r.via_push) || /\.5\.17\./.test(String(r.process_number)),
  }));
}
