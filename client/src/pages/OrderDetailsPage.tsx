import './orderDetails.css';
import { useAuth } from '../context/AuthContext';
import { AdminSelect } from '../components/admin/AdminSelect';
import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Box, Copy, Loader2, MessageCircle, Phone, PhoneForwarded, Printer, PhoneIncoming, PhoneOutgoing, PhoneMissed, RefreshCw, Headphones } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../lib/api';
import type { Order } from '../types';
import { InvoiceModal } from '../components/orders/InvoiceModal';
import { OrderEditModal } from '../components/orders/OrderEditModal';
import { CustomerHistoryCard, type CustomerHistory } from '../components/orders/CustomerHistoryCard';
import { OrderIdentifierProtection } from '../components/orders/OrderIdentifierProtection';
import { CourierDispatchModal } from '../components/orders/CourierDispatchModal';
import CourierLocationCard from '../components/orders/CourierLocationCard';
import OrderRiskCard from '../components/orders/OrderRiskCard';
import { useWebPhone } from '../context/WebPhoneContext';
import { OrderNotesCard } from '../components/orders/OrderNotesCard';
import CourierFraudCheckCard, { type BdCourierCheckResult, type CourierStat } from '../components/orders/CourierFraudCheckCard';

const statuses = ['PENDING', 'CONFIRMED', 'PACKAGING', 'HANDED_OVER', 'IN_TRANSIT', 'DELIVERED', 'PARTIAL_DELIVERED', 'HOLD', 'CANCELLED', 'RETURNED', 'FAKE_TRASH'];
const money = (value: number) => `৳${Number(value || 0).toLocaleString()}`;
const pretty = (value?: string) => (value || '—').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase());

export const OrderDetailsPage: React.FC = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const canManage = ['SUPER_ADMIN','OPERATIONS_MANAGER','CALL_CENTER_AGENT'].includes(user?.role || '');
  const [assignmentBusy,setAssignmentBusy] = useState(false);
  const [staffError,setStaffError] = useState('');
  const loadSerial = useRef(0);
  const [order, setOrder] = useState<Order | null>(null);
  const [nextStatus, setNextStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [customerHistory, setCustomerHistory] = useState<CustomerHistory | null>(null);
  const [fraudCheckResult, setFraudCheckResult] = useState<BdCourierCheckResult | null>(null);
  const [fraudCheckError, setFraudCheckError] = useState('');
  const [fraudCheckBusy, setFraudCheckBusy] = useState(false);
  const [fraudCheckedAt, setFraudCheckedAt] = useState<string | null>(null);
  const [autoFraudCheckEnabled, setAutoFraudCheckEnabled] = useState(false);
  const autoFraudCheckOrder = useRef<string | null>(null);
  const fraudCheckRequest = useRef(0);
  const [trackingRefreshing, setTrackingRefreshing] = useState(false);
  const [pathaoEvents, setPathaoEvents] = useState<Array<{ id: string; event: string; occurredAt: string; applied: boolean; reason?: string; returnConsignmentId?: string; collectedAmount?: number; deliveryFee?: number; invoiceId?: string }>>([]);
  const [pathaoRecoveryCode, setPathaoRecoveryCode] = useState('');
  const [pathaoRecoveryBusy, setPathaoRecoveryBusy] = useState(false);
  const [steadfastEvents, setSteadfastEvents] = useState<Array<{ id: string; event: string; trackingMessage?: string; occurredAt: string; applied: boolean }>>([]);
  const [steadfastTrackings, setSteadfastTrackings] = useState<any[]>([]);
  const [steadfastRecoveryId, setSteadfastRecoveryId] = useState('');
  const [steadfastRecoveryBusy, setSteadfastRecoveryBusy] = useState(false);
  const [redxEvents, setRedxEvents] = useState<Array<{ id: string; event: string; trackingMessage?: string; occurredAt: string; applied: boolean }>>([]);
  const [redxTracking, setRedxTracking] = useState<Array<{ message_en?: string; message_bn?: string; time?: string }>>([]);
  const [redxRecoveryId, setRedxRecoveryId] = useState('');
  const [redxBusy, setRedxBusy] = useState(false);
  const [staffList, setStaffList] = useState<any[]>([]);
  const [ivrManualEnabled, setIvrManualEnabled] = useState(false);
  const [ivrDialing, setIvrDialing] = useState(false);
  const [callLogs, setCallLogs] = useState<any[]>([]);
  const [callLogsBusy, setCallLogsBusy] = useState(false);
  const { startCall } = useWebPhone();

  useEffect(() => {
    if (!id) return;
    let alive = true;
    const refreshCalls = async () => {
      if (alive) setCallLogsBusy(true);
      try { const { data } = await api.get(`/ivr/calls/order/${encodeURIComponent(id)}`); if (alive) setCallLogs(data.calls || []); }
      catch { if (alive) setCallLogs([]); }
      finally { if (alive) setCallLogsBusy(false); }
    };
    void refreshCalls();
    const timer = window.setInterval(() => { void refreshCalls(); }, 10000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [id]);

  useEffect(() => {
    api.get('/ivr/config').then((res) => {
      if (res.data?.success && res.data.config?.allowManualCall) {
        setIvrManualEnabled(true);
      }
    }).catch(() => {});
  }, []);

  const handleTriggerIvrCall = async () => {
    if (!order) return;
    setIvrDialing(true);
    try {
      const res = await api.post('/ivr/manual-dial', { orderId: order.id });
      if (res.data?.success) {
        toast.success(res.data.message || `IVR confirmation call queued for Order #${order.orderNumber}`);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to trigger IVR call');
    } finally {
      setIvrDialing(false);
    }
  };

  const load = async () => { const serial=++loadSerial.current; try { const {data}=await api.get('/orders/'+id); if(serial===loadSerial.current){setOrder(data.order);setNextStatus(data.order.status);setCustomerHistory(data.customerHistory || null);setFraudCheckResult(data.courierFraudCheck?.result || null);setFraudCheckedAt(data.courierFraudCheck?.checkedAt || null);setAutoFraudCheckEnabled(Boolean(data.autoCheckBdCourier));setFraudCheckError('');} } catch(error:any){if(serial===loadSerial.current)toast.error(error.response?.data?.message || 'Order not found');} finally {if(serial===loadSerial.current)setLoading(false);} };
  useEffect(()=>{setLoading(true);setOrder(null);setNextStatus('');setFraudCheckResult(null);setFraudCheckedAt(null);setFraudCheckError('');setFraudCheckBusy(false);autoFraudCheckOrder.current=null;fraudCheckRequest.current++;void load();return()=>{loadSerial.current++;fraudCheckRequest.current++;};},[id]);
  useEffect(() => {
    if (!canManage) return;
    api.get('/auth/users').then(({ data }) => {
      if (data?.users) setStaffList(data.users.filter((u: any) => u.status === 'ACTIVE'));
    }).catch(() => setStaffError('Could not load staff. The current assignment is retained.'));
  }, [canManage]);
  const updateAssignment = async (assignedToId: string | null) => {
    if (!order) return;
    setAssignmentBusy(true);
    try {
      const res = await api.patch(`/orders/${order.id}/assignment`, { assignedToId });
      if (res.data?.success) {
        toast.success(assignedToId ? 'Assigned team member' : 'Order unassigned');
        load();
      }
    } catch (e: any) { toast.error(e.response?.data?.message || 'Could not update assignment'); } finally { setAssignmentBusy(false); }
  };
  const updatePriority = async (priority: 'NORMAL' | 'URGENT') => {
    if (!order || order.priority === priority) return;
    try {
      const res = await api.patch(`/orders/${order.id}/priority`, { priority });
      if (res.data?.success) {
        toast.success(`Priority set to ${priority}`);
        load();
      }
    } catch (e: any) { toast.error(e.response?.data?.message || 'Could not update priority'); }
  };
  useEffect(() => {
    if (order?.courierName !== 'PATHAO' || !id) return;
    api.get(`/couriers/pathao/events?orderId=${encodeURIComponent(id)}&limit=100`)
      .then(({ data }) => setPathaoEvents(data.events || []))
      .catch(() => setPathaoEvents([]));
  }, [id, order?.courierName]);
  useEffect(() => {
    if (order?.courierName !== 'STEADFAST' || !id) return;
    api.get(`/couriers/steadfast/events?orderId=${encodeURIComponent(id)}`).then(({ data }) => setSteadfastEvents(data.events || [])).catch(() => setSteadfastEvents([]));
    if (order.courierConsignmentId) api.get(`/couriers/steadfast/orders/${id}/trackings`).then(({ data }) => setSteadfastTrackings(data.data || [])).catch(() => setSteadfastTrackings([]));
  }, [id, order?.courierName, order?.courierConsignmentId]);
  useEffect(() => {
    if (order?.courierName !== 'REDX' || !id) return;
    api.get(`/couriers/redx/events?orderId=${encodeURIComponent(id)}`).then(({ data }) => setRedxEvents(data.events || [])).catch(() => setRedxEvents([]));
    if (order.courierConsignmentId) api.get(`/couriers/redx/orders/${id}`).then(({ data }) => setRedxTracking(data.tracking || [])).catch(() => setRedxTracking([]));
  }, [id, order?.courierName, order?.courierConsignmentId]);
  const updateStatus = async (status: string) => { if (!order || status === order.status) { setNextStatus(order?.status || ''); return; } setUpdating(true); try { await api.patch(`/orders/${order.id}/status`, { status }); setNextStatus(status); toast.success(`Order moved to ${pretty(status)}`); load(); } catch (error: any) { setNextStatus(order.status); toast.error(error.response?.data?.message || 'Could not update status'); } finally { setUpdating(false); } };
  const copy = (value: string) => navigator.clipboard.writeText(value).then(() => toast.success('Copied'));
  const refreshPathao = async () => {
    if (!order) return;
    setTrackingRefreshing(true);
    try { const { data } = await api.post(`/couriers/pathao/orders/${order.id}/refresh`); setOrder(data.order); toast.success(`Pathao status: ${data.courierStatus}`); }
    catch (error: any) { toast.error(error.response?.data?.message || 'Could not refresh Pathao tracking'); }
    finally { setTrackingRefreshing(false); }
  };
  const resolvePathao = async (action: 'ATTACH' | 'CLEAR') => {
    if (!order) return;
    if (action === 'CLEAR' && !window.confirm('Only continue after checking Pathao and confirming no booking exists. A late booking could otherwise cause a duplicate shipment.')) return;
    setPathaoRecoveryBusy(true);
    try {
      const payload = action === 'ATTACH' ? { action, consignmentId: pathaoRecoveryCode.trim() } : { action, confirmation: 'NO_PATHAO_BOOKING_CONFIRMED' };
      const { data } = await api.post(`/couriers/pathao/orders/${order.id}/resolve`, payload);
      setOrder(data.order);
      toast.success(action === 'ATTACH' ? 'Verified Pathao consignment attached' : 'Uncertain booking cleared');
    } catch (error: any) { toast.error(error.response?.data?.message || 'Could not resolve Pathao booking'); }
    finally { setPathaoRecoveryBusy(false); }
  };
  const refreshSteadfast = async () => {
    if (!order) return;
    setTrackingRefreshing(true);
    try { const { data } = await api.post(`/couriers/steadfast/orders/${order.id}/refresh`); setOrder(data.order); toast.success(`Steadfast status: ${data.deliveryStatus}`); }
    catch (error: any) { toast.error(error.response?.data?.message || 'Could not refresh Steadfast tracking'); }
    finally { setTrackingRefreshing(false); }
  };
  const refreshRedx = async () => {
    if (!order) return;
    setTrackingRefreshing(true);
    try { const { data } = await api.post(`/couriers/redx/orders/${order.id}/refresh`); setOrder(data.order); toast.success(`RedX status: ${data.parcel?.status || 'updated'}`); }
    catch (error: any) { toast.error(error.response?.data?.message || 'Could not refresh RedX parcel'); }
    finally { setTrackingRefreshing(false); }
  };
  const cancelRedx = async () => {
    if (!order) return;
    const reason = window.prompt('Why should RedX cancel this parcel?');
    if (!reason) return;
    setRedxBusy(true);
    try { await api.patch(`/couriers/redx/orders/${order.id}`, { propertyName: 'status', value: 'cancelled', reason }); toast.success('RedX accepted the cancellation request. Refresh tracking to confirm.'); }
    catch (error: any) { toast.error(error.response?.data?.message || 'Could not request cancellation'); }
    finally { setRedxBusy(false); }
  };
  const changeRedxAddress = async () => {
    if (!order) return;
    const value = window.prompt('New delivery address for RedX', order.customerAddress);
    if (!value || value.trim().length < 8) return;
    const reason = window.prompt('Reason for this RedX address change');
    if (!reason) return;
    setRedxBusy(true);
    try { await api.patch(`/couriers/redx/orders/${order.id}`, { propertyName: 'delivery_address', value: value.trim(), reason }); toast.success('RedX accepted the address change request. Confirm it in the RedX portal.'); }
    catch (error: any) { toast.error(error.response?.data?.message || 'Could not request address change'); }
    finally { setRedxBusy(false); }
  };
  const resolveRedx = async (action: 'ATTACH' | 'CLEAR') => {
    if (!order) return;
    if (action === 'CLEAR' && !window.confirm(`Check invoice ${order.orderNumber} in the RedX merchant portal first. Clear only if no parcel was created.`)) return;
    setRedxBusy(true);
    try { const { data } = await api.post(`/couriers/redx/orders/${order.id}/resolve`, action === 'ATTACH' ? { action, trackingId: redxRecoveryId.trim() } : { action, confirmation: 'NO_REDX_BOOKING_CONFIRMED' }); setOrder(data.order); toast.success(action === 'ATTACH' ? 'Verified RedX tracking attached' : 'Booking cleared for retry'); }
    catch (error: any) { toast.error(error.response?.data?.message || 'Could not resolve RedX booking'); }
    finally { setRedxBusy(false); }
  };
  const requestSteadfastReturn = async () => {
    if (!order) return;
    const reason = window.prompt('Why should Steadfast return this parcel?');
    if (reason === null) return;
    if (!window.confirm('Submit this return request to Steadfast?')) return;
    try { await api.post(`/couriers/steadfast/orders/${order.id}/returns`, { reason }); toast.success('Steadfast return request submitted'); }
    catch (error: any) { toast.error(error.response?.data?.message || 'Could not request return'); }
  };
  const resolveSteadfast = async (action: 'ATTACH' | 'CLEAR') => {
    if (!order) return;
    if (action === 'CLEAR' && !window.confirm(`Check invoice ${order.orderNumber} in the Steadfast merchant panel first. Only unlock retry if NO booking exists. Continue?`)) return;
    setSteadfastRecoveryBusy(true);
    try {
      const payload = action === 'ATTACH' ? { action, consignmentId: steadfastRecoveryId.trim() } : { action, confirmation: 'NO_STEADFAST_BOOKING_CONFIRMED' };
      const { data } = await api.post(`/couriers/steadfast/orders/${order.id}/resolve`, payload);
      setOrder(data.order);
      toast.success(action === 'ATTACH' ? 'Steadfast consignment verified and attached' : 'Booking cleared for retry');
    } catch (error: any) { toast.error(error.response?.data?.message || 'Could not resolve booking'); }
    finally { setSteadfastRecoveryBusy(false); }
  };

  const checkCourierFraud = async (targetOrderId = order?.id, silent = false) => {
    if (!targetOrderId) return;
    const requestId = ++fraudCheckRequest.current;
    setFraudCheckBusy(true); setFraudCheckError('');
    try {
      const { data } = await api.post(`/couriers/bdcourier/orders/${targetOrderId}/fraud-check`);
      if (requestId !== fraudCheckRequest.current) return;
      setFraudCheckResult(data.result || null);
      setFraudCheckedAt(data.checkedAt || new Date().toISOString());
      if (data.result?.status === 'error') setFraudCheckError(data.result.message || 'BD Courier could not find a report for this phone number');
      else if (!silent) toast.success('Courier history updated and saved');
    } catch (error: any) {
      if (requestId !== fraudCheckRequest.current) return;
      setFraudCheckError(error.response?.data?.message || 'Could not check courier history');
      if (!silent) toast.error(error.response?.data?.message || 'Could not check courier history');
    } finally { if (requestId === fraudCheckRequest.current) setFraudCheckBusy(false); }
  };
  useEffect(() => {
    if (!order || fraudCheckResult || !autoFraudCheckEnabled || autoFraudCheckOrder.current === order.id) return;
    autoFraudCheckOrder.current = order.id;
    void checkCourierFraud(order.id, true);
  }, [order?.id, fraudCheckResult, autoFraudCheckEnabled]);

  if (loading) return <div className="py-24 text-center text-sm text-slate-500">Loading order…</div>;
  if (!order) return <div className="py-24 text-center"><p className="font-bold">Order not found</p><Link className="mt-3 inline-block text-sm font-bold text-emerald-600 dark:text-emerald-400 hover:underline" to="/orders">Back to orders</Link></div>;
  let checkoutDetails: Record<string, string> = {};
  try { checkoutDetails = JSON.parse(order.checkoutDetails || '{}'); } catch { checkoutDetails = {}; }
  const courierBreakdown = fraudCheckResult?.data || fraudCheckResult?.courierData || {};
  const providerCards = [
    { name: 'Overall', key: 'summary', tone: 'violet', active: true, state: pretty(order.status), detail: `Order #${order.orderNumber}` },
    { name: 'Pathao', key: 'pathao', tone: 'rose', active: order.courierName === 'PATHAO', state: order.courierName === 'PATHAO' ? pretty(order.courierStatus || order.status) : 'Not assigned', detail: order.courierName === 'PATHAO' ? order.courierTrackingCode || 'No tracking yet' : 'No booking for this order' },
    { name: 'Steadfast', key: 'steadfast', tone: 'teal', active: order.courierName === 'STEADFAST', state: order.courierName === 'STEADFAST' ? pretty(order.courierStatus || order.status) : 'Not assigned', detail: order.courierName === 'STEADFAST' ? order.courierTrackingCode || 'No tracking yet' : 'No booking for this order' },
    { name: 'RedX', key: 'redx', tone: 'red', active: order.courierName === 'REDX', state: order.courierName === 'REDX' ? pretty(order.courierStatus || order.status) : 'Not assigned', detail: order.courierName === 'REDX' ? order.courierTrackingCode || 'No tracking yet' : 'No booking for this order' },
    { name: 'Paperfly', key: 'paperfly', tone: 'amber', active: order.courierName === 'PAPERFLY', state: order.courierName === 'PAPERFLY' ? pretty(order.courierStatus || order.status) : 'Not assigned', detail: order.courierName === 'PAPERFLY' ? order.courierTrackingCode || 'No tracking yet' : 'No booking for this order' },
  ].map(provider => ({ ...provider, stats: courierBreakdown[provider.key] as CourierStat | undefined }));
  return <div className="order-details-page mx-auto max-w-[1600px] space-y-3 pb-12">
    <div className="order-detail-header flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <Link to="/orders" aria-label="Back to orders" className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900"><ArrowLeft className="h-4 w-4"/></Link>
        <div className="min-w-0"><h2 className="text-lg font-semibold leading-6">Web Order Details</h2><p className="truncate text-xs text-slate-500">Review and manage this web order · #{order.orderNumber}</p></div>
        {(order.isFraudSuspect || order.isDuplicate) && <span className="hidden rounded-full bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800 sm:inline-flex">Review required</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
        <span className={`order-meta-pill ${order.status === 'CANCELLED' ? 'order-status-cancel' : ''}`}>{pretty(order.status)}</span>
        <span className="order-meta-pill order-source-pill">{order.wooOrderId ? 'WooCommerce' : pretty(order.sourceChannel || 'WEB')}</span>
        <span className="order-meta-pill"><span className="text-slate-400">Created</span> {new Date(order.createdAt).toLocaleString()}</span>
        <span className="order-meta-pill"><span className="text-slate-400">Updated</span> {new Date(order.updatedAt).toLocaleString()}</span>
      </div>
    </div>

    {order.internalNote?.includes('[Courier review required]') && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">This order was amended after booking. Confirm the delivery address, products and COD amount with the courier.</p>}
    {(order.isFraudSuspect || order.isDuplicate) && <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0"/><div><b className="text-xs">Review before fulfilment</b><p className="text-xs opacity-80">{order.isFraudSuspect ? 'Customer history triggered a risk flag. ' : ''}{order.isDuplicate ? 'A recent order has the same customer phone number.' : ''}</p></div></div>}

    <div className="order-editor-grid grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-3">
        <section className="courier-performance-strip" aria-label="Order and courier status">
          <article className="courier-performance-card courier-record-card"><div className="courier-card-heading"><span className="courier-logo-mark">M</span><b>Our Record</b>{customerHistory && customerHistory.totalPrevious > 0 && <span className="courier-card-count">{customerHistory.totalPrevious}</span>}<button type="button" aria-label="Check BD Courier fraud history" title="Check BD Courier fraud history" onClick={() => void checkCourierFraud()} disabled={fraudCheckBusy} className="ml-auto rounded bg-white/20 px-1.5 py-1 text-[9px] font-bold hover:bg-white/30 disabled:opacity-60">{fraudCheckBusy ? '…' : 'Check'}</button></div><div className="courier-record-line"><span>Total previous</span><b>{customerHistory?.totalPrevious ?? 0}</b></div><div className="courier-record-line"><span>Delivered</span><b className="text-emerald-700">{customerHistory?.completed ?? 0}</b></div><div className="courier-record-line"><span>Cancelled / returned</span><b>{(customerHistory?.cancelled ?? 0) + (customerHistory?.returned ?? 0)}</b></div>{fraudCheckResult?.reports?.length ? <div className="courier-record-line"><span>Fraud reports</span><b className="text-rose-600">{fraudCheckResult.reports.length}</b></div> : null}</article>
          {providerCards.map((provider) => <article key={provider.name} className={`courier-performance-card courier-tone-${provider.tone} ${provider.active ? 'is-current' : ''}`}><div className="courier-card-heading"><span className="courier-logo-mark">{provider.name === 'Steadfast' ? '➤' : provider.name === 'RedX' ? 'R' : provider.name === 'Paperfly' ? 'P' : provider.name === 'Pathao' ? 'p' : '↗'}</span><b>{provider.name}</b>{provider.active && <span className="courier-current-dot" aria-label="Current courier"/>}</div>{provider.stats ? <><div className="courier-record-line"><span>Success rate</span><b>{Number(provider.stats.success_ratio || 0).toLocaleString()}%</b></div><div className="courier-record-line"><span>Total</span><b>{Number(provider.stats.total_parcel || 0).toLocaleString()}</b></div><div className="courier-record-line"><span>Success</span><b className="text-emerald-700">{Number(provider.stats.success_parcel || 0).toLocaleString()}</b></div><div className="courier-record-line"><span>Cancelled</span><b>{Number(provider.stats.cancelled_parcel || 0).toLocaleString()}</b></div></> : <><div className="courier-provider-state">{provider.state}</div><div className="courier-provider-detail" title={provider.detail}>{provider.detail}</div></>}<div className={`courier-provider-progress ${provider.active ? 'active' : ''}`} style={provider.stats ? { width: `${Math.max(0, Math.min(100, Number(provider.stats.success_ratio || 0)))}%` } : undefined} /></article>)}
        </section>
        <section className="order-editor-section"><h3 className="order-section-kicker">Customer details</h3><div className="grid gap-3 border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900 md:grid-cols-3"><div><label className="order-field-label">Mobile number</label><div className="order-reference-field flex items-center justify-between gap-2"><button type="button" onClick={() => copy(order.customerPhone)} className="truncate text-left">{order.customerPhone}</button><div className="flex shrink-0 items-center gap-1"><button aria-label="Call customer" onClick={() => startCall({ orderId: order.id, orderNumber: order.orderNumber, customerName: order.customerName, phone: order.customerPhone })} className="rounded-md p-1 text-emerald-700 hover:bg-emerald-50"><Phone className="h-4 w-4"/></button><a aria-label="WhatsApp customer" target="_blank" rel="noreferrer" href={`https://wa.me/88${order.customerPhone.replace(/\D/g, '')}`} className="rounded-md p-1 text-emerald-600 hover:bg-emerald-50"><MessageCircle className="h-4 w-4"/></a></div></div></div><div><label className="order-field-label">Name</label><div className="order-reference-field">{order.customerName || '—'}</div></div><div><label className="order-field-label">Delivery method</label><div className="order-reference-field flex items-center justify-between gap-2"><span>{pretty(order.courierName || 'Not selected')}</span>{!order.courierName && <button type="button" onClick={() => setDispatchOpen(true)} className="text-xs font-semibold text-purple-800 hover:underline">Choose courier</button>}</div></div></div></section>

        <section className="order-editor-section"><h3 className="order-section-kicker">Shipping &amp; address</h3><div className="grid gap-3 border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900 md:grid-cols-3"><div><label className="order-field-label">Address</label><div className="order-reference-field min-h-[72px] leading-5">{order.customerAddress || 'No address provided'}{[order.area, order.zone, order.city, order.district].filter(Boolean).length > 0 && <span className="mt-1 block text-xs text-slate-500">{[order.area, order.zone, order.city, order.district].filter(Boolean).join(', ')}</span>}</div></div><div><label className="order-field-label">Shipping note</label><div className="order-reference-field min-h-[72px] leading-5 text-slate-600 dark:text-slate-300">{order.customerNote || <span className="text-slate-400">No shipping note</span>}</div></div><div><div className="flex items-center justify-between"><label className="order-field-label">Extra options</label><button type="button" onClick={() => setEditOpen(true)} className="rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">Edit order</button></div><div className="order-options-box"><span className="rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-slate-700">{pretty(order.sourceChannel || (order.wooOrderId ? 'WooCommerce' : 'Website'))}</span><span className="text-[11px] text-slate-500">{pretty(order.paymentMethod)} · {pretty(order.paymentStatus)}</span><button type="button" onClick={() => setEditOpen(true)} className="mt-1 inline-flex items-center gap-1.5 self-end rounded-lg bg-purple-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-800"><Printer className="h-3.5 w-3.5"/> Invoice</button></div></div></div></section>

        <section className="order-editor-section order-boxed-section"><div className="order-section-heading"><div><h3>Add products</h3><p>Search by product name and SKU</p></div></div><button type="button" onClick={() => setEditOpen(true)} className="order-product-search mt-2"><span><span className="text-slate-400">⌕</span> Search and add products</span><span className="text-slate-400">⌄</span></button></section>

        <section className="order-editor-section order-boxed-section"><div className="order-section-heading"><h3>Ordered products <span className="order-item-count">{order.items.length}</span></h3><button type="button" disabled={!canManage || Boolean(order.trashedAt)} onClick={() => setEditOpen(true)} className="text-xs font-semibold text-purple-800 hover:underline disabled:opacity-50">Edit products</button></div><div className="mt-3 space-y-2">{order.items.map(item => <article key={item.id} className="order-edit-line"><div className="flex min-w-0 items-center gap-3"><div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">{(item.variant?.image || item.product?.image) ? <img src={item.variant?.image || item.product?.image} alt="" className="h-full w-full object-cover"/> : <div className="grid h-full place-items-center"><Box className="h-5 w-5 text-slate-400"/></div>}</div><div className="min-w-0"><b className="block truncate text-sm">{item.productSku || item.productName}</b><p className="mt-0.5 truncate text-xs text-slate-500">{item.productName}</p><p className="text-xs text-slate-500">{item.variantName || [item.color, item.size].filter(Boolean).join(' / ') || 'Standard'}</p></div></div><div className="order-line-value"><span>Qty</span><b>{item.quantity}×</b></div><div className="order-line-value"><span>Price</span><b>{money(item.unitPrice)}</b></div><div className="order-line-value"><span>Total</span><b>{money(item.totalPrice)}</b></div><button type="button" disabled={!canManage || Boolean(order.trashedAt)} onClick={() => setEditOpen(true)} className="order-line-edit" aria-label={`Edit ${item.productName}`}>Edit</button></article>)}</div>{Object.keys(checkoutDetails).length > 0 && <div className="order-attributes-box"><b>Checkout details</b><div>{Object.entries(checkoutDetails).map(([key, value]) => <p key={key}><span>{key.replace(/_/g, ' ')}:</span> {String(value)}</p>)}</div></div>}</section>

        <section className="order-editor-section order-boxed-section"><h3 className="order-section-kicker">Order total</h3><div className="order-total-fields"><div><span>Discount</span><b>{money(order.discount)}</b></div><div><span>Advance</span><b>{money(order.advancePaid)}</b></div><div><span>Sub total</span><b>{money(order.subtotal)}</b></div><div><span>Delivery charge</span><b>{money(order.deliveryCharge)}</b></div><div className="grand-total"><span>Grand total</span><b>{money(order.grandTotal)}</b></div></div>{order.status === 'PENDING' && <button type="button" disabled={updating || !canManage || order.riskReviewStatus === 'REVIEW_REQUIRED'} onClick={() => updateStatus('CONFIRMED')} className="order-approve-button">{updating ? 'Updating order…' : `Approve Order (${money(order.grandTotal)})`}</button>}</section>
      </div>

      <aside className="order-detail-aside space-y-3">
        <section className="order-side-card order-aside-summary"><div className="order-side-heading"><h3>Order summary</h3><span>#{order.orderNumber}</span></div><div className="order-summary-meta"><div><span>Date</span><b>{new Date(order.createdAt).toLocaleString()}</b></div><div><span>Status</span><b>{pretty(order.status)}</b></div><div><span>Payment</span><b>{pretty(order.paymentMethod)}</b></div><div><span>Source</span><b>{pretty(order.sourceChannel || (order.wooOrderId ? 'WooCommerce' : 'WEB'))}</b></div></div><div className="order-summary-amounts"><div><span>Subtotal</span><b>{money(order.subtotal)}</b></div><div><span>Delivery</span><b>{money(order.deliveryCharge)}</b></div>{order.discount > 0 && <div><span>Discount</span><b>−{money(order.discount)}</b></div>}<div className="summary-grand"><span>Total</span><b>{money(order.grandTotal)}</b></div></div><OrderIdentifierProtection orderId={order.id} orderNumber={order.orderNumber} canManage={user?.role === 'SUPER_ADMIN'}/><div className="order-side-mini-items"><h4>Order items</h4>{order.items.slice(0, 4).map(item => <div key={item.id}><span className="truncate">{item.productSku || item.productName}</span><span>{item.quantity}x</span><b>{money(item.totalPrice)}</b></div>)}{order.items.length > 4 && <p>and {order.items.length - 4} more</p>}</div></section>

        <section className="order-side-card"><div className="order-side-heading"><h3>Order flags</h3><span>{order.isFraudSuspect || order.isDuplicate ? 'Review' : '—'}</span></div><div className="order-flags">{order.isFraudSuspect && <span className="flag-risk">Risk review</span>}{order.isDuplicate && <span className="flag-duplicate">Duplicate</span>}{!order.isFraudSuspect && !order.isDuplicate && <span className="text-xs text-slate-400">No order flags</span>}</div></section>

        <section className="order-side-card order-actions-card"><div className="order-side-heading"><h3>Order actions</h3></div><div className="order-pbx-call"><div><span className="inline-flex items-center gap-1.5 font-semibold text-emerald-800"><Phone className="h-3.5 w-3.5"/> PBX Call</span><span className="block text-[11px] text-slate-500">{order.customerPhone}</span></div><button type="button" onClick={() => startCall({ orderId: order.id, orderNumber: order.orderNumber, customerName: order.customerName, phone: order.customerPhone })} className="grid h-9 w-9 place-items-center rounded-lg bg-purple-900 text-white hover:bg-purple-800" aria-label="Call customer"><Phone className="h-4 w-4"/></button></div>{ivrManualEnabled && <button type="button" disabled={ivrDialing} onClick={handleTriggerIvrCall} className="order-action-secondary w-full justify-center text-indigo-700 disabled:opacity-50">{ivrDialing ? <Loader2 className="h-4 w-4 animate-spin"/> : <PhoneForwarded className="h-4 w-4"/>}{ivrDialing ? 'Calling…' : 'Automated IVR call'}</button>}<div className="order-call-history"><div className="flex items-center justify-between text-xs font-semibold"><span>Call history</span><button type="button" onClick={() => { setCallLogsBusy(true); api.get(`/ivr/calls/order/${encodeURIComponent(order.id)}`).then(({data}) => setCallLogs(data.calls || [])).catch(() => toast.error('Could not refresh call history')).finally(() => setCallLogsBusy(false)); }} className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 hover:text-purple-800"><RefreshCw className={`h-3 w-3 ${callLogsBusy ? 'animate-spin' : ''}`}/>Refresh</button></div>{callLogs.length ? <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">{callLogs.map((call) => { const missed = ['MISSED', 'NO_ANSWER', 'BUSY', 'FAILED'].includes(call.status); const CallIcon = missed ? PhoneMissed : call.direction === 'INBOUND' ? PhoneIncoming : PhoneOutgoing; return <article key={call.id} className="rounded-lg border border-slate-100 bg-slate-50/80 p-2.5 dark:border-slate-700 dark:bg-slate-800/60"><div className="flex items-start gap-2"><span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${missed ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-700'}`}><CallIcon className="h-3.5 w-3.5"/></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-1"><span className="text-[11px] font-semibold">{call.direction === 'INBOUND' ? 'Incoming' : 'Outgoing'} · {pretty(call.status)}</span><span className="text-[10px] text-slate-500">{new Date(call.startedAt).toLocaleString()}</span></div><p className="mt-0.5 truncate text-[10px] text-slate-500">{call.agentName || call.user?.name || call.source || 'PBX'}{call.durationSeconds ? ` · ${Math.floor(call.durationSeconds / 60)}m ${call.durationSeconds % 60}s` : ''}{call.talkSeconds ? ` · ${call.talkSeconds}s talk` : ''}</p>{call.disposition && <p className="mt-1 text-[10px] text-slate-500">{call.disposition}</p>}{typeof call.metadata?.recordingUrl === 'string' && <div className="mt-2 flex items-center gap-2 text-[10px] text-violet-700 dark:text-violet-300"><Headphones className="h-3.5 w-3.5"/><audio controls preload="none" src={call.metadata.recordingUrl} className="h-8 min-w-0 max-w-full" aria-label="Call recording"/></div>}</div></div></article>; })}</div> : <p className="mt-2 text-[11px] text-slate-400">{callLogsBusy ? 'Loading call history…' : 'No calls recorded for this customer yet.'}</p>}{order.messageLogs?.filter(log => log.channel === 'IVR_CALL' && !callLogs.some(call => call.providerCallId === `IVR:${log.id}`)).slice(0, 3).map(log => <div key={log.id} className="order-call-entry"><span>Automated IVR · {pretty(log.status || 'Recorded')}</span><small>{log.createdAt ? new Date(log.createdAt).toLocaleString() : '—'}</small></div>)}</div><div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-1.5"><AdminSelect dropdownKey="pages.OrderDetailsPage.tsx.1" aria-label="Change order status" disabled={updating} value={nextStatus || order.status} onChange={(e) => setNextStatus(e.target.value)} className="h-9 min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950">{statuses.map(status => <option key={status} value={status}>{pretty(status)}</option>)}</AdminSelect><button type="button" disabled={updating || (nextStatus || order.status) === order.status} onClick={() => updateStatus(nextStatus || order.status)} className="h-9 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white disabled:opacity-50">{updating ? '…' : 'Update'}</button><Link to="/orders" className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-2 text-xs dark:border-slate-700"><ArrowLeft className="h-3.5 w-3.5"/>Back</Link></div><div className="grid grid-cols-2 gap-1.5">{canManage && !order.trashedAt && <button type="button" onClick={() => setEditOpen(true)} className="order-action-secondary justify-center">Edit order</button>}<button type="button" onClick={() => setInvoiceOpen(true)} className="order-action-secondary justify-center"><Printer className="h-3.5 w-3.5"/>Invoice</button><a target="_blank" rel="noreferrer" href={`https://wa.me/88${order.customerPhone.replace(/\D/g, '')}`} className="order-action-secondary justify-center"><MessageCircle className="h-3.5 w-3.5"/>WhatsApp</a><button type="button" onClick={() => copy(order.customerPhone)} className="order-action-secondary justify-center"><Copy className="h-3.5 w-3.5"/>Copy phone</button></div><button type="button" onClick={() => updatePriority(order.priority === 'URGENT' ? 'NORMAL' : 'URGENT')} className={`w-full rounded-lg px-3 py-2 text-xs font-semibold ${order.priority === 'URGENT' ? 'bg-amber-100 text-amber-800' : 'border border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}>{order.priority === 'URGENT' ? '⚡ Urgent priority' : 'Set urgent priority'}</button><div className="order-assignee"><label htmlFor="order-assignee" className="text-[11px] font-semibold text-slate-500">Assigned team member</label><AdminSelect id="order-assignee" dropdownKey="pages.OrderDetailsPage.tsx.2" aria-label="Assigned team member" disabled={!canManage || assignmentBusy} value={order.assignedTo?.id || ''} onChange={(e) => updateAssignment(e.target.value ? e.target.value : null)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950"><option value="">Unassigned</option>{order.assignedTo && !staffList.some(staff=>staff.id===order.assignedTo?.id) && <option value={order.assignedTo.id}>{order.assignedTo.name} (current)</option>}{staffList.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role.replace(/_/g, ' ')})</option>)}</AdminSelect>{staffError && <p role="alert" className="mt-1 text-xs text-rose-600">{staffError}</p>}</div></section>

        <OrderNotesCard order={order} onRefresh={load}/>
      </aside>
    </div>
    <CourierLocationCard orderId={order.id} revision={order.updatedAt} canEdit={!order.courierConsignmentId && !['DELIVERED', 'RETURNED', 'CANCELLED'].includes(order.status)}/>
    {(order.riskReviewStatus === 'REVIEW_REQUIRED' || Boolean(order.riskReasons?.length) || Boolean(order.sourceIp)) && <OrderRiskCard order={order} onRefresh={load}/>}
    {order.courierName === 'PATHAO' && <section className="rounded-2xl border border-slate-100/90 bg-white p-5 shadow-[0_2px_10px_rgba(0,0,0,0.02)] dark:border-slate-800 dark:bg-slate-900"><h3 className="font-semibold">Pathao delivery timeline</h3><p className="mt-1 text-xs text-slate-500">Signed courier updates are saved here, including return and payment events.</p>{pathaoEvents.length ? <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">{pathaoEvents.map((event) => <div key={event.id} className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:justify-between"><div><b>{pretty(event.event.replace(/^order\./, ''))}</b><p className="text-xs text-slate-500">{[event.reason, event.returnConsignmentId && `Return #${event.returnConsignmentId}`, event.invoiceId && `Invoice #${event.invoiceId}`, event.collectedAmount !== undefined && `Collected ${money(event.collectedAmount)}`, event.deliveryFee !== undefined && `Fee ${money(event.deliveryFee)}`].filter(Boolean).join(' · ') || (event.applied ? 'Order synchronized' : 'Recorded')}</p></div><span className="shrink-0 text-xs text-slate-500">{new Date(event.occurredAt).toLocaleString()}</span></div>)}</div> : <p className="mt-4 text-sm text-slate-500">No Pathao webhook events received yet.</p>}</section>}
    {order.courierName === 'STEADFAST' && <section className="rounded-2xl border border-slate-100/90 bg-white p-5 shadow-[0_2px_10px_rgba(0,0,0,0.02)] dark:border-slate-800 dark:bg-slate-900"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">Steadfast tracking</h3><p className="text-xs text-slate-500">Consignment #{order.courierConsignmentId || 'Awaiting confirmation'} · {order.courierTrackingCode || 'No tracking code yet'}</p></div><div className="flex gap-2">{order.courierConsignmentId && <button disabled={trackingRefreshing} onClick={refreshSteadfast} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold dark:border-slate-700">{trackingRefreshing ? 'Checking…' : 'Refresh status'}</button>}{order.courierConsignmentId && !['DELIVERED', 'RETURNED', 'CANCELLED'].includes(order.status) && <button onClick={requestSteadfastReturn} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700">Request return</button>}</div></div>{order.courierTrackingLink?.startsWith('https://') && <a href={order.courierTrackingLink} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline">Open Steadfast tracking ↗</a>}{!order.courierConsignmentId && ['BOOKING_REQUESTED', 'BOOKING_UNCERTAIN'].includes(order.courierStatus || '') && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">Booking outcome is uncertain. Check invoice {order.orderNumber} in the Steadfast portal before attempting another dispatch.</p>}{steadfastTrackings.map((item: any, index) => <p key={index} className="mt-3 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">{item.text || item.message || item.tracking_message || item.status || JSON.stringify(item)} <span className="text-xs text-slate-500">{item.created_at || item.date || ''}</span></p>)}{steadfastEvents.map(event => <p key={event.id} className="mt-3 border-t border-slate-100 pt-3 text-sm dark:border-slate-800"><b>{pretty(event.event)}</b> · {event.trackingMessage || (event.applied ? 'Order synchronized' : 'Recorded')} <span className="text-xs text-slate-500">{new Date(event.occurredAt).toLocaleString()}</span></p>)}</section>}
    {order.courierName === 'STEADFAST' && !order.courierConsignmentId && ['BOOKING_REQUESTED', 'BOOKING_UNCERTAIN'].includes(order.courierStatus || '') && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-700/50 dark:bg-amber-500/10"><h3 className="font-semibold">Resolve Steadfast booking</h3><p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Find invoice {order.orderNumber} in Steadfast first. A consignment ID can be attached only if it appears in that invoice’s tracking history. Unlock retry only after confirming no booking exists.</p><div className="mt-3 flex flex-wrap gap-2"><input value={steadfastRecoveryId} onChange={event => setSteadfastRecoveryId(event.target.value)} placeholder="Verified consignment ID" className="min-w-[190px] flex-1 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm dark:border-amber-700 dark:bg-slate-900"/><button disabled={steadfastRecoveryBusy || !/^\d+$/.test(steadfastRecoveryId.trim())} onClick={() => resolveSteadfast('ATTACH')} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Verify & attach</button><button disabled={steadfastRecoveryBusy} onClick={() => resolveSteadfast('CLEAR')} className="rounded-lg border border-amber-400 px-3 py-2 text-xs font-bold text-amber-900 disabled:opacity-50">No booking exists — unlock retry</button></div></section>}
    {order.courierName === 'PATHAO' && !order.courierConsignmentId && ['BOOKING_REQUESTED', 'BOOKING_UNCERTAIN'].includes(order.courierStatus || '') && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-700/50 dark:bg-amber-500/10"><h3 className="font-semibold">Pathao booking awaiting confirmation</h3><p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Do not send this order again until Pathao confirms whether a consignment was created. Check the Pathao merchant panel using order #{order.orderNumber}.</p><div className="mt-3 flex flex-wrap gap-2"><input value={pathaoRecoveryCode} onChange={(event) => setPathaoRecoveryCode(event.target.value)} placeholder="Verified consignment ID" className="min-w-[190px] flex-1 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm dark:border-amber-700 dark:bg-slate-900"/><button disabled={pathaoRecoveryBusy || !pathaoRecoveryCode.trim()} onClick={() => resolvePathao('ATTACH')} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Verify & attach</button>{order.courierStatus === 'BOOKING_UNCERTAIN' && <button disabled={pathaoRecoveryBusy} onClick={() => resolvePathao('CLEAR')} className="rounded-lg border border-amber-400 px-3 py-2 text-xs font-bold text-amber-900 dark:text-amber-200 disabled:opacity-50">No booking exists — unlock retry</button>}</div></section>}
    {order.courierName === 'PATHAO' && order.courierConsignmentId && <button disabled={trackingRefreshing} onClick={refreshPathao} className="w-fit rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold dark:border-slate-700 dark:bg-slate-900 disabled:opacity-50">{trackingRefreshing ? 'Checking Pathao…' : 'Refresh Pathao tracking'}</button>}
    {order.courierName === 'REDX' && order.courierConsignmentId && <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">RedX parcel</h3><p className="text-xs text-slate-500">Tracking #{order.courierConsignmentId} · {pretty(order.courierStatus || '')}</p></div><div className="flex flex-wrap gap-2"><button disabled={trackingRefreshing} onClick={refreshRedx} className="rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:opacity-50 dark:border-slate-700">Refresh status</button>{!['DELIVERED', 'CANCELLED', 'RETURNED'].includes(order.status) && <><button disabled={redxBusy} onClick={changeRedxAddress} className="rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:opacity-50 dark:border-slate-700">Request address change</button><button disabled={redxBusy} onClick={cancelRedx} className="rounded-lg border border-red-200 px-3 py-2 text-xs text-red-700 disabled:opacity-50">Request cancellation</button></>}</div></div>
      {redxTracking.map((item, index) => <p key={index} className="mt-3 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">{item.message_en || item.message_bn} <span className="text-slate-500">{item.time ? new Date(item.time).toLocaleString() : ''}</span></p>)}
      {redxEvents.map(event => <p key={event.id} className="mt-3 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">{pretty(event.event)} · {event.trackingMessage || (event.applied ? 'Order synchronized' : 'Recorded')} <span className="text-slate-500">{new Date(event.occurredAt).toLocaleString()}</span></p>)}
    </section>}
    {order.courierName === 'REDX' && !order.courierConsignmentId && ['BOOKING_REQUESTED', 'BOOKING_UNCERTAIN'].includes(order.courierStatus || '') && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-700/50 dark:bg-amber-500/10"><h3 className="font-semibold">Resolve RedX booking</h3><p className="mt-1 text-xs">Check invoice {order.orderNumber} in RedX before attempting another dispatch.</p><div className="mt-3 flex flex-wrap gap-2"><input value={redxRecoveryId} onChange={e => setRedxRecoveryId(e.target.value)} placeholder="Verified tracking ID" className="min-w-[190px] flex-1 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm"/><button disabled={redxBusy || !redxRecoveryId.trim()} onClick={() => resolveRedx('ATTACH')} className="rounded-lg bg-slate-900 px-3 py-2 text-xs text-white disabled:opacity-50">Verify & attach</button>{order.courierStatus === 'BOOKING_UNCERTAIN' && <button disabled={redxBusy} onClick={() => resolveRedx('CLEAR')} className="rounded-lg border border-amber-400 px-3 py-2 text-xs text-amber-900 disabled:opacity-50">No booking exists — unlock retry</button>}</div></section>}
    <CustomerHistoryCard history={customerHistory}/>
    <CourierFraudCheckCard result={fraudCheckResult} checkedAt={fraudCheckedAt} error={fraudCheckError} busy={fraudCheckBusy} onCheck={() => void checkCourierFraud()}/>
    {!order.courierName && order.status !== 'HOLD' && !['DELIVERED', 'RETURNED', 'CANCELLED'].includes(order.status) && <button onClick={() => setDispatchOpen(true)} className="w-fit rounded-xl bg-slate-900 hover:bg-slate-800 text-white dark:bg-emerald-600 dark:hover:bg-emerald-500 px-4 py-2 text-sm font-medium shadow transition">Select courier & dispatch</button>}
    {editOpen && <OrderEditModal order={order} onClose={() => setEditOpen(false)} onSuccess={load}/>}
    {dispatchOpen && <CourierDispatchModal order={order} onClose={() => setDispatchOpen(false)} onSuccess={(updated) => { setOrder({ ...order, ...updated }); load(); }}/>} 
    {invoiceOpen && <InvoiceModal order={order} onClose={() => setInvoiceOpen(false)}/>}
  </div>;
};
