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
  q += `, endereço eletrônico: ${p.email || '[e-mail]'}`;
  if (p.phone) q += `, telefone: ${p.phone}`;
  return q;
}

/** Texto da forma de pagamento a partir do parcelamento da proposta (entrada + parcelas). */
// Meios de pagamento aceitos (escolhidos no formulário da proposta) → texto
// que entra na proposta e no contrato.
export const MEIOS_PAGAMENTO_PT: Record<string, string> = {
  pix: 'Pix',
  cartao: 'cartão de crédito',
  boleto: 'boleto bancário',
  transferencia: 'transferência bancária (TED)',
  dinheiro: 'dinheiro',
  desconto_exito: 'desconto direto do valor recebido ao final da ação (êxito/RPV/alvará)',
  link_pagamento: 'link de pagamento',
};

export function meiosPagamentoTexto(honorarios: any): string {
  const meios: string[] = Array.isArray(honorarios?.meios) ? honorarios.meios : [];
  if (!meios.length) return '';
  const nomes = meios.map((m) => {
    let nome = MEIOS_PAGAMENTO_PT[m] || m;
    if (m === 'cartao' && Number(honorarios?.meios_detalhe?.cartao_parcelas) > 1) {
      nome += ` em até ${honorarios.meios_detalhe.cartao_parcelas}x`;
    }
    return nome;
  });
  const lista = nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} ou ${nomes[nomes.length - 1]}` : nomes[0];
  return `pagamento por meio de ${lista}`;
}

export function formaPagamentoTexto(parc: any, honorarios?: any): string {
  if (!parc || !Number(parc.total)) return meiosPagamentoTexto(honorarios);
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
  const meios = meiosPagamentoTexto(honorarios);
  if (meios) partes.push(meios);
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

/**
 * Fundamentação legal da gratuidade conforme a justiça competente.
 * - Justiça Comum (padrão): arts. 98 e 99 do CPC + art. 5º, LXXIV, da CF.
 * - Justiça do Trabalho: art. 790, §§ 3º e 4º, da CLT.
 * Não se citam as duas bases na mesma declaração.
 */
export function fundamentoGratuidade(trabalhista?: boolean): string {
  return trabalhista
    ? 'A presente declaração é feita nos termos do art. 790, §§ 3º e 4º, da Consolidação das Leis do Trabalho (CLT).'
    : 'Pleiteio os benefícios da Justiça Gratuita, com fulcro no artigo 5º, inciso LXXIV, da Constituição Federal, combinado com os artigos 98 e 99 da Lei nº 13.105/2015 (Código de Processo Civil) e, se perante os Juizados Especiais, com os artigos 54 e 55 da Lei nº 9.099/1995.';
}

export function buildDeclaracao(party: PartyData | string, opts: { trabalhista?: boolean } = {}): string {
  const p = typeof party === 'string' ? f({ name: party }) : f(party);
  // Justiça do Trabalho: fundamentação da CLT.
  if (opts.trabalhista) {
    return `DECLARAÇÃO DE HIPOSSUFICIÊNCIA

Eu, ${qualificacao(p)}, DECLARO para os devidos fins, sob as penas da lei, que não possuo condições financeiras de arcar com as custas e despesas processuais sem prejuízo do meu sustento e de minha família.

${fundamentoGratuidade(true)}

Declaro, ainda, estar ciente de que a falsidade das informações aqui prestadas me sujeitará às sanções civis, administrativas e penais previstas na legislação vigente.

Por ser a expressão da verdade, firmo a presente.

${FORO}, [DATA].


_______________________________________
${p.nome}
CPF nº ${p.cpf}`;
  }
  // Justiça Comum / Juizados Especiais.
  return `DECLARAÇÃO DE HIPOSSUFICIÊNCIA ECONÔMICA

Eu, ${qualificacao(p)}, por este instrumento particular, DECLARO, para os devidos fins de direito e sob as penas da lei, que não possuo condições financeiras de arcar com o pagamento de custas processuais e demais despesas judiciais sem prejuízo do meu próprio sustento e de minha família.

${fundamentoGratuidade(false)}

Declaro, ainda, estar ciente de que a falsidade das informações aqui prestadas me sujeitará às sanções civis, administrativas e penais previstas na legislação vigente.

Por ser a expressão da verdade, firmo a presente.

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

export interface MenorData { nome?: string | null; nascimento?: string | null; cpf?: string | null }

/** Contrato de honorários — REPRESENTAÇÃO DE MENOR (representante legal + menor representado). */
export function buildTemplateMenor(opts: {
  party?: PartyData; menor?: MenorData; tipoAcao?: string; parteContraria?: string;
  exitoPct?: number; honorarios?: any; foroCidade?: string; contratada?: ContratadaInfo;
}): string {
  const adv = opts.contratada || ADVOGADA;
  const dt = (s?: string | null) => (s ? new Date(String(s).slice(0, 10) + 'T00:00:00').toLocaleDateString('pt-BR') : '[DATA DE NASCIMENTO]');
  const r = opts.party || {};
  const rNome = r.name || '[NOME DO RESPONSÁVEL]';
  const rNac = r.nacionalidade || 'brasileiro(a)';
  const rProf = r.profissao || '[profissão]';
  const rEc = r.estadoCivil || '[estado civil]';
  const rRg = r.rg || '[RG]';
  const rCpf = r.cpf || '[CPF]';
  const rEnd = r.endereco || '[ENDEREÇO]';
  const m = opts.menor || {};
  const mNome = m.nome || '[NOME DO MENOR]';
  const mCpf = m.cpf || '[CPF DO MENOR]';
  const acao = (opts.tipoAcao && opts.tipoAcao.trim()) ? opts.tipoAcao.trim() : '[TIPO DE AÇÃO]';
  const reu = (opts.parteContraria && opts.parteContraria.trim()) ? opts.parteContraria.trim() : '[PARTE CONTRÁRIA]';
  const foro = (opts.foroCidade && opts.foroCidade.trim()) ? opts.foroCidade.trim() : FORO;
  let pct = opts.exitoPct || 0;
  try { const h = opts.honorarios || {}; const ex = Number(h?.values?.exito) || Number(h?.values?.ad_exitum); if (!pct && ex) pct = ex; } catch {}
  if (!pct) pct = 30;

  return `CONTRATO DE HONORÁRIOS ADVOCATÍCIOS - REPRESENTAÇÃO DE MENOR

CONTRATANTE (REPRESENTANTE LEGAL): ${rNome}, ${rNac}, ${rProf}, ${rEc}, portador(a) do RG nº ${rRg} e inscrito(a) no CPF nº ${rCpf}, residente e domiciliado(a) na ${rEnd}, neste ato representando seu(sua) filho(a) menor, adiante qualificado(a).

REPRESENTADO(A) (AUTOR(A) MENOR): ${mNome}, menor, nascido(a) em ${dt(m.nascimento)}, inscrito(a) no CPF nº ${mCpf}, neste ato representado(a) por seu(sua) genitor(a), a CONTRATANTE acima qualificada.

CONTRATADA: ${contratadaBloco(adv)}.

As partes acima qualificadas firmam o presente Contrato de Prestação de Serviços Advocatícios, que se regerá pelas seguintes cláusulas:

CLÁUSULA PRIMEIRA - DO OBJETO DO CONTRATO
O presente contrato tem por objeto a prestação de serviços advocatícios pela CONTRATADA para o ajuizamento e acompanhamento, em todas as instâncias, de ${acao} em favor do(a) menor REPRESENTADO(A), em face de ${reu}.

CLÁUSULA SEGUNDA - DOS HONORÁRIOS ADVOCATÍCIOS
A título de honorários de êxito, a CONTRATANTE pagará à CONTRATADA o percentual de ${pct}% (${extensoPct(pct)}) sobre o proveito econômico total obtido em favor do(a) REPRESENTADO(A).

PARÁGRAFO PRIMEIRO - Os honorários serão devidos e destacados no momento da liberação dos valores por meio de alvará judicial, autorizando a CONTRATADA, desde já, a requerer ao juízo que o pagamento de seus honorários seja feito por dedução da quantia a ser recebida pelo(a) REPRESENTADO(A), nos termos do art. 22, § 4º, da Lei nº 8.906/94.

CLÁUSULA TERCEIRA - DAS DESPESAS
As despesas processuais (custas, taxas, perícias, etc.) não estão incluídas nos honorários e, caso não seja concedido o benefício da justiça gratuita, deverão ser custeadas pela CONTRATANTE.

CLÁUSULA QUARTA - DAS OBRIGAÇÕES DA CONTRATANTE (REPRESENTANTE LEGAL)
Compete à CONTRATANTE fornecer à CONTRATADA todos os documentos e informações necessários à defesa dos interesses do(a) REPRESENTADO(A), bem como comparecer aos atos processuais sempre que sua presença for solicitada.

CLÁUSULA QUINTA - DO TÍTULO EXECUTIVO
O presente contrato constitui título executivo extrajudicial, nos termos do artigo 24 da Lei nº 8.906/94 (Estatuto da Advocacia e da OAB) e do art. 784 do Código de Processo Civil.

CLÁUSULA SEXTA - DA NÃO RESPONSABILIZAÇÃO E DOS CANAIS OFICIAIS
A CONTRATADA não se responsabiliza por prejuízos decorrentes de golpes praticados por terceiros. A CONTRATANTE declara estar ciente de que todas as comunicações e solicitações financeiras ocorrerão exclusivamente pelos seguintes canais: E-mails: ${DADOS_PAGAMENTO.emails}. Telefones/WhatsApp: ${DADOS_PAGAMENTO.telefones}. Pagamentos de honorários ou despesas serão devidos exclusivamente na conta de titularidade da CONTRATADA, cujos dados são: Beneficiário: ${DADOS_PAGAMENTO.beneficiario}; Instituição: ${DADOS_PAGAMENTO.instituicao}; Agência: ${DADOS_PAGAMENTO.agencia}; Conta Corrente: ${DADOS_PAGAMENTO.conta}; Chaves PIX: ${DADOS_PAGAMENTO.pix}.

CLÁUSULA SÉTIMA - DA VEDAÇÃO A ACORDOS DESASSISTIDOS
Fica expressamente vedado à CONTRATANTE (representante legal) negociar ou firmar qualquer tipo de acordo em nome do(a) REPRESENTADO(A) sem a anuência prévia e por escrito da CONTRATADA. A violação desta cláusula implicará o vencimento antecipado da integralidade dos honorários de êxito estipulados na Cláusula Segunda, que serão calculados sobre o valor atualizado da causa ou sobre o valor do acordo, o que for maior, e cobrados imediatamente via execução deste contrato.

CLÁUSULA OITAVA - DO COMPARECIMENTO A ATOS PROCESSUAIS
O não comparecimento injustificado da CONTRATANTE a uma audiência ou ato para o qual seja indispensável, sem notificação prévia de 48 (quarenta e oito) horas, resultará na aplicação cumulativa de multa de 20% (vinte por cento) sobre o valor atualizado da causa e no pagamento imediato de R$ 100,00 (cem reais) para ressarcimento de despesas de deslocamento.

CLÁUSULA NONA - DA NATUREZA DA OBRIGAÇÃO
O presente contrato configura obrigação de meio, não garantindo resultado específico, inexistindo responsabilidade da CONTRATADA por decisões judiciais desfavoráveis.

CLÁUSULA DÉCIMA - DA VIGÊNCIA E RESCISÃO
O contrato vige da assinatura até o final da demanda. A rescisão imotivada por parte da CONTRATANTE a obrigará ao pagamento de honorários proporcionais ao trabalho realizado, além de multa contratual.

CLÁUSULA DÉCIMA PRIMEIRA - DO FORO
Fica eleito o foro da Comarca de ${foro} para dirimir quaisquer litígios oriundos deste contrato.

E, por estarem assim justas e contratadas, assinam o presente instrumento.

${foro}, [DATA].





_______________________________________
${rNome}
CONTRATANTE
(Representante Legal de ${mNome})





_______________________________________
${adv.nome}
CONTRATADA
${adv.oab.replace(' sob o nº ', ' ')}`;
}

function dtNasc(s?: string | null): string {
  return s ? new Date(String(s).slice(0, 10) + 'T00:00:00').toLocaleDateString('pt-BR') : '[DATA DE NASCIMENTO]';
}
function qualResponsavel(r: PartyData): string {
  return `${r.name || '[NOME DO RESPONSÁVEL]'}, ${r.nacionalidade || 'brasileiro(a)'}, ${r.profissao || '[profissão]'}, ${r.estadoCivil || '[estado civil]'}, portador(a) do RG nº ${r.rg || '[RG]'} e inscrito(a) no CPF nº ${r.cpf || '[CPF]'}, residente e domiciliado(a) na ${r.endereco || '[ENDEREÇO]'}`;
}
function qualMenor(m: MenorData): string {
  return `${m.nome || '[NOME DO MENOR]'}, menor, nascido(a) em ${dtNasc(m.nascimento)}, inscrito(a) no CPF nº ${m.cpf || '[CPF DO MENOR]'}`;
}

/** Procuração outorgada pelo representante legal em nome do menor. */
export function buildProcuracaoMenor(party: PartyData, menor: MenorData, contratada: ContratadaInfo = ADVOGADA): string {
  const mNome = menor.nome || '[NOME DO MENOR]';
  return `PROCURAÇÃO AD JUDICIA ET EXTRA

OUTORGANTE: ${qualMenor(menor)}, neste ato representado(a) por seu(sua) representante legal, ${qualResponsavel(party)}.

OUTORGADO(A): ${outorgadaBloco(contratada)}.

PODERES: Pelo presente instrumento, o(a) OUTORGANTE, devidamente representado(a), confere ao(à) OUTORGADO(A) os poderes da cláusula ad judicia et extra para o foro em geral, a fim de representá-lo(a) em qualquer Juízo, Instância, Tribunal ou repartição pública e privada. Ficam abrangidos os poderes especiais para receber citação, confessar, transigir, desistir, renunciar ao direito, receber e dar quitação, firmar compromissos e assinar declaração de hipossuficiência, nos termos do art. 105 do Código de Processo Civil.

VALIDADE: O presente mandato é outorgado por prazo indeterminado, mantendo sua validade até o cumprimento integral de seu objeto ou a sua expressa revogação.

${FORO}, [DATA].


_______________________________________
${party.name || '[NOME DO RESPONSÁVEL]'}
Representante legal de ${mNome}`;
}

/** Declaração de hipossuficiência firmada pelo representante legal em nome do menor. */
export function buildDeclaracaoMenor(party: PartyData, menor: MenorData, opts: { trabalhista?: boolean } = {}): string {
  const mNome = menor.nome || '[NOME DO MENOR]';
  return `DECLARAÇÃO DE HIPOSSUFICIÊNCIA

Eu, ${qualResponsavel(party)}, na qualidade de representante legal do(a) menor ${qualMenor(menor)}, DECLARO para os devidos fins, sob as penas da lei, que o(a) representado(a) não possui condições financeiras de arcar com as custas processuais e demais despesas judiciais sem prejuízo do próprio sustento e de sua família.

${fundamentoGratuidade(opts.trabalhista)}

${FORO}, [DATA].


_______________________________________
${party.name || '[NOME DO RESPONSÁVEL]'}
Representante legal de ${mNome}`;
}

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
    const fp = formaPagamentoTexto(parc, h);
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

/** Detecta se a causa de família é pedido de pensão alimentícia (mesmo regex usado no app.js pras observações da proposta). */
export function isPensaoAlimenticia(area?: string, tipoCausa?: string): boolean {
  return area === 'familia' && /pens[aã]o/i.test(tipoCausa || '');
}

/**
 * Cláusula Segunda no formato a/b/c (entrada + parcelas), conforme o padrão
 * fixo do contrato de pensão alimentícia — usa o parcelamento aceito na
 * proposta; sem parcelamento, cai em placeholders pro preenchimento manual.
 */
function clausulaSegundaFamiliaPensao(honorarios?: any): string {
  const money = (n: number) => `R$ ${(Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const dt = (s?: string) => (s ? new Date(String(s).slice(0, 10) + 'T00:00:00').toLocaleDateString('pt-BR') : '[DATA]');
  const parc = honorarios?.parcelamento;
  if (!parc || !Number(parc.total)) {
    return `Pelos serviços advocatícios descritos na Cláusula Primeira, a CONTRATANTE pagará à CONTRATADA honorários contratuais fixos no valor total de R$ [VALOR TOTAL], da seguinte forma:

a) R$ [VALOR ENTRADA], a título de entrada, com vencimento em [DATA ENTRADA];

b) [Nº] parcela(s) mensal(is) de R$ [VALOR PARCELA];

c) [se houver] 01 (uma) última parcela de R$ [VALOR ÚLTIMA PARCELA].

A primeira parcela terá vencimento em [DATA 1ª PARCELA], vencendo-se as demais no dia [DIA] dos meses subsequentes.`;
  }
  const entrada = Number(parc.entrada) || 0;
  const n = parseInt(parc.parcelas) || 0;
  const vParc = Number(parc.valor_parcela) || 0;
  const ult = Number(parc.ultima_parcela) || vParc;
  const linhas: string[] = [];
  if (entrada > 0) linhas.push(`a) ${money(entrada)}, a título de entrada, com vencimento em ${dt(parc.entrada_data)};`);
  if (n > 0) linhas.push(`${entrada > 0 ? 'b' : 'a'}) ${n} parcela(s) mensal(is) de ${money(vParc)};`);
  if (ult && ult !== vParc) linhas.push(`${entrada > 0 ? 'c' : 'b'}) 01 (uma) última parcela de ${money(ult)}.`);
  const vencimento = parc.primeiro_vencimento
    ? `A primeira parcela terá vencimento em ${dt(parc.primeiro_vencimento)}, vencendo-se as demais no dia ${new Date(String(parc.primeiro_vencimento).slice(0, 10) + 'T00:00:00').getDate()} dos meses subsequentes.`
    : '';
  return `Pelos serviços advocatícios descritos na Cláusula Primeira, a CONTRATANTE pagará à CONTRATADA honorários contratuais fixos no valor total de ${money(parc.total)}, da seguinte forma:

${linhas.join('\n\n')}

${vencimento}`.trim();
}

/**
 * Contrato padrão do escritório para Direito de Família — pensão alimentícia
 * (fixação/majoração) e guarda: 19 cláusulas, incluindo honorários de êxito
 * de 30% (padrão) exclusivamente sobre as diferenças retroativas obtidas.
 * Cláusulas fixas; só mudam dados do cliente e valores (Cláusulas 2ª e 3ª).
 */
export function buildTemplateFamiliaPensao(opts: { party?: PartyData; clientName?: string; honorarios?: any; exitoPct?: number; contratada?: ContratadaInfo }): string {
  const p = f(opts.party || { name: opts.clientName });
  const adv = opts.contratada || ADVOGADA;
  let pct = opts.exitoPct || Number(opts.honorarios?.values?.exito) || 30;
  const pctExtenso = extensoPct(pct);

  return `CONTRATO DE PRESTAÇÃO DE SERVIÇOS ADVOCATÍCIOS

CONTRATANTE: ${qualificacao(p)}.

CONTRATADA: ${contratadaBloco(adv)}.

As partes acima identificadas têm entre si justo e contratado o presente Contrato de Prestação de Serviços Advocatícios, que se regerá pelas cláusulas e condições seguintes:

CLÁUSULA PRIMEIRA – DO OBJETO DO CONTRATO

O presente contrato tem por objeto a prestação de serviços advocatícios para o ajuizamento e acompanhamento de demanda de Direito de Família destinada ao pedido de fixação/majoração de pensão alimentícia e definição de guarda, compreendendo a elaboração da petição inicial, análise documental, manifestações necessárias ao regular andamento do processo, participação em audiências e acompanhamento do feito em primeiro grau de jurisdição.

PARÁGRAFO PRIMEIRO – Os serviços contratados compreendem a atuação até a prolação de sentença em primeiro grau, bem como eventual acordo celebrado no decorrer do processo.

PARÁGRAFO SEGUNDO – Não estão incluídos nos honorários previstos neste contrato a interposição ou acompanhamento de recursos perante o Tribunal de Justiça ou Tribunais Superiores, ações revisionais ou exoneratórias posteriores, execução autônoma de alimentos, cumprimento de sentença que demande atuação extraordinária, modificação futura de guarda, novas ações ou procedimentos que não integrem o objeto originalmente contratado, os quais poderão ser objeto de nova contratação.

CLÁUSULA SEGUNDA – DOS HONORÁRIOS CONTRATUAIS E DA FORMA DE PAGAMENTO

${clausulaSegundaFamiliaPensao(opts.honorarios)}

PARÁGRAFO PRIMEIRO – Os pagamentos poderão ser efetuados por PIX, link de pagamento ou outro meio previamente autorizado pela CONTRATADA.

PARÁGRAFO SEGUNDO – Os honorários fixos previstos nesta cláusula são devidos pela prestação dos serviços profissionais e independem do resultado obtido na demanda, considerando-se que a atividade advocatícia constitui obrigação de meio e não de resultado.

CLÁUSULA TERCEIRA – DOS HONORÁRIOS DE ÊXITO SOBRE AS DIFERENÇAS RETROATIVAS

Além dos honorários fixos estabelecidos na Cláusula Segunda, a CONTRATANTE pagará à CONTRATADA honorários de êxito correspondentes a ${pct}% (${pctExtenso}) exclusivamente sobre o valor total das diferenças retroativas de pensão alimentícia obtidas a mais em decorrência do processo.

PARÁGRAFO PRIMEIRO – Para fins desta cláusula, considera-se diferença retroativa o valor positivo resultante da comparação entre:

I – o valor da pensão alimentícia que vinha sendo efetivamente pago ou anteriormente fixado; e

II – o novo valor de pensão alimentícia fixado pelo Juízo ou estabelecido mediante acordo no processo.

PARÁGRAFO SEGUNDO – Os honorários de ${pct}% incidirão exclusivamente sobre a soma das diferenças retroativas reconhecidas como devidas no período compreendido entre o termo inicial estabelecido judicialmente e a data considerada para apuração dos atrasados.

PARÁGRAFO TERCEIRO – A diferença será apurada mês a mês, considerando-se o valor efetivamente devido em cada competência e, quando aplicável, a alteração do salário mínimo, índice de reajuste ou outro parâmetro utilizado para fixação dos alimentos.

PARÁGRAFO QUARTO – A título exemplificativo, caso estejam sendo pagos R$ 500,00 (quinhentos reais) mensais a título de alimentos e, ao final do processo, seja fixada pensão em valor superior, com determinação de pagamento retroativo, os honorários de êxito de ${pct}% incidirão somente sobre a diferença obtida a maior em cada mês, somadas todas as diferenças relativas ao período retroativo.

Assim, não haverá incidência dos ${pct}% sobre o valor que já vinha sendo regularmente pago, mas somente sobre o valor adicional conquistado em razão da demanda.

PARÁGRAFO QUINTO – Os honorários de êxito serão devidos quando os valores retroativos forem recebidos, levantados, transferidos, depositados, compensados ou disponibilizados em favor da CONTRATANTE ou do beneficiário dos alimentos.

PARÁGRAFO SEXTO – Caso o pagamento dos valores retroativos seja realizado de forma parcelada, os honorários de ${pct}% poderão ser descontados proporcionalmente de cada parcela recebida, salvo ajuste diverso entre as partes.

PARÁGRAFO SÉTIMO – A realização de acordo judicial ou extrajudicial que reconheça ou determine o pagamento das diferenças retroativas não afastará os honorários previstos nesta cláusula, que serão calculados sobre o montante das diferenças reconhecidas em favor da CONTRATANTE.

PARÁGRAFO OITAVO – Os honorários de êxito previstos nesta cláusula não incidirão sobre as parcelas futuras e ordinárias da pensão alimentícia após sua fixação, restringindo-se às diferenças retroativas obtidas a maior no processo.

PARÁGRAFO NONO – A CONTRATANTE autoriza, quando juridicamente possível, o destaque, retenção ou dedução dos honorários contratuais de êxito diretamente dos valores disponibilizados judicialmente, mediante juntada deste contrato aos autos.

CLÁUSULA QUARTA – DOS HONORÁRIOS SUCUMBENCIAIS

Os honorários de sucumbência eventualmente fixados judicialmente pertencem exclusivamente à CONTRATADA, constituindo direito autônomo da advogada.

PARÁGRAFO ÚNICO – Os honorários sucumbenciais não se confundem, não substituem e não serão compensados com os honorários contratuais fixos ou de êxito estabelecidos neste contrato.

CLÁUSULA QUINTA – DO INADIMPLEMENTO

O atraso ou a falta de pagamento de qualquer parcela dos honorários na respectiva data de vencimento acarretará, independentemente de aviso, notificação ou interpelação judicial ou extrajudicial:

a) multa moratória de 2% (dois por cento) sobre o valor da parcela em atraso;

b) juros de mora de 1% (um por cento) ao mês, calculados proporcionalmente aos dias de atraso; e

c) correção monetária pelo IPCA, ou índice oficial que venha a substituí-lo, desde o vencimento até o efetivo pagamento.

PARÁGRAFO PRIMEIRO – Permanecendo o inadimplemento por período superior a 30 (trinta) dias, a CONTRATADA poderá notificar a CONTRATANTE para regularização da dívida, sem prejuízo das medidas profissionais necessárias à preservação dos interesses processuais da cliente.

PARÁGRAFO SEGUNDO – Permanecendo o inadimplemento por período superior a 60 (sessenta) dias, considerar-se-ão antecipadamente vencidas as parcelas vincendas dos honorários fixos, tornando-se exigível o saldo contratual remanescente.

PARÁGRAFO TERCEIRO – O inadimplemento persistente poderá caracterizar quebra da relação de confiança e ensejar a renúncia ao mandato pela CONTRATADA, observadas as disposições legais e éticas aplicáveis.

PARÁGRAFO QUARTO – O inadimplemento não prejudicará a cobrança dos honorários de êxito eventualmente devidos, das despesas realizadas ou de outros valores previstos neste contrato.

CLÁUSULA SEXTA – DAS DESPESAS JUDICIAIS E ADMINISTRATIVAS

Todas as despesas necessárias à execução dos serviços profissionais que não constituam honorários advocatícios correrão por conta da CONTRATANTE.

PARÁGRAFO PRIMEIRO – Incluem-se entre essas despesas, quando necessárias, custas processuais, taxas, emolumentos, perícias, diligências, despesas cartorárias, autenticações, certidões, deslocamentos extraordinários, correspondências, cópias e outros gastos indispensáveis ao andamento da demanda.

PARÁGRAFO SEGUNDO – Sempre que possível, a CONTRATANTE será previamente comunicada acerca das despesas relevantes.

CLÁUSULA SÉTIMA – DAS OBRIGAÇÕES DA CONTRATANTE

A CONTRATANTE obriga-se a:

I – fornecer informações verdadeiras, completas e atualizadas;

II – entregar todos os documentos solicitados pela CONTRATADA dentro dos prazos informados;

III – informar imediatamente qualquer fato novo relacionado ao processo;

IV – comunicar qualquer contato, proposta, pagamento ou negociação realizada pela parte contrária;

V – manter atualizados telefone, endereço, e-mail e demais meios de contato;

VI – acompanhar as comunicações encaminhadas pela CONTRATADA;

VII – comparecer às audiências e demais atos para os quais sua presença seja solicitada;

VIII – não omitir circunstâncias ou documentos que possam influenciar o andamento ou resultado do processo.

PARÁGRAFO PRIMEIRO – A CONTRATADA não poderá ser responsabilizada por prejuízo decorrente de informações falsas, inexatas, incompletas ou omitidas pela CONTRATANTE, bem como pela entrega tardia de documentos ou pelo descumprimento das orientações profissionais fornecidas.

PARÁGRAFO SEGUNDO – A ausência de fornecimento de documentos ou informações indispensáveis poderá impedir o protocolo ou regular prosseguimento da medida jurídica, sem que tal circunstância possa ser imputada à CONTRATADA.

CLÁUSULA OITAVA – DO COMPARECIMENTO ÀS AUDIÊNCIAS E ATOS PROCESSUAIS

A CONTRATANTE compromete-se a comparecer pontualmente a todas as audiências e atos processuais para os quais sua presença seja necessária, desde que previamente comunicada pela CONTRATADA.

PARÁGRAFO PRIMEIRO – Na hipótese de impossibilidade previsível de comparecimento, a CONTRATANTE deverá comunicar a CONTRATADA, por escrito, com antecedência mínima de 48 (quarenta e oito) horas, informando o motivo da ausência.

PARÁGRAFO SEGUNDO – O não comparecimento injustificado da CONTRATANTE à audiência para a qual tenha sido devidamente comunicada acarretará multa contratual no valor de R$ 1.000,00 (mil reais), por ocorrência, devida à CONTRATADA.

PARÁGRAFO TERCEIRO – Equipara-se ao não comparecimento o atraso injustificado que resulte na perda da audiência ou impossibilite a prática do ato.

PARÁGRAFO QUARTO – Nas audiências realizadas por videoconferência, também será considerado não comparecimento injustificado a ausência decorrente da falta de adoção, pela CONTRATANTE, das providências previamente orientadas e necessárias ao acesso à plataforma, salvo comprovada falha técnica alheia à sua vontade.

PARÁGRAFO QUINTO – A multa prevista nesta cláusula não será aplicada quando a ausência decorrer de caso fortuito, força maior, emergência ou outra circunstância relevante devidamente comprovada.

PARÁGRAFO SEXTO – A multa contratual de R$ 1.000,00 não substitui eventual penalidade processual aplicada pelo Juízo nem eventuais despesas extraordinárias comprovadamente causadas pela ausência da CONTRATANTE.

PARÁGRAFO SÉTIMO – A reincidência em ausência injustificada, bem como comportamento da CONTRATANTE que gere prejuízo relevante à condução do processo, poderá caracterizar quebra da relação de confiança e ensejar a renúncia ao mandato pela CONTRATADA, observadas as disposições legais aplicáveis.

CLÁUSULA NONA – DA REVOGAÇÃO, RENÚNCIA E RESCISÃO

O presente contrato poderá ser alterado mediante acordo escrito entre as partes.

A CONTRATANTE poderá revogar o mandato a qualquer momento, permanecendo, entretanto, responsável pelo pagamento das parcelas vencidas, despesas realizadas e dos honorários correspondentes aos serviços efetivamente prestados até a data do encerramento da relação profissional.

PARÁGRAFO PRIMEIRO – A revogação do mandato ou rescisão deste contrato pela CONTRATANTE não implicará renúncia da CONTRATADA aos honorários já adquiridos ou proporcionalmente devidos pelo trabalho realizado.

PARÁGRAFO SEGUNDO – Caso, após a revogação ou rescisão, venha a ocorrer recebimento de diferenças retroativas diretamente relacionado ao trabalho anteriormente desenvolvido pela CONTRATADA, permanecerá resguardado o direito aos honorários de êxito correspondentes à atuação efetivamente realizada, na forma permitida pela legislação aplicável.

PARÁGRAFO TERCEIRO – A CONTRATADA poderá renunciar ao mandato diante de quebra de confiança, inadimplemento contratual, omissão de informações relevantes, fornecimento de informações falsas, descumprimento reiterado das orientações profissionais ou outras circunstâncias que tornem inviável a continuidade da relação profissional, observados os deveres legais e éticos.

CLÁUSULA DÉCIMA – DA CESSÃO, SUBSTABELECIMENTO E COLABORAÇÃO PROFISSIONAL

A CONTRATANTE não poderá transferir os direitos e obrigações decorrentes deste contrato a terceiros.

PARÁGRAFO ÚNICO – A CONTRATADA poderá substabelecer os poderes recebidos, com ou sem reserva, bem como atuar em conjunto com outros profissionais quando necessário à adequada prestação dos serviços, respeitadas as disposições legais e éticas aplicáveis.

CLÁUSULA DÉCIMA PRIMEIRA – DOS ACORDOS E NEGOCIAÇÕES

A decisão de celebrar ou não acordo caberá à CONTRATANTE, após receber as orientações jurídicas pertinentes.

PARÁGRAFO PRIMEIRO – A CONTRATANTE compromete-se a comunicar imediatamente à CONTRATADA qualquer contato, proposta de acordo, negociação, oferta de pagamento ou composição realizada diretamente pela parte contrária ou por seus representantes.

PARÁGRAFO SEGUNDO – A celebração de acordo diretamente pela CONTRATANTE, ainda que sem participação da CONTRATADA, não afastará os honorários contratuais fixos ou de êxito previstos neste instrumento quando relacionados ao objeto da atuação profissional desenvolvida.

PARÁGRAFO TERCEIRO – Havendo no acordo reconhecimento ou pagamento de diferenças retroativas de pensão alimentícia, os honorários de êxito de ${pct}% incidirão sobre a diferença obtida a maior, na forma estabelecida na Cláusula Terceira.

CLÁUSULA DÉCIMA SEGUNDA – DA NATUREZA DA OBRIGAÇÃO

A CONTRATANTE declara estar ciente de que a prestação dos serviços advocatícios constitui obrigação de meio e não de resultado.

A CONTRATADA compromete-se a empregar os conhecimentos técnicos e diligências profissionais adequadas à defesa dos interesses da CONTRATANTE, não podendo garantir resultado específico, valor de pensão, prazo de duração do processo ou decisão judicial favorável.

CLÁUSULA DÉCIMA TERCEIRA – DA PROTEÇÃO DE DADOS E SIGILO

A CONTRATADA compromete-se a tratar os dados pessoais fornecidos pela CONTRATANTE de acordo com a legislação aplicável, especialmente a Lei Geral de Proteção de Dados Pessoais – LGPD.

PARÁGRAFO PRIMEIRO – A CONTRATANTE autoriza o tratamento dos dados necessários à execução deste contrato, ao exercício da advocacia, à representação judicial ou extrajudicial e ao cumprimento de obrigações legais e regulatórias.

PARÁGRAFO SEGUNDO – Poderão ser compartilhados dados estritamente necessários com órgãos públicos, Poder Judiciário, cartórios, peritos, correspondentes, profissionais parceiros, plataformas processuais e demais terceiros cuja participação seja necessária à execução dos serviços contratados.

PARÁGRAFO TERCEIRO – Permanecerá resguardado o sigilo profissional nos termos da legislação aplicável à advocacia.

CLÁUSULA DÉCIMA QUARTA – DOS CANAIS OFICIAIS E DA PREVENÇÃO A FRAUDES

A CONTRATADA não se responsabiliza por prejuízos decorrentes de golpes praticados por terceiros que se apresentem falsamente como advogados, funcionários, colaboradores ou representantes do escritório.

PARÁGRAFO PRIMEIRO – A CONTRATANTE declara estar ciente de que as comunicações oficiais e solicitações financeiras relacionadas a este contrato ocorrerão exclusivamente pelos seguintes canais:

E-mails autorizados:

${DADOS_PAGAMENTO.emails.replace(' ou ', '\n\n')}

Telefones/WhatsApp autorizados:

${DADOS_PAGAMENTO.telefones.replace(' ou ', '\n\n')}

PARÁGRAFO SEGUNDO – Os pagamentos somente deverão ser efetuados para conta de titularidade da CONTRATADA, observados os seguintes dados:

Beneficiário: ${DADOS_PAGAMENTO.beneficiario}
Instituição: ${DADOS_PAGAMENTO.instituicao}
Agência: ${DADOS_PAGAMENTO.agencia}
Conta Corrente: ${DADOS_PAGAMENTO.conta}
Chave PIX: ${DADOS_PAGAMENTO.pix}

PARÁGRAFO TERCEIRO – Antes de realizar qualquer pagamento, a CONTRATANTE deverá conferir se o favorecido indicado pela instituição financeira é ${adv.nome}.

PARÁGRAFO QUARTO – A CONTRATADA não se responsabilizará por pagamentos efetuados a conta, PIX ou beneficiário divergente daqueles expressamente indicados neste instrumento.

CLÁUSULA DÉCIMA QUINTA – DAS COMUNICAÇÕES

Serão consideradas válidas as comunicações realizadas pelos canais informados neste contrato ou posteriormente indicados por escrito pelas partes.

PARÁGRAFO PRIMEIRO – A CONTRATANTE obriga-se a informar imediatamente qualquer alteração de telefone, endereço, e-mail ou outro meio de comunicação.

PARÁGRAFO SEGUNDO – Enquanto não comunicada a alteração, serão consideradas válidas as mensagens encaminhadas aos dados anteriormente fornecidos pela CONTRATANTE.

CLÁUSULA DÉCIMA SEXTA – DO TÍTULO EXECUTIVO

O presente contrato escrito de honorários advocatícios constitui título executivo, na forma do Estatuto da Advocacia e da Ordem dos Advogados do Brasil, podendo os valores líquidos, certos e exigíveis dele decorrentes ser objeto de cobrança ou execução na forma da legislação aplicável.

CLÁUSULA DÉCIMA SÉTIMA – DA EXTENSÃO DAS OBRIGAÇÕES

As partes obrigam-se, por si e por seus sucessores, ao integral cumprimento das obrigações assumidas neste contrato, ressalvadas aquelas de natureza personalíssima.

CLÁUSULA DÉCIMA OITAVA – DA ASSINATURA ELETRÔNICA

As partes reconhecem como válida a assinatura deste instrumento por meio físico, digital ou eletrônico, inclusive mediante plataforma eletrônica de assinatura, reconhecendo sua autenticidade, integridade e validade jurídica.

CLÁUSULA DÉCIMA NONA – DO FORO

Fica eleito o Foro da Comarca de ${FORO} para dirimir controvérsias decorrentes da interpretação ou execução deste contrato, observadas as hipóteses legais de competência absoluta.

E, por estarem de acordo com todos os termos e condições estabelecidos, as partes firmam o presente instrumento.

${FORO}, [DATA].





_______________________________________
${adv.nome}
${adv.oab.replace(' sob o nº ', ' ')}
CONTRATADA





_______________________________________
${p.nome}
CONTRATANTE`;
}

export function buildTemplate(opts: { clientName?: string; party?: PartyData; area: string; value?: number; formaPagamento?: string; exitoPct?: number; honorarios?: any; tipoCausa?: string; descricao?: string; contratada?: ContratadaInfo }): string {
  // Padrão fixo do escritório: toda causa de família de pensão alimentícia usa
  // a minuta específica de 19 cláusulas (fixação/majoração + guarda), com
  // honorários de êxito só sobre as diferenças retroativas — só mudam dados
  // do cliente e valores (Cláusulas 2ª e 3ª). Ver docs/manual/06-documentos.md.
  if (isPensaoAlimenticia(opts.area, opts.tipoCausa)) {
    return buildTemplateFamiliaPensao({ party: opts.party, clientName: opts.clientName, honorarios: opts.honorarios, exitoPct: opts.exitoPct, contratada: opts.contratada });
  }
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

CLÁUSULA SEGUNDA-A - DO INADIMPLEMENTO
O atraso ou a falta de pagamento de qualquer parcela dos honorários advocatícios na data de seu vencimento acarretará, independentemente de aviso, notificação ou interpelação judicial ou extrajudicial, a incidência de multa moratória de 2% (dois por cento) sobre o valor da parcela em atraso, juros de mora de 1% (um por cento) ao mês, calculados pro rata die, e correção monetária pelo IPCA, ou outro índice oficial que venha a substituí-lo, desde a data do vencimento até o efetivo pagamento.

PARÁGRAFO PRIMEIRO - O inadimplemento de qualquer parcela por período superior a 30 (trinta) dias autoriza a CONTRATADA a suspender a prestação dos serviços não urgentes até a regularização do débito, sem prejuízo da adoção das medidas necessárias para evitar dano irreparável aos interesses da CONTRATANTE.

PARÁGRAFO SEGUNDO - Permanecendo o inadimplemento por período superior a 60 (sessenta) dias, considerar-se-ão antecipadamente vencidas todas as parcelas vincendas, tornando-se imediatamente exigível o saldo remanescente dos honorários contratuais, facultando-se à CONTRATADA promover a cobrança judicial ou extrajudicial do débito.

PARÁGRAFO TERCEIRO - Os encargos previstos nesta cláusula incidirão cumulativamente, sem prejuízo da cobrança das custas, despesas processuais e demais encargos legais decorrentes da execução deste contrato, o qual constitui título executivo extrajudicial, nos termos da legislação vigente.

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
CONTRATADA





_______________________________________
${p.nome}
CONTRATANTE`;
}
