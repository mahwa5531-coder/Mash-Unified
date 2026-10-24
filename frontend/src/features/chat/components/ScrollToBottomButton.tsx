"use client";

import { ChevronDown } from "lucide-react";

interface ScrollToBottomButtonProps {
  onClick: () => void;
}

export function ScrollToBottomButton({ onClick }: ScrollToBottomButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group inline-flex items-center gap-1.5 h-7 px-3 rounded-full font-sans text-xs font-medium leading-none select-none outline-none transition-all duration-150 cursor-pointer active:scale-95 bg-zinc-900/90 hover:bg-zinc-800/90 dark:bg-[#1f1f23]/90 dark:hover:bg-[#27272b]/90 text-zinc-200 hover:text-white border border-zinc-700/60 dark:border-white/10 shadow-lg backdrop-blur-md"
      title="Jump to latest"
      aria-label="Jump to latest"
    >
      <span>Jump to latest</span>
      <ChevronDown size={13} className="text-zinc-400 group-hover:text-zinc-200 transition-transform group-hover:translate-y-0.5" />
    </button>
  );
}
