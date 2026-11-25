/**
 * Ponte do Obsidian — regras puras (25/11/2026).
 *
 * O cofre do Obsidian fica no computador do escritório e o CRM na VPS. O
 * programa scripts/ponte-obsidian/ponte.mjs, rodando no computador, mantém os
 * dois em dia sozinho. Aqui ficam as regras do lado do servidor, sem banco:
 *   - a nota de cada cliente que vai para Clientes/ (uma por cliente, com
 *     todos os casos);
 *   - quais arquivos do manual vão para o cofre (espelho de leitura);
 *   - a situação da ponte pelo último sinal de vida e quando avisar a queda.
 * Banco e rotas: obsidianPonteServico.ts e routes/obsidianPonte.ts.
 */

export interface ClienteNota {
  id: number; name: string; cpf_cnpj?: string | null; address?: string | null;
  phone?: string | null; email?: string | null; tipo?: string | null;
}

export interface CasoNota {
  id: number; case_number?: string | null; title?: string | null; legal_area?: string | null;
  polo_cliente?: string | null; production_labels?: string | null; description?: string | null;
  valor_causa?: number | string | null; valor_obtido?: number | string | null;
  resultado?: string | null; resultado_em?: string | Date | null;
  acordos: Array<{ opposing_party?: string | null; total_agreement_value?: any; honorarium_percentage?: any; honorarium_value?: any; sucumbencia_value?: any; status?: string | null }>;
  lancamentos: Array<{ description?: string | null; valor?: any; due_date?: any; status?: string | null; paid_at?: any }>;
  repasses: Array<{ tranche_label?: string | null; valor_bruto?: any; valor_honorarios?: any; valor_liquido?: any; status?: string | null; data_repasse?: any }>;
  partes: Array<{ papel?: string | null; nome?: string | null; cpf_cnpj?: string | null; advogado?: string | null; advogado_oab?: string | null }>;
  documentos: Array<{ id: number; name?: string | null; mime?: string | null }>;
}

export interface NotaCliente { caminho: string; texto: string; anexos: Array<{ id: number; caminho: string }> }

const RESULTADOS: Record<string, string> = {
  acordo: 'Acordo', procedente: 'Procedente', procedente_parcial: 'Procedente em parte',
  improcedente: 'Improcedente', renuncia: 'Renúncia', desistencia: 'Desistência',
};

const brl = (v: any) => (v == null || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const iso = (v: any) => {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(String(v).length === 10 ? `${v}T12:00:00Z` : v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};
const dt = (v: any) => { const s = iso(v); return s ? s.split('-').reverse().join('/') : '—'; };

/** Nome de arquivo/pasta que o Windows aceita e que não sai da pasta. */
export function nomeSeguro(s: string): string {
  const limpo = String(s ?? '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90)
    .replace(/[.\s]+$/, '')
    .replace(/^[.\s]+/, '');
  return limpo || 'sem nome';
}

function extensao(mime?: string | null): string {
  const m = String(mime || '');
  if (/pdf/.test(m)) return '.pdf';
  if (/png/.test(m)) return '.png';
  if (/jpe?g/.test(m)) return '.jpg';
  return '';
}

/**
 * Uma nota por cliente, com todos os casos. Sem data de geração: a nota só
 * muda quando algo muda no CRM (senão o Cérebro reprocessaria tudo todo dia).
 * A senha do Meu INSS nunca entra (fica em client_credentials, fora daqui).
 */
export function montarNotaCliente(cliente: ClienteNota, casos: CasoNota[]): NotaCliente {
  const nome = nomeSeguro(cliente.name);
  const pasta = `Clientes/${nome}`;
  const anexos: NotaCliente['anexos'] = [];
  const principal = casos[0];
  const doc = cliente.tipo === 'PJ' ? 'CNPJ' : 'CPF';

  const blocos = casos.map((c) => {
    const links: string[] = [];
    for (const d of c.documentos) {
      const arquivo = `${nomeSeguro(d.name || 'documento')} #${d.id}${extensao(d.mime)}`;
      anexos.push({ id: d.id, caminho: `${pasta}/anexos/${arquivo}` });
      links.push(`- [[anexos/${arquivo}]]`);
    }
    const vc = Number(c.valor_causa || 0); const vo = c.valor_obtido;
    const pct = vc && vo != null && vo !== '' ? ` (${((Number(vo) / vc) * 100).toFixed(0)}% do valor da causa)` : '';
    const partes = c.partes.length
      ? `\n### Partes\n${c.partes.map((p) => `- **${p.papel}:** ${p.nome}${p.cpf_cnpj ? ` (${p.cpf_cnpj})` : ''}${p.advogado ? ` — adv. ${p.advogado}${p.advogado_oab ? ` OAB ${p.advogado_oab}` : ''}` : ''}`).join('\n')}\n`
      : '';
    const resultado = c.resultado
      ? `- **Resultado:** ${RESULTADOS[c.resultado] || c.resultado} em ${dt(c.resultado_em)} — **obtido:** ${brl(c.valor_obtido)}${pct}`
      : '- **Resultado:** em andamento';
    const financeiro = c.acordos.length ? `
### Financeiro
${c.acordos.map((a) => `- **Acordo** com ${a.opposing_party}: ${brl(a.total_agreement_value)} · honorários ${a.honorarium_percentage}% = ${brl(a.honorarium_value)} · sucumbência ${brl(a.sucumbencia_value)} · ${a.status}`).join('\n')}

| Lançamento | Valor | Vencimento | Situação |
|---|---|---|---|
${c.lancamentos.map((f) => `| ${f.description} | ${brl(f.valor)} | ${dt(f.due_date)} | ${f.status}${f.paid_at ? ` em ${dt(f.paid_at)}` : ''} |`).join('\n')}

**Repasses ao cliente**

| Parcela | Bruto | Honorários | Líquido | Situação |
|---|---|---|---|---|
${c.repasses.map((r) => `| ${r.tranche_label} | ${brl(r.valor_bruto)} | ${brl(r.valor_honorarios)} | ${brl(r.valor_liquido)} | ${r.status}${r.data_repasse ? ` em ${dt(r.data_repasse)}` : ''} |`).join('\n')}
` : '';
    return `## Processo ${c.case_number || 'sem número'}
- **Caso:** ${c.title || '—'}${String(c.production_labels || '').includes('dativo') ? ' · **DATIVO**' : ''} · **Área:** ${c.legal_area || '—'} · **Cliente é:** ${c.polo_cliente === 'passivo' ? 'ré (defesa)' : 'autora'}
- **Valor da causa:** ${brl(c.valor_causa)}
${resultado}
${partes}
### Resumo
${String(c.description || '').trim() || '—'}
${financeiro}
### Documentos
${links.join('\n') || '—'}
`;
  });

  const texto = `---
cliente: "${String(cliente.name).replace(/"/g, "'")}"
cpf_cnpj: "${cliente.cpf_cnpj || ''}"
processo: "${principal?.case_number || ''}"
resultado: ${principal?.resultado || ''}
valor_causa: ${principal?.valor_causa || 0}
valor_obtido: ${principal?.valor_obtido ?? ''}
resultado_em: ${iso(principal?.resultado_em)}
polo_cliente: ${principal?.polo_cliente || 'ativo'}
casos: ${casos.length}
tags: [cliente, crm]
---
# ${cliente.name}

**${doc}:** ${cliente.cpf_cnpj || '—'} · **Endereço:** ${cliente.address || '—'}${cliente.phone ? ` · **Telefone:** ${cliente.phone}` : ''}${cliente.email ? ` · **E-mail:** ${cliente.email}` : ''}

${blocos.join('\n')}
*Gerado do CRM pela ponte do Obsidian. Não edite aqui: a fonte oficial é o CRM e esta nota é reescrita quando o cadastro muda.*
`;
  return { caminho: `${pasta}/${nome}.md`, texto, anexos };
}

/**
 * Arquivos que o CRM escreve no cofre (só leitura para a Dra.):
 * docs/manual/*.md → Documentação Técnica/, a ficha do Escritório Virtual e o
 * Mapa do cofre na raiz.
 */
export function arquivosDoEspelho(manual: Array<{ nome: string; texto: string }>, fichaEscritorio: string | null, mapa: string | null) {
  const out: Array<{ caminho: string; texto: string }> = [];
  for (const m of manual) {
    if (!/^[^/\\]+\.md$/i.test(m.nome) || m.nome.startsWith('.')) continue;
    out.push({ caminho: `Documentação Técnica/${m.nome}`, texto: m.texto });
  }
  if (fichaEscritorio) out.push({ caminho: 'Escritório Virtual.md', texto: fichaEscritorio });
  if (mapa) out.push({ caminho: 'Mapa do cofre.md', texto: mapa });
  return out;
}

const CONECTADA_MIN = 30;
const QUEDA_MS = 24 * 60 * 60 * 1000;

export function situacaoPonte(ultimoSinal: Date | null, agora: Date) {
  if (!ultimoSinal) return { estado: 'nunca' as const, minutos: null };
  const minutos = Math.max(0, Math.round((agora.getTime() - ultimoSinal.getTime()) / 60_000));
  return { estado: minutos <= CONECTADA_MIN ? ('conectada' as const) : ('parada' as const), minutos };
}

/** Avisa uma vez por queda, depois de 24 h sem sinal. Ponte que nunca ligou não avisa. */
export function deveAvisarQueda(ultimoSinal: Date | null, avisadoEm: Date | null, agora: Date): boolean {
  if (!ultimoSinal) return false;
  if (agora.getTime() - ultimoSinal.getTime() < QUEDA_MS) return false;
  return !avisadoEm || avisadoEm.getTime() < ultimoSinal.getTime();
}
