"use client";

import { useState, useEffect } from 'react';
import { BASE_URL } from '@/services/client';

export type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready';

export interface UpdateState {
  status: UpdateStatus;
  progress?: number;
  version?: string;
}

export function useDesktopAutoUpdate() {
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 1. Electron Native IPC Listeners
    const electron = (window as any).electronAPI;
    if (electron?.onUpdateDownloading) {
      electron.onUpdateDownloading((data: { progress?: number; version?: string }) => {
        setUpdateState({
          status: 'downloading',
          progress: data?.progress,
          version: data?.version,
        });
      });
    }

    if (electron?.onUpdateReady) {
      electron.onUpdateReady((data: { version?: string }) => {
        setUpdateState({
          status: 'ready',
          version: data?.version,
        });
      });
    }

    // 2. Custom Event Bridge (for dev testing & state inspection)
    const handleCustomUpdate = (e: Event) => {
      const custom = e as CustomEvent<UpdateState>;
      if (custom.detail) {
        setUpdateState(custom.detail);
      }
    };
    window.addEventListener('mash:update-state', handleCustomUpdate as EventListener);

    // 3. Connector API check (when running outside packaged Electron)
    let isMounted = true;
    let intervalId: any = null;

    if (!electron) {
      const pollUpdates = () => {
        fetch(`${BASE_URL}/api/system/updates`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (isMounted && data?.status) {
              setUpdateState({
                status: data.status,
                version: data.version,
                progress: data.progress,
              });
            }
          })
          .catch(() => {});
      };

      pollUpdates();
      intervalId = setInterval(pollUpdates, 2500);
    }

    return () => {
      isMounted = false;
      if (intervalId) clearInterval(intervalId);
      window.removeEventListener('mash:update-state', handleCustomUpdate as EventListener);
    };
  }, []);

  const handleRestart = async () => {
    if (typeof window !== 'undefined') {
      const electron = (window as any).electronAPI;
      if (electron?.restartAndInstall) {
        electron.restartAndInstall();
        return;
      }
      // HTTP connector fallback
      try {
        await fetch(`${BASE_URL}/api/system/updates/restart`, { method: 'POST' });
      } catch {}
      // Reset state upon restart trigger
      setUpdateState({ status: 'idle' });
    }
  };

  return { updateState, handleRestart, setUpdateState };
}
