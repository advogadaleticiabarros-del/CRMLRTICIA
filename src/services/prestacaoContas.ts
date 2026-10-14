/**
 * Prestação de contas do acordo (texto padrão para o WhatsApp do cliente).
 * Usada quando a parcela é recebida e repassada: mostra o acordo, a parcela
 * do momento, o cronograma completo e quanto falta. Regras puras —
 * tests/prestacaoContas.test.mjs.
 */

export interface ParcelaPrestacao {
  rotulo: string;
  data: string | null;
  bruto: number;
  honorarios: number;
  liquido: number;
  repassada: boolean;
}

export interface DadosPrestacao {
  cliente: string;
  processo: string | null;
  vara?: string | null;
  total: number;
  pctHonorarios: number;
  honorariosTotal: number;
  parcelas: ParcelaPrestacao[];
  /** Índice da parcela desta prestação. */
  atual: number;
  pix?: string | null;
  banco?: string | null;
}

const reais = (v: number) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (iso: string | null) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : 'a definir');
const LINHA = '━━━━━━━━━━━━━━';
const secao = (titulo: string) => [LINHA, titulo, LINHA];

/** 20 dígitos → 0000000-00.0000.0.00.0000; outro formato fica como veio. */
function mascaraCNJ(n: string | null): string | null {
  const d = String(n || '').replace(/\D/g, '');
  if (d.length !== 20) return n ? String(n).trim() || null : null;
  return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16)}`;
}

export function textoPrestacaoContas(d: DadosPrestacao): string {
  const primeiro = String(d.cliente || '').trim().split(/\s+/)[0] || '';
  const nomeProprio = primeiro ? primeiro[0].toUpperCase() + primeiro.slice(1).toLowerCase() : '';
  const p = d.parcelas[d.atual];
  const qtd = d.parcelas.length;
  const iguais = qtd > 0 && d.parcelas.every((x) => Math.abs(x.bruto - d.parcelas[0].bruto) < 0.01);
  const liquidoTotal = d.parcelas.reduce((s, x) => s + x.liquido, 0) || (d.total - d.honorariosTotal);
  const repassado = d.parcelas.filter((x) => x.repassada).reduce((s, x) => s + x.liquido, 0);
  const falta = Math.max(0, Math.round((liquidoTotal - repassado) * 100) / 100);
  const processo = mascaraCNJ(d.processo);
  const ordinal = (r: string) => (r.match(/^\s*(\d+ª)/)?.[1] || r);
  const pix = String(d.pix || '').trim();

  const linhas: (string | null)[] = [
    `Olá${nomeProprio ? `, ${nomeProprio}` : ''}! Segue a *prestação de contas* do seu acordo. 👇`,
    '',
    processo ? `📁 *Processo:* ${processo}` : null,
    d.vara ? `🏛️ ${d.vara}` : null,
    processo || d.vara ? '' : null,
    ...secao('💼 *RESUMO DO ACORDO*'),
    `Valor total do acordo: *${reais(d.total)}*`,
    qtd > 1 && iguais ? `(${qtd} parcelas de ${reais(d.parcelas[0].bruto)})` : qtd > 1 ? `(${qtd} parcelas)` : null,
    '',
    `(-) Honorários contratuais (${d.pctHonorarios}%): *${reais(d.honorariosTotal)}*`,
    qtd > 1 && iguais ? `(${reais(d.parcelas[0].honorarios)} por parcela)` : null,
    '',
    `✅ *Total líquido para você: ${reais(liquidoTotal)}*`,
  ];

  if (p) {
    linhas.push(
      '',
      ...secao(`💰 *${p.rotulo.toUpperCase()} (recebida)*`),
      `Recebido da empresa: ${reais(p.bruto)}`,
      `(-) Honorários (${d.pctHonorarios}%): ${reais(p.honorarios)}`,
      `✅ *Repassado a você: ${reais(p.liquido)}*`,
      pix ? `Pix: ${pix}${d.banco ? ` (${String(d.banco).trim()})` : ''}` : null,
    );
  }

  if (qtd > 1) {
    linhas.push(
      '',
      ...secao('📅 *CRONOGRAMA DAS PARCELAS*'),
      ...d.parcelas.map((x) => `${ordinal(x.rotulo)} · ${dataBR(x.data)} · ${reais(x.liquido)}${x.repassada ? ' ✅' : ''}`),
    );
  }

  linhas.push('', ...secao('📊 *SITUAÇÃO ATUAL*'), `Já repassado: *${reais(repassado)}*`);
  linhas.push(falta > 0 ? `Ainda a receber: *${reais(falta)}*` : '🎉 *Acordo quitado: todas as parcelas foram repassadas.*');
  linhas.push('', 'Qualquer dúvida, estou à disposição! 😊');

  return linhas.filter((l) => l !== null).join('\n');
}
