// Limpeza de texto jurídico vindo de fontes externas (DJEN, e-mail de
// monitoramento). Essas fontes às vezes mandam a publicação como HTML bruto
// — tags inteiras (<html><table><tr><td>...) e entidades não decodificadas
// (&aacute;, &ccedil;, &ordm;...) — que vazam pro `description` da
// movimentação, pro resumo da IA e pro WhatsApp sem nunca serem limpas.

// Entidades nomeadas mais comuns em publicação jurídica em português
// (acentuação, cedilha, ordinais º/ª) + as genéricas de HTML. Não é uma
// lista exaustiva do HTML5 — cobre o que realmente aparece nesses textos.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  atilde: 'ã', otilde: 'õ', Atilde: 'Ã', Otilde: 'Õ',
  acirc: 'â', ecirc: 'ê', ocirc: 'ô', Acirc: 'Â', Ecirc: 'Ê', Ocirc: 'Ô',
  agrave: 'à', Agrave: 'À',
  ccedil: 'ç', Ccedil: 'Ç',
  uuml: 'ü', Uuml: 'Ü',
  ordm: 'º', ordf: 'ª',
};

/** Decodifica entidades HTML (nomeadas, decimais &#123; e hex &#x1F;). */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (full, code: string) => {
    if (code[0] === '#') {
      const isHex = code[1] === 'x' || code[1] === 'X';
      const num = parseInt(isHex ? code.slice(2) : code.slice(1), isHex ? 16 : 10);
      return Number.isFinite(num) ? String.fromCodePoint(num) : full;
    }
    return NAMED_ENTITIES[code] ?? full;
  });
}

/**
 * Limpa texto de publicação/e-mail jurídico pra exibição e uso em prompt de
 * IA: remove conteúdo de <script>/<style>, troca tags por espaço (evita
 * colar palavras de células/linhas adjacentes), decodifica entidades HTML e
 * colapsa espaços. Nunca lança — pior caso, devolve o texto original.
 */
export function limparTextoJudicial(raw: string | null | undefined): string {
  if (!raw) return '';
  try {
    let s = String(raw);
    s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
    s = s.replace(/<[^>]+>/g, ' ');
    s = decodeEntities(s);
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  } catch {
    return String(raw).trim();
  }
}
