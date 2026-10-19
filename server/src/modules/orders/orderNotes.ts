import { Prisma } from '@prisma/client';
import { Response } from 'express';
import prisma from '../../prisma';
import { AuthRequest } from '../../middlewares/auth';

export async function appendOrderNote(tx: Prisma.TransactionClient, id: string, text: string) {
  await tx.$executeRaw`UPDATE \`Order\` SET internalNote = CONCAT(COALESCE(internalNote, ''), IF(COALESCE(internalNote, '') = '', '', '\n'), ${text}), updatedAt = ${new Date()} WHERE id = ${id}`;
}

export async function addOrderNote(req: AuthRequest, res: Response): Promise<void> {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text || text.length > 2000) { res.status(400).json({ success: false, message: 'Enter a note of 1–2000 characters' }); return; }
  const id = String(req.params.id);
  try {
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${id} FOR UPDATE`;
      const order = await tx.order.findUnique({ where: { id } });
      if (!order || order.trashedAt) throw Object.assign(new Error('Order unavailable'), { status: 404 });
      const time = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', hour12: true });
      await appendOrderNote(tx, id, `[${time}] ${req.user?.name || 'Staff'}: ${text}`);
      await tx.auditLog.create({ data: { userId: req.user?.id, userName: req.user?.name, action: 'ADD_NOTE', entity: 'ORDER', entityId: id } });
    });
    res.json({ success: true });
  } catch (error) {
    res.status(error instanceof Error && 'status' in error ? Number(error.status) : 500).json({ success: false, message: 'Could not add note' });
  }
}
