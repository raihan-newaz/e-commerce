import api from './api';
import type { AxiosResponse } from 'axios';

export type CourierProvider = 'STEADFAST' | 'PATHAO' | 'REDX';
type Catalog = AxiosResponse<{ success: boolean; locations: Array<{ id: string; externalId: string; name: string; normalizedName: string; active: boolean; districtName?: string }> }>;
const cache = new Map<string, { expires: number; response: Catalog }>();
const inflight = new Map<string, Promise<Catalog>>();
let tail: Promise<unknown> = Promise.resolve();
export function courierLocations(url: string): Promise<Catalog> {
  const saved = cache.get(url);
  if (saved && saved.expires > Date.now()) return Promise.resolve(saved.response);
  const pending = inflight.get(url);
  if (pending) return pending;
  // Serialize lookups in this browser and share responses between details,
  // dispatch and edit forms. Failed lookups are never cached as valid data.
  const request = tail.then(() => api.get(url)).then(response => {
    if (cache.size >= 512) cache.delete(cache.keys().next().value!);
    cache.set(url, { expires: Date.now() + 300_000, response });
    return response;
  }).finally(() => { inflight.delete(url); });
  inflight.set(url, request);
  tail = request.catch(() => undefined);
  return request;
}
let availability: { at: number; values: CourierProvider[] } | undefined;
let readiness: Promise<CourierProvider[]> | undefined;
window.addEventListener('nix:courier-config-updated', () => { availability = undefined; cache.clear(); });
export function readyCouriers(): Promise<CourierProvider[]> {
  if (availability && Date.now() - availability.at < 30_000) return Promise.resolve(availability.values);
  if (!readiness) readiness = api.get('/couriers/availability').then(({ data }) => {
    const values = (data.providers || []).filter((provider: { ready: boolean }) => provider.ready).map((provider: { provider: CourierProvider }) => provider.provider);
    availability = { at: Date.now(), values };
    return values;
  }).finally(() => { readiness = undefined; });
  return readiness!;
}
