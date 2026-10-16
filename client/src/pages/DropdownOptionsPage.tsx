import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Loader2, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useAdminDropdowns, type DropdownEntry } from '../components/admin/AdminSelect';

export default function DropdownOptionsPage() {
  const context = useAdminDropdowns();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [entries, setEntries] = useState<DropdownEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const item = context?.catalog.find(item => item.key === selected);
  const config = context?.configs[selected];
  useEffect(() => {
    if (!selected && context?.catalog.length) setSelected(context.catalog.find(item => item.page === 'OrdersPage' && item.label === 'Status')?.key || context.catalog[0].key);
  }, [context?.catalog, selected]);
  useEffect(() => {
    setEntries(config?.entries || item?.options.map(option => ({ ...option, mapsTo: option.value, hidden: false, deleted: false })) || []);
    setDirty(false);
  }, [selected, config?.version]);
  if (user?.role !== 'SUPER_ADMIN') return <p className="p-6">Only a super administrator can customize dropdown options.</p>;
  if (!context) return null;
  const filtered = context.catalog.filter(item => `${item.label} ${item.page} ${item.options.map(option => option.label).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const update = (index: number, patch: Partial<DropdownEntry>) => { setEntries(current => current.map((entry, i) => i === index ? { ...entry, ...patch } : entry)); setDirty(true); };
  const move = (index: number, direction: number) => { setEntries(current => { const next = [...current]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next; }); setDirty(true); };
  const save = async (next = entries) => {
    if (!item) return;
    setBusy(true);
    try {
      const { data } = await api.put(`/admin-dropdowns/${encodeURIComponent(selected)}`, { version: config?.version || 0, baseOptions: item.options, entries: next });
      context.accept(selected, data.config); setEntries(data.config.entries); setDirty(false); toast.success('Dropdown options saved');
    } catch (error: any) { toast.error(error.response?.data?.message || 'Could not save dropdown options'); }
    finally { setBusy(false); }
  };
  const remove = async (index: number) => {
    const entry = entries[index];
    setBusy(true);
    try {
      const { data } = await api.get(`/admin-dropdowns/${encodeURIComponent(selected)}/usage`, { params: { value: entry.mapsTo } });
      if (data.count) { toast.error(`This option has ${data.count} stored reference(s). Remove its usage before deleting it.`); return; }
      // Persist a tombstone for built-ins so they do not return on the next render.
      await save(entries.map((item, i) => i === index ? { ...item, deleted: true } : item));
    } catch (error: any) { toast.error(error.response?.data?.message || 'Could not check option usage'); }
    finally { setBusy(false); }
  };
  const choose = (key: string) => { if (!dirty || window.confirm('Discard unsaved dropdown changes?')) setSelected(key); };
  return <div className="mx-auto max-w-7xl space-y-5 pb-10">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1>Dropdown options</h1><p className="mt-1 text-sm text-slate-500">Manage labels, display order and visibility across the admin.</p></div><button type="button" disabled={busy} onClick={() => { if (dirty && !window.confirm('Discard unsaved dropdown changes and reload?')) return; setEntries(config?.entries || item?.options.map(option => ({ ...option, mapsTo: option.value, hidden: false, deleted: false })) || []); setDirty(false); void context.reload(); }} className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm dark:bg-slate-900"><RefreshCw size={15}/>Reload</button></header>
    <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">New options map to an existing supported value. Mapped options share the same workflow behavior and stored code; they are labels, rather than independent workflow states. Linked records such as staff, products and accounts are created in their own management pages. Deletion is blocked while the mapped value is in use, including by another dropdown.</div>
    {context.error && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{context.error} The server must have the admin dropdown table installed.</p>}
    <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="rounded-2xl border bg-white p-3 dark:border-slate-800 dark:bg-slate-900"><input type="search" aria-label="Search dropdowns" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search page, dropdown or option…" className="mb-3 w-full rounded-lg border bg-transparent p-2 text-sm"/><p className="mb-2 px-2 text-xs text-slate-500">{filtered.length} dropdowns</p><div className="max-h-[65vh] space-y-1 overflow-y-auto">{filtered.map(item => <button key={item.key} type="button" onClick={() => choose(item.key)} className={`block w-full rounded-lg p-3 text-left text-sm ${selected === item.key ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}><b className="block text-xs">{item.label}</b><span className="mt-1 block text-xs text-slate-500">{item.page} · {item.options.length} known options</span></button>)}</div></aside>
      <section className="min-w-0 rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><h2>{item?.label || 'Choose a dropdown'}</h2><p className="mt-1 break-all text-xs text-slate-500">{item?.key}</p></div><button type="button" disabled={busy || context.loading || Boolean(context.error) || !dirty} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-slate-900">{busy ? <Loader2 size={15} className="animate-spin"/> : <Save size={15}/>}Save changes</button></div>
      <div className="space-y-3">{entries.map((entry, index) => entry.deleted ? <div key={entry.value} className="flex justify-between gap-2 rounded-xl border border-dashed p-3 text-xs text-slate-500"><span>{entry.label} · deleted</span><button type="button" disabled={busy} onClick={() => update(index, { deleted: false })} className="font-semibold text-emerald-700">Restore option</button></div> : <div key={entry.value} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"><div className="flex items-center gap-2"><input aria-label={`Label for ${entry.value || 'placeholder'}`} value={entry.label} maxLength={160} disabled={busy} onChange={event => update(index, { label: event.target.value })} className="min-w-0 flex-1 rounded-lg border bg-transparent px-3 py-2 text-sm"/><button aria-label={`Move ${entry.label} up`} type="button" disabled={busy || index === 0} onClick={() => move(index,-1)} className="rounded-lg border p-2 disabled:opacity-30"><ArrowUp size={14}/></button><button aria-label={`Move ${entry.label} down`} type="button" disabled={busy || index === entries.length-1} onClick={() => move(index,1)} className="rounded-lg border p-2 disabled:opacity-30"><ArrowDown size={14}/></button><button aria-label={`Delete ${entry.label}`} type="button" disabled={busy || context.loading || Boolean(context.error)} onClick={() => void remove(index)} className="rounded-lg border p-2 text-rose-600 disabled:opacity-30"><Trash2 size={14}/></button></div><div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs"><span className="break-all text-slate-500">Stored value / behavior: {entry.mapsTo || '(empty placeholder)'}</span><label className="flex items-center gap-2"><input type="checkbox" checked={entry.hidden} disabled={busy} onChange={event => update(index, { hidden: event.target.checked })}/>Hide from new selections</label></div></div>)}</div>
      {!entries.length && <p className="py-8 text-sm text-slate-500">Open the related page or form first to discover its current options. Dynamic records are loaded by their existing APIs.</p>}
      {item && item.options.length > 0 && <button type="button" disabled={busy || Boolean(context.error)} onClick={() => { const base = item.options.find(option => option.value) || item.options[0]; setEntries(current => [...current, { value: `custom:${crypto.randomUUID()}`, label: 'New option', mapsTo: base.value, hidden: false, deleted: false }]); setDirty(true); }} className="mt-4 inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold"><Plus size={15}/>Add option</button>}
      {entries.filter(entry => entry.value.startsWith('custom:') && !entry.deleted).map(entry => <label key={entry.value} className="mt-4 block text-sm">Behavior for “{entry.label}”<select aria-label={`Behavior for ${entry.label}`} value={entry.mapsTo} disabled={busy} onChange={event => update(entries.indexOf(entry), { mapsTo: event.target.value })} className="mt-2 w-full rounded-lg border bg-transparent p-2">{item?.options.map(option => <option key={option.value} value={option.value}>{option.label} ({option.value || 'empty'})</option>)}</select></label>)}
      </section>
    </div>
  </div>;
}
