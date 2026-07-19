import { db } from '../config/database';
import { aiComplete, aiExtractFromFile } from './aiAssistant';
import { driveFileId, downloadDriveFile, driveFolderId, listDriveFolderFiles } from './partnerInboxService';

/**
 * Geração da PETIÇÃO INICIAL a partir de TUDO que se tem do cliente:
 *  1) lê os DOCUMENTOS anexados (Drive) com o Gemini (visão) e guarda o conteúdo;
 *  2) reúne o RELATO (resumo do caso do lead + descrição do caso + qualificação);
 *  3) redige a peça (Gemini) com base SÓ nesses dados — sem inventar nada,
 *     usando [colchetes] onde faltar informação;
 *  4) salva na produção do caso (documents, pendente de revisão).
 *
 * Gatilho: ao mover o caso para a etapa "Criação inicial" (criacao_inicial).
 */

const DOC_OK = /^(application\/pdf|image\/(jpeg|jpg|png|webp|heic|heif))$/i;
const AUDIO_OK = /^audio\//i; // Gemini transcreve áudio nativamente (mp3, ogg/opus do WhatsApp, m4a, wav…)
const READABLE = (m: string) => DOC_OK.test(m) || AUDIO_OK.test(m);
/** Instrução conforme o tipo de arquivo (documento/foto vs. áudio). */
function instructionFor(mime: string): string {
  if (AUDIO_OK.test(mime)) {
    return `Este é um ÁUDIO (possível prova). 1) TRANSCREVA integralmente em português, verbatim e fiel; identifique quem fala quando possível (ex.: "Homem:", "Mulher:"). 2) Em seguida, liste os PONTOS JURIDICAMENTE RELEVANTES: datas, valores, fatos, promessas/ameaças/confissões e o que o áudio comprova. NÃO invente nada; marque [inaudível] onde não der para entender. Formato: "TRANSCRIÇÃO:" e depois "PONTOS RELEVANTES:".`;
  }
  return `Você é um analista jurídico. Leia este documento (anexo de um caso) e extraia, de forma objetiva e FIEL, todo o conteúdo e os dados relevantes para uma petição: tipo do documento, partes envolvidas, CPF/CNPJ, valores, datas, números (contrato, benefício, processo, conta), endereços e o que o documento comprova. NÃO invente nada; se algo estiver ilegível, escreva "[ilegível]". Responda em português, em tópicos curtos.`;
}
const tagFor = (mime: string) => AUDIO_OK.test(mime) ? 'Transcrição por IA' : 'Extraído por IA';

/** Lê os anexos do caso (que ainda não têm texto) com a IA e salva o conteúdo. */
export async function extractCaseDocuments(caseId: number): Promise<number> {
  const [docs] = await db.query(
    `SELECT id, name, file_url FROM documents
      WHERE case_id = ? AND file_url IS NOT NULL AND file_url <> '' AND (content IS NULL OR content = '')
      ORDER BY id ASC LIMIT 20`, [caseId]
  ) as any;
  let n = 0;
  for (const d of docs || []) {
    const fid = driveFileId(d.file_url);
    if (!fid) continue;
    const file = await downloadDriveFile(fid);
    if (!file || !READABLE(file.mimeType)) continue;
    const r = await aiExtractFromFile(file.base64, file.mimeType, instructionFor(file.mimeType));
    if (r.ok && r.text) {
      await db.query('UPDATE documents SET content = ? WHERE id = ?', [`[${tagFor(file.mimeType)} de "${d.name}"]\n${r.text}`, d.id]);
      n++;
    }
  }
  return n;
}

/**
 * Importa os arquivos de uma PASTA do Drive indicada no caso: baixa, lê com IA
 * e grava como documentos do caso (com conteúdo). Dedup por nome. Requer o
 * escopo drive.readonly (a advogada reconecta o Google para conceder).
 */
export async function importDriveFolder(caseId: number, clientId: number | null, folderUrl: string, actorId: number): Promise<number> {
  const fid = driveFolderId(folderUrl);
  if (!fid) return 0;
  const files = await listDriveFolderFiles(fid);
  let n = 0;
  for (const f of files) {
    const [[dup]] = await db.query('SELECT id FROM documents WHERE case_id = ? AND name = ? LIMIT 1', [caseId, f.name]) as any;
    if (dup) continue;
    if (!READABLE(f.mimeType)) {
      // Guarda o arquivo (link) mesmo sem leitura por IA (ex.: vídeo/formato não suportado).
      await db.query(
        `INSERT INTO documents (client_id, case_id, name, type, folder, file_url, status, created_by)
         VALUES (?, ?, ?, 'anexo', 'processos', ?, 'recebido', ?)`,
        [clientId, caseId, f.name, `https://drive.google.com/file/d/${f.id}/view`, actorId]
      );
      continue;
    }
    const file = await downloadDriveFile(f.id);
    let content: string | null = null;
    if (file) {
      const r = await aiExtractFromFile(file.base64, file.mimeType, instructionFor(file.mimeType));
      if (r.ok && r.text) content = `[${tagFor(file.mimeType)} de "${f.name}"]\n${r.text}`;
    }
    await db.query(
      `INSERT INTO documents (client_id, case_id, name, type, folder, file_url, content, status, created_by)
       VALUES (?, ?, ?, 'anexo', 'processos', ?, ?, 'recebido', ?)`,
      [clientId, caseId, f.name, `https://drive.google.com/file/d/${f.id}/view`, content, actorId]
    );
    n++;
  }
  return n;
}

/** Reúne o relato + qualificação + conteúdo dos documentos do caso. */
async function gatherContext(caseId: number): Promise<{ prompt: string; clientId: number | null; clientName: string }> {
  const [[cs]] = await db.query('SELECT id, client_id, title, legal_area, description, origin_contract_id FROM cases WHERE id = ?', [caseId]) as any;
  const clientId = cs?.client_id ?? null;
  const [[cl]] = clientId ? await db.query('SELECT name, cpf_cnpj, email, phone, address FROM clients WHERE id = ?', [clientId]) as any : [[null]];

  // Lead vinculado (relato do caso): pelo contrato ou pelo client_id.
  let lead: any = null;
  if (cs?.origin_contract_id) {
    const [[ct]] = await db.query('SELECT lead_id FROM contracts WHERE id = ?', [cs.origin_contract_id]) as any;
    if (ct?.lead_id) { const [[l]] = await db.query('SELECT name, marital_status, profession, case_summary, cep, street, number, neighborhood, city, state FROM leads WHERE id = ?', [ct.lead_id]) as any; lead = l; }
  }
  if (!lead && clientId) { const [[l]] = await db.query('SELECT name, marital_status, profession, case_summary, cep, street, number, neighborhood, city, state FROM leads WHERE client_id = ? ORDER BY id DESC LIMIT 1', [clientId]) as any; lead = l || null; }

  const [docs] = await db.query("SELECT name, content FROM documents WHERE case_id = ? AND content IS NOT NULL AND content <> '' ORDER BY id ASC LIMIT 20", [caseId]) as any;
  const docsTxt = (docs || []).map((d: any) => `--- ${d.name} ---\n${String(d.content).slice(0, 4000)}`).join('\n\n').slice(0, 24000);

  const [[law]] = await db.query("SELECT name, oab_number, oab_uf FROM lawyers WHERE active = 1 ORDER BY id LIMIT 1") as any;
  const adv = law ? `${law.name}, OAB/${law.oab_uf || ''} nº ${law.oab_number || ''}` : 'a advogada responsável';

  const endereco = cl?.address || (lead ? [lead.street, lead.number, lead.neighborhood, lead.city && (lead.city + '/' + (lead.state || '')), lead.cep].filter(Boolean).join(', ') : '');
  const relato = lead?.case_summary || cs?.description || '';

  // ── CÉREBRO: modelo do COFRE do escritório que melhor casa com o caso ──────
  // Busca por área + palavras do título/relato. O modelo entra no prompt como
  // referência de estrutura, teses e fundamentos — a peça sai com a cara do
  // escritório, não genérica.
  let modeloTxt = '';
  try {
    const termos = `${cs?.title || ''} ${relato}`.toLowerCase();
    const [modelos] = await db.query(
      `SELECT titulo, assunto, teses, fundamentos, conteudo FROM peca_modelos
        WHERE area = ? OR area IS NULL ORDER BY (area = ?) DESC, id ASC LIMIT 20`,
      [cs?.legal_area || '', cs?.legal_area || '']
    ) as any;
    // Pontua por palavras do assunto/título do modelo presentes no caso
    let melhor: any = null; let melhorPts = 0;
    for (const m of modelos) {
      const chaves = `${m.assunto || ''} ${m.titulo || ''}`.toLowerCase()
        .split(/[^a-zà-ú0-9]+/).filter((w: string) => w.length > 4);
      const pts = chaves.reduce((s: number, w: string) => s + (termos.includes(w) ? 1 : 0), 0);
      if (pts > melhorPts) { melhorPts = pts; melhor = m; }
    }
    if (!melhor && modelos.length) melhor = modelos[0]; // fallback: 1º da área
    if (melhor) {
      modeloTxt = `\n\nMODELO DO ESCRITÓRIO (referência de estrutura, teses e estilo — ADAPTE aos fatos deste caso; NUNCA copie dados do modelo):
Título: ${melhor.titulo}${melhor.assunto ? `\nAssunto: ${melhor.assunto}` : ''}${melhor.teses ? `\nTeses da casa: ${melhor.teses}` : ''}${melhor.fundamentos ? `\nFundamentos usados: ${melhor.fundamentos}` : ''}${melhor.conteudo ? `\nTrecho do modelo:\n${String(melhor.conteudo).slice(0, 9000)}` : ''}`;
    }
  } catch { /* cofre vazio ou indisponível — segue sem modelo */ }

  const prompt = `Você é advogado(a) brasileiro(a), redator(a) de peças, minucioso(a). Redija uma PETIÇÃO INICIAL completa e profissional, pronta para revisão final, com base EXCLUSIVAMENTE no relato e nos documentos abaixo.

REGRAS ANTI-INVENÇÃO (OBRIGATÓRIAS — descumprir é falha grave):
- Use SOMENTE fatos e dados EXPLÍCITOS no relato ou nos documentos. É TERMINANTEMENTE PROIBIDO inventar, inferir, deduzir, presumir, completar ou "corrigir" qualquer dado.
- NUNCA crie, complete ou ajuste identificadores/números: CPF, CNPJ, RG, nº de processo/benefício/conta/OAB, endereços, valores ou datas. Se não estiver escrito na fonte, escreva [colchete indicando o dado a preencher] — jamais um número aproximado ou fictício.
- Dados da PARTE CONTRÁRIA (nome, CPF/CNPJ, endereço) só podem ser afirmados se constarem de um DOCUMENTO/PROVA. Se aparecerem só no relato do cliente (versão da parte), trate como alegação e marque "[a comprovar — não consta em documento]".
- Se um número parecer inválido/incompleto (ex.: CNPJ sem 14 dígitos, CPF sem 11), NÃO o reproduza: escreva "[número informado parece inválido — conferir]".
- Na dúvida, SEMPRE prefira o [colchete] a afirmar. Melhor a peça pedir o dado do que trazer um dado errado.
- Analise os DOCUMENTOS para extrair partes, CPF/CNPJ, valores, datas e o que comprovam — mas use apenas o que de fato estiver neles.
- Estruture: endereçamento ao juízo competente (deduza pela área/comarca do relato), qualificação do autor, qualificação do(s) réu(s), DOS FATOS, DO DIREITO (com fundamentos legais pertinentes — CDC, CC, CPC, Lei 9.099/95 conforme o caso), DOS PEDIDOS, DAS PROVAS, DO VALOR DA CAUSA, fecho.
- Português jurídico formal.

QUALIFICAÇÃO DO AUTOR (conforme cadastro):
Nome: ${cl?.name || lead?.name || '[nome]'}
CPF: ${cl?.cpf_cnpj || '[CPF]'}
Estado civil: ${lead?.marital_status || '[estado civil]'} · Profissão: ${lead?.profession || '[profissão]'}
Endereço: ${endereco || '[endereço]'}
Contato: ${cl?.phone || '[telefone]'} · ${cl?.email || '[e-mail]'}
Área do caso: ${cs?.legal_area || '[área]'}
Advogada subscritora: ${adv}

RELATO DO CASO:
${relato || '[Sem relato cadastrado — extrair dos documentos]'}

DOCUMENTOS DO CASO (conteúdo extraído):
${docsTxt || '[Nenhum documento com conteúdo extraído]'}${modeloTxt}`;

  return { prompt, clientId, clientName: cl?.name || lead?.name || 'Cliente' };
}

/**
 * ANÁLISE-CHECKLIST do caso: importa a pasta do Drive (novos arquivos), lê os
 * documentos com IA e produz um relatório analítico organizado para embasar a
 * petição inicial (checklist + método fato→prova→fundamento→pedido).
 * Reprocessável a qualquer momento pelo botão — cada execução puxa o que há de
 * novo no Drive e refaz a análise. Substitui a análise anterior do caso.
 */
export async function analyzeCaseDrive(
  caseId: number, actorId: number
): Promise<{ ok: boolean; docId?: number; text?: string; message?: string; imported: number; docsLidos: number }> {
  const [[cf]] = await db.query(
    'SELECT client_id, title, legal_area, description, drive_folder_url FROM cases WHERE id = ?', [caseId]
  ) as any;
  if (!cf) return { ok: false, message: 'Caso não encontrado', imported: 0, docsLidos: 0 };

  // 1) puxa novidades do Drive (dedup por nome) e 2) lê anexos ainda sem texto.
  let imported = 0;
  if (cf.drive_folder_url) imported = await importDriveFolder(caseId, cf.client_id ?? null, cf.drive_folder_url, actorId).catch(() => 0);
  await extractCaseDocuments(caseId).catch(() => 0);

  const clientId = cf.client_id ?? null;
  const [[cl]] = clientId ? await db.query('SELECT name, cpf_cnpj, email, phone, address FROM clients WHERE id = ?', [clientId]) as any : [[null]];
  const [docs] = await db.query(
    "SELECT name, content FROM documents WHERE case_id = ? AND content IS NOT NULL AND content <> '' ORDER BY id ASC LIMIT 30", [caseId]
  ) as any;
  const docsTxt = (docs || []).map((d: any) => `--- ${d.name} ---\n${String(d.content).slice(0, 4000)}`).join('\n\n').slice(0, 28000);
  const relato = cf.description || '';

  const prompt = `Você é advogado(a) brasileiro(a) sênior, analista minucioso(a) de casos. Analise EXCLUSIVAMENTE o relato e os documentos abaixo e produza um RELATÓRIO ANALÍTICO organizado para embasar uma PETIÇÃO INICIAL de alto nível. NÃO invente fatos, datas, valores, nomes ou fundamentos. Onde faltar informação, escreva claramente "PENDENTE: ..." indicando o que obter.

Responda em português, em Markdown, EXATAMENTE com estas seções:

## 1. Documentos recebidos
Liste cada documento e, em uma linha, o que ele comprova. Aponte problemas (ilegível, sem data, sem assinatura, página faltando).

## 2. Linha do tempo
Ordene cronologicamente os fatos e as datas dos documentos (o que ocorreu, quando, o que prova).

## 3. Partes e qualificação
Autor e Réu: marque o que já temos e o que está PENDENTE (nome, CPF/CNPJ, RG, estado civil, profissão, endereço, contato).

## 4. Checklist analítico
Percorra e marque cada item com ✅ (temos), ⚠️ (parcial) ou ⛔ (falta):
Competência · Documentos pessoais · Documentos do caso · Prescrição/decadência · Legitimidade (ativa/passiva) · Fundamentação jurídica aplicável (CF, Código pertinente — CLT/CPC/CC/CDC/ECA, súmulas, temas) · Danos (material, moral, estético, lucros cessantes, dano emergente, perda de uma chance) · Cálculos/valor da causa · Tutela de urgência (cabível?) · Justiça gratuita · Requisitos do art. 319 do CPC.

## 5. Matriz Fato → Prova → Fundamento → Pedido
Tabela com uma linha por fato relevante: | Fato | Prova (qual documento/testemunha) | Fundamento (dispositivo/súmula) | Pedido |. Se faltar prova ou fundamento para algum fato, marque "PENDENTE".

## 6. Provas a produzir
O que requerer (documental, testemunhal, pericial, exibição de documentos, ofícios) e provas que ainda faltam obter.

## 7. Riscos e pendências
Prescrição/decadência, provas frágeis, contradições, informações faltantes — o que resolver antes de protocolar.

## 8. Próximos passos recomendados
Lista objetiva do que fazer em seguida.

DADOS DO CASO
Cliente/Autor: ${cl?.name || '[nome]'} · CPF: ${cl?.cpf_cnpj || '[PENDENTE]'} · Contato: ${cl?.phone || '—'} ${cl?.email || ''}
Endereço: ${cl?.address || '[PENDENTE]'}
Área: ${cf.legal_area || '[a definir]'} · Título do caso: ${cf.title || ''}

RELATO DO CASO:
${relato || '[Sem relato cadastrado — extraia dos documentos o que for possível]'}

DOCUMENTOS DO CASO (conteúdo extraído pela IA):
${docsTxt || '[Nenhum documento com conteúdo lido — verifique o link da pasta do Drive e as permissões]'}`;

  const out = await aiComplete(prompt, 'gemini');
  if (!out.ok || !out.text) return { ok: false, imported, docsLidos: (docs || []).length, message: out.message || 'A IA não retornou a análise' };

  const name = `Análise do caso (checklist) — ${cl?.name || cf.title || 'Caso'}`;
  await db.query("DELETE FROM documents WHERE case_id = ? AND type = 'ia' AND name LIKE 'Análise do caso (checklist)%'", [caseId]);
  const [r] = await db.query(
    `INSERT INTO documents (client_id, case_id, name, type, folder, content, status, created_by)
     VALUES (?, ?, ?, 'ia', 'processos', ?, 'pendente', ?)`,
    [clientId, caseId, name, out.text, actorId]
  ) as any;
  return { ok: true, docId: r.insertId, text: out.text, imported, docsLidos: (docs || []).length };
}

/**
 * Gera a petição inicial do caso e salva na produção. Idempotente: se já houver
 * uma petição gerada para o caso, não recria (a menos que force=true).
 */
export async function buildPeticaoInicial(caseId: number, actorId: number, force = false): Promise<{ ok: boolean; docId?: number; version?: number; message?: string }> {
  // Versões preservadas (v1, v2, v3…) — nunca sobrescreve, para comparação.
  const [existing] = await db.query(
    "SELECT id, name FROM documents WHERE case_id = ? AND type = 'ia' AND name LIKE 'Petição Inicial%' ORDER BY id DESC", [caseId]
  ) as any;
  // No gatilho automático (move para "Criação inicial") gera só a 1ª; regeração
  // é sempre por ação manual (force=true), que cria a próxima versão.
  if (existing.length && !force) return { ok: true, docId: existing[0].id, message: 'Petição já existente (use "gerar nova versão" para regerar)' };
  let maxV = 0;
  for (const d of existing) { const m = String(d.name).match(/\(v(\d+)\)/); maxV = Math.max(maxV, m ? Number(m[1]) : 1); }
  const version = maxV + 1;

  // 0) se o caso aponta uma pasta do Drive, importa os arquivos dela.
  const [[cf]] = await db.query('SELECT client_id, drive_folder_url FROM cases WHERE id = ?', [caseId]) as any;
  if (cf?.drive_folder_url) await importDriveFolder(caseId, cf.client_id ?? null, cf.drive_folder_url, actorId).catch(() => 0);

  // 1) lê os anexos (best-effort) e 2) monta o contexto.
  await extractCaseDocuments(caseId).catch(() => 0);
  const { prompt, clientId, clientName } = await gatherContext(caseId);

  // 3) redige com o Gemini (redação → 'gemini').
  const out = await aiComplete(prompt, 'gemini');
  if (!out.ok || !out.text) return { ok: false, message: out.message || 'A IA não retornou a petição' };

  // 4) salva na produção como NOVA VERSÃO (não sobrescreve as anteriores).
  const name = `Petição Inicial — ${clientName} (v${version})`;
  const [r] = await db.query(
    `INSERT INTO documents (client_id, case_id, name, type, folder, content, status, created_by)
     VALUES (?, ?, ?, 'ia', 'processos', ?, 'pendente', ?)`,
    [clientId, caseId, name, out.text, actorId]
  ) as any;
  return { ok: true, docId: r.insertId, version };
}
