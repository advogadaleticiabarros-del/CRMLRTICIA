/**
 * Secretária particular da Dra. (escritório virtual): recebe o que os outros
 * agentes produziram e entrega à Dra. já mastigado, no WhatsApp. Por enquanto
 * monta a mensagem da decisão lida pelo Leitor (`leitorDecisao.ts`). Regras
 * puras, sem banco nem envio — testado em tests/leitorDecisao.test.mjs.
 */
import type { LeituraDecisao, Resultado, Favoravel } from './leitorDecisao';

const RESULTADO_PT: Record<Resultado, string> = {
  procedente: 'Procedente',
  parcialmente_procedente: 'Parcialmente procedente',
  improcedente: 'Improcedente',
  extinto_sem_merito: 'Extinto sem julgamento do mérito',
  acordo_homologado: 'Acordo homologado',
  provido: 'Recurso provido',
  parcialmente_provido: 'Recurso parcialmente provido',
  nao_provido: 'Recurso não provido',
  nao_conhecido: 'Recurso não conhecido',
  outro: 'Ver resumo',
};

const ICONE: Record<Favoravel, string> = { sim: '✅', parcial: '🟡', nao: '❌', indefinido: '⚪' };

const dataBR = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
};

const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export interface MensagemDecisao {
  leitura: LeituraDecisao;
  processo: string;
  cliente: string | null;
  orgao: string | null;
  prazos: Array<{ nome: string; dias: number; vencimento: string }>;
  publicadaEm: string | null;
}

export function montarMensagemDecisao(d: MensagemDecisao): string {
  const l = d.leitura;
  const titulo = l.tipo === 'acordao' ? 'Acórdão lido' : 'Sentença lida';
  const linhas: (string | null)[] = [
    `📄 *${titulo}* — ${d.cliente || 'processo sem cliente vinculado'}`,
    `Proc. ${d.processo}${d.orgao ? ` · ${d.orgao}` : ''}`,
    !d.cliente ? '(Vincule o cliente em Processos para a leitura saber de que lado estamos.)' : null,
    '',
    `*Resultado:* ${ICONE[l.favoravel_ao_cliente]} ${RESULTADO_PT[l.resultado]}`,
    '',
    `*Em resumo:* ${l.resumo}`,
  ];

  if (l.ganhamos.length) linhas.push('', '*Ganhamos:*', ...l.ganhamos.map((x) => `• ${x}`));
  if (l.perdemos.length) linhas.push('', '*Perdemos:*', ...l.perdemos.map((x) => `• ${x}`));

  const valor = l.valor_condenacao !== null
    ? `${reais(l.valor_condenacao)}${l.valor_texto ? ` (${l.valor_texto})` : ''}`
    : l.valor_texto;
  const extras = [
    valor ? `*Valor:* ${valor}` : null,
    l.honorarios_sucumbencia ? `*Sucumbência:* ${l.honorarios_sucumbencia}` : null,
    l.justica_gratuita ? `*Justiça gratuita:* ${l.justica_gratuita}` : null,
  ].filter(Boolean) as string[];
  if (extras.length) linhas.push('', ...extras);

  if (l.pontos_de_atencao.length) linhas.push('', '⚠️ *Pontos de atenção:*', ...l.pontos_de_atencao.map((x) => `• ${x}`));

  if (d.prazos.length) {
    linhas.push(
      '',
      `⏰ *Prazos${d.publicadaEm ? ` (contados de ${dataBR(d.publicadaEm)})` : ''}:*`,
      ...d.prazos.map((p) => `• ${p.nome}: ${p.dias} dias úteis → até ${dataBR(p.vencimento)}`),
    );
  }

  if (l.sugestao) linhas.push('', `👉 *Sugestão:* ${l.sugestao}`);
  linhas.push('', '_Leitura automática. Confirme o prazo em Prazos no CRM antes de protocolar._');

  return linhas.filter((x) => x !== null).join('\n');
}
