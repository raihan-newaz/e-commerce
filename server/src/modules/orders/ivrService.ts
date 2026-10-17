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

  return {
    apiUrl: record?.apiUrl || process.env.PBX_IVR_URL || 'http://103.169.160.153:7088',
    apiKey,
    callerId: record?.senderId || '09639139179',
    isEnabled: record ? record.isEnabled : (process.env.PBX_IVR_ENABLED !== 'false'),
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

    return currentTotal >= startTotal && currentTotal <= endTotal;
  } catch {
    return true;
  }
}

export async function dispatchIvrCall(order: { id: string; customerPhone: string; grandTotal?: number }, isRetry = false, isManual = false) {
  const config = await getIvrConfig();
  const isTest = order.id.startsWith('TEST-');

  if (!config.isEnabled && !isTest && !isManual) {
    return { skipped: true, reason: 'PBX IVR calling is disabled in settings' };
  }

  if (!isTest && !isManual && config.minOrderAmount > 0 && (order.grandTotal || 0) < config.minOrderAmount) {
    return { skipped: true, reason: `Order total ৳${order.grandTotal} is below minimum threshold ৳${config.minOrderAmount}` };
  }

  // Active hours check (only applies to automated customer orders, admin manual calls and test calls can be dialed anytime)
  if (!isTest && !isManual && !isWithinCallingHours(config.callStartTime, config.callEndTime)) {
    return { skipped: true, reason: `Outside allowed IVR calling hours (${config.callStartTime} - ${config.callEndTime} Asia/Dhaka)` };
  }

  const phone = formatBdPhone(order.customerPhone);
  if (!phone) {
    return { success: false, error: 'Invalid Bangladesh phone number for IVR call' };
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const payload = {
    orderId: order.id,
    phone,
    amount: Math.round(order.grandTotal || 0),
    callerId: config.callerId
  };
  const payloadStr = JSON.stringify(payload);

  const signature = crypto
    .createHmac('sha256', config.apiKey)
    .update(payloadStr)
    .digest('hex');

  // Create message log
  const isRealOrder = !order.id.startsWith('TEST-');
  let logId: string | null = null;
  try {
    const createdLog = await prisma.messageLog.create({
      data: {
        recipient: phone,
        channel: 'IVR_CALL',
        eventTrigger: isRetry ? 'RETRY_CALL' : (order.id.startsWith('TEST-') ? 'TEST_CALL' : 'ORDER_PLACED'),
        status: 'QUEUED',
        body: `IVR call queued for ${order.id}. Caller ID: ${config.callerId}, Amount: ৳${Math.round(order.grandTotal || 0)}`,
        orderId: isRealOrder ? order.id : null,
      }
    });
    logId = createdLog.id;
  } catch (e) {
    console.error('[IVR-LOG-CREATE-ERROR]', e);
  }

  try {
    const response = await axios.post(`${config.apiUrl.replace(/\/+$/, '')}/api/call/dispatch`, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-PBX-Signature': signature,
        'X-PBX-Timestamp': String(timestamp)
      },
      timeout: 10000
    });

    if (logId) {
      await prisma.messageLog.update({
        where: { id: logId },
        data: {
          status: 'SENT',
          body: `Call dispatched to Asterisk PBX. Call ID: ${response.data?.callId || 'ok'}`
        }
      }).catch(() => {});
    }

    return { success: true, data: response.data };
  } catch (error: any) {
    const errorMsg = error.response?.data?.error || error.response?.data?.message || error.message;
    console.error(`[IVR-DISPATCH-ERROR] Order ${order.id}:`, errorMsg);

    if (logId) {
      await prisma.messageLog.update({
        where: { id: logId },
        data: {
          status: 'FAILED',
          errorMessage: errorMsg,
          body: `Failed to dispatch call: ${errorMsg}`
        }
      }).catch(() => {});
    }

    return { success: false, error: errorMsg };
  }
}
