/**
 * Prazo de UMA intimação do DJEN — ponto único da regra (13/11/2026).
 *
 * Antes, o detector olhava só uma palavra-chave ("sentença" = apelação de 15
 * dias, "intimação" = 15 dias) e contava da DISPONIBILIZAÇÃO. Resultado real
 * (13/11/2026): sentença do Juizado Federal saía com 15 dias e termo 07/12,
 * quando o recurso inominado é de 10 dias e o termo, 01/12.
 *
 * Agora:
 * - o tipo de justiça (Juizado, Trabalho, comum) define o recurso e os dias,
 *   pela mesma tabela do Leitor de decisão (`recursosCabiveis`);
 * - a contagem segue a Lei 11.419/2006, art. 4º, §§3º e 4º, e o CPC, art. 224,
 *   §§2º e 3º: publicação = 1º dia útil após a disponibilização; o prazo começa
 *   no dia útil seguinte à publicação; dias úteis, feriados e recesso
 *   (`contarPrazo`);
 * - quando o texto não permite saber o prazo com segurança, a resposta é
 *   "revisão humana", com o motivo, e nunca uma data inventada;
 * - atos sem prazo para nós (ata de julgamento, alvará, arquivamento, ciência)
 *   não viram prazo.
 *
 * Função pura: sem banco, sem IA. A IA só resume o texto em outro lugar; o
 * prazo e a data nunca vêm dela.
 */
import { contarPrazo, proximoDiaUtil, diaUtilAnterior, ehDiaUtil } from '../utils/prazoUtil';
import { ehJuizado, recursosCabiveis, justicaDoNumero, type Justica } from './leitorDecisao';

export type Rito = 'juizado' | 'trabalho' | 'cpc';
export type CategoriaPrazo = 'prazo' | 'revisao' | 'sem_prazo';

export interface EntradaIntimacao {
  numeroProcesso?: string | null;
  tribunal?: string | null;
  orgao?: string | null;
  classe?: string | null;
  /** Tipo da comunicação / título da movimentação ("Intimação", "Ata de sessão"). */
  tipo?: string | null;
  texto?: string | null;
  /** Data de disponibilização no DJEN (YYYY-MM-DD). */
  disponibilizacao: string;
}

export interface AnalisePrazo {
  categoria: CategoriaPrazo;
  rito: Rito;
  /** O que fazer, em poucas palavras ("Recurso inominado", "Acompanhar"). */
  ato: string;
  /** Frase completa da providência sugerida. */
  providencia: string;
  dias: number | null;
  diasUteis: boolean;
  fundamento: string | null;
  disponibilizacao: string;
  publicacao: string;
  inicioContagem: string | null;
  /** Último dia do prazo pelo CPC/CLT/Lei 9.099 (data limite). */
  termoFinal: string | null;
  /** Um dia útil antes do termo final: margem de segurança. */
  protocolarAte: string | null;
  /** Como a data foi contada, em português simples. */
  explicacao: string;
  prioridade: 'alta' | 'media' | 'baixa';
  alertas: string[];
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const DIA_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const diaSemana = (iso: string) => DIA_SEMANA[new Date(iso + 'T12:00:00Z').getUTCDay()];

const AVISO_LOCAL = 'Feriados municipais e suspensões decretadas pelo tribunal não entram na conta: confira o calendário do tribunal.';
const FUNDAMENTO_CONTAGEM = 'Lei 11.419/2006, art. 4º, §§3º e 4º; CPC, art. 224, §§2º e 3º';

/** Justiça do Trabalho pelo nº CNJ (segmento J = 5) ou pelo tribunal; Juizado pelo órgão/classe; senão, CPC. */
export function ritoDoProcesso(e: Pick<EntradaIntimacao, 'numeroProcesso' | 'tribunal' | 'orgao' | 'classe' | 'texto'>): Rito {
  const num = (e.numeroProcesso || '').replace(/\D/g, '');
  if (num.length === 20 && num[13] === '5') return 'trabalho';
  if (/^(TRT|TST)/i.test((e.tribunal || '').trim())) return 'trabalho';
  if (ehJuizado(e.orgao, `${e.classe || ''}`)) return 'juizado';
  return 'cpc';
}

const NUMEROS: Record<string, number> = {
  um: 1, dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  doze: 12, quinze: 15, vinte: 20, trinta: 30, sessenta: 60, noventa: 90,
};

/** "no prazo de 5 (cinco) dias", "em quinze dias", "em 48 horas". */
function prazoEscrito(t: string): { n: number; unidade: 'dias' | 'horas'; corridos: boolean } | null {
  const re = /\b(?:prazo(?:\s+(?:comum|sucessivo|legal|improrrogavel))?\s+de|em|dentro\s+de)\s+(\d{1,3}|[a-z]+)\s*(?:\([^)]{0,30}\)\s*)?(dias?|horas?)(\s+uteis|\s+corridos)?/;
  const m = t.match(re);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMEROS[m[1]];
  if (!n) return null;
  return { n, unidade: m[2].startsWith('hora') ? 'horas' : 'dias', corridos: (m[3] || '').includes('corridos') };
}

/** Feriados (não fins de semana) que caíram dentro da contagem — para a explicação. */
function feriadosNoCaminho(inicio: string, fim: string): string[] {
  const out: string[] = [];
  let suspensao = false;
  const d = new Date(inicio + 'T12:00:00Z');
  for (let i = 0; i < 400; i++) {
    const dia = d.toISOString().slice(0, 10);
    if (dia > fim) break;
    const chk = ehDiaUtil(dia);
    if (!chk.util && chk.motivo && !/^(s[áa]bado|domingo)$/.test(chk.motivo)) {
      if (chk.motivo.startsWith('suspensão')) { if (!suspensao) { out.push('recesso de 20/12 a 20/01'); suspensao = true; } }
      else out.push(`${br(dia)} ${chk.motivo}`);
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

interface Decisao {
  categoria: CategoriaPrazo; ato: string; providencia: string;
  dias?: number; corridos?: boolean; fundamento?: string; prioridade?: AnalisePrazo['prioridade'];
  motivo?: string; alertas?: string[];
}

function decidir(e: EntradaIntimacao, rito: Rito): Decisao {
  const titulo = semAcento(`${e.tipo || ''}`);
  const t = semAcento(`${e.texto || ''}`);
  const tudo = `${titulo} ${t}`;

  // 1. Ata de sessão: o recurso conta da intimação do ACÓRDÃO, que ainda vai sair.
  if (/ata de (sessao|julgamento)|sessao de julgamento/.test(titulo) || /^\s*ata de (sessao|julgamento)/.test(t)) {
    return { categoria: 'sem_prazo', ato: 'Aguardar o acórdão', providencia: 'Ata de julgamento: anotar o resultado e aguardar a publicação do acórdão, de onde conta o prazo de recurso ou de embargos.', prioridade: 'media' };
  }

  // 2. Homologação de acordo: não há recurso para nós; acompanhar o pagamento.
  if (/homologo (o |a )?(presente )?acordo|acordo (celebrado )?homologado/.test(t)) {
    return { categoria: 'sem_prazo', ato: 'Acompanhar o acordo', providencia: 'Acordo homologado: acompanhar o pagamento das parcelas e o repasse ao cliente.', prioridade: 'media' };
  }

  // 3. Homologação de cálculos: depende de quem deve agir e da garantia do juízo.
  if (/homolog\w* (a |os )?(conta|calculos?)( de liquidacao)?|conta de liquidacao.{0,40}homolog/.test(t)) {
    return {
      categoria: 'revisao', ato: 'Conferir a homologação dos cálculos',
      providencia: 'Cálculos homologados: conferir se há interesse em impugnar (na execução trabalhista, a impugnação vem depois da garantia do juízo, CLT art. 884) e acompanhar o pagamento e a expedição dos alvarás.',
      motivo: 'A homologação de cálculos não abre, por si só, um prazo certo para o nosso cliente.', prioridade: 'media',
    };
  }

  // 4. Sentença: recurso pela tabela do tipo de justiça.
  const ehSentenca = /senten[c]a/.test(titulo) || /\bsentenca\b/.test(t.slice(0, 200))
    || /julgo (parcialmente )?(im)?procedentes?|julgo extint|extingo o processo|resolvo o merito/.test(t);
  const ehAcordao = /acordao/.test(titulo) || /\bacordao\b|acordam os/.test(t.slice(0, 400));
  if (ehAcordao || ehSentenca) {
    const tipo = ehAcordao ? 'acordao' : 'sentenca';
    const doNumero = justicaDoNumero(e.numeroProcesso || '');
    const justica: Justica = rito === 'trabalho' ? 'trabalho' : doNumero !== 'outra' ? doNumero : (/^TRF/i.test(e.tribunal || '') ? 'federal' : 'estadual');
    const [ed, recurso] = recursosCabiveis({ tipo, juizado: rito === 'juizado', justica });
    const fundamento = rito === 'trabalho'
      ? (tipo === 'sentenca' ? 'CLT, art. 895, I (8 dias) e art. 775 (dias úteis)' : 'CLT, art. 896 (8 dias) e art. 775 (dias úteis)')
      : rito === 'juizado'
        ? (tipo === 'sentenca' ? 'Lei 9.099/1995, art. 42 (10 dias) e art. 12-A (dias úteis)' : justica === 'federal' ? 'Lei 10.259/2001, art. 14, e RI da TNU (15 dias)' : 'CPC, art. 1.003, §5º (recurso extraordinário, 15 dias)')
        : 'CPC, art. 1.003, §5º (15 dias) e art. 219 (dias úteis)';
    return {
      categoria: 'prazo', ato: recurso.nome, dias: recurso.dias, fundamento, prioridade: 'alta',
      providencia: `${tipo === 'sentenca' ? 'Sentença' : 'Acórdão'}: avaliar o resultado e, se for o caso, interpor ${recurso.nome.toLowerCase()} no prazo de ${recurso.dias} dias úteis.`,
      alertas: [`Se houver omissão, contradição ou obscuridade, cabem ${ed.nome.toLowerCase()} em ${ed.dias} dias úteis (prazo menor).`],
    };
  }

  // 5. Contrarrazões / resposta a recurso.
  if (/contrarraz|contrarrazoar|contraminuta|resposta ao recurso/.test(t)) {
    const dias = rito === 'trabalho' ? 8 : rito === 'juizado' ? 10 : 15;
    return { categoria: 'prazo', ato: 'Contrarrazões', dias, prioridade: 'alta',
      fundamento: rito === 'trabalho' ? 'CLT, art. 900 (8 dias)' : rito === 'juizado' ? 'Lei 9.099/1995, art. 42, §2º (10 dias)' : 'CPC, art. 1.010, §1º (15 dias)',
      providencia: `Apresentar contrarrazões em ${dias} dias úteis.` };
  }

  // 6. Prazo escrito na própria decisão.
  const escrito = prazoEscrito(t);
  if (escrito?.unidade === 'horas') {
    return { categoria: 'revisao', ato: `Prazo de ${escrito.n} horas`, prioridade: 'alta',
      providencia: `A decisão fixa prazo de ${escrito.n} horas: conferir a quem se dirige e cumprir com urgência, se for para o nosso cliente.`,
      motivo: 'Prazo em horas conta de outra forma (CPC, art. 132, §4º, e a regra do tribunal) e precisa ser conferido na decisão.' };
  }
  if (escrito) {
    const embargosOutraParte = /embargos de declaracao/.test(t);
    return { categoria: 'prazo', ato: embargosOutraParte ? 'Manifestar sobre os embargos' : 'Cumprir / manifestar', dias: escrito.n, corridos: escrito.corridos,
      fundamento: 'Prazo fixado na própria decisão', prioridade: escrito.n <= 5 ? 'alta' : 'media',
      providencia: `Cumprir o que a decisão determina no prazo de ${escrito.n} dias${escrito.corridos ? ' corridos' : ' úteis'}. Conferir se a ordem se dirige ao nosso cliente.` };
  }

  // 7. Embargos de declaração da outra parte, sem prazo escrito.
  if (/embargos de declaracao/.test(t) && /manifest|contrarraz|vista/.test(t)) {
    return { categoria: 'prazo', ato: 'Manifestar sobre os embargos', dias: 5, prioridade: 'alta',
      fundamento: rito === 'trabalho' ? 'CLT, art. 897-A, §2º (5 dias)' : 'CPC, art. 1.023, §2º (5 dias)',
      providencia: 'Manifestar-se sobre os embargos de declaração em 5 dias úteis.' };
  }

  // 8. Réplica / laudo, no rito comum.
  if (rito === 'cpc' && /replica|manifest\w* (sobre|acerca) (a|da) contestacao/.test(t)) {
    return { categoria: 'prazo', ato: 'Réplica', dias: 15, fundamento: 'CPC, arts. 350 e 351 (15 dias)', prioridade: 'media',
      providencia: 'Apresentar réplica à contestação em 15 dias úteis.' };
  }
  if (rito === 'cpc' && /laudo/.test(t) && /manifest|vista|ciencia/.test(t)) {
    return { categoria: 'prazo', ato: 'Manifestar sobre o laudo', dias: 15, fundamento: 'CPC, art. 477, §1º (15 dias)', prioridade: 'media',
      providencia: 'Manifestar-se sobre o laudo pericial em 15 dias úteis.' };
  }

  // 9. Citação: o termo inicial da contestação varia (audiência, juntada do AR).
  if (/cita[c]ao|cite-se/.test(tudo)) {
    return { categoria: 'revisao', ato: 'Citação', prioridade: 'alta',
      providencia: 'Citação: conferir o termo inicial da defesa (audiência de conciliação, juntada do mandado ou do AR) e preparar a contestação.',
      motivo: 'O prazo de defesa não conta da publicação: depende da audiência ou da juntada da citação.' };
  }

  // 10. Atos sem prazo para nós.
  if (/alvara/.test(t)) return { categoria: 'sem_prazo', ato: 'Acompanhar o alvará', prioridade: 'media', providencia: 'Acompanhar a expedição e o levantamento do alvará e avisar o cliente.' };
  if (/retorno dos autos|baixa dos autos|remessa dos autos|remetam-se/.test(t)) return { categoria: 'sem_prazo', ato: 'Acompanhar o andamento', prioridade: 'baixa', providencia: 'Acompanhar a remessa ou o retorno dos autos e o prosseguimento do processo.' };
  if (/arquivem-se|arquivamento|arquive-se/.test(t)) return { categoria: 'sem_prazo', ato: 'Arquivamento', prioridade: 'baixa', providencia: 'Processo indo ao arquivo: conferir se há valores ou providências pendentes antes do arquivamento.' };
  if (/audiencia/.test(t) && /design|redesign|marcad|pauta/.test(t)) return { categoria: 'sem_prazo', ato: 'Audiência designada', prioridade: 'alta', providencia: 'Audiência marcada: conferir data, hora e modo (presencial ou virtual), lançar na agenda e avisar o cliente e as testemunhas.' };
  if (/transito em julgado|transitou em julgado/.test(t)) return { categoria: 'sem_prazo', ato: 'Trânsito em julgado', prioridade: 'media', providencia: 'Trânsito em julgado: conferir se cabe cumprimento de sentença ou execução.' };
  if (/\bciencia\b|fica(m)? ciente|para conhecimento/.test(t)) return { categoria: 'sem_prazo', ato: 'Apenas ciência', prioridade: 'baixa', providencia: 'Intimação apenas para ciência: conferir o teor; não há prazo para o nosso cliente.' };

  // 11. Não deu para saber.
  return { categoria: 'revisao', ato: 'Revisão humana', prioridade: 'media',
    providencia: 'Ler o inteiro teor no sistema do tribunal e decidir a providência.',
    motivo: 'O recorte não permite identificar o prazo com segurança. Complementar a triagem no inteiro teor, no sistema do tribunal.' };
}

export function analisarPrazoIntimacao(e: EntradaIntimacao): AnalisePrazo {
  const rito = ritoDoProcesso(e);
  const disponibilizacao = e.disponibilizacao.slice(0, 10);
  const publicacao = proximoDiaUtil(disponibilizacao);
  const d = decidir(e, rito);
  const base = {
    rito, ato: d.ato, providencia: d.providencia, disponibilizacao, publicacao,
    prioridade: d.prioridade || 'media', alertas: [...(d.alertas || [])],
  };
  const linhaPublicacao = `Disponibilizada no DJEN em ${br(disponibilizacao)} (${diaSemana(disponibilizacao)}); publicação em ${br(publicacao)} (${diaSemana(publicacao)}).`;

  if (d.categoria !== 'prazo' || !d.dias) {
    return {
      ...base, categoria: d.categoria, dias: null, diasUteis: true, fundamento: null,
      inicioContagem: null, termoFinal: null, protocolarAte: null,
      explicacao: `${linhaPublicacao} ${d.motivo || 'Nenhum prazo para o nosso cliente nesta publicação.'}`,
    };
  }

  const uteis = !d.corridos;
  const inicioContagem = uteis ? proximoDiaUtil(publicacao, {}) : proximoDiaUtil(publicacao, { uteis: false, suspensaoFimAno: true });
  const termoFinal = contarPrazo(publicacao, d.dias, { uteis }).vencimento;
  const protocolarAte = diaUtilAnterior(termoFinal);
  const pulos = feriadosNoCaminho(inicioContagem, termoFinal);
  const explicacao = [
    linhaPublicacao,
    `Contagem em ${uteis ? 'dias úteis' : 'dias corridos'} de ${br(inicioContagem)} a ${br(termoFinal)} (${d.dias} dias)${uteis ? ', sem sábados, domingos e feriados' : ''}${pulos.length ? ` (pulados: ${pulos.join('; ')})` : ''}.`,
    `Data limite: ${br(termoFinal)}. Protocolar até ${br(protocolarAte)}, um dia útil antes, por segurança.`,
    `Base: ${d.fundamento}; contagem: ${FUNDAMENTO_CONTAGEM}.`,
    AVISO_LOCAL,
  ].join(' ');

  // Embargos de declaração: data própria, menor que a do recurso.
  const alertas = base.alertas.map((a) => /embargos de declara/i.test(a)
    ? `${a.replace(/\.$/, '')}: até ${br(contarPrazo(publicacao, 5).vencimento)}.`
    : a);

  return {
    ...base, alertas, categoria: 'prazo', dias: d.dias, diasUteis: uteis, fundamento: d.fundamento || null,
    inicioContagem, termoFinal, protocolarAte, explicacao,
  };
}
