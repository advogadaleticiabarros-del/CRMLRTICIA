import { db } from '../config/database';
import { aiComplete, aiLerArquivo } from './aiAssistant';
import { registrarAcaoAgente } from './usoIa';
import { reusDoCaso, familiaDaTese, type CasoParaJuntar } from './pecaConsolidacao';
import type { DepsEsteira, CasoEsteira } from './esteiraPeca';
import type { Fonte, ItemCatalogo, ContratoFicha, FichaDeFatos } from './pecaDossie';
import { lerUmaVez, refDoConteudo, type CacheLeitura } from './leituraUnica';
import { chaveContrato, type ContratoSalvo, type AcaoParaConferir } from './contratosDoCaso';
import { indicesDoBacen } from './indicesEconomicosMysql';
import { mesmoBanco } from './contratosDoCaso';
import type { CalculoDoBanco } from './contabilista';
import { planilhaMarkdown, planilhaXlsx } from './planilhaCalculos';
import { MIME_XLSX } from './xlsxSimples';

/**
 * Esteira da petição inicial com banco e IA de verdade (regras em esteiraPeca.ts).
 * Fontes: relato, documentos do caso (texto já extraído e arquivos guardados),
 * PDFs e fotos que o cliente mandou no WhatsApp, a conversa inteira e as
 * anotações da produção. Modelos e teses: cofre do Obsidian (peca_modelos e
 * cerebro_notas), com o guia "Como escolher" da área.
 */

const MAX_ARQUIVOS = 30;
const MAX_BYTES = 8 * 1024 * 1024;
const fim8 = (p: string | null | undefined) => String(p || '').replace(/\D/g, '').slice(-8);

/** Pasta do cofre (Modelos de Peças/<pasta>) de cada área do CRM. */
const PASTA_AREA: Record<string, string> = {
  consumidor: 'Consumidor', trabalhista: 'Trabalhista', previdenciario: 'Previdenci_rio',
  familia: 'Fam_lia', execucao: 'Execu__o', extrajudicial: 'Extrajudicial',
};
const pastaDaArea = (area: string | null) => PASTA_AREA[String(area || '').toLowerCase()] || null;

const PROMPT_TRANSCRICAO = `Transcreva este documento INTEGRALMENTE e com fidelidade, em português. Preserve todos os números, datas, valores, nomes, CPF/CNPJ e números de contrato.
Tabelas (extrato do INSS/HISCON/HISCRE, fatura, holerite, extrato bancário): uma linha por registro, colunas separadas por " | ", com o cabeçalho. Transcreva TODAS as linhas e TODAS as colunas, inclusive as da direita (no HISCON: data de inclusão, início e fim do desconto, quantidade de parcelas, valor da parcela, valor emprestado). No histórico de créditos (HISCRE), cada competência com todas as rubricas e valores (ex.: "216 CONSIGNACAO EMPRESTIMO BANCARIO | 43,64").
Não resuma, não interprete e não invente. Trecho ilegível: [ilegível]. Comece com uma linha "TIPO: <tipo do documento>".`;

const PECAS_GERADAS = ['Petição Inicial%', 'Revisão da Petição%', 'Dossiê da peça%', 'Planilha de cálculos%', 'Demonstrativo de descontos%'];

async function caso(id: number): Promise<CasoEsteira> {
  const [[cs]] = await db.query(
    'SELECT id, client_id, title, legal_area, description, origin_contract_id, production_stage, polo_cliente FROM cases WHERE id = ?', [id]) as any;
  if (!cs) throw new Error(`Caso ${id} não encontrado`);
  const [[cl]] = cs.client_id ? await db.query('SELECT name, cpf_cnpj, email, phone, address FROM clients WHERE id = ?', [cs.client_id]) as any : [[null]];
  let lead: any = null;
  if (cs.origin_contract_id) {
    const [[ct]] = await db.query('SELECT lead_id FROM contracts WHERE id = ?', [cs.origin_contract_id]) as any;
    if (ct?.lead_id) [[lead]] = await db.query('SELECT name, marital_status, profession, case_summary, cep, street, number, neighborhood, city, state FROM leads WHERE id = ?', [ct.lead_id]) as any;
  }
  if (!lead && cs.client_id) [[lead]] = await db.query('SELECT name, marital_status, profession, case_summary, cep, street, number, neighborhood, city, state FROM leads WHERE client_id = ? ORDER BY id DESC LIMIT 1', [cs.client_id]) as any;
  const [partes] = await db.query("SELECT nome, cpf_cnpj FROM case_partes WHERE case_id = ? AND papel = 'contraria'", [id]) as any;
  const [[law]] = await db.query('SELECT name, oab_number, oab_uf FROM lawyers WHERE active = 1 ORDER BY id LIMIT 1') as any;
  const endereco = cl?.address || (lead ? [lead.street, lead.number, lead.neighborhood, lead.city && `${lead.city}/${lead.state || ''}`, lead.cep].filter(Boolean).join(', ') : '');
  const nome = cl?.name || lead?.name || 'Cliente';
  return {
    id: cs.id, client_id: cs.client_id ?? null, legal_area: cs.legal_area ?? null, production_stage: cs.production_stage ?? null,
    titulo: cs.title ?? null, cliente: nome, phone: cl?.phone ?? null,
    partes: (partes || []).map((p: any) => ({ nome: p.nome, cpf_cnpj: p.cpf_cnpj })),
    advogada: law ? `${law.name}, OAB/${law.oab_uf || ''} nº ${law.oab_number || ''}` : 'a advogada responsável',
    qualificacao: [
      `Nome: ${nome}`, `CPF: ${cl?.cpf_cnpj || '[CPF]'}`,
      `Estado civil: ${lead?.marital_status || '[estado civil]'} · Profissão: ${lead?.profession || '[profissão]'}`,
      `Endereço: ${endereco || '[endereço]'}`, `Contato: ${cl?.phone || '[telefone]'} · ${cl?.email || '[e-mail]'}`,
      cs.polo_cliente === 'passivo' ? 'ATENÇÃO: no cadastro o cliente está no polo passivo.' : '',
    ].filter(Boolean).join('\n'),
    relato: [lead?.case_summary, cs.description && cs.description !== lead?.case_summary ? cs.description : null].filter(Boolean).join('\n\n'),
  };
}

/** Os pedidos que a Dra. confirmou como um processo só com este caso (cases.unido_ao_caso). */
async function candidatosCorrelatos(c: CasoEsteira): Promise<CasoParaJuntar[]> {
  const [[eu]] = await db.query('SELECT unido_ao_caso FROM cases WHERE id = ?', [c.id]) as any;
  const principal = eu?.unido_ao_caso || c.id;
  const [rows] = await db.query(
    'SELECT id, client_id, legal_area, production_stage FROM cases WHERE (id = ? OR unido_ao_caso = ?) AND id <> ?',
    [principal, principal, c.id]) as any;
  if (!rows.length) return [];
  const [partes] = await db.query("SELECT case_id, nome, cpf_cnpj FROM case_partes WHERE papel = 'contraria' AND case_id IN (?)", [rows.map((r: any) => r.id)]) as any;
  return rows.map((r: any) => ({ ...r, partes: partes.filter((p: any) => p.case_id === r.id).map((p: any) => ({ nome: p.nome, cpf_cnpj: p.cpf_cnpj })) }));
}

/** Memória das leituras pela IA (documento_leituras), usada pela leitura única (leituraUnica.ts). */
export const cacheLeiturasMysql: CacheLeitura = {
  buscar: async (ref) => {
    const [[c]] = await db.query('SELECT leitura FROM documento_leituras WHERE ref = ?', [ref]) as any;
    if (!c) return null;
    const l = jsonDe(c.leitura);
    return l?.texto ? String(l.texto) : null;
  },
  guardar: async (ref, fonte, texto) => {
    await db.query('INSERT IGNORE INTO documento_leituras (ref, fonte, leitura) VALUES (?, ?, ?)', [ref, fonte.slice(0, 255), JSON.stringify({ texto })]);
  },
};

/**
 * Texto integral de um arquivo guardado, lido uma vez só. A memória é pelo conteúdo: o
 * mesmo PDF juntado em várias ações do cliente vai para a IA uma vez (30/10/2026).
 * A chave antiga (por documento) continua valendo para o que já foi lido.
 */
async function textoDoArquivo(ref: string, fonte: string, mime: string, carregar: () => Promise<Buffer | null>): Promise<string> {
  const antiga = await cacheLeiturasMysql.buscar(`texto:${ref}`).catch(() => null);
  if (antiga) return antiga;
  const buf = await carregar();
  if (!buf || buf.length > MAX_BYTES) return '';
  const texto = await lerUmaVez(cacheLeiturasMysql, refDoConteudo('texto', mime, buf), fonte, async () => {
    const r = await aiLerArquivo(buf.toString('base64'), mime, PROMPT_TRANSCRICAO);
    return r.ok && r.text ? r.text : null;
  });
  return texto || '';
}

async function fontes(caseIds: number[], principal: CasoEsteira): Promise<Fonte[]> {
  const out: Fonte[] = [];
  // Anexos do Drive ainda sem texto: lê agora (mesma rotina de sempre).
  const { extractCaseDocuments } = await import('./peticaoBuilder');
  for (const id of caseIds) await extractCaseDocuments(id).catch(() => 0);

  for (const id of caseIds) {
    const c = id === principal.id ? principal : await caso(id).catch(() => null);
    if (c?.relato) out.push({ nome: `Relato cadastrado — caso #${id}`, texto: c.relato });
  }
  const filtroGeradas = PECAS_GERADAS.map(() => 'name NOT LIKE ?').join(' AND ');
  // Também os documentos guardados só no cliente (sem caso), que a análise da Dra. Helena já via.
  const [docs] = await db.query(
    `SELECT id, case_id, name, content, mime, (data IS NOT NULL) AS tem_arquivo FROM documents
      WHERE (case_id IN (?) OR (case_id IS NULL AND ? IS NOT NULL AND client_id = ?)) AND duplicado_de IS NULL AND ${filtroGeradas} ORDER BY id ASC`,
    [caseIds, principal.client_id, principal.client_id, ...PECAS_GERADAS]) as any;
  let arquivos = 0;
  for (const d of docs) {
    const nome = d.case_id ? `${d.name} (caso #${d.case_id})` : `${d.name} (documento do cliente)`;
    if (d.content && String(d.content).trim()) { out.push({ nome, texto: String(d.content) }); continue; }
    if (!d.tem_arquivo || !/^(application\/pdf|image\/)/i.test(String(d.mime || '')) || arquivos >= MAX_ARQUIVOS) { out.push({ nome, texto: '' }); continue; }
    arquivos++;
    const texto = await textoDoArquivo(`doc:${d.id}`, d.name, d.mime, async () => {
      const [[r]] = await db.query('SELECT data FROM documents WHERE id = ?', [d.id]) as any; return r?.data ? Buffer.from(r.data) : null;
    }).catch(() => '');
    out.push({ nome, texto });
  }

  const tel = fim8(principal.phone);
  const [midias] = await db.query(
    `SELECT id, file_name, mime FROM whatsapp_media
      WHERE (client_id = ? OR (? <> '' AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 8) = ?))
        AND (mime LIKE 'image/%' OR mime = 'application/pdf')
      ORDER BY created_at ASC LIMIT ?`, [principal.client_id, tel, tel, MAX_ARQUIVOS]) as any;
  for (const m of midias) {
    const nome = `WhatsApp: ${m.file_name || `arquivo ${m.id}`}`;
    if (arquivos >= MAX_ARQUIVOS) { out.push({ nome, texto: '' }); continue; }
    arquivos++;
    const texto = await textoDoArquivo(`media:${m.id}`, m.file_name || `arquivo ${m.id}`, m.mime, async () => {
      const [[r]] = await db.query('SELECT data FROM whatsapp_media WHERE id = ?', [m.id]) as any; return r?.data ? Buffer.from(r.data) : null;
    }).catch(() => '');
    out.push({ nome, texto });
  }

  if (tel) {
    // Áudios e imagens já chegam transcritos/descritos dentro do body.
    const [msgs] = await db.query(
      `SELECT from_me, body, msg_time FROM whatsapp_messages
        WHERE RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 8) = ? AND body <> ''
        ORDER BY msg_time ASC LIMIT 600`, [tel]) as any;
    const linhas = msgs
      .map((m: any) => `[${new Date(m.msg_time).toLocaleDateString('pt-BR')}] ${m.from_me ? 'Escritório' : 'Cliente'}: ${String(m.body).replace(/\s+/g, ' ').slice(0, 700)}`)
      .filter((l: string) => l.length > 25);
    if (linhas.length) out.push({ nome: 'Conversa do WhatsApp com o cliente', texto: linhas.join('\n'), muda: true });
  }

  const [notas] = await db.query(
    `SELECT case_id, kind, text, created_at FROM production_notes WHERE case_id IN (?) AND kind IN ('observacao','pendencia') ORDER BY created_at ASC`, [caseIds]) as any;
  if (notas.length) out.push({ nome: 'Anotações da equipe na produção', texto: notas.map((n: any) => `- caso #${n.case_id} (${n.kind}): ${n.text}`).join('\n'), muda: true });
  return out;
}

/**
 * Leitura única: os documentos de todas as ações do cliente em produção (antes do
 * protocolo, mesma área), com o mesmo conteúdo uma vez só. O mesmo extrato juntado em
 * cada ação, ou a mesma pasta do Drive, entra uma vez na leitura.
 */
async function fontesDoCliente(clientId: number, principal: CasoEsteira): Promise<Fonte[]> {
  const [casos] = await db.query(
    `SELECT id FROM cases WHERE client_id = ? AND id <> ? AND (legal_area <=> ?)
        AND production_stage IS NOT NULL AND production_stage NOT IN ('protocolado', 'concluido', 'recusado') ORDER BY id`,
    [clientId, principal.id, principal.legal_area]) as any;
  const ids = [...new Set<number>([principal.id, ...casos.map((c: any) => Number(c.id))])];
  const vistos = new Set<string>();
  return (await fontes(ids, principal)).filter((f) => {
    const t = String(f.texto || '').trim();
    if (!t) return true;
    if (vistos.has(t)) return false;
    vistos.add(t);
    return true;
  });
}

async function leituraGuardada(chave: string): Promise<FichaDeFatos | null> {
  const t = await cacheLeiturasMysql.buscar(chave);
  if (!t) return null;
  try { return JSON.parse(t) as FichaDeFatos; } catch { return null; }
}

async function guardarLeitura(chave: string, ficha: FichaDeFatos): Promise<void> {
  await cacheLeiturasMysql.guardar(chave, 'Ficha de fatos (leitura única do cliente)', JSON.stringify(ficha));
}

const secao = (md: string, titulo: string) => {
  const m = String(md || '').match(new RegExp(`##\\s*${titulo}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i'));
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
};

async function catalogo(area: string | null): Promise<{ guia: string; itens: ItemCatalogo[] }> {
  const pasta = pastaDaArea(area);
  let guia = '';
  const fichas = new Map<string, { quando: string; teses: string[]; conteudo: string }>();
  if (pasta) {
    const [g] = await db.query(
      `SELECT titulo, conteudo FROM cerebro_notas WHERE pasta LIKE ? AND (titulo LIKE '%Como escolher%' OR titulo LIKE '%Roteiro de triagem%')
        ORDER BY (titulo LIKE '%Como escolher%') DESC`, [`%Modelos de Pe_as/${pasta}%`]) as any;
    guia = g.map((n: any) => `### ${n.titulo}\n${n.conteudo}`).join('\n\n');
    const [f] = await db.query('SELECT titulo, conteudo, links FROM cerebro_notas WHERE pasta LIKE ?', [`%Modelos de Pe_as/${pasta}/Fichas`]) as any;
    for (const n of f) {
      const links: string[] = (() => { try { return typeof n.links === 'string' ? JSON.parse(n.links) : (n.links || []); } catch { return []; } })();
      fichas.set(n.titulo, { quando: secao(n.conteudo, 'Quando usar'), teses: links.filter((l) => !/\.docx$/i.test(l) && !/como escolher/i.test(l)), conteudo: n.conteudo });
    }
  }
  let [modelos] = await db.query('SELECT titulo, assunto, tipo FROM peca_modelos WHERE area = ? ORDER BY titulo', [area || '']) as any;
  if (!modelos.length) [modelos] = await db.query('SELECT titulo, assunto, tipo FROM peca_modelos ORDER BY titulo') as any;
  const itens: ItemCatalogo[] = modelos.map((m: any) => {
    const f = fichas.get(m.titulo);
    return { titulo: m.titulo, resumo: [m.tipo, m.assunto, f?.quando && `Quando usar: ${f.quando}`, f?.teses.length && `Teses: ${f.teses.join('; ')}`].filter(Boolean).join(' · ') };
  });
  // Ficha no cofre ainda não importada para peca_modelos: entra pelo Cérebro.
  for (const [titulo, f] of fichas) if (!itens.some((i) => i.titulo === titulo)) itens.push({ titulo, resumo: [f.quando && `Quando usar: ${f.quando}`, f.teses.length && `Teses: ${f.teses.join('; ')}`].filter(Boolean).join(' · ') });
  return { guia, itens };
}

async function modelos(titulos: string[]) {
  if (!titulos.length) return [];
  const [rows] = await db.query('SELECT titulo, conteudo FROM peca_modelos WHERE titulo IN (?)', [titulos]) as any;
  const [notas] = await db.query("SELECT titulo, conteudo FROM cerebro_notas WHERE titulo IN (?) AND pasta LIKE '%Fichas'", [titulos]) as any;
  return titulos.map((t) => {
    const m = rows.find((r: any) => r.titulo === t), n = notas.find((r: any) => r.titulo === t);
    return { titulo: t, conteudo: m?.conteudo || n?.conteudo || null };
  });
}

async function teses(titulos: string[]) {
  if (!titulos.length) return [];
  const [rows] = await db.query("SELECT titulo, conteudo FROM cerebro_notas WHERE titulo IN (?) AND pasta LIKE '%Teses%'", [titulos]) as any;
  return rows.map((r: any) => ({ titulo: r.titulo, texto: String(r.conteudo || '') }));
}

async function fundamentos(texto: string, area: string | null) {
  const m = await import('./leisServico');
  return m.fundamentosParaPeca(texto, { area, tipo: 'Petição inicial' }, 'a petição inicial');
}

async function regras(area: string | null, caseIds: number[]) {
  const [rows] = await db.query(
    `SELECT regra FROM peca_licoes
      WHERE (decisao = 'regra' AND area = ?) OR (decisao = 'caso' AND case_id IN (?))
      ORDER BY id DESC LIMIT 40`, [area || '', caseIds.length ? caseIds : [0]]) as any;
  return [...new Set(rows.map((r: any) => String(r.regra)))] as string[];
}

const jsonDe = (v: unknown) => { try { return typeof v === 'string' ? JSON.parse(v) : (v || {}); } catch { return {}; } };

/** Contratos do cliente lidos nos documentos, com a decisão da Dra. (cliente_contratos). */
export async function contratosSalvos(clientId: number): Promise<ContratoSalvo[]> {
  const [rows] = await db.query('SELECT id, chave, case_id, fora, dados FROM cliente_contratos WHERE client_id = ? ORDER BY id', [clientId]) as any;
  return rows.map((r: any) => ({ id: r.id, chave: r.chave, case_id: r.case_id ?? null, fora: !!r.fora, dados: jsonDe(r.dados) }));
}

/** Guarda os contratos lidos. Leitura nova completa a antiga (não apaga dado) e nunca mexe na decisão da Dra. */
export async function guardarContratos(clientId: number, contratos: ContratoFicha[]): Promise<void> {
  const novos = new Map<string, ContratoFicha>();
  for (const c of contratos) { const k = chaveContrato(c); if (!novos.has(k)) novos.set(k, c); }
  if (!novos.size) return;
  const [rows] = await db.query('SELECT chave, dados FROM cliente_contratos WHERE client_id = ? AND chave IN (?)', [clientId, [...novos.keys()]]) as any;
  const antigos = new Map<string, any>(rows.map((r: any) => [r.chave, jsonDe(r.dados)]));
  for (const [chave, c] of novos) {
    const velho = antigos.get(chave) || {};
    const dados = { ...velho, ...Object.fromEntries(Object.entries(c).filter(([, v]) => v != null)) } as ContratoFicha;
    await db.query(
      `INSERT INTO cliente_contratos (client_id, chave, numero, tipo, banco, dados) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE numero = VALUES(numero), tipo = VALUES(tipo), banco = VALUES(banco), dados = VALUES(dados), lido_em = NOW()`,
      [clientId, chave, dados.numero || null, dados.tipo || null, dados.banco || null, JSON.stringify(dados)]);
  }
}

/** Ações do cliente (menos as recusadas), com o réu; o pedido unido a outro conta no processo principal. */
export async function acoesDoCliente(clientId: number): Promise<AcaoParaConferir[]> {
  const [casos] = await db.query(
    `SELECT id, title, unido_ao_caso FROM cases
      WHERE client_id = ? AND (production_stage IS NULL OR production_stage <> 'recusado') ORDER BY id`, [clientId]) as any;
  if (!casos.length) return [];
  const [partes] = await db.query("SELECT case_id, nome, cpf_cnpj FROM case_partes WHERE papel = 'contraria' AND case_id IN (?)", [casos.map((c: any) => c.id)]) as any;
  const principal = new Map<number, number>(casos.map((c: any) => [c.id, c.unido_ao_caso || c.id]));
  return casos.filter((c: any) => !c.unido_ao_caso).map((c: any) => {
    const ps = partes.filter((p: any) => principal.get(p.case_id) === c.id).map((p: any) => ({ nome: p.nome, cpf_cnpj: p.cpf_cnpj }));
    return { id: c.id, titulo: c.title, reus: reusDoCaso({ partes: ps, titulo: c.title }) };
  });
}

/**
 * Planilha de cálculos de cada banco, feita na leitura dos documentos. Fica na ação daquele
 * banco (ou no cliente, sem ação do banco) e a leitura seguinte substitui a anterior.
 */
export async function guardarPlanilhasDoCliente(clientId: number, cliente: string, porBanco: CalculoDoBanco[]): Promise<void> {
  const acoes = await acoesDoCliente(clientId).catch(() => [] as AcaoParaConferir[]);
  const [[admin]] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1") as any;
  for (const b of porBanco) {
    // A ação do mesmo banco e da mesma modalidade (título do processo); sem ela, a do banco.
    const doBanco = acoes.filter((a) => a.reus.some((r) => mesmoBanco(r.nome, b.banco)));
    const acao = doBanco.find((a) => b.familia && familiaDaTese(a.titulo) === b.familia) || (doBanco.length === 1 ? doBanco[0] : undefined);
    const nome = `Planilha de cálculos — ${cliente} · ${b.banco} · ${b.modalidade} (leitura dos documentos)`.slice(0, 255);
    const cab = { cliente, reus: [`${b.banco} — ${b.modalidade}`], casos: acao ? [{ id: acao.id, titulo: acao.titulo }] : [] };
    const xlsx = await planilhaXlsx(b.calculo, cab).catch(() => null);
    await db.query('DELETE FROM documents WHERE client_id = ? AND name = ?', [clientId, nome]);
    await db.query(
      `INSERT INTO documents (client_id, case_id, name, type, folder, content, data, mime, status, created_by)
       VALUES (?, ?, ?, 'ia', 'processos', ?, ?, ?, 'pendente', ?)`,
      [clientId, acao?.id ?? null, nome, planilhaMarkdown(b.calculo, cab), xlsx, xlsx ? MIME_XLSX : null, admin?.id ?? null]);
  }
}

export const depsEsteiraMysql: DepsEsteira = {
  caso, candidatosCorrelatos, fontes, fontesDoCliente, leituraGuardada, guardarLeitura, catalogo, modelos, teses, fundamentos, regras, contratosSalvos, guardarContratos, acoesDoCliente, guardarPlanilhasDoCliente,
  indices: indicesDoBacen,
  ia: (prompt, nivel) => aiComplete(prompt, nivel === 'redacao' ? 'openai-alto' : nivel === 'leitura' ? 'openai-medio' : 'openai'),
  registrar: registrarAcaoAgente,
  hoje: () => new Date(),
};
