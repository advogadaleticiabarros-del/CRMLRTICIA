/**
 * Conversa com a API do Claude no CRM (/api/claude/*) usando a chave da pessoa.
 * Erros viram mensagens em português que o Claude repassa ao advogado.
 */
export function criarCrm({ url, chave, fetch: f = globalThis.fetch, timeoutMs = 30_000 }) {
  const base = String(url || '').trim().replace(/\/+$/, '');
  const k = String(chave || '').trim();

  async function chamar(caminho, { metodo = 'GET', consulta, corpo } = {}) {
    if (!base) throw new Error('O endereço do CRM não foi configurado na extensão.');
    if (!k.startsWith('crm_')) throw new Error('A chave do CRM não foi configurada na extensão. Gere uma no CRM em Configurações → Claude e cole nas configurações da extensão.');
    const qs = consulta
      ? '?' + new URLSearchParams(Object.entries(consulta).filter(([, v]) => v != null && String(v).trim() !== '').map(([a, v]) => [a, String(v)])).toString()
      : '';
    let r;
    try {
      r = await f(`${base}/api/claude${caminho}${qs}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json', 'User-Agent': 'extensao-claude-crm' },
        body: corpo ? JSON.stringify(corpo) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new Error('Não consegui falar com o CRM agora (sem internet ou o CRM fora do ar). Tente de novo em instantes.');
    }
    let dados = null;
    try { dados = await r.json(); } catch { /* resposta sem JSON */ }
    if (!r.ok) throw new Error((dados && dados.error) || `O CRM recusou o pedido (HTTP ${r.status}).`);
    return dados;
  }

  return {
    get: (caminho, consulta) => chamar(caminho, { consulta }),
    post: (caminho, corpo) => chamar(caminho, { metodo: 'POST', corpo }),
  };
}
