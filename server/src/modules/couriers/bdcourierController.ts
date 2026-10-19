import axios, { AxiosError } from 'axios';
import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../../prisma';
import { AuthRequest } from '../../middlewares/auth';
import { revealSecret } from '../../utils/security';

const API_BASE_URL = 'https://api.bdcourier.com';
const timeout = 15_000;

const getApiKey = async () => {
  const config = await prisma.courierConfig.findUnique({ where: { provider: 'BDCOURIER' }, select: { apiKey: true, isEnabled: true } });
  if (!config?.isEnabled || !config.apiKey) throw Object.assign(new Error('Enable BD Courier and save an API key in Courier settings first'), { status: 409 });
  return revealSecret(config.apiKey);
};

const relayApiError = (error: unknown, res: Response) => {
  const response = (error as AxiosError<any>)?.response;
  const status = response?.status;
  const message = typeof response?.data?.message === 'string' ? response.data.message : undefined;
  if (status === 401 || status === 403) { res.status(502).json({ success: false, message: message || 'BD Courier rejected the API key' }); return; }
  if (status === 429) { res.status(429).json({ success: false, message: message || 'BD Courier search limit reached. Check your plan and usage.' }); return; }
  if (status && status >= 400 && status < 500) { res.status(502).json({ success: false, message: message || `BD Courier request failed (${status})` }); return; }
  res.status(502).json({ success: false, message: 'Could not reach BD Courier. Try again shortly.' });
};

export const checkBdCourierConnection = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const apiKey = await getApiKey();
    const { data } = await axios.get(`${API_BASE_URL}/check-connection`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }, timeout });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data });
  } catch (error: any) {
    if (error.status) { res.status(error.status).json({ success: false, message: error.message }); return; }
    relayApiError(error, res);
  }
};

export const getBdCourierPlan = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const apiKey = await getApiKey();
    const { data } = await axios.get(`${API_BASE_URL}/my-plan`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }, timeout });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data });
  } catch (error: any) {
    if (error.status) { res.status(error.status).json({ success: false, message: error.message }); return; }
    relayApiError(error, res);
  }
};

export const checkBdCourierOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ success: false, message: 'Invalid order ID' }); return; }
  try {
    const order = await prisma.order.findUnique({ where: { id: parsed.data.id }, select: { id: true, customerPhone: true, trashedAt: true } });
    if (!order || order.trashedAt) { res.status(404).json({ success: false, message: 'Order not found' }); return; }
    const phone = String(order.customerPhone || '').replace(/\D/g, '').replace(/^0088/, '').replace(/^88/, '');
    if (!/^01[3-9]\d{8}$/.test(phone)) { res.status(400).json({ success: false, message: 'This order does not have a valid Bangladesh mobile number' }); return; }
    const apiKey = await getApiKey();
    const { data } = await axios.post(`${API_BASE_URL}/courier-check`, { phone }, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' }, timeout });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, result: data });
  } catch (error: any) {
    if (error.status) { res.status(error.status).json({ success: false, message: error.message }); return; }
    relayApiError(error, res);
  }
};
