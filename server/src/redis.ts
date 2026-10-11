import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 1,
  lazyConnect: true,
  retryStrategy: (times) => {
    if (times > 3) return null; // don't block server if Redis is down
    return Math.min(times * 200, 1000);
  },
});

let isRedisConnected = false;

redis.connect().then(() => {
  isRedisConnected = true;
  console.log('✅ Redis connected for database query caching');
}).catch((err) => {
  console.warn('⚠️ Redis connection failed, falling back to direct DB queries:', err.message);
});

redis.on('error', (err) => {
  isRedisConnected = false;
});

redis.on('connect', () => {
  isRedisConnected = true;
});

export async function getCache<T>(key: string): Promise<T | null> {
  if (!isRedisConnected) return null;
  try {
    const data = await redis.get(key);
    if (!data) return null;
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

export async function setCache(key: string, value: any, ttlSeconds = 60): Promise<void> {
  if (!isRedisConnected) return;
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {}
}

export async function invalidateCachePattern(pattern: string): Promise<void> {
  if (!isRedisConnected) return;
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch {}
}
