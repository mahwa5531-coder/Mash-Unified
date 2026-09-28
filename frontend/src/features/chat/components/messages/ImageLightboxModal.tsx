"use client";

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, ExternalLink, X } from 'lucide-react';

export interface LightboxImageData {
  src: string;
  alt: string;
  path?: string;
}

export interface ImageLightboxModalProps {
  image: LightboxImageData | null;
  onClose: () => void;
  onOpenFile?: (path: string) => void;
}

export function ImageLightboxModal({
  image,
  onClose,
  onOpenFile,
}: ImageLightboxModalProps) {
  useEffect(() => {
    if (!image) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [image, onClose]);

  if (!image || typeof document === 'undefined') return null;

  return createPortal(
    <div 
      className="fixed inset-0 z-[99999] bg-black/80 backdrop-blur-md flex flex-col items-center justify-center p-4 sm:p-8 select-none animate-in fade-in duration-150"
      onClick={onClose}
    >
      {/* Top Floating Control Bar */}
      <div 
        className="absolute top-4 right-4 flex items-center gap-2 z-10"
        onClick={(e) => e.stopPropagation()}
      >
        {image.path && onOpenFile && (
          <button
            type="button"
            onClick={() => {
              onOpenFile(image.path!);
              onClose();
            }}
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium backdrop-blur-md transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
            title="Open in Right Sidebar Viewer"
          >
            <span>Open in Sidebar</span>
            <ArrowUpRight size={13} />
          </button>
        )}
        <a
          href={image.src}
          target="_blank"
          rel="noopener noreferrer"
          className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors cursor-pointer shadow-sm"
          title="Open full resolution in new tab"
        >
          <ExternalLink size={15} />
        </a>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-full bg-white/15 hover:bg-white/25 text-white/90 hover:text-white transition-colors cursor-pointer shadow-sm"
          title="Close (Esc or click outside)"
          aria-label="Close image preview"
        >
          <X size={16} />
        </button>
      </div>

      {/* Modal Center Image Box */}
      <div 
        className="max-w-[94vw] max-h-[88vh] flex flex-col items-center justify-center relative cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        <img 
          src={image.src} 
          alt={image.alt || 'Visual Chart'} 
          className="max-w-full max-h-[80vh] object-contain rounded-xl shadow-2xl border border-white/10 select-text"
        />
        {image.alt && (
          <div className="mt-3 px-4 py-1.5 rounded-full bg-black/60 backdrop-blur-md text-white/90 text-xs font-medium text-center max-w-xl truncate border border-white/10 shadow-lg">
            {image.alt}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
