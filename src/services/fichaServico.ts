import { db } from '../config/database';
import { aiComplete, aiLerArquivo } from './aiAssistant';
import { registrarAcaoAgente } from './usoIa';
import { COMANDANTES_PADRAO, parseNumerosComandantes } from './assistenteRegras';
import { PROMPT_EXTRACAO, parseExtracao, mesclarExtracoes, type Extracao } from './extracaoDocumentos';
import {
  CAMPOS_FICHA, extrairDoTexto, promptFichaConversa, parseFichaConversa, juntarSugestoes, decidir, resumoFicha, documentoDoContato, removerDadosDoEscritorio,
  type CampoFicha, type SugestaoFicha,
} from './fichaAutomatica';

/**
 * Ficha automática com banco, IA e leitura de arquivos (regras em fichaAutomatica.ts).
 * Chamada: a cada mensagem nova do contato (espera 2 min para juntar) e pela
 * rotina ficha:completar (meia em meia hora), que também completa as fichas antigas.
 * Lê fotos e PDFs com aiLerArquivo (Gemini e, sem cota, OpenAI com visão).
 */

const fim8 = (p: string | null | undefined) => String(p || '').replace(/\D/g, '').slice(-8);
const MAX_ARQUIVOS = 10;
const MAX_BYTES = 8 * 1024 * 1024;

const COL_LEAD: Record<CampoFicha, string> = {
  nome: 'name', cpf: 'cpf_cnpj', rg: 'rg', data_nascimento: 'birth_date', email: 'email', estado_civil: 'marital_status', profissao: 'profession',
  cep: 'cep', street: 'street', number: 'number', neighborhood: 'neighborhood', city: 'city', state: 'state',
};
const CAMPOS_CLIENTE: CampoFicha[] = ['nome', 'cpf', 'email', 'data_nascimento'];
const COL_CLIENTE: Partial<Record<CampoFicha, string>> = { nome: 'name', cpf: 'cpf_cnpj', email: 'email', data_nascimento: 'birth_date' };

const espera = new Map<string, NodeJS.Timeout>();
export function agendarFicha(phone: string): void {
  if (process.env.FICHA_DESLIGADA === '1') return;
  const k = fim8(phone);
  if (k.length < 8) return;
  const t = espera.get(k);
  if (t) clearTimeout(t);
  espera.set(k, setTimeout(() => {
    espera.delete(k);
    completarFicha(phone).catch((e) => console.error('[ficha] falhou:', e?.message || e));
  }, 120_000));
}

const iso = (v: any) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : '');

async function alvosDoTelefone(phone: string) {
  const k = fim8(phone);
  const [[lead]] = await db.query(
    `SELECT * FROM leads WHERE RIGHT(REGEXP_REPLACE(COALESCE(phone,''), '[^0-9]', ''), 8) = ? AND status <> 'newsletter' ORDER BY id DESC LIMIT 1`, [k]) as any;
  const [[cliente]] = await db.query(
    `SELECT id, name, cpf_cnpj, email, birth_date, address FROM clients WHERE RIGHT(REGEXP_REPLACE(COALESCE(phone,''), '[^0-9]', ''), 8) = ? ORDER BY id DESC LIMIT 1`, [k]) as any;
  return { lead: lead || null, cliente: cliente || null };
}

function atualDoLead(l: any): Partial<Record<CampoFicha, string>> {
  const out: Partial<Record<CampoFicha, string>> = {};
  for (const c of CAMPOS_FICHA) out[c] = c === 'data_nascimento' ? iso(l[COL_LEAD[c]]) : String(l[COL_LEAD[c]] ?? '');
  return out;
}
function atualDoCliente(c: any): Partial<Record<CampoFicha, string>> {
  return { nome: c.name || '', cpf: c.cpf_cnpj || '', email: c.email || '', data_nascimento: iso(c.birth_date) };
}
const faltaAlgo = (atual: Partial<Record<CampoFicha, string>>, campos: readonly CampoFicha[]) => campos.some((c) => !String(atual[c] ?? '').trim());

/** Lê um arquivo uma vez só (cache em documento_leituras com ref "ficha:…"). */
async function lerArquivo(ref: string, fonte: string, mime: string, carregar: () => Promise<Buffer | null>, tam: number): Promise<Extracao | null> {
  const [[c]] = await db.query('SELECT leitura FROM documento_leituras WHERE ref = ?', [ref]) as any;
  if (c) return typeof c.leitura === 'string' ? JSON.parse(c.leitura) : c.leitura;
  if (tam > MAX_BYTES) return null;
  const buf = await carregar();
  if (!buf) return null;
  const r = await aiLerArquivo(buf.toString('base64'), mime, PROMPT_EXTRACAO);
  const e = r.ok && r.text ? parseExtracao(r.text) : null;
  if (e) await db.query('INSERT IGNORE INTO documento_leituras (ref, fonte, leitura) VALUES (?, ?, ?)', [ref, fonte.slice(0, 255), JSON.stringify(e)]);
  return e;
}

async function lerDocumentos(phone: string, clienteId: number | null) {
  const k = fim8(phone);
  const lidas: { fonte: string; r: Extracao | null }[] = [];
  // Só o que o CLIENTE mandou: contrato, procuração e proposta enviados pelo
  // escritório têm os dados da Dra. e não podem virar a ficha do cliente.
  const [midias] = await db.query(
    `SELECT wm.id, wm.file_name, wm.mime, LENGTH(wm.data) AS tam FROM whatsapp_media wm
      WHERE RIGHT(REGEXP_REPLACE(wm.phone, '[^0-9]', ''), 8) = ? AND (wm.mime LIKE 'image/%' OR wm.mime = 'application/pdf')
        AND NOT EXISTS (SELECT 1 FROM whatsapp_messages w WHERE w.media_id = wm.id AND w.from_me = 1)
      ORDER BY wm.created_at DESC LIMIT ?`, [k, MAX_ARQUIVOS]) as any;
  for (const m of midias) {
    const fonte = m.file_name || `arquivo ${m.id}`;
    const r = await lerArquivo(`ficha:media:${m.id}`, fonte, m.mime, async () => {
      const [[x]] = await db.query('SELECT data FROM whatsapp_media WHERE id = ?', [m.id]) as any; return x?.data ? Buffer.from(x.data) : null;
    }, Number(m.tam) || 0).catch(() => null);
    if (r) lidas.push({ fonte, r });
  }
  if (clienteId) {
    const [docs] = await db.query(
      `SELECT id, name, mime, LENGTH(data) AS tam FROM documents WHERE client_id = ? AND data IS NOT NULL AND (mime LIKE 'image/%' OR mime = 'application/pdf')
        ORDER BY created_at DESC LIMIT ?`, [clienteId, MAX_ARQUIVOS]).catch(() => [[]]) as any;
    for (const d of docs) {
      const fonte = d.name || `documento ${d.id}`;
      const r = await lerArquivo(`ficha:doc:${d.id}`, fonte, d.mime, async () => {
        const [[x]] = await db.query('SELECT data FROM documents WHERE id = ?', [d.id]) as any; return x?.data ? Buffer.from(x.data) : null;
      }, Number(d.tam) || 0).catch(() => null);
      if (r) lidas.push({ fonte, r });
    }
  }
  return lidas;
}

async function ehComandanteOuParceiro(phone: string): Promise<boolean> {
  const [[r]] = await db.query("SELECT setting_value FROM office_settings WHERE setting_key = 'assistente_whatsapp_numeros'").catch(() => [[null]]) as any;
  if (parseNumerosComandantes(r?.setting_value || COMANDANTES_PADRAO).some((c) => fim8(c) === fim8(phone))) return true;
  const [[meta]] = await db.query('SELECT labels FROM whatsapp_chat_meta WHERE RIGHT(REGEXP_REPLACE(phone, \'[^0-9]\', \'\'), 8) = ? LIMIT 1', [fim8(phone)]).catch(() => [[null]]) as any;
  return String(meta?.labels || '').includes('Parceiro');
}

async function gravarPendencias(phone: string, alvo: 'lead' | 'client', alvoId: number, nome: string, pend: ReturnType<typeof decidir>['pendencias']) {
  let novas = 0;
  for (const p of pend) {
    const [r] = await db.query(
      `INSERT IGNORE INTO ficha_pendencias (phone, alvo, alvo_id, nome, campo, valor_atual, sugerido, fontes, motivo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [phone, alvo, alvoId, nome?.slice(0, 255) || null, p.campo, p.atual ? String(p.atual).slice(0, 255) : null, String(p.sugerido).slice(0, 255), p.fontes.join(', ').slice(0, 500), p.motivo.slice(0, 200)]) as any;
    novas += r.affectedRows;
  }
  return novas;
}

/** Lê o que o contato mandou e completa a ficha do lead e/ou do cliente. */
export async function completarFicha(phone: string, opts: { forcar?: boolean; simular?: boolean } = {}): Promise<any> {
  if (await ehComandanteOuParceiro(phone)) return { ok: false, motivo: 'comandante ou parceiro' };
  const { lead, cliente } = await alvosDoTelefone(phone);
  if (!lead && !cliente) return { ok: false, motivo: 'contato sem ficha' };

  const atualLead = lead ? atualDoLead(lead) : null;
  const atualCliente = cliente ? atualDoCliente(cliente) : null;
  const precisa = (atualLead && faltaAlgo(atualLead, CAMPOS_FICHA)) || (atualCliente && (faltaAlgo(atualCliente, CAMPOS_CLIENTE) || !String(cliente.address || '').trim()));
  if (!precisa && !opts.forcar) return { ok: true, motivo: 'ficha completa' };

  const [msgs] = await db.query(
    `SELECT body, msg_time FROM whatsapp_messages WHERE RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 8) = ? AND from_me = 0 AND body <> ''
      ORDER BY msg_time DESC LIMIT 80`, [fim8(phone)]) as any;
  const textos = [...msgs].reverse().map((m: any) => String(m.body));
  const textoTodo = textos.join('\n');

  // Documento de terceiro (RG do marido, certidão do filho) fica de fora.
  const nomeContato = cliente?.name || lead?.name || null;
  const docs = (await lerDocumentos(phone, cliente?.id ?? null)).filter((d) => documentoDoContato(nomeContato, d.r?.campos?.nome?.valor));
  let conversa = {};
  if (textos.length) {
    const r = await aiComplete(promptFichaConversa(textos), 'openai');
    if (r.ok && r.text) conversa = parseFichaConversa(r.text);
  }
  // O que o escritório escreveu na conversa (chave Pix da Dra., e-mail do escritório…) não é do cliente.
  const [doEscritorio] = await db.query(
    `SELECT body FROM whatsapp_messages WHERE RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 8) = ? AND from_me = 1 AND body <> '' ORDER BY msg_time DESC LIMIT 200`,
    [fim8(phone)]) as any;
  const sugestoes = removerDadosDoEscritorio(
    juntarSugestoes(mesclarExtracoes(docs), conversa, extrairDoTexto(textoTodo)),
    doEscritorio.map((m: any) => String(m.body)).join('\n'));

  // Simulação: mostra o que faria, sem gravar nada (para conferir a leitura com dados reais).
  if (opts.simular) {
    return {
      ok: true, simulacao: true, documentosLidos: docs.length, mensagens: textos.length,
      lead: lead && atualLead ? decidir(atualLead, sugestoes, CAMPOS_FICHA) : null,
      cliente: cliente && atualCliente ? { ...decidir(atualCliente, sugestoes, CAMPOS_CLIENTE), endereco: !String(cliente.address || '').trim() ? montarEndereco(sugestoes) : null } : null,
    };
  }

  const gravados: CampoFicha[] = [];
  let pendNovas = 0;
  let nome = lead?.name || cliente?.name || `+${phone}`;

  if (lead && atualLead) {
    const { gravar, pendencias } = decidir(atualLead, sugestoes, CAMPOS_FICHA);
    const sets: string[] = []; const params: any[] = [];
    for (const [c, v] of Object.entries(gravar) as [CampoFicha, string][]) {
      const col = COL_LEAD[c];
      // Nome troca só se ainda for o mesmo de quando lemos; o resto só preenche vazio.
      if (c === 'nome') { sets.push('name = IF(name = ?, ?, name)'); params.push(lead.name, v); }
      else { sets.push(`${col} = COALESCE(NULLIF(${col}, ''), ?)`); params.push(v); }
      gravados.push(c);
    }
    if (sets.length) { params.push(lead.id); await db.query(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`, params); }
    if (gravar.nome) nome = gravar.nome;
    pendNovas += await gravarPendencias(phone, 'lead', lead.id, nome, pendencias);
    // Aviso antigo, mantido: lead em "documentação pendente" com nome e CPF = dá para montar a proposta.
    if (lead.status === 'documentacao_pendente' && gravar.cpf) {
      const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
      for (const a of admins) {
        await db.query(`INSERT INTO notifications (user_id, title, message, notification_type, channel, scheduled_at, status) VALUES (?, ?, ?, 'lead_dados_recebidos', 'sistema', NOW(), 'pendente')`,
          [a.id, 'Dados recebidos para a proposta', `${nome} enviou os dados (CPF, endereço etc.): já dá para montar a proposta.`]).catch(() => {});
      }
    }
  }

  if (cliente && atualCliente) {
    const { gravar, pendencias } = decidir(atualCliente, sugestoes, CAMPOS_CLIENTE);
    const sets: string[] = []; const params: any[] = [];
    for (const [c, v] of Object.entries(gravar) as [CampoFicha, string][]) {
      const col = COL_CLIENTE[c]!;
      if (c === 'nome') { sets.push('name = IF(name = ?, ?, name)'); params.push(cliente.name, v); }
      else { sets.push(`${col} = COALESCE(NULLIF(${col}, ''), ?)`); params.push(v); }
      if (!gravados.includes(c)) gravados.push(c);
    }
    // Endereço do cliente é uma linha só: monta quando estiver vazio e a leitura for segura.
    const endereco = montarEndereco(sugestoes);
    if (!String(cliente.address || '').trim() && endereco) { sets.push("address = COALESCE(NULLIF(address, ''), ?)"); params.push(endereco); if (!gravados.includes('street')) gravados.push('street'); }
    if (sets.length) { params.push(cliente.id); await db.query(`UPDATE clients SET ${sets.join(', ')} WHERE id = ?`, params); }
    pendNovas += await gravarPendencias(phone, 'client', cliente.id, cliente.name, pendencias);
  }

  await db.query('INSERT INTO ficha_varredura (phone_fim8, ultima_msg) VALUES (?, ?) ON DUPLICATE KEY UPDATE ultima_msg = VALUES(ultima_msg)',
    [fim8(phone), msgs[0]?.msg_time ?? null]).catch(() => {});

  if (gravados.length || pendNovas) {
    const texto = resumoFicha(nome, gravados, pendNovas ? (await pendenciasAbertas(phone)).map((p: any) => ({ campo: p.campo, atual: p.valor_atual, sugerido: p.sugerido, fontes: [], motivo: p.motivo })) : []);
    const [equipe] = await db.query("SELECT id FROM users WHERE role IN ('admin','advogado','staff') AND active = 1").catch(() => [[]]) as any;
    for (const u of equipe) {
      await db.query(`INSERT INTO notifications (user_id, client_id, title, message, notification_type, channel, scheduled_at, status) VALUES (?, ?, ?, ?, 'ficha_automatica', 'sistema', NOW(), 'pendente')`,
        [u.id, cliente?.id ?? null, gravados.length ? `📇 Ficha de ${nome} completada` : `📇 Ficha de ${nome}: conferir`, texto.replace(/\*/g, '')]).catch(() => {});
    }
    if (gravados.length) registrarAcaoAgente('coletor', `completou a ficha de ${nome} com o que ele(a) mandou: ${gravados.join(', ')}`);
  }
  return { ok: true, gravados, pendencias: pendNovas, documentosLidos: docs.length };
}

function montarEndereco(s: Partial<Record<CampoFicha, SugestaoFicha>>): string | null {
  const ok = (c: CampoFicha) => (s[c] && s[c]!.confianca === 'alta' ? s[c]!.valor : '');
  if (!ok('street') || !ok('city')) return null;
  return [[ok('street'), ok('number')].filter(Boolean).join(', '), ok('neighborhood'), [ok('city'), ok('state')].filter(Boolean).join('/'), ok('cep') ? `CEP ${ok('cep')}` : '']
    .filter(Boolean).join(' - ').slice(0, 500);
}

async function pendenciasAbertas(phone: string) {
  const [rows] = await db.query("SELECT * FROM ficha_pendencias WHERE RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 8) = ? AND status = 'pendente'", [fim8(phone)]) as any;
  return rows;
}

/**
 * Rotina de meia em meia hora: contatos com mensagem nova desde a última leitura
 * (ou nunca lidos, dos últimos 90 dias) cuja ficha ainda tem buraco.
 */
export async function varrerFichas(limite = 12) {
  const [rows] = await db.query(
    `SELECT RIGHT(REGEXP_REPLACE(w.phone, '[^0-9]', ''), 8) AS k, MAX(w.phone) AS phone, MAX(w.msg_time) AS ultima
       FROM whatsapp_messages w
      WHERE w.from_me = 0 AND w.msg_time >= NOW() - INTERVAL 90 DAY
      GROUP BY k
     HAVING ultima > COALESCE((SELECT v.ultima_msg FROM ficha_varredura v WHERE v.phone_fim8 = k), '1970-01-01')
      ORDER BY ultima DESC LIMIT 200`) as any;
  let feitas = 0, preenchidas = 0;
  for (const r of rows) {
    if (feitas >= limite) break;
    const res: any = await completarFicha(r.phone).catch(() => null);
    // Contato sem ficha ou já completo: só marca como visto (não conta no limite).
    if (!res || res.motivo) {
      await db.query('INSERT INTO ficha_varredura (phone_fim8, ultima_msg) VALUES (?, ?) ON DUPLICATE KEY UPDATE ultima_msg = VALUES(ultima_msg)', [r.k, r.ultima]).catch(() => {});
      continue;
    }
    feitas++;
    if (res.gravados?.length) preenchidas++;
  }
  return { lidas: feitas, fichasPreenchidas: preenchidas };
}

export async function listarPendencias() {
  const [rows] = await db.query("SELECT * FROM ficha_pendencias WHERE status = 'pendente' ORDER BY created_at DESC LIMIT 100") as any;
  return rows;
}

/** A equipe confirma uma pendência: grava o valor sugerido (sobrescreve, porque foi decisão humana). */
export async function decidirPendencia(id: number, acao: 'aplicar' | 'ignorar', quem: string) {
  const [[p]] = await db.query('SELECT * FROM ficha_pendencias WHERE id = ?', [id]) as any;
  if (!p) return { ok: false, erro: 'Pendência não encontrada' };
  if (p.status !== 'pendente') return { ok: false, erro: `Já está como "${p.status}".` };
  if (acao === 'aplicar') {
    const col = p.alvo === 'lead' ? COL_LEAD[p.campo as CampoFicha] : COL_CLIENTE[p.campo as CampoFicha];
    if (!col) return { ok: false, erro: 'Campo não existe nesta ficha' };
    await db.query(`UPDATE ${p.alvo === 'lead' ? 'leads' : 'clients'} SET ${col} = ? WHERE id = ?`, [p.sugerido, p.alvo_id]);
  }
  await db.query('UPDATE ficha_pendencias SET status = ?, decidido_por = ? WHERE id = ?', [acao === 'aplicar' ? 'aplicada' : 'ignorada', quem, id]);
  return { ok: true };
}
