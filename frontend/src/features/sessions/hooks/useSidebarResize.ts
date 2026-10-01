"use client";

import { useState, useRef, useCallback, MouseEvent as ReactMouseEvent } from 'react';

const MIN_WIDTH = 220;
const MAX_WIDTH = 450;

interface UseSidebarResizeProps {
  controlledWidth?: number;
  onWidthChange?: (width: number) => void;
}

export function useSidebarResize({
  controlledWidth,
  onWidthChange,
}: UseSidebarResizeProps) {
  const [internalWidth, setInternalWidth] = useState<number>(260);
  const effectiveWidth = controlledWidth !== undefined ? controlledWidth : internalWidth;
  const isResizingRef = useRef<boolean>(false);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(260);

  const startResizing = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = effectiveWidth;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = ev.clientX - startXRef.current;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidthRef.current + delta));
      if (onWidthChange) {
        onWidthChange(newWidth);
      } else {
        setInternalWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [effectiveWidth, onWidthChange]);

  return {
    width: effectiveWidth,
    startResizing,
  };
}
