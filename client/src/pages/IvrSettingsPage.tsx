import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import toast from 'react-hot-toast';
import SecretInput from '../components/SecretInput';
import {
  PhoneCall,
  PhoneOutgoing,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  RotateCcw,
  Loader2,
  ShieldCheck,
  Send,
  ExternalLink,
  Volume2,
  Sliders
} from 'lucide-react';

interface IvrConfig {
  isEnabled: boolean;
  apiUrl: string;
  apiKey?: string;
  hasApiKey: boolean;
  callerId: string;
  maxRetries: number;
  retryDelayMinutes: number;
  callStartTime: string;
  callEndTime: string;
  minOrderAmount: number;
  orderCallDelayMinutes: number;
  allowManualCall: boolean;
}

interface IvrLog {
  id: string;
  recipient: string;
  channel: string;
  eventTrigger: string;
  status: string;
  body: string;
  errorMessage?: string;
  createdAt: string;
  order?: {
    id: string;
    orderNumber: string;
    customerName: string;
    status: string;
    grandTotal: number;
  } | null;
}

interface PbxTrunk {
  name: string;
  callerId: string;
  provider: string;
  status: string;
}

export const IvrSettingsPage: React.FC = () => {
  const [config, setConfig] = useState<IvrConfig>({
    isEnabled: true,
    apiUrl: 'http://103.169.160.153:7088',
    apiKey: '',
    hasApiKey: false,
    callerId: '09639139179',
    maxRetries: 2,
    retryDelayMinutes: 15,
    callStartTime: '09:00',
    callEndTime: '22:00',
    minOrderAmount: 0,
    orderCallDelayMinutes: 0,
    allowManualCall: true,
  });

  const [trunksUnavailable, setTrunksUnavailable] = useState(false);
  const [trunks, setTrunks] = useState<PbxTrunk[]>([]);
  const [customCallerId, setCustomCallerId] = useState(false);
  const [logs, setLogs] = useState<IvrLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Test call state
  const [testPhone, setTestPhone] = useState('');
  const [callingTest, setCallingTest] = useState(false);
  const [redialingId, setRedialingId] = useState<string | null>(null);

  const fetchIvrData = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgRes, logRes, trunkRes] = await Promise.all([
        api.get('/ivr/config'),
        api.get('/ivr/logs'),
        api.get('/ivr/trunks').catch(() => ({ data: { success: false, trunks: [] } })),
      ]);

      if (cfgRes.data?.success && cfgRes.data.config) {
        setConfig(cfgRes.data.config);
      }
      if (logRes.data?.success) {
        setLogs(logRes.data.logs || []);
      }
      setTrunksUnavailable(trunkRes.data?.success === false);
      if (trunkRes.data?.trunks && Array.isArray(trunkRes.data.trunks)) {
        setTrunks(trunkRes.data.trunks);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to load IVR calling settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIvrData();
  }, [fetchIvrData]);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.put('/ivr/config', config);
      if (res.data?.success) {
        toast.success('IVR calling settings saved successfully!');
        if (res.data.config) {
          setConfig(res.data.config);
        }
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleSendTestCall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testPhone.trim()) {
      toast.error('Please enter a phone number to test');
      return;
    }
    setCallingTest(true);
    try {
      const res = await api.post('/ivr/test-call', { phone: testPhone });
      if (res.data?.success) {
        toast.success(res.data.message || 'Test call dispatched! Customer will receive call shortly.');
        fetchIvrData();
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to trigger test call');
    } finally {
      setCallingTest(false);
    }
  };

  const handleManualRedial = async (orderId: string) => {
    setRedialingId(orderId);
    try {
      const res = await api.post('/ivr/manual-dial', { orderId });
      if (res.data?.success) {
        toast.success(res.data.message || 'Call queued successfully');
        fetchIvrData();
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to re-dial call');
    } finally {
      setRedialingId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'CONFIRMED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Confirmed (1)
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
            <XCircle className="w-3.5 h-3.5 text-rose-600" /> Cancelled (2)
          </span>
        );
      case 'CALL_ENDED_NO_INPUT':
      case 'NO_ANSWER':
      case 'BUSY':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
            <Clock className="w-3.5 h-3.5 text-amber-600" /> No Answer / Hung Up
          </span>
        );
      case 'SENT':
      case 'QUEUED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
            <PhoneOutgoing className="w-3.5 h-3.5 text-blue-600" /> Dialing...
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300">
            <AlertCircle className="w-3.5 h-3.5 text-red-600" /> Failed
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl">
              <PhoneCall className="w-6 h-6" />
            </div>
            Automated Voice Call (IVR)
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Automated order confirmation phone calls via BDIX Asterisk PBX with Bangla voice prompt & keypad verification.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fetchIvrData()}
            disabled={loading}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm hover:border-emerald-400 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 disabled:opacity-50"
          >
            <RotateCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Settings Form (2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          <form onSubmit={handleSaveConfig} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-card space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <Sliders className="w-5 h-5 text-emerald-600" />
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">PBX & Call Policy Configuration</h3>
                  <p className="text-xs text-slate-500">Configure connection to your BDIX PBX dialer server</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.isEnabled}
                  onChange={(e) => setConfig({ ...config, isEnabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-emerald-600"></div>
                <span className="ml-3 text-xs font-bold text-slate-900 dark:text-slate-200">
                  {config.isEnabled ? 'Enabled' : 'Disabled'}
                </span>
              </label>
            </div>

            {/* PBX URL & Secret */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                  PBX Agent API URL
                </label>
                <input
                  type="text"
                  required
                  value={config.apiUrl}
                  onChange={(e) => setConfig({ ...config, apiUrl: e.target.value })}
                  placeholder="http://103.169.160.153:7088"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-900 dark:text-slate-100 font-mono"
                />
                <p className="text-[11px] text-slate-400 mt-1">IP & Port of the micro-agent running on Asterisk VPS</p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold">
                    Caller ID (Trunk CLI)
                  </label>
                  <button
                    type="button"
                    onClick={() => setCustomCallerId(!customCallerId)}
                    className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium hover:underline"
                  >
                    {customCallerId ? 'Select from PBX Trunks' : 'Custom Number'}
                  </button>
                </div>

                {customCallerId ? (
                  <input
                    type="text"
                    required
                    value={config.callerId}
                    onChange={(e) => setConfig({ ...config, callerId: e.target.value })}
                    placeholder="09639139179"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-900 dark:text-slate-100 font-mono text-xs"
                  />
                ) : (
                  <select
                    value={config.callerId}
                    onChange={(e) => setConfig({ ...config, callerId: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-900 dark:text-slate-100 font-mono text-xs"
                  >
                    {trunks.map((t) => (
                      <option key={t.name + t.callerId} value={t.callerId}>
                        {t.callerId} — {t.provider} ({t.status})
                      </option>
                    ))}
                    {!trunks.some((t) => t.callerId === config.callerId) && config.callerId && (
                      <option value={config.callerId}>{config.callerId} (Current)</option>
                    )}
                  </select>
                )}
                <p className="text-[11px] text-slate-400 mt-1">{trunksUnavailable ? 'PBX status unavailable. Trunk registration could not be verified.' : 'Select an Asterisk trunk or enter a custom caller ID'}</p>
              </div>

              <div className="md:col-span-2">
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                  HMAC Secret Key (PBX_IVR_SECRET)
                </label>
                <SecretInput
                  value={config.apiKey || ''}
                  onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                  loadSavedSecret={async () => {
                    const res = await api.post('/ivr/config/reveal');
                    return res.data?.apiKey || '';
                  }}
                  placeholder={config.hasApiKey ? 'Secret saved securely · enter only to change' : 'Enter secret key'}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-900 dark:text-slate-100 font-mono"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Used to generate SHA-256 HMAC signature on outbound call requests and verify callback results.
                </p>
              </div>
            </div>

            {/* Dialing Policies */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
              <h4 className="text-xs font-bold text-slate-900 dark:text-slate-200 mb-3 flex items-center gap-1.5">
                <Volume2 className="w-4 h-4 text-emerald-600" /> Dialing Rules & Retries
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-xs">
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Order Call Delay (Min)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="60"
                    value={config.orderCallDelayMinutes}
                    onChange={(e) => setConfig({ ...config, orderCallDelayMinutes: parseInt(e.target.value) || 0 })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-900 dark:text-slate-100"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">0 = Instant call right after order place. 2 = wait 2 mins.</p>
                </div>

                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Max Retries
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={config.maxRetries}
                    onChange={(e) => setConfig({ ...config, maxRetries: parseInt(e.target.value) || 2 })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-900 dark:text-slate-100"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">Number of re-dials if unanswered or busy</p>
                </div>

                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Retry Interval (Min)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="120"
                    value={config.retryDelayMinutes}
                    onChange={(e) => setConfig({ ...config, retryDelayMinutes: parseInt(e.target.value) || 15 })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-900 dark:text-slate-100"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">Minutes before next retry attempt</p>
                </div>

                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Active Hours Start
                  </label>
                  <input
                    type="time"
                    value={config.callStartTime}
                    onChange={(e) => setConfig({ ...config, callStartTime: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-900 dark:text-slate-100"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">e.g. 09:00 AM (Dhaka time)</p>
                </div>

                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Active Hours End
                  </label>
                  <input
                    type="time"
                    value={config.callEndTime}
                    onChange={(e) => setConfig({ ...config, callEndTime: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-900 dark:text-slate-100"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">e.g. 10:00 PM (Calls stopped late at night)</p>
                </div>

                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Min Order Total (৳)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={config.minOrderAmount}
                    onChange={(e) => setConfig({ ...config, minOrderAmount: parseInt(e.target.value) || 0 })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-900 dark:text-slate-100"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">0 = all COD orders receive confirmation call</p>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 mt-3 bg-slate-50 dark:bg-slate-950 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800">
                <b>Active Hours Logic:</b> গ্রাহক যেন মাঝরাতে বা অসময়ে বিরক্ত না হন, তাই শুধুমাত্র নির্ধারিত সময়ের মধ্যে স্বয়ংক্রিয় অর্ডার কনফার্মেশন কল করা হয়। নির্ধারিত সময়ের বাইরের অর্ডারে কল স্থগিত থাকে। (অ্যাডমিন টেস্ট কলে কোনো সময়সীমা প্রযোজ্য নয়)।
              </p>
            </div>

            {/* Manual Calling from Orders Feature */}
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  Allow Manual IVR Call from Orders Page
                </h4>
                <p className="text-[11px] text-slate-500">
                  অর্ডার পেজ ও অর্ডার ডিটেইলস পেজে "IVR Call" বাটন অন রাখুন, যাতে যেকোনো অর্ডারে অ্যাডমিন বা এজেন্ট সরাসরি এক ক্লিকে কল পাঠাতে পারেন।
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.allowManualCall}
                  onChange={(e) => setConfig({ ...config, allowManualCall: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-emerald-600"></div>
                <span className="ml-3 text-xs font-bold text-slate-900 dark:text-slate-200">
                  {config.allowManualCall ? 'Enabled' : 'Disabled'}
                </span>
              </label>
            </div>

            {/* Action Bar */}
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Changes apply instantly to incoming orders without server restart.
              </span>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-sm disabled:opacity-50 transition-colors"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                Save IVR Settings
              </button>
            </div>
          </form>
        </div>

        {/* Right Sidebar: Test Dial Console & Architecture Info (1 col) */}
        <div className="space-y-6">
          {/* Test Call Box */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-card space-y-4">
            <div className="flex items-center gap-2">
              <Send className="w-4 h-4 text-emerald-600" />
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">Instant Test Call</h3>
            </div>
            <p className="text-xs text-slate-500">
              Test dial any 11-digit Bangladesh mobile number. Your phone will ring and play the IVR voice prompt.
            </p>

            <form onSubmit={handleSendTestCall} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                  Mobile Number
                </label>
                <input
                  type="text"
                  required
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="017XXXXXXXX"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-900 dark:text-slate-100 font-mono"
                />
              </div>

              <button
                type="submit"
                disabled={callingTest}
                className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white dark:bg-emerald-600 dark:hover:bg-emerald-500 font-semibold rounded-xl shadow-sm disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
              >
                {callingTest ? <Loader2 className="w-4 h-4 animate-spin" /> : <PhoneOutgoing className="w-4 h-4" />}
                Test Dial Phone
              </button>
            </form>
          </div>

          {/* How It Works Card */}
          <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl space-y-3">
            <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs">How Automated IVR Works</h4>
            <ul className="text-[11px] text-slate-600 dark:text-slate-400 space-y-2 list-disc list-inside">
              <li>Customer places a COD order on your website.</li>
              <li>Asterisk BDIX server places call instantly via IP TSP trunk.</li>
              <li>Customer answers: plays Bangla order confirmation audio.</li>
              <li>Customer presses <b>1</b>: Order status becomes <b className="text-emerald-600">CONFIRMED</b>.</li>
              <li>Customer presses <b>2</b>: Order status becomes <b className="text-rose-600">CANCELLED</b>.</li>
              <li>Customer doesn't answer: automatically retried up to {config.maxRetries} times.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Recent IVR Call History Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-card space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">Recent Automated Calls</h3>
            <p className="text-xs text-slate-500">Live call logs, customer responses, and verification results</p>
          </div>
          <span className="text-xs text-slate-400">Total {logs.length} logged calls</span>
        </div>

        {logs.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
            No IVR call logs recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold">
                  <th className="py-2.5 px-3">Date & Time</th>
                  <th className="py-2.5 px-3">Recipient</th>
                  <th className="py-2.5 px-3">Order</th>
                  <th className="py-2.5 px-3">Call Status</th>
                  <th className="py-2.5 px-3">Details / Result</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                    <td className="py-3 px-3 text-slate-600 dark:text-slate-400 font-mono text-[11px] whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-3 px-3 font-mono font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {log.recipient}
                    </td>
                    <td className="py-3 px-3">
                      {log.order ? (
                        <Link
                          to={`/orders/${log.order.id}`}
                          className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-500 font-semibold"
                        >
                          #{log.order.orderNumber || log.order.id.slice(0, 8)}
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      ) : (
                        <span className="text-slate-400">Test / Direct</span>
                      )}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      {getStatusBadge(log.status)}
                    </td>
                    <td className="py-3 px-3 text-slate-600 dark:text-slate-300 max-w-xs truncate" title={log.body}>
                      {log.body}
                    </td>
                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      {log.order && (
                        <button
                          type="button"
                          onClick={() => handleManualRedial(log.order!.id)}
                          disabled={redialingId === log.order.id}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:border-emerald-500 hover:text-emerald-600 disabled:opacity-50"
                        >
                          {redialingId === log.order.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RotateCcw className="w-3 h-3" />
                          )}
                          Re-dial
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default IvrSettingsPage;
