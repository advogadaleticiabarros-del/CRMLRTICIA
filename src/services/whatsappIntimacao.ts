/**
 * Cliente mencionou no WhatsApp que recebeu intimação/citação/visita de
 * oficial de justiça → vira tarefa urgente para a advogada conferir.
 * Nunca responde sozinho: o rascunho sugerido deixa claro que a mensagem foi
 * recebida e será conferida, sem confirmar prazo nenhum. Regras puras.
 */

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const PADROES: RegExp[] = [
  /\bintimad[oa]\b/,
  /\bintimacao\b/,
  /\bfui citad[oa]\b/,
  /\b(recebi|chegou|veio|mandaram)\b.{0,30}\b(citacao|intimacao|notificacao|mandado|carta)\b/,
  /\bcarta\b.{0,20}\b(forum|tribunal|justica|juiz)\b/,
  /\boficial de justica\b/,
  /\bmandado\b.{0,30}\b(nome|citacao|intimacao|penhora|busca)\b/,
  /\bnotificacao\b.{0,20}\b(tribunal|forum|justica|juiz)\b/,
];

export function mencionaIntimacao(texto: string): boolean {
  const t = semAcento(String(texto || ''));
  if (!t.trim()) return false;
  return PADROES.some((re) => re.test(t));
}

export function tarefaIntimacao(clientName: string, mensagem: string): { title: string; description: string } {
  const primeiroNome = clientName.split(' ')[0];
  return {
    title: `⚠ ${clientName} disse no WhatsApp que recebeu intimação/citação`,
    description:
      `Mensagem do cliente: "${String(mensagem).slice(0, 400)}"\n\n` +
      `Confira nos autos/DJEN e cadastre o prazo, se houver.\n\n` +
      `Rascunho de resposta (revise antes de enviar):\n` +
      `Oi, ${primeiroNome}! Recebi sua mensagem e vou conferir no processo. Isso não é a confirmação oficial de prazo — ` +
      `já estou verificando e te retorno. Se puder, me mande uma foto do documento que você recebeu.`,
  };
}
