"use client";

import React from 'react';
import { ChevronDown, ChevronUp, ArrowRight, Pencil, Trash2, Zap } from 'lucide-react';

interface SteeringQueueBannerProps {
  queuedMessages?: string[];
  queuedMessage?: string | null;
  isQueueExpanded: boolean;
  isPaused?: boolean;
  onResumeQueue?: () => void;
  onToggleExpand: () => void;
  onInject: (index?: number) => void;
  onEdit: (index?: number) => void;
  onDiscard: (index?: number) => void;
}

export function SteeringQueueBanner({
  queuedMessages,
  queuedMessage,
  isQueueExpanded,
  isPaused = false,
  onResumeQueue,
  onToggleExpand,
  onInject,
  onEdit,
  onDiscard,
}: SteeringQueueBannerProps) {
  // Normalize messages list
  const items: string[] = queuedMessages && queuedMessages.length > 0
    ? queuedMessages
    : queuedMessage
      ? [queuedMessage]
      : [];

  if (items.length === 0) return null;

  return (
    <div className="w-full bg-white/95 dark:bg-[#181818]/95 border border-zinc-200 dark:border-[#27272a] rounded-2xl p-3.5 mb-2 shadow-xl backdrop-blur-md transition-all animate-in fade-in slide-in-from-bottom-2">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isPaused ? (
            <span className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
              Queue Paused (Run Stopped)
            </span>
          ) : (
            <span className="text-[13px] font-medium text-zinc-800 dark:text-zinc-200">Queued Messages</span>
          )}
          <span className="px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700/60 text-[10px] text-zinc-600 dark:text-zinc-400 font-mono flex items-center justify-center leading-none font-semibold">
            {items.length}
          </span>
          <span className="text-xs text-zinc-500 font-normal ml-0.5 hidden sm:inline">
            {isPaused ? "Run stopped with pending queue. Resume when ready or clear." : (
              <>Sends after agent finishes, or click <Zap size={11} className="inline mx-0.5 text-amber-500 fill-amber-500" /> to steer now</>
            )}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {isPaused && (
            <>
              <button
                type="button"
                onClick={onResumeQueue || (() => onInject(0))}
                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer shadow-sm"
                title="Resume queue execution"
              >
                <ArrowRight size={12} />
                Resume Queue
              </button>
              <button
                type="button"
                onClick={() => onDiscard()}
                className="px-2 py-1 bg-zinc-100 hover:bg-red-500 hover:text-white dark:bg-zinc-800 dark:hover:bg-red-600 text-zinc-700 dark:text-zinc-300 rounded text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
                title="Clear all queued messages"
              >
                <Trash2 size={12} />
                Clear
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onToggleExpand}
            aria-expanded={isQueueExpanded}
            aria-label={isQueueExpanded ? "Collapse queued messages" : "Expand queued messages"}
            className="text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 p-0.5 transition-colors cursor-pointer"
            title={isQueueExpanded ? "Collapse" : "Expand"}
          >
            {isQueueExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </div>

      {/* Messages list */}
      {isQueueExpanded && (
        <div className="flex flex-col gap-2 mt-2 pt-1 border-t border-zinc-200 dark:border-zinc-800/60 divide-y divide-zinc-100 dark:divide-zinc-800/40">
          {items.map((msg, idx) => (
            <div key={idx} className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2 min-w-0 pr-3">
                {items.length > 1 && (
                  <span className="text-[10px] font-mono text-zinc-400 shrink-0 select-none">
                    #{idx + 1}
                  </span>
                )}
                <span className="text-[13px] text-zinc-800 dark:text-zinc-300 font-sans break-words line-clamp-2">
                  {msg}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400 shrink-0">
                <button
                  type="button"
                  onClick={() => onInject(idx)}
                  className="p-1 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 rounded transition-colors cursor-pointer group"
                  aria-label={`Send now to inject message #${idx + 1} into active agent`}
                  title="Send now (inject into running agent)"
                >
                  <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                </button>
                <button
                  type="button"
                  onClick={() => onEdit(idx)}
                  className="p-1 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 rounded transition-colors cursor-pointer"
                  aria-label={`Edit message #${idx + 1}`}
                  title="Edit message"
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => onDiscard(idx)}
                  className="p-1 hover:text-red-500 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 rounded transition-colors cursor-pointer"
                  aria-label={`Delete message #${idx + 1} from queue`}
                  title="Delete from queue"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
