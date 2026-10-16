import { Link, NavLink, useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { allNavigationItems, canSeeNavigationItem, pageTitleForPath, settingsItems } from './navigation';

export function PageContext() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const settings = pathname.startsWith('/settings/');
  const parent = allNavigationItems.find(item => item.path !== '/' && pathname.startsWith(`${item.path}/`));
  if (!parent) return null;
  return <div className="mb-5 space-y-3">
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-xs text-slate-500"><Link to={parent.path} className="shrink-0 hover:text-slate-900 dark:hover:text-white">{parent.label}</Link><ChevronRight size={12} className="shrink-0" /><span aria-current="page" className="truncate text-slate-700 dark:text-slate-300">{pageTitleForPath(pathname)}</span></nav>
    {settings && <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
      <NavLink end to="/settings" className="shrink-0 rounded-md px-3 py-2 text-xs text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800">All settings</NavLink>
      {settingsItems.filter(item => canSeeNavigationItem(item, user?.role, user?.builderAccess)).map(item => <NavLink end to={item.path} key={item.path} className={({ isActive }) => `shrink-0 rounded-md px-3 py-2 text-xs ${isActive ? 'bg-slate-100 font-semibold text-slate-900 dark:bg-slate-800 dark:text-white' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>{item.label}</NavLink>)}
    </nav>}
  </div>;
}
