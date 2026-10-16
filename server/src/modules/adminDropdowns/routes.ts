import { Router, type Response, type NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../../prisma';
import { authenticateToken, requireRole, type AuthRequest } from '../../middlewares/auth';
import catalog from './catalog.json';
import { logAudit } from '../audit/auditService';

const router = Router();
const wrap = (fn: (req: AuthRequest, res: Response) => Promise<void>) => (req: AuthRequest, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
const entrySchema = z.object({ value: z.string().max(500), label: z.string().trim().min(1).max(160), mapsTo: z.string().max(500), hidden: z.boolean().default(false), deleted: z.boolean().default(false) });
const baseSchema = z.object({ value: z.string().max(500), label: z.string().max(160) });
const payloadSchema = z.object({ version: z.number().int().min(0), baseOptions: z.array(baseSchema).max(500), entries: z.array(entrySchema).max(500) });
type Stored = { baseOptions: z.infer<typeof baseSchema>[]; entries: z.infer<typeof entrySchema>[] };
const known = new Set(catalog.map(item => item.key));
const fail = (status: number, message: string) => Object.assign(new Error(message), { status });

// A mapped option shares the existing stored code. Count that code across live
// scalar fields, including soft-deleted orders and references to linked records.
// Labels/aliases never introduce new enum values into business endpoints.
async function usageCount(tx: Prisma.TransactionClient, value: string): Promise<number> {
  if (!value) return 0;
  const uuid = /^[\da-f]{8}-[\da-f-]{27}$/i.test(value);
  let count = 0;
  for (const model of Prisma.dmmf.datamodel.models) {
    if (['AdminDropdownConfig', 'AuditLog', 'OrderRiskEvent', 'MessageLog', 'EmailDelivery', 'BuilderRevision', 'BuilderSnapshot'].includes(model.name)) continue;
    const fields = model.fields.filter(field => !field.isList && (field.kind === 'enum' || field.type === 'String') &&
      (uuid ? field.name === 'id' || /Id$/.test(field.name) : true));
    const delegate = (tx as any)[model.name[0].toLowerCase() + model.name.slice(1)];
    // Prisma validates enum values, so only query fields that accept this code.
    const allowed = fields.filter(field => field.kind !== 'enum' || Prisma.dmmf.datamodel.enums.find(item => item.name === field.type)?.values.some(item => item.name === value));
    if (allowed.length) count += await delegate.count({ where: { OR: allowed.map(field => ({ [field.name]: value })) } });
    const jsonFields = model.fields.filter(field => field.type === 'Json' || field.type === 'String' && ['themeConfig', 'blocks', 'draft', 'published', 'document', 'checkoutDraft', 'attributes', 'fields', 'options', 'settings', 'data'].includes(field.name));
    if (jsonFields.length) {
      const table = model.dbName || model.name;
      const pattern = value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      // Identifiers are taken exclusively from the generated Prisma schema.
      const conditions = jsonFields.map(field => `JSON_SEARCH(IF(JSON_VALID(\`${field.dbName || field.name}\`), \`${field.dbName || field.name}\`, JSON_OBJECT()), 'one', ?) IS NOT NULL`);
      const rows = await tx.$queryRawUnsafe<Array<{ total: bigint }>>(`SELECT COUNT(*) AS total FROM \`${table}\` WHERE ${conditions.join(' OR ')}`, ...jsonFields.map(() => pattern));
      count += Number(rows[0]?.total || 0);
    }
  }
  return count;
}

router.use(authenticateToken);
router.get('/', wrap(async (_req, res) => {
  const rows = await prisma.adminDropdownConfig.findMany();
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, catalog, configs: Object.fromEntries(rows.map(row => [row.key, { ...(row.options as unknown as Stored), version: row.version }])) });
}));
router.put('/:key', requireRole(['SUPER_ADMIN']), wrap(async (req, res) => {
  const key = String(req.params.key);
  if (!known.has(key)) throw fail(404, 'Unknown dropdown');
  const input = payloadSchema.parse(req.body);
  if (new Set(input.entries.map(entry => entry.value)).size !== input.entries.length) throw fail(400, 'Option IDs must be unique');
  const base = new Set(input.baseOptions.map(option => option.value));
  for (const entry of input.entries) if (!base.has(entry.mapsTo)) throw fail(400, 'Map each option to an existing supported value');
  const result = await prisma.$transaction(async tx => {
    const current = await tx.adminDropdownConfig.findUnique({ where: { key } });
    if ((current?.version || 0) !== input.version) throw fail(409, 'Another administrator updated this dropdown. Reload before saving.');
    const previous = current?.options as unknown as Stored | undefined;
    // Removing or remapping an entry through PUT must enforce the same rule as
    // Delete, so the protection cannot be bypassed by editing the request body.
    const prior = previous?.entries || input.baseOptions.map(option => ({ ...option, mapsTo: option.value, deleted: false, hidden: false }));
    for (const entry of prior) {
      const next = input.entries.find(item => item.value === entry.value);
      if (!entry.deleted && (!next || next.deleted || next.mapsTo !== entry.mapsTo) && await usageCount(tx, entry.mapsTo)) {
        throw fail(409, `“${entry.label}” is in use. Remove its usage before deleting or remapping it.`);
      }
    }
    const options = { baseOptions: input.baseOptions, entries: input.entries } as unknown as Prisma.InputJsonValue;
    if (current) {
      const updated = await tx.adminDropdownConfig.updateMany({ where: { key, version: input.version }, data: { options, version: { increment: 1 } } });
      if (!updated.count) throw fail(409, 'Another administrator updated this dropdown. Reload before saving.');
      return { version: input.version + 1, baseOptions: input.baseOptions, entries: input.entries };
    }
    const created = await tx.adminDropdownConfig.create({ data: { key, options } });
    return { version: created.version, baseOptions: input.baseOptions, entries: input.entries };
  }).catch(error => { if (error.code === 'P2002') throw fail(409, 'Another administrator updated this dropdown. Reload before saving.'); throw error; });
  await logAudit({ userId: req.user?.id, userName: req.user?.name, action: 'UPDATE', entity: 'SETTING', entityId: key, details: { adminDropdown: true, optionCount: input.entries.length }, ipAddress: req.ip });
  res.json({ success: true, config: result });
}));
router.get('/:key/usage', requireRole(['SUPER_ADMIN']), wrap(async (req, res) => {
  if (!known.has(String(req.params.key))) throw fail(404, 'Unknown dropdown');
  const value = z.string().max(500).parse(req.query.value);
  const count = await prisma.$transaction(tx => usageCount(tx, value));
  res.json({ success: true, count });
}));
export default router;
