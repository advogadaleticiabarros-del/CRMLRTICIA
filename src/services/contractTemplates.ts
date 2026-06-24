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

// Dados de pagamento oficiais (Cláusula Décima)
const DADOS_PAGAMENTO = {
  emails: 'advogadaleticia.barros@gmail.com ou financeiro.advleticiabarros@gmail.com',
  telefones: '(44) 99101-1402 ou (27) 99515-1402',
  beneficiario: 'Letícia Elias Barros',
  instituicao: 'Nu Pagamentos S.A. (Banco 260)',
  agencia: '0001',
  conta: '[Nº DA CONTA CORRENTE]',
  pix: '134.510.707-23 (CPF) ou financeiro.advleticiabarros@gmail.com (e-mail)',
};

const EXTENSO_PCT: Record<number, string> = { 5: 'cinco', 10: 'dez', 15: 'quinze', 20: 'vinte', 25: 'vinte e cinco', 30: 'trinta', 40: 'quarenta', 50: 'cinquenta' };
const extensoPct = (n: number) => `${EXTENSO_PCT[n] ? EXTENSO_PCT[n] + ' por cento' : n + ' por cento'}`;

const AREA_OBJECT: Record<string, string> = {
  trabalhista: 'o ajuizamento, acompanhamento e patrocínio de Ação Trabalhista, perante a Vara do Trabalho competente, até a prolação da sentença, visando ao reconhecimento dos direitos e à cobrança das verbas trabalhistas devidas ao(à) CONTRATANTE.',
  gestante: 'a defesa dos direitos da gestante, incluindo estabilidade gravídica, licença-maternidade e reversão de demissão irregular, em favor do(a) CONTRATANTE.',
  familia: 'a atuação em demanda de direito de família (divórcio, guarda, pensão alimentícia ou inventário), conforme a necessidade do(a) CONTRATANTE.',
  civel: 'o patrocínio de ação cível, incluindo cobrança, reparação de danos e responsabilidade civil em favor do(a) CONTRATANTE.',
  previdenciario: 'o requerimento administrativo e/ou judicial de benefício previdenciário junto ao INSS em favor do(a) CONTRATANTE.',
  consumidor: 'a defesa dos direitos do consumidor, incluindo cobranças indevidas, vícios de produto/serviço e reparação de danos, em favor do(a) CONTRATANTE.',
  outro: 'a prestação de serviços advocatícios conforme objeto a ser detalhado entre as partes.',
};

/**
 * Cláusula Segunda (preço/forma de pagamento) montada a partir do que foi aceito
 * na proposta: honorários contratuais (entrada/fixo/parcelas), êxito %, ad exitum,
 * consulta, mensal, diligência, sucumbência, arbitrados. É a REGRA do contrato.
 */
export function montarClausulaValores(opts: { honorarios?: any; value?: number; formaPagamento?: string; exitoPct?: number }): { texto: string; exitoUsado: number } {
  const money = (n: number) => `R$ ${(Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const h = opts.honorarios || {};
  const m: string[] = Array.isArray(h.modalidades) ? h.modalidades : [];
  const v = h.values || {};
  const parc = h.parcelamento;
  const segs: string[] = [];
  let exitoUsado = 0;

  // 1) Honorários contratuais (entrada/fixo/parcelamento)
  if (parc && Number(parc.total) > 0) {
    const fp = formaPagamentoTexto(parc);
    segs.push(`o valor de ${money(parc.total)}, a título de honorários contratuais${fp ? `, ${fp}` : ''}`);
  } else if (opts.value && Number(opts.value) > 0) {
    const fp = opts.formaPagamento && opts.formaPagamento.trim() ? `, ${opts.formaPagamento.trim()}` : '';
    segs.push(`o valor de ${money(opts.value)}, a título de honorários contratuais${fp}`);
  } else if (Number(v.fixo) || Number(v.entrada)) {
    segs.push(`o valor de ${money((Number(v.entrada) || 0) + (Number(v.fixo) || 0))}, a título de honorários contratuais`);
  }

  // 2) Êxito
  const exPct = (m.includes('exito') && Number(v.exito)) ? Number(v.exito) : (opts.exitoPct || 0);
  if (exPct) { exitoUsado = exPct; segs.push(`honorários de êxito no percentual de ${exPct}% (${extensoPct(exPct)}) sobre o proveito econômico total obtido pela CONTRATANTE, seja por meio de acordo, sentença ou qualquer forma de recebimento decorrente da ação`); }
  // 3) Ad exitum / quota litis
  if (m.includes('ad_exitum') && Number(v.ad_exitum)) { if (!exitoUsado) exitoUsado = Number(v.ad_exitum); segs.push(`honorários no percentual de ${v.ad_exitum}% (${extensoPct(Number(v.ad_exitum))}) sobre o proveito econômico, na modalidade ad exitum (quota litis)`); }
  // 4) Consulta / 5) Mensal / 6) Diligência
  if (m.includes('consulta') && Number(v.consulta)) segs.push(`o valor de ${money(v.consulta)} a título de honorários de consulta`);
  if (m.includes('mensal') && Number(v.mensal)) segs.push(`o valor mensal de ${money(v.mensal)}, a título de advocacia de partido`);
  if (m.includes('diligencia') && Number(v.diligencia)) segs.push(`o valor de ${money(v.diligencia)} por diligência ou ato isolado${v.diligencia_desc ? ` (${v.diligencia_desc})` : ''}`);

  // Fallback: nada definido → êxito padrão do escritório (30%)
  if (!segs.length) { exitoUsado = 30; segs.push(`honorários de êxito no percentual de 30% (trinta por cento) sobre o proveito econômico total obtido pela CONTRATANTE, seja por meio de acordo, sentença ou qualquer forma de recebimento decorrente da ação`); }

  let texto = `Pelos serviços advocatícios descritos na Cláusula Primeira, a CONTRATANTE pagará à CONTRATADA ${segs.join(', e ainda ')}.`;
  if (m.includes('sucumbencia')) texto += ` Os honorários de sucumbência, quando houver, pertencem exclusivamente à CONTRATADA, nos termos do art. 23 da Lei nº 8.906/94.`;
  if (m.includes('arbitrado')) texto += ` Os honorários poderão, ainda, ser arbitrados judicialmente.`;
  return { texto, exitoUsado: exitoUsado || 30 };
}

export function buildTemplate(opts: { clientName?: string; party?: PartyData; area: string; value?: number; formaPagamento?: string; exitoPct?: number; honorarios?: any; tipoCausa?: string; descricao?: string; contratada?: ContratadaInfo }): string {
  const p = f(opts.party || { name: opts.clientName });
  const adv = opts.contratada || ADVOGADA;
  const obj = AREA_OBJECT[opts.area] ?? AREA_OBJECT.outro;
  const espec = (opts.tipoCausa && opts.tipoCausa.trim())
    ? ` Especificamente, ${opts.tipoCausa.trim()}${opts.descricao && opts.descricao.trim() ? `: ${opts.descricao.trim()}` : ''}.`
    : '';

  // Cláusula 2ª adaptada ao que foi aceito na proposta
  const { texto: clausulaSegunda, exitoUsado: pct } = montarClausulaValores(opts);

  return `CONTRATO DE PRESTAÇÃO DE SERVIÇOS ADVOCATÍCIOS

CONTRATANTE: ${qualificacao(p)}.

CONTRATADA: ${contratadaBloco(adv)}.

As partes acima identificadas têm entre si justo e contratado o presente Contrato de Prestação de Serviços Advocatícios, que se regerá pelas cláusulas e condições seguintes:

CLÁUSULA PRIMEIRA - DO OBJETO DO CONTRATO
O presente contrato tem como objeto a prestação de serviços advocatícios para ${obj}${espec}

CLÁUSULA SEGUNDA - DO PREÇO E FORMA DE PAGAMENTO
${clausulaSegunda}

CLÁUSULA TERCEIRA - DAS DESPESAS JUDICIAIS E ADMINISTRATIVAS
Todas as despesas necessárias para a execução dos serviços, como custas processuais, perícias, diligências, depósitos, fotocópias e autenticações, não estão incluídas nos honorários e são de responsabilidade da CONTRATANTE.

CLÁUSULA QUARTA - DAS OBRIGAÇÕES DA CONTRATANTE
A CONTRATANTE se obriga a fornecer à CONTRATADA todas as informações e documentos necessários à efetivação dos serviços, sob pena de paralisação dos trabalhos e eventual rescisão contratual.

CLÁUSULA QUINTA - DAS ALTERAÇÕES E DA RESCISÃO
O presente contrato poderá ser alterado por mútuo acordo e rescindido por qualquer das partes mediante comunicado escrito. A rescisão imotivada pela CONTRATANTE implicará o pagamento de multa contratual e honorários proporcionais ao trabalho realizado.

CLÁUSULA SEXTA - DA CESSÃO E TRANSFERÊNCIA
Nenhuma das partes poderá ceder ou transferir os direitos e obrigações deste contrato sem a prévia anuência da outra, salvo o substabelecimento do mandato pela CONTRATADA.

CLÁUSULA SÉTIMA - DA EXTENSÃO DAS OBRIGAÇÕES
As partes se obrigam por si, seus herdeiros e sucessores a cumprir o presente contrato nos seus expressos termos.

CLÁUSULA OITAVA - DA POLÍTICA DE PRIVACIDADE E PROTEÇÃO DE DADOS
Em cumprimento à Lei Geral de Proteção de Dados Pessoais (LGPD), a CONTRATADA se obriga a respeitar a privacidade da CONTRATANTE, mantendo em sigilo todos os dados pessoais fornecidos em função deste contrato.

CLÁUSULA NONA - DO TÍTULO EXECUTIVO
O presente contrato constitui título executivo extrajudicial, nos termos do artigo 24 da Lei nº 8.906/94 (Estatuto da Advocacia e da OAB) e do art. 784 do Código de Processo Civil.

CLÁUSULA DÉCIMA - DA NÃO RESPONSABILIZAÇÃO E DOS CANAIS OFICIAIS
A CONTRATADA não se responsabiliza, em hipótese alguma, por prejuízos decorrentes de golpes praticados por terceiros, inclusive aqueles conhecidos como "golpe do falso advogado".

PARÁGRAFO PRIMEIRO - A CONTRATANTE declara estar ciente e de acordo que todas as comunicações oficiais, bem como solicitações financeiras relacionadas a este contrato, ocorrerão exclusivamente por meio dos seguintes canais: E-mails autorizados: ${DADOS_PAGAMENTO.emails}. Telefones/WhatsApp autorizados: ${DADOS_PAGAMENTO.telefones}.

PARÁGRAFO SEGUNDO - Fica estabelecido que os pagamentos de honorários serão devidos exclusivamente em conta de titularidade da CONTRATADA, cujos dados são: Beneficiário: ${DADOS_PAGAMENTO.beneficiario}; Instituição: ${DADOS_PAGAMENTO.instituicao}; Agência: ${DADOS_PAGAMENTO.agencia}; Conta Corrente: ${DADOS_PAGAMENTO.conta}; Chaves PIX autorizadas: ${DADOS_PAGAMENTO.pix}.

PARÁGRAFO TERCEIRO - A CONTRATANTE compromete-se a conferir o nome do favorecido ("${DADOS_PAGAMENTO.beneficiario}") antes de confirmar qualquer transação financeira, não se responsabilizando a CONTRATADA por pagamentos efetuados a beneficiários divergentes.

CLÁUSULA DÉCIMA PRIMEIRA - DA VEDAÇÃO A ACORDOS DESASSISTIDOS
Fica expressamente vedado à CONTRATANTE negociar, transigir, firmar ou receber valores a título de acordo, seja judicial ou extrajudicial, diretamente da parte contrária ou de seus procuradores, sem a anuência prévia e por escrito da CONTRATADA.

PARÁGRAFO PRIMEIRO - A violação desta cláusula caracteriza quebra de confiança e descumprimento grave do contrato, implicando o vencimento antecipado e imediato da integralidade dos honorários de êxito pactuados (${pct}%).

PARÁGRAFO SEGUNDO - Em caso de descumprimento, a base de cálculo dos honorários será o valor atualizado da causa ou o valor total do acordo realizado à revelia da CONTRATADA, o que for maior. O montante apurado será considerado dívida líquida, certa e exigível, passível de execução imediata com base neste contrato.

CLÁUSULA DÉCIMA SEGUNDA - DA NATUREZA DA OBRIGAÇÃO
O presente contrato configura obrigação de meio, não garantindo resultado específico, inexistindo responsabilidade da CONTRATADA por decisões judiciais desfavoráveis ou fatores alheios à sua atuação técnica.

CLÁUSULA DÉCIMA TERCEIRA - DO COMPARECIMENTO A ATOS PROCESSUAIS
A CONTRATANTE se compromete a comparecer a todas as audiências e atos processuais para os quais sua presença seja indispensável, mediante prévia comunicação da CONTRATADA.

PARÁGRAFO PRIMEIRO - Na hipótese de impossibilidade de comparecimento, a CONTRATANTE deverá notificar a CONTRATADA, de forma justificada e por escrito, com antecedência mínima de 48 (quarenta e oito) horas do ato.

PARÁGRAFO SEGUNDO - O não comparecimento injustificado a uma audiência, ou a falta da notificação no prazo estabelecido no parágrafo anterior, resultará na aplicação cumulativa das seguintes penalidades: a) pagamento imediato do valor de R$ 100,00 (cem reais), a título de ressarcimento pelas despesas e tempo de deslocamento da advogada; b) incidência de multa não compensatória no valor de 20% (vinte por cento) sobre o valor atualizado da causa.

PARÁGRAFO TERCEIRO - A reincidência no não comparecimento ou a ocorrência de prejuízo processual grave por culpa exclusiva da CONTRATANTE dará à CONTRATADA o direito de rescindir o presente contrato por justa causa, sem prejuízo da cobrança da multa prevista.

CLÁUSULA DÉCIMA QUARTA - DO FORO DE ELEIÇÃO
Qualquer divergência e/ou litígio decorrente da interpretação e/ou execução do presente contrato deverá ser resolvido perante o Foro de ${FORO}, com renúncia expressa a qualquer outro.

E por estarem assim justos e contratados, firmam o presente em duas vias de igual teor e forma.

${FORO}, [DATA].


_______________________________________
${adv.nome}
${adv.oab.replace(' sob o nº ', ' ')}


_______________________________________
${p.nome}
CONTRATANTE`;
}
