export const emailEvents = ['ORDER_PLACED','ORDER_CONFIRMED','ORDER_PACKAGING','ORDER_HANDED_OVER','DISPATCHED_TRACKING','ORDER_IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED_THANK_YOU','ORDER_PARTIAL_DELIVERED','ORDER_HOLD','ORDER_CANCELLED','ORDER_RETURNED','PAYMENT_RECEIVED'] as const;
export type EmailTemplate = { enabled: boolean; subject: string; heading: string; body: string };
export const defaultTemplates: Record<string, EmailTemplate> = Object.fromEntries(emailEvents.map(event => [event, {
  enabled: ['ORDER_PLACED','ORDER_CONFIRMED','DISPATCHED_TRACKING','DELIVERED_THANK_YOU','ORDER_CANCELLED','PAYMENT_RECEIVED'].includes(event),
  subject: event === 'ORDER_PLACED' ? '{store_name}: Order #{order_number} received' : '{store_name}: Order #{order_number} update',
  heading: event === 'ORDER_PLACED' ? 'আপনার অর্ডারটি গ্রহণ করা হয়েছে' : 'আপনার অর্ডারের নতুন আপডেট',
  body: 'ধন্যবাদ {customer_name}! আপনার অর্ডার #{order_number} এর বর্তমান অবস্থা: {status}। সর্বমোট মূল্য: {grand_total}।',
}]));
export const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
export function renderEmail(template: EmailTemplate, order: any, storeName: string, origin: string) {
  const tags: Record<string,string> = {store_name:storeName,customer_name:order.customerName||'Customer',order_number:order.orderNumber||'',status:order.status||'',grand_total:`৳${Number(order.grandTotal||0).toLocaleString('en-BD')}`};
  const substitute=(text:string)=>text.replace(/\{([a-z_]+)\}/g,(match,key)=>tags[key]??match);
  const heading=substitute(template.heading),body=substitute(template.body);
  const items=(order.items||[]).map((item:any)=>`<tr><td style="padding:12px;border-bottom:1px solid #ddd">${escapeHtml(item.productName)}${item.variantName?'<br>'+escapeHtml(item.variantName):''}</td><td>${Number(item.quantity)}</td><td>৳${Number(item.totalPrice).toLocaleString('en-BD')}</td></tr>`).join('');
  const url=origin+'/track-order';
  return { subject:substitute(template.subject).replace(/[\r\n]/g,' '), text:`${heading}\n\n${body}\n\n${(order.items||[]).map((item:any)=>`${item.productName} × ${item.quantity}: ৳${item.totalPrice}`).join('\n')}\nDelivery: ৳${order.deliveryCharge||0}\nTotal: ${tags.grand_total}\nTrack: ${url}`, html:`<!doctype html><html lang="bn"><body style="margin:0;background:#f4f8f6;font-family:'Hind Siliguri',Arial,sans-serif"><main style="max-width:620px;margin:24px auto;padding:28px;background:#fff;border-radius:12px"><h2 style="color:#047857">${escapeHtml(storeName)}</h2><h1 style="font-size:24px">${escapeHtml(heading)}</h1><p style="white-space:pre-line">${escapeHtml(body)}</p><table style="width:100%;text-align:left"><thead><tr><th>Product</th><th>Quantity</th><th>Amount</th></tr></thead><tbody>${items}</tbody></table><p>Delivery: ৳${Number(order.deliveryCharge||0)}</p><p><strong>Total: ${escapeHtml(tags.grand_total)}</strong></p><a href="${escapeHtml(url)}">অর্ডার ট্র্যাক করুন</a></main></body></html>`};
}
