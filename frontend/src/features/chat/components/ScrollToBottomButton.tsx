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
      className="flex items-center justify-center w-8 h-8 rounded-full bg-[#202022] hover:bg-[#2c2c30] text-zinc-300 hover:text-white border border-zinc-700/60 shadow-lg cursor-pointer transition-all active:scale-95"
      title="Scroll to bottom"
      aria-label="Scroll to bottom"
    >
      <ArrowDown size={15} />
    </button>
  );
}
