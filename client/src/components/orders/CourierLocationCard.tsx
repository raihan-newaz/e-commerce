import { courierLocations, readyCouriers, type CourierProvider } from '../../lib/courierLocations';
import { AdminSelect } from '../admin/AdminSelect';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../lib/api';

type Provider = 'STEADFAST' | 'PATHAO' | 'REDX';
type Saved = { provider: Provider; districtExternalId?: string | null; thanaExternalId?: string | null; areaExternalId?: string | null; areaName?: string | null; source: string };
type Location = { id: string; externalId: string; name: string; districtName?: string };

function ProviderEditor({ orderId, provider, value, onSaved }: { orderId: string; provider: Provider; value?: Saved; onSaved: (value: Saved) => void }) {
  const [lookupError, setLookupError] = useState('');
  const [retry, setRetry] = useState(0);
  const [district, setDistrict] = useState(value?.districtExternalId || '');
  const [thana, setThana] = useState(value?.thanaExternalId || '');
  const [area, setArea] = useState(value?.areaExternalId || '');
  const [areaName, setAreaName] = useState(value?.areaName || '');
  const [search, setSearch] = useState('');
  const [districts, setDistricts] = useState<Location[]>([]);
  const [thanas, setThanas] = useState<Location[]>([]);
  const [areas, setAreas] = useState<Location[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDistrict(value?.districtExternalId || ''); setThana(value?.thanaExternalId || ''); setArea(value?.areaExternalId || ''); setAreaName(value?.areaName || ''); }, [value?.districtExternalId, value?.thanaExternalId, value?.areaExternalId, value?.areaName]);
  useEffect(() => { let active = true; setLookupError(''); const url = provider === 'REDX' ? '/couriers/locations/REDX?level=AREA' : '/couriers/locations/'+provider+'?level=DISTRICT'; courierLocations(url).then(({data}) => { if(active) { if(provider === 'REDX') setAreas(data.locations || []); else setDistricts(data.locations || []); } }).catch(error => { if(active) setLookupError(error.response?.data?.message || provider+' location lookup failed. Retry shortly.'); }); return () => { active=false; }; }, [provider,retry]);
  useEffect(() => { let active=true; setThanas([]); if (!district || provider === 'REDX') return; courierLocations('/couriers/locations/'+provider+'?level=THANA&parentId='+encodeURIComponent(district)).then(({data})=>{ if(active) setThanas(data.locations || []); }).catch(error=>{ if(active) setLookupError(error.response?.data?.message || 'Thana lookup failed'); }); return ()=>{ active=false; }; }, [provider,district,retry]);
  useEffect(() => { let active=true; if(provider !== 'REDX') setAreas([]); if(!thana || provider !== 'PATHAO') return; courierLocations('/couriers/locations/PATHAO?level=AREA&parentId='+encodeURIComponent(thana)).then(({data})=>{ if(active) setAreas(data.locations || []); }).catch(error=>{ if(active) setLookupError(error.response?.data?.message || 'Area lookup failed'); }); return ()=>{ active=false; }; }, [provider,thana,retry]);
  const save = async () => {
    setBusy(true);
    try { const { data } = await api.put(`/order-protection/orders/${orderId}/locations/${provider}`, { districtExternalId: district || null, thanaExternalId: thana || null, areaExternalId: area || null, areaName: provider === 'STEADFAST' ? areaName.trim() || null : null }); onSaved(data.location); toast.success(`${provider} location saved`); }
    catch (error: any) { toast.error(error.response?.data?.message || 'Could not save location'); }
    finally { setBusy(false); }
  };
  const filtered = provider === 'REDX' ? areas.filter(item => !search || `${item.name} ${item.districtName || ''}`.toLowerCase().includes(search.toLowerCase()) || item.externalId === area).slice(0, 150) : areas;
  return <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"><div className="mb-3 flex items-center justify-between"><b className="text-sm">{provider}</b><span className="text-[10px] font-bold text-slate-500">{value?.source || 'UNRESOLVED'}</span></div><div className="grid gap-2 sm:grid-cols-2">
    {provider !== 'REDX' && <AdminSelect dropdownKey="components.orders.CourierLocationCard.tsx.1" aria-label={`${provider} district`} value={district} onChange={event => { setDistrict(event.target.value); setThana(''); setArea(''); }} className="rounded-lg border p-2 text-xs dark:bg-slate-900"><option value="">District</option>{districts.map(item => <option key={item.id} value={item.externalId}>{item.name}</option>)}</AdminSelect>}
    {provider !== 'REDX' && <AdminSelect dropdownKey="components.orders.CourierLocationCard.tsx.2" aria-label={`${provider} thana`} value={thana} onChange={event => { setThana(event.target.value); setArea(''); }} disabled={!district} className="rounded-lg border p-2 text-xs dark:bg-slate-900"><option value="">Thana / zone</option>{thanas.map(item => <option key={item.id} value={item.externalId}>{item.name}</option>)}</AdminSelect>}
    {provider === 'REDX' && <input aria-label="Search RedX area" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search area" className="rounded-lg border p-2 text-xs dark:bg-slate-900"/>}
    {(provider === 'PATHAO' || provider === 'REDX') && <AdminSelect dropdownKey="components.orders.CourierLocationCard.tsx.3" aria-label={`${provider} area`} value={area} onChange={event => setArea(event.target.value)} disabled={provider === 'PATHAO' && !thana} className="rounded-lg border p-2 text-xs dark:bg-slate-900"><option value="">{provider === 'REDX' ? 'Select area' : 'Area (optional)'}</option>{filtered.map(item => <option key={item.id} value={item.externalId}>{item.name}{item.districtName ? ` · ${item.districtName}` : ''}</option>)}</AdminSelect>}
    {provider === 'STEADFAST' && <input aria-label="Steadfast locality" value={areaName} maxLength={100} onChange={event => setAreaName(event.target.value)} placeholder="Locality (optional)" className="rounded-lg border p-2 text-xs dark:bg-slate-900"/>}
  </div>{lookupError && <p role="alert" className="mt-3 text-xs text-rose-600">{lookupError} <button type="button" onClick={()=>setRetry(value=>value+1)} className="underline">Retry lookup</button></p>}<button disabled={busy || Boolean(lookupError) || provider === 'REDX' && !area || provider === 'PATHAO' && (!district || !thana)} onClick={() => void save()} className="mt-3 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-40 dark:bg-emerald-600">Save correction</button></div>;
}

export default function CourierLocationCard({ orderId, canEdit, revision }: { orderId: string; canEdit: boolean; revision?:string }) {
  const [values, setValues] = useState<Saved[]>([]);
  const [providers,setProviders] = useState<CourierProvider[]>([]);
  const [providerError,setProviderError] = useState('');
  const [loadingProviders,setLoadingProviders] = useState(true);
  useEffect(()=>{let active=true; readyCouriers().then(values=>{if(active)setProviders(values);}).catch(()=>{if(active)setProviderError('Could not read courier configuration. Please refresh.');}).finally(()=>{if(active)setLoadingProviders(false);});return()=>{active=false;};},[]);
  const [busy, setBusy] = useState(false);
  const [matching,setMatching] = useState(false);
  useEffect(()=>{let active=true;let timer:number|undefined;let polls=0;const read=()=>api.get('/order-protection/orders/'+orderId+'/locations').then(({data})=>{if(!active)return;setValues(data.locations || []);setMatching(Boolean(data.pending));if(data.pending && polls++<15)timer=window.setTimeout(read,3000);}).catch(()=>undefined);void read();return()=>{active=false;window.clearTimeout(timer);};},[orderId,revision]);
  const rematch = async () => { setBusy(true); try { const { data } = await api.post(`/order-protection/orders/${orderId}/locations/rematch`); setValues(data.locations || []); toast.success('Courier locations refreshed'); } catch (error: any) { toast.error(error.response?.data?.message || 'Could not rematch locations'); } finally { setBusy(false); } };
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold">Courier delivery areas</h3><p className="mt-1 text-xs text-slate-500">Each courier has its own location match. Review before dispatch.</p></div>{canEdit && <button disabled={busy} onClick={() => void rematch()} className="rounded-lg border px-3 py-2 text-xs font-bold">Match again</button>}</div>{matching && <p role="status" className="mt-3 text-xs text-slate-500">Address matching is queued. Saved areas will refresh automatically.</p>}{loadingProviders && <p className="mt-4 text-xs text-slate-500">Loading configured couriers…</p>}{providerError && <p role="alert" className="mt-4 text-xs text-rose-600">{providerError}</p>}{!loadingProviders && !providers.length && !providerError && <p className="mt-4 text-sm text-slate-500">No fully configured courier is enabled. Complete courier settings to choose delivery areas.</p>}<div className="mt-4 grid gap-3 lg:grid-cols-3">{providers.map(provider => canEdit ? <ProviderEditor key={provider} orderId={orderId} provider={provider} value={values.find(row => row.provider === provider)} onSaved={value => setValues(current => [...current.filter(row => row.provider !== provider), value])}/> : <div key={provider} className="rounded-lg border p-3 text-xs"><b>{provider}</b><p className="mt-2">{values.find(row => row.provider === provider)?.areaName || values.find(row => row.provider === provider)?.areaExternalId || values.find(row => row.provider === provider)?.thanaExternalId || 'Needs selection'}</p></div>)}</div></section>;
}
