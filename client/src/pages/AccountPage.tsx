import { Link } from 'react-router-dom';
import { ShieldCheck, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { canAccessPath, roleLabel } from '../components/layout/navigation';

export default function AccountPage() {
  const { user } = useAuth();
  const joined = user?.createdAt && !Number.isNaN(Date.parse(user.createdAt)) ? new Date(user.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : 'Not provided';
  const information = [
    ['Full name', user?.name || 'Not provided'], ['Email address', user?.email || 'Not provided'],
    ['Phone number', user?.phone || 'Not provided'], ['Role', roleLabel(user?.role)],
    ['Account status', user?.status ? user.status.charAt(0) + user.status.slice(1).toLowerCase() : 'Not provided'], ['Member since', joined],
  ];
  return <div className="mx-auto max-w-4xl space-y-5 py-2">
    <div><h1 className="flex items-center gap-2 text-slate-900 dark:text-white"><UserRound size={20} />My account</h1><p className="mt-1 text-xs text-slate-500">Your profile and current account access.</p></div>
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900" aria-label="Profile information">
      <h2 className="text-slate-900 dark:text-white">Profile information</h2>
      <dl className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2">{information.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm font-medium text-slate-800 dark:text-slate-100">{value}</dd></div>)}</dl>
      <p className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-500 dark:border-slate-800">Contact your administrator to update profile details or assigned permissions.</p>
    </section>
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900" aria-label="Security and access"><h2 className="flex items-center gap-2 text-slate-900 dark:text-white"><ShieldCheck size={17} />Security & access</h2>
      <dl className="mt-4 grid gap-5 sm:grid-cols-2"><div><dt className="text-xs text-slate-500">Two-factor authentication</dt><dd className="mt-1 text-sm text-slate-800 dark:text-slate-100">{user?.is2FAEnabled === undefined ? 'Not provided' : user.is2FAEnabled ? 'Enabled' : 'Not enabled'}</dd></div><div><dt className="text-xs text-slate-500">Visual page builder</dt><dd className="mt-1 text-sm text-slate-800 dark:text-slate-100">{user?.builderAccess === undefined ? 'Not provided' : user.builderAccess ? 'Available' : 'Not enabled'}</dd></div></dl>
      <div className="mt-5 flex flex-wrap gap-2"><Link to="/settings/security" className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900">Change password</Link>{canAccessPath('/settings/users', user?.role, user?.builderAccess) && <Link to="/settings/users" className="rounded-lg border border-slate-200 px-3 py-2 text-xs dark:border-slate-700">Manage staff users</Link>}</div>
    </section>
  </div>;
}
