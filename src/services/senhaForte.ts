/**
 * Política de senha do CRM (23/11/2026, padrão de segurança SaaS).
 *
 * Uma regra só, usada em TODO lugar que grava senha (cadastro, troca, redefinição,
 * admin). Exige:
 *  - de 10 a 128 caracteres;
 *  - 3 dos 4 tipos (minúscula, maiúscula, número, símbolo) — ou 16+ caracteres
 *    (frase-senha, ex.: "cafe com pao na praia de camburi");
 *  - não ser uma senha comum (nem com números/símbolos no fim: "Senha@2026");
 *  - não ter sequência ou repetição longa ("1234", "abcd", "aaaa");
 *  - não conter o nome nem o e-mail da pessoa.
 */
import crypto from 'crypto';

export const SENHA_MIN = 10;
export const SENHA_MAX = 128;
export const TEXTO_REGRA_SENHA =
  'Use pelo menos 10 caracteres, misturando letras maiúsculas, minúsculas, números e símbolos (ou uma frase com 16+ caracteres). Não use seu nome, e-mail nem senhas óbvias.';

const COMUNS = [
  'senha', 'password', 'passw0rd', 'qwerty', 'qwertyuiop', 'asdfgh', 'zxcvbn', 'abc123', 'admin', 'administrador',
  'iloveyou', 'teamo', 'amor', 'brasil', 'brazil', 'flamengo', 'corinthians', 'palmeiras', 'vasco', 'gremio',
  'mudar', 'mudar123', 'trocar', 'acesso', 'entrar', 'login', 'usuario', 'welcome', 'bemvindo', 'letmein',
  'leticia', 'barros', 'advocacia', 'advogada', 'advogado', 'juridico', 'escritorio', 'crm', 'crmjuridico',
  'vitoria', 'espiritosanto', 'deus', 'jesus', 'jesuscristo', 'familia', 'princesa', 'monkey', 'dragon',
  'master', 'sunshine', 'football', 'baseball', 'superman', 'batman', 'trustno1', 'changeme', 'default',
  'segredo', 'minhasenha', 'senhaforte', 'teste', 'test', 'temp', 'temporaria',
];

/** Minúsculas, sem acento, sem números/símbolos nas pontas — para comparar com a lista. */
function nucleo(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[@$!%*#?&._\-\s]/g, '')
    .replace(/^\d+|\d+$/g, '')
    .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/@/g, 'a');
}

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function temSequenciaOuRepeticao(s: string, n = 4): boolean {
  const t = s.toLowerCase();
  for (let i = 0; i + n <= t.length; i++) {
    const seg = t.slice(i, i + n);
    if (/^(.)\1+$/.test(seg)) return true;
    let sobe = true, desce = true;
    for (let j = 1; j < seg.length; j++) {
      const d = seg.charCodeAt(j) - seg.charCodeAt(j - 1);
      if (d !== 1) sobe = false;
      if (d !== -1) desce = false;
    }
    if ((sobe || desce) && /^[a-z0-9]+$/.test(seg)) return true;
  }
  return false;
}

export interface ContextoSenha { nome?: string | null; email?: string | null }

/** Devolve null se a senha serve, ou a mensagem (em português claro) do que falta. */
export function problemaDaSenha(senha: unknown, ctx: ContextoSenha = {}): string | null {
  if (typeof senha !== 'string' || !senha) return 'Informe a senha.';
  if (senha.length < SENHA_MIN) return `A senha precisa ter pelo menos ${SENHA_MIN} caracteres.`;
  if (senha.length > SENHA_MAX) return `A senha pode ter no máximo ${SENHA_MAX} caracteres.`;

  const tipos = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(senha)).length;
  if (senha.length < 16 && tipos < 3) {
    return 'Misture pelo menos 3 tipos: letra minúscula, letra maiúscula, número e símbolo (ou use uma frase com 16+ caracteres).';
  }

  const n = nucleo(senha);
  if (!n || n.length < 4 || COMUNS.some((c) => n === c || (c.length >= 5 && n.startsWith(c) && n.length - c.length <= 3))) {
    return 'Essa senha é muito comum e fácil de adivinhar. Escolha outra.';
  }
  if (temSequenciaOuRepeticao(senha)) return 'Evite sequências ou repetições (como "1234", "abcd" ou "aaaa").';

  const baixa = semAcento(senha);
  const partesEmail = String(ctx.email || '').toLowerCase().split('@')[0].split(/[._\-+]/).filter((p) => p.length >= 4);
  const partesNome = semAcento(String(ctx.nome || '')).split(/\s+/).filter((p) => p.length >= 4);
  if ([...partesEmail, ...partesNome].some((p) => baixa.includes(p))) {
    return 'A senha não pode conter o seu nome nem o seu e-mail.';
  }
  return null;
}

/**
 * Senha temporária forte (para o admin repassar ou para o primeiro acesso).
 * Usa gerador criptográfico (antes era Math.random, previsível) e garante
 * os 4 tipos de caractere; sem caracteres ambíguos (0/O, 1/l/I).
 */
export function gerarSenhaTemporaria(tamanho = 14): string {
  const grupos = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '@#$%&*!?'];
  const todos = grupos.join('');
  const chars = grupos.map((g) => g[crypto.randomInt(g.length)]);
  while (chars.length < tamanho) chars.push(todos[crypto.randomInt(todos.length)]);
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  const s = chars.join('');
  // Sorteio pode cair numa sequência ("2345") — raro; sorteia de novo.
  return problemaDaSenha(s) ? gerarSenhaTemporaria(tamanho) : s;
}

/** Custo do bcrypt (era 10). 12 ≈ 4x mais caro para quem tenta adivinhar a senha a partir do hash. */
export const BCRYPT_CUSTO = 12;
