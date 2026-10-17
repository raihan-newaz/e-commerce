import { Router, Request, Response } from 'express';
import prisma from '../../prisma';
import { authenticateToken, requireRole } from '../../middlewares/auth';
import { maskSecret, keepExistingSecret, isAllowedRemoteUrl } from '../../utils/security';
import { getIvrConfig, dispatchIvrCall, formatBdPhone } from './ivrService';
import { handlePbxIvrWebhook } from './ivrWebhook';
import { z } from 'zod';
import axios from 'axios';
import crypto from 'crypto';

const router = Router();

// Public / HMAC-protected webhook endpoint for Asterisk dialplan callback
router.post('/webhook', handlePbxIvrWebhook);

// Get IVR Configuration
router.get('/config', authenticateToken, requireRole(['SUPER_ADMIN', 'OPERATIONS_MANAGER']), async (req: Request, res: Response): Promise<void> => {
  try {
    const config = await getIvrConfig();
    res.json({
      success: true,
      config: {
        ...config,
        apiKey: maskSecret(config.apiKey),
        hasApiKey: Boolean(config.apiKey)
      }
    });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Reveal API Secret Token
router.post('/config/reveal', authenticateToken, requireRole(['SUPER_ADMIN']), async (req: Request, res: Response): Promise<void> => {
  try {
    const config = await getIvrConfig();
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.json({ success: true, apiKey: config.apiKey });
  } catch (error: any) {
    res.status(400).json({ success: false, message: 'Could not reveal IVR secret' });
  }
});

// Fetch Available Trunks from Asterisk PBX
router.get('/trunks', authenticateToken, requireRole(['SUPER_ADMIN', 'OPERATIONS_MANAGER']), async (req: Request, res: Response): Promise<void> => {
  try {
    const config = await getIvrConfig();
    const pbxRes = await axios.get(`${config.apiUrl.replace(/\/+$/, '')}/api/trunks`, { timeout: 4000 });
    res.json(pbxRes.data);
  } catch {
    // Fallback if PBX unreachable or old version
    res.json({
      success: true,
      trunks: [
        { name: 'icctalk_09639139179', callerId: '09639139179', provider: 'ICC Talk', status: 'Registered' },
        { name: 'SarkerComm_09649979999', callerId: '09649979999', provider: 'Sarker Comm', status: 'Registered' },
        { name: 'SarkerComm_09649777707', callerId: '09649777707', provider: 'Sarker Comm', status: 'Offline' },
        { name: 'SarkerComm__09649666606', callerId: '09649666606', provider: 'Sarker Comm', status: 'Offline' }
      ]
    });
  }
});

const ivrUpdateSchema = z.object({
  isEnabled: z.boolean(),
  apiUrl: z.string().trim(),
  apiKey: z.string().optional(),
  callerId: z.string().trim().optional(),
  maxRetries: z.number().int().min(1).max(10).default(2),
  retryDelayMinutes: z.number().int().min(1).max(120).default(15),
  callStartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('09:00'),
  callEndTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('22:00'),
  minOrderAmount: z.number().nonnegative().default(0),
  orderCallDelayMinutes: z.number().int().min(0).max(60).default(0),
  allowManualCall: z.boolean().default(true),
});

// Update IVR Configuration
router.put('/config', authenticateToken, requireRole(['SUPER_ADMIN']), async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = ivrUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.issues[0]?.message || 'Invalid config data' });
      return;
    }

    const {
      isEnabled,
      apiUrl,
      apiKey,
      callerId,
      maxRetries,
      retryDelayMinutes,
      callStartTime,
      callEndTime,
      minOrderAmount,
      orderCallDelayMinutes,
      allowManualCall,
    } = parsed.data;

    if (!isAllowedRemoteUrl(apiUrl, true)) {
      res.status(400).json({ success: false, message: 'Invalid PBX server URL. Must be a valid remote HTTP or HTTPS endpoint.' });
      return;
    }

    const existing = await prisma.messageGatewayConfig.findUnique({
      where: { type: 'ASTERISK_IVR' }
    });

    const nextApiKey = keepExistingSecret(apiKey, existing?.apiKey);

    const extraJson = JSON.stringify({
      maxRetries,
      retryDelayMinutes,
      callStartTime,
      callEndTime,
      minOrderAmount,
      orderCallDelayMinutes,
      allowManualCall,
    });

    const updated = await prisma.messageGatewayConfig.upsert({
      where: { type: 'ASTERISK_IVR' },
      create: {
        type: 'ASTERISK_IVR',
        apiUrl,
        apiKey: nextApiKey,
        senderId: callerId || '09639139179',
        clientId: extraJson,
        isEnabled,
        isDefault: false
      },
      update: {
        apiUrl,
        apiKey: nextApiKey,
        senderId: callerId || '09639139179',
        clientId: extraJson,
        isEnabled
      }
    });

    res.json({
      success: true,
      message: 'Automated IVR calling settings saved',
      config: {
        isEnabled: updated.isEnabled,
        apiUrl: updated.apiUrl,
        apiKey: maskSecret(updated.apiKey),
        hasApiKey: Boolean(updated.apiKey),
        callerId: updated.senderId,
        maxRetries,
        retryDelayMinutes,
        callStartTime,
        callEndTime,
        minOrderAmount,
        orderCallDelayMinutes,
        allowManualCall,
      }
    });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Send Test Call
router.post('/test-call', authenticateToken, requireRole(['SUPER_ADMIN', 'OPERATIONS_MANAGER']), async (req: Request, res: Response): Promise<void> => {
  try {
    const phone = formatBdPhone(req.body.phone);
    if (!phone) {
      res.status(400).json({ success: false, message: 'Please provide a valid 11-digit Bangladesh phone number (e.g. 017XXXXXXXX)' });
      return;
    }

    const testId = `TEST-${Date.now().toString(36).toUpperCase()}`;
    const result = await dispatchIvrCall({
      id: testId,
      customerPhone: phone,
      grandTotal: 100
    });

    if (result.success) {
      res.json({
        success: true,
        message: `Test call dispatched to ${phone}. Your phone should ring shortly.`,
        data: result.data
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.error || result.reason || 'Failed to dispatch test call via PBX'
      });
    }
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Error executing test call' });
  }
});

// Manual Re-dial for a Specific Order
router.post('/manual-dial', authenticateToken, requireRole(['SUPER_ADMIN', 'OPERATIONS_MANAGER', 'CALL_CENTER_AGENT']), async (req: Request, res: Response): Promise<void> => {
  try {
    const { orderId } = req.body;
    if (!orderId) {
      res.status(400).json({ success: false, message: 'orderId is required' });
      return;
    }

    const config = await getIvrConfig();
    if (!config.allowManualCall) {
      res.status(400).json({ success: false, message: 'Manual IVR calling from orders is disabled in settings' });
      return;
    }

    const order = await prisma.order.findUnique({
      where: { id: String(orderId) }
    });

    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    const result = await dispatchIvrCall({
      id: order.id,
      customerPhone: order.customerPhone,
      grandTotal: order.grandTotal
    }, false, true);

    if (result.success) {
      res.json({
        success: true,
        message: `IVR confirmation call queued for order ${order.orderNumber || order.id}`,
        data: result.data
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.error || result.reason || 'Failed to dial call'
      });
    }
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Get Recent IVR Logs
router.get('/logs', authenticateToken, requireRole(['SUPER_ADMIN', 'OPERATIONS_MANAGER', 'CALL_CENTER_AGENT']), async (req: Request, res: Response): Promise<void> => {
  try {
    const logs = await prisma.messageLog.findMany({
      where: {
        channel: 'IVR_CALL'
      },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            customerName: true,
            status: true,
            grandTotal: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 50
    });

    res.json({ success: true, logs });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get WebPhone Config for in-browser WebRTC calling
router.get('/webphone-config', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const config = await getIvrConfig();
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const host = req.headers.host || 'nix.bd';
    const wsProto = isHttps ? 'wss:' : 'ws:';
    res.json({
      success: true,
      config: {
        wsServer: `${wsProto}//${host}/ws-sip`,
        sipDomain: '103.169.160.153',
        extension: 'webrtc_agent',
        password: 'REDACTED',
        displayName: (req as any).user?.name || 'NIX Agent',
        callerId: config.callerId || '09639139179',
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Hangup Active Call
router.post('/active-call/hangup', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { phone, orderId } = req.body;
    const config = await getIvrConfig();
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ phone, orderId, timestamp });
    const signature = crypto.createHmac('sha256', config.apiKey).update(payload).digest('hex');

    const agentUrl = new URL(config.apiUrl);
    const hangupUrl = `${agentUrl.protocol}//${agentUrl.host}/api/call/hangup`;

    const response = await fetch(hangupUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PBX-Signature': signature,
        'X-PBX-Timestamp': String(timestamp),
      },
      body: payload,
    });

    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
