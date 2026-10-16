// One sync at a time per server process. Catalog data survives restarts in the
// existing CourierLocation tables; repeated jobs share the same promise.
const pending = new Map<string, Promise<unknown>>();
const failures = new Map<string, { error: Error; until: number }>();
let tail: Promise<unknown> = Promise.resolve();
export let courierCatalogGeneration = 0;
export const invalidateCourierCatalog = () => { courierCatalogGeneration++; };
export const pendingLocationJobs = (prefix: string) => [...pending.keys()].some(key => key.startsWith(prefix));
export function queueLocationSync<T>(key: string, work: () => Promise<T>, force = false): Promise<T> {
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;
  const failure = failures.get(key);
  if (!force && failure && failure.until > Date.now()) return Promise.reject(failure.error);
  if (pending.size >= 100) return Promise.reject(new Error('Courier location queue is busy. Please retry shortly.'));
  const job = tail.then(work).then(value => { failures.delete(key); return value; }, error => {
    const failure = error instanceof Error ? error : new Error('Courier location lookup failed');
    if (failures.size >= 1000) failures.delete(failures.keys().next().value!);
    failures.set(key, { error: failure, until: Date.now() + 60_000 });
    throw failure;
  }).finally(() => { pending.delete(key); });
  pending.set(key, job);
  tail = job.catch(() => undefined);
  return job;
}
