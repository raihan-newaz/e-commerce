import { AdminSelect } from '../components/admin/AdminSelect';
import React, { useState, useEffect, useRef } from 'react';
import { Order, User } from '../types';
import api from '../lib/api';
import { io } from 'socket.io-client';
import {
  Search,
  Truck,
  MessageSquare,
  Phone,
  PhoneForwarded,
  Printer,
  Plus,
  Clock,
  AlertTriangle,
  RotateCcw,
  CheckSquare,
  ExternalLink,
  Loader2,
  RefreshCw,
  Pencil,
  Archive,
  Trash2,
  UserRound,
  ShieldAlert,
  MoreVertical,
  Download,
  SlidersHorizontal,
  ChevronDown,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { OrderActionsPopover } from '../components/orders/OrderActionsPopover';
import { downloadOrdersCsv } from '../components/orders/orderCsv';
import './orders.css';
import { CourierDispatchModal } from '../components/orders/CourierDispatchModal';
import { InvoiceModal } from '../components/orders/InvoiceModal';
import { WhatsAppModal } from '../components/orders/WhatsAppModal';
import { CreateOrderModal } from '../components/orders/CreateOrderModal';
import { useWebPhone } from '../context/WebPhoneContext';
import { OrderEditModal } from '../components/orders/OrderEditModal';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

export const OrdersPage: React.FC = () => {
  const navigate = useNavigate();
  const [urlParams, setUrlParams] = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [staffList, setStaffList] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingWoo, setSyncingWoo] = useState(false);

  // Filters initialized from URL search params for direct bookmarking/sharing
  const [activeTab, setActiveTab] = useState(urlParams.get('status') || (urlParams.get('trash') === 'true' ? 'TRASH' : (urlParams.get('isFraudSuspect') === 'true' ? 'FRAUD_SUSPECT' : 'ALL')));
  const [searchQuery, setSearchQuery] = useState(urlParams.get('search') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(urlParams.get('search') || '');
  const [selectedCourier, setSelectedCourier] = useState(urlParams.get('courier') || 'ALL');
  const [selectedAssignee, setSelectedAssignee] = useState(urlParams.get('assignee') || urlParams.get('assignedToId') || 'ALL');
  const [selectedPriority, setSelectedPriority] = useState(urlParams.get('priority') || 'ALL');
  const [selectedOrderAge, setSelectedOrderAge] = useState(urlParams.get('orderAge') || 'ALL');
  const [selectedSettlement, setSelectedSettlement] = useState(urlParams.get('settlement') || 'ALL');
  const [page, setPage] = useState(Number(urlParams.get('page')) || 1);
  const [totalPages, setTotalPages] = useState(1);
  const [sortBy, setSortBy] = useState(() => ['createdAt', 'orderNumber', 'grandTotal', 'status'].includes(urlParams.get('sortBy') || '') ? urlParams.get('sortBy')! : 'createdAt');
  const [sortOrder, setSortOrder] = useState(urlParams.get('sortOrder') === 'asc' ? 'asc' : 'desc');
  const [filtersOpen, setFiltersOpen] = useState(() => ['courier', 'assignee', 'assignedToId', 'priority', 'orderAge', 'settlement'].some(key => urlParams.has(key)));
  const [exporting, setExporting] = useState(false);
  const moreActionsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (moreActionsRef.current && !moreActionsRef.current.contains(event.target as Node)) moreActionsRef.current.open = false;
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);
  const activeFilters = [
    { key: 'assignee', value: selectedAssignee, label: `Assignee: ${selectedAssignee === 'UNASSIGNED' ? 'Unassigned' : staffList.find(staff => staff.id === selectedAssignee)?.name || selectedAssignee}`, clear: () => setSelectedAssignee('ALL') },
    { key: 'priority', value: selectedPriority, label: `Priority: ${selectedPriority.toLowerCase()}`, clear: () => setSelectedPriority('ALL') },
    { key: 'courier', value: selectedCourier, label: `Courier: ${selectedCourier}`, clear: () => setSelectedCourier('ALL') },
    { key: 'age', value: selectedOrderAge, label: `Age: ${({ today: 'Today', under24h: '< 24 hours', '24h': '> 24 hours', '48h': '> 48 hours', '7d': '> 7 days' } as Record<string, string>)[selectedOrderAge] || selectedOrderAge}`, clear: () => setSelectedOrderAge('ALL') },
    { key: 'settlement', value: selectedSettlement, label: `Settlement: ${selectedSettlement.toLowerCase()}`, clear: () => setSelectedSettlement('ALL') },
  ].filter(filter => filter.value !== 'ALL');

  // Modals state
  const [selectedOrderForCourier, setSelectedOrderForCourier] = useState<Order | null>(null);
  const [selectedOrderForInvoice, setSelectedOrderForInvoice] = useState<Order | null>(null);
  const [bulkOrdersForInvoice, setBulkOrdersForInvoice] = useState<Order[] | null>(null);
  const [selectedOrderForWhatsApp, setSelectedOrderForWhatsApp] = useState<Order | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedOrderForEdit, setSelectedOrderForEdit] = useState<Order | null>(null);

  // Bulk selections
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);

  // IVR manual call support
  const [ivrManualEnabled, setIvrManualEnabled] = useState(false);
  const [dialingIvrOrderId, setDialingIvrOrderId] = useState<string | null>(null);
  const { startCall } = useWebPhone();

  useEffect(() => {
    api.get('/ivr/config').then((res) => {
      if (res.data?.success && res.data.config?.allowManualCall) {
        setIvrManualEnabled(true);
      }
    }).catch(() => {});
  }, []);

  const handleTriggerIvrCall = async (orderId: string, orderNumber: string) => {
    setDialingIvrOrderId(orderId);
    try {
      const res = await api.post('/ivr/manual-dial', { orderId });
      if (res.data?.success) {
        toast.success(res.data.message || `IVR confirmation call queued for Order #${orderNumber}`);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to trigger IVR call');
    } finally {
      setDialingIvrOrderId(null);
    }
  };

  // Close 3-dot action menu when clicking outside or pressing Escape
  useEffect(() => {
    if (!openActionMenuId) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.order-action-menu-container')) {
        setOpenActionMenuId(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenActionMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openActionMenuId]);

  useEffect(() => {
    setOpenActionMenuId(null);
  }, [activeTab, page]);

  // Load staff list for assignment
  useEffect(() => {
    let cancelled = false;
    api.get('/auth/users')
      .then((res) => {
        if (!cancelled && res.data?.users) {
          setStaffList(res.data.users.filter((u: User) => u.status === 'ACTIVE'));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Sync state to URL search parameters so views can be shared or bookmarked
  useEffect(() => {
    const nextParams: Record<string, string> = {};
    if (activeTab === 'TRASH') {
      nextParams.trash = 'true';
    } else if (activeTab === 'FRAUD_SUSPECT') {
      nextParams.isFraudSuspect = 'true';
    } else if (activeTab !== 'ALL') {
      nextParams.status = activeTab;
    }
    if (debouncedSearch) nextParams.search = debouncedSearch;
    if (selectedCourier !== 'ALL') nextParams.courier = selectedCourier;
    if (selectedAssignee !== 'ALL') nextParams.assignee = selectedAssignee;
    if (selectedPriority !== 'ALL') nextParams.priority = selectedPriority;
    if (selectedOrderAge !== 'ALL') nextParams.orderAge = selectedOrderAge;
    if (selectedSettlement !== 'ALL') nextParams.settlement = selectedSettlement;
    if (page > 1) nextParams.page = String(page);
    if (sortBy !== 'createdAt') nextParams.sortBy = sortBy;
    if (sortOrder !== 'desc') nextParams.sortOrder = sortOrder;

    setUrlParams(nextParams, { replace: true });
  }, [
    activeTab,
    debouncedSearch,
    sortBy,
    sortOrder,
    selectedCourier,
    selectedAssignee,
    selectedPriority,
    selectedOrderAge,
    selectedSettlement,
    page,
  ]);

  const handleBulkPrint = () => {
    if (selectedOrderIds.length === 0) return;
    const selectedOrders = orders.filter((o) => selectedOrderIds.includes(o.id));
    if (selectedOrders.length > 0) {
      setBulkOrdersForInvoice(selectedOrders);
    }
  };

  const formatOrderDate = (dateString: string | Date) => {
    const d = new Date(dateString);
    const day = d.getDate().toString().padStart(2, '0');
    const month = d.toLocaleString('en-US', { month: 'short' });
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
  };

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 20, sortBy, sortOrder };
      if (activeTab === 'TRASH') {
        params.trash = 'true';
      } else if (activeTab !== 'ALL') {
        if (activeTab === 'FRAUD_SUSPECT') {
          params.isFraudSuspect = 'true';
        } else {
          params.status = activeTab;
        }
      }
      if (debouncedSearch) params.search = debouncedSearch;
      if (selectedCourier !== 'ALL') params.courier = selectedCourier;
      if (selectedAssignee !== 'ALL') params.assignee = selectedAssignee;
      if (selectedPriority !== 'ALL') params.priority = selectedPriority;
      if (selectedOrderAge !== 'ALL') params.orderAge = selectedOrderAge;
      if (selectedSettlement !== 'ALL') params.settlement = selectedSettlement;

      const res = await api.get('/orders', { params });
      if (res.data?.success) {
        setOrders(res.data.data);
        setTotalPages(res.data.pagination?.totalPages || 1);
        if (res.data.statusCounts) {
          setStatusCounts(res.data.statusCounts);
        }
      }
    } catch (err: any) {
      toast.error('Failed to load orders');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();

    const socket = io();
    socket.on('order:new', (newOrder: Order) => {
      toast.success(`🔔 New Order #${newOrder.orderNumber} received!`, {
        icon: '🛒',
        duration: 5000,
      });
      fetchOrders();
    });

    return () => {
      socket.disconnect();
    };
  }, [
    activeTab,
    selectedCourier,
    selectedAssignee,
    selectedPriority,
    selectedOrderAge,
    selectedSettlement,
    page,
    debouncedSearch,
    sortBy,
    sortOrder,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
      if (searchQuery.trim() !== debouncedSearch) setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const handleSyncWooCommerce = async () => {
    setSyncingWoo(true);
    try {
      const res = await api.post('/woocommerce/sync-orders', { perPage: 50, page: 1 });
      if (res.data?.success) {
        toast.success(res.data.message || 'WooCommerce orders synced!');
        fetchOrders();
      } else {
        toast.error(res.data?.message || 'Sync failed');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to sync with WooCommerce');
    } finally {
      setSyncingWoo(false);
    }
  };

  const handleSingleAssign = async (orderId: string, assignedToId: string | null) => {
    try {
      const res = await api.patch(`/orders/${orderId}/assignment`, { assignedToId });
      if (res.data?.success) {
        toast.success(assignedToId ? 'Order assigned' : 'Order unassigned');
        setOrders((prev) =>
          prev.map((o) =>
            o.id === orderId
              ? {
                  ...o,
                  assignedTo: assignedToId
                    ? staffList.find((s) => s.id === assignedToId) || { id: assignedToId, name: 'Staff' }
                    : undefined,
                }
              : o
          )
        );
      }
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to update assignment');
    }
  };

  const handleSinglePriority = async (orderId: string, priority: 'NORMAL' | 'URGENT') => {
    try {
      const res = await api.patch(`/orders/${orderId}/priority`, { priority });
      if (res.data?.success) {
        toast.success(`Priority set to ${priority}`);
        setOrders((prev) =>
          prev.map((o) => (o.id === orderId ? { ...o, priority } : o))
        );
      }
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to update priority');
    }
  };

  const handleBulkAssign = async (assignedToId: string | null) => {
    if (selectedOrderIds.length === 0) return;
    try {
      const res = await api.post('/orders/bulk-assign', {
        orderIds: selectedOrderIds,
        assignedToId,
      });
      if (res.data?.success) {
        toast.success(`Assigned ${selectedOrderIds.length} orders`);
        fetchOrders();
      }
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Bulk assignment failed');
    }
  };

  const handleBulkPriority = async (priority: 'NORMAL' | 'URGENT') => {
    if (selectedOrderIds.length === 0) return;
    try {
      const res = await api.post('/orders/bulk-priority', {
        orderIds: selectedOrderIds,
        priority,
      });
      if (res.data?.success) {
        toast.success(`Set priority to ${priority} for ${selectedOrderIds.length} orders`);
        fetchOrders();
      }
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Bulk priority update failed');
    }
  };


  const handleStatusChange = async (orderId: string, newStatus: string) => {
    const currentOrder = orders.find((o) => o.id === orderId);
    const oldStatus = currentOrder?.status;
    if (!currentOrder || oldStatus === newStatus) return;

    // Real-time optimistic in-place update: update state immediately
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: newStatus as any } : o))
    );
    if (oldStatus) {
      setStatusCounts((prev) => ({
        ...prev,
        [oldStatus]: Math.max(0, (prev[oldStatus] || 0) - 1),
        [newStatus]: (prev[newStatus] || 0) + 1,
      }));
    }

    try {
      const res = await api.patch(`/orders/${orderId}/status`, { status: newStatus });
      if (res.data?.success) {
        toast.success(`Order #${res.data?.order?.orderNumber || currentOrder.orderNumber} updated to ${newStatus}`);
      } else {
        throw new Error(res.data?.message || 'Failed to update status');
      }
    } catch (e: any) {
      // Rollback on failure
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: oldStatus as any } : o))
      );
      if (oldStatus) {
        setStatusCounts((prev) => ({
          ...prev,
          [oldStatus]: (prev[oldStatus] || 0) + 1,
          [newStatus]: Math.max(0, (prev[newStatus] || 0) - 1),
        }));
      }
      toast.error('Failed to update status');
    }
  };

  const handleBulkStatusChange = async (newStatus: string) => {
    if (selectedOrderIds.length === 0) return;
    try {
      const res = await api.post('/orders/bulk-status', {
        orderIds: selectedOrderIds,
        status: newStatus,
      });
      if (res.data?.success) {
        toast.success(`Updated ${selectedOrderIds.length} orders to ${newStatus}`);
        setSelectedOrderIds([]);
        fetchOrders();
      }
    } catch (e: any) {
      toast.error('Bulk update failed');
    }
  };

  const handleBulkCourier = async (courierName: 'STEADFAST' | 'PATHAO' | 'REDX') => {
    if (selectedOrderIds.length === 0) return;
    try {
      const res = await api.post('/couriers/dispatch-bulk', {
        orderIds: selectedOrderIds,
        courierName,
      });
      if (res.data?.success) {
        if (res.data.failed) toast.error(`${res.data.failed} dispatch failed: ${res.data.errors?.[0]?.error || 'Check courier settings'}`);
        if (res.data.accepted) toast.success(`${res.data.accepted} Pathao request${res.data.accepted === 1 ? '' : 's'} accepted; waiting for consignment webhooks`);
        else if (res.data.dispatched) toast.success(`${res.data.dispatched} order${res.data.dispatched === 1 ? '' : 's'} booked with ${courierName}`);
        setSelectedOrderIds(res.data.errors?.map((entry: { orderId: string }) => entry.orderId) || []);
        fetchOrders();
      }
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Bulk courier dispatch failed');
    }
  };

  const handleTrashOrders = async (ids = selectedOrderIds) => {
    if (!ids.length || !window.confirm(`Move ${ids.length} selected order(s) to Trash? They can be restored later.`)) return;
    try {
      const res = await api.post('/orders/trash', { orderIds: ids });
      toast.success(res.data.message || 'Orders moved to Trash');
      setSelectedOrderIds([]);
      fetchOrders();
    } catch (err: any) { toast.error(err.response?.data?.message || 'Could not move orders to Trash'); }
  };

  const handleRestoreOrders = async (ids = selectedOrderIds) => {
    if (!ids.length) return;
    try {
      const res = await api.post('/orders/restore', { orderIds: ids });
      toast.success(res.data.message || 'Orders restored');
      setSelectedOrderIds([]);
      fetchOrders();
    } catch (err: any) { toast.error(err.response?.data?.message || 'Could not restore orders'); }
  };

  const handlePermanentDeleteOrders = async (ids = selectedOrderIds) => {
    if (!ids.length || !window.confirm(`Permanently delete ${ids.length} selected order(s)? This cannot be undone. Finance entries, message logs, and audit records will be retained.`)) return;
    try {
      const res = await api.post('/orders/permanently-delete', { orderIds: ids });
      toast.success(res.data.message || 'Orders permanently deleted');
      setSelectedOrderIds([]);
      fetchOrders();
    } catch (err: any) { toast.error(err.response?.data?.message || 'Could not permanently delete orders'); }
  };

  const toggleSelectAll = () => {
    if (orders.every(order => selectedOrderIds.includes(order.id))) {
      setSelectedOrderIds(current => current.filter(id => !orders.some(order => order.id === id)));
    } else {
      setSelectedOrderIds(current => [...new Set([...current, ...orders.map(order => order.id)])]);
    }
  };

  const toggleSelectOrder = (id: string) => {
    setSelectedOrderIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const updateFilter = (update: () => void) => {
    update();
    setPage(1);
    setSelectedOrderIds([]);
  };
  const handleExport = async () => {
    setExporting(true);
    try {
      let rows = orders;
      if (selectedOrderIds.length) {
        rows = [];
        for (let i = 0; i < selectedOrderIds.length; i += 4) {
          const batch = await Promise.all(selectedOrderIds.slice(i, i + 4).map(async id => {
            const loaded = orders.find(order => order.id === id);
            if (loaded) return loaded;
            const response = await api.get(`/orders/${id}`);
            if (!response.data?.success || !response.data.order) throw new Error('Could not load selected order');
            return response.data.order as Order;
          }));
          rows.push(...batch);
        }
      }
      downloadOrdersCsv(rows, selectedOrderIds.length ? 'selected' : `page-${page}`);
      toast.success(`${rows.length} orders exported`);
    } catch { toast.error('Export failed. No partial file was downloaded. Please try again.'); }
    finally { setExporting(false); }
  };

  const tabs = [
    { id: 'ALL', label: 'All', count: statusCounts.ALL || 0 },
    { id: 'PENDING', label: 'Pending', count: statusCounts.PENDING || 0, color: 'text-amber-500' },
    { id: 'CONFIRMED', label: 'Confirmed', count: statusCounts.CONFIRMED || 0, color: 'text-blue-500' },
    { id: 'PACKAGING', label: 'Packaging', count: statusCounts.PACKAGING || 0, color: 'text-sky-500' },
    { id: 'IN_TRANSIT', label: 'In Courier', count: statusCounts.IN_TRANSIT || 0, color: 'text-purple-500' },
    { id: 'DELIVERED', label: 'Delivered', count: statusCounts.DELIVERED || 0, color: 'text-emerald-500' },
    { id: 'RETURNED', label: 'Returned', count: statusCounts.RETURNED || 0, color: 'text-rose-500' },
    { id: 'CANCELLED', label: 'Cancelled', count: statusCounts.CANCELLED || 0, color: 'text-slate-400' },
    { id: 'FRAUD_SUSPECT', label: 'Suspects', count: undefined, color: 'text-red-500' },
    { id: 'TRASH', label: 'Trash', count: statusCounts.TRASH || 0, color: 'text-rose-500' },
  ];

  return (
      <div className="orders-page space-y-5">
      <section className="orders-panel" aria-label="Orders list">
      {/* Tabs */}
      <div className="orders-tabs flex flex-wrap items-center gap-1.5 pb-2 border-b border-slate-100 dark:border-slate-800">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            aria-pressed={activeTab === tab.id}
            onClick={() => {
              updateFilter(() => setActiveTab(tab.id));
            }}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
              activeTab === tab.id
                ? 'bg-slate-900 text-white shadow-sm dark:bg-white dark:text-slate-900'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-900'
            }`}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined && <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                activeTab === tab.id
                  ? 'bg-white/20 text-white dark:bg-slate-900/20 dark:text-slate-900'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              {tab.count}
            </span>}
          </button>
        ))}
      </div>

      {/* Search & Operations Filter Toolbar */}
      <div className="orders-toolbar bg-white dark:bg-slate-900 border border-slate-100/90 dark:border-slate-800 p-3.5 rounded-2xl flex flex-col lg:flex-row items-center justify-between gap-3 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
        <div className="flex items-center gap-2 w-full lg:max-w-sm">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              aria-label="Search orders"
              placeholder="Search by order #, phone, customer, tracking..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 w-full bg-slate-50/70 dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 pl-9 pr-3 rounded-xl focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="orders-toolbar-actions">
          <button type="button" className="orders-button orders-primary" onClick={() => setIsCreateModalOpen(true)}><Plus size={15} /> New</button>
          <button type="button" className="orders-button" onClick={handleExport} disabled={exporting || loading || (!selectedOrderIds.length && !orders.length)}>{exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}{exporting ? 'Exporting…' : 'Export'}</button>
          <details ref={moreActionsRef} className="orders-more-actions" onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) event.currentTarget.open = false; }} onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}><summary className="orders-button">More <ChevronDown size={14} /></summary><div className="orders-more-content"><button type="button" onClick={handleSyncWooCommerce} disabled={syncingWoo}>{syncingWoo ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}{syncingWoo ? 'Syncing…' : 'Sync WooCommerce'}</button></div></details>
          <button type="button" className={`orders-button ${filtersOpen ? 'is-active' : ''}`} aria-expanded={filtersOpen} aria-controls="orders-filters" onClick={() => setFiltersOpen(open => !open)}><SlidersHorizontal size={15} /> Filters {activeFilters.length > 0 && <span className="orders-count">{activeFilters.length}</span>}</button>
          <label><span className="sr-only">Sort orders</span><AdminSelect dropdownKey="pages.OrdersPage.tsx.1" aria-label="Sort orders" value={`${sortBy}:${sortOrder}`} onChange={event => { const [field, direction] = event.target.value.split(':'); updateFilter(() => { setSortBy(field); setSortOrder(direction); }); }}>
            <option value="createdAt:desc">Date: newest first</option><option value="createdAt:asc">Date: oldest first</option><option value="orderNumber:asc">Order number: ascending</option><option value="orderNumber:desc">Order number: descending</option><option value="grandTotal:desc">Total: high to low</option><option value="grandTotal:asc">Total: low to high</option><option value="status:asc">Status: A–Z</option><option value="status:desc">Status: Z–A</option>
          </AdminSelect></label>
          <button type="button" className="orders-button orders-icon-button" onClick={fetchOrders} aria-label="Refresh orders"><RotateCcw size={15} /></button>
        </div>
      </div>
      {activeFilters.length > 0 && <div className="orders-filter-chips" aria-label="Active filters">{activeFilters.map(filter => <button type="button" key={filter.key} onClick={() => updateFilter(filter.clear)} aria-label={`Remove ${filter.label}`}>{filter.label}<X size={12} /></button>)}</div>}
      <div id="orders-filters" hidden={!filtersOpen} className="orders-filter-panel">
        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto justify-end">
          {/* Assignee Filter */}
          <AdminSelect dropdownKey="pages.OrdersPage.tsx.2"
            aria-label="Assignee"
            value={selectedAssignee}
            onChange={(e) => updateFilter(() => setSelectedAssignee(e.target.value))}
            className="h-9 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 rounded-xl px-2.5 focus:border-emerald-500 focus:outline-none cursor-pointer"
          >
            <option value="ALL">All Assignees</option>
            <option value="UNASSIGNED">Unassigned</option>
            {staffList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.role.replace(/_/g, ' ')})
              </option>
            ))}
          </AdminSelect>

          {/* Priority Filter */}
          <AdminSelect dropdownKey="pages.OrdersPage.tsx.3"
            aria-label="Priority"
            value={selectedPriority}
            onChange={(e) => updateFilter(() => setSelectedPriority(e.target.value))}
            className="h-9 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 rounded-xl px-2.5 focus:border-emerald-500 focus:outline-none cursor-pointer"
          >
            <option value="ALL">All Priority</option>
            <option value="NORMAL">Normal</option>
            <option value="URGENT">⚡ Urgent</option>
          </AdminSelect>

          {/* Courier Filter */}
          <AdminSelect dropdownKey="pages.OrdersPage.tsx.4"
            aria-label="Courier"
            value={selectedCourier}
            onChange={(e) => updateFilter(() => setSelectedCourier(e.target.value))}
            className="h-9 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 rounded-xl px-2.5 focus:border-emerald-500 focus:outline-none cursor-pointer"
          >
            <option value="ALL">All Couriers</option>
            <option value="STEADFAST">Steadfast</option>
            <option value="PATHAO">Pathao</option>
            <option value="REDX">RedX</option>
          </AdminSelect>

          {/* Order Age Filter */}
          <AdminSelect dropdownKey="pages.OrdersPage.tsx.5"
            aria-label="Order age"
            value={selectedOrderAge}
            onChange={(e) => updateFilter(() => setSelectedOrderAge(e.target.value))}
            className="h-9 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 rounded-xl px-2.5 focus:border-emerald-500 focus:outline-none cursor-pointer"
          >
            <option value="ALL">Any Age</option>
            <option value="today">Today</option>
            <option value="under24h">&lt; 24 Hours</option>
            <option value="24h">&gt; 24 Hours</option>
            <option value="48h">&gt; 48 Hours</option>
            <option value="7d">&gt; 7 Days</option>
          </AdminSelect>

          {/* Settlement Filter */}
          <AdminSelect dropdownKey="pages.OrdersPage.tsx.6"
            aria-label="Settlement"
            value={selectedSettlement}
            onChange={(e) => updateFilter(() => setSelectedSettlement(e.target.value))}
            className="h-9 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 rounded-xl px-2.5 focus:border-emerald-500 focus:outline-none cursor-pointer"
          >
            <option value="ALL">All Settlements</option>
            <option value="PENDING">Settlement Pending</option>
            <option value="RECONCILED">Reconciled</option>
            <option value="DISCREPANCY">Discrepancy</option>
          </AdminSelect>

        </div>
      </div>

      {/* Bulk Action Banner */}
      {selectedOrderIds.length > 0 && (
        <div className="orders-bulk bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-500/30 p-3 rounded-2xl flex flex-wrap items-center justify-between gap-2.5 shadow-sm">
          <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300 font-bold">
            <CheckSquare className="w-4 h-4" />
            <span className="font-medium">{selectedOrderIds.length} orders selected</span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {activeTab === 'TRASH' ? <>
              <button onClick={() => handleRestoreOrders()} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl">Restore</button>
              <button onClick={() => handlePermanentDeleteOrders()} className="inline-flex items-center gap-1 px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-xl"><Trash2 className="h-3.5 w-3.5"/> Delete permanently</button>
            </> : <>
            {/* Bulk Assign Dropdown */}
            <AdminSelect dropdownKey="pages.OrdersPage.tsx.7"
              onChange={(e) => {
                if (e.target.value !== '') {
                  handleBulkAssign(e.target.value === 'UNASSIGN' ? null : e.target.value);
                  e.target.value = '';
                }
              }}
              defaultValue=""
              className="h-9 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 rounded-xl px-2.5 focus:outline-none cursor-pointer"
            >
              <option value="" disabled>Assign to Staff...</option>
              <option value="UNASSIGN">Unassign</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </AdminSelect>

            {/* Bulk Priority Toggle */}
            <button
              onClick={() => handleBulkPriority('URGENT')}
              className="h-9 px-3 inline-flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-xl shadow-sm"
            >
              ⚡ Mark Urgent
            </button>
            <button
              onClick={() => handleBulkPriority('NORMAL')}
              className="h-9 px-3 inline-flex items-center bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-semibold rounded-xl hover:bg-slate-300"
            >
              Normal
            </button>

            <button
              onClick={handleBulkPrint}
              className="h-9 inline-flex items-center gap-1.5 px-3.5 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 text-white text-xs font-semibold rounded-xl shadow-sm transition-all"
            >
              <Printer className="w-3.5 h-3.5" />
              Print ({selectedOrderIds.length})
            </button>
            <button
              onClick={() => handleBulkStatusChange('CONFIRMED')}
              className="h-9 px-3.5 inline-flex items-center bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl shadow-sm"
            >
              Confirm
            </button>
            <button
              onClick={() => handleBulkStatusChange('PACKAGING')}
              className="h-9 px-3.5 inline-flex items-center bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-xl shadow-sm"
            >
              Packaging
            </button>
            <button
              onClick={() => handleBulkCourier('STEADFAST')}
              className="h-9 px-3.5 inline-flex items-center bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl shadow-sm"
            >
              Steadfast ({selectedOrderIds.length})
            </button>
            <button
              onClick={() => handleBulkCourier('PATHAO')}
              className="h-9 px-3.5 inline-flex items-center bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-xl shadow-sm"
            >
              Pathao ({selectedOrderIds.length})
            </button>
            <button
              onClick={() => handleBulkStatusChange('CANCELLED')}
              className="h-9 px-3.5 inline-flex items-center bg-slate-200 dark:bg-slate-800 text-rose-600 dark:text-rose-400 text-xs font-semibold rounded-xl"
            >
              Cancel
            </button>
            <button onClick={() => handleTrashOrders()} className="h-9 px-3.5 inline-flex items-center gap-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-xl"><Trash2 className="h-3.5 w-3.5"/> Move to Trash</button>
            </>}
          </div>
        </div>
      )}

      {/* Orders Table */}
      <div className="orders-table-card bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-card">
        {loading ? (
          <div className="h-64 flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
          </div>
        ) : orders.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-slate-400 text-xs">
            <AlertTriangle className="w-8 h-8 mb-2 text-slate-400" />
            <p>{activeTab === 'TRASH' ? 'Trash is empty.' : 'No orders found matching the filter.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto min-h-[340px]" role="region" aria-label="Orders table" tabIndex={0}>
            <table className="w-full text-left text-xs min-w-[920px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-slate-500 dark:text-slate-400 font-semibold uppercase">
                  <th className="p-3.5 w-10 text-center">
                    <input
                      type="checkbox"
                      ref={input => { if (input) input.indeterminate = orders.some(order => selectedOrderIds.includes(order.id)) && !orders.every(order => selectedOrderIds.includes(order.id)); }}
                      aria-label="Select all orders on this page"
                      checked={orders.length > 0 && orders.every(order => selectedOrderIds.includes(order.id))}
                      onChange={toggleSelectAll}
                      className="rounded border-slate-300 dark:border-slate-700 text-emerald-600 focus:ring-emerald-500"
                    />
                  </th>
                  <th className="py-3.5 px-3 min-w-[125px]">Created At</th>
                  <th className="py-3.5 px-3 min-w-[80px]">Auto Call</th>
                  <th className="py-3.5 px-3 min-w-[170px]">Customer</th>
                  <th className="py-3.5 px-3 min-w-[150px]">Note</th>
                  <th className="py-3.5 px-3 min-w-[180px]">Order Items</th>
                  <th className="py-3.5 px-3 min-w-[90px] text-center">Success Rate</th>
                  <th className="py-3.5 px-3 min-w-[90px]">Tags</th>
                  <th className="py-3.5 px-3 min-w-[85px]">Site</th>
                  <th className="py-3.5 px-3 text-center min-w-[70px] w-16">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {orders.map((o) => (
                  <tr
                    key={o.id}
                    onClick={() => navigate(`/orders/${o.id}`)}
                    className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors ${
                      o.isFraudSuspect ? 'bg-rose-50/50 dark:bg-rose-950/20' : ''
                    }`}
                  >
                    {/* Checkbox */}
                    <td className="p-3.5 text-center" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select order ${o.orderNumber}`}
                        checked={selectedOrderIds.includes(o.id)}
                        onChange={() => toggleSelectOrder(o.id)}
                        className="rounded border-slate-300 dark:border-slate-700 text-emerald-600 focus:ring-emerald-500"
                      />
                    </td>

                    <td className="py-3.5 px-3 min-w-[125px] whitespace-nowrap">
                      <div className="font-medium text-slate-800 dark:text-slate-200">{new Date(o.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}, {new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                      <div className="mt-1 text-[10px] text-slate-400">ID: {o.orderNumber}</div>
                    </td>

                    <td className="py-3.5 px-3" onClick={(event) => event.stopPropagation()}>
                      <button type="button" title={`Call ${o.customerName}`} aria-label={`Call ${o.customerName}`} onClick={() => startCall({ orderId: o.id, orderNumber: o.orderNumber || o.id.slice(0, 8), customerName: o.customerName, phone: o.customerPhone })} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-purple-50 hover:text-[#40134c] dark:hover:bg-purple-950/30"><Phone className="h-4 w-4" /></button>
                    </td>

                    <td className="py-3.5 px-3 min-w-[170px]">
                      <div className="flex items-center gap-1.5 font-medium text-slate-900 dark:text-slate-100"><span>{o.customerName}</span>{o.isFraudSuspect && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-semibold text-rose-700">RISK</span>}</div>
                      <div className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-300">{o.customerPhone}</div>
                      <div className="mt-0.5 max-w-[190px] truncate text-[10px] text-slate-400">{o.customerAddress}</div>
                    </td>

                    <td className="py-3.5 px-3 min-w-[150px]">
                      <div className="max-w-[180px] truncate text-xs text-slate-600 dark:text-slate-300">{o.internalNote || o.customerNote || '—'}</div>
                      <div className="mt-1 text-[10px] text-slate-400">Updated {new Date(o.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    </td>

                    <td className="py-3.5 px-3 min-w-[180px]">
                      <div className="space-y-2">{o.items.map((it) => <div key={it.id} className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="truncate text-xs text-slate-800 dark:text-slate-200">{it.productName}</div><div className="text-[10px] text-slate-500">৳{Number(it.unitPrice).toLocaleString()}</div></div><span className="shrink-0 text-xs text-slate-500">{it.quantity}x</span></div>)}</div>
                    </td>

                    <td className="py-3.5 px-3 text-center tabular-nums">{typeof o.customer?.successRate === 'number' ? `${Math.round(o.customer.successRate)}%` : '—'}</td>

                    <td className="py-3.5 px-3" onClick={event => event.stopPropagation()}><div className="flex flex-wrap gap-1">{activeTab !== 'TRASH' ? <button onClick={() => handleSinglePriority(o.id, o.priority === 'URGENT' ? 'NORMAL' : 'URGENT')} className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${o.priority === 'URGENT' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>{o.priority === 'URGENT' ? 'Urgent' : 'Normal'}</button> : <span className="text-xs text-slate-500">{o.priority}</span>}{o.isDuplicate && <span className="rounded-md bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700">Duplicate</span>}{o.isFraudSuspect && <span className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">Suspect</span>}</div></td>

                    <td className="py-3.5 px-3 text-xs">{o.wooOrderId ? 'WooCommerce' : o.sourceChannel || 'Main'}</td>

                    {/* Actions */}
                    <td className="py-3.5 px-3 text-center" onClick={(event) => event.stopPropagation()}>
                      <div className="inline-flex items-center gap-1 order-action-menu-container">
                        <Link to={`/orders/${o.id}`} onClick={event => event.stopPropagation()} className="orders-open-link">Open <ExternalLink className="h-3 w-3" /></Link>
                        <div className="relative inline-block text-left">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenActionMenuId(openActionMenuId === o.id ? null : o.id);
                          }}
                          className={`h-8 w-8 inline-flex items-center justify-center rounded-lg transition-colors focus:outline-none ${
                            openActionMenuId === o.id
                              ? 'bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-white'
                              : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                          title="Actions"
                          aria-label={`Actions for order ${o.orderNumber}`}
                          aria-expanded={openActionMenuId === o.id}
                          aria-controls={`order-actions-${o.id}`}
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>

                        {openActionMenuId === o.id && (
                          <OrderActionsPopover id={`order-actions-${o.id}`} onClose={() => setOpenActionMenuId(null)}>
                            {activeTab !== 'TRASH' && <label className="block border-b border-slate-100 p-3 text-xs font-semibold dark:border-slate-800">Status<AdminSelect dropdownKey="pages.OrdersPage.tsx.status"
                              aria-label={`Status for order ${o.orderNumber}`}
                              value={o.status}
                              onChange={(e) => { void handleStatusChange(o.id, e.target.value); setOpenActionMenuId(null); }}
                              className="mt-2 h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                            >
                              {['PENDING','CONFIRMED','PACKAGING','HANDED_OVER','IN_TRANSIT','DELIVERED','PARTIAL_DELIVERED','HOLD','CANCELLED','RETURNED','FAKE_TRASH'].map(status => <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>)}
                            </AdminSelect></label>}
                            {activeTab !== 'TRASH' && <label className="block border-b border-slate-100 p-3 text-xs font-semibold dark:border-slate-800">Assignee<span className="mb-2 block text-[10px] font-normal text-slate-500">{o.assignedTo?.name || 'Unassigned'}</span><AdminSelect dropdownKey="pages.OrdersPage.tsx.9"
                          aria-label={`Assign order ${o.orderNumber}`}
                          value={o.assignedTo?.id || ''}
                          onChange={(e) => { void handleSingleAssign(o.id, e.target.value || null); setOpenActionMenuId(null); }}
                          className={`h-8 text-xs font-medium rounded-lg px-2 border focus:outline-none transition-colors cursor-pointer inline-flex items-center w-full max-w-full ${
                            o.assignedTo
                              ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                              : 'bg-amber-50/50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800/40 font-semibold'
                          }`}
                        >
                          <option value="">Unassigned</option>
                          {staffList.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </AdminSelect></label>}
                            {activeTab === 'TRASH' ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenActionMenuId(null);
                                    handleRestoreOrders([o.id]);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors text-left"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                  <span>Restore order</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenActionMenuId(null);
                                    handlePermanentDeleteOrders([o.id]);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors text-left"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>Delete permanently</span>
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenActionMenuId(null);
                                    startCall({
                                      orderId: o.id,
                                      orderNumber: o.orderNumber || o.id.slice(0, 8),
                                      customerName: o.customerName,
                                      phone: o.customerPhone
                                    });
                                  }}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors text-left"
                                >
                                  <Phone className="w-3.5 h-3.5" />
                                  <span>Direct Call (Web Phone)</span>
                                </button>

                                {ivrManualEnabled && (
                                  <button
                                    type="button"
                                    disabled={dialingIvrOrderId === o.id}
                                    onClick={() => {
                                      setOpenActionMenuId(null);
                                      handleTriggerIvrCall(o.id, o.orderNumber || o.id.slice(0, 8));
                                    }}
                                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-colors text-left"
                                  >
                                    {dialingIvrOrderId === o.id ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <PhoneForwarded className="w-3.5 h-3.5" />
                                    )}
                                    <span>Trigger IVR Call</span>
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenActionMenuId(null);
                                    setSelectedOrderForWhatsApp(o);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors text-left"
                                >
                                  <MessageSquare className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                                  <span>WhatsApp message</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenActionMenuId(null);
                                    setSelectedOrderForCourier(o);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors text-left"
                                >
                                  <Truck className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                                  <span>Courier dispatch</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenActionMenuId(null);
                                    setSelectedOrderForEdit(o);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors text-left"
                                >
                                  <Pencil className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                                  <span>Edit order</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenActionMenuId(null);
                                    setSelectedOrderForInvoice(o);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors text-left"
                                >
                                  <Printer className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
                                  <span>Print invoice</span>
                                </button>

                                <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenActionMenuId(null);
                                    handleTrashOrders([o.id]);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors text-left"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>Move to trash</span>
                                </button>
                              </>
                            )}
                          </OrderActionsPopover>
                        )}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalPages > 1 && <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm dark:border-slate-800"><span className="text-slate-500">Page {page} of {totalPages}</span><div className="flex gap-2"><button type="button" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold disabled:opacity-40 dark:border-slate-700">Previous</button><button type="button" disabled={page === totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))} className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold disabled:opacity-40 dark:border-slate-700">Next</button></div></div>}
          </div>
        )}
      </div>

      </section>
      {/* Modals */}
      {selectedOrderForCourier && (
        <CourierDispatchModal
          order={selectedOrderForCourier}
          onClose={() => setSelectedOrderForCourier(null)}
          onSuccess={() => fetchOrders()}
        />
      )}

      {(selectedOrderForInvoice || bulkOrdersForInvoice) && (
        <InvoiceModal
          order={selectedOrderForInvoice}
          orders={bulkOrdersForInvoice}
          onClose={() => {
            setSelectedOrderForInvoice(null);
            setBulkOrdersForInvoice(null);
          }}
        />
      )}

      {selectedOrderForWhatsApp && (
        <WhatsAppModal
          order={selectedOrderForWhatsApp}
          onClose={() => setSelectedOrderForWhatsApp(null)}
        />
      )}

      {isCreateModalOpen && (
        <CreateOrderModal
          onClose={() => setIsCreateModalOpen(false)}
          onSuccess={() => fetchOrders()}
        />
      )}

      {selectedOrderForEdit && (
        <OrderEditModal
          order={selectedOrderForEdit}
          onClose={() => setSelectedOrderForEdit(null)}
          onSuccess={() => fetchOrders()}
        />
      )}
    </div>
  );
};
