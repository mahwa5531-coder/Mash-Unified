// Global custom declarations
declare global {
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
      onUpdateDownloading: (callback: (data: { progress: number }) => void) => () => void;
      onUpdateReady: (callback: (data: { version: string }) => void) => () => void;
    };
    __MASH_DESKTOP__?: {
      apiUrl: string;
      platform: string;
      isDesktop: boolean;
    };
    __TAURI__?: any;
    pywebview?: any;
  }
}

export {};
