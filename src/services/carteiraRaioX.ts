/**
 * Raio-x da carteira — o trabalho diário do Dr. Vítor (vigia da carteira).
 *
 * Confere cada processo ativo e cada caso ativo, diz o que está fora do lugar,
 * com que gravidade, o que fazer e QUAL COLEGA do escritório cuida de cada
 * coisa. O repasse vira conversa no mural (sociedadeAgentes.ts) e o resumo
 * chega à Dra. pelo briefing, pelo sino (só quando há grave nova, ou na
 * segunda-feira) e pela ficha do Vítor no escritório virtual.
 *
 * Regras puras — tests/carteiraRaioX.test.mjs. Banco e envio em carteiraRaioXJob.ts.
 * Privacidade: só o primeiro nome do cliente sai daqui (a sala aparece na TV).
 */
import { AGENTES } from './escritorioVirtual';
import { PHASE_RANK } from '../utils/faseProcesso';

export interface ProcessoCarteira {
  id: number; numero: string; clienteId: number | null; cliente: string | null; casoId: number | null;
  fase: string; faseSugerida: string | null; ultimaMov: string | null; ultimaConsulta: string | null;
  monitorado: boolean; valorCausa: number | null; prazosPendentes: number;
}
export interface CasoCarteira {
  id: number; titulo: string; clienteId: number | null; cliente: string | null; area: string;
  prescricaoData: string | null; temProcesso: boolean; criadoEm: string; protocoladoEm: string | null;
}

export type Gravidade = 'critica' | 'alta' | 'media' | 'baixa';
export type TipoPendencia =
  | 'prescricao' | 'acao_nao_proposta' | 'consulta_atrasada' | 'parado' | 'fase_desatualizada'
  | 'encerrado_ativo' | 'sem_cliente' | 'sem_caso' | 'sem_valor_causa' | 'fora_do_monitoramento';

export interface Pendencia {
  ref: string; tipo: TipoPendencia; gravidade: Gravidade;
  /** "Proc. 0000001-11… (Maria)" ou "Título do caso (Maria)". */
  titulo: string; motivo: string; oQueFazer: string;
  /** Id do agente (escritorioVirtual.AGENTES) que cuida disto. */
  colega: string;
  processoId?: number; casoId?: number; clienteId?: number;
}

export interface RaioX {
  dia: string;
  conferidos: { processos: number; casos: number };
  /** Processos sem pendência média ou maior. */
  emDia: number;
  /** % de processos em dia (0–100). */
  saude: number;
  contagem: Record<Gravidade, number>;
  pendencias: Pendencia[];
}

/** Rótulo curto de cada tipo (texto do repasse e da tela). */
export const ROTULO_TIPO: Record<TipoPendencia, string> = {
  prescricao: 'prescrição se aproximando',
  acao_nao_proposta: 'ação ainda não proposta',
  consulta_atrasada: 'consulta no tribunal atrasada',
  parado: 'processo parado',
  fase_desatualizada: 'fase desatualizada',
  encerrado_ativo: 'encerrado, mas ainda ativo no CRM',
  sem_cliente: 'processo sem cliente',
  sem_caso: 'processo sem caso',
  sem_valor_causa: 'sem valor da causa',
  fora_do_monitoramento: 'fora do monitoramento',
};

const ORDEM: Record<Gravidade, number> = { critica: 0, alta: 1, media: 2, baixa: 3 };
const ROTULO_FASE: Record<string, string> = {
  inicial: 'Inicial', instrucao: 'Instrução', sentenca: 'Sentença', recurso: 'Recurso', execucao: 'Execução', encerrado: 'Encerrado',
};
const AREAS_JUDICIAIS = new Set(['trabalhista', 'gestante', 'previdenciario', 'consumidor', 'civel', 'familia']);

const DIA = 86_400_000;
const dias = (de: string, ate: string) => Math.round((Date.parse(ate.slice(0, 10)) - Date.parse(de.slice(0, 10))) / DIA);
const br = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
export const primeiroNome = (nome: string | null) => (nome ? String(nome).trim().split(/\s+/)[0] : '');
const tituloProc = (p: ProcessoCarteira) => `Proc. ${p.numero}${p.cliente ? ` (${primeiroNome(p.cliente)})` : ''}`;
const tituloCaso = (c: CasoCarteira) => `${c.titulo}${c.cliente ? ` (${primeiroNome(c.cliente)})` : ''}`;

function doProcesso(p: ProcessoCarteira, hoje: string): Pendencia[] {
  const out: Pendencia[] = [];
  const base = { titulo: tituloProc(p), processoId: p.id, clienteId: p.clienteId ?? undefined, casoId: p.casoId ?? undefined };
  const add = (tipo: TipoPendencia, gravidade: Gravidade, colega: string, motivo: string, oQueFazer: string) =>
    out.push({ ref: `${tipo}:lp:${p.id}`, tipo, gravidade, colega, motivo, oQueFazer, ...base });

  if (p.fase === 'encerrado') {
    add('encerrado_ativo', 'media', 'secretaria', 'A fase é "Encerrado", mas o processo segue ativo no CRM.',
      'Confirmar o arquivamento, dar baixa no processo e encerrar o caso (repasses conferidos).');
  }

  // Dado velho: sem consulta recente, "parado" não é confiável.
  let consultaAtrasada = false;
  if (p.monitorado) {
    const semConsulta = p.ultimaConsulta ? dias(p.ultimaConsulta, hoje) : null;
    if (semConsulta === null || semConsulta >= 3) {
      consultaAtrasada = true;
      add('consulta_atrasada', semConsulta === null || semConsulta >= 7 ? 'alta' : 'media', 'tribunais',
        semConsulta === null ? 'O tribunal nunca foi consultado para este processo.' : `Sem consulta ao tribunal há ${semConsulta} dias.`,
        'Conferir se o número está certo e se o tribunal está respondendo; consultar à mão se preciso.');
    }
  } else {
    add('fora_do_monitoramento', 'baixa', 'tribunais', 'Processo ativo com o monitoramento desligado.',
      'Religar o monitoramento, ou arquivar se o processo não é mais nosso.');
  }

  if (p.fase !== 'encerrado' && !consultaAtrasada && p.ultimaMov) {
    const d = dias(p.ultimaMov, hoje);
    if (d >= 30) {
      const semPrazo = p.prazosPendentes === 0;
      const gravidade: Gravidade = d >= 90 ? 'alta' : d >= 60 ? 'media' : 'baixa';
      const colega = d >= 60 && semPrazo ? 'estagiario' : 'prazos';
      add('parado', gravidade, colega, `Sem movimentação há ${d} dias${semPrazo ? ' e sem prazo em aberto' : ' (há prazo em aberto)'}.`,
        colega === 'estagiario' ? 'Preparar petição pedindo andamento (impulso oficial), para a Dra. aprovar.'
          : semPrazo ? 'Conferir se há ato nosso pendente ou prazo que não foi lançado.' : 'Acompanhar o prazo em aberto; parado pode ser espera normal.');
    }
  }

  if (p.faseSugerida && (PHASE_RANK[p.faseSugerida] || 0) > (PHASE_RANK[p.fase] || 0)) {
    const s = p.faseSugerida;
    const colega = s === 'sentenca' || s === 'recurso' ? 'leitor' : s === 'execucao' ? 'financeiro' : s === 'encerrado' ? 'secretaria' : 'prazos';
    const fazer: Record<string, string> = {
      leitor: 'Conferir se a decisão já foi lida e os prazos de recurso lançados; depois confirmar a fase em Processos.',
      financeiro: 'Acompanhar alvará, depósito e repasse ao cliente; confirmar a fase em Processos.',
      secretaria: 'Confirmar o trânsito em julgado/arquivamento e atualizar a fase em Processos.',
      prazos: 'Confirmar a fase em Processos.',
    };
    add('fase_desatualizada', s === 'execucao' || s === 'encerrado' || s === 'sentenca' ? 'media' : 'baixa', colega,
      `As movimentações indicam "${ROTULO_FASE[s] || s}", mas a fase cadastrada é "${ROTULO_FASE[p.fase] || p.fase}".`, fazer[colega]);
  }

  if (!p.clienteId) {
    add('sem_cliente', 'media', 'secretaria', 'O processo não está ligado a nenhum cliente.',
      'Vincular à ficha do cliente (buscar por CPF e nome antes; uma pessoa, uma ficha).');
  } else if (!p.casoId) {
    add('sem_caso', 'baixa', 'secretaria', 'O processo não está ligado a um caso.',
      'Ligar ao caso do cliente, para honorários e lançamentos ficarem no lugar certo.');
  }
  if (p.valorCausa === null || p.valorCausa === undefined) {
    add('sem_valor_causa', 'baixa', 'tribunais', 'Valor da causa não cadastrado.', 'Buscar nos dados do tribunal ou na inicial.');
  }
  return out;
}

function doCaso(c: CasoCarteira, hoje: string): Pendencia[] {
  if (c.temProcesso) return [];
  const base = { titulo: tituloCaso(c), casoId: c.id, clienteId: c.clienteId ?? undefined };
  if (c.prescricaoData) {
    const faltam = dias(hoje, c.prescricaoData);
    if (faltam <= 90) {
      const gravidade: Gravidade = faltam <= 15 ? 'critica' : faltam <= 30 ? 'alta' : 'media';
      return [{
        ref: `prescricao:case:${c.id}`, tipo: 'prescricao', gravidade, colega: 'prazos', ...base,
        motivo: faltam < 0 ? `A data-limite prescricional (${br(c.prescricaoData)}) já passou e não há processo cadastrado.`
          : `Prescrição em ${faltam} dia(s) (${br(c.prescricaoData)}) e a ação ainda não foi proposta.`,
        oQueFazer: faltam < 0 ? 'Conferir com a Dra. a situação do caso (a data informada pode estar errada).' : 'Priorizar a petição inicial ou confirmar a data-limite com a Dra.',
      }];
    }
  }
  if (!c.protocoladoEm && AREAS_JUDICIAIS.has(c.area)) {
    const d = dias(c.criadoEm, hoje);
    if (d >= 30) {
      return [{
        ref: `acao_nao_proposta:case:${c.id}`, tipo: 'acao_nao_proposta', gravidade: d >= 60 ? 'alta' : 'media', colega: 'estagiario', ...base,
        motivo: `Caso aberto há ${d} dias sem processo cadastrado nem protocolo.`,
        oQueFazer: 'Ver o que falta (documentos, cálculo, peça) e combinar com a Dra. a data do protocolo.',
      }];
    }
  }
  return [];
}

export function montarRaioX(processos: ProcessoCarteira[], casos: CasoCarteira[], hoje: string): RaioX {
  const porProcesso = processos.map((p) => doProcesso(p, hoje));
  const pendencias = [...porProcesso.flat(), ...casos.flatMap((c) => doCaso(c, hoje))]
    .sort((a, b) => ORDEM[a.gravidade] - ORDEM[b.gravidade] || a.titulo.localeCompare(b.titulo));
  const emDia = porProcesso.filter((ps) => ps.every((x) => x.gravidade === 'baixa')).length;
  const contagem: Record<Gravidade, number> = { critica: 0, alta: 0, media: 0, baixa: 0 };
  for (const p of pendencias) contagem[p.gravidade]++;
  return {
    dia: hoje,
    conferidos: { processos: processos.length, casos: casos.length },
    emDia,
    saude: processos.length ? Math.round((emDia / processos.length) * 100) : 100,
    contagem,
    pendencias,
  };
}

// ── Comparação com o raio-x de ontem ─────────────────────────────────────────
type Resumida = Pick<Pendencia, 'ref' | 'gravidade' | 'tipo' | 'titulo'>;
export interface Diferenca { primeiraVez: boolean; novas: Pendencia[]; pioraram: Pendencia[]; resolvidas: Resumida[] }

export function compararComOntem(hoje: Pendencia[], ontem: Resumida[] | null): Diferenca {
  if (!ontem) return { primeiraVez: true, novas: [], pioraram: [], resolvidas: [] };
  const antes = new Map(ontem.map((p) => [p.ref, p]));
  const agora = new Set(hoje.map((p) => p.ref));
  return {
    primeiraVez: false,
    novas: hoje.filter((p) => !antes.has(p.ref)),
    pioraram: hoje.filter((p) => antes.has(p.ref) && ORDEM[p.gravidade] < ORDEM[antes.get(p.ref)!.gravidade]),
    resolvidas: ontem.filter((p) => !agora.has(p.ref)),
  };
}

// ── Repasse aos colegas (vira conversa no mural) ─────────────────────────────
const AGENTE = new Map(AGENTES.map((a) => [a.id, a]));
const nomeCurto = (id: string) => (AGENTE.get(id)?.nome || id).replace(/^Dra?\.\s*/, '');
const tratamento = (id: string) => {
  const nome = AGENTE.get(id)?.nome || id;
  return `${/^Dra\.\s/.test(nome) ? 'à' : 'ao'} ${nome}`;
};

export function repassesPorColega(pendencias: Pendencia[]): Array<{ colega: string; pendencias: Pendencia[] }> {
  const grupos = new Map<string, Pendencia[]>();
  for (const p of pendencias) (grupos.get(p.colega) || grupos.set(p.colega, []).get(p.colega)!).push(p);
  return [...grupos].map(([colega, ps]) => ({ colega, pendencias: ps }));
}

/** Texto da ação (agente_acoes) — legível no "Trabalho recente" e lido pela sociedade. */
export function textoDoRepasse(colega: string, ps: Pendencia[]): string {
  const tipos = [...new Set(ps.map((p) => ROTULO_TIPO[p.tipo]))];
  const motivo = tipos.slice(0, 2).join(' e ') + (tipos.length > 2 ? ` (+${tipos.length - 2})` : '');
  const ex = ps[0]?.titulo.replace(/\s*\(.*\)$/, '').replace(/^Proc\.\s*/, '') || '';
  return `passou ${ps.length} pendência(s) ${tratamento(colega)}: ${motivo}${ex ? ` (ex.: ${ex})` : ''}`.slice(0, 300);
}

/** Id do agente pelo nome usado no texto do repasse. */
export function agentePeloNome(nome: string): string | null {
  const a = AGENTES.find((x) => x.nome === nome.trim());
  return a ? a.id : null;
}

const escolher = <T>(opcoes: T[], ref: number) => opcoes[Math.abs(ref) % opcoes.length];

/** Conversa natural do Vítor com o colega (variação pela ref, para não soar robótico). */
export function falasDoRepasse(colega: string, n: number, motivo: string, exemplo: string, ref: number): Array<[string, string]> {
  const c = nomeCurto(colega);
  const ex = exemplo ? ` O primeiro é o ${exemplo}.` : '';
  const qtd = n === 1 ? '1 pendência' : `${n} pendências`;
  const abre = escolher([`${c}, bom dia!`, `Oi, ${c}!`, `${c}, uma ajuda rápida?`, `${c}, passando aqui com o raio-x.`], ref);
  const por: Record<string, { v: string[]; r: string[] }> = {
    tribunais: {
      v: [`${abre} Tenho ${qtd} com ${motivo}.${ex} Sem dado novo do tribunal eu não sei dizer se está parado de verdade.`,
        `${abre} Separei ${qtd} para você: ${motivo}.${ex} Se for o tribunal instável, me avisa que eu anoto.`],
      r: ['Deixa comigo, Vítor. Eles entram na próxima rodada de consultas, de hora em hora.',
        'Combinado! Se o tribunal continuar sem responder, aparece no painel de saúde para a equipe.',
        'Pode deixar. Às vezes é número digitado errado; vale a equipe conferir também.'],
    },
    prazos: {
      v: [`${abre} ${qtd} para o seu radar: ${motivo}.${ex} Confere se tem prazo correndo ou ato nosso esperando?`,
        `${abre} Achei ${qtd} de ${motivo}.${ex} Prazo é com você, então já te passo.`],
      r: /prescri/.test(motivo)
        ? ['Prescrição é prioridade aqui, Vítor. Fica na frente da minha lista até a Dra. decidir.', 'Obrigada! Vou deixar isso bem visível para a Dra.']
        : ['Confiro sim, Vítor. Se tiver prazo, ele vai para a lista da Dra.', 'Obrigada pelo aviso! Processo parado às vezes esconde um prazo que ninguém lançou.'],
    },
    leitor: {
      v: [`${abre} As movimentações de ${n === 1 ? '1 processo' : `${n} processos`} já falam em sentença ou recurso, mas a fase ficou para trás.${ex} A decisão já foi lida?`,
        `${abre} ${qtd} de ${motivo} que parecem decisão nova.${ex} Dá uma olhada?`],
      r: ['Vou conferir, Vítor. Se a decisão saiu, a leitura vai para a Dra. com os prazos de recurso.',
        'Boa! Se eu ainda não li, entra na minha próxima leitura.'],
    },
    estagiario: {
      v: [`${abre} Separei ${qtd} para a produção: ${motivo}.${ex} Quando a Dra. liberar, dá para preparar a petição?`,
        `${abre} ${qtd} de ${motivo}.${ex} Vale a gente ver o que falta para andar.`],
      r: ['Opa, Dr. Vítor! Fico de prontidão. Sem a liberação da Dra. eu não protocolo nada.',
        'Pode deixar! Vejo o que já tem no caso e o que falta pedir.'],
    },
    financeiro: {
      v: [`${abre} Pelas movimentações, ${n === 1 ? '1 processo entrou' : `${n} processos entraram`} em execução.${ex} Fica de olho em alvará e repasse?`,
        `${abre} ${qtd} de ${motivo} com cara de dinheiro chegando.${ex}`],
      r: ['Anotado, Vítor. Quando o valor cair, separo a parte do cliente e a do escritório.',
        'Ótimo! Execução é onde o financeiro mais precisa estar atento.'],
    },
    secretaria: {
      v: [`${abre} ${qtd} de ${motivo}.${ex} Pode levar à Dra. quando ela tiver um minuto?`,
        `${abre} Ficaram ${qtd} de cadastro para acertar: ${motivo}.${ex}`],
      r: ['Levo sim, Vítor. Junto com o briefing fica mais fácil ela resolver de uma vez.',
        'Obrigada! Coloco no resumo da Dra.'],
    },
  };
  const f = por[colega] || { v: [`${abre} ${qtd}: ${motivo}.${ex}`], r: ['Obrigado pelo aviso, Vítor!'] };
  return [['carteira', escolher(f.v, ref)], [colega, escolher(f.r, ref + 1)]];
}

/** Texto do resumo do dia (agente_acoes). */
export function textoDoRaioX(r: RaioX): string {
  return `conferiu ${r.conferidos.processos} processo(s) e ${r.conferidos.casos} caso(s): ${r.emDia} em dia; ${r.pendencias.length} pendência(s) — ${r.contagem.critica} crítica(s), ${r.contagem.alta} alta(s); saúde ${r.saude}%`;
}

export const RE_RAIO_X = /^conferiu (\d+) processo\(s\) e (\d+) caso\(s\): (\d+) em dia; (\d+) pendência\(s\) — (\d+) crítica\(s\), (\d+) alta\(s\); saúde (\d+)%/;
export const RE_REPASSE = /^passou (\d+) pendência\(s\) (?:à|ao) (.+?): (.+?)(?: \(ex\.: (.+)\))?$/;
export const RE_RESOLVIDAS = /^tirou (\d+) pendência\(s\) da lista/;

export function falasDoRaioX(m: RegExpMatchArray, ref: number): Array<[string, string]> {
  const [, proc, , emDia, , crit, altas, saude] = m.map(Number);
  const graves = crit + altas;
  const v = escolher([
    `Clara, o raio-x da carteira de hoje está pronto: ${emDia} de ${proc} processos em dia (saúde ${saude}%).`,
    `Bom dia, Clara! Passei a carteira inteira: ${proc} processos, ${emDia} em dia.`,
  ], ref);
  return [
    ['carteira', `${v} ${graves ? `Tem ${graves} ponto(s) grave(s); já repassei aos colegas, mas a Dra. precisa saber.` : 'Nada grave hoje.'}`],
    ['secretaria', graves ? escolher(['Obrigada, Vítor! Vai no briefing da Dra., com os graves primeiro.', 'Anotado. Coloco no topo do resumo dela.'], ref)
      : escolher(['Que ótimo! Dia tranquilo é bom sinal.', 'Obrigada, Vítor! Vai no briefing assim mesmo, ela gosta de saber.'], ref)],
  ];
}

export function falasDasResolvidas(m: RegExpMatchArray, ref: number): Array<[string, string]> {
  const n = Number(m[1]);
  return [
    ['carteira', escolher([`Tereza, ${n} pendência(s) saíram da minha lista desde ontem. Obrigado pelas consultas!`,
      `Boa notícia, Tereza: ${n} pendência(s) resolvida(s) desde ontem.`], ref)],
    ['tribunais', escolher(['Que bom! Equipe afinada é isso.', 'Ótimo, Vítor! Menos coisa para a Dra. se preocupar.'], ref)],
  ];
}

// ── Entrega à Dra. ───────────────────────────────────────────────────────────
const ICONE: Record<Gravidade, string> = { critica: '🚨', alta: '🔴', media: '🟠', baixa: '⚪' };
const grave = (p: Pendencia) => p.gravidade === 'critica' || p.gravidade === 'alta';
const linha = (p: Pendencia) => `${ICONE[p.gravidade]} ${p.titulo}: ${p.motivo} → ${p.oQueFazer} (${nomeCurto(p.colega)})`;

function diaDaSemanaSP(agora: Date): string {
  return agora.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Sao_Paulo' });
}

/**
 * Aviso no sino: só quando surge (ou piora) algo grave, ou o resumo completo
 * da segunda-feira. Sem pendência média ou maior, não avisa.
 */
export function avisoParaDra(r: RaioX, d: Diferenca, agora: Date): { titulo: string; mensagem: string } | null {
  const relevantes = r.pendencias.filter((p) => p.gravidade !== 'baixa');
  if (!relevantes.length) return null;
  const gravesNovas = d.primeiraVez ? r.pendencias.filter(grave) : [...d.novas, ...d.pioraram].filter(grave);
  const segunda = diaDaSemanaSP(agora) === 'Mon';
  if (!gravesNovas.length && !segunda) return null;
  const topo = (gravesNovas.length && !segunda ? gravesNovas : relevantes).slice(0, 6);
  const porColega = repassesPorColega(relevantes).map((g) => `${nomeCurto(g.colega)} (${g.pendencias.length})`).join(', ');
  const cab = `Saúde da carteira: ${r.saude}% (${r.emDia} de ${r.conferidos.processos} processos em dia).`;
  const mudou = d.primeiraVez ? '' : `Desde ontem: ${d.novas.length} nova(s), ${d.pioraram.length} piorou(aram), ${d.resolvidas.length} resolvida(s).`;
  return {
    titulo: segunda ? `📋 Raio-x da carteira da semana: ${relevantes.length} ponto(s) para cuidar`
      : `📋 Raio-x da carteira: ${gravesNovas.length} ponto(s) grave(s) novo(s)`,
    mensagem: [
      [cab, mudou].filter(Boolean).join('\n'),
      ['O que fazer:', ...topo.map(linha),
        ...(relevantes.length > topo.length ? [`+${relevantes.length - topo.length} na ficha do Dr. Vítor (Escritório virtual).`] : [])].join('\n'),
      `Já repassei aos colegas: ${porColega}.`,
    ].join('\n\n'),
  };
}

/** Linha do briefing matinal (bloco "Também precisa de você"). */
export function resumoParaBriefing(r: RaioX): { saude: number; graves: number; principais: string[] } {
  const graves = r.pendencias.filter(grave);
  return {
    saude: r.saude,
    graves: graves.length,
    principais: graves.slice(0, 3).map((p) => `${p.titulo}: ${p.motivo.replace(/\.$/, '')}`),
  };
}
