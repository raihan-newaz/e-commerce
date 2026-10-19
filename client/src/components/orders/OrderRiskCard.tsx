import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import type { Order } from '../../types';
import { useAuth } from '../../context/AuthContext';

export default function OrderRiskCard({ order, onRefresh }: { order: Order; onRefresh: () => void }) {
  const { user } = useAuth();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Array<{ id: string; decision: string; reasons: string[]; createdAt: string }>>([]);
  const [reviews, setReviews] = useState<Array<{ id: string; action: string; userName?: string; details?: string; createdAt: string }>>([]);
  useEffect(() => { api.get(`/order-protection/orders/${order.id}/risk-history`).then(({ data }) => { setHistory(data.events || []); setReviews(data.reviews || []); }).catch(() => {}); }, [order.id, order.riskReviewStatus]);
  const pending = order.riskReviewStatus === 'REVIEW_REQUIRED';
  const review = async (decision: 'APPROVE' | 'REJECT') => {
    if (reason.trim().length < 3) { toast.error('Enter a review reason'); return; }
    setBusy(true);
    try {
      if (decision === 'APPROVE') await api.post(`/order-protection/orders/${order.id}/review`, { decision, reason: reason.trim() });
      else await api.patch(`/orders/${order.id}/status`, { status: 'CANCELLED', note: `Fraud review rejected: ${reason.trim()}` });
      toast.success(decision === 'APPROVE' ? 'Order approved for fulfilment' : 'Order cancelled'); onRefresh();
    } catch (error: any) { toast.error(error.response?.data?.message || 'Could not review order'); }
    finally { setBusy(false); }
  };
  const blockIp = async () => {
    if (!order.sourceIp || reason.trim().length < 3) { toast.error('Enter a reason to block this IP'); return; }
    setBusy(true);
    try { await api.post('/order-protection/ip-blocks', { ipAddress: order.sourceIp, reason: reason.trim() }); toast.success('IP blocked'); }
    catch (error: any) { toast.error(error.response?.data?.message || 'Could not block IP'); }
    finally { setBusy(false); }
  };
  return <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900/40 dark:bg-amber-950/20"><h3 className="font-bold">Order protection</h3><p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Review status: {order.riskReviewStatus || 'CLEAR'}</p><div className="mt-3 flex flex-wrap gap-2">{(order.riskReasons || []).map(item => <span key={item} className="rounded-full bg-amber-200 px-2 py-1 text-[10px] font-bold text-amber-900">{item.replace(/_/g, ' ')}</span>)}</div>{(pending || user?.role === 'SUPER_ADMIN' && order.sourceIp) && <div className="mt-4 flex flex-wrap items-end gap-2"><label className="min-w-[220px] flex-1 text-xs font-semibold">Review / block reason<input value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm dark:bg-slate-900"/></label>{pending && ['SUPER_ADMIN', 'OPERATIONS_MANAGER'].includes(user?.role || '') && <><button disabled={busy} onClick={() => void review('APPROVE')} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Approve</button><button disabled={busy} onClick={() => void review('REJECT')} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Reject order</button></>}{user?.role === 'SUPER_ADMIN' && order.sourceIp && <button disabled={busy} onClick={() => void blockIp()} className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-50">Block IP</button>}</div>}{(history.length > 0 || reviews.length > 0) && <details className="mt-4 border-t border-amber-200 pt-3"><summary className="cursor-pointer text-xs font-bold">Risk and review history</summary><div className="mt-2 space-y-2">{history.map(item => <p key={item.id} className="text-xs">{new Date(item.createdAt).toLocaleString()} · {item.decision}: {(item.reasons || []).join(', ')}</p>)}{reviews.map(item => <p key={item.id} className="text-xs">{new Date(item.createdAt).toLocaleString()} · {item.userName || 'Staff'} · {item.action} · {item.details}</p>)}</div></details>}</section>;
}
