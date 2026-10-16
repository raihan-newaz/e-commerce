import { invalidateCourierCatalog, queueLocationSync } from './locationQueue';
import { availableCouriers } from './availability';
import { Request, Response } from 'express';
import prisma from '../../prisma';
import { callPathao } from './pathaoSession';
import { getSteadfastAdapter } from './steadfastSession';
import { getRedXAdapter } from './redxSession';

type Level = 'DISTRICT' | 'THANA' | 'AREA';
type Location = { provider: string; level: Level; externalId: string; parentExternalId?: string; name: string; normalizedName: string; districtName?: string; active?: boolean };
export const normalizeLocation = (value: string) => value.toLowerCase().normalize('NFKC').replace(/\b(district|zila|zilla)\b/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');

async function saveLocations(items: Location[]) {
  if (!items.length) throw new Error('Courier returned an empty location catalog. Existing locations were retained.');
  for (let i = 0; i < items.length; i += 5) {
    await Promise.all(items.slice(i, i + 5).map((item) => prisma.courierLocation.upsert({
      where: { provider_level_externalId: { provider: item.provider, level: item.level, externalId: item.externalId } },
      create: item,
      update: { parentExternalId: item.parentExternalId, name: item.name, normalizedName: item.normalizedName, districtName: item.districtName, active: item.active ?? true },
    })));
  }
  invalidateCourierCatalog();
  return items.length;
}

async function performSteadfastLocations() {
  const { adapter } = await getSteadfastAdapter();
  const result = await adapter.getPoliceStations();
  if (!result.success || !Array.isArray(result.data?.data)) throw new Error(!result.success ? result.message : 'Steadfast did not return districts and police stations');
  const items: Location[] = [];
  for (const district of result.data.data) {
    if (!district.id || !district.name) continue;
    const districtId = String(district.id);
    const districtName = String(district.name).trim();
    items.push({ provider: 'STEADFAST', level: 'DISTRICT', externalId: districtId, name: districtName, normalizedName: normalizeLocation(districtName), active: true });
    for (const station of district.policestations || []) {
      if (!station.id || !station.name || Number(station.status) === 0 || /^(test\b|null$|nul$)/i.test(String(station.name).trim())) continue;
      const name = String(station.name).trim();
      items.push({ provider: 'STEADFAST', level: 'THANA', externalId: String(station.id), parentExternalId: districtId, name, normalizedName: normalizeLocation(name), districtName, active: true });
    }
  }
  const count = await saveLocations(items);
  for (const level of ['DISTRICT','THANA'] as const) await prisma.courierLocation.updateMany({ where: { provider:'STEADFAST',level,externalId:{notIn:items.filter(item=>item.level===level).map(item=>item.externalId)} },data:{active:false} });
  await prisma.courierLocationSync.upsert({ where: { provider_level_parentKey: { provider: 'STEADFAST', level: 'DISTRICT', parentKey: '' } }, create: { provider: 'STEADFAST', level: 'DISTRICT', parentKey: '', itemCount: count }, update: { itemCount: count, syncedAt: new Date() } });
  return count;
}

async function performPathaoLocations(level: Level, parentId?: string) {
  if (level !== 'DISTRICT' && (!parentId || !/^\d+$/.test(parentId))) throw new Error('A Pathao parent location is required');
  const result = level === 'DISTRICT' ? await callPathao((adapter, token) => adapter.getCities(token)) :
    level === 'THANA' ? await callPathao((adapter, token) => adapter.getZones(Number(parentId), token)) :
      await callPathao((adapter, token) => adapter.getAreas(Number(parentId), token));
  if (!result.success || !Array.isArray(result.data)) throw new Error(`${!result.success ? result.message : 'Pathao location lookup failed'}${!result.success && result.status ? ` (HTTP ${result.status})` : ''}`);
  const idKey = level === 'DISTRICT' ? 'city_id' : level === 'THANA' ? 'zone_id' : 'area_id';
  const nameKey = level === 'DISTRICT' ? 'city_name' : level === 'THANA' ? 'zone_name' : 'area_name';
  const items = result.data.filter((entry: any) => entry[idKey] && entry[nameKey]).map((entry: any) => {
    const name = String(entry[nameKey]).trim();
    return { provider: 'PATHAO', level, externalId: String(entry[idKey]), parentExternalId: parentId, name, normalizedName: normalizeLocation(name), active: entry.home_delivery_available !== false };
  });
  const count = await saveLocations(items);
  await prisma.courierLocation.updateMany({ where: { provider: 'PATHAO', level, externalId:{notIn:items.map(item=>item.externalId)}, ...(level !== 'DISTRICT' ? { parentExternalId: parentId } : {}) }, data: { active:false } });
  await prisma.courierLocationSync.upsert({ where: { provider_level_parentKey: { provider: 'PATHAO', level, parentKey: parentId || '' } }, create: { provider: 'PATHAO', level, parentKey: parentId || '', itemCount: count }, update: { itemCount: count, syncedAt: new Date() } });
  return count;
}

async function performRedXAreas() {
  const { adapter } = await getRedXAdapter();
  const result = await adapter.getAreas();
  if (!result.success) throw new Error(result.message || 'RedX areas are unavailable');
  const items: Location[] = result.data.filter(area => Number.isInteger(area.id) && area.id > 0 && area.name).map(area => ({
    provider: 'REDX', level: 'AREA', externalId: String(area.id), name: String(area.name).trim(),
    normalizedName: normalizeLocation(String(area.name)), districtName: String(area.division_name || '').trim() || undefined,
    active: true,
  }));
  const count = await saveLocations(items);
  await prisma.courierLocation.updateMany({ where:{provider:'REDX',level:'AREA',externalId:{notIn:items.map(item=>item.externalId)}},data:{active:false} });
  await prisma.courierLocationSync.upsert({ where: { provider_level_parentKey: { provider: 'REDX', level: 'AREA', parentKey: '' } },
    create: { provider: 'REDX', level: 'AREA', parentKey: '', itemCount: count }, update: { itemCount: count, syncedAt: new Date() } });
  return count;
}

export const syncSteadfastLocations = (force = false) => queueLocationSync('STEADFAST', performSteadfastLocations, force);
export const syncRedXAreas = (force = false) => queueLocationSync('REDX', performRedXAreas, force);
export const syncPathaoLocations = (level: Level, parentId?: string, force = false) => queueLocationSync('PATHAO:'+level+':'+(parentId || ''), () => performPathaoLocations(level,parentId), force);
const resultCache = new Map<string,{ at: number; rows: unknown[] }>();
const reads = new Map<string,Promise<unknown[]>>();

export const listCourierLocations = async (req: Request, res: Response): Promise<void> => {
  const provider = String(req.params.provider || '').toUpperCase();
  const level = String(req.query.level || '').toUpperCase() as Level;
  const parentId = typeof req.query.parentId === 'string' ? req.query.parentId : undefined;
  if (!['STEADFAST', 'PATHAO', 'REDX'].includes(provider) || !['DISTRICT', 'THANA', 'AREA'].includes(level) || (provider === 'REDX' && level !== 'AREA') || (provider !== 'REDX' && level !== 'DISTRICT' && !parentId)) {
    res.status(400).json({ success: false, message: 'Choose a provider, location level and parent' }); return;
  }
  if (provider === 'STEADFAST' && level === 'AREA') { res.json({ success: true, locations: [] }); return; }
  try {
    const readiness = (await availableCouriers()).find(item => item.provider === provider);
    if (!readiness?.ready) { res.status(409).json({ success:false, message: provider+' is not completely configured and enabled' }); return; }
    const key = provider+':'+level+':'+(parentId || '');
    const cached = resultCache.get(key);
    if (cached && Date.now()-cached.at < 300_000) { res.json({ success:true,locations:cached.rows }); return; }
    let read = reads.get(key);
    if (!read) { read = (async () => {
    const where = { provider, level, active: true, ...(level !== 'DISTRICT' && provider !== 'REDX' ? { parentExternalId: parentId } : {}) };
    let locations = await prisma.courierLocation.findMany({ where, orderBy: { name: 'asc' }, take: provider === 'REDX' ? 10000 : 2000 });
    const synced = await prisma.courierLocationSync.findUnique({ where: { provider_level_parentKey: { provider, level, parentKey: level === 'DISTRICT' || provider === 'REDX' ? '' : parentId || '' } } });
    if (!locations.length || !synced) {
      try {
      if (provider === 'STEADFAST') await syncSteadfastLocations();
      else if (provider === 'REDX') await syncRedXAreas();
      else await syncPathaoLocations(level, parentId);
      } catch (error) { if (!locations.length) throw error; }
      locations = await prisma.courierLocation.findMany({ where, orderBy: { name: 'asc' }, take: provider === 'REDX' ? 10000 : 2000 });
    }
      if (resultCache.size >= 512) resultCache.delete(resultCache.keys().next().value!);
      resultCache.set(key,{ at:Date.now(),rows:locations });
      return locations;
    })().finally(() => { reads.delete(key); }); reads.set(key,read); }
    const locations = await read;
    res.json({ success: true, locations });
  } catch (error: any) { res.setHeader('Retry-After','60'); res.status(503).json({ success: false, message: error.message }); }
};

export const refreshCourierLocations = async (req: Request, res: Response): Promise<void> => {
  const provider = String(req.params.provider || '').toUpperCase();
  const level = String(req.body?.level || 'DISTRICT').toUpperCase() as Level;
  const parentId = req.body?.parentId ? String(req.body.parentId) : undefined;
  try {
    const count = provider === 'STEADFAST' ? await syncSteadfastLocations(true) : provider === 'REDX' && level === 'AREA' ? await syncRedXAreas(true) : provider === 'PATHAO' && ['DISTRICT', 'THANA', 'AREA'].includes(level) ? await syncPathaoLocations(level, parentId, true) : null;
    if (count === null) { res.status(400).json({ success: false, message: 'Unsupported location provider or level' }); return; }
    for (const key of resultCache.keys()) if (key.startsWith(provider+':')) resultCache.delete(key);
    res.json({ success: true, count });
  } catch (error: any) { res.status(503).json({ success: false, message: error.message }); }
};
