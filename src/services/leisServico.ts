import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { abrirAcervo, type Acervo } from './leisAcervo';
import { pastasLeis } from './leisSync';
import { criarPesquisa, type ContextoPeca } from './leisPesquisa';
import { registrarAcaoAgente } from './usoIa';

/**
 * Pesquisa de Leis — o que o resto do CRM usa (rotas, Enzo, petição inicial,
 * Assistente de IA, revisor). O índice é aberto uma vez e só lido aqui; quem
 * escreve é o processo de atualização (scripts/leisAtualizar), em segundo plano.
 */

let aberto: Acervo | null = null;

export function acervoAberto(): Acervo | null {
  if (aberto) return aberto;
  const { db } = pastasLeis();
  if (!fs.existsSync(db)) return null;
  try { aberto = abrirAcervo(db); } catch { return null; }
  return aberto;
}

function pesquisa() {
  return criarPesquisa({
    acervo: acervoAberto(),
    ia: async (prompt) => (await import('./aiAssistant')).aiComplete(prompt, 'openai'),
    registrar: registrarAcaoAgente,
  });
}

export function estadoAcervo() {
  const a = acervoAberto();
  const { trava } = pastasLeis();
  const atualizando = fs.existsSync(trava);
  if (!a) return { pronto: false, atualizando, normas: 0, dispositivos: 0, porEsfera: {}, commit: null, atualizadoEm: null };
  const r = a.resumo();
  return { pronto: r.normas > 0, atualizando, ...r };
}

/** Dra. Júlia: bloco de fundamentos conferidos para o prompt de quem redige ('' se nada). Nunca lança. */
export async function fundamentosParaPeca(texto: string, ctx: ContextoPeca, quem: string): Promise<string> {
  try { return await pesquisa().fundamentosParaPeca(texto, ctx, quem); } catch { return ''; }
}

export async function pesquisarFundamentos(texto: string, ctx: ContextoPeca) {
  return pesquisa().pesquisarFundamentos(texto, ctx, 20);
}

/** Dra. Vera: conferência de todas as citações de uma peça (regras + sentido pela IA). */
export async function conferirPeca(texto: string) {
  return pesquisa().conferirPeca(texto);
}

/** Assistente do WhatsApp: "art 482 clt" → texto oficial (null = não é pedido de lei). Nunca lança. */
export function consultaRapida(texto: string): string | null {
  try { return pesquisa().consultaRapida(texto); } catch { return null; }
}

/**
 * Roda a atualização num processo separado (indexar trava o processo que indexa).
 * Resolve com o resumo em JSON impresso pelo script.
 */
export function dispararAtualizacao(opts: { completo?: boolean } = {}): Promise<any> {
  const script = path.join(__dirname, '..', 'scripts', 'leisAtualizar.js');
  return new Promise((ok, falha) => {
    const filho = spawn(process.execPath, [script, ...(opts.completo ? ['--completo'] : [])], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let saida = '', erro = '';
    filho.stdout.on('data', (b) => { saida = (saida + b).slice(-4000); });
    filho.stderr.on('data', (b) => { erro = (erro + b).slice(-4000); });
    const limite = setTimeout(() => filho.kill(), 3 * 60 * 60 * 1000);
    filho.on('close', (codigo) => {
      clearTimeout(limite);
      if (codigo !== 0) { falha(new Error(`atualização das leis falhou: ${erro.replace(/ExperimentalWarning[^\n]*\n?/g, '').trim().slice(-500) || 'código ' + codigo}`)); return; }
      const ultima = saida.trim().split('\n').pop() || '{}';
      try { ok(JSON.parse(ultima)); } catch { ok({ saida: ultima }); }
    });
  });
}
