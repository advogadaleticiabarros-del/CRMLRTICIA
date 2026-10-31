/**
 * O pedido de leitura de um arquivo pela IA, o mesmo para todos os caminhos (arquivo
 * guardado no banco, anexo do Drive, pasta do Drive). Incidente de 31/10/2026 (Valmirio/Itaú):
 * o Drive era lido com um pedido de RESUMO ("em tópicos curtos") e o extrato de empréstimos
 * perdia parcela, início e inclusão de cada contrato; o Calculista ficava sem ter como ligar
 * os descontos aos contratos e o demonstrativo saía com R$ 0,00. Agora tudo é transcrito
 * na íntegra, e os resumos antigos de extrato são lidos de novo (resumoAntigoDeExtrato).
 * Testes em tests/transcricaoDocumento.test.mjs.
 */

export const PROMPT_TRANSCRICAO = `Transcreva este documento INTEGRALMENTE e com fidelidade, em português. Preserve todos os números, datas, valores, nomes, CPF/CNPJ e números de contrato.
Tabelas (extrato do INSS/HISCON/HISCRE, fatura, holerite, extrato bancário): uma linha por registro, colunas separadas por " | ", com o cabeçalho. Transcreva TODAS as linhas e TODAS as colunas, inclusive as da direita (no HISCON: data de inclusão, início e fim do desconto, quantidade de parcelas, valor da parcela, valor emprestado). No histórico de créditos (HISCRE), cada competência com todas as rubricas e valores (ex.: "216 CONSIGNACAO EMPRESTIMO BANCARIO | 43,64").
Não resuma, não interprete e não invente. Trecho ilegível: [ilegível]. Comece com uma linha "TIPO: <tipo do documento>".`;

const PROMPT_AUDIO = `Este é um ÁUDIO (possível prova). 1) TRANSCREVA integralmente em português, verbatim e fiel; identifique quem fala quando possível (ex.: "Homem:", "Mulher:"). 2) Em seguida, liste os PONTOS JURIDICAMENTE RELEVANTES: datas, valores, fatos, promessas/ameaças/confissões e o que o áudio comprova. NÃO invente nada; marque [inaudível] onde não der para entender. Formato: "TRANSCRIÇÃO:" e depois "PONTOS RELEVANTES:".`;

const AUDIO = /^audio\//i;

export function promptLeituraArquivo(mime: string): string {
  return AUDIO.test(mime) ? PROMPT_AUDIO : PROMPT_TRANSCRICAO;
}

/** Cabeçalho gravado antes do texto lido (documents.content). O antigo, do resumo, era "[Extraído por IA de ...]". */
export function rotuloLeitura(mime: string, nome: string): string {
  return `[${AUDIO.test(mime) ? 'Transcrição' : 'Transcrito'} por IA de "${nome}"]`;
}

/** Prefixo da memória de leituras por conteúdo: o resumo antigo, guardado com "drive", não volta. */
export const REF_LEITURA_DRIVE = 'drive-integral';

const ROTULO_RESUMO = /^\[Extraído por IA de /;
const EXTRATO = /hiscon|hiscre|hist[oó]rico de cr[eé]ditos|extrato|consigna|empr[eé]stimo|rubrica|\binss\b|benef[ií]cio/i;

/** Resumo do tempo antigo de um extrato (INSS, empréstimos, benefício): precisa ser transcrito de novo. */
export function resumoAntigoDeExtrato(conteudo: string | null | undefined, nome: string | null | undefined): boolean {
  const t = String(conteudo || '');
  return ROTULO_RESUMO.test(t) && (EXTRATO.test(String(nome || '')) || EXTRATO.test(t));
}
