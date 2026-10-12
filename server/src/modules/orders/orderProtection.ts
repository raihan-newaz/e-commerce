import crypto from 'node:crypto';
import net from 'node:net';
import type { Prisma } from '@prisma/client';
import prisma from '../../prisma';

export type OrderSource = 'STOREFRONT' | 'LANDING' | 'STUDIO_FORM' | 'WOOCOMMERCE' | 'STAFF' | 'INCOMPLETE';
export type RiskInput = { phone: string; address: string; items: Array<{ productId?: string | null; variantId?: string | null; quantity: number }>; ip?: string | null; source: OrderSource; external?: boolean; override?: boolean };
export type RiskResult = { decision: 'ALLOW' | 'HOLD' | 'BLOCK'; reasons: string[]; fingerprint: string; phone: string; ip: string | null };
type Tx = Prisma.TransactionClient;

export const normalizeOrderPhone = (value: string) => {
  let phone = String(value || '').replace(/[^\d+]/g, '');
  if (phone.startsWith('+880')) phone = `0${phone.slice(4)}`;
  if (phone.startsWith('880')) phone = `0${phone.slice(3)}`;
  return phone;
};
export const normalizeClientIp = (value?: string | null) => {
  const ip = String(value || '').replace(/^::ffff:/, '');
  return net.isIP(ip) ? ip : null;
};
const normalizeAddress = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
export const orderFingerprint = (phone: string, address: string, items: RiskInput['items']) => crypto.createHash('sha256').update(JSON.stringify({
  phone: normalizeOrderPhone(phone), address: normalizeAddress(address),
  items: items.map(item => [item.productId || '', item.variantId || '', Number(item.quantity)]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
})).digest('hex');

export async function protectionSettings(tx: Tx | typeof prisma = prisma) {
  return tx.orderProtectionSettings.upsert({ where: { id: 'default' }, create: { id: 'default' }, update: {} });
}

export async function lockRiskSubjects(tx: Tx, phone: string, ip: string | null) {
  const keys = [`phone:${crypto.createHash('sha256').update(phone).digest('hex')}`, ...(ip ? [`ip:${crypto.createHash('sha256').update(ip).digest('hex')}`] : [])].sort();
  for (const key of keys) {
    await tx.orderRateLock.upsert({ where: { key }, create: { key }, update: { updatedAt: new Date() } });
    await tx.$queryRawUnsafe('SELECT updatedAt FROM OrderRateLock WHERE `key` = ? FOR UPDATE', key);
  }
}

export async function evaluateOrderRisk(tx: Tx, input: RiskInput): Promise<RiskResult> {
  const phone = normalizeOrderPhone(input.phone);
  const ip = normalizeClientIp(input.ip);
  const fingerprint = orderFingerprint(phone, input.address, input.items);
  const settings = await protectionSettings(tx);
  await lockRiskSubjects(tx, phone, ip);
  const now = Date.now();
  const from = (minutes: number) => new Date(now - minutes * 60_000);
  const [customer, ipBlock, duplicate, hourlyPhone, dailyPhone, hourlyIp, recentIpOrders, recentAddressOrders] = await Promise.all([
    tx.customer.findUnique({ where: { phone }, select: { isBlacklisted: true, riskScore: true, returnedOrders: true } }),
    ip ? tx.ipBlock.findUnique({ where: { ipAddress: ip } }) : Promise.resolve(null),
    tx.order.findFirst({ where: { orderFingerprint: fingerprint, createdAt: { gte: from(settings.duplicateWindowMinutes) } }, select: { id: true } }),
    tx.order.count({ where: { customerPhone: phone, createdAt: { gte: from(60) } } }),
    tx.order.count({ where: { customerPhone: phone, createdAt: { gte: from(1440) } } }),
    ip ? tx.order.count({ where: { sourceIp: ip, createdAt: { gte: from(60) } } }) : Promise.resolve(0),
    ip ? tx.order.findMany({ where: { sourceIp: ip, createdAt: { gte: from(1440) } }, select: { customerPhone: true }, take: 100 }) : Promise.resolve([]),
    tx.order.findMany({ where: { customerAddress: { not: '' }, createdAt: { gte: from(1440) } }, select: { customerPhone: true, customerAddress: true }, take: 500 }),
  ]);
  const block: string[] = [];
  const hold: string[] = [];
  if (customer?.isBlacklisted) block.push('BLACKLISTED_PHONE');
  if (ipBlock && !ipBlock.revokedAt && (!ipBlock.expiresAt || ipBlock.expiresAt.getTime() > now)) block.push('BLOCKED_IP');
  if (duplicate) block.push('EXACT_DUPLICATE');
  if (hourlyPhone >= settings.phoneHourlyLimit) block.push('PHONE_HOURLY_LIMIT');
  if (dailyPhone >= settings.phoneDailyLimit) block.push('PHONE_DAILY_LIMIT');
  if (ip && hourlyIp >= settings.ipHourlyLimit) block.push('IP_HOURLY_LIMIT');
  if ((customer?.riskScore || 0) > 60 || (customer?.returnedOrders || 0) > 2) hold.push('CUSTOMER_HISTORY');
  if (new Set(recentIpOrders.map(row => row.customerPhone)).size >= settings.sharedIpPhoneThreshold) hold.push('SHARED_IP');
  if (new Set(recentAddressOrders.filter(row => normalizeAddress(row.customerAddress) === normalizeAddress(input.address)).map(row => row.customerPhone)).size >= settings.sharedAddressPhoneThreshold) hold.push('SHARED_ADDRESS');
  const reasons = [...block, ...hold];
  const decision = block.length && !input.override ? input.external ? 'HOLD' : 'BLOCK' : hold.length || (block.length && input.override) ? 'HOLD' : 'ALLOW';
  return { decision, reasons, fingerprint, phone, ip };
}

export async function recordRiskDecision(tx: Tx, input: RiskInput, result: RiskResult, orderId?: string) {
  if (result.decision === 'ALLOW' && !result.reasons.length) return;
  await tx.orderRiskEvent.create({ data: { orderId, source: input.source, decision: result.decision, phone: result.phone, ipAddress: result.ip, reasons: result.reasons } });
  if (result.decision !== 'BLOCK' || !result.ip || input.external || input.source === 'STAFF') return;
  const settings = await protectionSettings(tx);
  const recent = await tx.orderRiskEvent.count({ where: { ipAddress: result.ip, decision: 'BLOCK', createdAt: { gte: new Date(Date.now() - settings.autoBlockWindowMinutes * 60_000) } } });
  if (recent >= settings.autoBlockRejectCount) {
    const existing = await tx.ipBlock.findUnique({ where: { ipAddress: result.ip } });
    if (!existing || existing.kind === 'AUTO' || existing.revokedAt) await tx.ipBlock.upsert({ where: { ipAddress: result.ip }, create: { ipAddress: result.ip, kind: 'AUTO', reason: 'Repeated rejected order attempts', expiresAt: new Date(Date.now() + settings.autoBlockMinutes * 60_000) }, update: { kind: 'AUTO', reason: 'Repeated rejected order attempts', revokedAt: null, expiresAt: new Date(Date.now() + settings.autoBlockMinutes * 60_000) } });
  }
}
