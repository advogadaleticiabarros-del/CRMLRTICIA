/**
 * Minutas oficiais do escritório: contrato de prestação de serviços (13 cláusulas),
 * procuração ad judicia et extra e declaração de hipossuficiência.
 * Preenche os dados conhecidos da parte e da advogada (cadastro); placeholders
 * apenas para o que faltar.
 */

// Dados da CONTRATADA / OUTORGADA (advogada). Default fixo como fallback;
// o real vem do cadastro do advogado (services/escritorio.ts).
export interface ContratadaInfo { nome: string; oab: string; endereco: string; email?: string }

export const ADVOGADA: ContratadaInfo = {
  nome: 'LETÍCIA ELIAS BARROS',
  oab: 'OAB/ES sob o nº 39.948',
  endereco: 'London Office Tower, R. José Alexandre Buaiz, nº 160, Sala 115, Enseada do Suá, Vitória/ES, CEP 29.050-545',
  email: 'advogadaleticia.barros@gmail.com / contato@advogadaleticiabarros.com',
};
const FORO = 'Vitória/ES';

const contratadaBloco = (c: ContratadaInfo) =>
  `${c.nome}, advogada inscrita na ${c.oab}, com escritório profissional localizado na ${c.endereco}${c.email ? `, e-mail: ${c.email}` : ''}`;
const outorgadaBloco = (c: ContratadaInfo) =>
  `${c.nome}, advogada inscrita na ${c.oab}, com escritório profissional localizado na ${c.endereco}${c.email ? `, endereço eletrônico: ${c.email}` : ''}`;

export interface PartyData {
  name?: string | null;
  nacionalidade?: string | null;
  estadoCivil?: string | null;
  profissao?: string | null;
  cpf?: string | null;
  rg?: string | null;
  endereco?: string | null;
  email?: string | null;
  phone?: string | null;
}

/** Monta a string de endereço a partir dos campos do lead/cliente. */
export function montarEndereco(src: {
  street?: string | null; number?: string | null; neighborhood?: string | null;
  city?: string | null; state?: string | null; cep?: string | null; address?: string | null;
}): string | null {
  if (src.address && src.address.trim()) return src.address.trim();
  const ruaNum = [src.street, src.number].filter(Boolean).join(', ');
  const cidadeUf = [src.city, src.state].filter(Boolean).join('/');
  const partes = [ruaNum, src.neighborhood, cidadeUf].filter((s) => s && String(s).trim());
  let out = partes.join(', ');
  if (src.cep && String(src.cep).trim()) out += `${out ? ' - ' : ''}CEP ${src.cep}`;
  return out || null;
}

function f(p: PartyData) {
  return {
    nome: p.name || '[NOME DO CLIENTE]',
    nac: p.nacionalidade || 'brasileiro(a)',
    prof: p.profissao || '[profissão]',
    cpf: p.cpf || '[CPF]',
    end: p.endereco || '[ENDEREÇO]',
    email: p.email || '',
    phone: p.phone || '',
  };
}

/** Qualificação completa da parte (sem estado civil/RG, conforme padrão do escritório). */
function qualificacao(p: ReturnType<typeof f>): string {
  let q = `${p.nome}, ${p.nac}, ${p.prof}, inscrito(a) no CPF nº ${p.cpf}, residente e domiciliado(a) na ${p.end}`;
  if (p.email) q += `, endereço eletrônico: ${p.email}`;
  if (p.phone) q += `, telefone: ${p.phone}`;
  return q;
}

/** Texto da forma de pagamento a partir do parcelamento da proposta (entrada + parcelas). */
export function formaPagamentoTexto(parc: any): string {
  if (!parc || !Number(parc.total)) return '';
  const money = (v: number) => `R$ ${(Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const dt = (s: string) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('pt-BR') : '');
  const entrada = Number(parc.entrada) || 0;
  const n = parseInt(parc.parcelas) || 0;
  const vParc = Number(parc.valor_parcela) || 0;
  const ult = Number(parc.ultima_parcela) || vParc;
  const partes: string[] = [];
  if (entrada > 0) partes.push(`entrada de ${money(entrada)}${parc.entrada_data ? ` em ${dt(parc.entrada_data)}` : ''}`);
  if (n > 0) {
    let p = `${n} parcela(s) mensal(is) de ${money(vParc)}`;
    if (ult && ult !== vParc) p += ` (última de ${money(ult)})`;
    if (parc.primeiro_vencimento) p += `, com primeiro vencimento em ${dt(parc.primeiro_vencimento)}`;
    partes.push(p);
  }
  return partes.join(', e ');
}

export function buildProcuracao(party: PartyData | string, contratada: ContratadaInfo = ADVOGADA): string {
  const p = typeof party === 'string' ? f({ name: party }) : f(party);
  return `PROCURAÇÃO AD JUDICIA ET EXTRA

OUTORGANTE: ${qualificacao(p)}.

OUTORGADO(A): ${outorgadaBloco(contratada)}.

PODERES: Pelo presente instrumento, o(a) OUTORGANTE confere ao(à) OUTORGADO(A) os poderes da cláusula ad judicia et extra para o foro em geral, a fim de representá-lo(a) em qualquer Juízo, Instância, Tribunal ou repartição pública e privada. Ficam abrangidos os poderes especiais para receber citação, confessar, transigir, desistir, renunciar ao direito, receber e dar quitação, firmar compromissos e assinar declaração de hipossuficiência, nos termos do art. 105 do Código de Processo Civil.

VALIDADE: O presente mandato é outorgado por prazo indeterminado, mantendo sua validade até o cumprimento integral de seu objeto ou a sua expressa revogação.

${FORO}, [DATA].


_______________________________________
${p.nome}
CPF nº ${p.cpf}`;
}

export function buildDeclaracao(party: PartyData | string): string {
  const p = typeof party === 'string' ? f({ name: party }) : f(party);
  return `DECLARAÇÃO DE HIPOSSUFICIÊNCIA

Eu, ${qualificacao(p)}, DECLARO para os devidos fins, sob as penas da lei, que não possuo condições financeiras de arcar com as custas, despesas processuais e honorários advocatícios sem prejuízo do meu sustento e de minha família.

A presente declaração é feita nos termos do art. 98 e seguintes do Código de Processo Civil, bem como do art. 790, §§ 3º e 4º, da Consolidação das Leis do Trabalho (CLT).

${FORO}, [DATA].


_______________________________________
${p.nome}
CPF nº ${p.cpf}`;
}

const AREA_OBJECT: Record<string, string> = {
  trabalhista: 'o ajuizamento, acompanhamento e patrocínio de Ação Trabalhista, até a prolação da sentença, visando ao recebimento das verbas e direitos trabalhistas devidos ao(à) CONTRATANTE.',
  gestante: 'a defesa dos direitos da gestante, incluindo estabilidade gravídica, licença-maternidade e reversão de demissão irregular, em favor do(a) CONTRATANTE.',
  familia: 'a atuação em demanda de direito de família (divórcio, guarda, pensão alimentícia ou inventário), conforme a necessidade do(a) CONTRATANTE.',
  civel: 'o patrocínio de ação cível, incluindo cobrança, reparação de danos e responsabilidade civil em favor do(a) CONTRATANTE.',
  previdenciario: 'o requerimento administrativo e/ou judicial de benefício previdenciário junto ao INSS em favor do(a) CONTRATANTE.',
  consumidor: 'a defesa dos direitos do consumidor, incluindo cobranças indevidas, vícios de produto/serviço e reparação de danos, em favor do(a) CONTRATANTE.',
  outro: 'a prestação de serviços advocatícios conforme objeto a ser detalhado entre as partes.',
};

export function buildTemplate(opts: { clientName?: string; party?: PartyData; area: string; value?: number; formaPagamento?: string; exitoPct?: number; tipoCausa?: string; descricao?: string; contratada?: ContratadaInfo }): string {
  const p = f(opts.party || { name: opts.clientName });
  const adv = opts.contratada || ADVOGADA;
  const obj = AREA_OBJECT[opts.area] ?? AREA_OBJECT.outro;
  const espec = (opts.tipoCausa && opts.tipoCausa.trim())
    ? ` Especificamente, ${opts.tipoCausa.trim()}${opts.descricao && opts.descricao.trim() ? `: ${opts.descricao.trim()}` : ''}.`
    : '';
  const valorStr = opts.value ? `R$ ${Number(opts.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '[VALOR DOS HONORÁRIOS]';
  const forma = opts.formaPagamento && opts.formaPagamento.trim() ? `, ${opts.formaPagamento.trim()}` : '';
  const exito = opts.exitoPct ? `${opts.exitoPct}% (${opts.exitoPct} por cento)` : '[___]% ([___] por cento)';

  return `CONTRATO DE PRESTAÇÃO DE SERVIÇOS ADVOCATÍCIOS

CONTRATANTE: ${qualificacao(p)}.

CONTRATADA: ${contratadaBloco(adv)}.

As partes acima identificadas têm entre si justo e contratado o presente CONTRATO DE PRESTAÇÃO DE SERVIÇOS ADVOCATÍCIOS, que se regerá pelas cláusulas e condições seguintes:

CLÁUSULA PRIMEIRA — DO OBJETO DO CONTRATO
O presente contrato tem como objeto a prestação de serviços advocatícios para ${obj}${espec}

CLÁUSULA SEGUNDA — DO PREÇO E FORMA DE PAGAMENTO
Pelos serviços advocatícios descritos na Cláusula Primeira, a CONTRATANTE pagará à CONTRATADA o valor de ${valorStr}, a título de honorários contratuais${forma}. Além disso, em caso de êxito na demanda, a CONTRATADA fará jus ao percentual de ${exito} sobre o proveito econômico total obtido pela CONTRATANTE, seja por meio de acordo, sentença ou qualquer forma de recebimento decorrente da presente ação, a título de honorários de êxito.

PARÁGRAFO PRIMEIRO — Considera-se êxito toda e qualquer vantagem financeira, direta ou indireta, obtida por meio de acordo judicial ou extrajudicial, sentença, execução, cumprimento de sentença ou pagamento espontâneo, inclusive valores pagos a título de FGTS, indenizações, reflexos, juros, correção monetária, multas ou verbas acessórias.

PARÁGRAFO SEGUNDO — Pela elaboração, conferência e acompanhamento dos cálculos de liquidação de sentença, será devido à CONTRATADA o percentual adicional de 2% (dois por cento) sobre o valor líquido apurado.

PARÁGRAFO TERCEIRO — Os honorários ora pactuados constituem obrigação líquida, certa e exigível, nos termos do art. 24 da Lei nº 8.906/94, sendo devidos ainda que o pagamento à CONTRATANTE ocorra por interposta pessoa ou fora dos autos.

PARÁGRAFO QUARTO — Em caso de inadimplemento, incidirá multa de 10% (dez por cento), juros de 1% (um por cento) ao mês, correção monetária e demais sanções previstas na Lei nº 9.492/97 (Lei de Protestos).

PARÁGRAFO QUINTO — CANCELAMENTO OU DESCUMPRIMENTO: o cancelamento imotivado ou o descumprimento contratual por qualquer das partes implicará o pagamento à CONTRATADA de 20% (vinte por cento) do valor total dos honorários pactuados, a título de cláusula penal.

CLÁUSULA TERCEIRA — DAS DESPESAS JUDICIAIS E ADMINISTRATIVAS
Todas as despesas judiciais e/ou administrativas necessárias à consecução dos serviços ora contratados, tais como custas processuais, perícias, diligências oficiais, depósitos recursais, garantias reais ou fidejussórias, cauções, fotocópias e autenticações, não estão incluídas nos valores previstos na Cláusula Segunda, sendo de inteira responsabilidade do(a) CONTRATANTE, que as disponibilizará à CONTRATADA quando e se houver.

PARÁGRAFO ÚNICO — As despesas de deslocamento ficam a cargo do(a) CONTRATANTE, sendo cobrado o valor de R$ 1,00 (um real) por km rodado em local fora da Grande Vitória.

CLÁUSULA QUARTA — DAS INFORMAÇÕES
O(A) CONTRATANTE obriga-se a fornecer à CONTRATADA todas as informações, documentos e materiais que estiverem em sua posse e que sejam necessários à efetivação dos serviços, sob pena de paralisação. O prazo máximo para entrega de documentos é de 30 (trinta) dias a partir da solicitação, sob pena de cancelamento do contrato com a antecipação do vencimento dos honorários advocatícios.

CLÁUSULA QUINTA — DAS ALTERAÇÕES E DA RESCISÃO
O presente contrato poderá ser revisto e alterado em comum acordo, em quaisquer de suas condições. Poderá ser rescindido de pleno direito por qualquer das partes, mediante comunicado escrito e com entrega à outra parte devidamente comprovada. A rescisão não prejudica a aplicação da multa já prevista.

CLÁUSULA SEXTA — DA TRANSFERÊNCIA, CESSÃO E REPASSE
Nenhuma das partes poderá ceder, transferir ou repassar, no todo ou em parte, de forma gratuita ou onerosa, quaisquer dos direitos e obrigações oriundos do presente contrato sem a prévia anuência da outra, salvo em caso de substabelecimento da CONTRATADA.

CLÁUSULA SÉTIMA — DA EXTENSÃO DAS OBRIGAÇÕES
Para todos os fins e efeitos de Direito, as partes declaram aceitar o presente contrato nos expressos termos e condições em que foi lavrado, obrigando-se a si, seus herdeiros e sucessores a bem e fielmente cumpri-lo no que diz respeito à Cláusula Primeira, até a sentença de 1º Grau.

CLÁUSULA OITAVA — DA POLÍTICA DE PRIVACIDADE E PROTEÇÃO DE DADOS (LGPD)
Em cumprimento à Lei Geral de Proteção de Dados Pessoais — LGPD (Lei nº 13.709/2018, com a redação dada pela Lei nº 13.853/2019), a CONTRATADA obriga-se a respeitar a privacidade do(a) CONTRATANTE, protegendo e mantendo em sigilo os dados pessoais fornecidos em função deste contrato, salvo nos casos em que seja obrigada, por autoridade pública, a revelá-los a terceiros.

PARÁGRAFO PRIMEIRO — Nos termos do art. 7º, VI, da LGPD, a CONTRATADA está autorizada a realizar o tratamento de dados pessoais do(a) CONTRATANTE (exercício regular de direitos em processo judicial) e, com base no art. 10, I, da LGPD, ostenta legítimo interesse em armazenar, acessar, avaliar, modificar, transferir e comunicar, por tempo indeterminado, todas e quaisquer peças processuais, contratos, e-mails, cartas e demais documentações relativas ao objeto desta contratação.

PARÁGRAFO SEGUNDO — A operação de tratamento de dados é e sempre será realizada unicamente em apoio às atividades técnicas e intelectuais desenvolvidas internamente pela CONTRATADA, em especial para fins de comprovação e defesa da regular prestação dos serviços advocatícios.

CLÁUSULA NONA — DO TÍTULO EXECUTIVO
O presente contrato particular de prestação de serviços de advocacia constitui título executivo, nos termos do art. 24, caput, da Lei nº 8.906/94 — Estatuto da Advocacia e da Ordem dos Advogados do Brasil.

CLÁUSULA DÉCIMA — DA NÃO RESPONSABILIZAÇÃO POR GOLPE DO FALSO ADVOGADO
A CONTRATADA não se responsabiliza, em hipótese alguma, por prejuízos decorrentes de golpes praticados por terceiros, inclusive aqueles conhecidos como golpe do falso advogado, abrangendo contatos fraudulentos por telefone, aplicativos de mensagens, redes sociais, e-mails ou outros meios, inclusive com uso de inteligência artificial para clonagem ou modificação de voz, imagem ou identidade.

PARÁGRAFO PRIMEIRO — O(A) CONTRATANTE declara estar ciente de que todas as comunicações oficiais e solicitações financeiras ocorrem exclusivamente pelos canais oficiais do escritório, previamente divulgados.

PARÁGRAFO SEGUNDO — Qualquer pagamento ou fornecimento de dados realizado fora desses canais será de inteira responsabilidade do(a) CONTRATANTE, não gerando obrigação ou responsabilidade à CONTRATADA.

CLÁUSULA DÉCIMA PRIMEIRA — DA VEDAÇÃO À ACEITAÇÃO DE ACORDO SEM AUTORIZAÇÃO
O(A) CONTRATANTE não poderá negociar, aceitar ou formalizar qualquer proposta de acordo, direta ou indiretamente, sem autorização expressa da CONTRATADA, ainda que apresentada pela parte contrária ou pelo Juízo.

PARÁGRAFO ÚNICO — O descumprimento desta cláusula caracteriza infração contratual grave, sujeitando o(a) CONTRATANTE ao pagamento de multa não compensatória equivalente a 10% (dez por cento) sobre o valor atualizado da causa, além dos honorários pactuados.

CLÁUSULA DÉCIMA SEGUNDA — DA NATUREZA DA OBRIGAÇÃO
O presente contrato configura obrigação de meio, não garantindo resultado específico, inexistindo responsabilidade da CONTRATADA por decisões judiciais desfavoráveis ou por fatores alheios à atuação técnica.

CLÁUSULA DÉCIMA TERCEIRA — DO FORO DE ELEIÇÃO
Fica eleito o Foro de ${FORO} para dirimir quaisquer divergências oriundas da interpretação e/ou execução do presente contrato, com renúncia expressa a qualquer outro, por mais privilegiado que seja.

E por estarem assim justos e contratados, firmam o presente em duas vias de igual teor e forma, na presença de duas testemunhas, para que produza seus efeitos legais.

${FORO}, [DATA].


_______________________________________
CONTRATANTE: ${p.nome}
CPF nº ${p.cpf}


_______________________________________
${adv.nome}
${adv.oab.replace(' sob o nº ', ' ')}`;
}
