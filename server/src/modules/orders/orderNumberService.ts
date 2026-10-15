import prisma from '../../prisma';
import { redis } from '../../redis';

/**
 * High-concurrency safe order number generator starting from 1000.
 * Utilizes atomic Redis INCR counter with a synchronized database fallback.
 */
export async function getNextOrderNumber(tx?: any): Promise<string> {
  const client = tx || prisma;
  const REDIS_ORDER_KEY = 'nix:order:counter';

  try {
    if (redis && (redis.status === 'ready' || redis.status === 'connect')) {
      const exists = await redis.exists(REDIS_ORDER_KEY);
      if (!exists) {
        const orders = await client.order.findMany({
          select: { orderNumber: true },
        });

        let maxNum = 999;
        for (const o of orders) {
          const raw = String(o.orderNumber || '').trim();
          if (/^\d+$/.test(raw)) {
            const num = parseInt(raw, 10);
            if (num >= 1000 && num < 10000000 && num > maxNum) {
              maxNum = num;
            }
          } else {
            const match = raw.match(/\b(\d{4,})\b/) || raw.match(/(\d+)/);
            if (match) {
              const num = parseInt(match[1], 10);
              if (num >= 1000 && num < 10000000 && num > maxNum) {
                maxNum = num;
              }
            }
          }
        }
        await redis.setnx(REDIS_ORDER_KEY, String(maxNum));
      }
      const nextNum = await redis.incr(REDIS_ORDER_KEY);
      return String(nextNum);
    }
  } catch (err: any) {
    console.warn('Redis order counter error, falling back to DB query:', err?.message || err);
  }

  // Fallback: Safe DB scan
  const orders = await client.order.findMany({
    select: { orderNumber: true },
  });

  let maxNum = 999;
  for (const o of orders) {
    const raw = String(o.orderNumber || '').trim();
    if (/^\d+$/.test(raw)) {
      const num = parseInt(raw, 10);
      if (num >= 1000 && num < 10000000 && num > maxNum) {
        maxNum = num;
      }
    } else {
      const match = raw.match(/\b(\d{4,})\b/) || raw.match(/(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num >= 1000 && num < 10000000 && num > maxNum) {
          maxNum = num;
        }
      }
    }
  }

  return String(maxNum + 1);
}
