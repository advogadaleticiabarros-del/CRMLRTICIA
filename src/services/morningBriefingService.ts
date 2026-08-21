import { db } from '../config/database';
import { sendEmail, layout } from './EmailService';
import { getGoalProgress, GoalProgress } from './goalsService';
import { sendText } from './uazapiInstance';
import { classificarAgenda, classificarPagamento, classificarEsteira, classificarPrazo, classificarMovimentacao, top3, Severity, BriefingItem } from './briefingSeverity';
import { buildCaseChecklist } from './caseChecklists';

/** Escapa texto de origem externa/variável (DJEN, Groq) antes de interpolar no HTML do e-mail. */
function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const NAVY = '#1f3047';
const GOLD = '#c19a4e';
const NAVY_SOFT = '#eef1f6';
const GOLD_SOFT = '#f2ead3';
const CRITICAL = '#b3432f', CRITICAL_SOFT = '#fbeae6';
const WARNING = '#a67626', WARNING_SOFT = '#faf1e0';
const OK_STRONG = '#2f8f63', OK_SOFT = '#eaf3ee';
const CITY = process.env.BRIEFING_CITY || 'Vitória';
// Coordenadas de Vitória/ES — usadas se a geocodificação falhar (a API de
// geocoding tem mais de uma cidade chamada "Vitória" no mundo — ver getWeather).
const FALLBACK_LAT = -20.3222;
const FALLBACK_LON = -40.3381;

// Códigos WMO do Open-Meteo → descrição amigável (PT).
const WMO: Record<number, string> = {
  0: 'céu limpo', 1: 'predomínio de sol', 2: 'parcialmente nublado', 3: 'nublado',
  45: 'névoa', 48: 'névoa com geada', 51: 'garoa fraca', 53: 'garoa', 55: 'garoa intensa',
  61: 'chuva fraca', 63: 'chuva', 65: 'chuva forte', 71: 'neve fraca', 73: 'neve', 75: 'neve forte',
  80: 'pancadas de chuva', 81: 'pancadas de chuva', 82: 'pancadas fortes de chuva',
  95: 'trovoadas', 96: 'trovoadas com granizo', 99: 'trovoadas com granizo',
};

interface Weather { tmin: number; tmax: number; desc: string; city: string; }

/**
 * Busca a previsão do dia via Open-Meteo (grátis, sem chave). Retorna null em falha.
 *
 * BUG CORRIGIDO: a busca de geocodificação tem VÁRIAS cidades chamadas "Vitória"
 * no mundo (Espanha, Portugal, e duas no Brasil — ES e PE) e o parâmetro
 * `country=BR` da API não filtra de fato (confirmado testando direto) — o
 * primeiro resultado vinha sendo Vitoria-Gasteiz, Espanha. Por isso o e-mail
 * às vezes mostrava "não consegui obter a previsão" (coordenadas erradas
 * geravam respostas inconsistentes) e, pior, poderia mostrar clima errado
 * sem avisar. Agora filtra explicitamente por country_code==='BR' e prioriza
 * Espírito Santo; se a geocodificação falhar, cai nas coordenadas fixas.
 */
async function fetchWithTimeout(url: string, ms = 8000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    return await r.json();
  } finally { clearTimeout(t); }
}

async function getWeather(): Promise<Weather | null> {
  try {
    let lat = FALLBACK_LAT, lon = FALLBACK_LON, cityName = CITY;
    try {
      const geo: any = await fetchWithTimeout(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(CITY)}&count=10&language=pt&country=BR`
      );
      const candidatos = (geo?.results || []).filter((r: any) => r.country_code === 'BR');
      const loc = candidatos.find((r: any) => r.admin1 === 'Espírito Santo') || candidatos[0];
      if (loc) { lat = loc.latitude; lon = loc.longitude; cityName = loc.name; }
    } catch (e: any) { console.error('[briefing] geocoding falhou, usando coordenadas fixas de Vitória/ES:', e?.message || e); }

    const f: any = await fetchWithTimeout(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=America%2FSao_Paulo&forecast_days=1`
    );
    const d = f?.daily;
    if (!d) { console.error('[briefing] previsão sem campo "daily" na resposta:', JSON.stringify(f).slice(0, 300)); return null; }
    return {
      tmin: Math.round(d.temperature_2m_min?.[0]),
      tmax: Math.round(d.temperature_2m_max?.[0]),
      desc: WMO[d.weather_code?.[0]] || 'tempo variável',
      city: cityName,
    };
  } catch (e: any) { console.error('[briefing] falha ao buscar a previsão do tempo:', e?.message || e); return null; }
}

const horaBR = "TIME_FORMAT(CONVERT_TZ(%s, '+00:00', '-03:00'), '%H:%i')";
const hojeBR = "DATE(CONVERT_TZ(%s, '+00:00', '-03:00')) = DATE(CONVERT_TZ(NOW(), '+00:00', '-03:00'))";

/** Coleta os compromissos, prazos e tarefas de HOJE (fuso de Brasília) de um usuário. */
async function getDayAgenda(userId: number) {
  const [eventos] = await db.query(
    `SELECT title, event_type, location, video_link,
            TIME_FORMAT(CONVERT_TZ(start_datetime,'+00:00','-03:00'),'%H:%i') AS hora
       FROM calendar_events
      WHERE user_id = ? AND DATE(CONVERT_TZ(start_datetime,'+00:00','-03:00')) = DATE(CONVERT_TZ(NOW(),'+00:00','-03:00'))
      ORDER BY start_datetime ASC`, [userId]) as any;

  const [prazos] = await db.query(
    `SELECT d.description, c.case_number, c.title AS case_title
       FROM deadlines d LEFT JOIN cases c ON c.id = d.case_id
      WHERE d.user_id = ? AND d.status = 'pendente'
        AND DATE(CONVERT_TZ(d.deadline_date,'+00:00','-03:00')) = DATE(CONVERT_TZ(NOW(),'+00:00','-03:00'))`, [userId]) as any;

  const [tarefas] = await db.query(
    `SELECT title, priority FROM tasks
      WHERE user_id = ? AND status NOT IN ('concluida','cancelada')
        AND due_date IS NOT NULL
        AND DATE(CONVERT_TZ(due_date,'+00:00','-03:00')) = DATE(CONVERT_TZ(NOW(),'+00:00','-03:00'))
      ORDER BY FIELD(priority,'critica','alta','media','baixa')`, [userId]) as any;

  return { eventos, prazos, tarefas };
}

/** Dicas do dia conforme o clima — em tom de cuidado. */
function weatherTip(w: Weather | null): string {
  if (!w) return 'Respire fundo, organize as prioridades e cuide de você hoje. 💛';
  const d = w.desc.toLowerCase();
  const tips: string[] = [];
  if (w.tmin <= 14) tips.push('A manhã está fria — agasalhe-se bem ao sair. 🧥');
  else if (w.tmax <= 20) tips.push('Vai esfriar durante o dia — não esqueça um casaco. 🧥');
  if (w.tmax >= 31) tips.push('Dia quente — beba bastante água e use protetor solar. ☀️');
  if (/chuva|garoa|pancadas|trovoad/.test(d)) tips.push('Tem chuva na previsão — leve o guarda-chuva. ☔');
  if (/limpo|sol/.test(d) && w.tmax >= 27) tips.push('Tempo seco e ensolarado — capriche na hidratação. 💧');
  if (/névoa/.test(d)) tips.push('Pode haver névoa cedo — atenção redobrada no trânsito. 🚗');
  if (!tips.length) tips.push('Tempo agradável pela frente — aproveite o dia. 😊');
  tips.push('E lembre-se: cuide de você também. 💛');
  return tips.join(' ');
}

// ── Frase de força do dia ────────────────────────────────────────────────
// Gira uma por dia do ano (sem repetir por ~2 meses) — lembrete curto de
// força/consistência, não conselho genérico de autoajuda solto no ar.
const FRASES_FORCA = [
  'Escritório não se constrói em um dia só — se constrói em dias como hoje.',
  'Você já resolveu o que parecia impossível antes. Hoje é só mais um dia de trabalho bem feito.',
  'Cuidar do seu corpo também é cuidar do seu escritório — os dois dependem de você inteira.',
  'Nem todo dia precisa ser produtivo do jeito que você imagina. Constante já é muito.',
  'Cada cliente que você atende hoje é resultado do trabalho que você não largou ontem.',
  'Descansar não é parar — é parte de continuar por mais tempo.',
  'Você não precisa dar conta de tudo hoje. Precisa dar o próximo passo certo.',
  'A advocacia que você está construindo tem a sua marca porque você não desistiu nos dias difíceis.',
  'Um corpo cuidado sustenta uma mente que decide bem. Não deixe isso pra depois.',
  'O escritório cresce nas escolhas pequenas do dia a dia, não só nas grandes decisões.',
  'Você já é a referência que outras mulheres buscam — trate a si mesma com o mesmo cuidado que oferece às suas clientes.',
  'Foco no que está sob seu controle hoje. O resto se organiza andando.',
  'Progresso de verdade é silencioso — ninguém vê os dias comuns que sustentam os grandes resultados.',
  'Beber água, se alongar, respirar fundo: pequenos atos que sustentam uma advogada inteira.',
  'Todo processo que você ganhou começou como um caso difícil que ninguém sabia se ia dar certo.',
  'Você não precisa se sentir pronta o tempo todo — precisa continuar aparecendo, mesmo cansada.',
  'A cliente que te procura hoje está confiando o problema dela em mãos que já resolveram muitos outros.',
  'Um escritório sólido nasce de mil decisões pequenas tomadas com calma, uma de cada vez.',
  'Você troca de assunto o dia inteiro — trabalhista de manhã, família à tarde — e ainda assim entrega qualidade. Isso é raro.',
  'Ninguém constrói uma advocacia de referência sem aprender a dizer "hoje eu paro por aqui".',
  'O cansaço de hoje é prova de que você apareceu. Ele passa; o trabalho feito fica.',
  'Cuidar da sua saúde não compete com o escritório — é o que garante que o escritório continue existindo.',
  'Cada contrato assinado é alguém que escolheu você entre todas as opções que tinha. Não é pouco.',
  'Você não precisa provar nada hoje que já não tenha provado nos últimos anos de trabalho.',
  'Cansaço, prazo apertado, cliente ansiosa — nada disso muda o fato de que você sabe o que está fazendo.',
  'A advocacia que cuida de gente também precisa cuidar de quem advoga. Comece por você hoje.',
  'Dias difíceis fazem parte do ofício. O que te diferencia é continuar mesmo neles.',
  'Você não está atrasada — está no seu próprio ritmo, e ele tem sustentado um escritório inteiro.',
  'Uma decisão bem tomada hoje vale mais que dez decisões apressadas. Respire antes de responder.',
  'O que parece pequeno — responder rápido, documentar direito, ligar de volta — é o que fideliza clientes.',
  'Ser referência para outras mulheres começa em como você trata a si mesma nos dias corridos.',
  'Nem toda vitória é uma sentença favorável. Às vezes é simplesmente não ter desistido esta semana.',
  'Você aprendeu sozinha grande parte do que sabe hoje sobre gerir um escritório. Confie nesse repertório.',
  'Descanso não tirado hoje vira erro cometido amanhã. Cuide da sua energia como cuida dos seus prazos.',
  'O escritório que você sonhou começou exatamente com dias como este — comuns, cheios, e ainda assim cumpridos.',
  'Cada prazo cumprido é um tijolo na reputação que você está construindo há anos.',
  'Você não precisa fazer tudo perfeito — precisa fazer o suficiente bem feito, todos os dias.',
  'Existe força em pedir ajuda quando o volume aperta. Delegar também é cuidar do escritório.',
  'A confiança que suas clientes têm em você não nasceu num dia — nasceu de constância.',
  'Hoje pode ser só mais um dia de trabalho. E está tudo bem que seja assim.',
  'Você já superou audiências difíceis, clientes em crise e prazos apertados. Isso também passa.',
  'Um corpo descansado toma decisões melhores que um corpo exausto. Durma bem hoje à noite.',
  'O tempo que você investe organizando hoje é tempo que você não vai perder apagando incêndio amanhã.',
  'Ser dona do próprio negócio é também ter a liberdade de ajustar o ritmo quando for preciso.',
  'Nenhuma advogada de sucesso chegou lá sem também errar, aprender e ajustar o rumo.',
  'Você constrói autoridade toda vez que explica o direito de alguém com clareza e paciência.',
  'O que hoje parece rotina, daqui a um ano vai parecer o alicerce de tudo que você conquistou.',
  'Cuidar de si não é luxo de quem tem tempo sobrando — é estratégia de quem quer durar.',
  'Escritório de mulher também cresce com delicadeza, não só com força bruta.',
  'Uma boa noite de sono vale mais do que uma madrugada inteira revisando o mesmo parágrafo.',
  'Você não trabalha sozinha — trabalha com anos de estudo, experiência e casos resolvidos atrás de você.',
  'Nem tudo precisa ser resolvido antes do meio-dia. Priorize o que realmente importa hoje.',
  'A calma com que você atende uma cliente ansiosa também é parte do seu trabalho jurídico.',
  'Você já disse "não" quando precisou e "sim" quando valia a pena. Continue confiando nesse critério.',
  'Ser referência é também mostrar que dá pra ter um escritório de sucesso sem abrir mão de si mesma.',
  'O que você faz hoje por um cliente, ele vai lembrar e contar pra outras pessoas amanhã.',
  'Você não precisa correr o dia inteiro para ser produtiva — precisa saber o que é prioridade.',
  'Cada processo que passa pela sua mesa carrega uma vida real esperando um desfecho justo. Isso tem peso — e propósito.',
];
function fraseDoDia(): string {
  const inicioAno = new Date(new Date().getFullYear(), 0, 0);
  const hoje = new Date();
  const diaDoAno = Math.floor((hoje.getTime() - inicioAno.getTime()) / 86_400_000);
  return FRASES_FORCA[diaDoAno % FRASES_FORCA.length];
}

/**
 * COPILOTO: pulso do negócio — o que precisa da atenção da advogada HOJE,
 * além da agenda: leads esfriando, dinheiro vencendo, esteira travada,
 * e-mails de parceria esperando revisão. Uma consulta por bloco, global.
 */
export async function getPulsoNegocio() {
  const one = async (sql: string) => { const [[r]] = await db.query(sql) as any; return r; };

  const leads = await one(`
    SELECT COUNT(*) AS n FROM leads
     WHERE status IN ('triagem','atendimento_inicial')
       AND updated_at < DATE_SUB(NOW(), INTERVAL 48 HOUR)`).catch(() => ({ n: 0 }));

  // As mesmas fontes que faltavam nos outros relatórios (auditoria financeira
  // do dia): parcelas de contrato, êxitos e correspondente do lado a receber;
  // cashflow_entries (Contas a Pagar) do lado a pagar — filtrado por
  // escopo='empresa' para não misturar despesa pessoal da família aqui também.
  const fin = await one(`
    SELECT
      (SELECT COALESCE(SUM(valor),0) FROM financial_records WHERE tipo='receita' AND status='pendente' AND escopo='empresa' AND due_date <= CURDATE())
      + (SELECT COALESCE(SUM(valor),0) FROM installments WHERE status='pendente' AND due_date <= CURDATE())
      + (SELECT COALESCE(SUM(valor_final),0) FROM parcelas WHERE status IN ('aberto','atrasado','parcial') AND data_vencimento <= CURDATE())
      + (SELECT COALESCE(SUM(value),0) FROM dative_payments WHERE status='previsto' AND expected_date <= CURDATE())
      + (SELECT COALESCE(SUM(value),0) FROM correspondent_hearings WHERE status IN ('agendada','realizada','faturada') AND due_date <= CURDATE())
      + (SELECT COALESCE(SUM(valor_escritorio),0) FROM case_awards WHERE status='aguardando' AND previsao_pagamento <= CURDATE()) AS vence_hoje,
      (SELECT COALESCE(SUM(valor),0) FROM financial_records WHERE tipo='despesa' AND status='pendente' AND escopo='empresa' AND due_date <= CURDATE())
      + (SELECT COALESCE(SUM(amount),0) FROM cashflow_entries WHERE type='saida' AND status='previsto' AND escopo='empresa' AND due_date <= CURDATE())
      + (SELECT COALESCE(SUM(valor),0) FROM repasses WHERE status IN ('pendente','processando') AND data_vencimento <= CURDATE()) AS pagar_hoje`)
    .catch(() => ({ vence_hoje: 0, pagar_hoje: 0 }));

  const esteira = await one(`
    SELECT COUNT(*) AS n FROM cases
     WHERE production_stage IN ('em_analise','separacao_documentos','criacao_inicial','revisao_inicial','aguardando_protocolo')
       AND DATEDIFF(NOW(), production_started_at) > 10`).catch(() => ({ n: 0 }));

  const emails = await one(`SELECT COUNT(*) AS n FROM email_imports WHERE status = 'pendente'`).catch(() => ({ n: 0 }));

  return {
    leads_frios: Number(leads.n) || 0,
    receber_vencido_hoje: Math.round((Number(fin.vence_hoje) || 0) * 100) / 100,
    pagar_vencido_hoje: Math.round((Number(fin.pagar_hoje) || 0) * 100) / 100,
    casos_atrasados: Number(esteira.n) || 0,
    emails_parceria_pendentes: Number(emails.n) || 0,
  };
}

interface AgendaItem {
  titulo: string; tipo: string; data: string; hora: string;
  local: string | null; videoLink: string | null; severity: Severity;
}

/** Agenda de hoje + 3 dias (antes só trazia hoje). */
export async function getAgenda3Dias(userId: number): Promise<AgendaItem[]> {
  const [rows] = await db.query(
    `SELECT title, event_type, location, video_link,
            DATE(CONVERT_TZ(start_datetime,'+00:00','-03:00')) AS data,
            TIME_FORMAT(CONVERT_TZ(start_datetime,'+00:00','-03:00'),'%H:%i') AS hora,
            DATEDIFF(DATE(CONVERT_TZ(start_datetime,'+00:00','-03:00')), DATE(CONVERT_TZ(NOW(),'+00:00','-03:00'))) AS diasAteEvento
       FROM calendar_events
      WHERE user_id = ?
        AND DATE(CONVERT_TZ(start_datetime,'+00:00','-03:00'))
            BETWEEN DATE(CONVERT_TZ(NOW(),'+00:00','-03:00')) AND DATE_ADD(DATE(CONVERT_TZ(NOW(),'+00:00','-03:00')), INTERVAL 3 DAY)
      ORDER BY start_datetime ASC`, [userId]) as any;
  return rows.map((r: any) => ({
    titulo: r.title, tipo: r.event_type, data: r.data, hora: r.hora,
    local: r.location, videoLink: r.video_link,
    severity: classificarAgenda(Number(r.diasAteEvento) === 0),
  }));
}

/** Prazos PENDENTES do usuário na janela hoje→+7 dias ("faixa"), com diasParaVencer calculado. */
export async function getPrazosPorFaixa(userId: number): Promise<{ description: string; case_number: string | null; diasParaVencer: number }[]> {
  const [rows] = await db.query(
    `SELECT d.description, c.case_number,
            DATEDIFF(DATE(CONVERT_TZ(d.deadline_date,'+00:00','-03:00')), DATE(CONVERT_TZ(NOW(),'+00:00','-03:00'))) AS diasParaVencer
       FROM deadlines d LEFT JOIN cases c ON c.id = d.case_id
      WHERE d.user_id = ? AND d.status = 'pendente'
        AND DATE(CONVERT_TZ(d.deadline_date,'+00:00','-03:00')) BETWEEN DATE(CONVERT_TZ(NOW(),'+00:00','-03:00')) AND DATE_ADD(DATE(CONVERT_TZ(NOW(),'+00:00','-03:00')), INTERVAL 7 DAY)
      ORDER BY d.deadline_date ASC`, [userId]) as any;
  return rows.map((r: any) => ({ description: r.description, case_number: r.case_number, diasParaVencer: Number(r.diasParaVencer) || 0 }));
}

interface FinanceiroGranular {
  aReceberHoje: number; rpvSemana: number; recebido7d: number; alvarasAguardando: number;
}

/** Financeiro desagregado por tipo (antes era um único total no "Pulso"). */
export async function getFinanceiroGranular(): Promise<FinanceiroGranular> {
  const one = async (sql: string) => { const [[r]] = await db.query(sql) as any; return r; };
  const r = await one(`
    SELECT
      (SELECT COALESCE(SUM(valor),0) FROM installments WHERE status='pendente' AND due_date = CURDATE())
      + (SELECT COALESCE(SUM(valor_final),0) FROM parcelas WHERE status IN ('aberto','atrasado') AND data_vencimento = CURDATE())
        AS a_receber_hoje,
      (SELECT COALESCE(SUM(valor_escritorio),0) FROM case_awards WHERE status='aguardando' AND previsao_pagamento BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY))
        AS rpv_semana,
      (SELECT COALESCE(SUM(valor),0) FROM installments WHERE status='pago' AND updated_at >= NOW() - INTERVAL 7 DAY)
      + (SELECT COALESCE(SUM(valor_final),0) FROM parcelas WHERE status='pago' AND atualizado_em >= NOW() - INTERVAL 7 DAY)
        AS recebido_7d,
      (SELECT COUNT(*) FROM case_awards WHERE kind='alvara' AND status='aguardando')
        AS alvaras_aguardando
  `).catch(() => ({ a_receber_hoje: 0, rpv_semana: 0, recebido_7d: 0, alvaras_aguardando: 0 }));
  return {
    aReceberHoje: Number(r.a_receber_hoje) || 0,
    rpvSemana: Number(r.rpv_semana) || 0,
    recebido7d: Number(r.recebido_7d) || 0,
    alvarasAguardando: Number(r.alvaras_aguardando) || 0,
  };
}

interface LeadNovo { nome: string; area: string; origem: string; criadoEm: Date; }
interface Aniversariante { nome: string; }

/** Leads criados desde o último briefing + aniversariantes de clientes hoje. */
export async function getComercialDoDia(): Promise<{ leadsNovos: LeadNovo[]; aniversariantes: Aniversariante[] }> {
  const [leads] = await db.query(`
    SELECT name AS nome, COALESCE(legal_area, 'não informada') AS area, COALESCE(source, 'não informado') AS origem, created_at AS criadoEm
      FROM leads
     WHERE created_at >= NOW() - INTERVAL 1 DAY
     ORDER BY created_at DESC`).catch(() => [[]]) as any;
  const [aniversariantes] = await db.query(`
    SELECT name AS nome FROM clients
     WHERE birth_date IS NOT NULL
       AND MONTH(birth_date) = MONTH(CURDATE()) AND DAY(birth_date) = DAY(CURDATE())`).catch(() => [[]]) as any;
  return { leadsNovos: leads, aniversariantes };
}

interface PecaPendente { caso: string; fase: string; diasParado: number; severity: Severity; }
interface DocumentoPendente { caso: string; itensFaltando: string[]; }

/** Casos parados na esteira de produção + documentos ainda não marcados no checklist. */
export async function getEsteiraEDocumentos(): Promise<{ pecasAProduzir: PecaPendente[]; documentosPendentes: DocumentoPendente[] }> {
  const [casos] = await db.query(`
    SELECT id, title AS caso, production_stage AS fase,
           DATEDIFF(NOW(), production_started_at) AS diasParado
      FROM cases
     WHERE production_stage IN ('separacao_documentos','criacao_inicial','revisao_inicial','aguardando_protocolo')
       AND production_started_at IS NOT NULL
     ORDER BY production_started_at ASC`) as any;

  const pecasAProduzir: PecaPendente[] = casos.map((c: any) => ({
    caso: c.caso, fase: c.fase, diasParado: Number(c.diasParado) || 0,
    severity: classificarEsteira(Number(c.diasParado) || 0),
  }));

  const documentosPendentes: DocumentoPendente[] = [];
  for (const c of casos.filter((c: any) => c.fase === 'separacao_documentos')) {
    const checklist = await buildCaseChecklist(c.id).catch(() => null);
    if (!checklist) continue;
    const itensFaltando = checklist.itens.filter((item) => !item.done).map((item) => item.label);
    if (itensFaltando.length > 0) documentosPendentes.push({ caso: c.caso, itensFaltando });
  }

  return { pecasAProduzir, documentosPendentes };
}

function pulsoHtml(p: any): string {
  const money = (n: number) => `R$ ${(Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const itens: string[] = [];
  if (p.leads_frios) itens.push(`<li>🔥 <strong>${p.leads_frios} lead(s) sem resposta há mais de 48h</strong> — responder rápido converte mais.</li>`);
  if (p.receber_vencido_hoje > 0) itens.push(`<li>💰 <strong>${money(p.receber_vencido_hoje)}</strong> a receber vencendo até hoje — cobre no A Receber.</li>`);
  if (p.pagar_vencido_hoje > 0) itens.push(`<li>📤 <strong>${money(p.pagar_vencido_hoje)}</strong> a pagar até hoje (despesas + repasses).</li>`);
  if (p.casos_atrasados) itens.push(`<li>⏱ <strong>${p.casos_atrasados} caso(s) estourando o SLA de 10 dias</strong> na esteira de produção.</li>`);
  if (p.emails_parceria_pendentes) itens.push(`<li>📥 <strong>${p.emails_parceria_pendentes} e-mail(s) da parceria</strong> aguardando revisão na fila.</li>`);
  if (!itens.length) return `<p style="color:#2f8f63;font-size:14px">✅ Nenhuma pendência urgente — o escritório está em dia!</p>`;
  return `<ul style="line-height:1.9;padding-left:18px;margin:8px 0;color:#232323">${itens.join('')}</ul>`;
}

function metaHtml(meta: GoalProgress): string {
  const money = (n: number) => `R$ ${(Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const pct = Math.min(100, meta.percent);
  const cor = meta.percent >= 100 ? '#2f8f63' : GOLD;
  return `
    <div style="background:${NAVY_SOFT};border-radius:8px;padding:16px 18px;margin:8px 0 18px">
      <div style="display:flex;justify-content:space-between;font-size:13.5px;color:#232323;margin-bottom:8px">
        <span><strong>${money(meta.current)}</strong> de ${money(meta.target)}</span>
        <strong style="color:${cor}">${meta.percent}%</strong>
      </div>
      <div style="background:#ddd;border-radius:6px;height:8px;overflow:hidden">
        <div style="background:${cor};height:8px;width:${pct}%"></div>
      </div>
      <div style="font-size:12.5px;color:#6b6252;margin-top:8px">
        ${meta.percent >= 100 ? '🎉 Meta do mês batida!' : `Faltam ${money(meta.faltam)} para bater a meta de ${new Date().toLocaleDateString('pt-BR', { month: 'long' })}.`}
        · ${meta.contratos_fechados_mes} contrato(s) protocolado(s) no mês.
      </div>
    </div>`;
}

interface MovimentacaoBriefing {
  processo: string; clienteVsParte: string; resumo: string; acao: string;
  prazoInterno: string; severity: Severity;
}

export function buildHtml(
  name: string, weather: Weather | null, agenda: any, pulso: any, meta: GoalProgress,
  agenda3d: AgendaItem[], financeiro: FinanceiroGranular,
  comercial: { leadsNovos: LeadNovo[]; aniversariantes: Aniversariante[] },
  esteira: { pecasAProduzir: PecaPendente[]; documentosPendentes: DocumentoPendente[] },
  movimentacoes: MovimentacaoBriefing[],
  prazosPorFaixa: { description: string; case_number: string | null; diasParaVencer: number }[] = []
): string {
  // pulso não é mais renderizado diretamente aqui — o conteúdo dele (leads frios,
  // a receber, casos atrasados, e-mails pendentes) já está coberto pelos blocos
  // de severidade 🔴🟠🟢 acima, de forma mais específica e acionável.
  const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' });
  const money = (n: number) => `R$ ${(Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const tipoLabel: Record<string, string> = { reuniao: '🤝 Reunião', audiencia: '⚖️ Audiência', compromisso: '📌 Compromisso' };

  // Cor de borda por severidade (mesma lógica usada nos 3 blocos de item abaixo).
  const corSeveridade = (s: Severity) => s === 'critica' ? CRITICAL : s === 'atencao' ? WARNING : OK_STRONG;

  const itemHtml = (tituloHtml: string, metaHtml: string, severity: Severity, acaoHtml?: string) => `
    <div style="border-left:3px solid ${corSeveridade(severity)};padding:9px 0 9px 14px;margin-bottom:2px${severity === 'critica' ? `;background:linear-gradient(90deg,${CRITICAL_SOFT},transparent 70%)` : ''}">
      <p style="margin:0 0 3px;color:#232323;font-size:${severity === 'critica' ? '14.5px;font-weight:700' : '13.5px'};line-height:1.45">${tituloHtml}</p>
      ${metaHtml ? `<p style="margin:0;font-size:12px;color:#6b6252;line-height:1.5">${metaHtml}</p>` : ''}
      ${acaoHtml ? `<div style="margin:6px 0 0;font-size:12.5px;color:${NAVY};background:${NAVY_SOFT};display:inline-block;padding:5px 10px;border-radius:6px">${acaoHtml}</div>` : ''}
    </div>`;

  // Monta os itens tipados (Task 4: briefingSeverity) para agrupar por severidade.
  const itensAgenda = agenda3d.map((a) => ({
    html: itemHtml(
      `${tipoLabel[a.tipo] || '📌'} ${esc(a.titulo)}`,
      `${a.data} ${a.hora}${a.local ? ` · ${esc(a.local)}` : ''}${a.videoLink ? ' · online' : ''}`,
      a.severity
    ),
    severity: a.severity,
  }));
  const itensMovimentacao = movimentacoes.map((m) => ({
    html: itemHtml(
      esc(m.clienteVsParte),
      `Proc. ${esc(m.processo)} · ${esc(m.resumo)}`,
      m.severity,
      m.acao && m.acao !== 'nenhuma' ? `<b>Ação:</b> ${esc(m.acao)}${m.prazoInterno && m.prazoInterno !== 'sem prazo' ? ` · <b>prazo interno ${esc(m.prazoInterno)}</b>` : ''}` : undefined
    ),
    severity: m.severity,
  }));
  const itensPagamento = financeiro.aReceberHoje > 0 ? [{
    html: itemHtml(`${money(financeiro.aReceberHoje)} a receber vencendo hoje`, '', classificarPagamento(0)),
    severity: classificarPagamento(0),
  }] : [];
  // Prazos por faixa (hoje/amanhã/3 dias/semana) — classificarPrazo(diasParaVencer)
  // usa o valor real calculado em getPrazosPorFaixa (antes era classificarPrazo(0)
  // fixo, porque só existiam prazos de HOJE).
  const itensPrazo = prazosPorFaixa.map((p) => ({
    html: itemHtml(`⏰ Prazo: ${esc(p.description)}`, p.case_number ? `Proc. ${esc(p.case_number)}` : '', classificarPrazo(p.diasParaVencer)),
    severity: classificarPrazo(p.diasParaVencer),
  }));
  const itensEsteira = esteira.pecasAProduzir.map((p) => ({
    html: itemHtml(`${esc(p.caso)} — parado há ${p.diasParado} dia(s)`, `Fase: ${esc(p.fase)}`, p.severity),
    severity: p.severity,
  }));

  const todosItens = [...itensAgenda, ...itensPrazo, ...itensMovimentacao, ...itensPagamento, ...itensEsteira];
  const criticos = todosItens.filter((i) => i.severity === 'critica');
  const atencao = todosItens.filter((i) => i.severity === 'atencao');
  const acompanhamento = todosItens.filter((i) => i.severity === 'acompanhamento');

  const sevBlock = (titulo: string, emoji: string, cor: string, fundo: string, itens: typeof todosItens, id: string) =>
    itens.length ? `
    <div style="margin:0 0 22px" id="${id}">
      <div style="display:flex;align-items:center;gap:8px;margin:0 0 12px;padding:7px 12px;border-radius:7px;background:linear-gradient(90deg,${fundo},transparent)">
        <span style="width:9px;height:9px;border-radius:50%;background:${cor};display:inline-block;flex:none"></span>
        <h2 style="font-family:Georgia,serif;margin:0;font-size:15px;color:${cor};flex:1">${emoji} ${titulo}</h2>
        <span style="font-family:Arial,sans-serif;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:${fundo};color:${cor}">${itens.length}</span>
      </div>
      ${itens.map((i) => i.html).join('')}
    </div>` : '';

  const agendaListaHtml = agenda3d.map((a) =>
    `<div style="display:flex;gap:10px;padding:7px 0;border-bottom:1px solid #f1ede4;font-size:13px">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#6b6252;width:74px;flex:none;padding-top:2px">${a.data}</div>
      <div style="font-weight:700;color:${NAVY};width:42px;flex:none">${a.hora}</div>
      <div>${tipoLabel[a.tipo] || '📌'} ${esc(a.titulo)}${a.local ? ` <span style="display:inline-block;font-size:10px;font-weight:700;padding:1px 7px;border-radius:999px;margin-left:6px;background:${WARNING_SOFT};color:${WARNING}">presencial</span>` : a.videoLink ? ` <span style="display:inline-block;font-size:10px;font-weight:700;padding:1px 7px;border-radius:999px;margin-left:6px;background:${OK_SOFT};color:${OK_STRONG}">online</span>` : ''}</div>
    </div>`
  ).join('') || '<p style="color:#6b6252;font-size:13px">Sem compromissos nos próximos 3 dias.</p>';

  const comercialHtml = [
    ...comercial.leadsNovos.map((l) => `<div style="display:flex;gap:10px;padding:7px 0;border-bottom:1px solid #f1ede4;font-size:13px"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#6b6252;width:74px;flex:none;padding-top:2px">Novo lead</div><div>${esc(l.nome)} — ${esc(l.area)} · ${esc(l.origem)}</div></div>`),
    ...comercial.aniversariantes.map((a) => `<div style="display:flex;gap:10px;padding:7px 0;border-bottom:1px solid #f1ede4;font-size:13px"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#6b6252;width:74px;flex:none;padding-top:2px">🎂 Hoje</div><div>Aniversário de ${esc(a.nome)} (cliente)</div></div>`),
  ].join('') || '<p style="color:#6b6252;font-size:13px">Nada novo hoje.</p>';

  const documentosPendentesHtml = esteira.documentosPendentes.length ? `
    <h3 style="color:${NAVY};font-size:15px;margin:22px 0 8px;font-family:Georgia,serif">📄 Documentos pendentes</h3>
    ${esteira.documentosPendentes.map((d) => `<p style="margin:0 0 6px;font-size:13px;color:#232323"><b>${esc(d.caso)}:</b> ${d.itensFaltando.map(esc).join(', ')}</p>`).join('')}` : '';

  const podeEsperarPartes: string[] = [];
  if (esteira.pecasAProduzir.some((p) => p.severity === 'pode_esperar'))
    podeEsperarPartes.push(`${esteira.pecasAProduzir.filter((p) => p.severity === 'pode_esperar').length} caso(s) na esteira sem prazo em risco.`);
  const podeEsperarHtml = podeEsperarPartes.length
    ? `<h3 style="font-family:Georgia,serif;color:#6b6252;font-size:12px;margin:22px 0 5px">⚪ Pode esperar</h3><p style="font-size:12px;color:#6b6252;line-height:1.7;font-style:italic;opacity:.8;margin:0">${podeEsperarPartes.map((p) => `<span style="display:block">${p}</span>`).join('')}</p>`
    : '';

  // "3 prioridades do dia" — usa o classificador determinístico (Task 4), não uma nova síntese
  // por IA. Inclui TODOS os kinds que podem ser críticos (prazo e pagamento também, não só
  // movimentação/agenda — prazo é o de MAIOR peso em PESO_KIND, precisa poder vencer o desempate).
  const briefingItems: BriefingItem[] = [
    ...prazosPorFaixa.filter((p) => classificarPrazo(p.diasParaVencer) === 'critica').map((p, idx) => ({ id: `prazo-${idx}`, kind: 'prazo' as const, label: `Prazo: ${p.description}${p.case_number ? ` (proc. ${p.case_number})` : ''}`, severity: 'critica' as const, ordemDesempate: idx })),
    ...movimentacoes.filter((m) => m.severity === 'critica').map((m, idx) => ({ id: `mov-${idx}`, kind: 'movimentacao' as const, label: `${m.acao} — ${m.clienteVsParte}`, severity: m.severity, ordemDesempate: idx })),
    ...agenda3d.filter((a) => a.severity === 'critica').map((a, idx) => ({ id: `ag-${idx}`, kind: 'agenda' as const, label: `${a.titulo}, ${a.hora}`, severity: a.severity, ordemDesempate: idx })),
    ...(financeiro.aReceberHoje > 0 ? [{ id: 'pag-0', kind: 'pagamento' as const, label: `Cobrar ${money(financeiro.aReceberHoje)} vencendo hoje`, severity: 'critica' as const, ordemDesempate: 0 }] : []),
  ];
  const top3Items = top3(briefingItems);
  const top3Html = top3Items.length ? `
    <div style="margin-top:24px;background:${NAVY};border-radius:10px;padding:20px 22px;color:#fff">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:${GOLD};font-weight:700;font-family:Arial,sans-serif;margin-bottom:10px">🎯 Se você fizer só 3 coisas hoje</div>
      <ol style="margin:0;padding-left:20px">${top3Items.map((i: BriefingItem) => `<li style="font-family:Georgia,serif;font-size:14.5px;line-height:1.7;margin-bottom:4px">${esc(i.label)}</li>`).join('')}</ol>
    </div>` : '';

  const body = `
    <div style="font-size:12px;color:${GOLD};text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:2px">${hoje}</div>
    <p style="font-size:19px;font-weight:700;color:${NAVY};margin:0 0 16px">Bom dia, Dra. ${name}! ☀️</p>

    <div style="background:${GOLD_SOFT};border-radius:8px;padding:16px 18px;margin-bottom:16px">
      <div style="font-size:9px;color:#8a6d1a;text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:6px">Frase de força do dia</div>
      <p style="margin:0;font-size:14.5px;line-height:1.6;color:#4a3d1d;font-style:italic">"${fraseDoDia()}"</p>
    </div>

    <p style="font-size:14.5px;color:#232323">${weather ? `A previsão para <strong>${weather.city}</strong> hoje é de <strong>${weather.tmin}°C a ${weather.tmax}°C</strong>, com ${weather.desc}.` : '(Não consegui obter a previsão do tempo agora.)'}</p>
    <div style="background:${NAVY_SOFT};border-radius:8px;padding:12px 16px;margin:12px 0 18px;font-size:13.5px;color:#232323">
      <strong style="color:${NAVY}">💡 Dica do dia:</strong> ${weatherTip(weather)}
    </div>

    ${criticos.length || atencao.length || acompanhamento.length ? `
    <div style="display:flex;gap:8px;margin:0 0 26px">
      <a href="#atencao" style="flex:1;text-align:center;text-decoration:none;padding:9px 4px 8px;border-radius:8px;background:${CRITICAL_SOFT};color:${CRITICAL}"><span style="display:block;font-size:17px;font-weight:700">${criticos.length}</span><span style="display:block;font-size:9.5px;text-transform:uppercase">atenção</span></a>
      <a href="#atencao2" style="flex:1;text-align:center;text-decoration:none;padding:9px 4px 8px;border-radius:8px;background:${WARNING_SOFT};color:${WARNING}"><span style="display:block;font-size:17px;font-weight:700">${atencao.length}</span><span style="display:block;font-size:9.5px;text-transform:uppercase">prioridade</span></a>
      <a href="#acompanhamento" style="flex:1;text-align:center;text-decoration:none;padding:9px 4px 8px;border-radius:8px;background:${OK_SOFT};color:${OK_STRONG}"><span style="display:block;font-size:17px;font-weight:700">${acompanhamento.length}</span><span style="display:block;font-size:9.5px;text-transform:uppercase">acompanhar</span></a>
    </div>` : ''}

    ${sevBlock('Atenção imediata', '🔴', CRITICAL, CRITICAL_SOFT, criticos, 'atencao')}
    ${sevBlock('Prioridade do dia', '🟠', WARNING, WARNING_SOFT, atencao, 'atencao2')}
    ${sevBlock('Acompanhamento', '🟢', OK_STRONG, OK_SOFT, acompanhamento, 'acompanhamento')}

    <hr style="border:none;border-top:1px solid #e2ddd1;margin:26px 0">

    <h3 style="color:${NAVY};font-size:15px;margin:0 0 8px;font-family:Georgia,serif">🎯 Meta do mês</h3>
    ${metaHtml(meta)}

    <h3 style="color:${NAVY};font-size:15px;margin:22px 0 8px;font-family:Georgia,serif">📅 Agenda — hoje e próximos 3 dias</h3>
    ${agendaListaHtml}

    ${documentosPendentesHtml}

    <h3 style="color:${NAVY};font-size:15px;margin:22px 0 8px;font-family:Georgia,serif">💰 Financeiro</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:6px 0 4px">
      <div style="background:${NAVY_SOFT};border-radius:8px;padding:12px 14px;border-left:3px solid ${CRITICAL}"><div style="font-size:16px;font-weight:700;color:${NAVY}">${money(financeiro.aReceberHoje)}</div><div style="font-size:11px;color:#6b6252">a receber vencendo hoje</div></div>
      <div style="background:${NAVY_SOFT};border-radius:8px;padding:12px 14px;border-left:3px solid ${NAVY}"><div style="font-size:16px;font-weight:700;color:${NAVY}">${money(financeiro.rpvSemana)}</div><div style="font-size:11px;color:#6b6252">RPV prevista esta semana</div></div>
      <div style="background:${NAVY_SOFT};border-radius:8px;padding:12px 14px;border-left:3px solid ${OK_STRONG}"><div style="font-size:16px;font-weight:700;color:${NAVY}">${money(financeiro.recebido7d)}</div><div style="font-size:11px;color:#6b6252">recebido nos últimos 7 dias</div></div>
      <div style="background:${NAVY_SOFT};border-radius:8px;padding:12px 14px;border-left:3px solid ${NAVY}"><div style="font-size:16px;font-weight:700;color:${NAVY}">${financeiro.alvarasAguardando}</div><div style="font-size:11px;color:#6b6252">alvarás aguardando conferência</div></div>
    </div>

    <h3 style="color:${NAVY};font-size:15px;margin:22px 0 8px;font-family:Georgia,serif">📲 Comercial</h3>
    ${comercialHtml}

    <h3 style="color:${NAVY};font-size:15px;margin:22px 0 8px;font-family:Georgia,serif">⚖️ Radar jurídico</h3>
    <div style="border:1px dashed #e2ddd1;border-radius:8px;padding:12px 16px;font-size:12.5px;color:#6b6252">Em construção — só vai trazer algo quando houver Informativo do STJ relevante às suas áreas. Nada aqui hoje.</div>

    ${podeEsperarHtml}
    ${top3Html}

    <div style="border:1px solid #e2ddd1;border-radius:8px;padding:16px 18px;margin-top:20px;text-align:center">
      <p style="margin:0;font-size:13px;color:#6b6252">🧘 Antes de começar: já bebeu água hoje? Um alongamento de 2 minutos também conta.</p>
    </div>

    <p style="margin-top:22px;text-align:center"><a href="https://crm.advogadaleticiabarros.com.br" style="display:inline-block;background:${GOLD};color:#231e17;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:bold;font-family:Arial,sans-serif">Abrir o CRM</a></p>`;

  return layout(`Resumo de ${hoje}`, body);
}

// E-mail que SEMPRE recebe o resumo matinal, independente do papel/status do
// usuário no cadastro — pedido explícito da Dra. Letícia. O e-mail placeholder
// da conta "admin" (admin@advogadaleticiabarros.com.br) não é uma caixa real
// e é explicitamente excluído abaixo — mandar pra ele só gera falha registrada
// (confirmado: Resend nem tenta entregar, é rejeitado por não ser o remetente
// verificado da conta) todo santo dia sem ninguém nunca ler.
const GARANTIDO_EMAIL = process.env.MORNING_BRIEFING_EMAIL || 'advogadaleticia.barros@gmail.com';
const ADMIN_PLACEHOLDER_EMAIL = process.env.ADMIN_PLACEHOLDER_EMAIL || 'admin@advogadaleticiabarros.com.br';

/** Movimentações processuais de hoje já interpretadas pela IA (Task 5), para o briefing. */
async function getMovimentacoesDoDia(): Promise<MovimentacaoBriefing[]> {
  const [rows] = await db.query(`
    SELECT lp.process_number AS processo, cl.name AS cliente, pm.ai_summary
      FROM process_movements pm
      JOIN legal_processes lp ON lp.id = pm.process_id
      LEFT JOIN clients cl ON cl.id = lp.client_id
     WHERE DATE(CONVERT_TZ(pm.created_at,'+00:00','-03:00')) = DATE(CONVERT_TZ(NOW(),'+00:00','-03:00'))
       AND pm.ai_summary IS NOT NULL
     ORDER BY pm.created_at DESC`) as any;
  return rows.map((r: any) => {
    let s: any = {};
    try { s = JSON.parse(r.ai_summary); } catch { /* ai_summary mal formado — trata como vazio */ }
    return {
      processo: r.processo,
      clienteVsParte: r.cliente || r.processo,
      resumo: s.resumo || '',
      acao: s.acao || '',
      prazoInterno: s.prazo_interno || '',
      severity: classificarMovimentacao(s.prioridade ?? null),
    };
  });
}

/** Envia o resumo matinal para os usuários admin/advogado ativos com e-mail. */
export async function sendMorningBriefings(): Promise<{ sent: number; failed: number }> {
  const weather = await getWeather();
  const pulso = await getPulsoNegocio();
  const meta = await getGoalProgress();
  const [users] = await db.query(
    `SELECT id, name, email FROM users
      WHERE ((active = 1 AND role IN ('admin','advogado') AND email IS NOT NULL AND email <> '' AND LOWER(email) <> LOWER(?))
         OR LOWER(email) = LOWER(?))`,
    [ADMIN_PLACEHOLDER_EMAIL, GARANTIDO_EMAIL]
  ) as any;

  // Estas 4 consultas são GLOBAIS (sem parâmetro de usuário) — rodar uma vez só
  // antes do loop, em vez de repeti-las a cada usuário (achado da revisão final).
  const financeiro = await getFinanceiroGranular();
  const comercial = await getComercialDoDia();
  const esteira = await getEsteiraEDocumentos();
  const movimentacoes = await getMovimentacoesDoDia();

  let sent = 0, failed = 0;
  const seen = new Set<string>();
  for (const u of users) {
    if (seen.has(u.email.toLowerCase())) continue;
    seen.add(u.email.toLowerCase());
    const agenda = await getDayAgenda(u.id);
    const firstName = (u.name || 'Dra.').split(' ')[0];

    const { salvarSnapshotDoDia } = await import('./eveningClosingService');
    const [tarefasHoje] = await db.query(
      `SELECT id, title AS titulo, status FROM tasks
        WHERE user_id = ? AND due_date IS NOT NULL
          AND DATE(CONVERT_TZ(due_date,'+00:00','-03:00')) = DATE(CONVERT_TZ(NOW(),'+00:00','-03:00'))`,
      [u.id]
    ) as any;
    await salvarSnapshotDoDia(u.id, { tarefas: tarefasHoje }).catch((e) => console.error('[briefing] falha ao salvar snapshot:', e?.message || e));
    const agenda3d = await getAgenda3Dias(u.id);
    const prazosPorFaixa = await getPrazosPorFaixa(u.id);
    const r = await sendEmail({
      to: u.email,
      subject: `☀️ Bom dia! Sua agenda de hoje`,
      html: buildHtml(firstName, weather, agenda, pulso, meta, agenda3d, financeiro, comercial, esteira, movimentacoes, prazosPorFaixa),
    });
    if (r.ok) sent++; else failed++;

    // COPILOTO no sino: versão curta do pulso, só com o que exige ação.
    const linhas: string[] = [];
    const money = (n: number) => `R$ ${(Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    if (pulso.leads_frios) linhas.push(`${pulso.leads_frios} lead(s) sem resposta há 48h+`);
    if (pulso.receber_vencido_hoje > 0) linhas.push(`${money(pulso.receber_vencido_hoje)} a receber vencido/vencendo hoje`);
    if (pulso.pagar_vencido_hoje > 0) linhas.push(`${money(pulso.pagar_vencido_hoje)} a pagar até hoje`);
    if (pulso.casos_atrasados) linhas.push(`${pulso.casos_atrasados} caso(s) estourando o SLA`);
    if (pulso.emails_parceria_pendentes) linhas.push(`${pulso.emails_parceria_pendentes} e-mail(s) de parceria na fila`);
    if (linhas.length) {
      await db.query(
        `INSERT INTO notifications (user_id, title, message, notification_type, channel, scheduled_at, status)
         VALUES (?, ?, ?, 'copiloto_diario', 'sistema', NOW(), 'pendente')`,
        [u.id, 'Copiloto — atenção hoje', linhas.join(' · ')]
      ).catch(() => {});
    }
  }
  return { sent, failed };
}

const BRIEFING_WHATSAPP_KEY = 'briefing_whatsapp';

/** Monta a versão em texto do resumo matinal, organizada em seções, para o WhatsApp. */
export function buildWhatsappText(
  name: string, weather: Weather | null, agenda: any, pulso: any, meta: GoalProgress,
  agenda3d: AgendaItem[], financeiro: FinanceiroGranular,
  comercial: { leadsNovos: LeadNovo[]; aniversariantes: Aniversariante[] },
  esteira: { pecasAProduzir: PecaPendente[]; documentosPendentes: DocumentoPendente[] },
  movimentacoes: MovimentacaoBriefing[],
  prazosPorFaixa: { description: string; case_number: string | null; diasParaVencer: number }[] = []
): string {
  // pulso não é mais renderizado diretamente aqui — o conteúdo dele (leads frios,
  // a receber, casos atrasados, e-mails pendentes) já está coberto pelos blocos
  // de severidade 🔴🟠🟢 abaixo, de forma mais específica e acionável.
  const money = (n: number) => `R$ ${(Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' });
  const tipoLabel: Record<string, string> = { reuniao: '🤝', audiencia: '⚖️', compromisso: '📌' };

  // Correção (mesma da Task 7 em buildHtml): prazos por faixa (hoje/amanhã/3
  // dias/semana) também entram nos críticos quando classificarPrazo indicar
  // 'critica' — antes só existiam prazos de HOJE (agenda.prazos).
  const criticos = [
    ...prazosPorFaixa.filter((p) => classificarPrazo(p.diasParaVencer) === 'critica').map((p) => `⏰ *Prazo:* ${p.description}${p.case_number ? ` (proc. ${p.case_number})` : ''}`),
    ...agenda3d.filter((a) => a.severity === 'critica').map((a) => `${tipoLabel[a.tipo] || '📌'} ${a.titulo} — ${a.hora}${a.local ? ` (${a.local})` : ''}`),
    ...movimentacoes.filter((m) => m.severity === 'critica').map((m) => `⚖️ *${m.clienteVsParte}* — ${m.resumo}${m.acao && m.acao !== 'nenhuma' ? `\n*Ação:* ${m.acao}${m.prazoInterno && m.prazoInterno !== 'sem prazo' ? ` · prazo interno ${m.prazoInterno}` : ''}` : ''}`),
    ...(financeiro.aReceberHoje > 0 ? [`💰 ${money(financeiro.aReceberHoje)} vencendo hoje`] : []),
  ];
  const prioridade = [
    ...esteira.pecasAProduzir.filter((p) => p.severity === 'atencao').map((p) => `📝 ${p.caso} — parado há ${p.diasParado} dia(s)`),
  ];
  const acompanhar = [
    ...agenda3d.filter((a) => a.severity === 'acompanhamento').map((a) => `${tipoLabel[a.tipo] || '📌'} ${a.titulo} — ${a.data} ${a.hora}`),
  ];

  const blocos: string[] = [];
  blocos.push(`☀️ *Bom dia, Dra. ${name}!*\n${hoje}`);
  blocos.push(`💛 _"${fraseDoDia()}"_`);
  const weatherLine = weather
    ? `🌤️ *Previsão (${weather.city})*: ${weather.tmin}°C a ${weather.tmax}°C, ${weather.desc}.\n${weatherTip(weather)}`
    : `🌤️ Não consegui obter a previsão do tempo agora.`;
  blocos.push(weatherLine);
  if (criticos.length) blocos.push(`🔴 *ATENÇÃO IMEDIATA (${criticos.length})*\n\n${criticos.join('\n\n')}`);
  if (prioridade.length) blocos.push(`🟠 *PRIORIDADE DO DIA (${prioridade.length})*\n\n${prioridade.join('\n')}`);
  if (acompanhar.length) blocos.push(`🟢 *ACOMPANHAMENTO (${acompanhar.length})*\n\n${acompanhar.join('\n')}`);

  const pctMeta = Math.min(100, meta.percent);
  const barraMeta = '▓'.repeat(Math.round(pctMeta / 10)) + '░'.repeat(10 - Math.round(pctMeta / 10));
  blocos.push(`🎯 *Meta do mês*\n${barraMeta} ${meta.percent}%\n${money(meta.current)} de ${money(meta.target)}${meta.percent >= 100 ? ' — 🎉 batida!' : ` — faltam ${money(meta.faltam)}`}\n${meta.contratos_fechados_mes} contrato(s) protocolado(s) no mês.`);

  const agendaLinhas = agenda3d.map((a) => `${tipoLabel[a.tipo] || '📌'} ${a.data} ${a.hora} — ${a.titulo}`);
  blocos.push(`📅 *Agenda*\n${agendaLinhas.length ? agendaLinhas.join('\n') : 'Sem compromissos nos próximos 3 dias.'}`);

  blocos.push(`💰 *Financeiro*\n${money(financeiro.aReceberHoje)} a receber hoje · ${money(financeiro.rpvSemana)} RPV esta semana · ${money(financeiro.recebido7d)} recebidos (7d)`);

  const comercialLinhas = [
    ...comercial.leadsNovos.map((l) => `Novo lead: ${l.nome} (${l.area})`),
    ...comercial.aniversariantes.map((a) => `🎂 Aniversário hoje: ${a.nome}`),
  ];
  if (comercialLinhas.length) blocos.push(`📲 *Comercial*\n${comercialLinhas.join('\n')}`);

  blocos.push(`⚖️ *Radar jurídico*\nEm construção — nada relevante hoje.`);

  // Correção (mesma da Task 7 em buildHtml): inclui prazo e pagamento no
  // cálculo do top3 — PESO_KIND.prazo é o de maior prioridade em
  // briefingSeverity.ts, sem isso um dia só com prazo crítico preenche
  // "ATENÇÃO IMEDIATA" mas deixa o fecho "3 coisas hoje" vazio.
  const briefingItems: import('./briefingSeverity').BriefingItem[] = [
    ...prazosPorFaixa.filter((p) => classificarPrazo(p.diasParaVencer) === 'critica').map((p, idx) => ({ id: `prazo-${idx}`, kind: 'prazo' as const, label: `Prazo: ${p.description}${p.case_number ? ` (proc. ${p.case_number})` : ''}`, severity: 'critica' as const, ordemDesempate: idx })),
    ...movimentacoes.filter((m) => m.severity === 'critica').map((m, idx) => ({ id: `mov-${idx}`, kind: 'movimentacao' as const, label: `${m.acao} — ${m.clienteVsParte}`, severity: m.severity, ordemDesempate: idx })),
    ...agenda3d.filter((a) => a.severity === 'critica').map((a, idx) => ({ id: `ag-${idx}`, kind: 'agenda' as const, label: `${a.titulo}, ${a.hora}`, severity: a.severity, ordemDesempate: idx })),
    ...(financeiro.aReceberHoje > 0 ? [{ id: 'pag-0', kind: 'pagamento' as const, label: `Cobrar ${money(financeiro.aReceberHoje)} vencendo hoje`, severity: 'critica' as const, ordemDesempate: 0 }] : []),
  ];
  const top = top3(briefingItems);
  if (top.length) blocos.push(`🎯 *Se você fizer só 3 coisas hoje:*\n${top.map((i, idx) => `${idx + 1}. ${esc(i.label)}`).join('\n')}`);

  if (esteira.documentosPendentes.length) {
    const docLinhas = esteira.documentosPendentes.map((d) => `${d.caso}: ${d.itensFaltando.join(', ')}`);
    blocos.push(`📄 *Documentos pendentes*\n${docLinhas.join('\n')}`);
  }

  blocos.push(`🧘 Já bebeu água hoje? Qual é o seu objetivo pra hoje?`);
  return blocos.join('\n\n');
}

/**
 * Envia o mesmo resumo matinal, em versão organizada por seções, para o
 * WhatsApp configurado em office_settings.briefing_whatsapp. Roda separado
 * do e-mail (07h) — às 08h, depois que o e-mail já chegou.
 */
export async function sendMorningBriefingWhatsapp(): Promise<{ sent: boolean; reason?: string }> {
  const [[cfg]] = await db.query(
    "SELECT setting_value FROM office_settings WHERE setting_key = ?", [BRIEFING_WHATSAPP_KEY]
  ) as any;
  const phoneRaw = cfg?.setting_value?.trim();
  if (!phoneRaw) return { sent: false, reason: 'briefing_whatsapp não configurado em Configurações' };

  const [[user]] = await db.query(
    `SELECT id, name FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1`, [GARANTIDO_EMAIL]
  ) as any;
  const userId = user?.id;
  const firstName = (user?.name || 'Dra.').split(' ')[0];

  const weather = await getWeather();
  const pulso = await getPulsoNegocio();
  const meta = await getGoalProgress();
  const agenda = userId ? await getDayAgenda(userId) : { eventos: [], prazos: [], tarefas: [] };
  const agenda3d = userId ? await getAgenda3Dias(userId) : [];
  const prazosPorFaixa = userId ? await getPrazosPorFaixa(userId) : [];
  const financeiro = await getFinanceiroGranular();
  const comercial = await getComercialDoDia();
  const esteira = await getEsteiraEDocumentos();
  const movimentacoes = await getMovimentacoesDoDia();

  const texto = buildWhatsappText(firstName, weather, agenda, pulso, meta, agenda3d, financeiro, comercial, esteira, movimentacoes, prazosPorFaixa);

  // Suporta múltiplos números separados por vírgula (ex.: "27995151402,44991274377")
  // — cada um recebe o mesmo resumo. `sent` só vira true se pelo menos um envio funcionar.
  const numeros = phoneRaw.split(',').map((n: string) => n.trim()).filter(Boolean);
  let algumEnviado = false;
  for (const numero of numeros) {
    let digits = numero.replace(/\D/g, '');
    if (digits.length <= 11) digits = '55' + digits;
    const ok = await sendText(digits, texto, 'Automático — onboarding matinal').catch(() => false);
    if (ok) algumEnviado = true;
  }
  return { sent: algumEnviado };
}
