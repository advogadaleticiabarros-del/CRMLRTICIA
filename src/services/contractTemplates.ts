/**
 * Minutas dos documentos gerados na esteira de contrato:
 * contrato de prestação de serviços, procuração e declaração de hipossuficiência.
 * Reusado pela rota de contratos e pelo aceite público da proposta.
 * Preenche os dados já conhecidos (nome, CPF, RG, estado civil, profissão, endereço);
 * deixa [placeholder] só para o que realmente faltar.
 */

// Dados oficiais da CONTRATADA / OUTORGADA (escritório)
export const ADVOGADA = {
  nome: 'LETÍCIA ELIAS BARROS',
  oab: 'OAB/ES sob o nº 39.948',
  endereco: 'London Office Tower, R. José Alexandre Buaiz, nº 160, Sala 115, Enseada do Suá, Vitória/ES, CEP 29.050-545',
  email: 'advogadaleticia.barros@gmail.com / contato@advogadaleticiabarros.com',
};
const CONTRATADA_BLOCO = `${ADVOGADA.nome}, advogada inscrita na ${ADVOGADA.oab}, com escritório profissional localizado na ${ADVOGADA.endereco}, e-mail: ${ADVOGADA.email}`;
const OUTORGADA_BLOCO = `${ADVOGADA.nome}, advogada inscrita na ${ADVOGADA.oab}, com escritório profissional localizado na ${ADVOGADA.endereco}`;

export interface PartyData {
  name?: string | null;
  nacionalidade?: string | null;
  estadoCivil?: string | null;
  profissao?: string | null;
  cpf?: string | null;
  rg?: string | null;
  endereco?: string | null;
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

function f(p: PartyData) {
  return {
    nome: p.name || '[NOME DO CLIENTE]',
    nac: p.nacionalidade || 'brasileiro(a)',
    ec: p.estadoCivil || '[estado civil]',
    prof: p.profissao || '[profissão]',
    cpf: p.cpf || '[CPF]',
    end: p.endereco || '[ENDEREÇO]',
  };
}

export function buildProcuracao(party: PartyData | string): string {
  const p = typeof party === 'string' ? f({ name: party }) : f(party);
  return `PROCURAÇÃO AD JUDICIA ET EXTRA

OUTORGANTE: ${p.nome}, ${p.nac}, ${p.ec}, ${p.prof}, inscrito(a) no CPF sob nº ${p.cpf}, residente e domiciliado(a) em ${p.end}.

OUTORGADA: ${OUTORGADA_BLOCO}.

PODERES: Pelo presente instrumento, o(a) OUTORGANTE nomeia e constitui sua bastante procuradora a OUTORGADA, a quem confere os poderes da cláusula "ad judicia et extra", para o foro em geral, em qualquer Juízo, Instância ou Tribunal, podendo propor as ações competentes e defendê-lo(a) nas contrárias, seguindo umas e outras até final decisão, usando os recursos legais e acompanhando-os, conferindo ainda poderes especiais para confessar, desistir, transigir, firmar compromissos ou acordos, receber e dar quitação, agindo em conjunto ou separadamente, podendo ainda substabelecer esta a outrem, com ou sem reserva de iguais poderes.

[CIDADE], [DATA].


_______________________________________
${p.nome}
OUTORGANTE`;
}

export function buildDeclaracao(party: PartyData | string): string {
  const p = typeof party === 'string' ? f({ name: party }) : f(party);
  return `DECLARAÇÃO DE HIPOSSUFICIÊNCIA

Eu, ${p.nome}, ${p.nac}, ${p.ec}, ${p.prof}, inscrito(a) no CPF sob nº ${p.cpf}, residente e domiciliado(a) em ${p.end}, DECLARO, sob as penas da lei, para fins de concessão dos benefícios da JUSTIÇA GRATUITA, nos termos do art. 98 e seguintes do Código de Processo Civil e da Lei nº 1.060/50, que não possuo condições de arcar com as custas, despesas processuais e honorários advocatícios sem prejuízo do sustento próprio e de minha família.

Por ser expressão da verdade, firmo a presente declaração.

[CIDADE], [DATA].


_______________________________________
${p.nome}
DECLARANTE`;
}

const AREA_OBJECT: Record<string, string> = {
  trabalhista: 'a propositura e/ou acompanhamento de reclamação trabalhista, visando ao recebimento das verbas e direitos trabalhistas devidos ao CONTRATANTE.',
  gestante: 'a defesa dos direitos da gestante, incluindo estabilidade gravídica, licença-maternidade e reversão de demissão irregular.',
  familia: 'a atuação em demanda de direito de família (divórcio, guarda, pensão alimentícia ou inventário), conforme a necessidade do CONTRATANTE.',
  civel: 'o patrocínio de ação cível, incluindo cobrança, reparação de danos e responsabilidade civil em favor do CONTRATANTE.',
  previdenciario: 'o requerimento administrativo e/ou judicial de benefício previdenciário junto ao INSS em favor do CONTRATANTE.',
  consumidor: 'a defesa dos direitos do consumidor, incluindo cobranças indevidas, vícios de produto/serviço e reparação de danos.',
  outro: 'a prestação de serviços advocatícios conforme objeto a ser detalhado entre as partes.',
};

export function buildTemplate(opts: { clientName?: string; party?: PartyData; area: string; value?: number; formaPagamento?: string }): string {
  const p = f(opts.party || { name: opts.clientName });
  const obj = AREA_OBJECT[opts.area] ?? AREA_OBJECT.outro;
  const valorStr = opts.value ? `R$ ${Number(opts.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '[VALOR DOS HONORÁRIOS]';
  const forma = opts.formaPagamento && opts.formaPagamento.trim() ? opts.formaPagamento.trim() : '[FORMA DE PAGAMENTO / PARCELAS]';
  return `CONTRATO DE PRESTAÇÃO DE SERVIÇOS ADVOCATÍCIOS

CONTRATANTE: ${p.nome}, ${p.nac}, ${p.ec}, ${p.prof}, inscrito(a) no CPF sob nº ${p.cpf}, residente e domiciliado(a) em ${p.end}.

CONTRATADA: ${CONTRATADA_BLOCO}.

CLÁUSULA 1ª — DO OBJETO
O presente contrato tem por objeto ${obj}

CLÁUSULA 2ª — DAS OBRIGAÇÕES DA CONTRATADA
A CONTRATADA obriga-se a empregar todo o zelo e diligência no patrocínio da causa, mantendo o CONTRATANTE informado sobre o andamento.

CLÁUSULA 3ª — DOS HONORÁRIOS
Pelos serviços, o CONTRATANTE pagará à CONTRATADA o valor de ${valorStr}, na forma e condições ajustadas: ${forma}.
Os honorários de sucumbência, quando houver, pertencem à CONTRATADA.

CLÁUSULA 4ª — DA VIGÊNCIA E RESCISÃO
O presente contrato vigora até o trânsito em julgado da demanda, podendo ser rescindido nos termos da legislação aplicável e do Estatuto da OAB.

CLÁUSULA 5ª — DO FORO
Fica eleito o foro da Comarca de [COMARCA] para dirimir quaisquer questões oriundas deste contrato.

[CIDADE], [DATA].


_______________________________        _______________________________
        CONTRATANTE                              CONTRATADA

Minuta para revisão e complementação antes da assinatura.`;
}
