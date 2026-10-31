import { db } from '../config/database';
import { aiComplete, aiLerArquivo } from './aiAssistant';
import { driveFileId, downloadDriveFile, listarFilhosDrive, contaGoogleDoCrm } from './partnerInboxService';
import { sincronizarPasta, idDaPasta, type DepsPastaDrive, type ResultadoPasta, type ProgressoPasta } from './pastaDrive';
import { clienteJaTem, registrarMd5DoDrive, organizarDuplicados } from './documentosDuplicadosMysql';
import { produzirPeticao } from './esteiraPeca';
import { depsEsteiraMysql, cacheLeiturasMysql } from './esteiraPecaMysql';
import { lerUmaVez, refDoConteudo } from './leituraUnica';
import { travaGeracaoPeca } from './travaGeracaoPeca';
import { brl } from './pecaCalculos';
import { planilhaMarkdown, planilhaXlsx } from './planilhaCalculos';
import { montarDemonstrativo, demonstrativoMarkdown, demonstrativoPdf } from './demonstrativoDescontos';
import { MIME_XLSX } from './xlsxSimples';
import { numeroDaVersao } from './mesaCaso';

/**
 * Geração da PETIÇÃO INICIAL pela esteira dos agentes (esteiraPeca.ts): leitura
 * de todas as fontes, ficha de fatos, cálculos em código, escolha do modelo pelo
 * guia do cofre, fundamentos verificados e redação. Aqui ficam a leitura dos
 * anexos do Drive, a análise-checklist e a gravação do resultado no caso.
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

/**
 * Mesma pasta, uma leitura só (pedido da Jessica, 30/10/2026): o arquivo do Drive que
 * outra ação já leu (mesmo ID) tem a leitura copiada, sem baixar nem chamar a IA.
 */
async function leituraJaFeita(fileId: string, excetoDocId = 0): Promise<string | null> {
  const [[d]] = await db.query(
    `SELECT content FROM documents WHERE file_url LIKE ? AND id <> ? AND type <> 'ia' AND content IS NOT NULL AND content <> '' ORDER BY id LIMIT 1`,
    [`%${fileId.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, excetoDocId]) as any;
  return d?.content ? String(d.content) : null;
}

/** Lê o arquivo baixado pela IA, uma vez por conteúdo (cópia do mesmo arquivo em outra pasta também vale). */
async function lerArquivoDoDrive(file: { base64: string; mimeType: string }, nome: string): Promise<string | null> {
  const texto = await lerUmaVez(cacheLeiturasMysql, refDoConteudo('drive', file.mimeType, file.base64), nome, async () => {
    const r = await aiLerArquivo(file.base64, file.mimeType, instructionFor(file.mimeType));
    return r.ok && r.text ? r.text : null;
  });
  return texto ? `[${tagFor(file.mimeType)} de "${nome}"]\n${texto}` : null;
}

/** Lê os anexos do caso (que ainda não têm texto) com a IA e salva o conteúdo. */
export async function extractCaseDocuments(caseId: number, progresso?: (feito: number, total: number, nome: string) => void): Promise<number> {
  // Também os do cliente (sem ação), que valem para todas; os repetidos nunca são lidos (31/10/2026).
  const [docs] = await db.query(
    `SELECT id, name, file_url FROM documents
      WHERE (case_id = ? OR (case_id IS NULL AND client_id = (SELECT client_id FROM cases WHERE id = ?)))
        AND duplicado_de IS NULL AND file_url IS NOT NULL AND file_url <> '' AND (content IS NULL OR content = '')
      ORDER BY id ASC LIMIT 20`, [caseId, caseId]
  ) as any;
  let n = 0;
  for (const [i, d] of (docs || []).entries()) {
    try { progresso?.(i, docs.length, d.name); } catch { /* só a barra */ }
    const fid = driveFileId(d.file_url);
    if (!fid) continue;
    let texto = await leituraJaFeita(fid, d.id);
    if (!texto) {
      const file = await downloadDriveFile(fid);
      if (!file || !READABLE(file.mimeType)) continue;
      texto = await lerArquivoDoDrive(file, d.name);
    }
    if (texto) {
      await db.query('UPDATE documents SET content = ? WHERE id = ?', [texto, d.id]);
      n++;
    }
  }
  return n;
}

/**
 * Importa os arquivos de uma PASTA do Drive indicada no caso: baixa, lê com IA
 * e grava como documentos (com conteúdo). Só entra o que o cliente ainda não tem
 * (31/10/2026, caso do Valmirio): mesmo arquivo do Drive ou mesmo conteúdo em qualquer
 * ação dele, ou mesmo nome nesta ação. A pasta usada por mais de uma ação do cliente
 * grava no cliente (vale para todas). Uma leitura por cliente de cada vez: o botão e a
 * leitura automática ao mesmo tempo gravavam o mesmo arquivo duas vezes.
 * Requer o escopo drive.readonly (a advogada reconecta o Google para conceder).
 */
const filaPorCliente = new Map<string, Promise<unknown>>();

export function importDriveFolder(caseId: number, clientId: number | null, folderUrl: string, actorId: number, progresso?: ProgressoPasta): Promise<ResultadoPasta> {
  const chave = clientId ? `cliente:${clientId}` : `caso:${caseId}`;
  const antes = filaPorCliente.get(chave) || Promise.resolve();
  const agora = antes.catch(() => null).then(() => importarPasta(caseId, clientId, folderUrl, actorId, progresso));
  filaPorCliente.set(chave, agora);
  agora.finally(() => { if (filaPorCliente.get(chave) === agora) filaPorCliente.delete(chave); }).catch(() => null);
  return agora;
}

async function importarPasta(caseId: number, clientId: number | null, folderUrl: string, actorId: number, progresso?: ProgressoPasta): Promise<ResultadoPasta> {
  const pastaId = idDaPasta(folderUrl);
  let pastaDoCliente = false;
  if (clientId && pastaId) {
    const [[outra]] = await db.query(
      'SELECT id FROM cases WHERE client_id = ? AND id <> ? AND drive_folder_url LIKE ? LIMIT 1',
      [clientId, caseId, `%${pastaId.replace(/[\\%_]/g, (c) => `\\${c}`)}%`]) as any;
    pastaDoCliente = !!outra;
  }
  const deps: DepsPastaDrive = {
    listarFilhos: listarFilhosDrive,
    jaTem: (id, _nome, f) => clienteJaTem(clientId, id, f),
    vistos: (arquivos) => registrarMd5DoDrive(clientId, caseId, arquivos),
    // Formato não legível (vídeo, planilha...) entra só com o link.
    ler: async (f) => {
      if (!READABLE(f.mimeType)) return null;
      const jaLida = await leituraJaFeita(f.id);
      if (jaLida) return jaLida;
      const file = await downloadDriveFile(f.id);
      if (!file) return null;
      return lerArquivoDoDrive(file, f.name);
    },
    gravar: async (d) => {
      await db.query(
        `INSERT INTO documents (client_id, case_id, name, type, folder, file_url, content, status, created_by, drive_md5)
         VALUES (?, ?, ?, 'anexo', 'processos', ?, ?, 'recebido', ?, ?)`,
        [d.clientId, pastaDoCliente ? null : d.caseId, d.nome, d.link, d.conteudo, d.actorId, d.md5]
      );
    },
  };
  const r = await sincronizarPasta(deps, { caseId, clientId, folderUrl, actorId }, await contaGoogleDoCrm(), progresso);
  // Os repetidos que já estavam (de antes desta regra) ficam marcados e saem da tela, do kit e das leituras.
  if (clientId && !r.erro) await organizarDuplicados(clientId).catch((e) => console.warn('[pasta-drive] repetidos', clientId, e?.message || e));
  return r;
}

/**
 * Leitura automática das pastas (cron): casos em produção, antes do protocolo, com
 * pasta do Drive. Traz só os arquivos novos. Pedido da Jessica (30/10/2026): "os
 * documentos já vêm sozinhos, a não ser que eu inclua algo e peça para atualizar".
 */
export async function sincronizarPastasEmProducao(): Promise<{ casos: number; novos: number; erros: number }> {
  const [casos] = await db.query(
    `SELECT id, client_id, drive_folder_url, user_id FROM cases
      WHERE drive_folder_url IS NOT NULL AND drive_folder_url <> ''
        AND production_stage IS NOT NULL AND production_stage NOT IN ('protocolado', 'concluido', 'recusado')`
  ) as any;
  let novos = 0, erros = 0;
  for (const c of casos) {
    const r = await importDriveFolder(c.id, c.client_id ?? null, c.drive_folder_url, c.user_id || 1)
      .catch((e: any) => ({ novos: [] as string[], erro: String(e?.message || e) }));
    novos += r.novos.length;
    if (r.erro) { erros++; console.warn('[pasta-drive] caso', c.id, r.erro); }
  }
  return { casos: casos.length, novos, erros };
}

/**
 * ANÁLISE-CHECKLIST do caso: importa a pasta do Drive (novos arquivos), lê os
 * documentos com IA e produz um relatório analítico organizado para embasar a
 * petição inicial (checklist + método fato→prova→fundamento→pedido).
 * Reprocessável a qualquer momento pelo botão — cada execução puxa o que há de
 * novo no Drive e refaz a análise. Substitui a análise anterior do caso.
 */
export async function analyzeCaseDrive(
  caseId: number, actorId: number,
  /** Andamento para a barra da tela (30/10/2026). */
  etapa?: (rotulo: string, feito?: number | null, total?: number | null) => void,
): Promise<{ ok: boolean; docId?: number; text?: string; message?: string; imported: number; docsLidos: number; erroDrive?: string }> {
  const [[cf]] = await db.query(
    'SELECT client_id, title, legal_area, description, drive_folder_url FROM cases WHERE id = ?', [caseId]
  ) as any;
  if (!cf) return { ok: false, message: 'Caso não encontrado', imported: 0, docsLidos: 0 };

  // 1) puxa novidades do Drive (dedup por nome) e 2) lê anexos ainda sem texto.
  let imported = 0, erroDrive: string | undefined;
  const marcar = (r: string, f?: number | null, t?: number | null) => { try { etapa?.(r, f, t); } catch { /* só a barra */ } };
  if (cf.drive_folder_url) {
    marcar('Abrindo a pasta do Drive');
    const pasta = await importDriveFolder(caseId, cf.client_id ?? null, cf.drive_folder_url, actorId,
      (feito, total, nome) => marcar(nome ? `Pasta: lendo ${nome} (${feito + 1} de ${total})` : `Pasta: ${total} arquivo(s) encontrados`, feito, total))
      .catch((e: any) => ({ novos: [] as string[], erro: String(e?.message || e) }));
    imported = pasta.novos.length; erroDrive = pasta.erro;
  }
  await extractCaseDocuments(caseId, (feito, total, nome) => marcar(`Lendo o texto de ${nome} (${feito + 1} de ${total})`, feito, total)).catch(() => 0);
  marcar('Montando a análise do caso (checklist) com a IA');

  const clientId = cf.client_id ?? null;
  const [[cl]] = clientId ? await db.query('SELECT name, cpf_cnpj, email, phone, address FROM clients WHERE id = ?', [clientId]) as any : [[null]];
  const [docs] = await db.query(
    `SELECT name, content FROM documents
      WHERE (case_id = ? OR (case_id IS NULL AND ? IS NOT NULL AND client_id = ?)) AND duplicado_de IS NULL
        AND content IS NOT NULL AND content <> '' ORDER BY id ASC LIMIT 30`, [caseId, clientId, clientId]
  ) as any;
  const docsTxt = (docs || []).map((d: any) => `--- ${d.name} ---\n${String(d.content).slice(0, 4000)}`).join('\n\n').slice(0, 28000);
  const relato = cf.description || '';
  const leisTxt = await import('./leisServico')
    .then((m) => m.fundamentosParaPeca(`${cf.title || ''}\n${relato}\n${docsTxt.slice(0, 2500)}`, { area: cf.legal_area, tipo: 'Análise do caso para petição inicial' }, 'a análise do caso'))
    .catch(() => '');

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
${docsTxt || '[Nenhum documento com conteúdo lido — verifique o link da pasta do Drive e as permissões]'}${leisTxt}`;

  const out = await aiComplete(prompt, 'openai');
  if (!out.ok || !out.text) return { ok: false, imported, erroDrive, docsLidos: (docs || []).length, message: out.message || 'A IA não retornou a análise' };

  const name = `Análise do caso (checklist) — ${cl?.name || cf.title || 'Caso'}`;
  await db.query("DELETE FROM documents WHERE case_id = ? AND type = 'ia' AND name LIKE 'Análise do caso (checklist)%'", [caseId]);
  const [r] = await db.query(
    `INSERT INTO documents (client_id, case_id, name, type, folder, content, status, created_by)
     VALUES (?, ?, ?, 'ia', 'processos', ?, 'pendente', ?)`,
    [clientId, caseId, name, out.text, actorId]
  ) as any;
  return { ok: true, docId: r.insertId, text: out.text, imported, erroDrive, docsLidos: (docs || []).length };
}

/**
 * Gera a petição inicial do caso pela esteira dos agentes (esteiraPeca.ts) e
 * salva na produção: primeiro o "Dossiê da peça" (o que foi lido, calculado e
 * por que o modelo foi escolhido) e a "Planilha de cálculos" do Calculista
 * (tabela no CRM + .xlsx para anexar), depois a petição. Casos do mesmo cliente
 * contra a mesma parte contrária saem numa peça só (pecas_conjuntas).
 * Idempotente: sem force, não recria se o caso já tem petição própria ou conjunta.
 */
export async function buildPeticaoInicial(caseId: number, actorId: number, force = false): Promise<{ ok: boolean; docId?: number; version?: number; message?: string; casos?: number[] }> {
  // Pedido unido a outro processo: a peça é do caso principal.
  const [[uniao]] = await db.query('SELECT unido_ao_caso FROM cases WHERE id = ?', [caseId]) as any;
  if (uniao?.unido_ao_caso) caseId = uniao.unido_ao_caso;
  // Versões preservadas (v1, v2, v3…) — nunca sobrescreve, para comparação. Conta
  // também as versões editadas pela Dra. na Mesa do caso ("(v3 · edição da Dra.)").
  const [existing] = await db.query(
    "SELECT id, name FROM documents WHERE case_id = ? AND name LIKE 'Petição Inicial%' ORDER BY id DESC", [caseId]
  ) as any;
  const [[conjunta]] = await db.query(
    'SELECT document_id, case_principal_id FROM pecas_conjuntas WHERE case_id = ? AND case_principal_id <> ? ORDER BY id DESC LIMIT 1', [caseId, caseId]
  ) as any;
  // No gatilho automático (move para "Criação inicial") gera só a 1ª; regeração
  // é sempre por ação manual (force=true), que cria a próxima versão.
  if (!force && existing.length) return { ok: true, docId: existing[0].id, message: 'Petição já existente (use "gerar nova versão" para regerar)' };
  if (!force && conjunta) return { ok: true, docId: conjunta.document_id, message: `Este caso já está na petição inicial conjunta do caso #${conjunta.case_principal_id}` };
  let maxV = 0;
  for (const d of existing) maxV = Math.max(maxV, numeroDaVersao(d.name));
  const version = maxV + 1;

  // Se o caso aponta uma pasta do Drive, importa os arquivos dela antes da leitura.
  const [[cf]] = await db.query('SELECT client_id, drive_folder_url FROM cases WHERE id = ?', [caseId]) as any;
  if (cf?.drive_folder_url) await importDriveFolder(caseId, cf.client_id ?? null, cf.drive_folder_url, actorId).catch(() => 0);

  // A etapa vai para a barra de progresso da tela (só vale com a trava da geração).
  const r = await produzirPeticao(caseId, { ...depsEsteiraMysql, etapa: (e) => travaGeracaoPeca.marcar(caseId, e) });
  travaGeracaoPeca.marcar(caseId, 'salvando');
  if (!r.ok) return { ok: false, message: r.message };
  const clientId = cf?.client_id ?? null;
  const juntos = r.casos.length > 1;

  // Dossiê antes da petição: a revisão automática pega o documento mais recente.
  await db.query(
    `INSERT INTO documents (client_id, case_id, name, type, folder, content, status, created_by)
     VALUES (?, ?, ?, 'ia', 'processos', ?, 'pendente', ?)`,
    [clientId, caseId, `Dossiê da peça — ${r.cliente} (v${version})`, r.dossie, actorId]
  );
  const cab = { cliente: r.cliente, reus: r.ficha.reus.map((x) => x.nome), casos: r.casos };
  // Demonstrativo de descontos: o que foi descontado de cada contrato desta peça e a base do valor da causa (anexo do kit).
  if (r.calculo.descontos.length || r.ficha.contratos.length) {
    const demo = montarDemonstrativo({ calculo: r.calculo, contratos: r.ficha.contratos, fora: r.fora, cab });
    const pdf = await demonstrativoPdf(demo).catch(() => null);
    await db.query(
      `INSERT INTO documents (client_id, case_id, name, type, folder, content, data, mime, status, created_by)
       VALUES (?, ?, ?, 'ia', 'processos', ?, ?, ?, 'pendente', ?)`,
      [clientId, caseId, `Demonstrativo de descontos — ${r.cliente} (v${version})`, demonstrativoMarkdown(demo), pdf, pdf ? 'application/pdf' : null, actorId]
    );
  }
  if (r.calculo.atualizacao) {
    const xlsx = await planilhaXlsx(r.calculo, cab).catch(() => null);
    await db.query(
      `INSERT INTO documents (client_id, case_id, name, type, folder, content, data, mime, status, created_by)
       VALUES (?, ?, ?, 'ia', 'processos', ?, ?, ?, 'pendente', ?)`,
      [clientId, caseId, `Planilha de cálculos — ${r.cliente} (v${version})`, planilhaMarkdown(r.calculo, cab), xlsx, xlsx ? MIME_XLSX : null, actorId]
    );
  }
  const [ins] = await db.query(
    `INSERT INTO documents (client_id, case_id, name, type, folder, content, status, created_by)
     VALUES (?, ?, ?, 'ia', 'processos', ?, 'pendente', ?)`,
    [clientId, caseId, `Petição Inicial${juntos ? ' conjunta' : ''} — ${r.cliente} (v${version})`, r.peticao, actorId]
  ) as any;
  const docId = ins.insertId;

  const faltam = r.conferencia.filter((c) => !c.presente).length;
  const resumo = `Esteira da peça: ${r.fontesLidas.length} fonte(s) lida(s)${r.leituraReaproveitada ? ' (leitura dos documentos reaproveitada de outra peça do cliente, sem nova leitura pela IA)' : ''} · modelo: ${r.escolha.modelos.join(' + ') || 'nenhum do cofre'}`
    + (r.calculo.indebito.total.restituir ? ` · a restituir ${brl(r.calculo.indebito.total.restituir)}` : '')
    + (r.calculo.atualizacao?.dataBase ? ` · atualizado pelo Calculista ${brl(r.calculo.atualizacao.total.total)} (planilha de cálculos)` : '')
    + (r.calculo.valorDaCausa.total ? ` · valor da causa calculado ${brl(r.calculo.valorDaCausa.total)}` : '')
    + (r.conferencia.length ? ` · ${r.conferencia.length - faltam}/${r.conferencia.length} valores conferem na peça` : '')
    + (juntos ? ` · peça conjunta com ${r.casos.filter((c) => c.id !== caseId).map((c) => `#${c.id}`).join(', ')}` : '')
    + '. Detalhes no "Dossiê da peça".';
  const nota = (id: number, texto: string) => db.query(
    `INSERT INTO production_notes (case_id, user_id, author_name, kind, text) VALUES (?, ?, 'Esteira da peça', 'atualizacao', ?)`, [id, actorId, texto]
  ).catch(() => {});
  await nota(caseId, resumo);
  if (juntos) {
    for (const c of r.casos) {
      await db.query('INSERT IGNORE INTO pecas_conjuntas (document_id, case_id, case_principal_id) VALUES (?, ?, ?)', [docId, c.id, caseId]);
      if (c.id !== caseId) await nota(c.id, `Este caso entrou na petição inicial conjunta do caso #${caseId} (mesmo cliente e mesma parte contrária). Não é preciso gerar outra peça: confira no caso #${caseId}.`);
    }
  }
  return { ok: true, docId, version, casos: r.casos.map((c) => c.id) };
}
