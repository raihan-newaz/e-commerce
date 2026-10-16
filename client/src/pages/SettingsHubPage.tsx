import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Search, Settings2, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { canSeeNavigationItem, navigationGroups, settingsGroups } from '../components/layout/navigation';

export default function SettingsHubPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const groups = settingsGroups.map(group => ({
    ...group,
    items: group.items.filter(item => canSeeNavigationItem(item, user?.role, user?.builderAccess))
      .filter(item => `${group.label} ${item.label} ${item.description}`.toLowerCase().includes(query)),
  })).filter(group => group.items.length);
  const storeTools = navigationGroups.find(group => group.label === 'Online store')?.items.filter(item => canSeeNavigationItem(item, user?.role, user?.builderAccess)) || [];

  return <div className="mx-auto max-w-6xl space-y-6 py-2" data-testid="settings-hub">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="flex items-center gap-2 text-slate-900 dark:text-white"><Settings2 size={20} />Settings</h1><p className="mt-1 text-xs text-slate-500">Manage connections, team access and workspace preferences.</p></div>
      <div className="relative w-full sm:w-80"><Search size={15} className="pointer-events-none absolute left-3 top-3 text-slate-400" /><input type="search" aria-label="Search settings" placeholder="Find a setting…" value={search} onChange={event => setSearch(event.target.value)} className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-8 text-xs dark:border-slate-700 dark:bg-slate-900" />{search && <button type="button" aria-label="Clear settings search" className="absolute right-2 top-2.5 text-slate-400" onClick={() => setSearch('')}><X size={15} /></button>}</div>
    </div>
    {groups.map(group => <section key={group.label} aria-label={group.label}>
      <h2 className="mb-3 text-slate-700 dark:text-slate-200">{group.label}</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{group.items.map(item => <Link key={item.path} to={item.path} className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/70">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-300"><item.icon size={18} /></span>
        <span className="min-w-0 flex-1"><b className="block text-xs font-semibold text-slate-900 dark:text-white">{item.label}</b><span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">{item.description}</span></span><ArrowUpRight size={14} className="shrink-0 text-slate-300 transition group-hover:text-slate-600" />
      </Link>)}</div>
    </section>)}
    {!groups.length && <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500 dark:border-slate-700">No settings match “{search}”.<button type="button" onClick={() => setSearch('')} className="mx-auto mt-3 block text-xs font-semibold text-emerald-700 dark:text-emerald-400">Clear search</button></div>}
    {!query && storeTools.length > 0 && <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900/50"><h2 className="text-slate-700 dark:text-slate-200">Online store tools</h2><p className="mt-1 text-xs text-slate-500">Manage storefront content, appearance and measurement.</p><div className="mt-3 flex flex-wrap gap-2">{storeTools.map(item => <Link key={item.path} to={item.path} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"><item.icon size={14} />{item.label}</Link>)}</div></section>}
  </div>;
}
