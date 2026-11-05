"use client";

import { ArrowDown } from "lucide-react";

interface ScrollToBottomButtonProps {
  onClick: () => void;
}

export function ScrollToBottomButton({ onClick }: ScrollToBottomButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center justify-center size-8 rounded-full cursor-pointer select-none outline-none transition-all duration-150 active:scale-95 bg-zinc-900/90 hover:bg-zinc-800/90 dark:bg-[#1f1f23]/90 dark:hover:bg-[#27272b]/90 text-zinc-300 hover:text-white border border-zinc-700/60 dark:border-white/10 shadow-lg backdrop-blur-md"
      title="Scroll to bottom"
      aria-label="Scroll to bottom"
    >
      <ArrowDown size={15} className="text-zinc-300 group-hover:text-white transition-transform group-hover:translate-y-0.5" />
    </button>
  );
}
