/**
 * Ferramentas que o Claude ganha com a extensão (fase 0: só leitura).
 * Cada uma: nome, título, descrição (o Claude lê para decidir quando usar),
 * parâmetros simples e a função que chama o CRM.
 */
export const FERRAMENTAS = [
  {
    nome: 'crm_quem_sou',
    titulo: 'Quem sou no CRM',
    descricao: 'Confere a ligação com o CRM jurídico e diz em nome de quem o Claude está agindo. Use se a pessoa perguntar se o CRM está conectado.',
    parametros: {},
    executar: (crm) => crm.get('/eu'),
  },
  {
    nome: 'crm_minha_semana',
    titulo: 'Prazos e tarefas da semana',
    descricao: 'Lista os prazos processuais pendentes e as tarefas da pessoa até daqui a 7 dias, incluindo os atrasados, e quantas intimações aguardam confirmação. Use quando perguntarem "o que tenho esta semana", "quais prazos vencem", "o que está atrasado".',
    parametros: {},
    executar: (crm) => crm.get('/semana'),
  },
  {
    nome: 'crm_identificar_caso',
    titulo: 'Identificar o caso no CRM',
    descricao: 'Acha no CRM o caso de que a conversa trata, pelo número do processo, CPF ou nome do cliente. Chame SEMPRE que aparecer na conversa (no texto, numa peça, numa intimação ou no nome de um arquivo) um número de processo ou o nome de um cliente, antes de produzir algo para ele. Devolve os casos candidatos e a certeza: "certo" (um caso só) ou "duvida" (vários: pergunte à pessoa qual é).',
    parametros: {
      texto: { tipo: 'string', descricao: 'Trecho da conversa ou do documento com o número do processo ou CPF (pode colar o cabeçalho da peça).', opcional: true },
      nome: { tipo: 'string', descricao: 'Nome do cliente, se não houver número de processo.', opcional: true },
    },
    executar: (crm, a) => crm.get('/identificar', { texto: a.texto, nome: a.nome }),
  },
  {
    nome: 'crm_resumo_caso',
    titulo: 'Resumo do caso',
    descricao: 'Traz do CRM o resumo de um caso: cliente, área, etapa, processos, prazos abertos e as últimas movimentações. Use depois de identificar o caso, antes de redigir uma peça ou responder sobre o andamento.',
    parametros: {
      caso_id: { tipo: 'number', descricao: 'Número do caso no CRM (caso_id devolvido por crm_identificar_caso).' },
    },
    executar: (crm, a) => crm.get(`/casos/${encodeURIComponent(a.caso_id)}`),
  },
];
