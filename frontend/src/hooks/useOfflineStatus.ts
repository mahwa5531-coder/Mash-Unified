"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchAuthMe, AuthUser } from '@/services/auth';

/** Tracks offline state and auto-recovers via browser online, delayed DNS/DHCP settle, and focus transitions. */
export function useOfflineStatus(
  authUser: AuthUser | null,
  onAuthUserChange: (user: AuthUser) => void
) {
  const [browserOffline, setBrowserOffline] = useState<boolean>(
    () => typeof navigator !== 'undefined' && navigator.onLine === false
  );
  const [isDismissed, setIsDismissed] = useState(false);
  const onlineRetryTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const isOffline = Boolean(authUser?.offline || browserOffline);

  const clearOnlineRetryTimers = useCallback(() => {
    for (const timer of onlineRetryTimersRef.current) {
      clearTimeout(timer);
    }
    onlineRetryTimersRef.current = [];
  }, []);

  const retryConnection = useCallback(async (): Promise<boolean> => {
    const offlineNow = typeof navigator !== 'undefined' && navigator.onLine === false;
    setBrowserOffline(offlineNow);
    if (offlineNow) return false;
    try {
      const user = await fetchAuthMe();
      if (user && (user.authenticated || user.offline)) {
        onAuthUserChange(user);
        if (user.authenticated) {
          clearOnlineRetryTimers();
          setBrowserOffline(false);
          setIsDismissed(false);
          return true;
        }
      }
    } catch {
      // Remain in offline mode while gateway check fails
    }
    return false;
  }, [clearOnlineRetryTimers, onAuthUserChange]);

  useEffect(() => {
    const handleOffline = () => {
      clearOnlineRetryTimers();
      setBrowserOffline(true);
      setIsDismissed(false);
    };

    const handleOnline = () => {
      setBrowserOffline(false);
      clearOnlineRetryTimers();
      void retryConnection().then((recovered) => {
        if (recovered) return;
        // Windows/Chromium often fires 'online' at Wi-Fi link-up before DHCP/DNS settles.
        for (const delayMs of [2000, 5000]) {
          const timer = setTimeout(() => {
            void retryConnection();
          }, delayMs);
          onlineRetryTimersRef.current.push(timer);
        }
      });
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      clearOnlineRetryTimers();
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [clearOnlineRetryTimers, retryConnection]);

  useEffect(() => {
    if (!isOffline) {
      clearOnlineRetryTimers();
      setIsDismissed(false);
      return;
    }
    const handleFocus = () => {
      if (typeof navigator === 'undefined' || navigator.onLine !== false) {
        void retryConnection();
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [clearOnlineRetryTimers, isOffline, retryConnection]);

  return {
    isOffline,
    showToast: isOffline && !isDismissed,
    dismissToast: () => setIsDismissed(true),
    retryConnection,
  };
}
