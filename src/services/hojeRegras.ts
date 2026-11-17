/**
 * Tela "Hoje" — regras puras. Transforma os números do dia numa lista única
 * de pendências em português simples, cada uma com o botão que resolve,
 * ordenada por urgência. Lista vazia = dia em dia. Também monta o painel de
 * saúde (verde/vermelho) com o que fazer quando algo cai.
 */

export interface DadosHoje {
  prazosUrgentes: number;            // a confirmar que vencem em até 5 dias
  prazosAConfirmar: number;          // total a confirmar
  prazosHoje: string[];              // prazos confirmados que vencem hoje
  audienciasHoje: string[];
  whatsappAguardando: { nome: string; horas: number }[];
  acordosARegistrar: number;
  propostasAbertas: number;
  propostasSemAbrir: number;
  leadsSemResposta: number;
  parcelasAtrasadas: { qtd: number; total: number };
  repassesCliente: { qtd: number; total: number };
  clientesAConferir: number;
  processosDuplicados: number;
  tarefasVencidas: number;
}

export type Nivel = 'critico' | 'atencao' | 'rotina';
export interface ItemHoje { id: string; nivel: Nivel; icone: string; titulo: string; detalhe: string; acao: { label: string; href: string } }

const brl = (n: number) => `R$ ${(Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;
const nomes = (xs: string[], max = 3) => xs.slice(0, max).join(', ') + (xs.length > max ? ` e mais ${xs.length - max}` : '');

export function montarItens(d: DadosHoje): ItemHoje[] {
  const it: ItemHoje[] = [];
  for (const p of d.prazosHoje) it.push({ id: `prazo-hoje-${p}`, nivel: 'critico', icone: '⚖️', titulo: `Prazo vence hoje: ${p}`, detalhe: 'Protocole hoje ou confira se já foi feito.', acao: { label: 'Abrir prazos', href: '#prazos' } });
  if (d.audienciasHoje.length) it.push({ id: 'audiencias', nivel: 'critico', icone: '🏛️', titulo: `${plural(d.audienciasHoje.length, 'audiência', 'audiências')} hoje`, detalhe: nomes(d.audienciasHoje), acao: { label: 'Ver agenda', href: '#agenda' } });
  if (d.prazosUrgentes) it.push({ id: 'prazos-urgentes', nivel: 'critico', icone: '⏰', titulo: `${plural(d.prazosUrgentes, 'prazo vence', 'prazos vencem')} em até 5 dias e ainda não ${d.prazosUrgentes === 1 ? 'foi confirmado' : 'foram confirmados'}`, detalhe: 'Confirme para entrar na agenda e nos lembretes.', acao: { label: 'Resolver prazos', href: '#prazos' } });
  const esperando24 = d.whatsappAguardando.filter((w) => w.horas >= 24);
  if (d.whatsappAguardando.length) it.push({ id: 'whatsapp', nivel: esperando24.length ? 'critico' : 'atencao', icone: '💬', titulo: `${plural(d.whatsappAguardando.length, 'pessoa esperando', 'pessoas esperando')} resposta no WhatsApp`, detalhe: d.whatsappAguardando.slice(0, 4).map((w) => `${w.nome} (${w.horas}h)`).join(', '), acao: { label: 'Responder', href: '#whatsapp' } });
  if (d.leadsSemResposta) it.push({ id: 'leads', nivel: 'atencao', icone: '📥', titulo: `${plural(d.leadsSemResposta, 'possível cliente', 'possíveis clientes')} sem resposta há mais de 24h`, detalhe: 'Quem responde rápido fecha mais contratos.', acao: { label: 'Ver leads', href: '#leads' } });
  if (d.parcelasAtrasadas.qtd) it.push({ id: 'cobranca', nivel: 'atencao', icone: '💸', titulo: `${plural(d.parcelasAtrasadas.qtd, 'parcela atrasada', 'parcelas atrasadas')} — ${brl(d.parcelasAtrasadas.total)}`, detalhe: 'Cobre o cliente ou registre o pagamento.', acao: { label: 'Ver cobranças', href: '#financeiro?tab=inadimplencia' } });
  if (d.repassesCliente.qtd) it.push({ id: 'repasses', nivel: 'atencao', icone: '🤝', titulo: `${plural(d.repassesCliente.qtd, 'repasse', 'repasses')} ao cliente para fazer — ${brl(d.repassesCliente.total)}`, detalhe: 'Dinheiro de acordo que precisa ir para o cliente.', acao: { label: 'Ver acordos', href: '#financeiro?tab=acordos' } });
  if (d.prazosAConfirmar > d.prazosUrgentes) it.push({ id: 'prazos-confirmar', nivel: 'atencao', icone: '📋', titulo: `${plural(d.prazosAConfirmar - d.prazosUrgentes, 'intimação', 'intimações')} para conferir`, detalhe: 'Use "Resolver em lote" para confirmar ou dar baixa de uma vez.', acao: { label: 'Conferir', href: '#prazos' } });
  if (d.propostasAbertas) it.push({ id: 'propostas', nivel: 'rotina', icone: '📄', titulo: `${plural(d.propostasAbertas, 'proposta aguardando', 'propostas aguardando')} resposta do cliente`, detalhe: d.propostasSemAbrir ? `${plural(d.propostasSemAbrir, 'ainda não foi aberta', 'ainda não foram abertas')} pelo cliente.` : 'Todas já foram abertas pelo cliente.', acao: { label: 'Ver propostas', href: '#propostas' } });
  if (d.tarefasVencidas) it.push({ id: 'tarefas', nivel: 'rotina', icone: '✅', titulo: `${plural(d.tarefasVencidas, 'tarefa atrasada', 'tarefas atrasadas')}`, detalhe: 'Conclua, reagende ou marque "aguardando terceiro".', acao: { label: 'Ver tarefas', href: '#prazos' } });
  if (d.clientesAConferir) it.push({ id: 'clientes', nivel: 'rotina', icone: '👤', titulo: `${plural(d.clientesAConferir, 'processo', 'processos')} com cliente para conferir`, detalhe: 'O sistema pode ter colocado a parte contrária como cliente.', acao: { label: 'Conferir', href: '#monitor' } });
  if (d.processosDuplicados) it.push({ id: 'duplicados', nivel: 'rotina', icone: '🗂️', titulo: `${plural(d.processosDuplicados, 'processo cadastrado', 'processos cadastrados')} em duplicidade`, detalhe: 'Junte as cópias com um clique.', acao: { label: 'Unir', href: '#monitor' } });
  if (d.acordosARegistrar) it.push({ id: 'acordos', nivel: 'rotina', icone: '🤝', titulo: `${plural(d.acordosARegistrar, 'acordo', 'acordos')} para registrar os valores`, detalhe: 'Apareceram nos processos e ainda não estão no financeiro.', acao: { label: 'Registrar', href: '#financeiro?tab=acordos' } });
  const ordem: Record<Nivel, number> = { critico: 0, atencao: 1, rotina: 2 };
  return it.map((x, i) => ({ x, i })).sort((a, b) => ordem[a.x.nivel] - ordem[b.x.nivel] || a.i - b.i).map((a) => a.x);
}

export interface EntradaSaude {
  whatsapp: boolean | null; googleAgenda: boolean | null; gmailParceria: boolean | null;
  gmailTribunal: boolean | null; backupOk: boolean | null; tribunaisOk: boolean | null;
}
export interface ItemSaude { id: string; nome: string; ok: boolean; comoResolver: string; href: string }

const SAUDE: { id: keyof EntradaSaude; chave: string; nome: string; comoResolver: string; href: string }[] = [
  { id: 'whatsapp', chave: 'whatsapp', nome: 'WhatsApp', comoResolver: 'Abra o WhatsApp do CRM e leia o QR code com o celular do escritório.', href: '#whatsapp' },
  { id: 'googleAgenda', chave: 'google', nome: 'Google Agenda', comoResolver: 'Na Agenda, clique em "Reconectar Google".', href: '#agenda' },
  { id: 'gmailParceria', chave: 'gmailParceria', nome: 'E-mail da parceria', comoResolver: 'Em Parcerias, clique em "Reconectar".', href: '#parcerias' },
  { id: 'gmailTribunal', chave: 'gmailTribunal', nome: 'E-mail do tribunal', comoResolver: 'Em Monitoramento, clique em "Reconectar".', href: '#monitor' },
  { id: 'tribunaisOk', chave: 'tribunais', nome: 'Consulta aos tribunais', comoResolver: 'Normalmente volta sozinho; se passar de um dia, avise o suporte.', href: '#monitor' },
  { id: 'backupOk', chave: 'backup', nome: 'Cópia de segurança', comoResolver: 'Avise o suporte: o backup diário não foi confirmado.', href: '#config' },
];

/** null = não configurado (não aparece). */
export function montarSaude(e: EntradaSaude): ItemSaude[] {
  return SAUDE.filter((s) => e[s.id] !== null && e[s.id] !== undefined)
    .map((s) => ({ id: s.chave, nome: s.nome, ok: !!e[s.id], comoResolver: s.comoResolver, href: s.href }));
}

export function tudoOk(s: ItemSaude[]): boolean {
  return s.every((x) => x.ok);
}
