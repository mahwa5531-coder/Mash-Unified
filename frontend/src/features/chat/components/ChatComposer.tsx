"use client";

import { useState, useRef, useEffect } from 'react';
import type { KeyboardEvent, DragEvent } from 'react';
import { useChatAttachments, type AttachedFile } from '@/features/chat/hooks/useChatAttachments';
import { AttachedFilesList } from './composer/AttachedFilesList';
import { ComposerActions } from './composer/ComposerActions';
import type { PermissionMode } from './composer/PermissionModeSelector';

export type { AttachedFile };

export interface ChatComposerProps {
  sessionId?: string | null;
  inputPrompt?: string;
  setInputPrompt?: (val: string) => void;
  onSend: (text: string, stagedSessionId?: string) => Promise<void> | void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  sessionRepo?: string;
  onInvalidMedia?: (show: boolean, reason?: string) => void;
  initialAttachedFiles?: AttachedFile[];
  permissionMode?: PermissionMode;
  onPermissionModeChange?: (mode: PermissionMode) => void;
}

// ponytail: DeepSeek Harness relative path normalizer - posix slashes + workspace relativization
export function relativizePath(fullPath: string, workspaceRoot?: string): string {
  const normPath = fullPath.replace(/\\/g, '/');
  if (!workspaceRoot || workspaceRoot === 'No Repo') return normPath;
  const normRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normPath.toLowerCase().startsWith(normRoot.toLowerCase() + '/')) {
    return normPath.slice(normRoot.length + 1);
  }
  return normPath;
}

export default function ChatComposer({
  sessionId,
  inputPrompt = '',
  setInputPrompt,
  onSend,
  onStop,
  isStreaming,
  disabled = false,
  sessionRepo,
  onInvalidMedia,
  initialAttachedFiles,
  permissionMode,
  onPermissionModeChange,
}: ChatComposerProps) {
  const [localPrompt, setLocalPrompt] = useState<string>(inputPrompt);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isSubmittingRef = useRef<boolean>(false);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  const {
    attachedFiles,
    isUploading,
    uploadError,
    setUploadError,
    setAttachedFiles,
    stagedSessionId,
    fileInputRef,
    handleFileChange,
    handlePaste,
    handleUploadFiles,
    removeAttachedFile,
    clearAttachments,
  } = useChatAttachments(sessionId, {
    onInvalidMedia,
    initialFiles: initialAttachedFiles,
  });

  // Sync when parent changes inputPrompt (e.g. on Undo or reset)
  useEffect(() => {
    setLocalPrompt(inputPrompt);
  }, [inputPrompt]);

  // Auto-resize textarea to fit content cleanly up to 220px without layout thrashing
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (!localPrompt) {
      el.style.height = 'auto';
      return;
    }
    const rafId = requestAnimationFrame(() => {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
    });
    return () => cancelAnimationFrame(rafId);
  }, [localPrompt]);

  const handleSendClick = async () => {
    // Synchronous submission lock to prevent double-Enter race conditions and upload races
    if (isSubmittingRef.current || isUploading) return;
    let text = localPrompt.trim();
    if (!text && attachedFiles.length === 0) return;

    const savedPrompt = localPrompt;
    const savedAttachments = [...attachedFiles];

    // ponytail: Format attachments as clean structured XML blocks with normalized POSIX paths (DeepSeek Harness convention)
    if (attachedFiles.length > 0) {
      const fileRefs = attachedFiles
        .map((f) => {
          const relPath = relativizePath(f.path, sessionRepo);
          return `  <file path="${relPath}" name="${f.name}" size="${f.size || 0}" />`;
        })
        .join('\n');
      const attachmentBlock = `<attachments>\n${fileRefs}\n</attachments>`;
      text = text ? `${text}\n\n${attachmentBlock}` : `Please inspect and analyze the attached audit documents:\n${attachmentBlock}`;
      clearAttachments();
    }

    isSubmittingRef.current = true;
    setLocalPrompt('');
    setInputPrompt?.('');

    try {
      await onSend(text, !sessionId ? stagedSessionId || undefined : undefined);
    } catch (_err) {
      // ponytail: Acknowledgment-based restore on failure protects user drafts from disappearing
      setLocalPrompt(savedPrompt);
      setInputPrompt?.(savedPrompt);
      setAttachedFiles(savedAttachments);
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // ponytail: Protect IME composition (Japanese, Chinese, Korean Enter-to-convert must NOT submit)
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isUploading) {
        return;
      }
      handleSendClick();
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleUploadFiles(e.dataTransfer.files);
    }
  };

  return (
    <div 
      onDragOver={disabled ? undefined : handleDragOver}
      onDragLeave={disabled ? undefined : handleDragLeave}
      onDrop={disabled ? undefined : handleDrop}
      className={`w-full bg-white dark:bg-[#18181b] rounded-2xl border ${
        isDragOver ? 'border-emerald-500/60 ring-2 ring-emerald-500/20' : 'border-zinc-200 dark:border-white/[0.08] focus-within:border-zinc-400 dark:focus-within:border-white/[0.2]'
      } ${disabled ? 'opacity-65 select-none' : ''} shadow-lg shadow-black/[0.03] dark:shadow-black/50 p-3 flex flex-col gap-1.5 transition-all relative`}
    >
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        accept="image/*,.xlsx,.xls,.csv,.pdf,.txt,.json"
        multiple 
        disabled={disabled || isUploading}
        className="hidden" 
      />

      {/* Screen Reader & Visible Upload Feedback */}
      <div aria-live="polite" className="sr-only">
        {isUploading ? "Uploading files..." : uploadError ? uploadError : ""}
      </div>
      {uploadError && (
        <div className="flex items-center justify-between text-xs text-rose-500 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-lg px-2.5 py-1.5 my-1">
          <span className="truncate">{uploadError}</span>
          <button 
            type="button" 
            onClick={() => setUploadError(null)} 
            className="text-rose-400 hover:text-rose-600 dark:hover:text-rose-200 font-bold ml-2 shrink-0 cursor-pointer text-sm leading-none"
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {/* Attached Files Chips */}
      <AttachedFilesList attachedFiles={attachedFiles} onRemove={removeAttachedFile} />

      {/* Differentiation Line - Only rendered when files/folders are attached */}
      {attachedFiles.length > 0 && (
        <div className="h-[1px] bg-zinc-200/80 dark:bg-white/[0.08] my-1 mx-0.5 shrink-0" />
      )}

      {/* Main Input Textarea */}
      <textarea 
        ref={textareaRef}
        value={localPrompt}
        onChange={(e) => {
          setLocalPrompt(e.target.value);
          setInputPrompt?.(e.target.value);
        }}
        onKeyDown={disabled ? undefined : handleKeyDown}
        onPaste={disabled ? undefined : handlePaste}
        disabled={disabled}
        rows={1}
        placeholder={
          disabled
            ? "Loading conversation history..."
            : isDragOver 
              ? "Drop files or screenshots to attach..." 
              : sessionRepo && sessionRepo !== 'No Repo' 
                ? `Ask or audit in ${sessionRepo}...` 
                : "Ask an audit question or reference file paths..."
        }
        className="w-full bg-transparent text-[13.5px] text-zinc-900 dark:text-zinc-100 focus:outline-none resize-none min-h-[38px] max-h-[220px] placeholder:text-zinc-400 dark:placeholder:text-zinc-500 custom-scrollbar leading-relaxed px-1 disabled:cursor-not-allowed"
      />

      {/* Bottom Action Bar */}
      <ComposerActions
        isStreaming={isStreaming}
        isUploading={isUploading}
        disabled={disabled}
        localPrompt={localPrompt}
        attachedFilesCount={attachedFiles.length}
        fileInputRef={fileInputRef}
        onSend={handleSendClick}
        onStop={onStop}
        permissionMode={permissionMode}
        onPermissionModeChange={onPermissionModeChange}
      />
    </div>
  );
}
