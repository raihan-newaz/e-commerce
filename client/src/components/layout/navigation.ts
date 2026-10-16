import {
  Activity,
  Mail, CreditCard, ShieldCheck, History, UserRound, Plug,
  BarChart3,
  Boxes,
  PackageSearch,
  FolderTree,
  Images,
  Calculator,
  ReceiptText,
  LayoutDashboard,
  MessageSquareText,
  Palette,
  FileText,
  Store,
  Tags,
  PackageCheck,
  Settings2,
  ShoppingBag,
  Truck,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import type { User } from '../../types';

export interface NavigationItem {
  label: string;
  path: string;
  icon: LucideIcon;
  description: string;
  roles?: User['role'][];
  children?: Array<{ label: string; path: string; roles?: User['role'][] }>;
}

export interface NavigationGroup {
  label: string;
  items: NavigationItem[];
}

export const settingsGroups: NavigationGroup[] = [
  { label: 'Connections & checkout', items: [
    { label: 'WooCommerce', path: '/settings/woocommerce', icon: Plug, description: 'Connect a store and manage order synchronization', roles: ['SUPER_ADMIN'] },
    { label: 'Couriers', path: '/settings/couriers', icon: Truck, description: 'Provider credentials, pickup stores and webhooks', roles: ['SUPER_ADMIN', 'OPERATIONS_MANAGER'] },
    { label: 'Payments', path: '/settings/payments', icon: CreditCard, description: 'Online checkout and payment gateway configuration', roles: ['SUPER_ADMIN'] },
    { label: 'Email notifications', path: '/settings/email', icon: Mail, description: 'SMTP delivery, order templates and delivery history', roles: ['SUPER_ADMIN'] },
  ] },
  { label: 'Team & account', items: [
    { label: 'Dropdown options', path: '/settings/dropdowns', icon: Settings2, description: 'Add, edit, reorder and hide options; protect values already in use', roles: ['SUPER_ADMIN'] },
    { label: 'Staff users', path: '/settings/users', icon: UsersRound, description: 'Staff accounts, roles and access', roles: ['SUPER_ADMIN', 'OPERATIONS_MANAGER'] },
    { label: 'Security', path: '/settings/security', icon: ShieldCheck, description: 'Change your password and manage account security' },
  ] },
  { label: 'Safety & activity', items: [
    { label: 'Order protection', path: '/settings/order-protection', icon: ShieldCheck, description: 'Duplicate-order checks and customer risk rules', roles: ['SUPER_ADMIN', 'OPERATIONS_MANAGER'] },
    { label: 'Audit log', path: '/settings/audit', icon: History, description: 'Review staff actions and order activity', roles: ['SUPER_ADMIN', 'OPERATIONS_MANAGER'] },
  ] },
];
export const settingsItems = settingsGroups.flatMap(group => group.items);

// These rules control discoverability. Backend authorization remains authoritative.
export const navigationGroups: NavigationGroup[] = [
  { label: 'Orders & customers', items: [
    { label: 'Overview', path: '/', icon: LayoutDashboard, description: 'Business health and action center' },
    { label: 'Orders', path: '/orders', icon: ShoppingBag, description: 'Process, assign, and dispatch orders' },
    { label: 'Incomplete Orders', path: '/incomplete-orders', icon: PackageSearch, description: 'Follow up abandoned checkouts and convert confirmed customers', roles: ['SUPER_ADMIN', 'OPERATIONS_MANAGER', 'CALL_CENTER_AGENT'] },
    { label: 'Customers', path: '/crm', icon: UsersRound, description: 'Customer intelligence and risk' },
    { label: 'Messages', path: '/messaging', icon: MessageSquareText, description: 'WhatsApp, SMS, and templates', roles: ['SUPER_ADMIN', 'OPERATIONS_MANAGER', 'CALL_CENTER_AGENT'] },
    { label: 'Courier & COD', path: '/courier-hub', icon: Truck, description: 'Delivery operations and reconciliation', roles: ['SUPER_ADMIN', 'OPERATIONS_MANAGER', 'DISPATCHER', 'ACCOUNTANT'] },
  ] },
  { label: 'Catalog & stock', items: [
    { label: 'Products', path: '/products', icon: PackageSearch, description: 'Catalogue, pricing, variations, media, and SEO' },
    { label: 'Inventory', path: '/inventory', icon: Boxes, description: 'Stock levels, alerts, and adjustments' },
    { label: 'Categories', path: '/categories', icon: FolderTree, description: 'Product taxonomy and storefront collections' },
    { label: 'Attributes', path: '/attributes', icon: Tags, description: 'Reusable product options and variation terms' },
    { label: 'Media Gallery', path: '/media', icon: Images, description: 'Upload and reuse storefront images' },
    { label: 'Purchases', path: '/purchases', icon: PackageCheck, description: 'Suppliers and purchase orders', roles: ['SUPER_ADMIN', 'OPERATIONS_MANAGER', 'INVENTORY_MANAGER', 'ACCOUNTANT'] },
  ] },
  { label: 'Online store', items: [
    { label: 'Store settings', path: '/storefront', icon: Store, description: 'Shop content, merchandising, and delivery rates', roles: ['SUPER_ADMIN', 'OPERATIONS_MANAGER'] },
    { label: 'Pages', path: '/pages', icon: FileText, description: 'Manage landing, content, and visual pages', roles: ['SUPER_ADMIN', 'OPERATIONS_MANAGER'] },
    { label: 'Theme Customizer', path: '/theme-customizer', icon: Palette, description: 'Colors, type, layout, and homepage sections', roles: ['SUPER_ADMIN', 'OPERATIONS_MANAGER'] },
    { label: 'Tracking & CAPI', path: '/tracking', icon: Activity, description: 'Google Analytics, Meta Pixel, server-side CAPI & custom events', roles: ['SUPER_ADMIN', 'OPERATIONS_MANAGER'] },
  ] },
  { label: 'Finance & reports', items: [
    { label: 'Accounting', path: '/accounting', icon: Calculator, description: 'Profit, purchases, expenses, and cash accounts', roles: ['SUPER_ADMIN', 'ACCOUNTANT', 'OPERATIONS_MANAGER'] },
    { label: 'Expenses', path: '/expenses', icon: ReceiptText, description: 'Record, categorize, and review operating costs', roles: ['SUPER_ADMIN', 'ACCOUNTANT', 'OPERATIONS_MANAGER'] },
    { label: 'Analytics', path: '/analytics', icon: BarChart3, description: 'Sales, profit, customers, costs, and purchase trends', roles: ['SUPER_ADMIN', 'ACCOUNTANT', 'OPERATIONS_MANAGER'] },
  ] },
  { label: 'Administration', items: [
    { label: 'Settings', path: '/settings', icon: Settings2, description: 'Connections, team, security and workspace preferences', children: [
      { label: 'All settings', path: '/settings' },
      ...settingsItems.map(({ label, path, roles }) => ({ label, path, roles })),
    ] },
  ] },
];

export const accountNavigationItem: NavigationItem = { label: 'My account', path: '/account', icon: UserRound, description: 'Your profile, role and account information' };
export const allNavigationItems = [...navigationGroups.flatMap(group => group.items), accountNavigationItem];
export const canSeeNavigationItem = (item: NavigationItem, role?: User['role'], builderAccess?: boolean) =>
  item.path === '/builder' && builderAccess !== undefined ? builderAccess : !item.roles || (!!role && item.roles.includes(role));

export const canAccessPath = (pathname: string, role?: User['role'], builderAccess?: boolean) => {
  if (pathname === '/builder' || pathname.startsWith('/landing-pages')) return Boolean(builderAccess) && (role === 'SUPER_ADMIN' || role === 'OPERATIONS_MANAGER');
  const item = allNavigationItems.find(candidate => pathname === candidate.path || (candidate.path !== '/' && pathname.startsWith(`${candidate.path}/`)));
  if (!item || !canSeeNavigationItem(item, role, builderAccess)) return false;
  const child = item.children?.find(candidate => candidate.path === pathname);
  if (item.children && pathname !== item.path && !child) return false;
  return !child?.roles || (!!role && child.roles.includes(role));
};

export const roleLabel = (role?: string) => role ? role.toLowerCase().split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : 'Staff';

export const pageTitleForPath = (pathname: string): string => {
  const setting = settingsItems.find(item => item.path === pathname);
  if (setting) return setting.label;
  if (pathname === '/landing-pages/new') return 'Create landing page';
  if (pathname.startsWith('/landing-pages/')) return 'Edit landing page';
  if (pathname === '/pages/new') return 'Create page';
  if (pathname.startsWith('/pages/')) return 'Edit page';
  if (pathname.startsWith('/orders/')) return 'Order details';
  if (pathname.startsWith('/purchases/')) return 'Purchase details';
  if (pathname === '/products/new') return 'Create product';
  if (pathname.startsWith('/products/')) return 'Edit product';
  return allNavigationItems.find(item => item.path === pathname)?.label || 'NIX Commerce';
};
export const pageDescriptionForPath = (pathname: string): string => {
  const setting = settingsItems.find(item => item.path === pathname);
  if (setting) return setting.description;
  if (pathname.startsWith('/orders/')) return 'Customer, payment, items, risk and fulfillment';
  if (pathname.startsWith('/purchases/')) return 'Supplier, purchased items, payments and stock receipts';
  if (pathname.startsWith('/products/')) return 'Storefront content, pricing, variations and stock';
  if (pathname.startsWith('/pages/')) return 'Page content, URL and search appearance';
  return allNavigationItems.find(item => item.path === pathname)?.description || 'NIX Commerce operations workspace';
};
