/**
 * Playbooks de negócio (além de prazos) — regras puras, sem I/O.
 * O motor (`automationService.ts`) decide se a regra está ligada e grava.
 * Nada aqui envia mensagem ao cliente: sempre vira tarefa com rascunho,
 * a advogada revisa e envia (ética OAB / controle humano).
 */

export interface TarefaGerada { title: string; description: string; dueDate: string; priority: 'baixa' | 'media' | 'alta' }

const somaDias = (base: Date, dias: number) => {
  const d = new Date(base.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

const DOCS_POR_AREA: Record<string, string[]> = {
  trabalhista: ['RG e CPF', 'CTPS (física ou digital)', 'Comprovante de residência', 'Holerites / extrato do FGTS', 'Termo de rescisão (se houver)'],
  previdenciario: ['RG e CPF', 'Comprovante de residência', 'CNIS', 'Laudos e exames médicos', 'Carta de indeferimento do INSS (se houver)'],
  familia: ['RG e CPF', 'Comprovante de residência', 'Certidão de nascimento/casamento', 'Comprovantes de renda e despesas'],
  gestante: ['RG e CPF', 'CTPS', 'Exames/ultrassom com data', 'Comprovante de residência'],
  consumidor: ['RG e CPF', 'Comprovante de residência', 'Notas fiscais / contrato', 'Protocolos e prints de atendimento'],
};
const DOCS_GENERICOS = ['RG e CPF (documento de identidade)', 'Comprovante de residência', 'Documentos relacionados ao caso'];

export function tarefasContratoAssinado(ctx: { clientName: string; area: string | null }, hoje = new Date()): TarefaGerada[] {
  const docs = DOCS_POR_AREA[String(ctx.area || '').toLowerCase()] ?? DOCS_GENERICOS;
  return [
    {
      title: `Enviar boas-vindas e lista de documentos — ${ctx.clientName}`,
      description: `Contrato assinado. Enviar mensagem de boas-vindas com o acesso ao portal e a lista de documentos:\n${docs.map((d) => `• ${d}`).join('\n')}`,
      dueDate: somaDias(hoje, 1), priority: 'alta',
    },
    {
      title: `Conferir documentos recebidos — ${ctx.clientName}`,
      description: `Conferir se chegaram:\n${docs.map((d) => `• ${d}`).join('\n')}\nSe faltar algo, cobrar o cliente.`,
      dueDate: somaDias(hoje, 5), priority: 'media',
    },
  ];
}

const FASE_PT: Record<string, { nome: string; explica: string }> = {
  inicial: { nome: 'fase inicial', explica: 'o processo foi iniciado e aguarda os primeiros atos do juízo' },
  instrucao: { nome: 'instrução', explica: 'é a fase de produção de provas, como audiências e perícias' },
  sentenca: { nome: 'sentença', explica: 'o juiz vai decidir (ou decidiu) o pedido em primeira instância' },
  recurso: { nome: 'recurso', explica: 'o caso está sendo analisado por um tribunal, após recurso' },
  execucao: { nome: 'execução', explica: 'é a fase de cobrar e receber o que foi decidido' },
  encerrado: { nome: 'encerramento', explica: 'o processo foi concluído' },
};

export function tarefaFaseMudou(
  ctx: { processNumber: string; clientName: string | null; de: string | null; para: string },
  hoje = new Date()
): TarefaGerada | null {
  if (!ctx.clientName || ctx.de === ctx.para) return null;
  const f = FASE_PT[ctx.para] ?? { nome: ctx.para, explica: 'houve uma mudança de etapa no processo' };
  const primeiroNome = ctx.clientName.split(' ')[0];
  return {
    title: `Avisar ${ctx.clientName}: processo passou para ${f.nome}`,
    description: `Processo ${ctx.processNumber} mudou para ${f.nome}. Rascunho sugerido (revise antes de enviar):\n\n` +
      `Olá, ${primeiroNome}! Passando para te atualizar: seu processo entrou na fase de ${f.nome}, ou seja, ${f.explica}. ` +
      `Qualquer novidade eu te aviso por aqui. Se tiver dúvida, pode me chamar.`,
    dueDate: somaDias(hoje, 1), priority: 'media',
  };
}
