#!/usr/bin/env node
/**
 * Ponte do Obsidian (25/11/2026).
 *
 * Roda no computador do escritório (tarefa do Windows "CRM - ponte do
 * Obsidian", ao fazer logon, sem janela) e mantém o cofre e o CRM em dia
 * sozinha, sem botão nem comando:
 *
 *   cofre → CRM
 *     - toda nota .md vai para o Cérebro (só o que mudou; nota apagada sai);
 *     - toda ficha em ".../Fichas/*.md" (com o .docx citado em "arquivo:")
 *       vai para a biblioteca de modelos de peça.
 *   CRM → cofre
 *     - Clientes/: uma nota por cliente, com os anexos (a pasta é do CRM);
 *     - Documentação Técnica/, Escritório Virtual.md e Mapa do cofre.md.
 *
 * Quando: ao ligar, 30 s depois de qualquer mudança no cofre e a cada 10 min.
 * Cada pasta tem um único dono: o CRM nunca escreve fora das pastas acima
 * (escritaPermitida) e nunca fora do cofre (caminhoDentro).
 * O log só registra contagens, nunca o conteúdo das notas.
 *
 * Configuração (fora do git): %USERPROFILE%\.crm-ponte-obsidian.json
 *   { "servidor": "https://crm.advogadaleticiabarros.com.br", "token": "...", "cofre": "C:\\...\\CRMLeticia" }
 * O token é o mesmo de OBSIDIAN_PONTE_TOKEN no .env do servidor.
 * Só usa o Node (18+), sem dependências.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const VERSAO = '1.0.0';

// ── Regras (testadas em tests/obsidianPonte.test.mjs) ───────────────────────

/** Caminho absoluto de `rel` dentro de `base`, ou null se sair dela. */
export function caminhoDentro(base, rel) {
  const r = String(rel || '');
  if (!r || path.isAbsolute(r) || /^[a-z]:/i.test(r) || r.startsWith('/') || r.startsWith('\\')) return null;
  const raiz = path.resolve(base);
  const alvo = path.resolve(raiz, r);
  return alvo.startsWith(raiz + path.sep) ? alvo : null;
}

const semSubida = (rel) => !String(rel).split('/').some((p) => p === '..' || p === '.' || p === '');

/** Onde o CRM pode escrever no cofre. Todo o resto é da Dra. */
export function escritaPermitida(rel) {
  const r = String(rel || '');
  if (!semSubida(r)) return false;
  return /^Clientes\/[^/]+\/[^/]+\.md$/.test(r)
    || /^Clientes\/[^/]+\/anexos\/[^/]+$/.test(r)
    || /^Documentação Técnica\/[^/]+\.md$/.test(r)
    || r === 'Escritório Virtual.md'
    || r === 'Mapa do cofre.md';
}

export function ehNota(rel) {
  const r = String(rel || '');
  return /\.md$/i.test(r) && !r.split('/').some((p) => p.startsWith('.'));
}

export function ehFicha(rel) {
  return ehNota(rel) && /(^|\/)Fichas\/[^/]+\.md$/i.test(rel);
}

/** Não apaga notas do Cérebro se o cofre "encolheu" de repente (pasta fora do ar, disco desconectado). */
export function podeApagarAusentes(antes, agora) {
  if (!agora) return false;
  if (antes < 20) return true;
  return agora >= antes * 0.5;
}

/**
 * O que fazer em Clientes/. `indice` vem do CRM; `locais` mapeia cada arquivo
 * de Clientes/ no computador ao texto (.md) ou null (anexos).
 */
export function planoClientes(indice, locais) {
  const notas = (indice || []).filter((n) => n && n.caminho.startsWith('Clientes/') && escritaPermitida(n.caminho));
  const anexos = notas.flatMap((n) => (n.anexos || []).filter((a) => a.caminho.startsWith('Clientes/') && escritaPermitida(a.caminho)));
  const escrever = notas.filter((n) => locais.get(n.caminho) !== n.texto).map((n) => ({ caminho: n.caminho, texto: n.texto }));
  const baixar = anexos.filter((a) => !locais.has(a.caminho)).map((a) => ({ id: a.id, caminho: a.caminho }));
  if (!notas.length) return { escrever, baixar, apagar: [] };
  const manter = new Set([...notas.map((n) => n.caminho), ...anexos.map((a) => a.caminho)]);
  const apagar = [...locais.keys()].filter((c) => c.startsWith('Clientes/') && !manter.has(c));
  return { escrever, baixar, apagar };
}

/** Frontmatter da ficha (mesmo formato do importador do navegador). */
export function lerFrontmatter(md) {
  const m = String(md || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  let ultima = null;
  for (const linha of m[1].split(/\r?\n/)) {
    const item = linha.match(/^\s+-\s*(.*)$/);
    if (item && ultima) {
      const v = item[1].trim().replace(/^["']|["']$/g, '').replace(/^\[\[|\]\]$/g, '');
      if (v) { if (!Array.isArray(out[ultima])) out[ultima] = []; out[ultima].push(v); }
      continue;
    }
    const kv = linha.match(/^([a-z_]+):\s*(.*)$/i);
    if (!kv) { ultima = null; continue; }
    ultima = kv[2].trim() ? null : kv[1].toLowerCase();
    let v = kv[2].trim();
    if (v.startsWith('[') && v.endsWith(']') && !v.startsWith('[[')) {
      v = v.slice(1, -1).split(',').map((x) => x.trim().replace(/^["'[]+|["'\]]+$/g, '')).filter(Boolean);
    } else {
      v = v.replace(/^["']|["']$/g, '');
    }
    out[kv[1].toLowerCase()] = v;
  }
  return out;
}

/** Todos os arquivos do cofre (caminho relativo com "/"), sem pastas e arquivos ocultos. */
export function listarArquivos(base, rel = '') {
  const out = [];
  let itens = [];
  try { itens = fs.readdirSync(path.join(base, rel), { withFileTypes: true }); } catch { return out; }
  for (const it of itens) {
    if (it.name.startsWith('.')) continue;
    const r = rel ? `${rel}/${it.name}` : it.name;
    if (it.isDirectory()) out.push(...listarArquivos(base, r));
    else if (it.isFile()) out.push(r);
  }
  return out;
}

// ── Programa ────────────────────────────────────────────────────────────────

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const PASTA = path.join(process.env.LOCALAPPDATA || os.homedir(), 'crm-ponte-obsidian');
const LOG = path.join(PASTA, 'ponte.log');
const ESTADO = path.join(PASTA, 'estado.json');

function log(msg) {
  const linha = `${new Date().toISOString()} ${msg}\n`;
  try {
    fs.mkdirSync(PASTA, { recursive: true });
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 1_000_000) fs.renameSync(LOG, `${LOG}.1`);
    fs.appendFileSync(LOG, linha);
  } catch { /* log não pode derrubar a ponte */ }
  if (process.stdout.isTTY) process.stdout.write(linha);
}

function lerJson(arq, padrao) { try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return padrao; } }
function gravarJson(arq, v) { fs.mkdirSync(path.dirname(arq), { recursive: true }); fs.writeFileSync(arq, JSON.stringify(v)); }

function criarApi(cfg) {
  const base = String(cfg.servidor).replace(/\/+$/, '') + '/api/obsidian-ponte';
  return async function api(rota, { metodo = 'GET', corpo, binario = false } = {}) {
    const r = await fetch(base + rota, {
      method: metodo,
      headers: { Authorization: `Bearer ${cfg.token}`, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) throw new Error(`CRM respondeu ${r.status} em ${rota}`);
    return binario ? Buffer.from(await r.arrayBuffer()) : r.json();
  };
}

function escreverNoCofre(cofre, rel, conteudo) {
  if (!escritaPermitida(rel)) return false;
  const alvo = caminhoDentro(cofre, rel);
  if (!alvo) return false;
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  const tmp = `${alvo}.ponte-tmp`;
  fs.writeFileSync(tmp, conteudo);
  fs.renameSync(tmp, alvo);
  return true;
}

/** CRM → cofre: Clientes/, manual, ficha do Escritório Virtual e Mapa do cofre. */
async function trazerDoCrm(cfg, api) {
  const cofre = cfg.cofre;
  const { notas } = await api('/clientes');
  const locais = new Map();
  for (const rel of listarArquivos(cofre, 'Clientes')) {
    if (rel.endsWith('.ponte-tmp')) continue;
    locais.set(rel, /\.md$/i.test(rel) ? fs.readFileSync(path.join(cofre, rel), 'utf8') : null);
  }
  const plano = planoClientes(notas, locais);
  let escritas = 0, baixados = 0, apagados = 0;
  for (const n of plano.escrever) if (escreverNoCofre(cofre, n.caminho, n.texto)) escritas++;
  for (const a of plano.baixar) {
    try { if (escreverNoCofre(cofre, a.caminho, await api(`/anexos/${a.id}`, { binario: true }))) baixados++; }
    catch (e) { log(`anexo ${a.id} não baixou: ${e.message}`); }
  }
  for (const rel of plano.apagar) {
    const alvo = caminhoDentro(cofre, rel);
    if (alvo && rel.startsWith('Clientes/')) { try { fs.rmSync(alvo); apagados++; } catch { /* já saiu */ } }
  }
  removerPastasVazias(path.join(cofre, 'Clientes'));

  const { arquivos } = await api('/espelho');
  let espelho = 0;
  for (const a of arquivos || []) {
    const alvo = caminhoDentro(cofre, a.caminho);
    if (!alvo || !escritaPermitida(a.caminho)) continue;
    let atual = null; try { atual = fs.readFileSync(alvo, 'utf8'); } catch { /* novo */ }
    if (atual !== a.texto && escreverNoCofre(cofre, a.caminho, a.texto)) espelho++;
  }
  return { clientes: notas.length, escritas, baixados, apagados, espelho };
}

function removerPastasVazias(dir) {
  let itens = [];
  try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const it of itens) if (it.isDirectory()) {
    const sub = path.join(dir, it.name);
    removerPastasVazias(sub);
    try { if (!fs.readdirSync(sub).length) fs.rmdirSync(sub); } catch { /* em uso */ }
  }
}

/** cofre → CRM: Cérebro (todas as notas) e biblioteca de modelos (fichas). */
async function levarAoCrm(cfg, api) {
  const cofre = cfg.cofre;
  if (!fs.existsSync(cofre)) throw new Error('pasta do cofre não encontrada');
  const estado = lerJson(ESTADO, { notas: {}, modelos: {}, totalNotas: 0 });
  const notas = listarArquivos(cofre).filter(ehNota);

  // Cérebro: só o que mudou, em lotes de até ~4 MB.
  let lote = [], tamanho = 0, enviadas = 0;
  const enviar = async () => {
    if (!lote.length) return;
    await api('/notas', { metodo: 'POST', corpo: { notas: lote.map(({ caminho, texto }) => ({ caminho, texto })) } });
    for (const n of lote) estado.notas[n.caminho] = n.hash;
    enviadas += lote.length; lote = []; tamanho = 0;
    gravarJson(ESTADO, estado);
  };
  const textos = new Map();
  for (const rel of notas) {
    let texto; try { texto = fs.readFileSync(path.join(cofre, rel), 'utf8'); } catch { continue; }
    textos.set(rel, texto);
    const hash = sha(texto);
    if (estado.notas[rel] === hash) continue;
    lote.push({ caminho: rel, texto, hash }); tamanho += texto.length;
    if (lote.length >= 40 || tamanho > 4_000_000) await enviar();
  }
  await enviar();

  const saiu = Object.keys(estado.notas).some((c) => !textos.has(c));
  let removidas = 0;
  if (saiu) {
    if (podeApagarAusentes(estado.totalNotas || 0, notas.length)) {
      const r = await api('/notas/concluir', { metodo: 'POST', corpo: { caminhos: notas } });
      removidas = r.apagadas || 0;
      for (const c of Object.keys(estado.notas)) if (!textos.has(c)) delete estado.notas[c];
    } else {
      log(`o cofre caiu de ${estado.totalNotas} para ${notas.length} notas de uma vez: nada foi apagado do Cérebro`);
    }
  }
  estado.totalNotas = notas.length;
  gravarJson(ESTADO, estado);

  // Modelos de peça: ficha + .docx citado em "arquivo:".
  let modelos = 0, falhas = 0;
  for (const rel of notas.filter(ehFicha)) {
    const texto = textos.get(rel) || '';
    const fm = lerFrontmatter(texto);
    const pastaCofre = rel.slice(0, rel.lastIndexOf('/Fichas/'));
    const docxNome = String(fm.arquivo || '').replace(/[[\]"]/g, '').trim();
    const docxRel = docxNome ? (pastaCofre ? `${pastaCofre}/${docxNome}` : docxNome) : '';
    const docxAbs = docxRel ? caminhoDentro(cofre, docxRel) : null;
    let st = null; try { st = docxAbs ? fs.statSync(docxAbs) : null; } catch { /* sem docx */ }
    const assinatura = sha(`${texto}|${st ? `${st.size}:${st.mtimeMs}` : '-'}`);
    if (estado.modelos[rel] === assinatura) continue;
    const titulo = rel.slice(rel.lastIndexOf('/') + 1).replace(/\.md$/i, '');
    try {
      await api('/modelos', { metodo: 'POST', corpo: {
        external_key: titulo, titulo, area: fm.area || null, assunto: fm.assunto || null, tipo: fm.tipo || null,
        rito: fm.rito || null, teses: fm.teses || null, fundamentos: fm.fundamentos || null,
        docx_base64: st ? fs.readFileSync(docxAbs).toString('base64') : null,
      } });
      estado.modelos[rel] = assinatura; modelos++;
      gravarJson(ESTADO, estado);
    } catch (e) { falhas++; log(`modelo "${titulo}" não subiu: ${e.message}`); }
  }
  return { notas: notas.length, enviadas, removidas, modelos, falhasModelos: falhas };
}

async function principal() {
  const cfgArq = path.join(os.homedir(), '.crm-ponte-obsidian.json');
  const cfg = lerJson(cfgArq, null);
  if (!cfg?.servidor || !cfg?.token || !cfg?.cofre) { log(`falta a configuração em ${cfgArq}`); process.exit(1); }
  const api = criarApi(cfg);
  log(`ponte do Obsidian ${VERSAO} iniciada`);

  let rodando = false, deNovo = false, ultimoErro = null, ultimo = {};
  async function ciclo(motivo) {
    if (rodando) { deNovo = true; return; }
    rodando = true;
    try {
      const crm = await trazerDoCrm(cfg, api);
      const cofre = await levarAoCrm(cfg, api);
      ultimo = { ...crm, ...cofre }; ultimoErro = null;
      log(`${motivo}: ${JSON.stringify(ultimo)}`);
    } catch (e) {
      ultimoErro = String(e.message || e).slice(0, 300);
      log(`${motivo}: falhou (${ultimoErro}); tenta de novo no próximo ciclo`);
    }
    try { await api('/sinal', { metodo: 'POST', corpo: { versao: VERSAO, resumo: ultimo, erro: ultimoErro } }); } catch { /* sem conexão */ }
    rodando = false;
    if (deNovo) { deNovo = false; setTimeout(() => ciclo('mudança no cofre'), 1000); }
  }

  let espera = null;
  try {
    fs.watch(cfg.cofre, { recursive: true }, (_ev, nome) => {
      const rel = String(nome || '').replace(/\\/g, '/');
      if (!rel || rel.split('/').some((p) => p.startsWith('.')) || rel.endsWith('.ponte-tmp')) return;
      clearTimeout(espera);
      espera = setTimeout(() => ciclo('mudança no cofre'), 30_000);
    });
  } catch (e) { log(`não consegui vigiar o cofre (${e.message}); sigo só com o ciclo de 10 min`); }

  await ciclo('início');
  setInterval(() => ciclo('ciclo de 10 min'), 10 * 60_000);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) principal();
