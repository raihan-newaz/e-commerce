import { createHash } from 'node:crypto';
import { courierCatalogGeneration, queueLocationSync } from './locationQueue';
import prisma from '../../prisma';
import { normalizeLocation } from './courierLocations';

export type CourierProvider = 'STEADFAST' | 'PATHAO' | 'REDX';
export type LocationInput = { customerAddress: string; district?: string | null; city?: string | null; zone?: string | null; area?: string | null };
type LocationRow = { id: string; provider: string; level: string; externalId: string; parentExternalId: string | null; name: string; districtName?: string | null; active: boolean };
type AliasRow = { locationId: string; normalizedAlias: string };
type Match = { districtExternalId?: string; thanaExternalId?: string; areaExternalId?: string; areaName?: string; source: 'AUTO' | 'UNRESOLVED' };

const hasPhrase = (haystack: string, phrase: string) => Boolean(phrase && ` ${haystack} `.includes(` ${phrase} `));

function uniqueMatch(rows: LocationRow[], aliases: Map<string, string[]>, hints: Array<string | null | undefined>, address: string) {
  const exactHints = hints.map(value => normalizeLocation(value || '')).filter(Boolean);
  for (const hint of exactHints) {
    const found = rows.filter(row => (aliases.get(row.id) || []).includes(hint));
    if (found.length === 1) return found[0];
    if (found.length > 1) return undefined;
  }
  const normalizedAddress = normalizeLocation(address);
  const found = rows.filter(row => (aliases.get(row.id) || []).some(alias => alias.length >= 3 && hasPhrase(normalizedAddress, alias)));
  return found.length === 1 ? found[0] : undefined;
}

let matchCatalog: { generation:number; expires:number; locations: LocationRow[]; aliases: AliasRow[] } | undefined;
let matchRead: Promise<[LocationRow[],AliasRow[]]> | undefined;
export async function suggestCourierLocations(input: LocationInput): Promise<Record<CourierProvider, Match>> {
  if (matchCatalog && matchCatalog.generation===courierCatalogGeneration && matchCatalog.expires>Date.now()) return matchCourierLocations(input,matchCatalog.locations,matchCatalog.aliases);
  if (!matchRead) matchRead = Promise.all([
    prisma.courierLocation.findMany({ where: { provider: { in: ['STEADFAST', 'PATHAO', 'REDX'] }, active: true }, select: { id: true, provider: true, level: true, externalId: true, parentExternalId: true, name: true, districtName: true, active: true } }),
    prisma.courierLocationAlias.findMany({ select: { locationId: true, normalizedAlias: true } }),
  ]).finally(()=>{matchRead=undefined;});
  const [locations,aliases] = await matchRead;
  matchCatalog={generation:courierCatalogGeneration,expires:Date.now()+30_000,locations,aliases};
  return matchCourierLocations(input, locations, aliases);
}

export function matchCourierLocations(input: LocationInput, locations: LocationRow[], aliases: AliasRow[]): Record<CourierProvider, Match> {
  const names = new Map<string, string[]>();
  for (const row of locations) names.set(row.id, [normalizeLocation(row.name)]);
  for (const alias of aliases) if (names.has(alias.locationId)) names.get(alias.locationId)!.push(alias.normalizedAlias);
  const result = {} as Record<CourierProvider, Match>;
  for (const provider of ['STEADFAST', 'PATHAO', 'REDX'] as const) {
    const own = locations.filter(row => row.provider === provider);
    const districtRows = own.filter(row => row.level === 'DISTRICT');
    const thanaRows = own.filter(row => row.level === 'THANA');
    const areaRows = own.filter(row => row.level === 'AREA');
    let district = uniqueMatch(districtRows, names, [input.district, input.city], input.customerAddress);
    let thana = uniqueMatch(thanaRows.filter(row => !district || row.parentExternalId === district.externalId), names, [input.zone], input.customerAddress);
    let redxAreas = areaRows;
    if (provider === 'REDX') {
      const divisionHints = [input.zone, input.city].map(value => normalizeLocation(value || '')).filter(Boolean);
      const divisionMatched = redxAreas.filter(row => row.districtName && divisionHints.includes(normalizeLocation(row.districtName)));
      if (divisionMatched.length) redxAreas = divisionMatched;
    }
    const area = uniqueMatch(provider === 'REDX' ? redxAreas : areaRows.filter(row => !thana || row.parentExternalId === thana.externalId), names, [input.area], input.customerAddress);
    if (provider === 'PATHAO' && area && !thana) thana = thanaRows.find(row => row.externalId === area.parentExternalId);
    if (thana && !district) district = districtRows.find(row => row.externalId === thana.parentExternalId);
    const valid = provider === 'REDX' ? Boolean(area) : provider === 'PATHAO' ? Boolean(district && thana && (!area || area.parentExternalId === thana.externalId)) : Boolean(district && thana);
    result[provider] = valid ? {
      districtExternalId: district?.externalId,
      thanaExternalId: thana?.externalId,
      areaExternalId: area?.externalId,
      areaName: provider === 'STEADFAST' ? input.area?.trim() || undefined : area?.name,
      source: 'AUTO',
    } : { source: 'UNRESOLVED' };
  }
  return result;
}

async function performOrderCourierSuggestions(orderId: string, input: LocationInput, preserveManual = true) {
  const suggestions = await suggestCourierLocations(input);
  await prisma.$transaction(async tx => {
    for (const provider of ['STEADFAST', 'PATHAO', 'REDX'] as const) {
      const existing = await tx.orderCourierLocation.findUnique({ where: { orderId_provider: { orderId, provider } } });
      if (preserveManual && existing?.source === 'MANUAL') continue;
      const match = suggestions[provider];
      await tx.orderCourierLocation.upsert({ where: { orderId_provider: { orderId, provider } }, create: { orderId, provider, ...match }, update: { districtExternalId: match.districtExternalId || null, thanaExternalId: match.thanaExternalId || null, areaExternalId: match.areaExternalId || null, areaName: match.areaName || null, source: match.source } });
    }
  });
  return suggestions;
}

export async function validateCourierSelection(provider: CourierProvider, districtExternalId?: string | null, thanaExternalId?: string | null, areaExternalId?: string | null) {
  const selected = await prisma.courierLocation.findMany({ where: { provider, active: true, OR: [
    ...(districtExternalId ? [{ level: 'DISTRICT', externalId: districtExternalId }] : []),
    ...(thanaExternalId ? [{ level: 'THANA', externalId: thanaExternalId }] : []),
    ...(areaExternalId ? [{ level: 'AREA', externalId: areaExternalId }] : []),
  ] } });
  const district = selected.find(row => row.level === 'DISTRICT' && row.externalId === districtExternalId);
  const thana = selected.find(row => row.level === 'THANA' && row.externalId === thanaExternalId);
  const area = selected.find(row => row.level === 'AREA' && row.externalId === areaExternalId);
  if (provider === 'REDX') return Boolean(area);
  if (provider === 'PATHAO' && (!district || !thana)) return false;
  if ((districtExternalId && !district) || (thanaExternalId && (!thana || thana.parentExternalId !== districtExternalId)) || (areaExternalId && (!area || area.parentExternalId !== thanaExternalId))) return false;
  return true;
}

export function saveOrderCourierSuggestions(orderId: string, input: LocationInput, preserveManual = true) {
  const fingerprint = createHash('sha256').update(JSON.stringify([input.customerAddress,input.district,input.city,input.zone,input.area,preserveManual])).digest('hex');
  return queueLocationSync('MATCH:'+orderId+':'+fingerprint, () => performOrderCourierSuggestions(orderId,input,preserveManual));
}
