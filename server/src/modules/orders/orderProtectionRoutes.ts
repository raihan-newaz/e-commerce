import { pendingLocationJobs, invalidateCourierCatalog } from '../couriers/locationQueue';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import prisma from '../../prisma';
import { authenticateToken, requireRole, type AuthRequest } from '../../middlewares/auth';
import { logAudit } from '../audit/auditService';
import { normalizeLocation } from '../couriers/courierLocations';
import { saveOrderCourierSuggestions, validateCourierSelection } from '../couriers/orderLocationService';
import { normalizeClientIp, protectionSettings } from './orderProtection';

const router = Router();
router.use(authenticateToken);
const run = (handler: (req: AuthRequest, res: Response) => Promise<void>) => (req: Request, res: Response) => { Promise.resolve(handler(req as AuthRequest, res)).catch(error => res.status(500).json({ success: false, message: error.message })); };
const providerSchema = z.enum(['STEADFAST', 'PATHAO', 'REDX']);
const settingsSchema = z.object({
  duplicateWindowMinutes: z.number().int().min(1).max(1440), phoneHourlyLimit: z.number().int().min(1).max(100),
  phoneDailyLimit: z.number().int().min(1).max(500), ipHourlyLimit: z.number().int().min(1).max(500),
  autoBlockRejectCount: z.number().int().min(1).max(100), autoBlockWindowMinutes: z.number().int().min(1).max(1440),
  autoBlockMinutes: z.number().int().min(1).max(10080), sharedIpPhoneThreshold: z.number().int().min(2).max(50),
  sharedAddressPhoneThreshold: z.number().int().min(2).max(50),
});

router.get('/settings', requireRole(['SUPER_ADMIN', 'OPERATIONS_MANAGER']), run(async (_req, res) => {
  res.json({ success: true, settings: await protectionSettings() });
}));
router.put('/settings', requireRole(['SUPER_ADMIN']), run(async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, message: parsed.error.issues[0]?.message || 'Invalid settings' }); return; }
  const settings = await prisma.orderProtectionSettings.upsert({ where: { id: 'default' }, create: { id: 'default', ...parsed.data }, update: parsed.data });
  await logAudit({ userId: req.user?.id, userName: req.user?.name, action: 'UPDATE', entity: 'SETTING', entityId: 'order-protection', details: parsed.data, ipAddress: req.ip });
  res.json({ success: true, settings });
}));
router.get('/ip-blocks', requireRole(['SUPER_ADMIN', 'OPERATIONS_MANAGER']), run(async (_req, res) => {
  res.json({ success: true, blocks: await prisma.ipBlock.findMany({ orderBy: { updatedAt: 'desc' }, take: 200 }) });
}));
router.post('/ip-blocks', requireRole(['SUPER_ADMIN']), run(async (req, res) => {
  const parsed = z.object({ ipAddress: z.string().max(45), reason: z.string().trim().min(3).max(500), expiresAt: z.string().datetime().nullable().optional() }).safeParse(req.body);
  const ip = parsed.success ? normalizeClientIp(parsed.data.ipAddress) : null;
  if (!parsed.success || !ip) { res.status(400).json({ success: false, message: 'Enter a valid IP and reason' }); return; }
  const block = await prisma.ipBlock.upsert({ where: { ipAddress: ip }, create: { ipAddress: ip, reason: parsed.data.reason, expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null }, update: { kind: 'MANUAL', reason: parsed.data.reason, expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null, revokedAt: null } });
  await logAudit({ userId: req.user?.id, userName: req.user?.name, action: 'CREATE', entity: 'SETTING', entityId: block.id, details: { ipAddress: ip, reason: block.reason }, ipAddress: req.ip });
  res.json({ success: true, block });
}));
router.post('/ip-blocks/:id/revoke', requireRole(['SUPER_ADMIN']), run(async (req, res) => {
  const block = await prisma.ipBlock.update({ where: { id: String(req.params.id) }, data: { revokedAt: new Date() } });
  await logAudit({ userId: req.user?.id, userName: req.user?.name, action: 'UPDATE', entity: 'SETTING', entityId: block.id, details: { ipAddress: block.ipAddress, revoked: true }, ipAddress: req.ip });
  res.json({ success: true, block });
}));
router.get('/aliases', requireRole(['SUPER_ADMIN', 'OPERATIONS_MANAGER', 'DISPATCHER']), run(async (_req, res) => {
  res.json({ success: true, aliases: await prisma.courierLocationAlias.findMany({ orderBy: { createdAt: 'desc' }, take: 500 }) });
}));
router.post('/aliases', requireRole(['SUPER_ADMIN', 'OPERATIONS_MANAGER']), run(async (req, res) => {
  const parsed = z.object({ provider: providerSchema, level: z.enum(['DISTRICT', 'THANA', 'AREA']), locationId: z.string().uuid(), alias: z.string().trim().min(2).max(100) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, message: 'Choose a location and alias' }); return; }
  const location = await prisma.courierLocation.findUnique({ where: { id: parsed.data.locationId } });
  if (!location?.active || location.provider !== parsed.data.provider || location.level !== parsed.data.level) { res.status(400).json({ success: false, message: 'Location is unavailable' }); return; }
  const normalizedAlias = normalizeLocation(parsed.data.alias);
  const alias = await prisma.courierLocationAlias.upsert({ where: { provider_level_locationId_normalizedAlias: { provider: parsed.data.provider, level: parsed.data.level, locationId: location.id, normalizedAlias } }, create: { ...parsed.data, normalizedAlias }, update: { alias: parsed.data.alias } });
  invalidateCourierCatalog();
  await logAudit({ userId: req.user?.id, userName: req.user?.name, action: 'CREATE', entity: 'SETTING', entityId: alias.id, details: { locationId: location.id, alias: alias.alias }, ipAddress: req.ip });
  res.json({ success: true, alias });
}));
router.delete('/aliases/:id', requireRole(['SUPER_ADMIN', 'OPERATIONS_MANAGER']), run(async (req, res) => {
  const alias = await prisma.courierLocationAlias.delete({ where: { id: String(req.params.id) } });
  await logAudit({ userId: req.user?.id, userName: req.user?.name, action: 'DELETE', entity: 'SETTING', entityId: alias.id, details: { alias: alias.alias }, ipAddress: req.ip });
  res.json({ success: true });
}));
router.get('/orders/:id/locations', run(async (req, res) => {
  const locations = await prisma.orderCourierLocation.findMany({ where: { orderId: String(req.params.id) } });
  if (!locations.length && !pendingLocationJobs('MATCH:'+String(req.params.id)+':')) {
    const order = await prisma.order.findUnique({ where:{id:String(req.params.id)} });
    if (order && !order.trashedAt) void saveOrderCourierSuggestions(order.id,order).catch(()=>console.warn('Courier address match could not be queued'));
  }
  res.json({ success: true, locations, pending:pendingLocationJobs('MATCH:'+String(req.params.id)+':') });
}));
router.get('/orders/:id/risk-history', run(async (req, res) => {
  const id = String(req.params.id);
  const [events, reviews] = await Promise.all([
    prisma.orderRiskEvent.findMany({ where: { orderId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.auditLog.findMany({ where: { entity: 'ORDER', entityId: id }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, action: true, userName: true, details: true, createdAt: true } }),
  ]);
  res.json({ success: true, events, reviews: reviews.filter(item => item.details?.includes('riskReview') || item.details?.includes('risk review') || item.details?.includes('override')) });
}));
router.post('/orders/:id/locations/rematch', requireRole(['SUPER_ADMIN', 'OPERATIONS_MANAGER', 'DISPATCHER']), run(async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: String(req.params.id) } });
  if (!order) { res.status(404).json({ success: false, message: 'Order not found' }); return; }
  if (order.courierConsignmentId) { res.status(409).json({ success: false, message: 'Booked order location cannot be changed' }); return; }
  await saveOrderCourierSuggestions(order.id, order);
  res.json({ success: true, locations: await prisma.orderCourierLocation.findMany({ where: { orderId: order.id } }) });
}));
router.put('/orders/:id/locations/:provider', requireRole(['SUPER_ADMIN', 'OPERATIONS_MANAGER', 'DISPATCHER']), run(async (req, res) => {
  const provider = providerSchema.safeParse(req.params.provider);
  const parsed = z.object({ districtExternalId: z.string().max(80).nullable().optional(), thanaExternalId: z.string().max(80).nullable().optional(), areaExternalId: z.string().max(80).nullable().optional(), areaName: z.string().trim().max(100).nullable().optional() }).safeParse(req.body);
  if (!provider.success || !parsed.success) { res.status(400).json({ success: false, message: 'Invalid courier location' }); return; }
  const order = await prisma.order.findUnique({ where: { id: String(req.params.id) } });
  if (!order) { res.status(404).json({ success: false, message: 'Order not found' }); return; }
  if (order.courierConsignmentId) { res.status(409).json({ success: false, message: 'Booked order location cannot be changed' }); return; }
  const { districtExternalId, thanaExternalId, areaExternalId, areaName } = parsed.data;
  if (!await validateCourierSelection(provider.data, districtExternalId, thanaExternalId, areaExternalId)) { res.status(400).json({ success: false, message: 'Select a valid location hierarchy' }); return; }
  const location = await prisma.orderCourierLocation.upsert({ where: { orderId_provider: { orderId: order.id, provider: provider.data } }, create: { orderId: order.id, provider: provider.data, districtExternalId, thanaExternalId, areaExternalId, areaName, source: 'MANUAL', updatedById: req.user?.id }, update: { districtExternalId, thanaExternalId, areaExternalId, areaName, source: 'MANUAL', updatedById: req.user?.id } });
  await logAudit({ userId: req.user?.id, userName: req.user?.name, action: 'UPDATE', entity: 'ORDER', entityId: order.id, details: { provider: provider.data, location }, ipAddress: req.ip });
  res.json({ success: true, location });
}));
router.post('/orders/:id/review', requireRole(['SUPER_ADMIN', 'OPERATIONS_MANAGER']), run(async (req, res) => {
  const parsed = z.object({ decision: z.enum(['APPROVE', 'REJECT']), reason: z.string().trim().min(3).max(1000) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, message: 'Decision and reason are required' }); return; }
  const order = await prisma.order.findUnique({ where: { id: String(req.params.id) } });
  if (!order || order.status !== 'HOLD' || order.riskReviewStatus !== 'REVIEW_REQUIRED') { res.status(409).json({ success: false, message: 'This order is not awaiting fraud review' }); return; }
  if (parsed.data.decision === 'REJECT') { res.status(400).json({ success: false, message: 'Reject through the Cancelled status action so stock is restored' }); return; }
  const updated = await prisma.order.update({ where: { id: order.id }, data: { status: 'PENDING', riskReviewStatus: 'APPROVED' } });
  await logAudit({ userId: req.user?.id, userName: req.user?.name, action: 'UPDATE', entity: 'ORDER', entityId: order.id, details: { riskReview: parsed.data.decision, reason: parsed.data.reason }, ipAddress: req.ip });
  res.json({ success: true, order: updated });
}));

export default router;
