import { db } from '../config/database';
import { sendEmail, layout } from './EmailService';
import { aiComplete } from './aiAssistant';

/**
 * "Jornal Jurídico" — resumo diário de notícias/jurisprudência dos tribunais
 * (STJ, STF, CNJ), separado do resumo operacional (morningBriefingService).
 * Substitui o antigo placeholder "Radar Jurídico" ("em construção") que ficava
 * fixo no e-mail principal sem nunca ter conteúdo de verdade.
 *
 * Fontes: feeds RSS/Atom OFICIAIS de cada órgão — a IA nunca "sabe" notícia
 * sozinha (sem acesso à internet ao vivo), então buscamos o texto real e só
 * pedimos pra IA FILTRAR (pelas áreas de atuação do escritório) e RESUMIR em
 * linguagem simples, nunca inventar. STF e CNJ bloqueiam requisição sem
 * User-Agent de navegador (mesma barreira do DJEN, ver src/services/djen.ts)
 * — tentamos com header realista; se ainda assim falhar, aquela fonte
 * simplesmente não aparece no dia (best-effort, nunca quebra o envio).
 */

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
};

interface FeedItem { fonte: string; titulo: string; link: string; data: string; resumo: string; }

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeXmlEntities(s: string): string {
  return (s || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const cp = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return XML_ENTITIES[code.toLowerCase()] ?? m;
  });
}
function stripTags(s: string): string {
  return decodeXmlEntities(String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Extrai itens de um XML RSS (<item>) ou Atom (<entry>) — parser mínimo, sem dependência de lib. */
function parseFeedItems(xml: string, fonte: string, limit = 12): FeedItem[] {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi) || [];
  const get = (block: string, tag: string) => {
    const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return m ? stripTags(m[1]) : '';
  };
  const getLink = (block: string) => {
    const atomHref = block.match(/<link[^>]*\bhref="([^"]+)"/i);
    if (atomHref) return atomHref[1];
    const rssLink = block.match(/<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i);
    return rssLink ? stripTags(rssLink[1]) : '';
  };
  return blocks.slice(0, limit).map((block) => ({
    fonte,
    titulo: get(block, 'title'),
    link: getLink(block),
    data: get(block, 'pubDate') || get(block, 'updated') || get(block, 'published'),
    resumo: get(block, 'description') || get(block, 'summary') || get(block, 'content'),
  })).filter((it) => it.titulo);
}

async function fetchFeed(url: string, fonte: string): Promise<FeedItem[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const r = await fetch(url, { headers: BROWSER_HEADERS, signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) return [];
    const xml = await r.text();
    return parseFeedItems(xml, fonte);
  } catch { return []; /* fonte fora do ar, bloqueada, etc. — best-effort */ }
}

// Fontes oficiais e gratuitas — testadas ao vivo (28/08/2026):
// - STJ (Informativo + Notícias): funcionam de verdade, confirmado.
// - STF: bloqueia a requisição na rede (não é só User-Agent) — fica na lista
//   como "melhor esforço"; fetchFeed nunca lança, então simplesmente não
//   aparece nenhuma notícia dessa fonte enquanto isso não mudar.
// - CNJ: o feed WordPress do site deles está DESLIGADO (/feed/ devolve a
//   página HTML normal, não RSS, em qualquer variação de URL testada) — não
//   é bug daqui, é o site deles. Removido da lista até acharem outra fonte.
const FONTES: { url: string; fonte: string }[] = [
  { url: 'https://processo.stj.jus.br/jurisprudencia/externo/InformativoFeed', fonte: 'STJ — Informativo de Jurisprudência' },
  { url: 'https://res.stj.jus.br/hrestp-c-portalp/RSS.xml', fonte: 'STJ — Notícias' },
  { url: 'https://www.stf.jus.br/portal/RSS/rss.asp', fonte: 'STF — Notícias' },
];

async function coletarNoticias(): Promise<FeedItem[]> {
  const listas = await Promise.all(FONTES.map((f) => fetchFeed(f.url, f.fonte)));
  return listas.flat();
}

interface NoticiaCurada { fonte: string; titulo: string; link: string; resumo: string; }

/**
 * Pede pra IA filtrar SÓ o que é relevante às áreas do escritório e resumir
 * em 1-2 linhas simples — nunca inventa nada além do que veio no feed (o
 * título/resumo originais são passados como fonte de verdade no prompt).
 */
async function curarNoticias(itens: FeedItem[], areas: string[]): Promise<NoticiaCurada[]> {
  if (!itens.length) return [];
  const listaTexto = itens.map((it, i) => `${i + 1}. [${it.fonte}] ${it.titulo}${it.resumo ? ` — ${it.resumo.slice(0, 300)}` : ''}`).join('\n');
  const prompt = `Você é assistente jurídico(a) de um escritório brasileiro que atua em: ${areas.join(', ') || 'diversas áreas'}.
Abaixo está uma lista numerada de notícias/informativos reais de tribunais (STJ/STF/CNJ) de hoje. Sua tarefa:
1) Escolha SOMENTE os itens realmente relevantes às áreas de atuação do escritório (ignore o resto, mesmo que pareçam interessantes).
2) Para cada item escolhido, responda no formato exato abaixo (uma linha ITEM por escolhido, na ordem de relevância, no máximo 6 itens):
ITEM: <número da lista> | <resumo de 1-2 linhas em português simples, sem juridiquês, explicando o que muda na prática>
Se nenhum item for relevante, responda apenas: NENHUM

LISTA DE HOJE:
${listaTexto}`;

  const r = await aiComplete(prompt, 'openai');
  if (!r.ok || !r.text || /^\s*NENHUM/i.test(r.text)) return [];

  const curadas: NoticiaCurada[] = [];
  for (const linha of r.text.split('\n')) {
    const m = linha.match(/^ITEM:\s*(\d+)\s*\|\s*(.+)$/i);
    if (!m) continue;
    const idx = Number(m[1]) - 1;
    const original = itens[idx];
    if (!original) continue;
    curadas.push({ fonte: original.fonte, titulo: original.titulo, link: original.link, resumo: m[2].trim() });
  }
  return curadas;
}

function buildHtml(noticias: NoticiaCurada[]): string {
  const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' });
  const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const corpo = noticias.length
    ? noticias.map((n) => `
      <div style="border-left:3px solid #1f3047;padding:10px 0 10px 14px;margin-bottom:10px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#c19a4e;font-weight:700;margin-bottom:3px">${esc(n.fonte)}</div>
        <p style="margin:0 0 4px;font-size:14.5px;font-weight:700;color:#232323">${esc(n.titulo)}</p>
        <p style="margin:0;font-size:13.5px;color:#4a4238;line-height:1.55">${esc(n.resumo)}</p>
        ${n.link ? `<a href="${esc(n.link)}" style="font-size:12px;color:#1f3047">Ler na íntegra →</a>` : ''}
      </div>`).join('')
    : `<p style="font-size:14px;color:#6b6252">Nenhuma novidade relevante às suas áreas hoje nos tribunais monitorados.</p>`;

  const body = `
    <div style="font-size:12px;color:#c19a4e;text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:14px">${hoje}</div>
    <p style="font-size:13.5px;color:#6b6252;margin:0 0 20px">Selecionado dos feeds oficiais do STJ, STF e CNJ, filtrado pelas áreas do escritório.</p>
    ${corpo}`;
  return layout('⚖️ Jornal Jurídico do dia', body);
}

/** Envia o Jornal Jurídico pros mesmos destinatários do resumo matinal (admin/advogado ativos). */
export async function sendLegalNewsDigest(): Promise<{ sent: number; failed: number; itens: number }> {
  const [lawyers] = await db.query(
    "SELECT practice_areas FROM lawyers WHERE active = 1"
  ) as any;
  const areasSet = new Set<string>();
  for (const l of lawyers) {
    try {
      const arr = JSON.parse(l.practice_areas || '[]');
      if (Array.isArray(arr)) arr.forEach((a: string) => areasSet.add(String(a)));
    } catch { /* practice_areas pode estar vazio/malformado */ }
  }

  const brutas = await coletarNoticias();
  const curadas = await curarNoticias(brutas, [...areasSet]);
  const html = buildHtml(curadas);

  const ADMIN_PLACEHOLDER_EMAIL = process.env.ADMIN_PLACEHOLDER_EMAIL || 'admin@advogadaleticiabarros.com.br';
  const [users] = await db.query(
    `SELECT DISTINCT email FROM users
      WHERE active = 1 AND role IN ('admin','advogado') AND email IS NOT NULL AND email <> ''
        AND LOWER(email) <> LOWER(?)`,
    [ADMIN_PLACEHOLDER_EMAIL]
  ) as any;

  let sent = 0, failed = 0;
  for (const u of users) {
    const r = await sendEmail({ to: u.email, subject: '⚖️ Jornal Jurídico do dia', html });
    if (r.ok) sent++; else failed++;
  }
  return { sent, failed, itens: curadas.length };
}
