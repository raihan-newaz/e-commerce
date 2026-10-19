import { useEffect, useState } from 'react';
import { Ban, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';

type Identifier = { value: string | null; blockId: string | null };
type Identifiers = { ip: Identifier; phone: Identifier; device: Identifier };

export function OrderIdentifierProtection({ orderId, orderNumber, canManage }: { orderId: string; orderNumber: string; canManage: boolean }) {
  const [identifiers, setIdentifiers] = useState<Identifiers | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = async () => {
    try { const { data } = await api.get(`/order-protection/orders/${orderId}/identifiers`); setIdentifiers(data.identifiers); }
    catch { setIdentifiers({ ip: { value: null, blockId: null }, phone: { value: null, blockId: null }, device: { value: null, blockId: null } }); }
  };
  useEffect(() => { void load(); }, [orderId]);

  const toggle = async (kind: keyof Identifiers) => {
    const item = identifiers?.[kind];
    if (!item?.value) return;
    setBusy(kind);
    try {
      if (item.blockId) await api.post(`/order-protection/${kind}-blocks/${item.blockId}/revoke`);
      else {
        const reason = `Blocked from order #${orderNumber}`;
        const payload = kind === 'ip' ? { ipAddress: item.value, reason } : kind === 'phone' ? { phone: item.value, reason } : { fingerprint: item.value, reason };
        await api.post(`/order-protection/${kind}-blocks`, payload);
      }
      await load();
      toast.success(item.blockId ? 'Identifier unblocked' : 'Identifier blocked');
    } catch (error: any) { toast.error(error.response?.data?.message || 'Could not update block status'); }
    finally { setBusy(null); }
  };

  const rows: Array<{ key: keyof Identifiers; label: string }> = [
    { key: 'ip', label: 'IP' }, { key: 'phone', label: 'Mobile' }, { key: 'device', label: 'Device' },
  ];
  return <div className="mt-2 space-y-1.5 rounded-lg bg-slate-50 px-2.5 py-2 dark:bg-slate-950/70">
    {rows.map(({ key, label }) => {
      const item = identifiers?.[key];
      const display = key === 'device' && item?.value ? `${item.value.slice(0, 18)}…` : item?.value || 'Not available';
      return <div key={key} className="flex min-w-0 items-center gap-2 text-[10px]">
        <span className="w-10 shrink-0 text-slate-500">{label}:</span>
        <span className="min-w-0 flex-1 truncate font-medium text-slate-700 dark:text-slate-200" title={item?.value || undefined}>{display}</span>
        {canManage && <button type="button" disabled={!item?.value || busy !== null} onClick={() => void toggle(key)} className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[9px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${item?.blockId ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300' : 'border-rose-200 bg-white text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:bg-slate-900 dark:text-rose-300'}`} aria-label={`${item?.blockId ? 'Unblock' : 'Block'} ${label.toLowerCase()}`}>
          {busy === key ? <Loader2 className="h-3 w-3 animate-spin"/> : <Ban className="h-3 w-3"/>}{item?.blockId ? 'Unblock' : 'Block'}
        </button>}
      </div>;
    })}
  </div>;
}
