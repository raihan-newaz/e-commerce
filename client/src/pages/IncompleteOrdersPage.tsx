import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Phone, RefreshCw, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';

type Lead = { id: string; source: string; pageSlug?: string | null; customerName: string; customerPhone: string; address: string; productSummary: string; paymentMethod: string; status: string; staffNote?: string | null; lastActivityAt: string; orderId?: string | null; ipAddress?: string | null };
const statuses = ['OPEN', 'CONTACTED', 'NO_ANSWER', 'DECLINED', 'CONVERTED', 'DISCARDED'];

export default function IncompleteOrdersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState('OPEN');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [busy, setBusy] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [overrideReasons, setOverrideReasons] = useState<Record<string, string>>({});
  const [blockedLeads, setBlockedLeads] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try { const { data } = await api.get('/incomplete-orders', { params: { status, page } }); setLeads(data.drafts || []); setTotal(data.total || 0); }
    catch (error: any) { toast.error(error.response?.data?.message || 'Could not load incomplete orders'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [status, page]);
  const update = async (lead: Lead, nextStatus?: string) => {
    setBusy(lead.id);
    try { await api.patch(`/incomplete-orders/${lead.id}`, { status: nextStatus, staffNote: notes[lead.id] ?? lead.staffNote ?? '' }); toast.success('Lead updated'); await load(); }
    catch (error: any) { toast.error(error.response?.data?.message || 'Could not update lead'); }
    finally { setBusy(''); }
  };
  const convert = async (lead: Lead) => {
    setBusy(lead.id);
    try { const reason = overrideReasons[lead.id]?.trim(); const { data } = await api.post(`/incomplete-orders/${lead.id}/convert`, reason && user?.role === 'SUPER_ADMIN' ? { overrideReason: reason } : {}); toast.success(data.created ? 'Order created' : 'Order already exists'); navigate(`/orders/${data.order.id}`); }
    catch (error: any) { if (/blocked by protection/i.test(error.response?.data?.message || '')) setBlockedLeads(current => ({ ...current, [lead.id]: true })); toast.error(error.response?.data?.message || 'Could not convert lead'); }
    finally { setBusy(''); }
  };
  const remove = async (lead: Lead) => {
    if (!window.confirm(`Delete ${lead.customerName}'s incomplete checkout?`)) return;
    setBusy(lead.id);
    try { await api.delete(`/incomplete-orders/${lead.id}`); toast.success('Lead deleted'); await load(); }
    catch (error: any) { toast.error(error.response?.data?.message || 'Could not delete lead'); }
    finally { setBusy(''); }
  };
  return <div className="mx-auto max-w-7xl space-y-5 pb-12">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Incomplete Orders</h1><p className="mt-1 text-sm text-slate-500">Checkout leads are saved as soon as a valid phone number is entered. Name, address and products may still be incomplete.</p></div><button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm"><RefreshCw size={16}/>Refresh</button></div>
    <div className="flex flex-wrap gap-2">{statuses.map(item => <button key={item} onClick={() => { setStatus(item); setPage(1); }} className={`rounded-xl px-3 py-2 text-xs font-bold ${status === item ? 'bg-slate-900 text-white dark:bg-emerald-600' : 'border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'}`}>{item.replace('_', ' ')}</button>)}</div>
    <div className="space-y-3">{loading ? <p className="py-12 text-center text-slate-500">Loading…</p> : leads.length ? leads.map(lead => <article key={lead.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold">{lead.customerName || 'Name not provided'} <span className="ml-2 rounded bg-amber-100 px-2 py-1 text-[10px] text-amber-800">{lead.source}</span></h2><p className="mt-1 text-sm">{lead.customerPhone} · {lead.address || 'Address not provided'}</p><p className="mt-2 text-xs text-slate-500">{lead.productSummary || 'No product selected'} · Preferred payment: {lead.paymentMethod}{lead.pageSlug ? ` · ${lead.pageSlug}` : ''}</p><p className="mt-1 text-xs text-slate-500">Last activity: {new Date(lead.lastActivityAt).toLocaleString()}</p></div><div className="flex flex-wrap gap-2"><a href={`tel:${lead.customerPhone}`} className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 px-3 py-2 text-xs font-bold text-emerald-700"><Phone size={14}/>Call</a>{lead.orderId && <Link to={`/orders/${lead.orderId}`} className="rounded-lg border px-3 py-2 text-xs font-bold">View order</Link>}{!lead.orderId && !['DECLINED', 'DISCARDED'].includes(lead.status) && <button disabled={busy === lead.id} onClick={() => void convert(lead)} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Confirm & Create Order</button>}</div></div>
      {!lead.orderId && <div className="mt-4 flex flex-wrap items-end gap-2 border-t pt-4 dark:border-slate-800"><label className="min-w-[220px] flex-1 text-xs font-semibold">Call notes<input value={notes[lead.id] ?? lead.staffNote ?? ''} onChange={event => setNotes(current => ({ ...current, [lead.id]: event.target.value }))} maxLength={2000} className="mt-1 w-full rounded-lg border border-slate-200 bg-transparent px-3 py-2 dark:border-slate-700"/></label><select aria-label={`Status for ${lead.customerName}`} value={lead.status} onChange={event => void update(lead, event.target.value)} className="rounded-lg border border-slate-200 bg-transparent px-3 py-2 text-xs dark:border-slate-700">{statuses.filter(item => item !== 'CONVERTED').map(item => <option key={item}>{item}</option>)}</select><button disabled={busy === lead.id} onClick={() => void update(lead)} className="rounded-lg border px-3 py-2 text-xs font-bold">Save notes</button>{blockedLeads[lead.id] && user?.role === 'SUPER_ADMIN' && <label className="min-w-[220px] flex-1 text-xs font-semibold text-rose-600">Override reason<input value={overrideReasons[lead.id] || ''} onChange={event => setOverrideReasons(current => ({ ...current, [lead.id]: event.target.value }))} minLength={3} maxLength={1000} placeholder="Required to retry a blocked order" className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"/></label>}{user?.role === 'SUPER_ADMIN' && <button aria-label={`Delete ${lead.customerName}`} disabled={busy === lead.id} onClick={() => void remove(lead)} className="rounded-lg border border-rose-200 px-3 py-2 text-rose-600"><Trash2 size={15}/></button>}</div>}
    </article>) : <div className="rounded-2xl border border-dashed p-12 text-center text-sm text-slate-500">No {status.toLowerCase().replace('_', ' ')} leads found.</div>}</div>
    {total > 25 && <div className="flex items-center justify-end gap-3 text-sm"><button disabled={page === 1} onClick={() => setPage(page - 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Previous</button><span>Page {page} of {Math.ceil(total / 25)}</span><button disabled={page * 25 >= total} onClick={() => setPage(page + 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Next</button></div>}
  </div>;
}
