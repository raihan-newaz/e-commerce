import { useState } from 'react';
import { AlertTriangle, Loader2, ShieldCheck, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';

type CourierStat = { name?: string; total_parcel?: number; success_parcel?: number; cancelled_parcel?: number; success_ratio?: number };
type FraudReport = { id?: string | number; name?: string; details?: string; created_at?: string; courierName?: string; courierLogo?: string };
type CheckResult = { status?: string; message?: string; data?: Record<string, CourierStat | any>; courierData?: Record<string, CourierStat | any>; reports?: FraudReport[] };

const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value).toLocaleString() : '0';

export default function CourierFraudCheckCard({ orderId }: { orderId: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState('');

  const check = async () => {
    setBusy(true); setError('');
    try {
      const { data } = await api.post(`/couriers/bdcourier/orders/${orderId}/fraud-check`);
      setResult(data.result || null);
      if (data.result?.status === 'error') {
        const message = data.result.message || 'BD Courier could not find a report for this phone number';
        setError(message); toast.error(message);
      } else toast.success('Courier history loaded');
    } catch (cause: any) {
      const message = cause.response?.data?.message || 'Could not check courier history';
      setError(message); toast.error(message);
    } finally { setBusy(false); }
  };

  const courierData = result?.data || result?.courierData || {};
  const summary = courierData.summary;
  const couriers = Object.entries(courierData).filter(([key, value]) => key !== 'summary' && value && typeof value === 'object') as Array<[string, CourierStat]>;
  const reports = result?.reports || [];

  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_2px_10px_rgba(0,0,0,0.02)] dark:border-slate-800 dark:bg-slate-900">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3"><div className="rounded-xl bg-purple-50 p-2.5 text-purple-800 dark:bg-purple-950/50 dark:text-purple-300"><ShieldCheck className="h-5 w-5"/></div><div><h3 className="text-base font-semibold">BD Courier fraud checker</h3><p className="mt-1 text-xs text-slate-500">Courier delivery history and merchant fraud reports for this order’s phone number.</p></div></div>
      <button type="button" onClick={() => void check()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-purple-900 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-800 disabled:cursor-wait disabled:opacity-60 dark:bg-purple-700"><span>{busy ? <Loader2 className="h-4 w-4 animate-spin"/> : <Search className="h-4 w-4"/>}</span>{result ? 'Check again' : 'Check courier history'}</button>
    </div>
    <p className="mt-3 text-[11px] text-slate-500">Manual check only. The phone number is sent securely to BD Courier; this result is informational and does not change the order status or existing fraud review.</p>
    {error && <p role="alert" className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"><AlertTriangle className="h-4 w-4 shrink-0"/>{error}</p>}
    {result && result.status !== 'error' && <>
      {summary && <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{[['Total parcels', summary.total_parcel], ['Delivered', summary.success_parcel], ['Cancelled', summary.cancelled_parcel], ['Success rate', `${number(summary.success_ratio)}%`]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950"><p className="text-[11px] text-slate-500">{label}</p><p className="mt-1 text-base font-semibold">{value}</p></div>)}</div>}
      {couriers.length > 0 && <div className="mt-4"><h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Courier breakdown</h4><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{couriers.map(([key, stats]) => <div key={key} className="rounded-xl border border-slate-100 p-3 dark:border-slate-800"><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{stats.name || key.replace(/([A-Z])/g, ' $1')}</span><span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{number(stats.success_ratio)}%</span></div><p className="mt-1 text-[11px] text-slate-500">{number(stats.success_parcel)} delivered · {number(stats.cancelled_parcel)} cancelled · {number(stats.total_parcel)} total</p></div>)}</div></div>}
      {reports.length > 0 && <div className="mt-4"><h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">Fraud reports ({reports.length})</h4><div className="space-y-2">{reports.map((report, index) => <div key={String(report.id ?? index)} className="rounded-xl border border-rose-100 bg-rose-50/70 p-3 dark:border-rose-900/50 dark:bg-rose-950/20"><div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-semibold text-rose-900 dark:text-rose-200">{report.courierName || 'Merchant report'}{report.name ? ` · ${report.name}` : ''}</span><span className="text-slate-500">{report.created_at ? new Date(report.created_at).toLocaleString() : ''}</span></div>{report.details && <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{report.details}</p>}</div>)}</div></div>}
      {!summary && !couriers.length && !reports.length && <p className="mt-4 text-sm text-slate-500">BD Courier returned no history details for this number.</p>}
    </>}
  </section>;
}
