import { Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import prisma from '../../prisma';
import { config as appConfig } from '../../config';
import { notifyOrderStatus } from '../messaging/messageService';
import { getIvrConfig, formatBdPhone } from './ivrService';
import { queueIvrCall } from './ivrJobs';
import { transitionOrder } from './orderTransition';
import { appendOrderNote } from './orderNotes';

export function verifyWebhookSignature(body: string, signature: string, timestamp: string, secret: string): boolean {
  if (!secret || !/^\d{10}$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

const eventSchema = z.object({
  callId: z.string().min(1).max(100), orderId: z.string().min(1).max(100), phone: z.string().min(1).max(30),
  status: z.enum(['CONFIRMED', 'CANCELLED', 'CALL_ENDED_NO_INPUT', 'INVALID_INPUT', 'NO_ANSWER', 'BUSY']),
});

export const handlePbxIvrWebhook = async (req: Request, res: Response): Promise<void> => {
  if (!appConfig.integrationsEnabled) { res.status(503).json({ success: false, message: 'Integrations are disabled' }); return; }
  try {
    const settings = await getIvrConfig();
    const body = (req as Request & { rawBody?: Buffer }).rawBody?.toString('utf8');
    if (!body || !verifyWebhookSignature(body, String(req.headers['x-pbx-signature'] || ''), String(req.headers['x-pbx-timestamp'] || ''), settings.apiKey)) {
      res.status(401).json({ success: false, message: 'Invalid or expired signature' }); return;
    }
    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ success: false, message: 'Invalid IVR event' }); return; }
    const event = parsed.data;
    const result = await prisma.$transaction(async tx => {
      // The app-generated callId binds callbacks to one dispatch, recipient and order.
      await tx.$queryRaw`SELECT id FROM MessageLog WHERE id = ${event.callId} FOR UPDATE`;
      const call = await tx.messageLog.findUnique({ where: { id: event.callId } });
      if (!call || call.channel !== 'IVR_CALL' || call.recipient !== formatBdPhone(event.phone) ||
        (event.orderId.startsWith('TEST-') ? call.eventTrigger !== event.orderId : call.orderId !== event.orderId)) {
        throw Object.assign(new Error('Call not found'), { status: 404 });
      }
      const dedupeKey = `ivr-result:${event.callId}`;
      if (await tx.messageLog.findUnique({ where: { dedupeKey } })) return null;
      await tx.messageLog.create({ data: { channel: 'IVR_RECEIPT', recipient: call.recipient, orderId: call.orderId, dedupeKey, status: event.status, body: 'Final call result accepted' } });
      const time = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', hour12: true });
      const note = `[${time}] [Automated IVR Call] [call:${call.id}] ${event.status} (${call.recipient})`;
      await tx.messageLog.update({ where: { id: call.id }, data: { status: event.status, body: note } });
      const callStatus = event.status === 'NO_ANSWER' ? 'MISSED' : event.status === 'BUSY' ? 'BUSY' : ['CONFIRMED', 'CANCELLED', 'CALL_ENDED_NO_INPUT', 'INVALID_INPUT'].includes(event.status) ? 'COMPLETED' : 'FAILED';
      await tx.callLog.upsert({
        where: { providerCallId: `IVR:${call.id}` },
        create: { providerCallId: `IVR:${call.id}`, orderId: call.orderId, phone: call.recipient, direction: 'OUTBOUND', source: 'IVR', status: callStatus, disposition: event.status, agentName: 'Automated IVR', startedAt: call.createdAt, endedAt: new Date() },
        update: { status: callStatus, disposition: event.status, endedAt: new Date() },
      });
      if (!call.orderId) return null;
      await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${call.orderId} FOR UPDATE`;
      const order = await tx.order.findUnique({ where: { id: call.orderId }, include: { items: true } });
      if (!order || order.trashedAt) return null;
      let updated = null;
      if (order.status === 'PENDING' && ['CONFIRMED', 'CANCELLED'].includes(event.status) &&
        (order.riskReviewStatus !== 'REVIEW_REQUIRED' || event.status === 'CANCELLED')) {
        updated = await transitionOrder(tx, order, event.status);
        await tx.auditLog.create({ data: { action: 'STATUS_CHANGE', entity: 'ORDER', entityId: order.id, userName: 'Asterisk IVR', details: JSON.stringify({ from: order.status, to: event.status, callId: call.id }) } });
      } else if (order.status === 'PENDING' && settings.isEnabled && !['CONFIRMED', 'CANCELLED'].includes(event.status)) {
        const attempts = await tx.messageLog.count({ where: { orderId: order.id, channel: 'IVR_CALL' } });
        if (attempts <= settings.maxRetries) await queueIvrCall(order.id, settings.retryDelayMinutes, `retry:${call.id}`, true, tx);
      }
      await appendOrderNote(tx, order.id, note);
      return updated;
    });
    if (result) void notifyOrderStatus(result).catch(() => console.warn('IVR status notification failed'));
    res.json({ success: true });
  } catch (error) {
    const status = error instanceof Error && 'status' in error ? Number(error.status) : 500;
    res.status(status).json({ success: false, message: status === 404 ? 'Call not found' : 'Unable to process IVR result' });
  }
};
