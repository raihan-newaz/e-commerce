import { z } from 'zod';
import prisma from '../../prisma';
import { orderFingerprint } from './orderProtection';

const itemSchema = z.object({
  id: z.string().uuid().optional(), productId: z.string().uuid().nullable().optional(), variantId: z.string().uuid().nullable().optional(),
  productName: z.string().trim().min(1).max(250).optional(), quantity: z.number().int().min(1).max(999), unitPrice: z.number().finite().min(0).max(100_000_000),
});
const itemsSchema = z.array(itemSchema).min(1).max(100);
const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export async function amendOrder(id: string, fields: Record<string, unknown>, rawItems: unknown, expectedUpdatedAt: unknown, userId?: string) {
  const parsed = rawItems === undefined ? undefined : itemsSchema.safeParse(rawItems);
  if (parsed && !parsed.success) throw fail(400, parsed.error.issues[0]?.message || 'Check order items');
  return prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT id FROM `Order` WHERE id = ? FOR UPDATE', id);
    const current = await tx.order.findUnique({ where: { id }, include: { items: true } });
    if (!current) throw fail(404, 'Order not found');
    if (current.trashedAt) throw fail(409, 'Restore this order from Trash before editing');
    if (expectedUpdatedAt !== undefined && new Date(String(expectedUpdatedAt)).getTime() !== current.updatedAt.getTime()) throw fail(409, 'This order changed while you were editing. Reload before saving.');
    if (['BOOKING_REQUESTED', 'BOOKING_UNCERTAIN'].includes(current.courierStatus || '')) throw fail(409, 'Resolve the in-progress courier booking before changing its order payload');
    const next = [];
    for (const input of parsed?.success ? parsed.data : current.items) {
      const previous = input.id ? current.items.find(item => item.id === input.id) : undefined;
      if (input.id && !previous) throw fail(400, 'An item does not belong to this order');
      const productId = input.productId === undefined ? previous?.productId ?? null : input.productId;
      const variantId = input.variantId === undefined ? previous?.variantId ?? null : input.variantId;
      const product = productId ? await tx.product.findUnique({ where: { id: productId } }) : null;
      if (productId && !product) throw fail(409, 'A selected product no longer exists. Reload the order.');
      const variant = variantId ? await tx.productVariant.findUnique({ where: { id: variantId } }) : null;
      if (variantId && (!variant || variant.productId !== productId)) throw fail(400, 'Choose a variation belonging to the selected product');
      if (product?.productType === 'VARIABLE' && !variant && (!previous || previous.productId !== productId || previous.variantId !== variantId)) throw fail(400, 'Choose a product variation');
      if (!previous && product && product.status !== 'ACTIVE') throw fail(400, 'The selected product is not active');
      const same = previous?.productId === productId && previous?.variantId === variantId;
      const unitBuyPrice = same ? previous!.unitBuyPrice : variant?.buyPrice ?? product?.buyPrice ?? 0;
      const productName = input.productName || previous?.productName || product?.name;
      if (!productName) throw fail(400, 'Enter a name for the order item');
      next.push({ productId, variantId, productName, variantName: same ? previous?.variantName : variant?.name || null,
        color: variant?.color || (same ? previous?.color : null), size: variant?.size || (same ? previous?.size : null),
        productSku: same ? previous?.productSku : variant?.sku || product?.sku || '', quantity: input.quantity,
        unitPrice: round(input.unitPrice), unitBuyPrice, totalPrice: round(input.quantity * input.unitPrice), totalBuyPrice: round(input.quantity * unitBuyPrice) });
    }
    // Stock is reserved for active/delivered orders and already restored for
    // cancelled/returned orders. Apply only the difference, never deduct twice.
    if (parsed?.success && !['CANCELLED', 'RETURNED'].includes(current.status)) {
      const products = new Map<string, number>();
      const lines = new Map<string, { productId: string; variantId: string | null; delta: number }>();
      for (const [items, sign] of [[current.items, -1], [next, 1]] as const) for (const item of items) {
        if (!item.productId) continue;
        products.set(item.productId, (products.get(item.productId) || 0) + sign * item.quantity);
        const key = item.productId + ':' + (item.variantId || 'simple');
        const line = lines.get(key) || { productId: item.productId, variantId: item.variantId, delta: 0 };
        line.delta += sign * item.quantity; lines.set(key, line);
      }
      for (const [productId, delta] of [...products].sort(([a], [b]) => a.localeCompare(b))) {
        if (!delta) continue;
        const changed = await tx.product.updateMany({ where: { id: productId, ...(delta > 0 ? { stockQuantity: { gte: delta } } : {}) }, data: { stockQuantity: { decrement: delta } } });
        if (!changed.count) throw fail(409, 'Insufficient product stock for this quantity. No changes were saved.');
      }
      for (const [, line] of [...lines].sort(([a], [b]) => a.localeCompare(b))) {
        if (!line.delta) continue;
        if (line.variantId) {
          const changed = await tx.productVariant.updateMany({ where: { id: line.variantId, ...(line.delta > 0 ? { stockQuantity: { gte: line.delta } } : {}) }, data: { stockQuantity: { decrement: line.delta } } });
          if (!changed.count) throw fail(409, 'Insufficient variation stock. No changes were saved.');
        }
        const stock = line.variantId ? await tx.productVariant.findUniqueOrThrow({ where: { id: line.variantId } }) : await tx.product.findUniqueOrThrow({ where: { id: line.productId } });
        await tx.stockMovement.create({ data: { productId: line.productId, variantId: line.variantId, warehouseId: String(fields.warehouseId || current.warehouseId || '') || null,
          type: 'MANUAL_ADJUSTMENT', quantity: -line.delta, previousStock: stock.stockQuantity + line.delta, currentStock: stock.stockQuantity,
          note: `Order ${current.orderNumber} item amendment`, createdById: userId } });
      }
    }
    const comparable = (item: { productId: string | null; variantId: string | null; productName: string; quantity: number; unitPrice: number }) => [item.productId,item.variantId,item.productName,item.quantity,item.unitPrice];
    const itemsChanged = Boolean(parsed?.success) && JSON.stringify(current.items.map(comparable)) !== JSON.stringify(next.map(comparable));
    const subtotal = round(next.reduce((sum, item) => sum + item.totalPrice, 0));
    const deliveryCharge = Number(fields.deliveryCharge ?? current.deliveryCharge), discount = Number(fields.discount ?? current.discount), advancePaid = Number(fields.advancePaid ?? current.advancePaid);
    const grandTotal = round(Math.max(0, subtotal + deliveryCharge - discount));
    const collected = Math.max(current.courierCodReceived, current.paymentStatus === 'PAID' ? current.grandTotal - current.advancePaid : 0);
    const received = advancePaid + collected;
    const data: any = { ...fields, subtotal, grandTotal, cogsCost: round(next.reduce((sum, item) => sum + item.totalBuyPrice, 0)),
      codAmount: round(Math.max(0, grandTotal - received)),
      paymentStatus: current.paymentStatus === 'REFUNDED' ? 'REFUNDED' : received >= grandTotal && grandTotal > 0 ? 'PAID' : received > 0 ? 'PARTIAL' : 'PENDING',
      orderFingerprint: orderFingerprint(String(fields.customerPhone ?? current.customerPhone), String(fields.customerAddress ?? current.customerAddress), next) };
    const courierReview = Boolean(current.courierName) && (itemsChanged || ['customerName', 'customerPhone', 'customerAddress', 'district', 'city', 'zone', 'area', 'deliveryCharge', 'discount', 'advancePaid'].some(key => fields[key] !== undefined && String(fields[key] ?? '') !== String((current as any)[key] ?? '')));
    if (courierReview) {
      const marker = '[Courier review required] Order amended locally. Confirm address, products and COD against the existing courier booking.';
      const note = String(fields.internalNote ?? current.internalNote ?? '');
      data.internalNote = note.includes('[Courier review required]') ? note : `${note}${note ? '\n' : ''}${marker}`;
      if (grandTotal !== current.grandTotal) data.courierSettlementStatus = 'DISCREPANCY';
    }
    if (current.status === 'DELIVERED') {
      const nextCustomer = fields.customerId === undefined ? current.customerId : fields.customerId as string | null;
      if (current.customerId === nextCustomer && nextCustomer) await tx.customer.update({ where: { id: nextCustomer }, data: { totalSpent: { increment: round(grandTotal - current.grandTotal) } } });
      else {
        if (current.customerId) await tx.customer.update({ where: { id: current.customerId }, data: { completedOrders: { decrement: 1 }, totalSpent: { decrement: current.grandTotal } } });
        if (nextCustomer) await tx.customer.update({ where: { id: nextCustomer }, data: { completedOrders: { increment: 1 }, totalSpent: { increment: grandTotal } } });
      }
    }
    if (itemsChanged) data.items = { deleteMany: {}, create: next };
    const updated = await tx.order.update({ where: { id }, data, include: { items: true, assignedTo: { select: { id: true, name: true, phone: true } } } });
    return { order: updated, courierReview, itemsChanged, before: { grandTotal: current.grandTotal, items: current.items.map(item => ({ productId:item.productId,variantId:item.variantId,quantity:item.quantity,unitPrice:item.unitPrice })) } };
  }, { timeout: 30_000 });
}
