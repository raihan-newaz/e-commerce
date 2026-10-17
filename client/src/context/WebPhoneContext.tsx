import React, { createContext, useContext, useEffect, useState } from 'react';
import { WebPhoneModal } from '../components/orders/WebPhoneModal';

export interface CallRequest {
  phone: string;
  orderId?: string;
  orderNumber?: string;
  customerName?: string;
  timestamp?: number;
  isRestoredAfterReload?: boolean;
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
  const [activeCall, setActiveCall] = useState<CallRequest | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  // Restore active call on page reload if active within last 5 minutes
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: CallRequest = JSON.parse(stored);
        const ageMs = Date.now() - (parsed.timestamp || 0);
        // If stored within 5 minutes, restore widget
        if (ageMs < 5 * 60 * 1000 && parsed.phone) {
          setActiveCall({ ...parsed, isRestoredAfterReload: true });
          setIsOpen(true);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch (_) {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const startCall = (req: CallRequest) => {
    const callData: CallRequest = {
      ...req,
      timestamp: Date.now(),
      isRestoredAfterReload: false,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(callData));
    } catch (_) {}
    setActiveCall(callData);
    setIsOpen(true);
  };

  const endCall = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
  };

  const closeDialer = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
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

      {isOpen && activeCall && (
        <WebPhoneModal
          key={`${activeCall.phone}-${activeCall.timestamp}`}
          orderId={activeCall.orderId}
          orderNumber={activeCall.orderNumber}
          customerName={activeCall.customerName}
          customerPhone={activeCall.phone}
          isRestoredAfterReload={activeCall.isRestoredAfterReload}
          onCallEnded={endCall}
          onClose={closeDialer}
        />
      )}
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
