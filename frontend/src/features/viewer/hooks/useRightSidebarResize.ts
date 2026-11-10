"use client";

import { useState, useRef, useCallback, useEffect, MouseEvent as ReactMouseEvent } from 'react';

const MIN_WIDTH = 340;
const MAX_WIDTH = 760;
const DEFAULT_WIDTH = 360;

interface UseRightSidebarResizeProps {
  controlledIsMaximized?: boolean;
  onToggleMaximize?: () => void;
}

export function useRightSidebarResize({
  controlledIsMaximized,
  onToggleMaximize,
}: UseRightSidebarResizeProps) {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('mash_right_sidebar_width');
        if (saved) {
          const parsed = parseInt(saved, 10);
          if (!isNaN(parsed)) return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed));
        }
      } catch {}
    }
    return DEFAULT_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);
  const [internalIsMaximized, setInternalIsMaximized] = useState(false);
  const isMaximized = controlledIsMaximized !== undefined ? controlledIsMaximized : internalIsMaximized;
  const prevWidthRef = useRef<number>(width);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef(width);

  const startResizing = useCallback((e: ReactMouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    let resizeRaf: number | null = null;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || isMaximized) return;
      let newWidth = window.innerWidth - e.clientX;
      if (newWidth < MIN_WIDTH) newWidth = MIN_WIDTH;
      // Reserve at least 280px for left sidebar + 400px for center chat = 680px minimum non-right-sidebar space
      const safeMax = Math.max(MIN_WIDTH, window.innerWidth - 680);
      const effectiveMax = Math.min(MAX_WIDTH, safeMax);
      if (newWidth > effectiveMax) newWidth = effectiveMax;
      widthRef.current = newWidth;

      if (resizeRaf === null) {
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = null;
          if (sidebarRef.current) {
            sidebarRef.current.style.width = `${widthRef.current}px`;
          }
        });
      }
    };

    const handleMouseUp = () => {
      if (resizeRaf !== null) {
        cancelAnimationFrame(resizeRaf);
        resizeRaf = null;
      }
      if (isResizing) {
        setWidth(widthRef.current);
        try {
          localStorage.setItem('mash_right_sidebar_width', String(widthRef.current));
        } catch {}
      }
      setIsResizing(false);
    };

    if (isResizing) {
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
      const iframes = document.querySelectorAll('iframe, embed, object');
      iframes.forEach((el) => ((el as HTMLElement).style.pointerEvents = 'none'));

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      if (resizeRaf !== null) {
        cancelAnimationFrame(resizeRaf);
        resizeRaf = null;
      }
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      const iframes = document.querySelectorAll('iframe, embed, object');
      iframes.forEach((el) => ((el as HTMLElement).style.pointerEvents = ''));

      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, isMaximized]);

  const handleToggleMaximize = useCallback(() => {
    if (onToggleMaximize) {
      onToggleMaximize();
    } else {
      if (internalIsMaximized) {
        setWidth(prevWidthRef.current || DEFAULT_WIDTH);
        setInternalIsMaximized(false);
      } else {
        prevWidthRef.current = width;
        setInternalIsMaximized(true);
      }
    }
  }, [onToggleMaximize, internalIsMaximized, width]);

  return {
    width,
    isResizing,
    isMaximized,
    sidebarRef,
    startResizing,
    handleToggleMaximize,
  };
}
