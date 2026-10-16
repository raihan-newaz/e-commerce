import prisma from '../../prisma';
import type { Request, Response } from 'express';

export type ReadyProvider = 'STEADFAST' | 'PATHAO' | 'REDX';
export async function availableCouriers() {
  const rows = await prisma.courierConfig.findMany();
  return (['STEADFAST', 'PATHAO', 'REDX'] as const).map(provider => {
    const config = rows.find(row => row.provider === provider);
    const missing: string[] = [];
    if (!config?.isEnabled) missing.push('enabled');
    if (provider === 'STEADFAST') { if (!config?.apiKey) missing.push('API key'); if (!config?.secretKey) missing.push('secret key'); }
    if (provider === 'PATHAO') for (const field of ['clientId', 'clientSecret', 'username', 'password', 'storeId'] as const) if (!config?.[field]) missing.push(field);
    if (provider === 'REDX') { if (!config?.apiKey) missing.push('API token'); if (!config?.storeId) missing.push('pickup store'); }
    if (provider !== 'STEADFAST' && config?.storeActive === false) missing.push('active pickup store');
    return { provider, ready: !missing.length, missing };
  });
}
export async function courierAvailability(_req: Request, res: Response) {
  try { res.json({ success: true, providers: await availableCouriers() }); }
  catch { res.status(503).json({ success: false, message: 'Courier configuration is temporarily unavailable' }); }
}
