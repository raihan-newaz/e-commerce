import React, { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Calendar,
  ChevronDown,
  Store,
  ArrowRight,
  Check,
  Loader2,
  AlertTriangle,
  Clock,
  Truck,
  ShieldAlert,
  Package,
  RefreshCw,
} from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { StatusBadge } from '../components/ui/StatusBadge';
import { SalesReturnsChart } from '../components/dashboard/SalesReturnsChart';
import { ConversionFunnelCard } from '../components/dashboard/ConversionFunnelCard';
import { RadialGaugeCard } from '../components/dashboard/RadialGaugeCard';
import { TrafficSourcesCard } from '../components/dashboard/TrafficSourcesCard';
import { RegionSalesCard } from '../components/dashboard/RegionSalesCard';

// Smart currency formatter: omits .00 to save card space and prevent line breaks
const money = (amount?: number) => {
  const num = Number(amount || 0);
  return `৳ ${num.toLocaleString(undefined, {
    minimumFractionDigits: num % 1 !== 0 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
};

const statusTone = (status: string) => {
  if (status === 'DELIVERED') return 'success';
  if (status === 'RETURNED' || status === 'CANCELLED') return 'danger';
  if (status === 'PENDING') return 'warning';
  return 'info';
};

const DATE_RANGES = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7days', label: 'Last 7 days' },
  { id: '30days', label: 'Last 30 days' },
  { id: 'this_month', label: 'This Month' },
  { id: 'all', label: 'All Time' },
];

const CHANNELS = [
  { id: 'all', label: 'All Channels' },
  { id: 'direct', label: 'Direct Storefront' },
  { id: 'woocommerce', label: 'WooCommerce Sync' },
];

export const DashboardPage: React.FC = () => {
  const { user } = useAuth();
  const canViewCosts = ['SUPER_ADMIN', 'OPERATIONS_MANAGER', 'ACCOUNTANT'].includes(user?.role || '');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [range, setRange] = useState('today');
  const [channel, setChannel] = useState('all');
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeDashboardTab, setActiveDashboardTab] = useState('My Dashboard');
  const [isDateOpen, setIsDateOpen] = useState(false);
  const [isChannelOpen, setIsChannelOpen] = useState(false);
  const [greenStats, setGreenStats] = useState<Record<string, string | null> | null>(null);
  const [actionCenter, setActionCenter] = useState<any>(null);
  const dateRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<HTMLDivElement>(null);

  // Fetch real-time Action Center metrics for operational queues
  useEffect(() => {
    let cancelled = false;
    api.get('/dashboard/action-center')
      .then((res) => {
        if (!cancelled && res.data?.success) {
          setActionCenter(res.data.actionCenter);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dateRef.current && !dateRef.current.contains(event.target as Node)) {
        setIsDateOpen(false);
      }
      if (channelRef.current && !channelRef.current.contains(event.target as Node)) {
        setIsChannelOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch dashboard summary dynamically when range or channel changes
  useEffect(() => {
    let cancelled = false;
    if (data) {
      setIsRefreshing(true);
    } else {
      setLoading(true);
    }

    api.get('/dashboard/summary', { params: { range, channel } })
      .then((response) => {
        if (!cancelled && response.data?.success) {
          setData(response.data.summary);
        }
      })
      .catch((error) => console.error('Error fetching dashboard summary:', error))
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setIsRefreshing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [range, channel, refreshKey]);

  useEffect(() => {
    let cancelled = false;
    api.get('/messaging/greensms/stats').then(({ data }) => { if (!cancelled && data.success) setGreenStats(data.stats); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-emerald-600 dark:border-slate-800 dark:border-t-emerald-500" />
          <p className="text-xs font-medium text-slate-400">Loading live metrics...</p>
        </div>
      </div>
    );
  }

  const financials = data?.financials || {};
  const status = data?.statusBreakdown || {};

  // Pipeline links for immediate operations
  const pipeline = [
    { label: 'To confirm', value: status.PENDING || 0, href: '/orders?status=PENDING' },
    { label: 'Ready to pack', value: (status.CONFIRMED || 0) + (status.PACKAGING || 0), href: '/orders?status=CONFIRMED' },
    { label: 'In delivery', value: (status.HANDED_OVER || 0) + (status.IN_TRANSIT || 0), href: '/orders?status=IN_TRANSIT' },
    { label: 'Delivered', value: status.DELIVERED || 0, href: '/orders?status=DELIVERED' },
  ];

  // Dynamic values strictly from database
  const netProfit = financials.netProfit ?? 0;
  const totalOrdersCount = data?.totalOrdersCount ?? 0;
  const avgOrderValue = data?.avgOrderValue ?? 0;
  const totalUnitsSold = data?.totalUnitsSold ?? 0;
  const pendingOrders = status.PENDING ?? 0;
  const trendData = data?.trendData || [];
  const conversionSteps = data?.conversionFunnel || [];
  const conversionRate = data?.conversionRate ?? 0;
  const traffic = data?.trafficSources || {
    marketingSpend: 0,
    cpa: 0,
    impressions: 0,
    clicks: 0,
    channels: [],
  };
  const regions = data?.regionalSales || [];
  const totalSalesSum = financials.totalDeliveredRevenue || data?.totalSalesAllTime || 0;
  const totalReturnsSum = financials.totalReturnLoss || 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      id="dashboard-top"
      className="dashboard-page flex flex-col space-y-5 pb-12 sm:space-y-6"
    >
      {/* Top Header: Title and Quick Selectors */}
      <div className="dashboard-page-header flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl lg:text-3xl dark:text-white">
            Ecommerce Dashboard
          </h1>
          <p className="mt-0.5 text-[11px] text-slate-400 sm:text-xs dark:text-slate-500">
            Orders, sales, courier performance, products, marketing, and team execution in one view
          </p>
        </div>

        {/* Right side filter pills */}
        <div className="flex flex-wrap items-center gap-2">
          {isRefreshing && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 rounded-xl animate-pulse">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Updating...</span>
            </div>
          )}

          {/* Date Range Dropdown */}
          <div className="relative inline-flex items-center" ref={dateRef}>
            <button
              type="button"
              onClick={() => {
                setIsDateOpen(!isDateOpen);
                setIsChannelOpen(false);
              }}
              className={`h-9 flex items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold shadow-sm transition cursor-pointer ${
                isDateOpen
                  ? 'border-emerald-500 bg-emerald-50/70 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/50'
                  : 'border-slate-200/80 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              <Calendar className="h-3.5 w-3.5 text-slate-400" />
              <span>{DATE_RANGES.find((r) => r.id === range)?.label || 'Today'}</span>
              <ChevronDown className={`h-3 w-3 text-slate-400 transition-transform ${isDateOpen ? 'rotate-180 text-emerald-500' : ''}`} />
            </button>

            {isDateOpen && (
              <div className="absolute right-0 top-full mt-1.5 z-50 min-w-[170px] rounded-2xl border border-slate-200/90 bg-white p-1.5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 animate-in fade-in slide-in-from-top-1 duration-150">
                <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Select Timeframe
                </div>
                {DATE_RANGES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setRange(item.id);
                      setIsDateOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-xs transition-colors cursor-pointer ${
                      range === item.id
                        ? 'bg-emerald-50 font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
                        : 'font-medium text-slate-700 hover:bg-slate-100/80 dark:text-slate-200 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span>{item.label}</span>
                    {range === item.id && <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Sales Channel Dropdown */}
          <div className="relative inline-flex items-center" ref={channelRef}>
            <button
              type="button"
              onClick={() => {
                setIsChannelOpen(!isChannelOpen);
                setIsDateOpen(false);
              }}
              className={`h-9 flex items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold shadow-sm transition cursor-pointer ${
                isChannelOpen
                  ? 'border-emerald-500 bg-emerald-50/70 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/50'
                  : 'border-slate-200/80 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              <Store className="h-3.5 w-3.5 text-slate-400" />
              <span>{CHANNELS.find((c) => c.id === channel)?.label || 'All Channels'}</span>
              <ChevronDown className={`h-3 w-3 text-slate-400 transition-transform ${isChannelOpen ? 'rotate-180 text-emerald-500' : ''}`} />
            </button>

            {isChannelOpen && (
              <div className="absolute right-0 top-full mt-1.5 z-50 min-w-[190px] rounded-2xl border border-slate-200/90 bg-white p-1.5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 animate-in fade-in slide-in-from-top-1 duration-150">
                <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Select Channel
                </div>
                {CHANNELS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setChannel(item.id);
                      setIsChannelOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-xs transition-colors cursor-pointer ${
                      channel === item.id
                        ? 'bg-emerald-50 font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
                        : 'font-medium text-slate-700 hover:bg-slate-100/80 dark:text-slate-200 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span>{item.label}</span>
                    {channel === item.id && <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <nav aria-label="Dashboard sections" className="dashboard-tabs flex items-center gap-1 overflow-x-auto rounded-xl border border-[#e8e5ec] bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
        <a aria-current={activeDashboardTab === 'My Dashboard' ? 'page' : undefined} className={`dashboard-tab ${activeDashboardTab === 'My Dashboard' ? 'is-active' : ''}`} href="#dashboard-top" onClick={() => setActiveDashboardTab('My Dashboard')}>My Dashboard</a>
        <a aria-current={activeDashboardTab === 'Overview' ? 'location' : undefined} className={`dashboard-tab ${activeDashboardTab === 'Overview' ? 'is-active' : ''}`} href="#dashboard-overview" onClick={() => setActiveDashboardTab('Overview')}>Overview</a>
        <a aria-current={activeDashboardTab === 'Decision' ? 'location' : undefined} className={`dashboard-tab ${activeDashboardTab === 'Decision' ? 'is-active' : ''}`} href="#dashboard-decision" onClick={() => setActiveDashboardTab('Decision')}>Decision</a>
        <a aria-current={activeDashboardTab === 'Operations' ? 'location' : undefined} className={`dashboard-tab ${activeDashboardTab === 'Operations' ? 'is-active' : ''}`} href="#dashboard-operations" onClick={() => setActiveDashboardTab('Operations')}>Operations</a>
        <Link aria-current={activeDashboardTab === 'Products' ? 'page' : undefined} className={`dashboard-tab ${activeDashboardTab === 'Products' ? 'is-active' : ''}`} to="/products" onClick={() => setActiveDashboardTab('Products')}>Products</Link>
        <a aria-current={activeDashboardTab === 'Marketing' ? 'location' : undefined} className={`dashboard-tab ${activeDashboardTab === 'Marketing' ? 'is-active' : ''}`} href="#dashboard-marketing" onClick={() => setActiveDashboardTab('Marketing')}>Marketing</a>
        <Link aria-current={activeDashboardTab === 'Customers & Team' ? 'page' : undefined} className={`dashboard-tab ${activeDashboardTab === 'Customers & Team' ? 'is-active' : ''}`} to="/crm" onClick={() => setActiveDashboardTab('Customers & Team')}>Customers &amp; Team</Link>
        <a aria-current={activeDashboardTab === 'Activity' ? 'location' : undefined} className={`dashboard-tab ${activeDashboardTab === 'Activity' ? 'is-active' : ''}`} href="#dashboard-activity" onClick={() => setActiveDashboardTab('Activity')}>Activity</a>
      </nav>

      <div className="dashboard-configure-bar flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e8e5ec] bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <h2 className="text-sm font-semibold">My Dashboard</h2>
          <p className="text-xs text-slate-500">Live metrics for the selected period and sales channel.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/analytics" className="dashboard-outline-button">Founder Dashboard</Link>
          <button type="button" className="dashboard-outline-button" onClick={() => setRefreshKey(value => value + 1)} disabled={isRefreshing}>
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} /> {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {greenStats && <section className="dashboard-sms rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900 dark:bg-emerald-950/20"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-semibold text-emerald-950 dark:text-emerald-200">GreenSMS account</h2><p className="text-xs text-slate-500">Live data from the SMS provider</p></div><Link to="/messaging" className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">All SMS data <ArrowRight className="h-3.5 w-3.5"/></Link></div><div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">{([['balance', 'Balance'], ['rate', 'Rate / SMS'], ['expiry', 'Validity'], ['tokenmonthlysms', 'Sent this month']] as const).map(([key, label]) => <div key={key} className="rounded-xl bg-white p-3 dark:bg-slate-900"><span className="text-[11px] text-slate-500">{label}</span><p className="mt-1 text-lg font-semibold">{greenStats[key] ?? '—'}</p></div>)}</div></section>}

      {/* Operations Action Center: 6 real-time cards */}
      <section id="dashboard-decision" className="dashboard-action-center space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h2 className="text-sm font-bold tracking-tight text-slate-900 dark:text-white uppercase">
              Operations Action Center
            </h2>
          </div>
          <span className="text-[11px] text-slate-400">Click any card to open the filtered queue</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Card 1: Unassigned Pending */}
          <Link
            to="/orders?status=PENDING&assignee=UNASSIGNED"
            className="group block p-3.5 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm hover:border-amber-400 hover:shadow-md transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="p-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400">
                <Clock className="w-4 h-4" />
              </span>
              <span className="text-xs font-bold text-amber-600 group-hover:translate-x-0.5 transition-transform">→</span>
            </div>
            <div className="mt-2.5 text-2xl font-black text-slate-900 dark:text-white tabular-nums">
              {actionCenter?.unassignedPending ?? 0}
            </div>
            <div className="mt-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">
              Unassigned Pending
            </div>
            <div className="mt-1 text-[10px] text-slate-400">Awaiting agent pick</div>
          </Link>

          {/* Card 2: Stuck Orders (>48h) */}
          <Link
            to="/orders?orderAge=48h"
            className="group block p-3.5 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm hover:border-rose-400 hover:shadow-md transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="p-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400">
                <AlertTriangle className="w-4 h-4" />
              </span>
              <span className="text-xs font-bold text-rose-600 group-hover:translate-x-0.5 transition-transform">→</span>
            </div>
            <div className="mt-2.5 text-2xl font-black text-slate-900 dark:text-white tabular-nums">
              {actionCenter?.stuckOrders ?? 0}
            </div>
            <div className="mt-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">
              Stuck Orders
            </div>
            <div className="mt-1 text-[10px] text-slate-400">&gt; 48 hours in queue</div>
          </Link>

          {/* Card 3: Low Stock Variations */}
          <Link
            to="/inventory"
            className="group block p-3.5 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm hover:border-amber-400 hover:shadow-md transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="p-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400">
                <Package className="w-4 h-4" />
              </span>
              <span className="text-xs font-bold text-amber-600 group-hover:translate-x-0.5 transition-transform">→</span>
            </div>
            <div className="mt-2.5 text-2xl font-black text-slate-900 dark:text-white tabular-nums">
              {actionCenter?.lowStockVariations ?? 0}
            </div>
            <div className="mt-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">
              Low Stock Items
            </div>
            <div className="mt-1 text-[10px] text-slate-400">At or below reorder</div>
          </Link>

          {/* Card 4: Uncertain Bookings */}
          <Link
            to="/courier-hub"
            className="group block p-3.5 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm hover:border-purple-400 hover:shadow-md transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="p-1.5 rounded-xl bg-purple-50 dark:bg-purple-950/30 text-purple-600 dark:text-purple-400">
                <Truck className="w-4 h-4" />
              </span>
              <span className="text-xs font-bold text-purple-600 group-hover:translate-x-0.5 transition-transform">→</span>
            </div>
            <div className="mt-2.5 text-2xl font-black text-slate-900 dark:text-white tabular-nums">
              {actionCenter?.uncertainCourierBookings ?? 0}
            </div>
            <div className="mt-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">
              Uncertain Courier
            </div>
            <div className="mt-1 text-[10px] text-slate-400">Pending confirmation</div>
          </Link>

          {/* Card 5: Return Requests */}
          <Link
            to="/orders?status=RETURNED"
            className="group block p-3.5 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm hover:border-rose-400 hover:shadow-md transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="p-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400">
                <RefreshCw className="w-4 h-4" />
              </span>
              <span className="text-xs font-bold text-rose-600 group-hover:translate-x-0.5 transition-transform">→</span>
            </div>
            <div className="mt-2.5 text-2xl font-black text-slate-900 dark:text-white tabular-nums">
              {actionCenter?.returnRequests ?? 0}
            </div>
            <div className="mt-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">
              Return Requests
            </div>
            <div className="mt-1 text-[10px] text-slate-400">Requires processing</div>
          </Link>

          {/* Card 6: COD Discrepancies */}
          <Link
            to="/orders?settlement=DISCREPANCY"
            className="group block p-3.5 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm hover:border-red-400 hover:shadow-md transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="p-1.5 rounded-xl bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400">
                <ShieldAlert className="w-4 h-4" />
              </span>
              <span className="text-xs font-bold text-red-600 group-hover:translate-x-0.5 transition-transform">→</span>
            </div>
            <div className="mt-2.5 text-2xl font-black text-slate-900 dark:text-white tabular-nums">
              {actionCenter?.codDiscrepancies ?? 0}
            </div>
            <div className="mt-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">
              COD Discrepancies
            </div>
            <div className="mt-1 text-[10px] text-slate-400">Disputed settlements</div>
          </Link>
        </div>
      </section>

      {/* Row 1: 5 Real KPI Cards with responsive columns & spacing */}
      <section id="dashboard-overview" className="dashboard-kpi grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Business overview">
        {[
          { label: 'Total Orders', value: totalOrdersCount.toLocaleString(), detail: `${Number(data?.todayOrdersCount || 0).toLocaleString()} created today` },
          { label: 'Revenue', value: money(totalSalesSum), detail: `${Number(totalUnitsSold).toLocaleString()} units sold` },
          { label: canViewCosts ? 'Estimated Profit' : 'Average Order Value', value: canViewCosts ? money(netProfit) : money(avgOrderValue), detail: canViewCosts ? `${data?.profitMarginPercent ?? 0}% profit margin` : 'Average per order' },
          { label: 'Pending Web Orders', value: Number(pendingOrders).toLocaleString(), detail: 'Awaiting call verification' },
        ].map(card => <article key={card.label} className="dashboard-metric-card"><span>{card.label}</span><strong>{card.value}</strong><small>{card.detail}</small></article>)}
      </section>

      {/* Row 2: Sales & Returns Area Chart (60%) + Sales Conversion Funnel (40%) */}
      <div className="dashboard-reports grid grid-cols-1 gap-4 lg:grid-cols-12 sm:gap-6">
        <div className="lg:col-span-7 xl:col-span-8">
          <SalesReturnsChart
            data={trendData}
            totalSales={money(totalSalesSum)}
            salesGrowth={totalOrdersCount > 0 ? `${totalOrdersCount} orders` : '0 orders'}
            totalReturns={money(totalReturnsSum)}
            returnsChange={`${status.RETURNED || 0} returned`}
          />
        </div>
        <div className="lg:col-span-5 xl:col-span-4">
          <ConversionFunnelCard
            conversionRate={conversionRate}
            rateChange={`${status.DELIVERED || 0} delivered`}
            steps={conversionSteps}
          />
        </div>
      </div>

      {/* Row 3: Sessions Gauge (1/3) + Traffic Sources (1/3) + Sales by Region (1/3) */}
      <div id="dashboard-marketing" className="grid grid-cols-1 gap-4 lg:grid-cols-12 sm:gap-6">
        <div className="lg:col-span-6 xl:col-span-4">
          <RadialGaugeCard
            title="Fulfillment Health"
            value={status.DELIVERED || 0}
            valueLabel="Delivered Orders"
            totalValue={totalOrdersCount}
            totalLabel="Total Orders Placed"
            percentage={conversionRate}
          />
        </div>
        {canViewCosts && <div className="lg:col-span-6 xl:col-span-4">
          <TrafficSourcesCard
            marketingSpend={money(traffic.marketingSpend)}
            cpa={money(traffic.cpa)}
            impressions={Number(traffic.impressions || 0).toLocaleString()}
            clicks={Number(traffic.clicks || 0).toLocaleString()}
            channels={traffic.channels || []}
          />
        </div>}
        <div className="lg:col-span-12 xl:col-span-4">
          <RegionSalesCard
            title="Sales by Region"
            regions={regions}
            currencySymbol="৳"
          />
        </div>
      </div>

      {/* Operational Fast Pipeline: Call Center Quick Actions */}
      <div id="dashboard-operations" className="rounded-2xl border border-slate-100/90 bg-white p-4 shadow-[0_2px_10px_rgba(0,0,0,0.02)] sm:p-5 lg:p-6 dark:border-slate-800 dark:bg-slate-900/90">
        <div className="flex flex-col gap-2 border-b border-slate-100 pb-3 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 sm:text-base dark:text-white">
              Order Fulfillment Pipeline
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-400 sm:text-xs dark:text-slate-500">
              Immediate order queues ready for call center and warehouse dispatch
            </p>
          </div>
          <Link
            to="/orders"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 transition hover:text-emerald-700 dark:text-emerald-400"
          >
            <span>Open All Orders</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {pipeline.map((item) => (
            <Link
              key={item.label}
              to={item.href}
              className="group rounded-xl border border-slate-100 bg-slate-50/50 p-3 sm:p-4 transition-all hover:border-emerald-200 hover:bg-emerald-50/30 dark:border-slate-800 dark:bg-slate-800/40 dark:hover:border-emerald-800/50 dark:hover:bg-emerald-950/20"
            >
              <p className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">
                {item.label}
              </p>
              <p className="mt-1.5 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl dark:text-white">
                {item.value}
              </p>
              <span className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 sm:text-[11px] group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
                Process queue <ArrowRight className="h-3 w-3" />
              </span>
            </Link>
          ))}
        </div>
      </div>

      {/* Recent Orders Streamlined Table */}
      <div id="dashboard-activity" className="rounded-2xl border border-slate-100/90 bg-white p-4 shadow-[0_2px_10px_rgba(0,0,0,0.02)] sm:p-5 lg:p-6 dark:border-slate-800 dark:bg-slate-900/90">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 sm:text-base dark:text-white">
              Recent Orders
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-400 sm:text-xs dark:text-slate-500">
              Live customer orders across all active sales channels
            </p>
          </div>
          <Link
            to="/orders"
            className="text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          >
            View all ({totalOrdersCount})
          </Link>
        </div>

        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] font-medium text-slate-400 dark:border-slate-800">
                <th className="py-2.5 font-normal">Order</th>
                <th className="py-2.5 font-normal">Customer</th>
                <th className="py-2.5 font-normal">Status</th>
                <th className="py-2.5 font-normal">Courier</th>
                <th className="py-2.5 text-right font-normal">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800/60">
              {(data?.recentOrders || []).map((order: any) => (
                <tr
                  key={order.id}
                  className="transition hover:bg-slate-50/60 dark:hover:bg-slate-800/30"
                >
                  <td className="py-3 font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                    <Link
                      to={`/orders/${order.id}`}
                      className="hover:text-emerald-600 dark:hover:text-emerald-400"
                    >
                      {order.orderNumber}
                    </Link>
                  </td>
                  <td className="py-3">
                    <p className="font-medium text-slate-800 dark:text-slate-200 truncate max-w-[140px] sm:max-w-none">
                      {order.customerName}
                    </p>
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      {order.customerPhone}
                    </p>
                  </td>
                  <td className="py-3 whitespace-nowrap">
                    <StatusBadge tone={statusTone(order.status) as any}>
                      {order.status.replace('_', ' ')}
                    </StatusBadge>
                  </td>
                  <td className="py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {order.courierName || 'Pending assign'}
                  </td>
                  <td className="py-3 text-right font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                    {money(order.grandTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
};
