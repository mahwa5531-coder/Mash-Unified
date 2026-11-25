"use client";

import { useState, useEffect, useCallback } from 'react';
import { fetchAuthMe, AuthUser } from '@/services/auth';

/** Tracks offline state from both auth cold-boot and live browser network events. */
export function useOfflineStatus(
  authUser: AuthUser | null,
  onAuthUserChange: (user: AuthUser) => void
) {
  const [browserOffline, setBrowserOffline] = useState<boolean>(
    () => typeof navigator !== 'undefined' && navigator.onLine === false
  );
  const [isDismissed, setIsDismissed] = useState(false);

  const isOffline = Boolean(authUser?.offline || browserOffline);

  const retryConnection = useCallback(async () => {
    setBrowserOffline(typeof navigator !== 'undefined' && navigator.onLine === false);
    try {
      const user = await fetchAuthMe();
      if (user && (user.authenticated || user.offline)) {
        onAuthUserChange(user);
        if (user.authenticated) {
          setBrowserOffline(false);
          setIsDismissed(false);
        }
      }
    } catch {
      // Remain in current offline state while network check fails
    }
  }, [onAuthUserChange]);

  useEffect(() => {
    const handleOffline = () => {
      setBrowserOffline(true);
      setIsDismissed(false);
    };

    const handleOnline = () => {
      setBrowserOffline(false);
      retryConnection();
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [retryConnection]);

  useEffect(() => {
    if (!isOffline) {
      setIsDismissed(false);
      return;
    }
    const handleFocus = () => {
      if (typeof navigator === 'undefined' || navigator.onLine !== false) {
        retryConnection();
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [isOffline, retryConnection]);

  return {
    isOffline,
    showToast: isOffline && !isDismissed,
    dismissToast: () => setIsDismissed(true),
    retryConnection: () => {
      setIsDismissed(false);
      retryConnection();
    },
  };
}
