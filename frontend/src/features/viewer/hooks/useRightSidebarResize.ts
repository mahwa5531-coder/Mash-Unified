"use client";

import { useState, useRef, useCallback, useEffect, MouseEvent as ReactMouseEvent } from 'react';

const MIN_WIDTH = 320;
const MAX_WIDTH = 1100;
const DEFAULT_WIDTH = 420;

interface UseRightSidebarResizeProps {
  controlledIsMaximized?: boolean;
  onToggleMaximize?: () => void;
}

export function useRightSidebarResize({
  controlledIsMaximized,
  onToggleMaximize,
}: UseRightSidebarResizeProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [internalIsMaximized, setInternalIsMaximized] = useState(false);
  const isMaximized = controlledIsMaximized !== undefined ? controlledIsMaximized : internalIsMaximized;
  const prevWidthRef = useRef<number>(DEFAULT_WIDTH);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef(DEFAULT_WIDTH);

  const startResizing = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    let resizeRaf: number | null = null;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || isMaximized) return;
      let newWidth = window.innerWidth - e.clientX;
      if (newWidth < MIN_WIDTH) newWidth = MIN_WIDTH;
      const safeMax = Math.max(MIN_WIDTH, window.innerWidth - 420);
      if (newWidth > Math.min(MAX_WIDTH, safeMax)) newWidth = Math.min(MAX_WIDTH, safeMax);
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
