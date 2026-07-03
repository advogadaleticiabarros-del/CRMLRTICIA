import { db } from '../config/database';
import { aiComplete } from './aiAssistant';

/**
 * REVISÃO da petição na esteira de produção (port do Revisar_peticao.py).
 *
 *  1) CHECAGENS ESTRUTURAIS (por regra, offline): endereçamento, qualificação,
 *     fatos, direito, base legal, pedidos, valor da causa, provas, fecho e OAB.
 *  2) ANÁLISE DE MÉRITO (IA): usa o aiComplete com preferência 'groq'
 *     (análise/triagem — divisão de trabalho do aiAssistant), fallback Gemini.
 *
 * Gatilho: ao mover o caso para a etapa "Revisão inicial" (revisao_inicial).
 * O resultado é salvo como DOCUMENTO do caso ("Revisão da Petição — ... (IA)")
 * e resumido em nota da produção, para aparecer na esteira.
 */

export interface ChecagemEstrutural {
  item: string;
  ok: boolean;
  gravidade: 'alta' | 'media' | 'baixa';
  detalhe: string;
}

/** minúsculas + sem acento — facilita casar com regex. */
const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Elementos obrigatórios da petição (CPC art. 319/320 e boas práticas). */
export function checagensEstruturais(texto: string): ChecagemEstrutural[] {
  const n = norm(texto);
  const out: ChecagemEstrutural[] = [];
  const add = (item: string, ok: boolean, gravidade: ChecagemEstrutural['gravidade'], falta: string, okMsg: string) =>
    out.push({ item, ok, gravidade, detalhe: ok ? okMsg : falta });

  add('Endereçamento',
    /\b(exmo|excelentissimo|meritissimo|juizo|vara|comarca|tribunal|turma)\b/.test(n), 'alta',
    "Não localizado o endereçamento ao juízo (ex.: 'Exmo. Sr. Dr. Juiz...').",
    'Cabeçalho ao juízo/vara competente.');

  add('Qualificação das partes',
    /\bcpf\b|\bcnpj\b/.test(n) || /\b(brasileir[oa]|nacionalidade|estado civil|residente|domiciliad)/.test(n), 'alta',
    'Faltam dados de qualificação das partes (CPF/CNPJ, nacionalidade, endereço) — CPC art. 319, II.',
    'Dados de qualificação presentes.');

  add('Dos fatos',
    /\bdos fatos\b|\bd[oa]s? fato/.test(n), 'media',
    "Não há seção de 'Dos Fatos' claramente delimitada.",
    'Seção de fatos identificada.');

  add('Do direito / fundamentação',
    /\bdo direito\b|\bfundament/.test(n), 'media',
    "Não há seção 'Do Direito'/fundamentação jurídica clara.",
    'Fundamentação jurídica identificada.');

  add('Base legal citada',
    /\bart(?:igo)?s?\.?\s*\d+|\blei\s*n/.test(n), 'media',
    'Nenhum artigo de lei ou norma citado — reforçar a fundamentação.',
    'Há citação de dispositivos legais.');

  add('Dos pedidos',
    /\bdos pedidos\b|\brequer\b|\bpede\b|\bpostula\b|\bpugna\b/.test(n), 'alta',
    "Não localizado o rol de pedidos ('Requer...', 'Dos Pedidos').",
    'Pedido(s) identificado(s).');

  add('Valor da causa',
    /valor da causa|d[aoe] causa.*r\$|\br\$\s*[\d.]+/.test(n), 'alta',
    'Valor da causa não localizado — obrigatório (CPC art. 319, V / 291).',
    'Valor da causa indicado.');

  add('Requerimento de provas',
    /\bprotesta\b.*prov|\bprovar\b|meios de prova|\bprovas admit/.test(n), 'baixa',
    'Não há protesto por provas (documental, testemunhal, pericial).',
    'Protesto/menção a provas presente.');

  add('Fecho e data',
    /termos em que|nestes termos|pede deferimento|p\.?\s*deferimento/.test(n) &&
    /\b\d{1,2}\s+de\s+[a-z]+\s+de\s+\d{4}\b|\b\d{2}\/\d{2}\/\d{4}\b/.test(n), 'media',
    "Verificar fecho ('Nestes termos, pede deferimento') e local/data.",
    'Fecho e data presentes.');

  add('Assinatura / OAB',
    /\boab\b|advogad/.test(n), 'alta',
    'Não localizada assinatura do advogado com número da OAB.',
    'Assinatura do advogado / OAB presente.');

  return out;
}

const PROMPT_REVISAO = (peticao: string) => `Você é um advogado brasileiro sênior revisando a petição abaixo antes do protocolo.
Faça uma REVISÃO CRÍTICA, técnica e objetiva. NÃO reescreva a peça — aponte o que precisa melhorar.

Avalie e responda em tópicos curtos:
1. ADEQUAÇÃO FORMAL: endereçamento, qualificação das partes, valor da causa, pedidos, fecho, assinatura/OAB.
2. FUNDAMENTAÇÃO: o direito invocado sustenta os pedidos? Faltam dispositivos legais ou jurisprudência?
3. COERÊNCIA FATOS ↔ PEDIDOS: cada pedido decorre dos fatos narrados? Há pedido sem causa de pedir?
4. RISCOS: preliminares que a parte contrária pode arguir (inépcia, prescrição, ilegitimidade, etc.).
5. LINGUAGEM: clareza, técnica e correção.
6. NOTA GERAL (0 a 10) e as 3 correções mais importantes, em ordem de prioridade.

Seja específico e cite trechos quando útil. Se algo estiver correto, diga que está adequado.

=== PETIÇÃO ===
${peticao.slice(0, 24000)}
=== FIM ===`;

/** Monta o texto do documento de revisão (checklist + análise da IA). */
function formatarRelatorio(checks: ChecagemEstrutural[], ia: string | null, iaErro: string | null): string {
  const ok = checks.filter((c) => c.ok).length;
  const criticas = checks.filter((c) => !c.ok && c.gravidade === 'alta');
  const linhas: string[] = [];
  linhas.push('REVISÃO AUTOMÁTICA DA PETIÇÃO');
  linhas.push('');
  linhas.push(`ESTRUTURA: ${ok}/${checks.length} itens OK · Pendências críticas: ${criticas.length}`);
  linhas.push('─'.repeat(50));
  for (const c of checks) {
    linhas.push(`${c.ok ? '✓' : '✗'} ${c.item}${c.ok ? '' : ` [${c.gravidade.toUpperCase()}]`}`);
    if (!c.ok) linhas.push(`   → ${c.detalhe}`);
  }
  linhas.push('─'.repeat(50));
  linhas.push('');
  if (ia) {
    linhas.push('ANÁLISE DE MÉRITO (IA):');
    linhas.push('');
    linhas.push(ia.trim());
  } else {
    linhas.push(`[Análise de mérito indisponível${iaErro ? `: ${iaErro}` : ' — IA não configurada'}. Valeu a checagem estrutural acima.]`);
  }
  return linhas.join('\n');
}

export interface ResultadoRevisao {
  ok: boolean;
  docId?: number;
  message?: string;
  resumo?: { itens_ok: number; itens_verificados: number; pendencias_criticas: number; ia: boolean };
}

/**
 * Revisa a petição mais recente do caso e salva o parecer como documento.
 * Retorna { ok:false, message } quando o caso ainda não tem petição com texto.
 */
export async function revisarPeticaoDoCaso(caseId: number, actorId: number): Promise<ResultadoRevisao> {
  // 1) A peça a revisar: o documento de petição mais recente do caso com texto
  //    (a gerada pela IA na etapa "Criação inicial" tem type='ia').
  const [docs] = await db.query(
    `SELECT id, name, content FROM documents
      WHERE case_id = ? AND content IS NOT NULL AND content <> ''
        AND (type = 'ia' OR name LIKE 'Peti%')
      ORDER BY id DESC LIMIT 1`, [caseId]
  ) as any;
  const peca = (docs || [])[0];
  if (!peca?.content) {
    return { ok: false, message: 'Nenhuma petição com texto encontrada neste caso para revisar.' };
  }

  // 2) Checagens estruturais (regra) + análise de mérito (IA, groq→gemini).
  const checks = checagensEstruturais(String(peca.content));
  let iaTexto: string | null = null;
  let iaErro: string | null = null;
  try {
    const r = await aiComplete(PROMPT_REVISAO(String(peca.content)), 'groq');
    if (r.ok && r.text) iaTexto = r.text;
    else iaErro = r.message || null;
  } catch (e: any) { iaErro = e?.message || 'falha na IA'; }

  const relatorio = formatarRelatorio(checks, iaTexto, iaErro);
  const itensOk = checks.filter((c) => c.ok).length;
  const criticas = checks.filter((c) => !c.ok && c.gravidade === 'alta').length;

  // 3) Salva o parecer como documento do caso (mesmo padrão da petição gerada).
  const [caso] = await db.query('SELECT client_id FROM cases WHERE id = ?', [caseId]) as any;
  const clientId = caso?.[0]?.client_id || null;
  const nome = `Revisão da Petição — ${String(peca.name).slice(0, 120)} (IA)`;
  const [r] = await db.query(
    `INSERT INTO documents (client_id, case_id, name, type, folder, content, status, created_by)
     VALUES (?, ?, ?, 'ia', 'processos', ?, 'pendente', ?)`,
    [clientId, caseId, nome, relatorio, actorId]
  ) as any;

  // 4) Resumo na esteira de produção (tabela pode não existir antes da migration 044).
  try {
    await db.query(
      `INSERT INTO production_notes (case_id, user_id, author_name, kind, text)
       VALUES (?, ?, 'Revisor IA', 'atualizacao', ?)`,
      [caseId, actorId,
       `Revisão automática da petição: ${itensOk}/${checks.length} itens estruturais OK` +
       (criticas ? ` · ${criticas} pendência(s) CRÍTICA(s)` : ' · sem pendências críticas') +
       (iaTexto ? ' · análise de mérito no documento de revisão.' : ' · IA de mérito indisponível.')]
    );
  } catch { /* ok */ }

  return {
    ok: true,
    docId: r.insertId,
    resumo: { itens_ok: itensOk, itens_verificados: checks.length, pendencias_criticas: criticas, ia: !!iaTexto },
  };
}
