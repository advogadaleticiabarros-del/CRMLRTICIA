/**
 * Normaliza a origem de um lead (utm_source/utm_medium crus) num alias
 * legivel e estavel, usado tanto pra gravar leads.source quanto pros
 * agrupamentos do Dashboard Comercial. Fica num unico lugar pra Meta Ads,
 * Google Ads, Instagram organico etc sempre caírem no mesmo rotulo,
 * nao em variações soltas ("ig", "instagram", "IG")
 */

const PAID_MEDIUMS = ['cpc', 'ppc', 'paid', 'paid-social', 'ads', 'adwords'];

export const CANAIS = [
  'Meta Ads', 'Google Ads', 'Instagram (orgânico)', 'Facebook (orgânico)',
  'Google (orgânico)', 'WhatsApp', 'Indicação', 'Site (direto)', 'E-mail', 'Outro',
] as const;

export function normalizeChannel(input: {
  utm_source?: string | null;
  utm_medium?: string | null;
  fallback?: string | null;
}): string {
  const src = (input.utm_source || '').trim().toLowerCase();
  const medium = (input.utm_medium || '').trim().toLowerCase();
  const paid = PAID_MEDIUMS.includes(medium);

  const isMeta = ['fb', 'facebook', 'ig', 'instagram', 'meta'].includes(src);
  const isGoogle = ['google', 'google_ads', 'adwords', 'gads'].includes(src);

  if (isMeta && paid) return 'Meta Ads';
  if (isGoogle && paid) return 'Google Ads';
  if (['ig', 'instagram'].includes(src)) return 'Instagram (orgânico)';
  if (['fb', 'facebook', 'meta'].includes(src)) return 'Facebook (orgânico)';
  if (isGoogle) return 'Google (orgânico)';
  if (src === 'whatsapp') return 'WhatsApp';
  if (src === 'indicacao' || src === 'referral') return 'Indicação';
  if (src === 'email' || medium === 'email') return 'E-mail';

  const fb = (input.fallback || '').trim().toLowerCase();
  if (!src && (fb === 'site' || fb === '')) return 'Site (direto)';
  if (!src && fb) return input.fallback!.trim();

  return src ? input.utm_source!.trim() : 'Outro';
}
