import React, { useEffect, useRef, useState } from 'react';
import * as JsSIP from 'jssip';
import { Phone, PhoneOff, Mic, MicOff, Volume2, X, Minimize2, Maximize2, Loader2, CheckCircle2, RotateCcw, GripHorizontal } from 'lucide-react';
import api from '../../lib/api';
import toast from 'react-hot-toast';

interface WebPhoneModalProps {
  orderId?: string;
  orderNumber?: string;
  customerName?: string;
  customerPhone: string;
  isRestoredAfterReload?: boolean;
  onCallEnded?: () => void;
  onClose: () => void;
}

type CallState = 'INITIALIZING' | 'CONNECTING' | 'RINGING' | 'CONNECTED' | 'ENDED' | 'FAILED' | 'RELOAD_ACTIVE';

// Module-level cache to eliminate repeated HTTP roundtrips
let cachedWebPhoneConfig: any = null;

export const WebPhoneModal: React.FC<WebPhoneModalProps> = ({
  orderId,
  orderNumber,
  customerName,
  customerPhone,
  isRestoredAfterReload = false,
  onCallEnded,
  onClose,
}) => {
  const [callState, setCallState] = useState<CallState>(
    isRestoredAfterReload ? 'RELOAD_ACTIVE' : 'INITIALIZING'
  );
  const [statusMessage, setStatusMessage] = useState(
    isRestoredAfterReload
      ? 'কল চলাকালীন পেজ রিলোড হয়েছিল। চ্যানেল কাটতে "কল কাটুন" চাপুন।'
      : 'Initializing Web Phone…'
  );
  const [isMuted, setIsMuted] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [duration, setDuration] = useState(0);

  // Moveable / Draggable State
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; startY: number; initX: number; initY: number } | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);

  const uaRef = useRef<JsSIP.UA | null>(null);
  const sessionRef = useRef<any>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<any>(null);

  // Clean phone number (e.g. 01701007333)
  const cleanPhone = customerPhone.replace(/\D/g, '').replace(/^88/, '');

  // Initialize position to top-right on mount
  useEffect(() => {
    const defaultWidth = 384;
    const defaultX = Math.max(16, window.innerWidth - defaultWidth - 32);
    const defaultY = 24;
    setPosition({ x: defaultX, y: defaultY });
  }, []);

  const handleDragStart = (clientX: number, clientY: number) => {
    if (!position) return;
    setIsDragging(true);
    dragStartRef.current = {
      startX: clientX,
      startY: clientY,
      initX: position.x,
      initY: position.y,
    };
  };

  useEffect(() => {
    const handleMove = (clientX: number, clientY: number) => {
      if (!dragStartRef.current) return;
      const dx = clientX - dragStartRef.current.startX;
      const dy = clientY - dragStartRef.current.startY;
      const width = modalRef.current?.offsetWidth || 384;
      const height = modalRef.current?.offsetHeight || 320;

      const newX = Math.max(8, Math.min(window.innerWidth - width - 8, dragStartRef.current.initX + dx));
      const newY = Math.max(8, Math.min(window.innerHeight - height - 8, dragStartRef.current.initY + dy));
      setPosition({ x: newX, y: newY });
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (dragStartRef.current) {
        e.preventDefault();
        handleMove(e.clientX, e.clientY);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (dragStartRef.current && e.touches.length > 0) {
        handleMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    const handleDragEnd = () => {
      dragStartRef.current = null;
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleDragEnd);
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleDragEnd);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleDragEnd);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleDragEnd);
    };
  }, []);

  const startWebPhoneSession = async () => {
    try {
      setCallState('INITIALIZING');
      setStatusMessage('Connecting to PBX Server…');

      let cfg = cachedWebPhoneConfig;
      if (!cfg) {
        const { data } = await api.get('/ivr/webphone-config');
        if (!data?.success || !data?.config) {
          throw new Error('Failed to load phone configuration');
        }
        cfg = data.config;
        cachedWebPhoneConfig = cfg;
      }

      const socket = new JsSIP.WebSocketInterface(cfg.wsServer);

      const configuration = {
        sockets: [socket],
        uri: `sip:${cfg.extension}@${cfg.sipDomain}`,
        password: cfg.password,
        display_name: cfg.displayName || 'NIX Agent',
        session_timers: false,
        register: true,
      };

      const ua = new JsSIP.UA(configuration);
      uaRef.current = ua;

      ua.on('connected', () => {
        setStatusMessage('Connected to PBX. Registering…');
      });

      ua.on('registered', () => {
        setStatusMessage('Ready. Calling customer…');
        dialCustomer(ua, cfg.sipDomain, cfg);
      });

      ua.on('registrationFailed', (e: any) => {
        setCallState('FAILED');
        setStatusMessage(`Registration failed: ${e.cause || 'Unauthorized'}`);
      });

      ua.start();
    } catch (err: any) {
      setCallState('FAILED');
      setStatusMessage(err.message || 'Could not connect to PBX');
      toast.error('Web Phone connection failed');
    }
  };

  useEffect(() => {
    let isMounted = true;

    if (!isRestoredAfterReload) {
      void startWebPhoneSession();
    }

    return () => {
      isMounted = false;
      if (timerRef.current) clearInterval(timerRef.current);
      if (sessionRef.current && sessionRef.current.isEstablished()) {
        try { sessionRef.current.terminate(); } catch (_) {}
      }
      if (uaRef.current) {
        try { uaRef.current.stop(); } catch (_) {}
      }
    };
  }, []);

  const dialCustomer = (ua: JsSIP.UA, domain: string, cfg: any) => {
    setCallState('CONNECTING');
    setStatusMessage(`Dialing ${cleanPhone}…`);

    const eventHandlers = {
      progress: () => {
        setCallState('RINGING');
        setStatusMessage('Ringing customer phone…');
      },
      confirmed: () => {
        setCallState('CONNECTED');
        setStatusMessage('Call connected. Talking…');
        // Start live duration timer
        timerRef.current = setInterval(() => {
          setDuration(prev => prev + 1);
        }, 1000);
      },
      ended: () => {
        handleCallEnded('Call ended');
      },
      failed: (e: any) => {
        handleCallEnded(`Call failed: ${e.cause || 'Customer unavailable'}`);
      },
      peerconnection: (data: any) => {
        const pc = data.peerconnection;
        pc.addEventListener('track', (e: RTCTrackEvent) => {
          if (remoteAudioRef.current && e.streams[0]) {
            remoteAudioRef.current.srcObject = e.streams[0];
            remoteAudioRef.current.play().catch(() => {});
          }
        });
      },
    };

    const options = {
      eventHandlers,
      extraHeaders: [
        `X-Caller-ID: ${cfg?.callerId || '09639139179'}`
      ],
      mediaConstraints: { audio: true, video: false },
      rtcOfferConstraints: {
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      },
      pcConfig: {
        // Zero STUN delays: Asterisk has public IP 103.169.160.153 with rtp_symmetric=yes
        iceServers: []
      }
    };

    try {
      const session = ua.call(`sip:${cleanPhone}@${domain}`, options);
      sessionRef.current = session;
    } catch (e: any) {
      setCallState('FAILED');
      setStatusMessage(`Dial error: ${e.message}`);
    }
  };

  const handleCallEnded = (msg: string) => {
    setCallState('ENDED');
    setStatusMessage(msg);
    if (timerRef.current) clearInterval(timerRef.current);
    if (onCallEnded) onCallEnded();
  };

  const handleHangup = async () => {
    // 1. Terminate browser WebRTC session
    if (sessionRef.current) {
      try {
        sessionRef.current.terminate();
      } catch (_) {}
    }

    // 2. Terminate server Asterisk channel via backend
    try {
      await api.post('/ivr/active-call/hangup', {
        phone: cleanPhone,
        orderId: orderId,
      });
    } catch (_) {}

    handleCallEnded('Call terminated by agent');
    toast('Call ended & Asterisk channel killed', { icon: '📞' });
  };

  const toggleMute = () => {
    if (!sessionRef.current) return;
    if (isMuted) {
      sessionRef.current.unmute();
      setIsMuted(false);
    } else {
      sessionRef.current.mute();
      setIsMuted(true);
    }
  };

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <>
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* Floating Call Widget - MOVEABLE / DRAGGABLE ANYWHERE ON SCREEN */}
      <div
        ref={modalRef}
        style={position ? { left: `${position.x}px`, top: `${position.y}px` } : undefined}
        className={`fixed z-[9999] ${isDragging ? '' : 'transition-[width,height] duration-200'} ${
          !position ? 'top-4 right-4 sm:top-6 sm:right-8' : ''
        } ${
          isMinimized
            ? 'w-80 shadow-2xl'
            : 'w-[calc(100vw-2rem)] max-w-sm sm:w-96 shadow-2xl'
        }`}
      >
        <div className="overflow-hidden rounded-2xl border-2 border-emerald-500/80 bg-white shadow-2xl dark:border-emerald-600/60 dark:bg-slate-900 ring-4 ring-emerald-500/10">
          {/* Header - DRAG HANDLE */}
          <div
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              handleDragStart(e.clientX, e.clientY);
            }}
            onTouchStart={(e) => {
              if (e.touches.length > 0) {
                handleDragStart(e.touches[0].clientX, e.touches[0].clientY);
              }
            }}
            className="flex items-center justify-between border-b border-slate-100 bg-slate-900 px-4 py-3 text-white dark:border-slate-800 dark:bg-slate-950 cursor-grab active:cursor-grabbing select-none"
            title="মাউস দিয়ে চেপে ধরে যেকোনো জায়গায় ড্র্যাগ/মুভ করুন (Drag to move)"
          >
            <div className="flex items-center gap-2">
              <GripHorizontal className="h-4 w-4 text-slate-400 opacity-80" />
              <span className={`h-2.5 w-2.5 rounded-full ${
                callState === 'CONNECTED' ? 'animate-pulse bg-emerald-400' :
                callState === 'RINGING' || callState === 'RELOAD_ACTIVE' ? 'animate-ping bg-amber-400' :
                callState === 'ENDED' || callState === 'FAILED' ? 'bg-rose-400' :
                'animate-pulse bg-sky-400'
              }`} />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Direct Web Call
              </span>
            </div>
            <div
              className="flex items-center gap-1"
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setIsMinimized(!isMinimized)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                title={isMinimized ? 'Expand' : 'Minimize'}
              >
                {isMinimized ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
              </button>
              {(callState === 'ENDED' || callState === 'FAILED' || callState === 'RELOAD_ACTIVE') && (
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                  title="Close"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Body */}
          <div className="p-5 text-center">
            {/* Customer Details */}
            <div className="mb-4">
              <p className="text-base font-bold text-slate-900 dark:text-white">
                {customerName || 'Customer'}
              </p>
              <p className="font-mono text-sm font-semibold text-slate-500">
                {cleanPhone}
              </p>
              {orderNumber && (
                <span className="mt-1 inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  Order #{orderNumber}
                </span>
              )}
            </div>

            {/* Live Call Status & Duration */}
            <div className="my-5 flex flex-col items-center justify-center">
              {callState === 'CONNECTED' ? (
                <div className="flex flex-col items-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                    <Volume2 className="h-8 w-8 animate-bounce" />
                  </div>
                  <span className="mt-3 font-mono text-2xl font-black text-slate-900 dark:text-white">
                    {formatDuration(duration)}
                  </span>
                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    Connected · Speaking
                  </span>
                </div>
              ) : callState === 'RINGING' || callState === 'RELOAD_ACTIVE' ? (
                <div className="flex flex-col items-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
                    <Phone className="h-8 w-8 animate-pulse" />
                  </div>
                  <span className="mt-3 text-sm font-bold text-amber-600 dark:text-amber-400">
                    {callState === 'RELOAD_ACTIVE' ? 'Call Active (After Reload)' : 'Ringing…'}
                  </span>
                  <span className="text-xs text-slate-500 max-w-xs mt-1">
                    {statusMessage}
                  </span>
                </div>
              ) : callState === 'ENDED' || callState === 'FAILED' ? (
                <div className="flex flex-col items-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400">
                    <PhoneOff className="h-8 w-8" />
                  </div>
                  <span className="mt-3 text-sm font-bold text-slate-800 dark:text-slate-200">
                    {statusMessage}
                  </span>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 text-sky-600 dark:bg-sky-950/60 dark:text-sky-400">
                    <Loader2 className="h-8 w-8 animate-spin" />
                  </div>
                  <span className="mt-3 text-sm font-semibold text-slate-600 dark:text-slate-400">
                    {statusMessage}
                  </span>
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="mt-6 flex flex-col gap-2.5">
              <div className="flex items-center justify-center gap-3">
                {callState === 'CONNECTED' && (
                  <button
                    type="button"
                    onClick={toggleMute}
                    className={`flex h-12 w-12 items-center justify-center rounded-full border transition ${
                      isMuted
                        ? 'border-amber-300 bg-amber-100 text-amber-700'
                        : 'border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                    }`}
                    title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                  >
                    {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                  </button>
                )}

                {/* BIG RED HANGUP BUTTON - ALWAYS AT TOP OF VIEWPORT */}
                {callState !== 'ENDED' && callState !== 'FAILED' ? (
                  <button
                    type="button"
                    onClick={handleHangup}
                    className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-rose-600 px-6 font-bold text-white shadow-lg shadow-rose-600/30 transition hover:bg-rose-700 active:scale-95 cursor-pointer"
                    title="Hang up active call"
                  >
                    <PhoneOff className="h-5 w-5" />
                    <span className="text-base font-black">কল কাটুন (End Call)</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-6 font-bold text-white transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 cursor-pointer"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Close Dialer</span>
                  </button>
                )}
              </div>

              {callState === 'RELOAD_ACTIVE' && (
                <button
                  type="button"
                  onClick={startWebPhoneSession}
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>পুনরায় কল লাগান (Redial)</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
