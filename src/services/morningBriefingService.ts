import { db } from '../config/database';
import { sendEmail } from './EmailService';

const BRAND = '#2a3f5f';
const CITY = process.env.BRIEFING_CITY || 'Vitória';

// Códigos WMO do Open-Meteo → descrição amigável (PT).
const WMO: Record<number, string> = {
  0: 'céu limpo', 1: 'predomínio de sol', 2: 'parcialmente nublado', 3: 'nublado',
  45: 'névoa', 48: 'névoa com geada', 51: 'garoa fraca', 53: 'garoa', 55: 'garoa intensa',
  61: 'chuva fraca', 63: 'chuva', 65: 'chuva forte', 71: 'neve fraca', 73: 'neve', 75: 'neve forte',
  80: 'pancadas de chuva', 81: 'pancadas de chuva', 82: 'pancadas fortes de chuva',
  95: 'trovoadas', 96: 'trovoadas com granizo', 99: 'trovoadas com granizo',
};

interface Weather { tmin: number; tmax: number; desc: string; city: string; }

/** Busca a previsão do dia via Open-Meteo (grátis, sem chave). Retorna null em falha. */
async function getWeather(): Promise<Weather | null> {
  try {
    const geo: any = await (await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(CITY)}&count=1&language=pt&country=BR`
    )).json();
    const loc = geo?.results?.[0];
    if (!loc) return null;
    const f: any = await (await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}` +
      `&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=America%2FSao_Paulo&forecast_days=1`
    )).json();
    const d = f?.daily;
    if (!d) return null;
    return {
      tmin: Math.round(d.temperature_2m_min?.[0]),
      tmax: Math.round(d.temperature_2m_max?.[0]),
      desc: WMO[d.weather_code?.[0]] || 'tempo variável',
      city: loc.name,
    };
  } catch { return null; }
}

const horaBR = "TIME_FORMAT(CONVERT_TZ(%s, '+00:00', '-03:00'), '%H:%i')";
const hojeBR = "DATE(CONVERT_TZ(%s, '+00:00', '-03:00')) = DATE(CONVERT_TZ(NOW(), '+00:00', '-03:00'))";

/** Coleta os compromissos, prazos e tarefas de HOJE (fuso de Brasília) de um usuário. */
async function getDayAgenda(userId: number) {
  const [eventos] = await db.query(
    `SELECT title, event_type, location, video_link,
            TIME_FORMAT(CONVERT_TZ(start_datetime,'+00:00','-03:00'),'%H:%i') AS hora
       FROM calendar_events
      WHERE user_id = ? AND DATE(CONVERT_TZ(start_datetime,'+00:00','-03:00')) = DATE(CONVERT_TZ(NOW(),'+00:00','-03:00'))
      ORDER BY start_datetime ASC`, [userId]) as any;

  const [prazos] = await db.query(
    `SELECT d.description, c.case_number, c.title AS case_title
       FROM deadlines d LEFT JOIN cases c ON c.id = d.case_id
      WHERE d.user_id = ? AND d.status = 'pendente'
        AND DATE(CONVERT_TZ(d.deadline_date,'+00:00','-03:00')) = DATE(CONVERT_TZ(NOW(),'+00:00','-03:00'))`, [userId]) as any;

  const [tarefas] = await db.query(
    `SELECT title, priority FROM tasks
      WHERE user_id = ? AND status NOT IN ('concluida','cancelada')
        AND due_date IS NOT NULL
        AND DATE(CONVERT_TZ(due_date,'+00:00','-03:00')) = DATE(CONVERT_TZ(NOW(),'+00:00','-03:00'))
      ORDER BY FIELD(priority,'critica','alta','media','baixa')`, [userId]) as any;

  return { eventos, prazos, tarefas };
}

/** Dicas do dia conforme o clima — em tom de cuidado. */
function weatherTip(w: Weather | null): string {
  if (!w) return 'Respire fundo, organize as prioridades e cuide de você hoje. 💛';
  const d = w.desc.toLowerCase();
  const tips: string[] = [];
  if (w.tmin <= 14) tips.push('A manhã está fria — agasalhe-se bem ao sair. 🧥');
  else if (w.tmax <= 20) tips.push('Vai esfriar durante o dia — não esqueça um casaco. 🧥');
  if (w.tmax >= 31) tips.push('Dia quente — beba bastante água e use protetor solar. ☀️');
  if (/chuva|garoa|pancadas|trovoad/.test(d)) tips.push('Tem chuva na previsão — leve o guarda-chuva. ☔');
  if (/limpo|sol/.test(d) && w.tmax >= 27) tips.push('Tempo seco e ensolarado — capriche na hidratação. 💧');
  if (/névoa/.test(d)) tips.push('Pode haver névoa cedo — atenção redobrada no trânsito. 🚗');
  if (!tips.length) tips.push('Tempo agradável pela frente — aproveite o dia. 😊');
  tips.push('E lembre-se: cuide de você também. 💛');
  return tips.join(' ');
}

function buildHtml(name: string, weather: Weather | null, agenda: any): string {
  const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' });
  const tipoLabel: Record<string, string> = { reuniao: '🤝 Reunião', audiencia: '⚖️ Audiência', compromisso: '📌 Compromisso', prazo: '⏰ Prazo', tarefa: '✓ Tarefa' };

  const weatherLine = weather
    ? `A previsão para <strong>${weather.city}</strong> hoje é de <strong>${weather.tmin}°C a ${weather.tmax}°C</strong>, com ${weather.desc}.`
    : `(Não consegui obter a previsão do tempo agora.)`;

  const evHtml = (agenda.eventos || []).map((e: any) =>
    `<li><strong>${e.hora}</strong> — ${tipoLabel[e.event_type] || '📌'} ${e.title}${e.location ? ` <span style="color:#93a0b5">(${e.location})</span>` : ''}${e.video_link ? ` · <a href="${e.video_link}">vídeo</a>` : ''}</li>`).join('');
  const przHtml = (agenda.prazos || []).map((p: any) =>
    `<li>⏰ <strong>Prazo:</strong> ${p.description}${p.case_number ? ` <span style="color:#93a0b5">(proc. ${p.case_number})</span>` : ''}</li>`).join('');
  const tskHtml = (agenda.tarefas || []).map((t: any) =>
    `<li>✓ ${t.title} <span style="color:#93a0b5">(${t.priority})</span></li>`).join('');

  const temAlgo = evHtml || przHtml || tskHtml;
  const corpo = temAlgo
    ? `<ul style="line-height:1.9;padding-left:18px;margin:8px 0">${evHtml}${przHtml}${tskHtml}</ul>`
    : `<p style="color:#51607a">Você não tem compromissos, prazos ou tarefas registrados para hoje. Bom dia tranquilo! ☕</p>`;

  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:580px;margin:0 auto;color:#1f2a3a">
    <div style="background:${BRAND};color:#fff;padding:24px 28px;border-radius:12px 12px 0 0">
      <div style="font-size:13px;color:#ceae72;text-transform:uppercase;letter-spacing:1px">${hoje}</div>
      <div style="font-size:22px;font-weight:bold;margin-top:4px">Bom dia, Dra. ${name}! ☀️</div>
    </div>
    <div style="border:1px solid #e7ecf3;border-top:none;padding:24px 28px;border-radius:0 0 12px 12px;background:#fff">
      <p style="font-size:15px">${weatherLine}</p>
      <div style="background:#fbf7ee;border-left:3px solid #ceae72;border-radius:8px;padding:12px 14px;margin:14px 0;font-size:14px;color:#51607a">
        <strong style="color:${BRAND}">💡 Dica do dia:</strong> ${weatherTip(weather)}
      </div>
      <h3 style="color:${BRAND};font-size:16px;margin:18px 0 6px">📅 Seu dia hoje</h3>
      ${corpo}
      <p style="margin-top:22px"><a href="https://crm.advogadaleticiabarros.com.br" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:bold">Abrir o CRM</a></p>
    </div>
    <p style="text-align:center;color:#93a0b5;font-size:11px;margin-top:14px">Resumo matinal automático — Advocacia Letícia Barros</p>
  </div>`;
}

/** Envia o resumo matinal para os usuários admin/advogado ativos com e-mail. */
export async function sendMorningBriefings(): Promise<{ sent: number; failed: number }> {
  const weather = await getWeather();
  const [users] = await db.query(
    "SELECT id, name, email FROM users WHERE active = 1 AND role IN ('admin','advogado') AND email IS NOT NULL AND email <> ''"
  ) as any;

  let sent = 0, failed = 0;
  const seen = new Set<string>();
  for (const u of users) {
    if (seen.has(u.email.toLowerCase())) continue;
    seen.add(u.email.toLowerCase());
    const agenda = await getDayAgenda(u.id);
    const firstName = (u.name || 'Dra.').split(' ')[0];
    const r = await sendEmail({
      to: u.email,
      subject: `☀️ Bom dia! Sua agenda de hoje`,
      html: buildHtml(firstName, weather, agenda),
    });
    if (r.ok) sent++; else failed++;
  }
  return { sent, failed };
}
