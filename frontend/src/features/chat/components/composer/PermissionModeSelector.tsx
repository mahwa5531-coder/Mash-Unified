"use client";

import React, { useState, useRef, useEffect } from 'react';
import { Shield, ShieldCheck, ShieldAlert, ChevronUp, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export type PermissionMode = 'turbo' | 'default' | 'review';

interface PermissionModeOption {
  id: PermissionMode;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
}

const PERMISSION_OPTIONS: PermissionModeOption[] = [
  {
    id: 'review',
    title: 'Request Review',
    subtitle: 'Every command requires approval.',
    icon: Shield,
  },
  {
    id: 'default',
    title: 'Default',
    subtitle: 'Ask before sensitive operations.',
    icon: ShieldCheck,
  },
  {
    id: 'turbo',
    title: 'Turbo',
    subtitle: 'Run all commands without restrictions.',
    icon: ShieldAlert,
  },
];

interface PermissionModeSelectorProps {
  mode: PermissionMode;
  onModeChange: (mode: PermissionMode) => void;
  disabled?: boolean;
}

export function PermissionModeSelector({
  mode = 'default',
  onModeChange,
  disabled = false,
}: PermissionModeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const activeOption = PERMISSION_OPTIONS.find((opt) => opt.id === mode) || PERMISSION_OPTIONS[1];
  const ActiveIcon = activeOption.icon;

  const handleSelect = (selectedMode: PermissionMode) => {
    onModeChange(selectedMode);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative inline-flex items-center">
      {/* Pill Button Trigger */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`Permission mode: ${activeOption.title}`}
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all select-none cursor-pointer",
          "bg-zinc-200/80 hover:bg-zinc-300/80 text-zinc-700",
          "dark:bg-[#27272a] dark:hover:bg-[#323236] dark:text-zinc-300",
          isOpen && "ring-1 ring-zinc-400 dark:ring-zinc-600",
          disabled && "opacity-50 cursor-not-allowed pointer-events-none"
        )}
      >
        <ActiveIcon size={13} className="shrink-0 text-zinc-600 dark:text-zinc-300" />
        <span className="leading-none text-[12px]">{activeOption.title}</span>
        <ChevronUp
          size={12}
          className={cn(
            "text-zinc-500 dark:text-zinc-400 shrink-0 transition-transform duration-150",
            isOpen ? "rotate-180" : "rotate-0"
          )}
        />
      </button>

      {/* Upward Floating Popover Menu */}
      {isOpen && (
        <div
          role="listbox"
          aria-label="Permission modes"
          className={cn(
            "absolute bottom-full right-0 mb-2 z-50 w-72 sm:w-80",
            "bg-white dark:bg-[#18181b]",
            "border border-zinc-200 dark:border-zinc-800",
            "rounded-xl p-1.5 shadow-2xl shadow-black/30 animate-in fade-in zoom-in-95 duration-100"
          )}
        >
          <div className="flex flex-col gap-0.5">
            {PERMISSION_OPTIONS.map((opt) => {
              const isSelected = opt.id === mode;
              const OptIcon = opt.icon;

              return (
                <button
                  key={opt.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(opt.id)}
                  className={cn(
                    "flex items-start gap-2.5 w-full text-left p-2 rounded-lg transition-colors cursor-pointer group",
                    isSelected
                      ? "bg-zinc-100 dark:bg-zinc-800/80"
                      : "hover:bg-zinc-100/70 dark:hover:bg-zinc-800/40"
                  )}
                >
                  <OptIcon
                    size={16}
                    className={cn(
                      "mt-0.5 shrink-0 transition-colors",
                      isSelected
                        ? "text-zinc-900 dark:text-zinc-100"
                        : "text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-800 dark:group-hover:text-zinc-200"
                    )}
                  />

                  <div className="flex flex-col flex-1 min-w-0 pr-1">
                    <span
                      className={cn(
                        "text-[13px] font-medium leading-tight",
                        isSelected
                          ? "text-zinc-900 dark:text-zinc-100 font-semibold"
                          : "text-zinc-800 dark:text-zinc-200"
                      )}
                    >
                      {opt.title}
                    </span>
                    <span className="text-[11.5px] text-zinc-500 dark:text-zinc-400 leading-tight mt-0.5">
                      {opt.subtitle}
                    </span>
                  </div>

                  {isSelected && (
                    <Check
                      size={14}
                      className="mt-0.5 shrink-0 text-zinc-900 dark:text-zinc-100"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
