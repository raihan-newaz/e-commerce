import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../../prisma';
import { config } from '../../config';
import { dispatchIvrCall } from './ivrService';

// Existing MessageLog persistence keeps jobs across restarts without a schema migration.
export async function queueIvrCall(orderId: string, delayMinutes: number, key: string, retry = false, db: Prisma.TransactionClient = prisma) {
  const dedupeKey = `ivr-job:${key}`;
  return db.messageLog.upsert({ where: { dedupeKey }, update: {}, create: {
    channel: 'IVR_JOB', orderId, recipient: '', dedupeKey, status: 'PENDING',
    eventTrigger: retry ? 'RETRY_CALL' : 'ORDER_PLACED', body: JSON.stringify({ callId: crypto.randomUUID() }),
    createdAt: new Date(Date.now() + Math.max(0, Math.min(delayMinutes, 10080)) * 60000),
  } });
}

export function startIvrWorker() {
  let running = false;
  const timer = setInterval(() => {
    if (running || !config.integrationsEnabled) return;
    running = true;
    void (async () => {
      // Never blindly redial after an uncertain crash: flag for operator reconciliation.
      await prisma.messageLog.updateMany({ where: { channel: 'IVR_JOB', status: 'PROCESSING', createdAt: { lt: new Date(Date.now() - 120000) } }, data: { status: 'UNKNOWN', errorMessage: 'Worker interrupted; check PBX call before manual retry' } });
      const jobs = await prisma.messageLog.findMany({ where: { channel: 'IVR_JOB', status: 'PENDING', createdAt: { lte: new Date() } }, orderBy: { createdAt: 'asc' }, take: 10 });
      for (const job of jobs) {
        const claimed = await prisma.messageLog.updateMany({ where: { id: job.id, status: 'PENDING' }, data: { status: 'PROCESSING', createdAt: new Date() } });
        if (!claimed.count) continue;
        try {
          const { callId } = JSON.parse(job.body) as { callId: string };
          const result = job.orderId ? await dispatchIvrCall({ id: job.orderId, customerPhone: '' }, job.eventTrigger === 'RETRY_CALL', false, callId) : { skipped: true };
          await prisma.messageLog.update({ where: { id: job.id }, data: { status: 'deferred' in result && result.deferred ? 'PENDING' : 'success' in result && result.success ? 'SENT' : 'skipped' in result ? 'SKIPPED' : 'UNKNOWN', ...('deferred' in result && result.deferred ? { createdAt: new Date(Date.now() + 60000) } : {}) } });
        } catch {
          await prisma.messageLog.update({ where: { id: job.id }, data: { status: 'UNKNOWN', errorMessage: 'Job failed; review before retrying' } });
        }
      }
    })().catch(() => console.warn('IVR worker unavailable')).finally(() => { running = false; });
  }, 5000);
  timer.unref();
  return timer;
}
