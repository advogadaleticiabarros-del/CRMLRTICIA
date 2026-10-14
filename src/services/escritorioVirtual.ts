/**
 * Escritório virtual: a equipe de agentes do escritório e o que cada um está
 * fazendo agora. Cada agente é dono de rotinas automáticas (`job_runs`) e/ou
 * registra ações (`agente_acoes`); o status sai do que aconteceu de verdade.
 * Regras puras — testadas em tests/escritorioVirtual.test.mjs. A tela fica em
 * public/escritorio.js e os dados em src/routes/escritorio.ts.
 */

export type StatusAgente = 'trabalhando' | 'parado' | 'desligado' | 'erro';

export interface AgenteJuridico {
  id: string;
  nome: string;
  cargo: string;
  depto: string;
  cor: string;
  /** Uma linha curta do que faz (cartão abaixo da sala). */
  resumo: string;
  /** Rotinas automáticas (nome em runJob) que são trabalho deste agente. */
  jobs: string[];
  descricao: string;
  /** Agente planejado no mapa e ainda não construído. */
  emConstrucao?: boolean;
}

export const AGENTES: AgenteJuridico[] = [
  { id: 'laya', resumo: 'IA grátis do servidor · qualifica e aprende', nome: 'Laya', cargo: 'o cérebro (IA grátis)', depto: 'Gestão', cor: '#a855f7', jobs: [],
    descricao: 'Modelo de decisão que roda no próprio servidor, sem custo. Classifica possíveis clientes (área, urgência, valor) antes de chamar a IA paga e aprende com as correções da equipe.' },
  { id: 'secretaria', resumo: 'Entrega tudo à Dra. já resumido', nome: 'Dra. Clara', cargo: 'Secretária da Dra.', depto: 'Gestão', cor: '#db2777',
    jobs: ['briefing:matinal', 'briefing:matinal-whatsapp', 'briefing:fechamento-dia', 'audiencia:briefing-vespera'],
    descricao: 'Recebe o trabalho de todos os agentes e entrega à Dra. já resumido: briefing das 7h, fechamento do dia, véspera de audiência e as sentenças lidas.' },
  { id: 'leitor', resumo: 'Lê sentenças e acórdãos · prazos de recurso', nome: 'Dr. Lucas', cargo: 'Leitor de sentenças', depto: 'Leitura', cor: '#0ea5e9', jobs: ['leitor:decisoes-recentes'],
    descricao: 'Lê a íntegra de cada sentença e acórdão: resultado para o cliente, o que ganhamos e perdemos, valor, pontos de atenção e prazos de recurso com data.' },
  { id: 'djen', resumo: 'Varre o DJEN pela OAB da Dra. · 3x ao dia', nome: 'Dr. Davi', cargo: 'Vigia do DJEN', depto: 'Monitoramento', cor: '#2563eb', jobs: ['monitoramento:descoberta-oab'],
    descricao: 'Varre o Diário de Justiça Eletrônico 3 vezes ao dia atrás de toda publicação na OAB da Dra., inclusive de processos ainda não cadastrados.' },
  { id: 'tribunais', resumo: 'Consulta os processos nos tribunais · de hora em hora', nome: 'Dra. Tereza', cargo: 'Vigia dos tribunais', depto: 'Monitoramento', cor: '#1d4ed8',
    jobs: ['monitoramento:processos', 'monitoramento:processos-pre-briefing', 'monitoramento:vigia'],
    descricao: 'Consulta cada processo no DataJud e nas APIs dos tribunais de hora em hora e confere se a consulta não travou.' },
  { id: 'email', resumo: 'Lê intimações do e-mail do tribunal', nome: 'Dr. Edu', cargo: 'Vigia do e-mail', depto: 'Monitoramento', cor: '#0891b2', jobs: ['monitoramento:processos-email', 'parceria:sync-gmail'],
    descricao: 'Lê as intimações que chegam por e-mail do tribunal e o e-mail da parceria.' },
  { id: 'carteira', resumo: 'Processo parado, prescrição e fase desatualizada', nome: 'Dr. Vítor', cargo: 'Vigia da carteira', depto: 'Monitoramento', cor: '#0f766e', jobs: ['carteira:vigia', 'processos:fase-divergente'],
    descricao: 'Avisa processo parado há 30/60 dias, prescrição chegando e fase do processo desatualizada.' },
  { id: 'prazos', resumo: 'Conta prazos em dias úteis e escala os avisos', nome: 'Dra. Paula', cargo: 'Controle de prazos', depto: 'Controladoria', cor: '#dc2626',
    jobs: ['prazos:alertas', 'prazos:contadores', 'prazos:sem-caso', 'prazos:vencidos'],
    descricao: 'Conta os prazos em dias úteis, escala os avisos conforme o vencimento chega e avisa prazo em processo sem caso.' },
  { id: 'estagiario', resumo: 'Analisa a intimação e deixa a minuta pronta', nome: 'Enzo', cargo: 'Estagiário', depto: 'Produção', cor: '#f59e0b', jobs: [],
    descricao: 'A cada intimação, analisa o que pede e deixa a minuta da peça pronta para a Dra. revisar.' },
  { id: 'agenda', resumo: 'Agenda, audiências e Google Agenda', nome: 'Dra. Agnes', cargo: 'Agenda e audiências', depto: 'Controladoria', cor: '#7c3aed',
    jobs: ['agenda:eventos-proximos', 'agenda:lembretes-pessoais', 'agenda:repeticao-diaria', 'agenda:sync-completa', 'agenda:sync-incremental'],
    descricao: 'Mantém a agenda sincronizada com o Google e lembra audiências e compromissos.' },
  { id: 'financeiro', resumo: 'Régua de cobrança, parcelas e acordos', nome: 'Dr. Fábio', cargo: 'Cobrança e financeiro', depto: 'Financeiro', cor: '#16a34a',
    jobs: ['financeiro:inadimplencia-recalcular', 'financeiro:pagamentos-parados', 'financeiro:recorrentes', 'financeiro:recorrentes-boot', 'financeiro:regua-cobranca', 'financeiro:vencidos', 'acordos:aviso-vencimento'],
    descricao: 'Régua de cobrança, parcelas vencidas, contas recorrentes e aviso das parcelas de acordo.' },
  { id: 'comercial', resumo: 'Propostas: follow-up e encerramento', nome: 'Dra. Carla', cargo: 'Propostas', depto: 'Comercial', cor: '#ea580c',
    jobs: ['propostas:followup', 'propostas:fechamento-definitivo', 'comercial:propostas-expiradas'],
    descricao: 'Acompanha as propostas enviadas, faz o follow-up e encerra as que expiraram.' },
  { id: 'whatsapp', resumo: 'Fila do WhatsApp e conversas esperando', nome: 'Dr. Wagner', cargo: 'Recepção do WhatsApp', depto: 'Atendimento', cor: '#22c55e',
    jobs: ['whatsapp:fila', 'whatsapp:conversas-paradas', 'whatsapp:lembrete-pendencia', 'whatsapp:midias-falhadas', 'whatsapp:verificar-conexao', 'whatsapp:reconectar', 'whatsapp:peso-midia', 'notificacoes:despachar'],
    descricao: 'Envia as mensagens da fila, cobra conversa esperando resposta e vigia a conexão do WhatsApp.' },
  { id: 'assistente', resumo: 'Faz o que a Dra. e a Jessica pedem no WhatsApp', nome: 'Dra. Aurora', cargo: 'Assistente de comando', depto: 'Gestão', cor: '#e11d48', jobs: ['assistente:lembretes'],
    descricao: 'Faz o que a Dra. e a Jessica pedem pelo WhatsApp: lançar, consultar, lembrar.' },
  { id: 'parcerias', resumo: 'Audiências e resumo semanal das parcerias', nome: 'Dra. Pietra', cargo: 'Parcerias', depto: 'Financeiro', cor: '#9333ea', jobs: ['parceria:alerta-audiencias', 'parceria:resumo-semanal'],
    descricao: 'Avisa audiências dos casos de parceria e manda o resumo semanal ao parceiro.' },
  { id: 'relatorios', resumo: 'Números do dia, relatório mensal e jornal jurídico', nome: 'Dra. Rita', cargo: 'Relatórios e notícias', depto: 'Gestão', cor: '#64748b',
    jobs: ['relatorio:mensal-envio', 'metricas:retrato-boot', 'metricas:retrato-diario', 'briefing:jornal-juridico'],
    descricao: 'Tira o retrato diário dos números, envia o relatório mensal e o jornal jurídico.' },
  { id: 'guardiao', resumo: 'Backup 3x ao dia e prova de restauração', nome: 'Dr. Bento', cargo: 'Guardião (backup)', depto: 'Qualidade', cor: '#475569',
    jobs: ['backup:diario', 'backup:aviso-diario', 'backup:diario:aviso-destino-parcial', 'backup:prova-de-restauracao', 'backup:recuperacao', 'manutencao:job-runs-antigos', 'manutencao:monitoring-logs-antigos', 'lgpd:expurgo-mensal'],
    descricao: 'Cópia de segurança 3 vezes ao dia, prova de restauração e limpeza de dados antigos (LGPD).' },
  { id: 'pesquisador', resumo: 'Jurisprudência só de fonte oficial (em construção)', nome: 'Dra. Júlia', cargo: 'Pesquisa de jurisprudência', depto: 'Produção', cor: '#0d9488', jobs: [], emConstrucao: true,
    descricao: 'Vai buscar precedentes só em fonte oficial (Pangea/CNJ, STJ, TST, TRT17, TJES), com número, órgão, data, link e trecho.' },
  { id: 'verificador', resumo: 'Confere cada citação antes da Dra. (em construção)', nome: 'Dra. Vera', cargo: 'Verificadora de citações', depto: 'Qualidade', cor: '#be123c', jobs: [], emConstrucao: true,
    descricao: 'Vai conferir, antes de a peça chegar à Dra., se cada julgado e lei citados existem e dizem o que a peça afirma.' },
  { id: 'testador', resumo: 'Testa os agentes com casos reais (em construção)', nome: 'Dr. Tomás', cargo: 'Testador dos agentes', depto: 'Qualidade', cor: '#57534e', jobs: [], emConstrucao: true,
    descricao: 'Vai rodar casos reais anonimizados a cada mudança e impedir que um agente que piorou entre no ar.' },
];

export interface RunJob { job: string; status: 'ok' | 'erro' | string; message: string | null; ran_at: Date | string }
export interface AcaoAgente { agente: string; texto: string; created_at: Date | string }

const MIN_TRABALHANDO = 15;
const HORAS_PARADO = 26;

const ms = (d: Date | string) => new Date(d).getTime();

const ROTULOS: Record<string, string> = {
  lidas: 'lidas', enviadas: 'enviadas', puladas: 'puladas', novas: 'novas', novos: 'novos', synced: 'sincronizados',
  processed: 'processados', sent: 'enviados', updated: 'atualizados', created: 'criados', errors: 'erros',
};

/** Resumo de uma execução em português simples (o runJob grava JSON do retorno). */
export function textoDaRotina(job: string, message: string | null): string {
  if (!message) return 'concluiu a rotina';
  try {
    const o = JSON.parse(message);
    if (o && typeof o === 'object') {
      const partes = Object.entries(o)
        .filter(([, v]) => typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string')
        .slice(0, 4)
        .map(([k, v]) => `${ROTULOS[k] || k}: ${v}`);
      return partes.length ? partes.join(' · ') : 'concluiu a rotina';
    }
  } catch { /* texto livre (ex.: mensagem de erro) */ }
  return String(message).slice(0, 160);
}

export interface SituacaoAgente {
  status: StatusAgente;
  ultima: { texto: string; em: string | null } | null;
  execucoes24h: number;
}

export function statusDoAgente(
  a: Pick<AgenteJuridico, 'id' | 'jobs' | 'emConstrucao'>,
  runs: RunJob[], acoes: AcaoAgente[], agora: Date,
): SituacaoAgente {
  if (a.emConstrucao) return { status: 'desligado', ultima: { texto: 'Em construção (próxima fase do escritório virtual)', em: null }, execucoes24h: 0 };
  const meus = runs.filter((r) => a.jobs.includes(r.job)).sort((x, y) => ms(y.ran_at) - ms(x.ran_at));
  const minhasAcoes = acoes.filter((x) => x.agente === a.id).sort((x, y) => ms(y.created_at) - ms(x.created_at));
  const t = agora.getTime();
  const recente = (d: Date | string, min: number) => t - ms(d) <= min * 60000;

  const ultRun = meus[0];
  const ultAcao = minhasAcoes[0];
  const ultima = ultAcao && (!ultRun || ms(ultAcao.created_at) >= ms(ultRun.ran_at))
    ? { texto: ultAcao.texto, em: new Date(ultAcao.created_at).toISOString() }
    : ultRun ? { texto: textoDaRotina(ultRun.job, ultRun.message), em: new Date(ultRun.ran_at).toISOString() } : null;
  const execucoes24h = meus.filter((r) => recente(r.ran_at, 24 * 60)).length + minhasAcoes.filter((x) => recente(x.created_at, 24 * 60)).length;

  let status: StatusAgente = 'desligado';
  if (ultRun && ultRun.status === 'erro' && recente(ultRun.ran_at, HORAS_PARADO * 60)) status = 'erro';
  else if (meus.some((r) => r.status === 'ok' && recente(r.ran_at, MIN_TRABALHANDO)) || minhasAcoes.some((x) => recente(x.created_at, MIN_TRABALHANDO))) status = 'trabalhando';
  else if ((ultRun && recente(ultRun.ran_at, HORAS_PARADO * 60)) || (ultAcao && recente(ultAcao.created_at, HORAS_PARADO * 60))) status = 'parado';
  return { status, ultima, execucoes24h };
}

export interface MetricaAgente { n: number; rotulo: string }

export interface AgenteNaSala extends SituacaoAgente {
  id: string; nome: string; cargo: string; depto: string; cor: string; resumo: string; descricao: string; emConstrucao: boolean;
  metricas: MetricaAgente[];
}

export function montarEscritorio(
  runs: RunJob[], acoes: AcaoAgente[], agora: Date,
  extras: { layaOnline: boolean; metricas?: Record<string, MetricaAgente[]> },
): AgenteNaSala[] {
  return AGENTES.map((a) => {
    let s = statusDoAgente(a, runs, acoes, agora);
    if (a.id === 'laya' && !extras.layaOnline) {
      s = { status: 'desligado', ultima: { texto: 'Serviço da Laya ainda não instalado neste servidor', em: null }, execucoes24h: s.execucoes24h };
    } else if (a.id === 'laya' && s.status === 'desligado') {
      s = { ...s, status: 'parado', ultima: s.ultima || { texto: 'Pronta, esperando o próximo possível cliente', em: null } };
    }
    return {
      id: a.id, nome: a.nome, cargo: a.cargo, depto: a.depto, cor: a.cor, resumo: a.resumo, descricao: a.descricao,
      emConstrucao: !!a.emConstrucao, metricas: extras.metricas?.[a.id] || [], ...s,
    };
  });
}
