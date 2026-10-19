import { Prisma } from '@prisma/client';

export async function transitionOrder(tx: Prisma.TransactionClient, currentOrder: Prisma.OrderGetPayload<{ include: { items: true } }>, status: string, userId?: string) {
  const id = currentOrder.id;
  if (currentOrder.trashedAt || (currentOrder.riskReviewStatus === 'REVIEW_REQUIRED' && !['HOLD', 'CANCELLED'].includes(status))) throw Object.assign(new Error('Order requires review'), { status: 409 });
  const allowed = ['PENDING', 'CONFIRMED', 'PACKAGING', 'HANDED_OVER', 'IN_TRANSIT', 'DELIVERED', 'PARTIAL_DELIVERED', 'CANCELLED', 'RETURNED', 'HOLD', 'FAKE_TRASH'];
  if (!allowed.includes(status)) throw Object.assign(new Error('Invalid status'), { status: 400 });
  if (currentOrder.status === status) return currentOrder;
  if (['CANCELLED', 'RETURNED'].includes(currentOrder.status) || (currentOrder.status === 'DELIVERED' && status !== 'RETURNED')) throw Object.assign(new Error('Terminal order cannot be reopened'), { status: 409 });
  const prevStatus = currentOrder.status;
  const updateData: Prisma.OrderUpdateManyMutationInput = { status, ...(status === 'CANCELLED' && currentOrder.riskReviewStatus === 'REVIEW_REQUIRED' ? { riskReviewStatus: 'REJECTED' } : {}) };

  if (status === 'DELIVERED') {
    updateData.deliveredAt = new Date();
    updateData.paymentStatus = 'PAID';
    updateData.courierStatus = 'DELIVERED';
  } else if (status === 'CANCELLED') {
    updateData.cancelledAt = new Date();
  } else if (status === 'RETURNED') {
    updateData.returnedAt = new Date();
  }

  const claimed = await tx.order.updateMany({ where: { id, status: currentOrder.status, updatedAt: currentOrder.updatedAt, riskReviewStatus: currentOrder.riskReviewStatus, trashedAt: null }, data: updateData });
  if (claimed.count !== 1) throw Object.assign(new Error('Order changed. Refresh before updating its status.'), { status: 409 });
  if (status === 'CANCELLED' || status === 'RETURNED') {
    for (const item of currentOrder.items) {
      if (!item.productId) continue;
      const restoredProduct = await tx.product.update({ where: { id: item.productId }, data: { stockQuantity: { increment: item.quantity } } });
      const restoredStock = item.variantId ? await tx.productVariant.update({ where: { id: item.variantId }, data: { stockQuantity: { increment: item.quantity } } }) : restoredProduct;
      await tx.stockMovement.create({ data: { productId: item.productId, variantId: item.variantId, warehouseId: currentOrder.warehouseId, type: 'RETURN_RESTOCK', quantity: item.quantity, previousStock: restoredStock.stockQuantity - item.quantity, currentStock: restoredStock.stockQuantity, note: `Stock restored after order ${status.toLowerCase()}`, createdById: userId } });
    }
  }
  if (currentOrder.customerId) {
    if (prevStatus === 'DELIVERED' && status === 'RETURNED') await tx.customer.update({ where: { id: currentOrder.customerId }, data: { completedOrders: { decrement: 1 }, totalSpent: { decrement: currentOrder.grandTotal } } });
    if (status === 'DELIVERED') await tx.customer.update({ where: { id: currentOrder.customerId }, data: { completedOrders: { increment: 1 }, totalSpent: { increment: currentOrder.grandTotal } } });
    if (status === 'CANCELLED') await tx.customer.update({ where: { id: currentOrder.customerId }, data: { cancelledOrders: { increment: 1 } } });
    if (status === 'RETURNED') await tx.customer.update({ where: { id: currentOrder.customerId }, data: { returnedOrders: { increment: 1 }, riskScore: { increment: 15 } } });
  }
  return tx.order.update({ where: { id }, data: updateData });
}
