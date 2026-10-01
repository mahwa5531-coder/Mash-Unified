"use client";

import React from 'react';
import { ChevronDown, ChevronUp, ArrowRight, Pencil, Trash2 } from 'lucide-react';

interface SteeringQueueBannerProps {
  queuedMessage: string | null;
  isQueueExpanded: boolean;
  onToggleExpand: () => void;
  onInject: () => void;
  onEdit: () => void;
  onDiscard: () => void;
}

export function SteeringQueueBanner({
  queuedMessage,
  isQueueExpanded,
  onToggleExpand,
  onInject,
  onEdit,
  onDiscard,
}: SteeringQueueBannerProps) {
  if (!queuedMessage) return null;

  return (
    <div className="w-full bg-white/95 dark:bg-[#181818]/95 border border-zinc-200 dark:border-[#27272a] rounded-2xl p-3.5 mb-2 shadow-xl backdrop-blur-md transition-all animate-in fade-in slide-in-from-bottom-2">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-zinc-800 dark:text-zinc-200">Queued Messages</span>
          <span className="px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700/60 text-[10px] text-zinc-600 dark:text-zinc-400 font-mono flex items-center justify-center leading-none">
            1
          </span>
          <span className="text-xs text-zinc-500 font-normal ml-0.5">Sends after agent finishes working</span>
        </div>
        <button
          type="button"
          onClick={onToggleExpand}
          className="text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 p-0.5 transition-colors cursor-pointer"
          title={isQueueExpanded ? "Collapse" : "Expand"}
        >
          {isQueueExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </div>

      {/* Message row */}
      {isQueueExpanded && (
        <div className="flex items-center justify-between pt-2.5 mt-2 border-t border-zinc-200 dark:border-zinc-800/60">
          <span className="text-[13px] text-zinc-800 dark:text-zinc-300 font-sans break-words pr-4 truncate">
            {queuedMessage}
          </span>
          <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 shrink-0">
            <button
              type="button"
              onClick={onInject}
              className="p-1 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 rounded transition-colors cursor-pointer"
              title="Send now (inject into running agent)"
            >
              <ArrowRight size={15} />
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="p-1 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 rounded transition-colors cursor-pointer"
              title="Edit message"
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              onClick={onDiscard}
              className="p-1 hover:text-red-500 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 rounded transition-colors cursor-pointer"
              title="Delete"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
