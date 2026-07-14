import { db } from '../config/database';

let partnerColumnReady: boolean | null = null;

export async function ensurePartnerLawyersColumn(): Promise<boolean> {
  if (partnerColumnReady !== null) return partnerColumnReady;

  try {
    const [cols] = await db.query(
      "SELECT COUNT(*) AS total FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'propostas' AND COLUMN_NAME = 'partner_lawyers'"
    ) as any;

    if (Number(cols?.[0]?.total || 0) > 0) {
      partnerColumnReady = true;
      return true;
    }

    await db.query('ALTER TABLE propostas ADD COLUMN partner_lawyers TEXT NULL');
    partnerColumnReady = true;
    return true;
  } catch (err: any) {
    if (err?.code === 'ER_DUP_FIELDNAME') {
      partnerColumnReady = true;
      return true;
    }
    console.error('partner_lawyers column unavailable:', err?.message || err);
    partnerColumnReady = false;
    return false;
  }
}
