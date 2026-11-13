"use client";

import { useState, useRef, useCallback, MouseEvent as ReactMouseEvent } from 'react';

const MIN_WIDTH = 280;
const MAX_WIDTH = 380;
const DEFAULT_WIDTH = 280;

interface UseSidebarResizeProps {
  controlledWidth?: number;
  onWidthChange?: (width: number) => void;
}

export function useSidebarResize({
  controlledWidth,
  onWidthChange,
}: UseSidebarResizeProps) {
  const [internalWidth, setInternalWidth] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('mash_sidebar_width');
        if (saved) {
          const parsed = parseInt(saved, 10);
          if (!isNaN(parsed)) return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed));
        }
      } catch {}
    }
    return DEFAULT_WIDTH;
  });
  const effectiveWidth = controlledWidth !== undefined ? controlledWidth : internalWidth;
  const isResizingRef = useRef<boolean>(false);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(DEFAULT_WIDTH);

  const startResizing = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = effectiveWidth;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    let resizeRaf: number | null = null;
    let pendingWidth = effectiveWidth;

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = ev.clientX - startXRef.current;
      pendingWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidthRef.current + delta));

      if (resizeRaf === null) {
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = null;
          if (onWidthChange) {
            onWidthChange(pendingWidth);
          } else {
            setInternalWidth(pendingWidth);
          }
        });
      }
    };

    const handleMouseUp = () => {
      if (resizeRaf !== null) {
        cancelAnimationFrame(resizeRaf);
        resizeRaf = null;
      }
      isResizingRef.current = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      try {
        localStorage.setItem('mash_sidebar_width', String(pendingWidth));
      } catch {}
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [effectiveWidth, onWidthChange]);

  return {
    width: effectiveWidth,
    startResizing,
  };
}
