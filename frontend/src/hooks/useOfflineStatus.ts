"use client";

import { useState, useEffect, useCallback } from 'react';
import { fetchAuthMe, syncAuthUsage, AuthUser } from '@/services/auth';

/** Tracks offline state, cloud sync errors, and live browser network transitions. */
export function useOfflineStatus(
  authUser: AuthUser | null,
  onAuthUserChange: (user: AuthUser) => void
) {
  const [browserOffline, setBrowserOffline] = useState<boolean>(
    () => typeof navigator !== 'undefined' && navigator.onLine === false
  );
  const [isDismissed, setIsDismissed] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  const isAuthenticated = Boolean(authUser?.authenticated);
  const isOffline = Boolean(authUser?.offline || browserOffline);
  const syncError = !isOffline ? authUser?.sync_error : undefined;

  const retryConnection = useCallback(async () => {
    const offlineNow = typeof navigator !== 'undefined' && navigator.onLine === false;
    setBrowserOffline(offlineNow);
    setIsRetrying(true);
    try {
      const user = !offlineNow && isAuthenticated
        ? await syncAuthUsage()
        : await fetchAuthMe();
      if (user && (user.authenticated || user.offline)) {
        onAuthUserChange(user);
        if (user.authenticated && !user.sync_error) {
          setBrowserOffline(false);
          setIsDismissed(false);
        }
      }
    } catch {
      // Remain in current offline/sync_error state while check fails
    } finally {
      setIsRetrying(false);
    }
  }, [isAuthenticated, onAuthUserChange]);

  useEffect(() => {
    const handleOffline = () => {
      setBrowserOffline(true);
      setIsDismissed(false);
    };

    const handleOnline = () => {
      setBrowserOffline(false);
      void retryConnection();
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [retryConnection]);

  useEffect(() => {
    if (!isOffline && !syncError) {
      setIsDismissed(false);
      return;
    }
    const handleFocus = () => {
      if (isOffline && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
        void retryConnection();
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [isOffline, syncError, retryConnection]);

  return {
    isOffline,
    syncError,
    isRetrying,
    showToast: (isOffline || Boolean(syncError)) && !isDismissed,
    dismissToast: () => setIsDismissed(true),
    retryConnection: () => {
      setIsDismissed(false);
      void retryConnection();
    },
  };
}
