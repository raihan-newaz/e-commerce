import { Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../../prisma';
import { logAudit } from '../audit/auditService';
import { notifyOrderStatus } from '../messaging/messageService';
import { getIvrConfig, dispatchIvrCall } from './ivrService';

function verifyWebhookSignature(payloadStr: string, signature: string, timestamp: string, secret: string): boolean {
  if (!signature || !timestamp || !secret) return false;
  const now = Math.floor(Date.now() / 1000);
  // Allow up to 5 minutes clock drift
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
    return false;
  }
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(payloadStr)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(signature));
  } catch {
    return false;
  }
}

export const handlePbxIvrWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const signature = String(req.headers['x-pbx-signature'] || '');
    const timestamp = String(req.headers['x-pbx-timestamp'] || '');

    const config = await getIvrConfig();

    // Raw body validation
    const rawBody = (req as any).rawBody ? (req as any).rawBody.toString('utf8') : JSON.stringify(req.body);

    if (!verifyWebhookSignature(rawBody, signature, timestamp, config.apiKey)) {
      res.status(401).json({ success: false, message: 'Invalid or expired signature' });
      return;
    }

    const { orderId, status: ivrStatus, phone } = req.body;

    if (!orderId || !ivrStatus) {
      res.status(400).json({ success: false, message: 'Missing orderId or status' });
      return;
    }

    // Handle test call webhooks
    if (String(orderId).startsWith('TEST-')) {
      const lastTestLog = await prisma.messageLog.findFirst({
        where: { recipient: phone, channel: 'IVR_CALL', eventTrigger: 'TEST_CALL' },
        orderBy: { createdAt: 'desc' }
      });
      if (lastTestLog) {
        await prisma.messageLog.update({
          where: { id: lastTestLog.id },
          data: {
            status: ivrStatus,
            body: `Test call ended with result: ${ivrStatus}`
          }
        }).catch(() => {});
      }
      res.status(200).json({ success: true, message: `Test call webhook handled: ${ivrStatus}` });
      return;
    }

    const order = await prisma.order.findUnique({
      where: { id: String(orderId) }
    });

    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    let newOrderStatus: string | null = null;
    let noteText = '';
    const timeStr = new Date().toLocaleString('en-GB', {
      timeZone: 'Asia/Dhaka',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });

    if (ivrStatus === 'CONFIRMED') {
      newOrderStatus = 'CONFIRMED';
      noteText = `[${timeStr}] [Automated IVR Call] Customer answered call on ${phone} and pressed 1 to CONFIRM order.`;
    } else if (ivrStatus === 'CANCELLED') {
      newOrderStatus = 'CANCELLED';
      noteText = `[${timeStr}] [Automated IVR Call] Customer answered call on ${phone} and pressed 2 to CANCEL order.`;
    } else if (ivrStatus === 'CALL_ENDED_NO_INPUT' || ivrStatus === 'INVALID_INPUT' || ivrStatus === 'NO_ANSWER' || ivrStatus === 'BUSY') {
      noteText = `[${timeStr}] [Automated IVR Call] Call to ${phone} ended with result: ${ivrStatus}.`;
    }

    // Update MessageLog
    const lastLog = await prisma.messageLog.findFirst({
      where: { orderId: order.id, channel: 'IVR_CALL' },
      orderBy: { createdAt: 'desc' }
    });
    if (lastLog) {
      await prisma.messageLog.update({
        where: { id: lastLog.id },
        data: {
          status: ivrStatus,
          body: noteText
        }
      }).catch(() => {});
    }

    // Handle automated retry if customer didn't answer or provide input
    const isUnanswered = ['CALL_ENDED_NO_INPUT', 'INVALID_INPUT', 'NO_ANSWER', 'BUSY'].includes(ivrStatus);

    if (isUnanswered && order.status === 'PENDING' && config.isEnabled) {
      const attempts = await prisma.messageLog.count({
        where: { orderId: order.id, channel: 'IVR_CALL' }
      });

      if (attempts < config.maxRetries) {
        const retryDelayMs = config.retryDelayMinutes * 60 * 1000;
        noteText += ` (Attempt ${attempts}/${config.maxRetries}. Retrying in ${config.retryDelayMinutes} min)`;

        setTimeout(() => {
          void dispatchIvrCall({
            id: order.id,
            customerPhone: order.customerPhone,
            grandTotal: order.grandTotal
          }, true).catch(err => console.error('[IVR-RETRY-ERROR]', err));
        }, retryDelayMs);
      } else {
        noteText += ` (Reached max retries: ${attempts}/${config.maxRetries}. Needs manual agent follow-up)`;
      }
    }

    const currentNotes = order.internalNote ? `${order.internalNote}\n${noteText}` : noteText;

    if (newOrderStatus && order.status === 'PENDING') {
      const updatedOrder = await prisma.order.update({
        where: { id: order.id },
        data: {
          status: newOrderStatus,
          internalNote: currentNotes,
          cancelledAt: newOrderStatus === 'CANCELLED' ? new Date() : undefined
        }
      });

      // Send SMS / WhatsApp order status notification if configured
      await notifyOrderStatus(updatedOrder).catch(() => {});

      // Log system audit
      await logAudit({
        action: 'STATUS_CHANGE',
        entity: 'ORDER',
        entityId: order.id,
        userId: 'SYSTEM_IVR',
        userName: 'Asterisk IVR Auto-Dialer',
        details: {
          from: order.status,
          to: newOrderStatus,
          reason: noteText,
          ivrStatus
        }
      }).catch(() => {});

      res.status(200).json({ success: true, message: `Order updated to ${newOrderStatus}`, orderId });
      return;
    }

    // Just record note if order wasn't PENDING
    await prisma.order.update({
      where: { id: order.id },
      data: { internalNote: currentNotes }
    });

    res.status(200).json({ success: true, message: 'Note recorded', orderId });
  } catch (error: any) {
    console.error('[PBX-WEBHOOK-ERROR]', error);
    res.status(500).json({ success: false, message: error.message || 'Webhook processing error' });
  }
};
