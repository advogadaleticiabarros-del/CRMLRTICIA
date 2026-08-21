import { db } from '../config/database';
import { sendEmail, layout } from './EmailService';
import { getGoalProgress, GoalProgress } from './goalsService';
import { sendText } from './uazapiInstance';
import { classificarAgenda, classificarPagamento, classificarEsteira, classificarLead, Severity } from './briefingSeverity';

const NAVY = '#1f3047';
const GOLD = '#c19a4e';
const NAVY_SOFT = '#eef1f6';
const GOLD_SOFT = '#f2ead3';
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
      + (SELECT COALESCE(SUM(valor_final),0) FROM parcelas WHERE status='pago' AND updated_at >= NOW() - INTERVAL 7 DAY)
        AS recebido_7d,
      (SELECT COUNT(*) FROM case_awards WHERE status='aguardando' AND alvara_recebido = 0)
        AS alvaras_aguardando
  `).catch(() => ({ a_receber_hoje: 0, rpv_semana: 0, recebido_7d: 0, alvaras_aguardando: 0 }));
  return {
    aReceberHoje: Number(r.a_receber_hoje) || 0,
    rpvSemana: Number(r.rpv_semana) || 0,
    recebido7d: Number(r.recebido_7d) || 0,
    alvarasAguardando: Number(r.alvaras_aguardando) || 0,
  };
}

interface LeadNovo { nome: string; area: string; origem: string; criadoEm: string; }
interface Aniversariante { nome: string; }

/** Leads criados desde o último briefing + aniversariantes de clientes hoje. */
export async function getComercialDoDia(): Promise<{ leadsNovos: LeadNovo[]; aniversariantes: Aniversariante[] }> {
  const [leads] = await db.query(`
    SELECT name AS nome, COALESCE(area, 'não informada') AS area, COALESCE(source, 'não informado') AS origem, created_at AS criadoEm
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
    SELECT title AS caso, production_stage AS fase, checklist_checked,
           DATEDIFF(NOW(), production_started_at) AS diasParado
      FROM cases
     WHERE production_stage IN ('separacao_documentos','criacao_inicial','revisao_inicial','aguardando_protocolo')
       AND production_started_at IS NOT NULL
     ORDER BY production_started_at ASC`) as any;

  const pecasAProduzir: PecaPendente[] = casos.map((c: any) => ({
    caso: c.caso, fase: c.fase, diasParado: Number(c.diasParado) || 0,
    severity: classificarEsteira(Number(c.diasParado) || 0),
  }));

  const documentosPendentes: DocumentoPendente[] = casos
    .filter((c: any) => c.fase === 'separacao_documentos' && c.checklist_checked)
    .map((c: any) => {
      let checklist: Record<string, boolean> = {};
      try { checklist = JSON.parse(c.checklist_checked); } catch { /* checklist mal formado — trata como vazio */ }
      const itensFaltando = Object.entries(checklist).filter(([, marcado]) => !marcado).map(([item]) => item);
      return { caso: c.caso, itensFaltando };
    })
    .filter((d: DocumentoPendente) => d.itensFaltando.length > 0);

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

function buildHtml(name: string, weather: Weather | null, agenda: any, pulso: any, meta: GoalProgress): string {
  const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' });
  const tipoLabel: Record<string, string> = { reuniao: '🤝 Reunião', audiencia: '⚖️ Audiência', compromisso: '📌 Compromisso', prazo: '⏰ Prazo', tarefa: '✓ Tarefa' };

  const weatherLine = weather
    ? `A previsão para <strong>${weather.city}</strong> hoje é de <strong>${weather.tmin}°C a ${weather.tmax}°C</strong>, com ${weather.desc}.`
    : `(Não consegui obter a previsão do tempo agora.)`;

  const evHtml = (agenda.eventos || []).map((e: any) =>
    `<li><strong>${e.hora}</strong> — ${tipoLabel[e.event_type] || '📌'} ${e.title}${e.location ? ` <span style="color:#8a8175">(${e.location})</span>` : ''}${e.video_link ? ` · <a href="${e.video_link}" style="color:${NAVY}">vídeo</a>` : ''}</li>`).join('');
  const przHtml = (agenda.prazos || []).map((p: any) =>
    `<li>⏰ <strong>Prazo:</strong> ${p.description}${p.case_number ? ` <span style="color:#8a8175">(proc. ${p.case_number})</span>` : ''}</li>`).join('');
  const tskHtml = (agenda.tarefas || []).map((t: any) =>
    `<li>✓ ${t.title} <span style="color:#8a8175">(${t.priority})</span></li>`).join('');

  const temAlgo = evHtml || przHtml || tskHtml;
  const corpo = temAlgo
    ? `<ul style="line-height:1.9;padding-left:18px;margin:8px 0;color:#232323">${evHtml}${przHtml}${tskHtml}</ul>`
    : `<p style="color:#6b6252">Você não tem compromissos, prazos ou tarefas registrados para hoje. Bom dia tranquilo! ☕</p>`;

  const body = `
    <div style="font-size:12px;color:${GOLD};text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:2px">${hoje}</div>
    <p style="font-size:19px;font-weight:700;color:${NAVY};margin:0 0 16px">Bom dia, Dra. ${name}! ☀️</p>

    <div style="background:${GOLD_SOFT};border-radius:8px;padding:16px 18px;margin-bottom:18px">
      <div style="font-size:9px;color:#8a6d1a;text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:6px">Frase de força do dia</div>
      <p style="margin:0;font-size:14.5px;line-height:1.6;color:#4a3d1d;font-style:italic">"${fraseDoDia()}"</p>
    </div>

    <p style="font-size:14.5px;color:#232323">${weatherLine}</p>
    <div style="background:${NAVY_SOFT};border-radius:8px;padding:12px 16px;margin:12px 0 18px;font-size:13.5px;color:#232323">
      <strong style="color:${NAVY}">💡 Dica do dia:</strong> ${weatherTip(weather)}
    </div>

    <h3 style="color:${NAVY};font-size:15px;margin:18px 0 6px;font-family:Georgia,serif">📅 Seu dia hoje</h3>
    ${corpo}

    <h3 style="color:${NAVY};font-size:15px;margin:18px 0 6px;font-family:Georgia,serif">🎯 Meta do mês</h3>
    ${metaHtml(meta)}

    <h3 style="color:${NAVY};font-size:15px;margin:18px 0 6px;font-family:Georgia,serif">📊 Pulso do escritório</h3>
    ${pulsoHtml(pulso)}

    <div style="border:1px solid #e2ddd1;border-radius:8px;padding:16px 18px;margin-top:20px;text-align:center">
      <p style="margin:0 0 4px;font-size:13px;color:#6b6252">🧘 Antes de começar: já bebeu água hoje? Um alongamento de 2 minutos também conta.</p>
      <p style="margin:10px 0 0;font-size:15px;font-weight:700;color:${NAVY};font-family:Georgia,serif">Qual é o seu objetivo hoje?</p>
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

  let sent = 0, failed = 0;
  const seen = new Set<string>();
  for (const u of users) {
    if (seen.has(u.email.toLowerCase())) continue;
    seen.add(u.email.toLowerCase());
    const agenda = await getDayAgenda(u.id);
    const firstName = (u.name || 'Dra.').split(' ')[0];
    const r = await sendEmail({
      to: u.email,
      subject: `☀️ Bom dia! Sua agenda de hoje`,
      html: buildHtml(firstName, weather, agenda, pulso, meta),
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
function buildWhatsappText(name: string, weather: Weather | null, agenda: any, pulso: any, meta: GoalProgress): string {
  const money = (n: number) => `R$ ${(Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' });
  const tipoLabel: Record<string, string> = { reuniao: '🤝', audiencia: '⚖️', compromisso: '📌', prazo: '⏰', tarefa: '✓' };

  const blocos: string[] = [];
  blocos.push(`☀️ *Bom dia, Dra. ${name}!*\n${hoje}`);
  blocos.push(`💛 _"${fraseDoDia()}"_`);

  const weatherLine = weather
    ? `🌤️ *Previsão (${weather.city})*: ${weather.tmin}°C a ${weather.tmax}°C, ${weather.desc}.\n${weatherTip(weather)}`
    : `🌤️ Não consegui obter a previsão do tempo agora.`;
  blocos.push(weatherLine);

  const evLinhas = (agenda.eventos || []).map((e: any) => `${tipoLabel[e.event_type] || '📌'} ${e.hora} — ${e.title}${e.location ? ` (${e.location})` : ''}`);
  const przLinhas = (agenda.prazos || []).map((p: any) => `⏰ Prazo: ${p.description}${p.case_number ? ` (proc. ${p.case_number})` : ''}`);
  const tskLinhas = (agenda.tarefas || []).map((t: any) => `✓ ${t.title} (${t.priority})`);
  const diaLinhas = [...evLinhas, ...przLinhas, ...tskLinhas];
  blocos.push(`📅 *Seu dia hoje*\n${diaLinhas.length ? diaLinhas.join('\n') : 'Sem compromissos, prazos ou tarefas para hoje.'}`);

  const pct = Math.min(100, meta.percent);
  const barra = '▓'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
  blocos.push(`🎯 *Meta do mês*\n${barra} ${meta.percent}%\n${money(meta.current)} de ${money(meta.target)}${meta.percent >= 100 ? ' — 🎉 batida!' : ` — faltam ${money(meta.faltam)}`}\n${meta.contratos_fechados_mes} contrato(s) protocolado(s) no mês.`);

  const pulsoLinhas: string[] = [];
  if (pulso.leads_frios) pulsoLinhas.push(`🔥 ${pulso.leads_frios} lead(s) sem resposta há 48h+`);
  if (pulso.receber_vencido_hoje > 0) pulsoLinhas.push(`💰 ${money(pulso.receber_vencido_hoje)} a receber vencendo até hoje`);
  if (pulso.pagar_vencido_hoje > 0) pulsoLinhas.push(`📤 ${money(pulso.pagar_vencido_hoje)} a pagar até hoje`);
  if (pulso.casos_atrasados) pulsoLinhas.push(`⏱ ${pulso.casos_atrasados} caso(s) estourando o SLA`);
  if (pulso.emails_parceria_pendentes) pulsoLinhas.push(`📥 ${pulso.emails_parceria_pendentes} e-mail(s) de parceria na fila`);
  blocos.push(`📊 *Pulso do escritório*\n${pulsoLinhas.length ? pulsoLinhas.join('\n') : '✅ Nenhuma pendência urgente!'}`);

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

  let digits = phoneRaw.replace(/\D/g, '');
  if (digits.length <= 11) digits = '55' + digits;
  const texto = buildWhatsappText(firstName, weather, agenda, pulso, meta);
  const ok = await sendText(digits, texto, 'Automático — onboarding matinal').catch(() => false);
  return { sent: ok };
}
