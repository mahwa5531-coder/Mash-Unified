"use client";

import { useState, useEffect, useRef, memo } from 'react';
import { Check, Copy, Undo2 } from 'lucide-react';
import { Message } from '@/types/chat';
import { cn } from '@/lib/utils';
import { cleanUserSteeringEnvelope } from '@/features/chat/utils/sessionHistoryParser';
import { parseAttachmentRefs } from '@/features/chat/utils/attachmentRefs';
import { FilePill } from '@/primitives';
import AgentMarkdown from '@/components/markdown/AgentMarkdown';
import { ImageLightboxModal, type LightboxImageData } from './ImageLightboxModal';

function formatUserTimestamp(ts?: string): string {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) {
      const isToday = new Date().toDateString() === d.toDateString();
      return isToday
        ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    }
    return ts.trim();
  } catch {
    return ts;
  }
}

// ----------------------------------------------------------------------
// memoize UserMessage so past turns never re-render during token streaming
const UserMessage = memo(function UserMessage({ 
  msg, 
  onUndo, 
  onOpenFile 
}: { 
  msg: Message; 
  onUndo: () => void; 
  onOpenFile?: (path: string) => void; 
}) {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<LightboxImageData | null>(null);
  const [latchedTime] = useState(() => 
    new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
  );
  const displayTime = (msg.timestamp && formatUserTimestamp(msg.timestamp)) || latchedTime;

  // Check if content has an inline image markdown link
  const imgMatch = msg.content ? msg.content.match(/!\[([^\]]*)\]\(([^)]+)\)/) : null;
  const contentWithoutMarkdownImg = imgMatch ? msg.content.replace(imgMatch[0], '') : (msg.content || '');

  // Parse attachments once cleanly using the pure attachment refs utility
  const { cleanText: parsedText, images: attachedImages, documents: attachedDocuments } = parseAttachmentRefs(contentWithoutMarkdownImg, msg.sessionId);
  const cleanText = cleanUserSteeringEnvelope(parsedText);

  const allImages = [
    ...(imgMatch ? [{ src: imgMatch[2], name: 'Attached image' }] : []),
    ...attachedImages.map((img) => ({ src: img.previewUrl || img.path, name: img.name })),
  ];

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
    navigator.clipboard.writeText(cleanText);
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
    <div className="w-full flex flex-col items-end group/user-turn">
      {/* 1. User Message Bubble (100% full width, zero buttons inside) */}
      <div 
        role={isOverflowing ? "button" : undefined}
        tabIndex={isOverflowing ? 0 : undefined}
        onClick={handleCardClick}
        onKeyDown={(e) => {
          if (isOverflowing && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setIsExpanded((prev) => !prev);
          }
        }}
        title={isOverflowing ? (isExpanded ? "Click to collapse" : "Click to expand") : undefined}
        className={cn(
          "w-full bg-[#f4f4f6] dark:bg-[#18181b]/90 hover:bg-[#eaecee] dark:hover:bg-[#1f1f23] rounded-2xl px-4 py-2.5 text-[13.5px] text-zinc-900 dark:text-zinc-100 border border-zinc-200/70 dark:border-white/[0.06] shadow-xs transition-colors flex items-start gap-3",
          isOverflowing && "cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400"
        )}
      >
        {/* Optional Image Thumbnail Preview */}
        {allImages.length > 0 && (
          <div className="flex items-center gap-1.5 shrink-0 select-none">
            {allImages.map((img, i) => (
              <div
                key={i}
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxImage({ src: img.src, alt: img.name });
                }}
                className="w-16 h-12 rounded-lg overflow-hidden border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900 shrink-0 select-none cursor-pointer hover:opacity-90 transition-opacity"
                title={`${img.name} (Click to expand)`}
              >
                <img src={img.src} alt={img.name} className="w-full h-full object-cover" />
              </div>
            ))}
          </div>
        )}

        {/* Content Body - Full Width */}
        <div className="flex-1 min-w-0">
          {/* Attached Files Chips */}
          {attachedDocuments.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mb-1.5 select-none">
              {attachedDocuments.map((doc, idx) => (
                <FilePill key={`${doc.path}_${idx}`} path={doc.path} label={doc.name} onOpenFile={onOpenFile} />
              ))}
            </div>
          )}

          {cleanText ? (
            cleanText.includes('> [!') || cleanText.includes('```') ? (
              <div 
                ref={textRef}
                className={cn(
                  "font-sans text-[13.5px] leading-relaxed select-text transition-all",
                  !isExpanded && isOverflowing && "line-clamp-2 max-h-[46px] overflow-hidden"
                )}
              >
                <AgentMarkdown content={cleanText} isStreaming={false} mode="chat" />
              </div>
            ) : (
              <div 
                ref={textRef}
                className={cn(
                  "font-sans text-[13.5px] leading-relaxed whitespace-pre-wrap break-words select-text transition-all",
                  !isExpanded && isOverflowing && "line-clamp-2 max-h-[46px] overflow-hidden"
                )}
              >
                {cleanText}
              </div>
            )
          ) : (
            <div className="font-sans text-[13px] text-zinc-400 italic">
              Attached documents
            </div>
          )}
        </div>
      </div>

      {/* 2. Outside Actions Bar (Timestamp, Copy, Undo) - Tiny, simple, small, with clean hover highlight */}
      <div className="flex items-center gap-1.5 mt-1 mr-1 px-1 h-5 text-zinc-400 dark:text-zinc-500 opacity-0 group-hover/user-turn:opacity-100 group-focus-within/user-turn:opacity-100 transition-opacity duration-150 select-none">
        {displayTime && (
          <span 
            className="text-[11px] font-mono tracking-tight font-medium select-none mr-0.5"
            title={msg.timestamp ? new Date(msg.timestamp).toLocaleString() : undefined}
          >
            {displayTime}
          </span>
        )}
        <button
          type="button"
          onClick={handleCopy}
          className="p-1 rounded text-zinc-400 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors cursor-pointer"
          title="Copy prompt"
        >
          {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
        </button>
        <div className="relative group/undo">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onUndo(); }}
            className="p-1 rounded text-zinc-400 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors cursor-pointer"
            title="Undo up to here"
          >
            <Undo2 size={12} />
          </button>
          <div className="absolute bottom-full mb-1.5 right-0 hidden group-hover/undo:block bg-zinc-900 dark:bg-[#1a1a1a] text-zinc-100 dark:text-zinc-200 text-[11px] px-2 py-0.5 rounded border border-zinc-800 dark:border-[#333] shadow-lg pointer-events-none whitespace-nowrap z-30 font-sans">
            Undo changes up to this point
          </div>
        </div>
      </div>

      {/* Image Lightbox Modal */}
      <ImageLightboxModal
        image={lightboxImage}
        onClose={() => setLightboxImage(null)}
        onOpenFile={onOpenFile}
      />
    </div>
  );
});

export default UserMessage;
