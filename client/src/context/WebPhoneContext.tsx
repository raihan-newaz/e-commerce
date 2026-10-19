import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { CallerPreviewPopup, type CallerPreview } from '../components/orders/CallerPreviewPopup';
const WebPhoneModal = React.lazy(() => import('../components/orders/WebPhoneModal').then(module => ({ default: module.WebPhoneModal })));

export interface CallRequest {
  phone: string;
  orderId?: string;
  orderNumber?: string;
  customerName?: string;
  timestamp?: number;
  callId?: string;
  isRestoredAfterReload?: boolean;
  ownerId?: string;
}

interface WebPhoneContextType {
  activeCall: CallRequest | null;
  isOpen: boolean;
  startCall: (req: CallRequest) => void;
  endCall: () => void;
  closeDialer: () => void;
}

const WebPhoneContext = createContext<WebPhoneContextType | undefined>(undefined);

const STORAGE_KEY = 'nix_active_webphone_call';

export const WebPhoneProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  const storageKey = `${STORAGE_KEY}:${user?.id || ''}`;
  const [activeCall, setActiveCall] = useState<CallRequest | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [callerPreview, setCallerPreview] = useState<CallerPreview | null>(null);
  const [lastCallStatus, setLastCallStatus] = useState('Call details');

  useEffect(() => {
    if (!user?.id || !['SUPER_ADMIN', 'OPERATIONS_MANAGER', 'CALL_CENTER_AGENT'].includes(user.role)) return;
    const socket = io();
    socket.on('call:logged', (call: CallerPreview) => setCallerPreview(call));
    return () => { socket.disconnect(); };
  }, [user?.id, user?.role]);

  // Restore active call on page reload if active within last 5 minutes
  useEffect(() => {
    if (loading) return;
    setActiveCall(null); setIsOpen(false);
    try {
      localStorage.removeItem(STORAGE_KEY);
      if (!user) return;
      const stored = sessionStorage.getItem(storageKey);
      if (stored) {
        const parsed: CallRequest = JSON.parse(stored);
        parsed.callId ||= `web-${crypto.randomUUID()}`;
        const ageMs = Date.now() - (parsed.timestamp || 0);
        // If stored within 5 minutes, restore widget
        if (ageMs >= 0 && ageMs < 5 * 60 * 1000 && parsed.phone && parsed.ownerId === user.id) {
          setActiveCall({ ...parsed, isRestoredAfterReload: true });
          setIsOpen(true);
        } else {
          sessionStorage.removeItem(storageKey);
        }
      }
    } catch (_) {
      sessionStorage.removeItem(storageKey);
    }
  }, [user?.id, loading]);

  const startCall = (req: CallRequest) => {
    if (!user) return;
    const callData: CallRequest = {
      ...req,
      callId: `web-${crypto.randomUUID()}`,
      timestamp: Date.now(),
      ownerId: user.id,
      isRestoredAfterReload: false,
    };
    setLastCallStatus('DIALING');
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(callData));
    } catch (_) {}
    setActiveCall(callData);
    setIsOpen(true);
  };

  const endCall = (status?: string) => {
    try {
      sessionStorage.removeItem(storageKey);
    } catch (_) {}
    if (status) setLastCallStatus(status);
  };

  const closeDialer = () => {
    try {
      sessionStorage.removeItem(storageKey);
    } catch (_) {}
    if (activeCall) setCallerPreview({ ...activeCall, direction: 'OUTBOUND', status: lastCallStatus, startedAt: activeCall.timestamp ? new Date(activeCall.timestamp).toISOString() : undefined });
    setActiveCall(null);
    setIsOpen(false);
  };

  return (
    <WebPhoneContext.Provider
      value={{
        activeCall,
        isOpen,
        startCall,
        endCall,
        closeDialer,
      }}
    >
      {children}

      {user && isOpen && activeCall?.ownerId === user.id && (
        <React.Suspense fallback={<div role="status" className="fixed right-4 top-4 z-50 rounded bg-white p-4 shadow">Loading phone…</div>}>
        <WebPhoneModal
          key={`${activeCall.phone}-${activeCall.timestamp}`}
          orderId={activeCall.orderId}
          orderNumber={activeCall.orderNumber}
          customerName={activeCall.customerName}
          customerPhone={activeCall.phone}
          callId={activeCall.callId}
          isRestoredAfterReload={activeCall.isRestoredAfterReload}
          onCallEnded={endCall}
          onClose={closeDialer}
        />
        </React.Suspense>
      )}
      {user && callerPreview && <CallerPreviewPopup call={callerPreview} onClose={() => setCallerPreview(null)}/>}
    </WebPhoneContext.Provider>
  );
};

export const useWebPhone = () => {
  const context = useContext(WebPhoneContext);
  if (!context) {
    throw new Error('useWebPhone must be used within a WebPhoneProvider');
  }
  return context;
};
