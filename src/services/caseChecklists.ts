import { db } from '../config/database';

/**
 * Checklist de documentos por TIPO DE AÇÃO. Cada item tem palavras-chave;
 * o sistema marca como "ok" quando existe documento do caso/cliente (ou
 * arquivo recebido pelo WhatsApp) cujo nome bate com alguma palavra-chave.
 * Quando tudo estiver verde, a petição pode começar.
 */

interface ChecklistItem { label: string; keys: string[] }

const BASE: ChecklistItem[] = [
  { label: 'RG ou CNH', keys: ['rg', 'cnh', 'identidade'] },
  { label: 'CPF', keys: ['cpf'] },
  { label: 'Comprovante de residência', keys: ['residencia', 'residência', 'endereco', 'endereço', 'comprovante de res'] },
  { label: 'Procuração assinada', keys: ['procuracao', 'procuração'] },
  { label: 'Contrato de honorários', keys: ['contrato'] },
];

const POR_TIPO: Record<string, { titulo: string; itens: ChecklistItem[] }> = {
  gestante: {
    titulo: 'Estabilidade da gestante',
    itens: [
      { label: 'CTPS (digital ou física)', keys: ['ctps', 'carteira de trabalho'] },
      { label: 'TRCT (rescisão)', keys: ['trct', 'rescisao', 'rescisão'] },
      { label: 'Extrato do FGTS', keys: ['fgts'] },
      { label: 'Exame/teste de gravidez', keys: ['gravidez', 'beta', 'hcg'] },
      { label: 'Ultrassom', keys: ['ultrassom', 'ultrasson', 'usg'] },
      { label: 'Holerites', keys: ['holerite', 'contracheque', 'contra-cheque'] },
      { label: 'Conversas com a empresa (prints)', keys: ['print', 'conversa', 'whatsapp'] },
      { label: 'CNIS', keys: ['cnis'] },
    ],
  },
  trabalhista: {
    titulo: 'Reclamação trabalhista',
    itens: [
      { label: 'CTPS (digital ou física)', keys: ['ctps', 'carteira de trabalho'] },
      { label: 'TRCT (rescisão)', keys: ['trct', 'rescisao', 'rescisão'] },
      { label: 'Extrato do FGTS', keys: ['fgts'] },
      { label: 'Holerites', keys: ['holerite', 'contracheque'] },
      { label: 'Controles de ponto (se houver)', keys: ['ponto', 'jornada'] },
      { label: 'CNIS', keys: ['cnis'] },
    ],
  },
  previdenciario: {
    titulo: 'Ação previdenciária',
    itens: [
      { label: 'CNIS', keys: ['cnis'] },
      { label: 'Carta/decisão de indeferimento do INSS', keys: ['indeferimento', 'inss', 'carta de'] },
      { label: 'Laudos e exames médicos', keys: ['laudo', 'exame', 'atestado'] },
      { label: 'Comprovantes de contribuição', keys: ['contribuicao', 'contribuição', 'gps', 'carne', 'carnê'] },
    ],
  },
  consumidor: {
    titulo: 'Ação do consumidor (RCC/RMC/empréstimos)',
    itens: [
      { label: 'Extrato bancário com os descontos', keys: ['extrato'] },
      { label: 'Contrato questionado (se tiver)', keys: ['emprestimo', 'empréstimo', 'cartao', 'cartão', 'rcc', 'rmc'] },
      { label: 'CNIS ou HISCRE (descontos no benefício)', keys: ['cnis', 'hiscre', 'historico de credito', 'histórico de crédito'] },
      { label: 'Protocolo de reclamação (banco/Procon)', keys: ['protocolo', 'procon', 'reclamacao', 'reclamação'] },
    ],
  },
  familia: {
    titulo: 'Ação de família',
    itens: [
      { label: 'Certidão (nascimento/casamento)', keys: ['certidao', 'certidão'] },
      { label: 'Comprovantes de renda/despesas', keys: ['renda', 'despesa', 'holerite', 'contracheque'] },
      { label: 'Provas (conversas, fotos)', keys: ['print', 'conversa', 'foto'] },
    ],
  },
};

export async function buildCaseChecklist(caseId: number): Promise<{ titulo: string; itens: { label: string; done: boolean; doc: string | null }[]; completos: number; total: number } | null> {
  const [[c]] = await db.query('SELECT id, client_id, legal_area FROM cases WHERE id = ?', [caseId]) as any;
  if (!c) return null;

  const tpl = POR_TIPO[c.legal_area] || { titulo: `Documentos (${c.legal_area || 'geral'})`, itens: [] };
  const itens = [...tpl.itens, ...BASE];

  // Nomes de documentos do caso e do cliente (inclui os recebidos pelo WhatsApp)
  const [docs] = await db.query(
    `SELECT name FROM documents WHERE case_id = ? OR client_id = ?`, [caseId, c.client_id ?? 0]) as any;
  const [media] = await db.query(
    `SELECT file_name AS name FROM whatsapp_media WHERE client_id = ?`, [c.client_id ?? 0]).catch(() => [[]]) as any;
  const nomes: string[] = [...docs, ...media].map((d: any) => String(d.name || '').toLowerCase());

  const resultado = itens.map((item) => {
    const doc = nomes.find((n) => item.keys.some((k) => n.includes(k)));
    return { label: item.label, done: !!doc, doc: doc || null };
  });
  return {
    titulo: tpl.titulo,
    itens: resultado,
    completos: resultado.filter((i) => i.done).length,
    total: resultado.length,
  };
}
