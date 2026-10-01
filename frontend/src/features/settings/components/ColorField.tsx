"use client";

import React, { useRef } from 'react';

interface ColorFieldProps {
  label: string;
  value: string;
  onChange: (val: string) => void;
}

/** Theme accent color picker field with swatch preview and hex input */
export function ColorField({ label, value, onChange }: ColorFieldProps) {
  const colorInputRef = useRef<HTMLInputElement>(null);
  const cleanHex = value.startsWith('#') ? value : `#${value}`;

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-zinc-700 dark:text-zinc-300 font-normal text-[13px]">{label}</span>
      <div 
        onClick={() => colorInputRef.current?.click()}
        className="flex items-center gap-2 bg-white dark:bg-[#202023] hover:bg-zinc-100 dark:hover:bg-[#252529] border border-zinc-200 dark:border-[#2e2e32] hover:border-zinc-300 dark:hover:border-[#3e3e44] rounded-lg px-2.5 py-1.5 cursor-pointer transition-colors"
      >
        <div 
          className="w-3.5 h-3.5 rounded-[3px] border border-black/20 shrink-0 shadow-sm"
          style={{ backgroundColor: cleanHex }}
        />
        <input
          ref={colorInputRef}
          type="color"
          value={cleanHex.length === 7 ? cleanHex : '#101010'}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="sr-only"
        />
        <span className="text-zinc-400 font-mono text-xs select-none">#</span>
        <input
          type="text"
          value={cleanHex.replace(/^#/, '')}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9A-Fa-f]/g, '').slice(0, 6);
            onChange('#' + raw.toUpperCase());
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-16 bg-transparent text-zinc-800 dark:text-zinc-200 font-mono text-xs outline-none uppercase tracking-wider"
          maxLength={6}
        />
      </div>
    </div>
  );
}
