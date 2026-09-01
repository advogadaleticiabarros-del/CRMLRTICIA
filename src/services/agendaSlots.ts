/**
 * Todas as datas/horas aqui são strings locais Brasília, formato
 * "YYYY-MM-DDTHH:MM" (mesma convenção que localParaUtcMysql em
 * src/utils/timezone.ts espera na entrada). Brasil não observa horário de
 * verão desde 2019 — o offset -03:00 é fixo, não há ambiguidade de fuso
 * dentro desta função.
 */

export interface Expediente {
  diasSemana: number[];       // 1=segunda ... 7=domingo
  horaInicio: string;         // "HH:MM"
  horaFim: string;            // "HH:MM"
  duracaoConsultaMin: number; // minutos
}

export interface IntervaloEvento {
  start_datetime: string; // "YYYY-MM-DDTHH:MM" local Brasília
  end_datetime: string;   // "YYYY-MM-DDTHH:MM" local Brasília
}

export interface Slot {
  start_datetime: string; // "YYYY-MM-DDTHH:MM" local Brasília
  end_datetime: string;   // "YYYY-MM-DDTHH:MM" local Brasília
}

const DEFAULT_EXPEDIENTE: Expediente = {
  diasSemana: [1, 2, 3, 4, 5],
  horaInicio: '09:00',
  horaFim: '18:00',
  duracaoConsultaMin: 60,
};

/**
 * Converte as strings cruas de office_settings (setting_value é sempre
 * texto) para o Expediente tipado, aplicando os defaults do spec quando a
 * chave está ausente ou vazia (mesmo padrão de "linha ausente = default"
 * que o resto do office_settings já usa via KEYS/out[k]='').
 */
export function parseExpedienteDeOfficeSettings(settings: Record<string, string>): Expediente {
  const diasRaw = (settings.agenda_dias_semana || '').trim();
  const diasSemana = diasRaw
    ? diasRaw.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => n >= 1 && n <= 7)
    : DEFAULT_EXPEDIENTE.diasSemana;

  const horaInicio = /^\d{2}:\d{2}$/.test(settings.agenda_hora_inicio || '')
    ? settings.agenda_hora_inicio
    : DEFAULT_EXPEDIENTE.horaInicio;

  const horaFim = /^\d{2}:\d{2}$/.test(settings.agenda_hora_fim || '')
    ? settings.agenda_hora_fim
    : DEFAULT_EXPEDIENTE.horaFim;

  const duracaoParsed = parseInt(settings.agenda_duracao_consulta_min || '', 10);
  const duracaoConsultaMin = duracaoParsed > 0 ? duracaoParsed : DEFAULT_EXPEDIENTE.duracaoConsultaMin;

  return {
    diasSemana: diasSemana.length ? diasSemana : DEFAULT_EXPEDIENTE.diasSemana,
    horaInicio,
    horaFim,
    duracaoConsultaMin,
  };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function addMinutesToLocalStr(dateStr: string, minutes: number): string {
  // dateStr: "YYYY-MM-DD", minutes: minutos desde 00:00 do próprio dia.
  // Constrói a string local diretamente (sem passar por Date/UTC) — evita
  // qualquer risco de deslocamento de fuso ao manipular só o relógio do dia.
  const totalMin = minutes;
  const hh = pad2(Math.floor(totalMin / 60));
  const mm = pad2(totalMin % 60);
  return `${dateStr}T${hh}:${mm}`;
}

// getDay() da string local: 0=domingo..6=sábado (JS nativo) — convertido
// para a convenção do spec (1=segunda..7=domingo) sem depender de fuso,
// já que só usamos a parte da data (meio-dia UTC neutraliza qualquer
// deslocamento de fuso ao extrair o dia da semana).
function diaSemanaISO(dateStr: string): number {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const jsDay = d.getUTCDay(); // 0=domingo..6=sábado
  return jsDay === 0 ? 7 : jsDay;
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function addDaysToDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "Agora" em Brasília, como string local "YYYY-MM-DDTHH:MM" — mesmo offset
 * fixo -03:00 usado no resto deste arquivo (Brasil não observa horário de
 * verão desde 2019). Usado só pra filtrar slot de hoje que já passou. */
export function agoraLocalStr(): string {
  const localMs = Date.now() - 3 * 60 * 60 * 1000;
  return new Date(localMs).toISOString().slice(0, 16);
}

/**
 * Gera todos os slots de agenda_duracao_consulta_min dentro do expediente
 * configurado, nos dias úteis configurados, entre dataInicioStr e
 * dataFimStr (inclusive), removendo os que colidem com qualquer evento em
 * eventosExistentes (checagem de sobreposição de intervalo, não só mesmo
 * horário exato) e os que já passaram — sem isso, pedir slots "de hoje"
 * às 18h da tarde sugeria horário das 9h da manhã do mesmo dia (bug real,
 * achado testando a sugestão automática de horário no chat do WhatsApp).
 */
export function calcularSlotsDisponiveis(
  expediente: Expediente,
  eventosExistentes: IntervaloEvento[],
  dataInicioStr: string,  // "YYYY-MM-DD"
  dataFimStr: string,     // "YYYY-MM-DD"
  agoraStr: string = agoraLocalStr() // injetável nos testes; produção usa o relógio real
): Slot[] {
  const slots: Slot[] = [];
  const inicioMin = toMinutes(expediente.horaInicio);
  const fimMin = toMinutes(expediente.horaFim);
  const duracao = expediente.duracaoConsultaMin;
  const agora = agoraStr;

  let dia = dataInicioStr;
  while (dia <= dataFimStr) {
    if (expediente.diasSemana.includes(diaSemanaISO(dia))) {
      for (let cursor = inicioMin; cursor + duracao <= fimMin; cursor += duracao) {
        const start = addMinutesToLocalStr(dia, cursor);
        const end = addMinutesToLocalStr(dia, cursor + duracao);
        if (start <= agora) continue;
        const colide = eventosExistentes.some((ev) =>
          overlaps(start, end, ev.start_datetime, ev.end_datetime)
        );
        if (!colide) slots.push({ start_datetime: start, end_datetime: end });
      }
    }
    dia = addDaysToDateStr(dia, 1);
  }

  return slots;
}
