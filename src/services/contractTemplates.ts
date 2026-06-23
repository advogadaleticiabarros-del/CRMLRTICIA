/**
 * Minutas dos documentos gerados na esteira de contrato:
 * contrato de prestação de serviços, procuração e declaração de hipossuficiência.
 * Reusado pela rota de contratos e pelo aceite público da proposta.
 */

export function buildProcuracao(clientName: string): string {
  return `PROCURAÇÃO AD JUDICIA ET EXTRA

OUTORGANTE: ${clientName || '[NOME DO CLIENTE]'}, [nacionalidade], [estado civil], [profissão], inscrito(a) no CPF sob nº [CPF], RG nº [RG], residente e domiciliado(a) em [ENDEREÇO].

OUTORGADA: Advocacia Letícia Barros, advogada inscrita na OAB/[UF] sob nº [Nº OAB], com escritório em [ENDEREÇO DO ESCRITÓRIO].

PODERES: Pelo presente instrumento, o(a) OUTORGANTE nomeia e constitui sua bastante procuradora a OUTORGADA, a quem confere os poderes da cláusula "ad judicia et extra", para o foro em geral, em qualquer Juízo, Instância ou Tribunal, podendo propor as ações competentes e defendê-lo(a) nas contrárias, seguindo umas e outras até final decisão, usando os recursos legais e acompanhando-os, conferindo ainda poderes especiais para confessar, desistir, transigir, firmar compromissos ou acordos, receber e dar quitação, agindo em conjunto ou separadamente, podendo ainda substabelecer esta a outrem, com ou sem reserva de iguais poderes.

[CIDADE], [DATA].


_______________________________________
${clientName || '[NOME DO CLIENTE]'}
OUTORGANTE`;
}

export function buildDeclaracao(clientName: string): string {
  return `DECLARAÇÃO DE HIPOSSUFICIÊNCIA

Eu, ${clientName || '[NOME DO CLIENTE]'}, [nacionalidade], [estado civil], [profissão], inscrito(a) no CPF sob nº [CPF], RG nº [RG], residente e domiciliado(a) em [ENDEREÇO], DECLARO, sob as penas da lei, para fins de concessão dos benefícios da JUSTIÇA GRATUITA, nos termos do art. 98 e seguintes do Código de Processo Civil e da Lei nº 1.060/50, que não possuo condições de arcar com as custas, despesas processuais e honorários advocatícios sem prejuízo do sustento próprio e de minha família.

Por ser expressão da verdade, firmo a presente declaração.

[CIDADE], [DATA].


_______________________________________
${clientName || '[NOME DO CLIENTE]'}
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

export function buildTemplate(opts: { clientName: string; area: string; value?: number }): string {
  const obj = AREA_OBJECT[opts.area] ?? AREA_OBJECT.outro;
  const valorStr = opts.value ? `R$ ${Number(opts.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '[VALOR DOS HONORÁRIOS]';
  return `CONTRATO DE PRESTAÇÃO DE SERVIÇOS ADVOCATÍCIOS

CONTRATANTE: ${opts.clientName || '[NOME DO CLIENTE]'}, [nacionalidade], [estado civil], [profissão], inscrito(a) no CPF sob nº [CPF], residente e domiciliado(a) em [ENDEREÇO].

CONTRATADA: Advocacia Letícia Barros, inscrita na OAB/[UF] sob nº [Nº OAB], com escritório em [ENDEREÇO DO ESCRITÓRIO].

CLÁUSULA 1ª — DO OBJETO
O presente contrato tem por objeto ${obj}

CLÁUSULA 2ª — DAS OBRIGAÇÕES DA CONTRATADA
A CONTRATADA obriga-se a empregar todo o zelo e diligência no patrocínio da causa, mantendo o CONTRATANTE informado sobre o andamento.

CLÁUSULA 3ª — DOS HONORÁRIOS
Pelos serviços, o CONTRATANTE pagará à CONTRATADA o valor de ${valorStr}, na forma e condições ajustadas: [FORMA DE PAGAMENTO / PARCELAS].
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
