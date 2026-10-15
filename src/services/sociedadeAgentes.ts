/**
 * Sociedade dos agentes: a equipe conversa entre si sobre o trabalho real do
 * dia, faz reunião diária com ata e ideias, e guarda o que aprende (memória
 * que não se apaga). As conversas nascem de ações reais (agente_acoes); nada
 * de fato inventado. Regras puras — tests/atendenteSociedade.test.mjs.
 */
import { AGENTES } from './escritorioVirtual';

export const AGENTES_DA_SOCIEDADE = AGENTES.map((a) => a.id);
const NOME: Record<string, string> = Object.fromEntries(AGENTES.map((a) => [a.id, a.nome.replace(/^Dra?\.\s*/, '')]));

export interface Fala { quem: string; texto: string }
export interface ConversaAgentes { de: string; para: string; tema: string; falas: Fala[]; ref: number }

type Regra = { agente: string; re: RegExp; para: string; tema: string; falas: (m: RegExpMatchArray, n: (id: string) => string) => Array<[string, string]> };

const REGRAS: Regra[] = [
  { agente: 'leitor', re: /leu (a sentença|o acórdão) do proc\. (\S+)/, para: 'prazos', tema: 'prazo de recurso',
    falas: (m, n) => [['leitor', `${n('prazos')}, acabei de ler ${m[1]} do proc. ${m[2]} e mandei o resumo à Dra. Os prazos de recurso já foram junto.`],
      ['prazos', `Obrigada, ${n('leitor')}! Fico de olho nesse prazo até a Dra. confirmar.`]] },
  { agente: 'coletor', re: /reuniu todos os documentos de (.+?)( e escreveu|$)/, para: 'estagiario', tema: 'caso pronto para a peça',
    falas: (m, n) => [['coletor', `${n('estagiario')}, os documentos de ${m[1]} estão completos${/relato/.test(m[0]) ? ' e o relato do cliente já está no caso' : ''}.`],
      ['estagiario', `Perfeito, ${n('coletor')}! Vou pedir ao ${n('cerebro')} as teses da casa e preparar a minuta assim que a Dra. liberar.`]] },
  { agente: 'coletor', re: /cobrou (\d+) documento\(s\) de (.+)/, para: 'atendente', tema: 'documentos pendentes',
    falas: (m, n) => [['coletor', `${n('atendente')}, cobrei ${m[1]} documento(s) de ${m[2]}. Se ${m[2].split(' ')[0]} te chamar, lembra com jeitinho, por favor.`],
      ['atendente', `Pode deixar, ${n('coletor')}. Vou acolher e reforçar a lista.`]] },
  { agente: 'produtor', re: /montou a proposta nº (\d+) de (.+?) e pediu/, para: 'fechador', tema: 'proposta nova',
    falas: (m, n) => [['produtor', `${n('fechador')}, a proposta nº ${m[1]} de ${m[2]} foi para a Dra. aprovar.`],
      ['fechador', `Combinado, ${n('produtor')}. Quando for aceita, eu cuido do contrato até a assinatura.`]] },
  { agente: 'produtor', re: /enviou a proposta nº (\d+) a (.+?) depois/, para: 'comercial', tema: 'follow-up',
    falas: (m, n) => [['produtor', `${n('comercial')}, a Dra. aprovou e a proposta nº ${m[1]} já está com ${m[2]}.`],
      ['comercial', `Ótimo! Faço o acompanhamento em 48h, 5 e 7 dias.`]] },
  { agente: 'fechador', re: /lembrou (.+?) de assinar/, para: 'coletor', tema: 'contrato quase assinado',
    falas: (m, n) => [['fechador', `${n('coletor')}, ${m[1]} está para assinar o contrato. Já deixa a lista de documentos pronta.`],
      ['coletor', `Já está separada, ${n('fechador')}! Assim que assinar, eu peço.`]] },
  { agente: 'cerebro', re: /repassou (\d+) nota\(s\) da biblioteca para (.+)/, para: 'estagiario', tema: 'teses da casa',
    falas: (m, n) => [['cerebro', `${n('estagiario')}, separei ${m[1]} nota(s) do Obsidian para a sua minuta.`],
      ['estagiario', `Valeu, ${n('cerebro')}! Com as teses da casa a peça fica com a cara da Dra.`]] },
  { agente: 'laya', re: /qualificou um possível cliente sozinha: (.+?), urgência (\w+)/, para: 'produtor', tema: 'possível cliente qualificado',
    falas: (m, n) => [['laya', `${n('produtor')}, qualifiquei um possível cliente de ${m[1]}, urgência ${m[2]}, sem gastar IA paga.`],
      ['produtor', `Obrigada, ${n('laya')}! Quando chegar a hora, já sei qual tabela usar.`]] },
  { agente: 'atendente', re: /preparou resposta para (.+?)(?: \((.+)\))?$/, para: 'laya', tema: 'atendimento',
    falas: (m, n) => [['atendente', `${n('laya')}, conversei com ${m[1]}${m[2] ? ` (${m[2]})` : ''}. A resposta está esperando a aprovação da equipe.`],
      ['laya', `Anotado, ${n('atendente')}. Se for caso novo, eu ajudo a classificar.`]] },
  { agente: 'secretaria', re: /entregou à Dra\. a leitura da decisão do proc\. (\S+)/, para: 'leitor', tema: 'decisão entregue',
    falas: (m, n) => [['secretaria', `${n('leitor')}, entreguei à Dra. a sua leitura do proc. ${m[1]}.`],
      ['leitor', `Obrigado, ${n('secretaria')}!`]] },
];

/** O trabalho real vira conversa entre colegas (null = ação sem conversa). */
export function conversaDeAcao(a: { id: number; agente: string; texto: string }): ConversaAgentes | null {
  const n = (id: string) => NOME[id] || id;
  for (const r of REGRAS) {
    if (r.agente !== a.agente) continue;
    const m = String(a.texto || '').match(r.re);
    if (!m) continue;
    return { de: r.agente, para: r.para, tema: r.tema, falas: r.falas(m, n).map(([quem, texto]) => ({ quem, texto })), ref: a.id };
  }
  return null;
}

export function promptReuniao(d: { data: string; acoes: Record<string, string[]>; numeros: string[]; memorias: string[] }): string {
  return `Você conduz a reunião diária de uma equipe de agentes de um escritório de advocacia (Dra. Letícia Barros).
Cada agente tem nome, função e personalidade própria; eles se tratam com respeito e companheirismo, trocam experiências e ideias.
Escreva a reunião de ${d.data} usando SOMENTE os fatos abaixo. Não invente casos, números nem acontecimentos.
Agentes sem atividade podem ficar em silêncio. Ideias devem ser práticas e úteis à Dra.

O QUE CADA AGENTE FEZ HOJE:
${Object.entries(d.acoes).map(([ag, xs]) => `- ${ag} (${NOME[ag] || ag}): ${xs.slice(0, 8).join('; ')}`).join('\n') || '- (dia sem atividade registrada)'}

NÚMEROS DO DIA:
${d.numeros.join('\n')}

O QUE A EQUIPE JÁ APRENDEU (memória):
${d.memorias.slice(0, 15).map((m) => `- ${m}`).join('\n') || '- (ainda nada)'}

Responda SOMENTE com JSON (use os ids dos agentes):
{"ata":"resumo da reunião em 3-5 linhas","falas":[{"agente":"id","texto":"o que disse, 1-2 frases, em primeira pessoa"}],
 "ideias":[{"agente":"id","ideia":"melhoria concreta"}],"aprendizados":[{"agente":"id","texto":"o que aprendeu hoje, para lembrar sempre"}]}`;
}

export interface Reuniao { ata: string; falas: Array<{ agente: string; texto: string }>; ideias: Array<{ agente: string; ideia: string }>; aprendizados: Array<{ agente: string; texto: string }> }

export function parseReuniao(texto: string): Reuniao | null {
  const limpo = String(texto || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  if (!limpo.startsWith('{')) return null;
  let o: any;
  try { o = JSON.parse(limpo); } catch { return null; }
  const ata = typeof o?.ata === 'string' ? o.ata.trim() : '';
  if (!ata) return null;
  const valido = (id: unknown) => typeof id === 'string' && AGENTES_DA_SOCIEDADE.includes(id);
  const campo = (lista: unknown, k: string) => (Array.isArray(lista) ? lista : [])
    .filter((x: any) => valido(x?.agente) && typeof x?.[k] === 'string' && x[k].trim())
    .slice(0, 30).map((x: any) => ({ agente: x.agente, [k]: x[k].trim().slice(0, 500) }));
  return { ata: ata.slice(0, 2000), falas: campo(o.falas, 'texto') as any, ideias: campo(o.ideias, 'ideia') as any, aprendizados: campo(o.aprendizados, 'texto') as any };
}
