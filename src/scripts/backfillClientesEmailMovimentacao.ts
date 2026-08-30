import { db, closeDatabase } from '../config/database';
import { aiComplete } from '../services/aiAssistant';
import {
  fetchCourtEmailCandidates,
  extractProcessNumberFromText,
  getCourtEmailStatus,
  GMAIL_QUERY,
  type CandidateEmail,
} from '../services/courtEmailMonitorService';

/**
 * Script AVULSO (roda uma vez, sob demanda) — NÃO é o cron recorrente do
 * item 7 (courtEmailMonitorService.runCourtEmailScan, 2x/dia) e não altera
 * esse fluxo em nada.
 *
 * Pedido da Dra. Letícia (30/08/2026): antes do monitoramento automático
 * começar a valer (amanhã), ela quer uma varredura RETROATIVA única na
 * MESMA caixa de e-mail já conectada (court_email_integration) para
 * PRÉ-CADASTRAR no CRM os clientes/processos que aparecem em e-mails de
 * movimentação de tribunal que ela ainda não tem cadastrados — só isso.
 *
 * O que este script FAZ:
 *  - Reaproveita a busca/paginação de e-mails de courtEmailMonitorService
 *    (fetchCourtEmailCandidates) e a mesma heurística de "isso parece
 *    e-mail de tribunal" (GMAIL_QUERY) e extração de nº de processo
 *    (extractProcessNumberFromText) do item 7 — não duplica essa lógica.
 *  - Varre TODO o histórico disponível na caixa (sem filtro de data — a
 *    própria GMAIL_QUERY do item 7 já não tem corte de janela; aqui, além
 *    disso, NÃO passa `excludeGmailId`, então também não pula o que o cron
 *    recorrente eventualmente já tiver marcado como visto).
 *  - Para cada e-mail candidato, tenta extrair nome da parte/cliente (e
 *    CPF/e-mail/telefone, quando aparecerem) com uma extração por IA no
 *    mesmo estilo das outras extrações do projeto (extrairNomeacaoDativa,
 *    parseEmail) — só isola o que já está escrito, não inventa dado.
 *  - Cria um cliente em PRÉ-CADASTRO (status = 'prospecto', clients.status
 *    já tem esse valor no ENUM — não foi criada coluna nova) só quando o
 *    processo/cliente ainda não existe no CRM, com uma nota clara em
 *    `notes` avisando que é pré-cadastro pendente de revisão.
 *
 * O que este script NÃO FAZ (de propósito):
 *  - NÃO grava nada em process_movements (nenhuma "movimentação" é
 *    registrada — isso é papel do scan recorrente, a partir de amanhã).
 *  - NÃO manda aviso de WhatsApp.
 *  - NÃO grava em court_email_messages (essa tabela é só o dedupe/log do
 *    scan recorrente — se este script gravasse ali, o cron de amanhã
 *    pularia esses e-mails achando que já foram "vistos", e a movimentação
 *    de verdade nunca seria registrada. Este script é só leitura da caixa +
 *    escrita em `clients`).
 *  - NÃO apaga/edita cliente existente — só cria quando tem certeza
 *    razoável de que não é duplicata.
 *
 * DEDUPE (regra confirmada com a cliente: nº de processo é o critério
 * PRINCIPAL e definitivo — mais forte que nome, mesmo com variação de
 * acento/maiúscula/espaço no nome). Para cada processo extraído, pula (não
 * cria nada) se:
 *   1) já existe uma linha com esse process_number em `legal_processes`; OU
 *   2) já existe um `case_number` igual em `cases`; OU
 *   3) já existe um cliente pré-cadastrado por uma execução ANTERIOR deste
 *      próprio script para esse mesmo processo (procurado em clients.notes,
 *      já que este script não cria linha em legal_processes/cases — só o
 *      texto da nota registra o nº do processo).
 * Quando o e-mail não tem nº de processo identificável, cai para o dedupe
 * por CPF/nome do cliente (mesmo padrão de emailIntake.ts confirmIntake).
 *
 * Uso (rodar manualmente, com acesso ao banco de produção):
 *   npx ts-node src/scripts/backfillClientesEmailMovimentacao.ts
 *
 * Requer as mesmas variáveis de ambiente da aplicação (.env): conexão do
 * banco (DB_*), credenciais OAuth do Google (GOOGLE_CLIENT_ID/SECRET/
 * REDIRECT_URI) e a chave de IA usada por aiComplete (OPENAI_API_KEY) — a
 * caixa de e-mail já precisa estar conectada em Configurações (mesma
 * integração usada pelo item 7).
 */

const PRE_CADASTRO_NOTE_PREFIX = 'Pré-cadastro automático via varredura de e-mail de movimentação — revisar e completar dados.';

interface ExtracaoParte {
  nome: string | null;
  cpf: string | null;
  email: string | null;
  telefone: string | null;
}

function campoLabel(texto: string, rotulo: string): string {
  const m = texto.match(new RegExp(`${rotulo}:\\s*(.+)`, 'i'));
  const v = m ? m[1].trim() : '';
  return /^(vazio|n\/?a|nenhum|n[ãa]o informad[oa]|desconhecid[oa])$/i.test(v) ? '' : v;
}

// Nomes que a IA às vezes confunde com "a parte" (o próprio juízo, a
// advogada do escritório, ou termos genéricos do assunto) — filtro
// best-effort para não pré-cadastrar lixo óbvio. Mesmo espírito do filtro
// de termos/heurísticas já documentado em GMAIL_QUERY.
const NOME_INVALIDO_RE = /\b(pje|tribunal|vara|comarca|juizado|justiça|processo|advocacia|letícia barros|leticia barros)\b/i;

function nomeParecePlausivel(nome: string): boolean {
  const n = nome.trim();
  if (!n || n.length < 5) return false;
  if (NOME_INVALIDO_RE.test(n)) return false;
  // exige nome composto (pelo menos "Nome Sobrenome") — reduz falso positivo
  // de a IA devolver um único termo genérico.
  return n.trim().split(/\s+/).filter(Boolean).length >= 2;
}

/**
 * Extração por IA do nome/CPF/e-mail/telefone da parte/cliente mencionada
 * no e-mail de movimentação — mesmo estilo (prompt rotulado, "vazio" quando
 * não encontrar, só isola o que já está escrito) de extrairNomeacaoDativa
 * em aiAssistant.ts. Esse dado (nome da parte) não é extraído em lugar
 * nenhum do item 7 (que só extrai nº de processo e resumo da movimentação),
 * por isso a extração é nova — mas reaproveita a mesma infraestrutura de IA
 * (aiComplete) e o mesmo padrão de prompt já usado no projeto.
 */
async function extrairParteDoEmail(assunto: string, corpo: string): Promise<ExtracaoParte> {
  const teor = `${assunto}\n${corpo}`.trim().slice(0, 8000);
  if (!teor) return { nome: null, cpf: null, email: null, telefone: null };
  const prompt = `Você é assistente jurídico(a). O texto abaixo (assunto + corpo) é um e-mail de notificação de tribunal/PJe sobre movimentação processual. Extraia SOMENTE o que estiver escrito no texto e responda EXATAMENTE neste formato, sem texto fora dele (use "vazio" quando não encontrar):
NOME_PARTE: <nome completo da parte/cliente representada pelo escritório nessa movimentação, se identificável — não é o nome da advogada nem do juízo>
CPF: <CPF da parte, somente se aparecer explicitamente no texto, no formato 000.000.000-00>
EMAIL: <e-mail de contato da parte, somente se aparecer explicitamente>
TELEFONE: <telefone de contato da parte, somente se aparecer explicitamente>

Não invente nenhum dado que não esteja escrito no texto.

TEXTO:
${teor}`;
  const r = await aiComplete(prompt, 'openai');
  if (!r.ok || !r.text) return { nome: null, cpf: null, email: null, telefone: null };
  const nome = campoLabel(r.text, 'NOME_PARTE');
  return {
    nome: nome && nomeParecePlausivel(nome) ? nome : null,
    cpf: campoLabel(r.text, 'CPF') || null,
    email: campoLabel(r.text, 'EMAIL') || null,
    telefone: campoLabel(r.text, 'TELEFONE') || null,
  };
}

interface SemInfo { subject: string; date: string | null; motivo: string; }
interface NovoCliente { nome: string; processNumber: string | null; clientId: number; }
interface JaExistia { nome: string | null; processNumber: string | null; motivo: string; }

async function processoJaNoCRM(processNumber: string): Promise<string | null> {
  const [[lp]] = await db.query('SELECT id FROM legal_processes WHERE process_number = ? LIMIT 1', [processNumber]) as any;
  if (lp) return 'processo já cadastrado no CRM (legal_processes)';
  const [[cs]] = await db.query('SELECT id FROM cases WHERE case_number = ? LIMIT 1', [processNumber]) as any;
  if (cs) return 'processo já cadastrado no CRM (cases)';
  const [[pre]] = await db.query(
    "SELECT id FROM clients WHERE notes LIKE CONCAT('%Processo: ', ?, '%')", [processNumber]
  ) as any;
  if (pre) return 'processo já pré-cadastrado em execução anterior deste script';
  return null;
}

async function clienteJaExistePorCpfOuNome(cpf: string | null, nome: string): Promise<boolean> {
  if (cpf) {
    const cpfDigits = cpf.replace(/\D/g, '');
    if (cpfDigits) {
      const [[found]] = await db.query(
        "SELECT id FROM clients WHERE REPLACE(REPLACE(REPLACE(cpf_cnpj,'.',''),'-',''),'/','') = ? LIMIT 1",
        [cpfDigits]
      ) as any;
      if (found) return true;
    }
  }
  const nomeNormalizado = nome.replace(/\s+/g, ' ').trim();
  const [[found]] = await db.query(
    'SELECT id FROM clients WHERE LOWER(TRIM(name)) = LOWER(?) LIMIT 1',
    [nomeNormalizado]
  ) as any;
  return !!found;
}

async function run(): Promise<void> {
  console.log('\n========================================');
  console.log('  Pré-cadastro retroativo via e-mail de movimentação');
  console.log('  (varredura ÚNICA — não é o monitoramento recorrente)');
  console.log('========================================\n');

  const status = await getCourtEmailStatus();
  if (!status.connected || !status.active) {
    console.error('E-mail de monitoramento judicial não está conectado/ativo em Configurações. Nada a fazer.');
    process.exit(1);
  }
  console.log(`Caixa conectada: ${status.google_email}\n`);

  console.log('Buscando e-mails candidatos na caixa (histórico completo, sem filtro de data)...');
  const emails: CandidateEmail[] = await fetchCourtEmailCandidates({ query: GMAIL_QUERY });
  console.log(`${emails.length} e-mail(s) candidato(s) encontrado(s) pela heurística de assunto/remetente.\n`);

  const semInfo: SemInfo[] = [];
  const novos: NovoCliente[] = [];
  const jaExistiam: JaExistia[] = [];
  let candidatosValidos = 0;

  for (const msg of emails) {
    const texto = `${msg.subject}\n${msg.body}`;
    const processNumber = extractProcessNumberFromText(texto);
    const extracao = await extrairParteDoEmail(msg.subject, msg.body);

    if (!processNumber && !extracao.nome) {
      semInfo.push({ subject: msg.subject, date: msg.date, motivo: 'sem número de processo (CNJ) e sem nome de parte identificável' });
      continue;
    }

    candidatosValidos++;

    // Dedupe primário: nº de processo (mais forte que nome).
    if (processNumber) {
      const motivo = await processoJaNoCRM(processNumber);
      if (motivo) {
        jaExistiam.push({ nome: extracao.nome, processNumber, motivo });
        continue;
      }
    }

    if (!extracao.nome) {
      semInfo.push({
        subject: msg.subject, date: msg.date,
        motivo: `processo ${processNumber} identificado, mas sem nome de parte para cadastrar cliente`,
      });
      continue;
    }

    // Dedupe secundário (quando não há processo, ou como reforço): CPF/nome.
    if (await clienteJaExistePorCpfOuNome(extracao.cpf, extracao.nome)) {
      jaExistiam.push({ nome: extracao.nome, processNumber, motivo: 'cliente já cadastrado (CPF/nome)' });
      continue;
    }

    const dataEmail = msg.date || 'data desconhecida';
    const notes = `${PRE_CADASTRO_NOTE_PREFIX} Processo: ${processNumber || 'não identificado'}. `
      + `E-mail de origem: "${msg.subject}" (${dataEmail}). Remetente: ${msg.fromEmail || 'desconhecido'}.`;

    const [ins] = await db.query(
      "INSERT INTO clients (name, tipo, cpf_cnpj, email, phone, status, notes, created_by) VALUES (?, 'PF', ?, ?, ?, 'prospecto', ?, NULL)",
      [extracao.nome, extracao.cpf || null, extracao.email || null, extracao.telefone || null, notes]
    ) as any;

    novos.push({ nome: extracao.nome, processNumber, clientId: ins.insertId });
  }

  console.log('\n========================================');
  console.log('  RESUMO');
  console.log('========================================');
  console.log(`E-mails varridos:                 ${emails.length}`);
  console.log(`Candidatos válidos (processo/nome): ${candidatosValidos}`);
  console.log(`Clientes novos pré-cadastrados:    ${novos.length}`);
  console.log(`Já existiam (pulados):             ${jaExistiam.length}`);
  console.log(`Sem informação suficiente:         ${semInfo.length}`);

  if (novos.length) {
    console.log('\n--- Clientes pré-cadastrados ---');
    for (const n of novos) console.log(`  [#${n.clientId}] ${n.nome} — processo: ${n.processNumber || '(não identificado)'}`);
  }
  if (jaExistiam.length) {
    console.log('\n--- Já existiam no CRM (pulados) ---');
    for (const j of jaExistiam) console.log(`  ${j.nome || '(sem nome extraído)'} — processo: ${j.processNumber || '-'} — motivo: ${j.motivo}`);
  }
  if (semInfo.length) {
    console.log('\n--- Sem informação suficiente (revisar manualmente) ---');
    for (const s of semInfo) console.log(`  "${s.subject}" (${s.date || 'sem data'}) — ${s.motivo}`);
  }

  console.log('\nConcluído. Nenhuma movimentação foi registrada e nenhum WhatsApp foi enviado — isso continua sendo feito só pelo monitoramento recorrente (item 7), a partir de amanhã.\n');
}

run()
  .catch((err) => {
    console.error('Erro ao rodar o backfill:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
    process.exit(process.exitCode || 0);
  });
