import { config as appConfig } from '../../config';
import axios from 'axios';
import crypto from 'crypto';
import prisma from '../../prisma';
import { revealSecret } from '../../utils/security';

export interface IvrConfigData {
  apiUrl: string;
  apiKey: string;
  callerId: string;
  isEnabled: boolean;
  maxRetries: number;
  retryDelayMinutes: number;
  callStartTime: string;
  callEndTime: string;
  minOrderAmount: number;
  orderCallDelayMinutes: number;
  allowManualCall: boolean;
}

export function formatBdPhone(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (/^01[3-9]\d{8}$/.test(digits)) return digits;
  if (/^8801[3-9]\d{8}$/.test(digits)) return digits.slice(2);
  return '';
}

export async function getIvrConfig(): Promise<IvrConfigData> {
  const record = await prisma.messageGatewayConfig.findUnique({
    where: { type: 'ASTERISK_IVR' }
  });

  let extra = {
    maxRetries: 2,
    retryDelayMinutes: 15,
    callStartTime: '09:00',
    callEndTime: '22:00',
    minOrderAmount: 0,
    orderCallDelayMinutes: 0,
    allowManualCall: true,
  };

  if (record?.clientId) {
    try {
      extra = { ...extra, ...JSON.parse(record.clientId) };
    } catch {
      // ignore json parse error
    }
  }

  const defaultSecret = process.env.PBX_IVR_SECRET || '';
  let apiKey = defaultSecret;
  if (record?.apiKey) {
    try {
      apiKey = revealSecret(record.apiKey);
    } catch {
      apiKey = defaultSecret;
    }
  }

  const apiUrl = record?.apiUrl || process.env.PBX_IVR_URL || '';

  return {
    apiUrl,
    apiKey,
    callerId: record?.senderId || '09639139179',
    isEnabled: Boolean(apiUrl && apiKey) && (record ? record.isEnabled : process.env.PBX_IVR_ENABLED === 'true'),
    maxRetries: extra.maxRetries ?? 2,
    retryDelayMinutes: extra.retryDelayMinutes ?? 15,
    callStartTime: extra.callStartTime || '09:00',
    callEndTime: extra.callEndTime || '22:00',
    minOrderAmount: extra.minOrderAmount ?? 0,
    orderCallDelayMinutes: extra.orderCallDelayMinutes ?? 0,
    allowManualCall: extra.allowManualCall !== false,
  };
}

export function isWithinCallingHours(startTime: string, endTime: string): boolean {
  if (!startTime || !endTime) return true;
  try {
    const now = new Date();
    const dhakaTimeStr = now.toLocaleTimeString('en-US', { timeZone: 'Asia/Dhaka', hour12: false, hour: '2-digit', minute: '2-digit' });
    const [currentH, currentM] = dhakaTimeStr.split(':').map(Number);
    const currentTotal = currentH * 60 + currentM;

    const [startH, startM] = startTime.split(':').map(Number);
    const startTotal = startH * 60 + startM;

    const [endH, endM] = endTime.split(':').map(Number);
    const endTotal = endH * 60 + endM;

    if (![currentTotal, startTotal, endTotal].every(Number.isFinite)) return false;
    return startTotal <= endTotal ? currentTotal >= startTotal && currentTotal <= endTotal : currentTotal >= startTotal || currentTotal <= endTotal;
  } catch {
    return true;
  }
}


export async function dispatchIvrCall(order: { id: string; customerPhone: string; grandTotal?: number }, isRetry = false, isManual = false, callId: string = crypto.randomUUID()) {
  if (!appConfig.integrationsEnabled) return { skipped: true, reason: 'Integrations are disabled' };
  const settings = await getIvrConfig();
  const isTest = order.id.startsWith('TEST-');
  if (!settings.apiUrl || !settings.apiKey) return { success: false, error: 'IVR endpoint and signing secret must be configured' };
  if (!settings.isEnabled && !isTest && !isManual) return { skipped: true, reason: 'IVR is disabled' };
  if (!isTest) {
    const current = await prisma.order.findUnique({ where: { id: order.id } });
    if (!current || current.trashedAt || current.riskReviewStatus === 'REVIEW_REQUIRED' || (!isManual && current.status !== 'PENDING') || ['CANCELLED', 'RETURNED', 'DELIVERED', 'FAKE_TRASH'].includes(current.status)) return { skipped: true, reason: 'Order is no longer eligible for calling' };
    order = current;
  }
  if (!isTest && !isManual && (order.grandTotal || 0) < settings.minOrderAmount) return { skipped: true, reason: 'Below minimum amount' };
  if (!isTest && !isManual && !isWithinCallingHours(settings.callStartTime, settings.callEndTime)) return { deferred: true, reason: 'Outside calling hours' };
  const phone = formatBdPhone(order.customerPhone);
  if (!phone) return { success: false, error: 'Invalid Bangladesh phone number' };
  await prisma.messageLog.upsert({ where: { id: callId }, update: {}, create: {
    id: callId, recipient: phone, channel: 'IVR_CALL', eventTrigger: isTest ? order.id : isRetry ? 'RETRY_CALL' : 'ORDER_PLACED', status: 'QUEUED', body: 'IVR call queued', orderId: isTest ? null : order.id,
  } });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const payload = JSON.stringify({ callId, orderId: order.id, phone, amount: Math.round(order.grandTotal || 0), callerId: settings.callerId });
  const signature = crypto.createHmac('sha256', settings.apiKey).update(timestamp + '.' + payload).digest('hex');
  try {
    const response = await axios.post(settings.apiUrl.replace(/\/+$/, '') + '/api/call/dispatch', payload, {
      headers: { 'Content-Type': 'application/json', 'X-PBX-Signature': signature, 'X-PBX-Timestamp': timestamp, 'X-PBX-Signature-Version': '2', 'Idempotency-Key': callId }, timeout: 10000, maxRedirects: 0,
    });
    if (response.data?.success === false) throw new Error('PBX rejected call');
    // A callback may already have arrived; never overwrite its final result.
    await prisma.messageLog.updateMany({ where: { id: callId, status: 'QUEUED' }, data: { status: 'SENT', body: 'Call dispatched to PBX' } });
    return { success: true, data: response.data };
  } catch {
    await prisma.messageLog.updateMany({ where: { id: callId, status: 'QUEUED' }, data: { status: 'UNKNOWN', errorMessage: 'Dispatch failed or acknowledgement was lost; check PBX before redialing' } });
    return { success: false, error: 'Call dispatch could not be confirmed' };
  }
}
