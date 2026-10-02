/**
 * Triagem em lote dos números de WhatsApp sem cadastro — regras puras.
 * A IA sugere a categoria; a advogada confirma. Lead vira cadastro no funil;
 * as demais categorias vão para a etapa correspondente do quadro.
 */

export type Categoria = 'lead' | 'pessoal' | 'parceiro' | 'parte_contraria' | 'servico' | 'outro';

export const PROMPT_TRIAGEM = `Você vai ler as últimas mensagens de um contato de WhatsApp de um escritório de advocacia (trabalhista, previdenciário, família, consumidor).
Classifique o CONTATO numa categoria:
- "lead": pessoa buscando atendimento jurídico / possível cliente novo;
- "pessoal": família, amigos, assuntos pessoais da advogada;
- "parceiro": advogado(a) ou escritório parceiro, correspondente;
- "parte_contraria": empresa/pessoa do outro lado de um processo, advogado da parte contrária;
- "servico": empresa/aplicativo/notificação automática, loja, banco, propaganda;
- "outro": não dá para saber.
Responda SOMENTE JSON: {"categoria": "...", "nome": "nome da pessoa se aparecer, senão vazio", "motivo": "até 12 palavras"}`;

const MAPA: Record<string, Categoria> = {
  lead: 'lead', cliente: 'lead', pessoal: 'pessoal', familia: 'pessoal', parceiro: 'parceiro', parceria: 'parceiro',
  parte_contraria: 'parte_contraria', 'parte contraria': 'parte_contraria',
  servico: 'servico', spam: 'servico', notificacao: 'servico', empresa: 'servico', outro: 'outro',
};

const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function lerTriagem(texto: string): { categoria: Categoria; nome: string; motivo: string } | null {
  const limpo = String(texto || '').replace(/```(?:json)?/gi, '').trim();
  const i = limpo.indexOf('{'), j = limpo.lastIndexOf('}');
  if (i < 0 || j < i) return null;
  let o: any;
  try { o = JSON.parse(limpo.slice(i, j + 1)); } catch { return null; }
  const categoria = MAPA[sem(String(o?.categoria || ''))] ?? 'outro';
  return { categoria, nome: String(o?.nome || '').trim().slice(0, 120), motivo: String(o?.motivo || '').trim().slice(0, 160) };
}

const ETAPA: Partial<Record<Categoria, string>> = {
  pessoal: 'Pessoal', parceiro: 'Parceiros', parte_contraria: 'Parte contraria', servico: 'Arquivado',
};

export function destinoDaCategoria(c: Categoria): { acao: 'lead' | 'etapa' | 'nada'; etapa: string | null } {
  if (c === 'lead') return { acao: 'lead', etapa: null };
  const etapa = ETAPA[c];
  return etapa ? { acao: 'etapa', etapa } : { acao: 'nada', etapa: null };
}
