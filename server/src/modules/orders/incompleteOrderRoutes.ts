import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import prisma from '../../prisma';
import { config } from '../../config';
import { authenticateToken, requireRole, type AuthRequest } from '../../middlewares/auth';
import { logAudit } from '../audit/auditService';
import { saveOrderCourierSuggestions } from '../couriers/orderLocationService';
import { evaluateOrderRisk, normalizeClientIp, normalizeOrderPhone, recordRiskDecision } from './orderProtection';
import { calculateLandingDiscount } from '../storefront/landingCouponController';
import { landingDeliveryCharge } from '../storefront/deliveryPolicy';

const router = Router();
const run = (handler: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response) => { Promise.resolve(handler(req, res)).catch(error => res.status(error.status || 500).json({ success: false, message: error.message })); };
const itemSchema = z.object({ productId: z.string().uuid(), variantId: z.string().uuid().nullable().optional(), quantity: z.number().int().min(1).max(10) });
const draftSchema = z.object({ token: z.string().uuid(), source: z.enum(['STOREFRONT', 'LANDING', 'STUDIO_FORM']), pageSlug: z.string().max(120).optional(), customerName: z.string().trim().max(100).default(''), customerPhone: z.string().trim().min(10).max(18), address: z.string().trim().max(300).default(''), district: z.string().trim().max(80).optional(), city: z.string().trim().max(80).optional(), email: z.string().email().max(160).optional(), items: z.array(itemSchema).max(20).default([]), deliveryArea: z.enum(['DHAKA_CITY', 'SUB_AREA', 'OUTSIDE_DHAKA']).optional(), paymentMethod: z.enum(['COD', 'UDDOKTAPAY']).default('COD'), couponCode: z.string().trim().max(40).optional() });
export const draftTokenHash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

router.post('/public', rateLimit({ windowMs: 15 * 60_000, max: 60, standardHeaders: true, legacyHeaders: false }), run(async (req, res) => {
  const origin = req.get('origin');
  if (!origin || origin !== `${req.protocol}://${req.get('host')}` && !config.clientUrls.includes(origin)) { res.status(403).json({ success: false, message: 'Invalid checkout origin' }); return; }
  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success || !/^01[3-9]\d{8}$/.test(normalizeOrderPhone(parsed.data?.customerPhone || ''))) { res.status(400).json({ success: false, message: 'A valid Bangladesh mobile number is required' }); return; }
  const input = parsed.data;
  const ip = normalizeClientIp(req.ip);
  if (ip) {
    const block = await prisma.ipBlock.findUnique({ where: { ipAddress: ip } });
    if (block && !block.revokedAt && (!block.expiresAt || block.expiresAt > new Date())) { res.status(403).json({ success: false, message: 'Checkout is unavailable. Contact support.' }); return; }
  }
  const tokenHash = draftTokenHash(input.token);
  const existing = await prisma.incompleteCheckout.findUnique({ where: { tokenHash } });
  if (existing && !['OPEN', 'CONTACTED', 'NO_ANSWER'].includes(existing.status)) { res.status(409).json({ success: false, message: 'This checkout is already closed' }); return; }
  const data = { source: input.source, pageSlug: input.pageSlug, customerName: input.customerName, customerPhone: normalizeOrderPhone(input.customerPhone), address: input.address, district: input.district, city: input.city, email: input.email, items: input.items, deliveryArea: input.deliveryArea, paymentMethod: input.paymentMethod, couponCode: input.couponCode, ipAddress: ip, lastActivityAt: new Date() };
  const draft = await prisma.incompleteCheckout.upsert({ where: { tokenHash }, create: { tokenHash, ...data }, update: data });
  res.json({ success: true, id: draft.id });
}));

router.use(authenticateToken);
router.get('/', requireRole(['SUPER_ADMIN', 'OPERATIONS_MANAGER', 'CALL_CENTER_AGENT']), run(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const status = String(req.query.status || 'OPEN');
  if (!['OPEN', 'CONTACTED', 'NO_ANSWER', 'DECLINED', 'CONVERTED', 'DISCARDED'].includes(status)) { res.status(400).json({ success: false, message: 'Invalid status' }); return; }
  const where = { status };
  const [drafts, total] = await Promise.all([prisma.incompleteCheckout.findMany({ where, orderBy: { lastActivityAt: 'desc' }, skip: (page - 1) * 25, take: 25 }), prisma.incompleteCheckout.count({ where })]);
  const ids = [...new Set(drafts.flatMap(draft => (draft.items as Array<{ productId: string }>).map(item => item.productId)))];
  const products = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const names = new Map(products.map(product => [product.id, product.name]));
  res.json({ success: true, drafts: drafts.map(draft => ({ ...draft, productSummary: (draft.items as Array<{ productId: string; quantity: number }>).map(item => `${names.get(item.productId) || 'Unavailable product'} × ${item.quantity}`).join(', ') })), total, page });
}));
router.patch('/:id', requireRole(['SUPER_ADMIN', 'OPERATIONS_MANAGER', 'CALL_CENTER_AGENT']), run(async (req, res) => {
  const parsed = z.object({ status: z.enum(['OPEN', 'CONTACTED', 'NO_ANSWER', 'DECLINED', 'DISCARDED']).optional(), staffNote: z.string().trim().max(2000).optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, message: 'Invalid lead update' }); return; }
  const draft = await prisma.incompleteCheckout.findUnique({ where: { id: String(req.params.id) } });
  if (!draft || draft.orderId || draft.status === 'CONVERTED') { res.status(409).json({ success: false, message: 'Lead is unavailable' }); return; }
  const updated = await prisma.incompleteCheckout.update({ where: { id: draft.id }, data: parsed.data });
  const staff = req as AuthRequest;
  await logAudit({ userId: staff.user?.id, userName: staff.user?.name, action: 'UPDATE', entity: 'ORDER', entityId: draft.id, details: { incompleteLead: true, ...parsed.data }, ipAddress: req.ip });
  res.json({ success: true, draft: updated });
}));
router.delete('/:id', requireRole(['SUPER_ADMIN']), run(async (req, res) => {
  const draft = await prisma.incompleteCheckout.findUnique({ where: { id: String(req.params.id) } });
  if (!draft) { res.status(404).json({ success: false, message: 'Lead not found' }); return; }
  await prisma.incompleteCheckout.delete({ where: { id: draft.id } });
  const staff = req as AuthRequest;
  await logAudit({ userId: staff.user?.id, userName: staff.user?.name, action: 'DELETE', entity: 'ORDER', entityId: draft.id, details: { incompleteLead: true, phone: draft.customerPhone }, ipAddress: req.ip });
  res.json({ success: true });
}));
router.post('/:id/convert', requireRole(['SUPER_ADMIN', 'OPERATIONS_MANAGER', 'CALL_CENTER_AGENT']), run(async (req, res) => {
  const staff = req as AuthRequest;
  const overrideReason = typeof req.body?.overrideReason === 'string' ? req.body.overrideReason.trim() : '';
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT id FROM IncompleteCheckout WHERE id = ? FOR UPDATE', String(req.params.id));
    const draft = await tx.incompleteCheckout.findUnique({ where: { id: String(req.params.id) } });
    if (!draft) throw Object.assign(new Error('Lead not found'), { status: 404 });
    if (draft.orderId) return { order: await tx.order.findUniqueOrThrow({ where: { id: draft.orderId } }), created: false };
    if (['DECLINED', 'DISCARDED'].includes(draft.status)) throw Object.assign(new Error('Lead is closed'), { status: 409 });
    const items = draft.items as Array<{ productId: string; variantId?: string | null; quantity: number }>;
    if (draft.customerName.trim().length < 2 || draft.address.trim().length < 8 || !items.length) throw Object.assign(new Error('Complete the customer name, delivery address and product selection before creating an order.'), { status: 400 });
    const riskInput = { phone: draft.customerPhone, address: draft.address, items, ip: draft.ipAddress, source: 'INCOMPLETE' as const, override: staff.user?.role === 'SUPER_ADMIN' && overrideReason.length >= 3 };
    const risk = await evaluateOrderRisk(tx, riskInput);
    if (risk.decision === 'BLOCK') { await recordRiskDecision(tx, riskInput, risk); return { blocked: risk.reasons, created: false as const }; }
    const settings = await tx.storefrontSettings.findUnique({ where: { id: 'default' } });
    let freeDeliveryMinQuantity = 0;
    let couponDiscount = 0;
    let couponForConversion: { kind: string; value: number } | null = null;
    if (draft.source === 'LANDING' && draft.pageSlug) {
      const page = await tx.storePage.findUnique({ where: { slug: draft.pageSlug } });
      if (!page || page.status !== 'PUBLISHED' || !page.isActive) throw Object.assign(new Error('The landing offer is no longer available. Review the order with the customer.'), { status: 409 });
      const checkout = (JSON.parse(page.blocks) as Array<{ type: string; productIds?: string[]; selection?: string; minProducts?: number; maxProducts?: number; couponEnabled?: boolean; freeDeliveryMinQuantity?: number }>).find(block => block.type === 'CHECKOUT');
      const distinctIds = new Set(items.map(item => item.productId));
      const maximum = checkout?.selection === 'SINGLE' ? 1 : checkout?.maxProducts ?? checkout?.productIds?.length ?? 0;
      if (!checkout || distinctIds.size !== items.length || distinctIds.size < (checkout.minProducts ?? 1) || distinctIds.size > maximum || items.some(item => !checkout.productIds?.includes(item.productId))) throw Object.assign(new Error('The selected products no longer match this landing offer.'), { status: 409 });
      if (draft.couponCode) {
        if (checkout.couponEnabled === false) throw Object.assign(new Error('Coupons are disabled on this landing offer.'), { status: 409 });
        const coupon = await tx.landingCoupon.findUnique({ where: { pageId_code: { pageId: page.id, code: draft.couponCode } } });
        if (!coupon?.isActive) throw Object.assign(new Error('The saved coupon has expired or is unavailable.'), { status: 409 });
        couponForConversion = coupon;
      }
      freeDeliveryMinQuantity = checkout.freeDeliveryMinQuantity || 0;
    }
    const baseDeliveryCharge = draft.deliveryArea === 'OUTSIDE_DHAKA' ? settings?.outsideDhakaCharge || 150 : draft.deliveryArea === 'SUB_AREA' ? settings?.subAreaCharge || 130 : settings?.insideDhakaCharge || 60;
    const deliveryCharge = landingDeliveryCharge(baseDeliveryCharge, freeDeliveryMinQuantity, items);
    let subtotal = 0;
    let cogsCost = 0;
    const orderItems = [];
    for (const item of items) {
      const product = await tx.product.findUnique({ where: { id: item.productId }, include: { variants: true } });
      const variant = item.variantId ? product?.variants.find(row => row.id === item.variantId && row.status === 'ACTIVE') : null;
      if (!product || product.status !== 'ACTIVE' || product.productType === 'VARIABLE' && !variant) throw Object.assign(new Error('A product or variation is no longer available'), { status: 409 });
      const price = variant ? variant.salePrice > 0 ? variant.salePrice : variant.regularPrice : product.salePrice > 0 ? product.salePrice : product.regularPrice;
      if (price <= 0) throw Object.assign(new Error('A product cannot be ordered at its current price'), { status: 409 });
      if (variant) {
        const changed = await tx.productVariant.updateMany({ where: { id: variant.id, status: 'ACTIVE', stockQuantity: { gte: item.quantity } }, data: { stockQuantity: { decrement: item.quantity } } });
        if (!changed.count) throw Object.assign(new Error(`${product.name} variation is out of stock`), { status: 409 });
      }
      const changed = await tx.product.updateMany({ where: { id: product.id, status: 'ACTIVE', stockQuantity: { gte: item.quantity } }, data: { stockQuantity: { decrement: item.quantity } } });
      if (!changed.count) throw Object.assign(new Error(`${product.name} is out of stock`), { status: 409 });
      subtotal += price * item.quantity;
      cogsCost += (variant?.buyPrice ?? product.buyPrice) * item.quantity;
      orderItems.push({ productId: product.id, variantId: variant?.id, productName: product.name, variantName: variant?.name, productSku: variant?.sku || product.sku, quantity: item.quantity, unitPrice: price, unitBuyPrice: variant?.buyPrice ?? product.buyPrice, totalPrice: price * item.quantity, totalBuyPrice: (variant?.buyPrice ?? product.buyPrice) * item.quantity });
      await tx.stockMovement.create({ data: { productId: product.id, variantId: variant?.id, type: 'SALE_DEDUCTION', quantity: -item.quantity, previousStock: product.stockQuantity, currentStock: product.stockQuantity - item.quantity, note: 'Incomplete checkout converted by staff', createdById: staff.user?.id } });
    }
    if (couponForConversion) couponDiscount = calculateLandingDiscount(couponForConversion.kind, couponForConversion.value, subtotal);
    const customer = await tx.customer.upsert({ where: { phone: draft.customerPhone }, create: { name: draft.customerName, phone: draft.customerPhone, address: draft.address, district: draft.district, city: draft.city, totalOrders: 1 }, update: { totalOrders: { increment: 1 } } });
    const grandTotal = subtotal + deliveryCharge - couponDiscount;
    const order = await tx.order.create({ data: { orderNumber: `IC-${draft.id.replace(/-/g, '').slice(0, 20).toUpperCase()}`, customerId: customer.id, customerName: draft.customerName, customerPhone: draft.customerPhone, customerEmail: draft.email, customerAddress: draft.address, district: draft.district, city: draft.city, status: risk.decision === 'HOLD' ? 'HOLD' : 'PENDING', paymentMethod: 'COD', paymentStatus: 'PENDING', subtotal, discount: couponDiscount, deliveryCharge, grandTotal, codAmount: grandTotal, cogsCost, sourceChannel: 'INCOMPLETE', sourceIp: risk.ip, orderFingerprint: risk.fingerprint, riskReasons: risk.reasons, riskReviewStatus: risk.decision === 'HOLD' ? 'REVIEW_REQUIRED' : 'CLEAR', isFraudSuspect: risk.reasons.length > 0, isDuplicate: risk.reasons.includes('EXACT_DUPLICATE'), internalNote: `Confirmed by phone from incomplete checkout${draft.staffNote ? `: ${draft.staffNote}` : ''}${overrideReason ? `; override: ${overrideReason}` : ''}`, items: { create: orderItems } } });
    await tx.incompleteCheckout.update({ where: { id: draft.id }, data: { status: 'CONVERTED', orderId: order.id } });
    await recordRiskDecision(tx, riskInput, risk, order.id);
    return { order, created: true };
  });
  if ('blocked' in result && result.blocked) { res.status(409).json({ success: false, message: `Order blocked by protection rules: ${result.blocked.join(', ')}` }); return; }
  if (result.created) {
    try { void saveOrderCourierSuggestions(result.order.id, result.order).catch(() => console.warn('Courier address matching queued task failed')); }
    catch (error) { console.warn('Courier area matching was unavailable for converted order:', error); }
    await logAudit({ userId: staff.user?.id, userName: staff.user?.name, action: 'CREATE', entity: 'ORDER', entityId: result.order.id, details: { convertedFromIncomplete: String(req.params.id), overrideReason }, ipAddress: req.ip });
  }
  res.json({ success: true, order: result.order, created: result.created });
}));

export default router;
