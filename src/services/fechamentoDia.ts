/**
 * Fechamento do dia (18:30) — regras puras, sem I/O.
 * - `classificarDia`: junta o retrato da manhã com o estado de agora (o que
 *   estava planejado e foi reagendado continua contando como pendente).
 * - `categoriaDoDia` + `sortearFrase`: frase de encerramento pelo contexto,
 *   evitando as usadas recentemente.
 * - `textoWhatsapp`: versão executiva pro celular.
 */

export interface TarefaDia { id: number; titulo: string; status: string; waiting_on?: string | null }
export interface Retrato { tarefas: TarefaDia[] }
export interface Classificacao { concluidos: string[]; pendentes: string[]; aguardando: string[] }

const CONCLUIDO = new Set(['concluida', 'concluido', 'pago', 'protocolado']);

/**
 * @param manha  retrato salvo no briefing matinal (null se não houve)
 * @param agora  tarefas com vencimento hoje, estado atual
 * @param estadoAtualPorId  estado atual das tarefas que estavam no retrato da manhã
 */
export function classificarDia(manha: Retrato | null, agora: Retrato, estadoAtualPorId: Map<number, TarefaDia>): Classificacao {
  const porId = new Map<number, TarefaDia>();
  for (const t of manha?.tarefas ?? []) porId.set(t.id, estadoAtualPorId.get(t.id) ?? t);
  for (const t of agora.tarefas) porId.set(t.id, t);
  const r: Classificacao = { concluidos: [], pendentes: [], aguardando: [] };
  for (const t of porId.values()) {
    if (t.status === 'cancelada') continue;
    if (CONCLUIDO.has(t.status)) r.concluidos.push(t.titulo);
    else if (t.status === 'aguardando_terceiro') r.aguardando.push(`${t.titulo} (aguardando ${t.waiting_on || 'terceiro'})`);
    else r.pendentes.push(t.titulo);
  }
  return r;
}

export const FRASES: Record<string, string[]> = {
  descanso: [
    'O dia acabou. O que ficou, espera por você amanhã, descansada.',
    'Fecha o notebook. Você fez o que dava hoje, e isso basta.',
    'Descanso também é parte do trabalho bem feito.',
    'Hoje já teve a sua dedicação. Agora é a sua vez.',
    'Desliga o modo advogada por algumas horas. Ela volta amanhã.',
    'Boa noite, Dra. A mente descansada decide melhor.',
    'O processo não foge durante a noite. Pode dormir tranquila.',
    'Pausa merecida. Amanhã tem mais, e você vai estar pronta.',
    'Menos tela, mais silêncio. A noite é sua.',
    'Encerrar o dia é um ato de cuidado consigo mesma.',
    'Quem cuida de tanta gente também merece cuidado. Hoje, o seu.',
    'Respira fundo. O dia foi vencido.',
    'Nenhuma petição é mais urgente que uma boa noite de sono.',
    'Deixa as pendências no sistema. Elas estão guardadas.',
    'Amanhã começa melhor quando hoje termina em paz.',
    'Hoje foi suficiente. Você é suficiente.',
    'Deixe o celular longe da cama esta noite.',
    'A noite é pra recarregar, não pra revisar.',
    'Termine o dia com algo que te faça sorrir.',
    'O escritório fecha. Você também pode fechar.',
  ],
  audiencia: [
    'Dia de audiência cansa corpo e cabeça. Hoje, desacelera.',
    'Você defendeu alguém hoje em juízo. Descanse com orgulho.',
    'Audiência feita. Agora é hora de baixar a guarda.',
    'Falou, argumentou, sustentou. Agora silêncio e descanso.',
    'Depois da tribuna, o sofá. Você mereceu.',
    'A adrenalina da audiência passa. Deixa o corpo recuperar.',
    'Hoje você foi a voz de alguém. Agora ouça a sua: descanse.',
    'Audiência encerrada, cliente amparado. Missão cumprida.',
    'Um banho quente depois de um dia de fórum faz milagres.',
    'Revisar a audiência pode esperar. Seu descanso, não.',
    'Toda audiência exige preparo. O descanso de hoje é o preparo da próxima.',
    'Você esteve presente quando precisaram. Agora esteja presente pra você.',
    'Guarda a toga imaginária. A noite é sua.',
    'Audiência é maratona. Hidrate, coma bem e durma cedo.',
    'Dia de fórum vencido. Amanhã a vida segue mais leve.',
  ],
  dia_cheio: [
    'Que dia produtivo! Olha quanta coisa ficou pronta.',
    'Lista andou bonito hoje. Comemore, nem que seja com um chá.',
    'Hoje você rendeu por dois. Amanhã pode ir no seu ritmo.',
    'Muita coisa concluída. Isso é o escritório crescendo.',
    'Dia de entregas. Reconheça o próprio trabalho.',
    'Você deu conta de muito hoje. Orgulhe-se disso.',
    'Produtividade alta merece descanso à altura.',
    'Cada tarefa concluída é um cliente mais tranquilo.',
    'Esse ritmo é admirável. Só não esqueça de parar.',
    'O sistema registrou: hoje foi dia de resultado.',
    'Muita coisa fechada. Amanhã começa com menos peso.',
    'Você transformou pendência em entrega. Bom trabalho, Dra.',
    'Dia intenso e bem aproveitado. Agora, descanso.',
    'Quem planeja e executa assim, constrói escritório grande.',
    'Missão do dia: cumprida com sobra.',
  ],
  pendencias: [
    'Ficou coisa pra amanhã? Tudo bem. Nem todo dia rende igual.',
    'Pendência não é fracasso. É só o próximo passo.',
    'Amanhã você recomeça com a lista já organizada.',
    'Nem tudo cabe em um dia. E está tudo registrado.',
    'Dia difícil também passa. Amanhã é outra chance.',
    'Uma coisa de cada vez. Amanhã, a primeira da lista.',
    'Não carregue a lista pra cama. Ela fica no sistema.',
    'Imprevistos acontecem. Você fez o que era possível.',
    'Priorize amanhã o que é prazo. O resto se ajeita.',
    'Seja gentil consigo mesma. Amanhã tem mais tempo.',
    'A lista cresceu? Amanhã ela diminui. Descansa.',
    'Um dia mais pesado não define a semana.',
    'Reorganize amanhã cedo, com a cabeça fresca.',
    'Você não está atrasada. Está em andamento.',
    'Hoje foi o que deu. E o que deu foi importante.',
  ],
  academia: [
    'Amanhã tem treino. Dorme cedo pra render.',
    'Corpo forte, mente afiada. Amanhã é dia de academia.',
    'Já separa a roupa de treino pra amanhã.',
    'O treino de amanhã agradece a noite bem dormida.',
    'Academia amanhã: o melhor investimento do dia.',
    'Cuidar do corpo é cuidar da carreira. Bom treino amanhã.',
    'Hidrate hoje pra treinar melhor amanhã.',
    'Amanhã você começa suando e termina vencendo.',
    'Energia pro treino vem do descanso de hoje.',
    'Treino marcado é compromisso consigo mesma. Não falte.',
    'Mochila pronta hoje, treino garantido amanhã.',
    'Uma boa refeição hoje prepara o treino de amanhã.',
    'Amanhã o treino é seu momento sem cliente, sem prazo.',
    'Dormir bem é metade do treino de amanhã.',
    'Movimento amanhã, descanso hoje. Equilíbrio.',
  ],
  hidratacao: [
    'Já bebeu água suficiente hoje? Um copo agora antes de dormir.',
    'Corpo hidratado, mente clara. Um copo d’água e boa noite.',
    'Troque o último café por água. Seu sono agradece.',
    'Água antes de dormir e antes do primeiro e-mail de amanhã.',
    'Hidratação é autocuidado barato e eficiente.',
    'Deixe uma garrafa d’água ao lado da cama.',
    'Falar o dia inteiro desidrata. Beba água agora.',
    'Um chá quentinho também conta como hidratação.',
    'Seu cérebro é 75% água. Cuide dele.',
    'Meta de amanhã: garrafinha sempre por perto.',
  ],
  leitura: [
    'Que tal umas páginas de algo que não seja processo?',
    'Leia algo por prazer hoje. A mente também precisa de férias.',
    'Um livro antes de dormir desliga melhor que o celular.',
    'Dez páginas de uma boa história e boa noite.',
    'Troque a tela por papel nos últimos minutos do dia.',
    'Ler fora do Direito também deixa a escrita melhor.',
    'Um capítulo hoje, outro amanhã. Sem pressa.',
    'A leitura leve de hoje descansa a leitura técnica de amanhã.',
    'Que tal retomar aquele livro parado na cabeceira?',
    'Uma boa história é a melhor forma de desligar.',
  ],
};

export interface ContextoDia { teveAudiencia: boolean; concluidos: number; pendentes: number; academiaAmanha: boolean }

export function categoriaDoDia(c: ContextoDia, rnd: () => number = Math.random): string {
  if (c.teveAudiencia) return 'audiencia';
  if (c.academiaAmanha) return 'academia';
  if (c.concluidos >= 5 && c.concluidos > c.pendentes) return 'dia_cheio';
  if (c.pendentes >= 5 && c.pendentes > c.concluidos) return 'pendencias';
  const leves = ['descanso', 'descanso', 'hidratacao', 'leitura'];
  return leves[Math.floor(rnd() * leves.length)];
}

/** Sorteio de verdade, evitando `recentes`; se todas já saíram, sorteia entre todas. */
export function sortearFrase(categoria: string, recentes: string[], rnd: () => number = Math.random): string {
  const lista = FRASES[categoria] ?? FRASES.descanso;
  const usadas = new Set(recentes);
  const livres = lista.filter((f) => !usadas.has(f));
  const pool = livres.length ? livres : lista;
  return pool[Math.floor(rnd() * pool.length)];
}

export function textoWhatsapp(nome: string, c: Classificacao, amanha: string[], frase: string): string {
  const b: string[] = [`🌙 *Fechamento do dia, Dra. ${nome}*`];
  b.push(`✅ ${c.concluidos.length} concluída(s) · ⏳ ${c.pendentes.length} pendente(s)${c.aguardando.length ? ` · 🔒 ${c.aguardando.length} aguardando terceiro` : ''}`);
  if (c.pendentes.length) b.push('*Ficou pendente*\n' + c.pendentes.slice(0, 8).map((t) => `• ${t}`).join('\n') + (c.pendentes.length > 8 ? `\n• +${c.pendentes.length - 8}` : ''));
  if (c.aguardando.length) b.push('*Aguardando terceiro*\n' + c.aguardando.slice(0, 5).map((t) => `• ${t}`).join('\n'));
  if (amanha.length) b.push('*Prioridade de amanhã*\n' + amanha.map((t, i) => `${i + 1}. ${t}`).join('\n'));
  b.push(`_${frase}_`);
  return b.join('\n\n');
} 
