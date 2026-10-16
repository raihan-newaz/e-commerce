import { randomBytes, randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../prisma';
import { config } from '../../config';
import { documentForms, FormInputError, validateSubmission } from './core/forms';
import { escapeHtml } from './core/registry';
import type { PageDocument } from './core/schema';
import { failure, validatedDocument } from './service';
import { getNextOrderNumber } from '../orders/orderNumberService';
import { evaluateOrderRisk, recordRiskDecision } from '../orders/orderProtection';
import { saveOrderCourierSuggestions } from '../couriers/orderLocationService';
import { draftTokenHash } from '../orders/incompleteOrderRoutes';

const cookieName = 'nix_builder_form';
const cookieValue = (req: Request) => (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || '';
const signature = (cookie: string, pageId: string, formId: string, version: number, expiry: number, id: string) => createHmac('sha256', config.jwtSecret).update([cookie, pageId, formId, version, expiry, id].join(':')).digest('hex');
export function createFormToken(cookie: string, pageId: string, formId: string, version: number, expiry = Date.now() + 30 * 60 * 1000) {
  const id = randomUUID(); return `${expiry}.${id}.${signature(cookie, pageId, formId, version, expiry, id)}`;
}
export function verifyFormToken(token: string, cookie: string, pageId: string, formId: string, version: number, now = Date.now()): string {
  const match = /^(\d{13})\.([a-f\d-]{36})\.([a-f\d]{64})$/.exec(token);
  if (!match || !/^[a-f\d]{64}$/.test(cookie)) throw failure(403, 'Your form session is invalid. Reload the page.');
  const expiry = Number(match[1]);
  if (expiry < now || expiry > now + 31 * 60 * 1000) throw failure(403, 'This form has expired. Reload the page.');
  const expected = signature(cookie, pageId, formId, version, expiry, match[2]);
  if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(match[3], 'hex'))) throw failure(403, 'Your form session changed. Reload the page.');
  return match[2];
}
export function formRenderContext(req: Request, res: Response, pageId: string, version: number, doc: PageDocument) {
  const forms = documentForms(doc); if (!forms.length) return undefined;
  let cookie = cookieValue(req);
  if (!/^[a-f\d]{64}$/.test(cookie)) cookie = randomBytes(32).toString('hex');
  res.cookie(cookieName, cookie, { httpOnly: true, secure: !config.isDev, sameSite: 'strict', path: '/b', maxAge: 24 * 60 * 60 * 1000 });
  return Object.fromEntries(forms.map(({ node }) => { const token = createFormToken(cookie, pageId, node.id, version); return [node.id, { action: `/b/${doc.slug}/forms/${node.id}`, token, draftToken: token.split('.')[1] }]; }));
}
const receipt = (title: string, messages: string[], slug: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)}</title><style>body{font:16px/1.7 system-ui,sans-serif;color:#193d2c;background:#f3f7ef;margin:0;padding:clamp(24px,8vw,100px)}main{max-width:700px;margin:auto;padding:40px;background:white;border-radius:12px}a{color:#176b53}</style></head><body><main><h1>${escapeHtml(title)}</h1>${messages.map(value => `<p>${escapeHtml(value)}</p>`).join('')}<a href="/b/${escapeHtml(slug)}">Return to the page</a></main></body></html>`;

async function processOrderFromSubmission(values: Record<string, string>, pageSlug: string, submissionId: string, draftToken: string, ip: string) {
  const customerName = (values.customer_name || values.name || '').trim();
  const customerPhone = (values.customer_phone || values.phone || '').trim();
  const customerAddress = (values.customer_address || values.address || '').trim();
  const productId = values.product_id || '';
  const productSku = values.product_sku || '';
  // Generic Studio forms remain contact submissions. Order forms need explicit product and contact fields.
  if (!customerName || !customerPhone || !customerAddress || (!productId && !productSku)) return;
  if (!/^01[3-9]\d{8}$/.test(customerPhone.replace(/\D/g, '').replace(/^880/, '0'))) throw failure(400, 'Enter a valid Bangladesh phone number before placing the order.');
  const quantity = Number(values.quantity || '1');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) throw failure(400, 'Order quantity must be between 1 and 10.');
  const orderNumber = `ST-${submissionId.replace(/-/g, '').slice(0, 20).toUpperCase()}`;
  const created = await prisma.$transaction(async tx => {
    const prior = await tx.order.findUnique({ where: { orderNumber } });
    if (prior) return prior;
    const draft = await tx.incompleteCheckout.findUnique({ where: { tokenHash: draftTokenHash(draftToken) } });
    if (draft) {
      await tx.$queryRaw`SELECT id FROM IncompleteCheckout WHERE id = ${draft.id} FOR UPDATE`;
      const fresh = await tx.incompleteCheckout.findUniqueOrThrow({ where: { id: draft.id } });
      if (fresh.orderId) return tx.order.findUniqueOrThrow({ where: { id: fresh.orderId } });
    }
    const product = productId ? await tx.product.findUnique({ where: { id: productId } }) : await tx.product.findUnique({ where: { sku: productSku } });
    if (!product || product.status !== 'ACTIVE' || product.productType === 'VARIABLE') throw failure(409, 'The selected product is unavailable. Please choose an active simple product.');
    const changed = await tx.product.updateMany({ where: { id: product.id, status: 'ACTIVE', stockQuantity: { gte: quantity } }, data: { stockQuantity: { decrement: quantity } } });
    if (!changed.count) throw failure(409, 'The selected product is out of stock.');
    const riskInput = { phone: customerPhone, address: customerAddress, items: [{ productId: product.id, quantity }], ip, source: 'STUDIO_FORM' as const };
    const risk = await evaluateOrderRisk(tx, riskInput);
    if (risk.decision === 'BLOCK') {
      throw Object.assign(failure(409, `Order blocked by protection rule: ${risk.reasons.join(', ')}`), { riskInput, risk });
    }
    const unitPrice = product.salePrice > 0 ? product.salePrice : product.regularPrice;
    if (unitPrice <= 0) throw failure(409, 'The selected product has no valid selling price.');
    const subtotal = unitPrice * quantity;
    const shippingText = values.shipping_area || values.delivery_area || values.shipping_method || '';
    const match = shippingText.match(/৳\s*(\d+)/) || shippingText.match(/(\d+)\s*(?:টাকা|tk|bdt)/i);
    const deliveryCharge = match ? Number(match[1]) : /বাইরে/.test(shippingText) ? 150 : /সাব/.test(shippingText) ? 130 : 70;
    const grandTotal = subtotal + deliveryCharge;
    const customer = await tx.customer.upsert({ where: { phone: risk.phone }, create: { name: customerName, phone: risk.phone, address: customerAddress, totalOrders: 1, totalSpent: grandTotal }, update: { totalOrders: { increment: 1 }, totalSpent: { increment: grandTotal } } });
    const order = await tx.order.create({ data: { orderNumber, customerId: customer.id, customerName, customerPhone: risk.phone, customerAddress, status: risk.decision === 'HOLD' ? 'HOLD' : 'PENDING', paymentMethod: 'COD', paymentStatus: 'PENDING', subtotal, deliveryCharge, grandTotal, codAmount: grandTotal, cogsCost: product.buyPrice * quantity, sourceChannel: 'STUDIO_FORM', sourceIp: risk.ip, orderFingerprint: risk.fingerprint, riskReasons: risk.reasons, riskReviewStatus: risk.decision === 'HOLD' ? 'REVIEW_REQUIRED' : 'CLEAR', isFraudSuspect: risk.reasons.length > 0, isDuplicate: risk.reasons.includes('EXACT_DUPLICATE'), customerNote: `Studio order (/b/${pageSlug})`, checkoutDetails: JSON.stringify(values), items: { create: [{ productId: product.id, productName: product.name, productSku: product.sku, quantity, unitPrice, unitBuyPrice: product.buyPrice, totalPrice: subtotal, totalBuyPrice: product.buyPrice * quantity }] } } });
    await tx.stockMovement.create({ data: { productId: product.id, type: 'SALE_DEDUCTION', quantity: -quantity, previousStock: product.stockQuantity, currentStock: product.stockQuantity - quantity, note: 'Studio form order', createdById: null } });
    if (draft) await tx.incompleteCheckout.update({ where: { id: draft.id }, data: { status: 'CONVERTED', orderId: order.id } });
    await recordRiskDecision(tx, riskInput, risk, order.id);
    return order;
  });
  try { void saveOrderCourierSuggestions(created.id, created).catch(() => console.warn('Courier address matching queued task failed')); }
  catch (error) { console.warn('Courier area matching was unavailable for Studio order:', error); }
}

export async function submitBuilderForm(req: Request, res: Response, next: NextFunction) {
  try {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    const origin = req.get('origin');
    if (!origin || (origin !== `${req.protocol}://${req.get('host')}` && !config.clientUrls.includes(origin))) throw failure(403, 'Form submission origin is not allowed');
    if (typeof req.params.slug !== 'string' || req.params.slug.length > 120 || !/^[a-f\d-]{36}$/.test(String(req.params.formId))) throw failure(404, 'Form not found');
    const page = await prisma.builderPage.findUnique({ where: { publishedSlug: req.params.slug } });
    if (!page?.published || !page.publishedVersion) throw failure(404, 'Form is not published');
    const doc = validatedDocument(JSON.parse(page.published)); const form = documentForms(doc).find(form => form.node.id === req.params.formId);
    if (!form) throw failure(404, 'Form not found');
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || typeof req.body._token !== 'string') throw failure(400, 'Invalid form submission');
    const id = verifyFormToken(req.body._token, cookieValue(req), page.id, form.node.id, page.publishedVersion);
    if (req.body._website) throw failure(400, 'Please leave the anti-spam field empty');
    let values: Record<string, string>;
    try { values = validateSubmission(form, req.body); }
    catch (error) { if (error instanceof FormInputError) { res.status(400).type('html').send(receipt(error.message, error.fields, doc.slug)); return; } throw error; }
    try {
      await prisma.builderSubmission.create({ data: { id, pageId: page.id, formId: form.node.id, formName: String(form.node.props.formName), pageVersion: page.publishedVersion, data: JSON.stringify(values) } });
    } catch (error) {
      // Replaying the exact signed submission token cannot create a second record.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      if (await prisma.order.findUnique({ where: { orderNumber: `ST-${id.replace(/-/g, '').slice(0, 20).toUpperCase()}` } })) {
        res.status(200).type('html').send(receipt('Response received', [String(form.node.props.successMessage || 'Thank you. Your response has been received.')], doc.slug)); return;
      }
    }

    // Automatically create OMS order if submission contains customer order fields
    try { await processOrderFromSubmission(values, doc.slug, id, String(req.body._draft_token || id), req.ip || ''); }
    catch (error) { if (error instanceof Error && 'status' in error && typeof error.status === 'number') { if ('riskInput' in error && 'risk' in error) await prisma.$transaction(tx => recordRiskDecision(tx, (error as any).riskInput, (error as any).risk)); res.status(error.status).type('html').send(receipt('Order needs attention', [error.message], doc.slug)); return; } throw error; }

    res.status(200).type('html').send(receipt('Response received', [String(form.node.props.successMessage || 'Thank you. Your response has been received.')], doc.slug));
  } catch (error) {
    if (error instanceof Error && 'status' in error && typeof error.status === 'number' && error.status >= 400 && error.status < 500) { res.status(error.status).json({ message: error.message }); return; }
    next(error);
  }
}

