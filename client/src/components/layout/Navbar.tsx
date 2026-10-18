import React, { useEffect, useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Bell,
  CheckCheck,
  Globe2,
  List,
  LogOut,
  MessageSquare,
  Menu,
  Moon,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Sun,
  User as UserIcon,
} from "lucide-react";
import { io } from "socket.io-client";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { IconButton } from "../ui/IconButton";
import { pageTitleForPath, roleLabel, canAccessPath } from "./navigation";

interface NavbarProps {
  onToggleSidebar: () => void;
}

type Alert = {
  id: string;
  title: string;
  detail: string;
  createdAt: string;
  read: boolean;
};

const avatarTone = (name = "") =>
  ["#10b981", "#3b82f6", "#8b5cf6", "#f59e0b", "#06b6d4"][name.length % 5];

export const Navbar: React.FC<NavbarProps> = ({ onToggleSidebar }) => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [avatarBroken, setAvatarBroken] = useState(false);
  const profileArea = useRef<HTMLDivElement>(null);
  const profileButton = useRef<HTMLButtonElement>(null);
  const notificationArea = useRef<HTMLDivElement>(null);
  const notificationButton = useRef<HTMLButtonElement>(null);
  const [alertsUser, setAlertsUser] = useState<string | null>(null);

  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [dhakaTime, setDhakaTime] = useState(() => new Intl.DateTimeFormat("en-BD", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }).format(new Date()));
  useEffect(() => {
    const timer = window.setInterval(() => setDhakaTime(new Intl.DateTimeFormat("en-BD", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }).format(new Date())), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    let saved: Alert[] = [];
    try {
      const parsed: unknown = user?.id ? JSON.parse(localStorage.getItem(`nix-admin-alerts:${user.id}`) || '[]') : [];
      if (Array.isArray(parsed)) saved = parsed.filter(item => item && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.detail === 'string' && typeof item.createdAt === 'string').slice(0, 30);
    } catch { /* An invalid local cache should not prevent account navigation. */ }
    setAlerts(saved);
    setAlertsUser(user?.id || null);
  }, [user?.id]);
  useEffect(() => {
    if (alertsUser && alertsUser === user?.id) {
      try { localStorage.setItem(`nix-admin-alerts:${alertsUser}`, JSON.stringify(alerts.slice(0, 30))); } catch { /* Storage may be unavailable. */ }
    }
  }, [alerts, alertsUser, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    const socket = io();
    socket.on(
      "order:new",
      (order: {
        id: string;
        orderNumber: string;
        customerName: string;
        grandTotal: number;
      }) =>
        setAlerts((current) =>
          [
            {
              id: `order-${order.id}-${Date.now()}`,
              title: `New order ${order.orderNumber}`,
              detail: `${order.customerName} · ৳${order.grandTotal}`,
              createdAt: new Date().toISOString(),
              read: false,
            },
            ...current,
          ].slice(0, 30),
        ),
    );
    return () => {
      socket.disconnect();
    };
  }, [user?.id]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProfileOpen(false);
        setNotificationOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const unread = alerts.filter((alert) => !alert.read).length;
  const markRead = () =>
    setAlerts((current) => current.map((alert) => ({ ...alert, read: true })));

  useEffect(() => { setAvatarBroken(false); }, [user?.avatar]);
  useEffect(() => { setProfileOpen(false); setNotificationOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!profileOpen && !notificationOpen) return;
    if (profileOpen) profileArea.current?.querySelector<HTMLElement>('#account-menu a, #account-menu button')?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!profileArea.current?.contains(event.target as Node)) setProfileOpen(false);
      if (!notificationArea.current?.contains(event.target as Node)) setNotificationOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setProfileOpen(false); setNotificationOpen(false);
      (profileOpen ? profileButton : notificationButton).current?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', escape); };
  }, [profileOpen, notificationOpen]);

  const currentTitle = pageTitleForPath(location.pathname);

  return (
    <header className="admin-topbar sticky top-0 z-30 flex h-[68px] items-center justify-between border-b border-slate-200/70 bg-white/95 px-3 backdrop-blur-md sm:px-5 xl:px-7 dark:border-slate-800 dark:bg-slate-900/95">
      {/* Left side: Mobile Toggle & Desktop Search or Breadcrumb */}
      <div className="flex min-w-0 items-center gap-3">
        <IconButton
          label="Open navigation"
          onClick={onToggleSidebar}
          className="lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </IconButton>

        {/* Page Title */}
        <span className="truncate text-sm font-semibold text-slate-900 dark:text-white">
          {currentTitle}
        </span>
      </div>

      <nav aria-label="Quick actions" className="hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto px-5 xl:flex">
        <button type="button" onClick={() => navigate("/orders")} className="admin-quick-action"><Search className="h-4 w-4" />Search</button>
        <button type="button" onClick={() => navigate("/orders")} className="admin-quick-action"><ShoppingCart className="h-4 w-4" />New Order</button>
        <button type="button" onClick={() => navigate("/orders")} className="admin-quick-action"><Globe2 className="h-4 w-4" />Web Order List</button>
        <button type="button" onClick={() => navigate("/orders")} className="admin-quick-action"><List className="h-4 w-4" />Order List</button>
        <button type="button" onClick={() => navigate("/messaging")} className="admin-quick-action"><MessageSquare className="h-4 w-4" />Send Message</button>
      </nav>

      {/* Right side: Theme, Alerts, User Profile */}
      <div className="flex items-center gap-2">
        <div className="hidden rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-center md:block dark:border-slate-700 dark:bg-slate-800/70">
          <span className="block text-[9px] font-bold uppercase tracking-[0.13em] text-slate-400">Dhaka time</span>
          <span className="block font-mono text-[11px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">{dhakaTime}</span>
        </div>
        {/* Theme switcher */}
        <IconButton
          label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          onClick={toggleTheme}
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4 text-amber-500" />
          ) : (
            <Moon className="h-4 w-4 text-slate-500" />
          )}
        </IconButton>

        {/* Notifications */}
        <div ref={notificationArea} className="relative">
          <button
            type="button"
            ref={notificationButton}
            aria-label="Notifications"
            aria-controls="admin-notifications"
            aria-expanded={notificationOpen}
            onClick={() => {
              setNotificationOpen((current) => !current);
              setProfileOpen(false);
            }}
            className="relative grid h-9 w-9 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <Bell className="h-4 w-4" />
            {unread > 0 && (
              <span className="absolute right-1 top-1 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </button>

          {notificationOpen && (
            <div id="admin-notifications" role="group" aria-label="Notifications" className="fixed left-4 right-4 top-[72px] w-auto max-h-[calc(100dvh-90px)] overflow-y-auto sm:absolute sm:left-auto sm:right-0 sm:top-[calc(100%+8px)] sm:w-[340px] rounded-2xl border border-slate-100 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <div>
                  <b className="text-xs font-bold text-slate-900 dark:text-white">
                    Notifications
                  </b>
                  <p className="text-[10px] text-slate-400">
                    Real-time order events
                  </p>
                </div>
                {unread > 0 && (
                  <button
                    onClick={markRead}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 hover:text-emerald-700"
                  >
                    <CheckCheck className="h-3 w-3" />
                    Mark all read
                  </button>
                )}
              </div>
              <div className="max-h-72 overflow-y-auto">
                {alerts.length ? (
                  alerts.map((alert) => (
                    <button
                      key={alert.id}
                      onClick={() => {
                        setAlerts((current) =>
                          current.map((item) =>
                            item.id === alert.id ? { ...item, read: true } : item,
                          ),
                        );
                        navigate("/orders");
                        setNotificationOpen(false);
                      }}
                      className={`flex w-full gap-3 border-b border-slate-50 px-4 py-3 text-left last:border-0 hover:bg-slate-50/70 dark:border-slate-800/60 dark:hover:bg-slate-800/40 ${
                        alert.read ? "opacity-60" : ""
                      }`}
                    >
                      <span
                        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                          alert.read ? "bg-slate-300 dark:bg-slate-600" : "bg-emerald-500"
                        }`}
                      />
                      <span className="min-w-0">
                        <b className="block truncate text-xs font-semibold text-slate-800 dark:text-slate-100">
                          {alert.title}
                        </b>
                        <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">
                          {alert.detail}
                        </span>
                        <span className="mt-0.5 block text-[9px] text-slate-400">
                          {new Date(alert.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="px-4 py-8 text-center text-xs text-slate-400">
                    No new notifications
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* User Profile dropdown */}
        <div ref={profileArea} className="relative">
          <button
            type="button"
            onClick={() => {
              setProfileOpen((current) => !current);
              setNotificationOpen(false);
            }}
            className="flex items-center gap-2 rounded-full p-1 transition hover:bg-slate-100 dark:hover:bg-slate-800"
            ref={profileButton}
            aria-label={`Account menu for ${user?.name || 'user'}`}
            aria-controls="account-menu"
            aria-expanded={profileOpen}
          >
            {user?.avatar && !avatarBroken ? (
              <img
                src={user.avatar}
                alt=""
                onError={() => setAvatarBroken(true)}
                className="h-8 w-8 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-700"
              />
            ) : (
              <div
                className="grid h-8 w-8 place-items-center rounded-full text-xs font-bold text-white shadow-sm"
                style={{ background: avatarTone(user?.name) }}
              >
                {user?.name?.slice(0, 1).toUpperCase() || "U"}
              </div>
            )}
            <div className="hidden max-w-40 text-left lg:block">
              <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-200">
                {user?.name || "Admin"}
              </p>
              <p className="truncate text-[10px] text-slate-400">
                {roleLabel(user?.role)}
              </p>
            </div>
          </button>

          {profileOpen && (
            <div id="account-menu" role="group" aria-label="Account menu" className="absolute right-0 top-[calc(100%+8px)] max-h-[calc(100dvh-90px)] w-[min(300px,calc(100vw-32px))] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900" onBlur={event => { if (event.relatedTarget && !profileArea.current?.contains(event.relatedTarget as Node)) setProfileOpen(false); }} onKeyDown={event => {
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const controls = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
              const index = controls.indexOf(document.activeElement as HTMLButtonElement);
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length;
              controls[next]?.focus();
            }}>
              <div className="mb-1 border-b border-slate-100 px-3 py-3 dark:border-slate-800">
                <p className="break-words text-sm font-semibold text-slate-900 dark:text-white">{user?.name || 'Name not provided'}</p>
                <p className="mt-1 break-all text-xs text-slate-500">{user?.email || 'Email not provided'}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2"><span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{roleLabel(user?.role)}</span><span className="text-[10px] text-slate-500">{user?.status ? user.status.charAt(0) + user.status.slice(1).toLowerCase() : 'Status not provided'}</span></div>
              </div>
              {[
                { label: 'Profile & account', path: '/account', icon: UserIcon },
                { label: 'Password & security', path: '/settings/security', icon: ShieldCheck },
                { label: 'Workspace settings', path: '/settings', icon: Settings2 },
                ...(canAccessPath('/settings/users', user?.role, user?.builderAccess) ? [{ label: 'Staff users', path: '/settings/users', icon: UserIcon }] : []),
              ].map(item => <button key={item.path} type="button" onClick={() => { navigate(item.path); setProfileOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"><item.icon size={15} className="text-slate-400" />{item.label}</button>)}
              <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
              <button
                type="button"
                onClick={logout}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/30"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
