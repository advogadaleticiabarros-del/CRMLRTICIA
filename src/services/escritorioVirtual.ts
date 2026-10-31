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
    jobs: ['briefing:matinal', 'briefing:matinal-whatsapp', 'briefing:fechamento-dia', 'audiencia:briefing-vespera', 'sociedade:conversas', 'sociedade:reuniao'],
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
    jobs: ['backup:diario', 'backup:aviso-diario', 'backup:diario:aviso-destino-parcial', 'backup:prova-de-restauracao', 'backup:recuperacao', 'manutencao:disco', 'manutencao:job-runs-antigos', 'manutencao:monitoring-logs-antigos', 'lgpd:expurgo-mensal'],
    descricao: 'Cópia de segurança 3 vezes ao dia, prova de restauração, limpeza de dados antigos (LGPD) e alarme de disco do servidor (avisa a partir de 85%).' },
  { id: 'pesquisador', resumo: 'Separa as leis e súmulas certas antes de cada peça', nome: 'Dra. Júlia', cargo: 'Pesquisa de leis e jurisprudência', depto: 'Produção', cor: '#0d9488', jobs: ['leis:atualizar'],
    descricao: 'Mantém o acervo de leis (Constituição, leis e decretos federais, leis do ES, súmulas, OJs e temas do STF, STJ, TST e TNU, atos do INSS e do MTE) atualizado toda semana e, antes de cada minuta ou petição, entrega ao redator só os artigos e súmulas que existem, com o texto oficial.' },
  { id: 'verificador', resumo: 'Confere cada citação da peça no texto oficial', nome: 'Dra. Vera', cargo: 'Verificadora de citações', depto: 'Qualidade', cor: '#be123c', jobs: [],
    descricao: 'Separada de quem redige: na revisão, confere se cada lei, artigo, súmula, OJ e tema citados existem, estão em vigor e dizem o que a peça afirma (com o texto oficial ao lado).' },
  { id: 'testador', resumo: 'Testa os agentes com casos reais (em construção)', nome: 'Dr. Tomás', cargo: 'Testador dos agentes', depto: 'Qualidade', cor: '#57534e', jobs: [], emConstrucao: true,
    descricao: 'Vai rodar casos reais anonimizados a cada mudança e impedir que um agente que piorou entre no ar.' },
  { id: 'cerebro', nome: 'Cérebro', cargo: 'Biblioteca do escritório', resumo: 'Absorve o Obsidian, responde e repassa a quem precisa', depto: 'Gestão', cor: '#0d9488',
    jobs: ['cerebro:indexar'],
    descricao: 'Lê o cofre do Obsidian inteiro (modelos, fichas de clientes, manual, anotações). Todos perguntam a ele: busca pelo sentido e pelo contexto (cliente, processo, área), responde citando a nota e diz quando não sabe. Repassa as teses da casa ao Estagiário e organiza o cofre (links quebrados, notas soltas, sem etiqueta, títulos repetidos, mapa do cofre).' },
  { id: 'produtor', nome: 'Dra. Bianca', cargo: 'Produtora de propostas', resumo: 'Monta a proposta pela tabela e pede aprovação à Dra.', depto: 'Comercial', cor: '#f97316',
    jobs: ['comercial:produtor-proposta'],
    descricao: 'Quando o possível cliente chega em "documentação pendente": pede os dados que faltam (CPF, RG, endereço…), estuda o caso, puxa o valor de tabela (tabela do escritório ou a média das propostas aceitas da área), aplica a política de parcelamento e manda o resumo à Dra. no WhatsApp. Ela responde "aprovar", "ajustar" ou "recusar"; aprovada, a proposta vai ao cliente.' },
  { id: 'fechador', nome: 'Dr. Felipe', cargo: 'Fechador de contratos', resumo: 'Leva o contrato da revisão até a assinatura', depto: 'Comercial', cor: '#0284c7',
    jobs: ['comercial:fechador-contrato'],
    descricao: 'Depois do aceite: lembra a Dra. de revisar o contrato pronto há mais de 1 dia, lembra o cliente de assinar em D+1 e D+3 e avisa a Dra. se a assinatura parar por 7 dias.' },
  { id: 'coletor', nome: 'Dra. Camila', cargo: 'Coletora de documentos e provas', resumo: 'Pede, confere e cobra documentos e provas', depto: 'Comercial', cor: '#65a30d',
    jobs: ['comercial:coletor-documentos', 'ficha:completar'],
    descricao: 'Completa a ficha sozinha com o que o lead ou o cliente manda no WhatsApp (texto, foto, PDF): nome completo, CPF, RG, nascimento, e-mail, estado civil, profissão e endereço. Só preenche o que está vazio; o que diverge do cadastro ou ficou incerto vai para a equipe conferir. Com o contrato assinado, pede ao cliente: documento com foto, comprovante de endereço, Carteira de Trabalho em PDF mostrando o contrato, extrato do FGTS em PDF, as provas conforme o assunto falado (ponto, prints, áudios, testemunhas, CAT…), conversas do WhatsApp e a transcrição da reunião. Confere o que chegou, cobra em D+2, D+5 e D+10 e, completo, escreve o relato do cliente a partir das conversas.' },
  { id: 'atendente', nome: 'Dra. Lívia', cargo: 'Atendente do WhatsApp', resumo: 'Atende no tom da Dra. e faz as perguntas certas', depto: 'Atendimento', cor: '#c026d3',
    jobs: ['atendente:tom-de-voz'],
    descricao: 'Atende clientes e possíveis clientes no WhatsApp do escritório no tom de voz da Dra. (aprendido das conversas reais da equipe), faz as perguntas certas de cada área, responde o status neutro do processo e encaminha o que é jurídico. Nunca dá opinião jurídica nem fala de valores. Começa em modo rascunho: a equipe aprova antes de sair, e cada correção vira memória dela.' },
  { id: 'negociador', nome: 'Dr. Rafael', cargo: 'Negociação (objeções)', resumo: 'Responde às objeções da proposta, com ética e sem prometer', depto: 'Comercial', cor: '#b45309',
    jobs: [],
    descricao: 'Quando o possível cliente responde à proposta com objeção ("tá caro", "vou pensar", "quanto tempo demora", "vou ganhar?", "o sindicato faz de graça"), prepara a resposta no tom da Dra.: acolhe, entende o que está por trás, esclarece com os valores da proposta aprovada e explica a marcha processual (o processo tem dia para começar, mas não tem dia para terminar). Segue o Código de Ética da OAB e o Provimento 205/2021: nunca promete resultado nem prazo, não dá desconto (leva o pedido à Dra.), não pressiona e não fala mal de colegas. Modo rascunho, na mesma fila da Dra. Lívia.' },
  { id: 'copiloto', nome: 'Dr. Otávio', cargo: 'Copiloto comercial da Dra.', resumo: 'Qualifica em % e sugere a proposta na conversa da Dra.', depto: 'Comercial', cor: '#1e40af',
    jobs: [],
    descricao: 'Qualifica cada possível cliente em porcentagem: capacidade de pagar, potencial do caso e chance de fechar, a partir da conversa e de perguntas sutis que a Dra. Lívia faz (se está trabalhando, salário, se recebeu a rescisão, quem decide, forma de pagamento preferida). Acompanha a conversa que a Dra. está tendo e, quando aparece a intenção de proposta ("quanto custa?", "vou te mandar a proposta"), manda só para ela a sugestão: valores pela tabela da OAB/RJ, forma de pagamento conforme a capacidade e a próxima mensagem no tom dela. Ela responde "montar proposta N" e a Dra. Bianca monta.' },
  { id: 'analista', nome: 'Dra. Helena', cargo: 'Analista de documentos', resumo: 'Confere cada documento contra a história contada', depto: 'Comercial', cor: '#7f1d1d',
    jobs: ['analista:documentos-novos'],
    descricao: 'Lê com olhar crítico cada documento do cliente (WhatsApp e CRM) e cruza com a história contada: nome e CPF, empresa e CNPJ, datas de entrada e saída, salário (pagamento por fora), carteira assinada, meses sem FGTS, comprovante de endereço vencido ou de terceiro, gestação antes da dispensa, prescrição de 2 anos, documento ilegível, cortado ou com sinal de alteração. Grava o relatório no caso e avisa a Dra.; ao cliente só pede, com jeito, o reenvio do que veio ruim.' },
  { id: 'calculista', nome: 'Dr. Augusto', cargo: 'Calculista', resumo: 'Planilha de cálculos da peça, mês a mês, com correção e juros', depto: 'Produção', cor: '#155e75',
    jobs: [],
    descricao: 'Na montagem da petição inicial, pega cada desconto que a Dra. Helena leu nos extratos (INSS, banco, fatura) e monta a planilha de cálculos: devolução em dobro (Tema 929 do STJ), correção monetária e juros de mora desde cada desconto, com os índices oficiais do Banco Central (INPC e 1% a.m. até 08/2024; IPCA e taxa legal depois). O total atualizado vira o valor da causa e entra na peça. A planilha fica na Mesa do caso, aba Cálculos, com o arquivo .xlsx para anexar.' },
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
