/**
 * Classificação do processo (18/11/2026) — regras puras, sem banco nem rede.
 *
 *  - justiça pelo número CNJ (segmento J);
 *  - instância pelo grau do DataJud (JE, G1, TR, G2, superior);
 *  - área do caso pela justiça + classe + assuntos (só sugere; quem grava
 *    decide se preenche, e só preenche área vazia);
 *  - temperatura pelas decisões: quente (a nosso favor), frio (contra),
 *    morno (sem decisão de mérito ainda). Lê o título das movimentações (nome
 *    oficial da Tabela Processual Unificada do CNJ) e inverte quando a
 *    cliente está no polo passivo.
 */

export type Justica = 'estadual' | 'federal' | 'trabalho' | 'eleitoral' | 'militar' | 'superior' | 'outra';
export type Instancia = 'juizado' | '1grau' | 'turma_recursal' | '2grau' | 'superior';
export type Area = 'trabalhista' | 'familia' | 'civel' | 'previdenciario' | 'consumidor' | 'outro';
export type Temperatura = 'quente' | 'frio' | 'morno';

export const NOME_JUSTICA: Record<Justica, string> = {
  estadual: 'Justiça Estadual', federal: 'Justiça Federal', trabalho: 'Justiça do Trabalho',
  eleitoral: 'Justiça Eleitoral', militar: 'Justiça Militar', superior: 'Tribunal Superior', outra: 'Outra',
};

export function justicaPeloNumero(numero: string | null | undefined): Justica | null {
  const d = String(numero || '').replace(/\D/g, '');
  if (d.length !== 20) return null;
  const j = d[13];
  if (j === '8') return 'estadual';
  if (j === '4') return 'federal';
  if (j === '5') return 'trabalho';
  if (j === '6') return 'eleitoral';
  if (j === '7' || j === '9') return 'militar';
  if (j === '1' || j === '3') return 'superior';
  return 'outra';
}

/** Grau do DataJud (G1, G2, JE, TR, TRU, TNU, SUP...) → instância. */
export function instanciaPeloGrau(grau: string | null | undefined): Instancia | null {
  const g = String(grau || '').toUpperCase();
  if (!g) return null;
  if (g === 'JE') return 'juizado';
  if (g === 'G1') return '1grau';
  if (g === 'TR' || g === 'TRU') return 'turma_recursal';
  if (g === 'G2') return '2grau';
  if (g === 'TNU' || g === 'SUP' || g.startsWith('SUP') || g === 'GS') return 'superior';
  return null;
}

const ORDEM_INSTANCIA: Instancia[] = ['juizado', '1grau', 'turma_recursal', '2grau', 'superior'];
/** Dos graus em que o processo aparece, o mais alto (onde ele está ou chegou). */
export function instanciaMaisAlta(graus: Array<string | null | undefined>): Instancia | null {
  let melhor: Instancia | null = null;
  for (const g of graus) {
    const i = instanciaPeloGrau(g);
    if (i && (!melhor || ORDEM_INSTANCIA.indexOf(i) > ORDEM_INSTANCIA.indexOf(melhor))) melhor = i;
  }
  return melhor;
}

const norm = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function areaPeloProcesso(p: { justica: Justica | null; classe?: string | null; assuntos?: string[] }): Area | null {
  if (p.justica === 'trabalho') return 'trabalhista';
  const txt = norm([p.classe || '', ...(p.assuntos || [])].join(' | '));
  if (!txt.trim()) return null;
  if (/beneficio|aposentadoria|auxilio|pensao por morte|bpc|loas|assistencial|salario.maternidade|previdenci|incapacidade/.test(txt)) return 'previdenciario';
  if (/alimentos|divorcio|guarda|uniao estavel|familia|paternidade|visita|curatela|interdicao|inventario|partilha/.test(txt)) return 'familia';
  if (/consumidor|bancari|emprestimo|consignado|cartao de credito|rmc|rcc|tarifa|seguro|telefonia|fornecimento de energia|cobranca indevida|negativacao|inclusao indevida|repeticao de indebito|contratos? bancario/.test(txt)) return 'consumidor';
  if (/trabalh|reclamacao trabalhista/.test(txt)) return 'trabalhista';
  if (p.justica === 'federal' && /fgts|pis|seguro.desemprego/.test(txt)) return 'civel';
  if (/indenizacao|dano|obrigacao|contrato|cobranca|despejo|locacao|posse|usucapiao|execucao|responsabilidade civil|civel/.test(txt)) return 'civel';
  return 'outro';
}

// ── Temperatura pelas decisões ──────────────────────────────────────────────

export interface MovParaDecisao { movement_date: string | Date | null; title: string | null; description?: string | null }
export interface ResultadoTemperatura {
  temperatura: Temperatura;
  confianca: 'alta' | 'media' | null;
  decisao: string | null;
  decisao_em: string | null;
  motivo: string;
}

type Efeito = 'favor' | 'contra' | 'recurso_provido' | 'recurso_nao_provido' | 'recurso_parcial';

/** Efeito de uma movimentação do ponto de vista do AUTOR. null = não é decisão de mérito. */
export function efeitoDaMovimentacao(titulo: string | null): Efeito | null {
  const t = norm(titulo || '').replace(/^(je|tr|g1|g2|1º grau|2º grau|1o grau|2o grau)\s*[—-]\s*/, '').trim();
  if (!t) return null;
  if (/^improcedencia|^indeferimento da peticao inicial|inadmissibilidade do procedimento|^extincao do processo sem|sem resolucao do merito|^prescricao|^decadencia|^abandono de causa|^perempcao|^litispendencia|^coisa julgada/.test(t)) return 'contra';
  if (/^procedencia|^homologacao de transacao|^homologacao de acordo|execucao\/cumprimento de sentenca iniciad|^acordo/.test(t)) return 'favor';
  if (/^conhecimento em parte e nao.provimento|^nao.provimento|^nao conhecimento/.test(t)) return 'recurso_nao_provido';
  if (/^provimento em parte|^conhecimento em parte e provimento/.test(t)) return 'recurso_parcial';
  if (/^provimento/.test(t)) return 'recurso_provido';
  return null;
}

const dataIso = (d: string | Date | null) => (d ? (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10) : null);

/**
 * poloCliente: 'ativo' (autora), 'passivo' (ré) ou null (desconhecido: trata
 * como autora, que é o caso da maioria do escritório, e baixa a confiança).
 */
export function temperaturaPelasDecisoes(movs: MovParaDecisao[], poloCliente: string | null): ResultadoTemperatura {
  const ordenadas = [...movs].filter((m) => m.movement_date).sort((a, b) => String(dataIso(a.movement_date)).localeCompare(String(dataIso(b.movement_date))));
  let estado: 'favor' | 'contra' | null = null; // para o autor
  let viaRecurso = false;
  let ultima: MovParaDecisao | null = null;
  for (const m of ordenadas) {
    const e = efeitoDaMovimentacao(m.title);
    if (!e) continue;
    if (e === 'favor' || e === 'contra') { estado = e; viaRecurso = false; ultima = m; continue; }
    // Recurso: sem sentença conhecida antes, não dá para saber quem recorreu.
    if (!estado) { ultima = m; continue; }
    viaRecurso = true; ultima = m;
    if (e === 'recurso_provido') estado = estado === 'favor' ? 'contra' : 'favor';
    // não provido: mantém; provido em parte: mantém o lado, mas com confiança média
  }
  const passivo = poloCliente === 'passivo';
  if (!ultima) return { temperatura: 'morno', confianca: null, decisao: null, decisao_em: null, motivo: 'Sem decisão de mérito registrada.' };
  if (!estado) {
    return { temperatura: 'morno', confianca: null, decisao: ultima.title, decisao_em: dataIso(ultima.movement_date), motivo: 'Recurso julgado, mas sem a sentença anterior registrada: não dá para saber quem recorreu.' };
  }
  const nosso = passivo ? (estado === 'favor' ? 'contra' : 'favor') : estado;
  return {
    temperatura: nosso === 'favor' ? 'quente' : 'frio',
    confianca: viaRecurso || !poloCliente ? 'media' : 'alta',
    decisao: ultima.title,
    decisao_em: dataIso(ultima.movement_date),
    motivo: [
      nosso === 'favor' ? 'Decisão a nosso favor' : 'Decisão contra nós',
      viaRecurso ? '(depois de recurso: quem recorre costuma ser quem perdeu)' : '',
      passivo ? '— cliente é ré' : poloCliente ? '' : '— polo da cliente não informado, considerado autora',
    ].filter(Boolean).join(' '),
  };
}
