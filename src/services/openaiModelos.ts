/**
 * Qual modelo da OpenAI atende cada nível de trabalho, com reserva automática.
 *
 * Decisão de 31/10/2026 (Jessica: "qualidade e economizar ao mesmo tempo"):
 *  - 'redacao' → GPT-6 Sol com esforço alto: só para redigir a peça, onde a qualidade aparece
 *    (≈ US$ 0,14 por peça).
 *  - 'baixo' | 'medio' | 'alto' → GPT-6 Luna (US$ 0,10/0,50 por milhão de tokens, mais barato
 *    que o GPT-5.6 Luna de antes), com o esforço de raciocínio pedido.
 *  - 'forte' → Sol, quando alguém pedir explicitamente o nível mais forte.
 *
 * Cada nível tem uma lista de tentativas. Modelo recusado pela API (400/403/404: nome errado,
 * sem acesso, parâmetro não aceito) é anotado e pulado nas próximas chamadas, até o CRM
 * reiniciar; falha passageira (limite, servidor, rede) só passa para a próxima tentativa.
 * Assim, se o nome de um modelo novo estiver errado, a peça continua saindo no Luna antigo.
 */

export type NivelOpenAI = 'baixo' | 'medio' | 'alto' | 'redacao' | 'forte';
type Esforco = 'low' | 'medium' | 'high';
type Uso = 'openai' | 'openai_smart';

export interface Tentativa { modelo: string; esforco?: Esforco; uso: Uso }

type Env = Record<string, string | undefined>;

const LUNA_RESERVA = 'gpt-5.6-luna';
const SOL_RESERVA = 'gpt-5.6-sol';

function semRepetir(lista: Tentativa[]): Tentativa[] {
  const vistos = new Set<string>();
  return lista.filter((t) => {
    const k = `${t.modelo}|${t.esforco ?? ''}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

export function tentativasPara(nivel: NivelOpenAI, env: Env): Tentativa[] {
  const luna = env.OPENAI_MODEL || 'gpt-6-luna';
  const lunas = (esforco: Esforco): Tentativa[] => [luna, LUNA_RESERVA].map((modelo) => ({ modelo, esforco, uso: 'openai' as const }));
  if (nivel === 'redacao') {
    const sol = env.OPENAI_MODEL_REDACAO || 'gpt-6-sol';
    return semRepetir([
      { modelo: sol, esforco: 'high', uso: 'openai_smart' },
      { modelo: sol, uso: 'openai_smart' },
      ...lunas('high'),
    ]);
  }
  if (nivel === 'forte') {
    const sol = env.OPENAI_MODEL_SMART || 'gpt-6-sol';
    return semRepetir([sol, SOL_RESERVA].map((modelo) => ({ modelo, uso: 'openai_smart' as const })));
  }
  return semRepetir(lunas(nivel === 'alto' ? 'high' : nivel === 'medio' ? 'medium' : 'low'));
}

export interface RespostaApi { ok: boolean; status: number; dados: any }

export interface DepsOpenAI {
  chave: () => string | undefined;
  env: () => Env;
  enviar: (body: Record<string, unknown>) => Promise<RespostaApi>;
  registrar: (uso: Uso) => void;
}

/** O modelo (ou o esforço) não serve nesta chave; texto grande demais não conta. */
function recusaDoModelo(r: RespostaApi): boolean {
  if (r.status === 403 || r.status === 404) return true;
  if (r.status !== 400) return false;
  const e = r.dados?.error || {};
  return e.param === 'model' || e.param === 'reasoning_effort' || /model_not_found|unsupported/.test(String(e.code || ''));
}

export function criarChamadaOpenAI(deps: DepsOpenAI) {
  const recusados = new Set<string>();
  return async function chamar(prompt: string, nivel: NivelOpenAI): Promise<{ ok: boolean; text?: string; message?: string; modelo?: string }> {
    if (!deps.chave()) return { ok: false, message: 'sem_openai' };
    let ultima = 'Erro OpenAI';
    for (const t of tentativasPara(nivel, deps.env())) {
      const k = `${t.modelo}|${t.esforco ?? ''}`;
      if (recusados.has(k)) continue;
      const body: Record<string, unknown> = { model: t.modelo, messages: [{ role: 'user', content: prompt }] };
      if (t.esforco) body.reasoning_effort = t.esforco;
      try {
        const r = await deps.enviar(body);
        if (r.ok) {
          deps.registrar(t.uso);
          return { ok: true, text: r.dados?.choices?.[0]?.message?.content || '', modelo: t.modelo };
        }
        ultima = r.dados?.error?.message || ultima;
        if (recusaDoModelo(r)) recusados.add(k);
      } catch (e: any) {
        ultima = e?.message || ultima;
      }
    }
    return { ok: false, message: ultima };
  };
}
