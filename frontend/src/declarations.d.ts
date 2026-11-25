// Global custom declarations
declare global {
  interface BackendStatusPayload {
    status: 'starting' | 'ready' | 'restarting' | 'error';
    message?: string;
    detail?: string;
    port?: number;
  }

  interface Window {
    electronAPI?: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      isMaximized: () => boolean;
      onMaximizeChange: (callback: (isMaximized: boolean) => void) => () => void;
      openPath: (path: string) => Promise<string | undefined>;
      getPathForFile: (file: File) => string | null;
      restartAndInstall: () => void;
      selectFolder?: () => Promise<string | null>;
      getBackendStatus?: () => BackendStatusPayload;
      onBackendStatus?: (callback: (data: BackendStatusPayload) => void) => () => void;
      restartBackend?: () => Promise<{ ok: boolean; error?: string }>;
      openLogsFolder?: () => Promise<string | undefined>;
      onUpdateDownloading: (callback: (data: { progress: number }) => void) => () => void;
      onUpdateReady: (callback: (data: { version: string }) => void) => () => void;
    };
    __MASH_DESKTOP__?: {
      apiUrl: string;
      platform: string;
      isDesktop: boolean;
      version?: string;
      selectFolder?: () => Promise<string | null>;
    };
    __TAURI__?: any;
    pywebview?: any;
  }
}

export {};
