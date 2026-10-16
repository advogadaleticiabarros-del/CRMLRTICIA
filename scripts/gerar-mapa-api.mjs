// Gera docs/api/rotas.md a partir do código (src/app.ts + src/routes/**).
// Não edite rotas.md à mão: rode `npm run docs:api`. O CI confere se está em dia.
import fs from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const app = fs.readFileSync(path.join(raiz, 'src/app.ts'), 'utf8');

// import xRoutes from './routes/x'
const imports = new Map();
for (const m of app.matchAll(/^import\s+(\w+)\s+from\s+'\.\/routes\/([^']+)';/gm)) imports.set(m[1], m[2]);

const ACESSO = (mws) => {
  if (mws.includes('requireAdmin')) return 'admin';
  if (mws.includes('requireWhatsappAccess')) return 'equipe + WhatsApp';
  if (mws.includes('requireStaff')) return 'equipe';
  if (mws.includes('authenticate')) return 'logado';
  return 'público';
};

const montagens = [];
for (const m of app.matchAll(/app\.use\(\s*'([^']+)'\s*,\s*([^)]*)\)/g)) {
  const partes = m[2].split(',').map((s) => s.trim()).filter(Boolean);
  const nome = partes[partes.length - 1];
  if (!imports.has(nome)) continue;
  montagens.push({ base: m[1], arquivo: imports.get(nome), acesso: ACESSO(partes.slice(0, -1)) });
}

const linhas = [
  '# Mapa da API do CRM',
  '',
  '> Gerado automaticamente por `npm run docs:api` a partir do código. **Não edite à mão.**',
  '> Acesso: **público** (sem login), **logado** (qualquer usuário), **equipe** (admin, advogada, staff), **admin**.',
  '> Dentro de cada rota pode haver checagem extra (ex.: dono do registro, papel parceiro).',
  '',
];
let total = 0;
for (const mt of montagens.sort((a, b) => a.base.localeCompare(b.base))) {
  const candidatos = [`src/routes/${mt.arquivo}.ts`, `src/routes/${mt.arquivo}/index.ts`];
  const f = candidatos.map((c) => path.join(raiz, c)).find((c) => fs.existsSync(c));
  if (!f) continue;
  const src = fs.readFileSync(f, 'utf8');
  const rotas = [...src.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']*)'\s*,\s*([^\n]*)/g)].map((r) => {
    const extra = /requireAdmin/.test(r[3]) ? ' (admin)' : /requireStaff/.test(r[3]) ? ' (equipe)' : '';
    return { metodo: r[1].toUpperCase(), caminho: (mt.base + (r[2] === '/' ? '' : r[2])) || '/', extra };
  });
  if (!rotas.length) continue;
  total += rotas.length;
  linhas.push(`## \`${mt.base}\` · ${mt.acesso} · \`${path.relative(raiz, f).replace(/\\/g, '/')}\``, '', '| Método | Caminho |', '|---|---|');
  for (const r of rotas) linhas.push(`| ${r.metodo} | \`${r.caminho}\`${r.extra} |`);
  linhas.push('');
}
linhas.splice(6, 0, `**${total} rotas em ${montagens.length} grupos.**`, '');

const destino = path.join(raiz, 'docs/api/rotas.md');
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, linhas.join('\n') + '\n');
console.log(`docs/api/rotas.md: ${total} rotas em ${montagens.length} grupos`);
