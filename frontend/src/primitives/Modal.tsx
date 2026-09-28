"use client";

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './Button';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl';
  showCloseButton?: boolean;
  className?: string;
}

const MAX_WIDTH_MAP = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
};

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  icon,
  children,
  maxWidth = 'sm',
  showCloseButton = true,
  className,
}: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Close on Escape key & lock body scroll
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const content = (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-100"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "w-full rounded-2xl bg-[var(--m-bg-surface)] border border-[var(--m-border)] p-5 shadow-2xl font-sans text-[var(--m-text-primary)] animate-in zoom-in-95 duration-100 relative",
          MAX_WIDTH_MAP[maxWidth],
          className
        )}
      >
        {/* Header */}
        {(title || icon || showCloseButton) && (
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-center gap-2.5">
              {icon && (
                <div className="p-2 rounded-lg bg-[var(--m-bg-surface-hover)] text-[var(--m-text-primary)] shrink-0">
                  {icon}
                </div>
              )}
              <div>
                {title && (
                  <h3 className="text-[14px] font-semibold text-[var(--m-text-primary)]">
                    {title}
                  </h3>
                )}
                {description && (
                  <p className="text-[11.5px] text-[var(--m-text-muted)] mt-0.5">
                    {description}
                  </p>
                )}
              </div>
            </div>

            {showCloseButton && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="text-[var(--m-text-muted)] hover:text-[var(--m-text-primary)] -mr-1 -mt-1"
                aria-label="Close"
              >
                <X size={14} />
              </Button>
            )}
          </div>
        )}

        {/* Content Body */}
        {children}
      </div>
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(content, document.body);
  }

  return content;
}

export default Modal;
