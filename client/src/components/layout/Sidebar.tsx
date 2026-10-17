import React from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Store,
  X,
  Boxes,
} from "lucide-react";
import api from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { canSeeNavigationItem, navigationGroups } from "./navigation";

interface SidebarProps {
  isOpen: boolean;
  collapsed: boolean;
  onClose: () => void;
  onToggleCollapsed: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  collapsed: desktopCollapsed,
  onClose,
  onToggleCollapsed,
}) => {
  const { user } = useAuth();
  const location = useLocation();
  const [isDesktop, setIsDesktop] = React.useState(() => window.matchMedia('(min-width: 1024px)').matches);
  const collapsed = desktopCollapsed && isDesktop;
  const asideRef = React.useRef<HTMLElement | null>(null);
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  React.useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsDesktop(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  React.useEffect(() => {
    if (isDesktop || !isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const controls = () => Array.from(asideRef.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)') || []).filter(element => element.getClientRects().length > 0);
    controls()[0]?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key === 'Tab') {
        const elements = controls();
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); previous?.focus(); };
  }, [isDesktop, isOpen]);
  const [storeConnected, setStoreConnected] = React.useState<boolean | null>(null);
  const storefrontUrl = window.location.origin;
  const settingsItem = navigationGroups.flatMap(group => group.items).find(item => item.path === '/settings');
  const SettingsIcon = settingsItem?.icon || Store;

  const [openSubmenus, setOpenSubmenus] = React.useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    navigationGroups.forEach((group) => {
      group.items.forEach((item) => {
        if (item.children?.length) {
          const isChildActive = item.children.filter(child => child.path !== item.path).some(
            (child) => location.pathname === child.path || location.pathname.startsWith(`${child.path}/`)
          );
          if (isChildActive) {
            initial[item.path] = true;
          }
        }
      });
    });
    return initial;
  });

  React.useEffect(() => {
    navigationGroups.forEach((group) => {
      group.items.forEach((item) => {
        if (item.children?.length) {
          const isChildActive = item.children.filter(child => child.path !== item.path).some(
            (child) => location.pathname === child.path || location.pathname.startsWith(`${child.path}/`)
          );
          if (isChildActive) {
            setOpenSubmenus((prev) => (prev[item.path] ? prev : { ...prev, [item.path]: true }));
          }
        }
      });
    });
  }, [location.pathname]);

  const toggleSubmenu = (path: string) => {
    if (collapsed) {
      onToggleCollapsed();
      setOpenSubmenus((prev) => ({ ...prev, [path]: true }));
      return;
    }
    setOpenSubmenus((prev) => ({
      ...prev,
      [path]: !prev[path],
    }));
  };

  React.useEffect(() => {
    api.get("/storefront/settings")
      .then(() => setStoreConnected(true))
      .catch(() => setStoreConnected(false));
  }, []);

  return (
    <>
      {/* Mobile backdrop */}
      <button
        aria-label="Close navigation"
        className={`fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[2px] transition-opacity lg:hidden ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
      />

      {/* Main Sidebar */}
      <aside
        ref={element => { asideRef.current = element; if (element) element.inert = !isDesktop && !isOpen; }}
        aria-hidden={!isDesktop && !isOpen ? true : undefined}
        className={`admin-sidebar fixed inset-y-0 left-0 z-50 flex h-[100dvh] flex-col border-r border-slate-200/80 bg-white text-slate-700 shadow-xl transition-[width,transform] duration-300 lg:z-20 lg:translate-x-0 lg:shadow-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 ${
          collapsed ? "w-[64px]" : "w-[212px]"
        } ${isOpen ? "translate-x-0" : "-translate-x-full"} lg:flex`}
      >
        {/* Header with Logo and Collapse Toggle */}
        <div
          className={`flex h-14 shrink-0 items-center border-b border-slate-100 px-3 dark:border-slate-800/80 ${
            collapsed ? "justify-center" : "justify-between"
          }`}
        >
          <NavLink
            to="/"
            className="flex min-w-0 items-center gap-2"
            onClick={onClose}
            aria-label="NIX Commerce home"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-xs font-bold text-white shadow-sm shadow-emerald-500/20">
              N
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="truncate text-xs font-bold tracking-tight text-slate-900 dark:text-white">
                  NIX Commerce
                </p>
                <p className="truncate text-[9.5px] font-medium text-slate-400 dark:text-slate-500">
                  Operations workspace
                </p>
              </div>
            )}
          </NavLink>

          {/* Desktop collapse button at top next to logo */}
          {!collapsed && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="hidden rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 lg:flex dark:hover:bg-slate-800 dark:hover:text-white"
              title="Collapse sidebar"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}

          {/* Mobile close button */}
          {!collapsed && (
            <button
              onClick={onClose}
              aria-label="Close navigation"
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900 lg:hidden dark:hover:bg-slate-800 dark:hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Collapsed top expand button */}
        {collapsed && (
          <div className="hidden border-b border-slate-100 py-2 text-center lg:block dark:border-slate-800">
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"
              title="Expand sidebar"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Nav groups */}
        <nav aria-label="Main navigation" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="px-2 py-3">
          {navigationGroups.filter(group => group.label !== 'Administration').map((group, groupIndex) => {
            const visibleItems = group.items.filter((item) =>
              canSeeNavigationItem(item, user?.role, user?.builderAccess),
            );
            if (!visibleItems.length) return null;

            return (
              <div key={group.label} className={groupIndex ? "mt-4" : ""}>
                {!collapsed && (
                  <p className="mb-1 px-2 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">
                    {group.label}
                  </p>
                )}
                <div className="space-y-0.5">
                  {visibleItems.map((item) => {
                    const Icon = item.icon;
                    const hasChildren = Boolean(item.children?.length);
                    const isSubmenuOpen = Boolean(openSubmenus[item.path]);
                    const itemActive =
                      location.pathname === item.path ||
                      (item.path !== '/' && location.pathname.startsWith(`${item.path}/`)) ||
                      Boolean(
                        item.children?.some(
                          (child) =>
                            location.pathname === child.path ||
                            location.pathname.startsWith(`${child.path}/`),
                        ),
                      );

                    return (
                      <div key={item.path}>
                        {hasChildren ? (
                          <button
                            type="button"
                            onClick={() => toggleSubmenu(item.path)}
                            aria-label={`Toggle ${item.label} sections`}
                            aria-expanded={isSubmenuOpen}
                            aria-controls={`navigation-${item.path.slice(1)}`}
                            title={collapsed ? item.label : undefined}
                            className={`group flex w-full items-center rounded-xl px-2.5 py-1.5 text-xs font-medium transition-all ${
                              collapsed ? "justify-center" : "justify-between"
                            } ${
                              itemActive
                                ? "bg-slate-100 font-semibold text-slate-900 shadow-none dark:bg-slate-800 dark:text-white"
                                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-white"
                            }`}
                          >
                            <div className={`flex min-w-0 items-center ${collapsed ? "justify-center" : "gap-2"}`}>
                              <Icon className={`h-4 w-4 shrink-0 transition-colors ${itemActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300'}`} />
                              {!collapsed && <span className="truncate">{item.label}</span>}
                            </div>
                            {!collapsed && (
                              <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-200 ${isSubmenuOpen ? 'rotate-180 text-slate-600 dark:text-slate-200' : ''}`} />
                            )}
                          </button>
                        ) : (
                          <NavLink
                            to={item.path}
                            title={collapsed ? item.label : undefined}
                            onClick={onClose}
                            className={({ isActive }) =>
                              `group flex items-center rounded-xl px-2.5 py-1.5 text-xs font-medium transition-all ${
                                collapsed ? "justify-center" : "gap-2"
                              } ${
                                isActive
                                  ? "bg-slate-100 font-semibold text-slate-900 shadow-none dark:bg-slate-800 dark:text-white"
                                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-white"
                              }`
                            }
                          >
                            <Icon
                              className={`h-4 w-4 shrink-0 transition-colors ${
                                itemActive
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300"
                              }`}
                              strokeWidth={2}
                            />
                            {!collapsed && <span className="truncate">{item.label}</span>}
                          </NavLink>
                        )}

                        {/* Submenu items */}
                        {!collapsed && hasChildren && isSubmenuOpen && (
                          <div id={`navigation-${item.path.slice(1)}`} className="ml-3 mt-0.5 space-y-0.5 border-l border-slate-200/80 pl-2.5 dark:border-slate-800">
                            {item.children
                              ?.filter(
                                (child) =>
                                  !child.roles ||
                                  (user && child.roles.includes(user.role)),
                              )
                              .map((child) => (
                                <NavLink
                                  key={child.path}
                                  end
                                  to={child.path}
                                  onClick={onClose}
                                  className={({ isActive }) =>
                                    `block truncate rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${
                                      isActive
                                        ? "bg-emerald-50 font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                                        : "text-slate-500 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/40 dark:hover:text-white"
                                    }`
                                  }
                                >
                                  {child.label}
                                </NavLink>
                              ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          </div>

          {settingsItem && (
            <div className="mx-2 mb-3">
              <button
                type="button"
                onClick={() => toggleSubmenu('/settings')}
                aria-label="Toggle Settings menu"
                aria-expanded={Boolean(openSubmenus['/settings'])}
                aria-controls="navigation-settings"
                title={collapsed ? 'Settings' : undefined}
                className={`group flex w-full items-center rounded-xl px-2.5 py-1.5 text-xs font-medium transition-all ${
                  collapsed ? "justify-center" : "justify-between"
                } ${
                  location.pathname.startsWith('/settings')
                    ? "bg-slate-100 font-semibold text-slate-900 shadow-none dark:bg-slate-800 dark:text-white"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-white"
                }`}
              >
                <div className={`flex min-w-0 items-center ${collapsed ? "justify-center" : "gap-2"}`}>
                  <SettingsIcon
                    size={16}
                    className={`shrink-0 transition-colors ${
                      location.pathname.startsWith('/settings')
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300"
                    }`}
                  />
                  {!collapsed && <span className="truncate">Settings</span>}
                </div>
                {!collapsed && (
                  <ChevronDown
                    size={13}
                    className={`shrink-0 text-slate-400 transition-transform duration-200 ${
                      openSubmenus['/settings'] ? "rotate-180 text-slate-600 dark:text-slate-200" : ""
                    }`}
                  />
                )}
              </button>

              {/* Submenu items */}
              {!collapsed && openSubmenus['/settings'] && (
                <div id="navigation-settings" className="ml-3 mt-1 space-y-0.5 border-l border-slate-200/80 pl-2.5 dark:border-slate-800">
                  {settingsItem.children
                    ?.filter(child => !child.roles || (user && child.roles.includes(user.role)))
                    .map((child) => (
                      <NavLink
                        key={child.path}
                        end={child.path === '/settings'}
                        to={child.path}
                        onClick={onClose}
                        className={({ isActive }) =>
                          `block truncate rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${
                            isActive
                              ? "bg-emerald-50 font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                              : "text-slate-500 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/40 dark:hover:text-white"
                          }`
                        }
                      >
                        {child.label}
                      </NavLink>
                    ))}
                </div>
              )}
            </div>
          )}
        </nav>

        {/* Footer Link to Storefront */}
        <div className="shrink-0 border-t border-slate-100 p-3 dark:border-slate-800">
          {!collapsed && (
            <a
              href={storefrontUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2.5 rounded-xl border border-slate-200/70 bg-slate-50/70 p-2.5 transition hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-800/50 dark:hover:bg-slate-800"
            >
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
                <Store className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-xs font-semibold text-slate-800 dark:text-slate-100">
                  View storefront <ExternalLink className="h-3 w-3 opacity-40" />
                </span>
                <span className="flex items-center gap-1.5 text-[10px] text-slate-400">
                  <i
                    className={`h-1.5 w-1.5 rounded-full ${
                      storeConnected === true
                        ? "bg-emerald-500"
                        : storeConnected === false
                        ? "bg-rose-400"
                        : "bg-amber-300"
                    }`}
                  />
                  {storeConnected === null ? "Checking connection…" : storeConnected ? "Connected" : "Unavailable"}
                </span>
              </span>
            </a>
          )}
        </div>
      </aside>
    </>
  );
};
