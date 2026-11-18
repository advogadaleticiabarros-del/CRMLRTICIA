#!/usr/bin/env node
/**
 * Ponte do escritório → TJES (18/11/2026).
 *
 * Roda no computador do escritório (tarefa do Windows "CRM - ponte do TJES",
 * ao fazer logon). O TJES bloqueia o servidor do CRM, mas aceita a rede do
 * escritório; então este programa:
 *   1. pergunta ao CRM se há consulta ao TJES esperando (espera longa, 25 s);
 *   2. envia cada consulta ao TJES, SÓ para os endereços oficiais abaixo;
 *   3. devolve a resposta ao CRM.
 * Não guarda nada e não registra o conteúdo (que leva o login da Dra.) em log.
 *
 * Configuração (fora do git): %USERPROFILE%\.crm-ponte-escritorio.json
 *   { "servidor": "https://crm.advogadaleticiabarros.com.br", "token": "..." }
 * O token é o mesmo de MNI_PONTE_TOKEN no .env do servidor.
 *
 * Só usa o Node (18+), sem dependências.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Únicos endereços para onde este computador encaminha consultas. */
export const ENDERECOS_PERMITIDOS = [
  'https://pje.tjes.jus.br/pje/intercomunicacao',
  'https://pje.tjes.jus.br/pje2g/intercomunicacao',
];

export function urlPermitida(url) {
  try {
    const u = new URL(url);
    return ENDERECOS_PERMITIDOS.includes(`${u.protocol}//${u.host}${u.pathname}`) && !u.search && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Envia um pedido ao tribunal. Nunca lança: devolve {status, corpo} ou {erro}. */
export async function atenderPedido(pedido, f = fetch, timeoutMs = 85_000) {
  if (!urlPermitida(pedido.url)) return { erro: 'endereço não permitido pela ponte do escritório' };
  const headers = {};
  for (const [k, v] of Object.entries(pedido.cabecalhos || {})) {
    if (/^(content-type|soapaction)$/i.test(k)) headers[k] = String(v);
  }
  try {
    const r = await f(pedido.url, { method: 'POST', headers, body: String(pedido.corpo ?? ''), signal: AbortSignal.timeout(timeoutMs) });
    return { status: r.status, corpo: await r.text() };
  } catch (e) {
    return { erro: String(e?.cause?.code || e?.message || e).slice(0, 200) };
  }
}

// ── Programa ────────────────────────────────────────────────────────────────

const pasta = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'crm-ponte-escritorio');
const arqLog = path.join(pasta, 'ponte.log');
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function log(msg) {
  try {
    fs.mkdirSync(pasta, { recursive: true });
    if (fs.existsSync(arqLog) && fs.statSync(arqLog).size > 1_000_000) fs.renameSync(arqLog, `${arqLog}.1`);
    fs.appendFileSync(arqLog, `${new Date().toISOString()} ${msg}\n`);
  } catch { /* log nunca derruba a ponte */ }
}

function lerConfig() {
  const arq = path.join(os.homedir(), '.crm-ponte-escritorio.json');
  const c = JSON.parse(fs.readFileSync(arq, 'utf8').replace(/^﻿/, ''));
  if (!c.servidor || !c.token) throw new Error(`Configuração incompleta em ${arq}`);
  return { servidor: String(c.servidor).replace(/\/+$/, ''), token: String(c.token) };
}

async function main() {
  const { servidor, token } = lerConfig();
  const auth = { Authorization: `Bearer ${token}` };
  log(`ponte iniciada (${servidor})`);
  let falhasSeguidas = 0;
  for (;;) {
    try {
      const r = await fetch(`${servidor}/api/mni-ponte/pedidos?espera=25`, { headers: auth, signal: AbortSignal.timeout(45_000) });
      if (r.status === 401 || r.status === 403 || r.status === 503) {
        log(`servidor recusou a ponte (HTTP ${r.status}); nova tentativa em 5 min`);
        await dormir(5 * 60_000);
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const pedidos = await r.json();
      if (falhasSeguidas) log('conexão com o CRM restabelecida');
      falhasSeguidas = 0;
      await Promise.all(pedidos.map(async (p) => {
        const resp = await atenderPedido(p);
        log(`pedido ${String(p.id).slice(0, 6)} → ${'erro' in resp ? `erro: ${resp.erro}` : `HTTP ${resp.status}`}`);
        await fetch(`${servidor}/api/mni-ponte/respostas/${encodeURIComponent(p.id)}`, {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify(resp),
          signal: AbortSignal.timeout(60_000),
        }).catch((e) => log(`não consegui devolver a resposta: ${e?.message || e}`));
      }));
    } catch (e) {
      falhasSeguidas++;
      if (falhasSeguidas === 1 || falhasSeguidas % 20 === 0) log(`sem contato com o CRM (${e?.cause?.code || e?.message || e}); tentando de novo`);
      await dormir(Math.min(60_000, 5_000 * falhasSeguidas));
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { log(`ponte parou: ${e?.message || e}`); process.exit(1); });
}
