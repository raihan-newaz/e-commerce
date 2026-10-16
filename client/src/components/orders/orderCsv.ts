import { Order } from '../../types';

function cell(value: unknown): string {
  let text = String(value ?? '');
  // Keep phone numbers/order numbers as text and prevent spreadsheet formulas.
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^0\d+$/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function ordersToCsv(orders: Order[]): string {
  const header = ['Order', 'Date', 'Customer', 'Phone', 'Address', 'Items / variations', 'Subtotal', 'Discount', 'Delivery', 'Total', 'Advance paid', 'COD due', 'Payment method', 'Payment status', 'Fulfillment', 'Assignee', 'Priority', 'Courier', 'Tracking code'];
  const rows = orders.map(order => [
    order.orderNumber, order.createdAt, order.customerName, order.customerPhone, order.customerAddress,
    order.items.map(item => `${item.productName}${item.variantName || item.color || item.size ? ` (${item.variantName || [item.color, item.size].filter(Boolean).join(' / ')})` : ''} × ${item.quantity}`).join('; '),
    order.subtotal, order.discount, order.deliveryCharge, order.grandTotal, order.advancePaid,
    order.codAmount ?? order.grandTotal, order.paymentMethod, order.paymentStatus, order.status,
    order.assignedTo?.name || 'Unassigned', order.priority, order.courierName, order.courierTrackingCode,
  ]);
  return '\uFEFF' + [header, ...rows].map(row => row.map(cell).join(',')).join('\r\n');
}

export function downloadOrdersCsv(orders: Order[], scope: string): void {
  const url = URL.createObjectURL(new Blob([ordersToCsv(orders)], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `orders-${scope}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
