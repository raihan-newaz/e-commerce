import { useEffect, useState } from 'react';
import { ExternalLink, Headphones, PhoneIncoming, PhoneMissed, PhoneOutgoing, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';

export type CallerPreview = {
  id?: string;
  orderId?: string;
  phone: string;
  customerName?: string;
  orderNumber?: string;
  direction?: string;
  status?: string;
  agentName?: string;
  startedAt?: string;
  metadata?: Record<string, unknown>;
};

export function CallerPreviewPopup({ call, onClose }: { call: CallerPreview; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    if (!call.orderId) return;
    let alive = true;
    api.get(`/orders/${encodeURIComponent(call.orderId)}`).then(({ data: result }) => { if (alive) setData(result); }).catch(() => {});
    return () => { alive = false; };
  }, [call.orderId]);

  const order = data?.order;
  const history = data?.customerHistory;
  const missed = ['MISSED', 'NO_ANSWER', 'BUSY', 'FAILED'].includes(call.status || '');
  const CallIcon = missed ? PhoneMissed : call.direction === 'INBOUND' ? PhoneIncoming : PhoneOutgoing;
  const recentOrders = history?.recentOrders || [];
  const openOrders = recentOrders.filter((item: any) => !['DELIVERED', 'CANCELLED', 'RETURNED', 'PARTIAL_DELIVERED'].includes(item.status));
  const closedOrders = recentOrders.filter((item: any) => ['CANCELLED', 'RETURNED'].includes(item.status));
  const onlineOrders = recentOrders.filter((item: any) => ['DELIVERED', 'PARTIAL_DELIVERED'].includes(item.status));
  const phone = call.phone || order?.customerPhone || '';

  return <aside role="dialog" aria-label="Caller preview" className="fixed bottom-20 right-4 z-[10000] flex max-h-[min(74dvh,680px)] w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_70px_-20px_rgba(20,12,30,.5)] dark:border-slate-700 dark:bg-slate-900 sm:right-6">
    <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
      <div className="min-w-0"><p className="text-[10px] font-medium text-slate-500">Caller preview</p><p className="mt-0.5 truncate text-sm font-semibold text-slate-900 dark:text-white">{call.customerName || order?.customerName || 'Customer'}</p><p className="font-mono text-[11px] text-slate-500">{phone}</p></div>
      <div className="flex shrink-0 items-center gap-1"><span className={`grid h-8 w-8 place-items-center rounded-lg ${missed ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/40' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40'}`}><CallIcon className="h-4 w-4"/></span><button type="button" onClick={onClose} aria-label="Close caller preview" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-4 w-4"/></button></div>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="grid grid-cols-3 gap-2 border-b border-slate-100 p-3 dark:border-slate-800">
        {[['Open', openOrders.length], ['Cancelled', closedOrders.length], ['Previous', history?.totalPrevious ?? 0]].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-800"><p className="text-[9px] uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{value}</p></div>)}
      </div>
      {history && <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800"><div className="flex items-center justify-between text-xs"><span className="font-medium">Courier success</span><span className="font-semibold">{history.completed + history.returned + history.cancelled ? Math.round(history.completed / (history.completed + history.returned + history.cancelled) * 100) : 0}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${history.completed + history.returned + history.cancelled ? Math.round(history.completed / (history.completed + history.returned + history.cancelled) * 100) : 0}%` }}/></div><p className="mt-1.5 text-[10px] text-slate-500">{history.completed} delivered · {history.returned} returned · {history.cancelled} cancelled</p></div>}
      {call.id && <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-semibold">{call.direction === 'INBOUND' ? 'Incoming' : 'Outgoing'} · {call.status?.replace(/_/g, ' ')}</span><span className="text-[10px] text-slate-500">{call.startedAt ? new Date(call.startedAt).toLocaleString() : ''}</span></div><p className="mt-1 text-[10px] text-slate-500">Handled by {call.agentName || 'PBX'}</p>{typeof call.metadata?.recordingUrl === 'string' && <div className="mt-2 flex items-center gap-2"><Headphones className="h-4 w-4 shrink-0 text-violet-700"/><audio controls preload="none" src={call.metadata.recordingUrl} className="h-8 min-w-0 flex-1" aria-label="Call recording"/></div>}</div>}
      {[["Active approved orders", openOrders], ["Cancelled / pending cancel", closedOrders], ["Completed orders", onlineOrders]].map(([label, list]) => <section key={String(label)} className="border-b border-slate-100 px-4 py-3 last:border-0 dark:border-slate-800"><div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-semibold text-slate-800 dark:text-slate-100">{String(label)}</h3><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800">{(list as any[]).length}</span></div>{(list as any[]).length ? <div className="space-y-2">{(list as any[]).slice(0, 4).map(item => <Link key={item.id} to={`/orders/${item.id}`} onClick={onClose} className="block rounded-lg border border-slate-100 p-2.5 hover:border-violet-200 dark:border-slate-800 dark:hover:border-violet-800"><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-semibold">#{item.orderNumber}</span><span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-600 dark:bg-slate-800">{item.status.replace(/_/g, ' ')}</span></div><p className="mt-1 truncate text-xs">{item.items?.map((product: any) => product.productName).join(', ') || 'Order details'}</p><p className="mt-1 flex items-center justify-between text-[10px] text-slate-500"><span>৳{Number(item.grandTotal || 0).toLocaleString()} · {new Date(item.createdAt).toLocaleDateString()}</span><span className="inline-flex items-center gap-1">Details <ExternalLink className="h-3 w-3"/></span></p></Link>)}</div> : <p className="text-[10px] text-slate-400">No orders found.</p>}</section>)}
    </div>
    {call.orderId && <footer className="border-t border-slate-100 p-3 dark:border-slate-800"><Link to={`/orders/${call.orderId}`} onClick={onClose} className="flex h-9 items-center justify-center rounded-lg bg-[#40134c] text-xs font-semibold text-white hover:bg-[#511561]">Open order {call.orderNumber ? `#${call.orderNumber}` : ''}</Link></footer>}
  </aside>;
}
