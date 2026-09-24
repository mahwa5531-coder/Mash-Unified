"use client";

import { useState, useEffect, useRef, memo } from 'react';
import { Check, Copy, Undo2 } from 'lucide-react';
import { Message } from '@/lib/types';
import { cn } from '@/lib/utils';

function formatUserTimestamp(ts?: string): string {
  if (!ts) return '';
  try {
    if (/^\d{1,2}:\d{2}(\s?[APap][Mm])?$/.test(ts.trim())) {
      return ts.trim();
    }
    const d = new Date(ts);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    }
    return ts;
  } catch {
    return ts;
  }
}

// ----------------------------------------------------------------------
// ponytail: memoize UserMessage so past turns never re-render during token streaming
const UserMessage = memo(function UserMessage({ msg, onUndo }: { msg: Message, onUndo: () => void }) {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [latchedTime] = useState(() => 
    new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
  );
  const displayTime = (msg.timestamp && formatUserTimestamp(msg.timestamp)) || latchedTime;

  // Check if content has an image markdown link or path
  const imgMatch = msg.content ? msg.content.match(/!\[([^\]]*)\]\(([^)]+)\)/) : null;
  const cleanText = imgMatch ? msg.content.replace(imgMatch[0], '').trim() : msg.content;
  const imgSrc = imgMatch ? imgMatch[2] : null;

  useEffect(() => {
    if (textRef.current) {
      const lines = cleanText.split('\n');
      const nonBlankParagraphs = lines.filter((l) => l.trim().length > 0).length;
      const hasMultipleParagraphs = nonBlankParagraphs > 1;
      const hasLineBreakOverflow = lines.length > 3;
      const hasHeightOverflow = textRef.current.scrollHeight > 72;
      setIsOverflowing(hasMultipleParagraphs || hasLineBreakOverflow || hasHeightOverflow);
    }
  }, [cleanText]);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleCardClick = () => {
    if (!isOverflowing) return;
    const selection = window.getSelection()?.toString();
    if (selection && selection.length > 0) return;
    setIsExpanded((prev) => !prev);
  };

  return (
    <div className="w-full">
      <div 
        onClick={handleCardClick}
        title={isOverflowing ? (isExpanded ? "Click to collapse" : "Click to expand") : undefined}
        className={cn(
          "w-full bg-[#f4f4f6] dark:bg-[#18181b]/90 hover:bg-[#eaecee] dark:hover:bg-[#1f1f23] rounded-2xl px-4 py-2.5 text-[13.5px] text-zinc-900 dark:text-zinc-100 border border-zinc-200/70 dark:border-white/[0.06] shadow-xs relative group transition-colors flex items-start gap-3",
          isOverflowing && "cursor-pointer"
        )}
      >
        {/* Optional Image Thumbnail Preview */}
        {imgSrc && (
          <div className="w-16 h-12 rounded-lg overflow-hidden border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900 shrink-0 select-none">
            <img src={imgSrc} alt="Attached image" className="w-full h-full object-cover" />
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 min-w-0 pr-28 pb-0.5">
          <div 
            ref={textRef}
            className={cn(
              "whitespace-pre-wrap font-sans text-[13.5px] leading-[22px] text-zinc-900 dark:text-zinc-200 break-words select-text transition-all",
              !isExpanded && isOverflowing && "line-clamp-3 overflow-hidden"
            )}
          >
            {cleanText}
          </div>
        </div>

        {/* Bottom-Right Actions Bar (Timestamp, Copy, Undo) */}
        <div className="absolute bottom-2 right-3 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 select-none pointer-events-none group-hover:pointer-events-auto">
          {displayTime && (
            <span className="text-[11.5px] font-mono text-sky-600 dark:text-sky-400 select-none mr-0.5 tracking-tight font-medium">
              {displayTime}
            </span>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className="p-1 rounded text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-black/[0.06] dark:hover:bg-[#242424] transition-colors cursor-pointer"
            title="Copy prompt"
          >
            {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12.5} />}
          </button>
          <div className="relative group/undo">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onUndo(); }}
              className="p-1 rounded text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-black/[0.06] dark:hover:bg-[#242424] transition-colors cursor-pointer"
              title="Undo up to here"
            >
              <Undo2 size={13} />
            </button>
            <div className="absolute bottom-full mb-1.5 right-0 hidden group-hover/undo:block bg-zinc-900 dark:bg-[#1a1a1a] text-zinc-100 dark:text-zinc-200 text-[11px] px-2 py-0.5 rounded border border-zinc-800 dark:border-[#333] shadow-lg pointer-events-none whitespace-nowrap z-30 font-sans">
              Undo changes up to this point
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}, (prev, next) => prev.msg.content === next.msg.content && prev.msg.timestamp === next.msg.timestamp);

export default UserMessage;
