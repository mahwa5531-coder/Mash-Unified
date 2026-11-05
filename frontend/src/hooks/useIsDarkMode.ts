"use client";

import { useState, useEffect } from 'react';

function getIsDark(): boolean {
  if (typeof document === 'undefined') return true;
  return document.documentElement.classList.contains('dark') ||
         document.documentElement.getAttribute('data-theme') === 'dark';
}

const themeListeners = new Set<(dark: boolean) => void>();
let sharedObserver: MutationObserver | null = null;

function ensureObserver() {
  if (sharedObserver || typeof document === 'undefined') return;
  sharedObserver = new MutationObserver(() => {
    const dark = getIsDark();
    themeListeners.forEach((fn) => fn(dark));
  });
  sharedObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme'],
  });
}

// ponytail: Shared singleton MutationObserver avoids O(N) observers across dozens of CodeBlock instances
export function useIsDarkMode(): boolean {
  const [isDark, setIsDark] = useState<boolean>(getIsDark);

  useEffect(() => {
    setIsDark(getIsDark());
    themeListeners.add(setIsDark);
    ensureObserver();

    return () => {
      themeListeners.delete(setIsDark);
      if (themeListeners.size === 0 && sharedObserver) {
        sharedObserver.disconnect();
        sharedObserver = null;
      }
    };
  }, []);

  return isDark;
}
