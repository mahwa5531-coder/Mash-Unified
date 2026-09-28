"use client";

import { useState, useRef, useEffect } from 'react';
import type { KeyboardEvent, DragEvent, ChangeEvent, ClipboardEvent } from 'react';
import { Send, Square, Plus, ArrowUp, Paperclip, X, Loader2 } from 'lucide-react';
import { uploadSessionFile } from '@/services/sessions';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';

export interface AttachedFile {
  name: string;
  path: string;
  previewUrl?: string;
  error?: boolean;
}

export interface ChatComposerProps {
  sessionId?: string | null;
  inputPrompt?: string;
  setInputPrompt?: (val: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  sessionRepo?: string;
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
}: ChatComposerProps) {
  const [localPrompt, setLocalPrompt] = useState<string>(inputPrompt);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isSubmittingRef = useRef<boolean>(false);

  // Sync when parent changes inputPrompt (e.g. on Undo or reset)
  useEffect(() => {
    setLocalPrompt(inputPrompt);
  }, [inputPrompt]);

  const createdBlobUrlsRef = useRef<Set<string>>(new Set());

  // ponytail: revoke blob preview URLs only on unmount or explicit removal, not on attachment changes (M-04)
  useEffect(() => {
    const urls = createdBlobUrlsRef.current;
    return () => {
      urls.forEach(url => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  // Auto-resize textarea to fit content cleanly up to 220px
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 220)}px`;
    }
  }, [localPrompt]);

  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  const handleUploadFiles = async (files: FileList | File[]) => {
    const validFiles = Array.from(files);
    if (validFiles.length === 0) return;
    setIsUploading(true);
    setUploadError(null);
    const uploadedList: AttachedFile[] = [];
    const sid = sessionId || 'default_session';

    try {
      for (const file of validFiles) {
        const res = await uploadSessionFile(sid, file);
        if (res && res.path) {
          const isImg = file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg|bmp)$/i.test(file.name);
          let previewUrl: string | undefined = undefined;
          if (isImg && typeof URL !== 'undefined' && URL.createObjectURL) {
            previewUrl = URL.createObjectURL(file);
            createdBlobUrlsRef.current.add(previewUrl);
          }
          uploadedList.push({ 
            name: file.name, 
            path: res.path,
            previewUrl,
          });
        } else {
          setUploadError(`Failed to upload ${file.name}`);
        }
      }
      if (uploadedList.length > 0) {
        setAttachedFiles((prev) => [...prev, ...uploadedList]);
      }
    } catch (err) {
      setUploadError("An error occurred during file upload.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleUploadFiles(e.target.files);
    }
    e.target.value = '';
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const file = items[i].getAsFile();
      if (file) {
        files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      handleUploadFiles(files);
    }
  };

  const removeAttachedFile = (idx: number) => {
    setAttachedFiles((prev) => {
      const file = prev[idx];
      if (file?.previewUrl && file.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(file.previewUrl);
        createdBlobUrlsRef.current.delete(file.previewUrl);
      }
      return prev.filter((_, i) => i !== idx);
    });
  };

  const handleSendClick = () => {
    // Synchronous submission lock to prevent double-Enter race conditions and upload races
    if (isSubmittingRef.current || isUploading) return;
    let text = localPrompt.trim();
    if (!text && attachedFiles.length === 0) return;

    if (attachedFiles.length > 0) {
      const fileRefs = attachedFiles.map(f => `[Attached file: ${f.path}]`).join('\n');
      text = text ? `${text}\n\n${fileRefs}` : `Please inspect and analyze the attached audit documents:\n${fileRefs}`;
      setAttachedFiles([]);
    }

    isSubmittingRef.current = true;
    setLocalPrompt('');
    setInputPrompt?.('');
    onSend(text);
    setTimeout(() => {
      isSubmittingRef.current = false;
    }, 300);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isUploading) return;
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

      {/* Screen Reader Upload Feedback */}
      <div aria-live="polite" className="sr-only">
        {isUploading ? "Uploading files..." : uploadError ? uploadError : ""}
      </div>


      {/* Attached Files Chips */}
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1 pt-1 pb-0.5">
          {attachedFiles.map((f, i) => (
            <div
              key={f.path || `${f.name}_${i}`}
              className="group inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--m-radius-sm)] bg-zinc-100/70 hover:bg-zinc-200/90 dark:bg-white/[0.04] dark:hover:bg-white/[0.09] border border-zinc-200/90 dark:border-white/[0.08] text-[11.5px] text-zinc-700 dark:text-zinc-300 font-mono select-none transition-all duration-150"
            >
              {/* Left slot: swaps icon for [X] on hover in the exact same spot */}
              <span className="relative flex items-center justify-center shrink-0 w-3.5 h-3.5">
                <span className="flex items-center justify-center shrink-0 transition-opacity duration-100 group-hover:opacity-0 group-hover:pointer-events-none">
                  {f.previewUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={f.previewUrl} alt={f.name} className="w-3.5 h-3.5 rounded object-cover" />
                  ) : (
                    <Paperclip size={11} className="text-zinc-400 dark:text-zinc-500" />
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => removeAttachedFile(i)}
                  className="absolute inset-0 m-auto w-3.5 h-3.5 p-0 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-950 dark:hover:text-white hover:bg-zinc-200/80 dark:hover:bg-white/[0.15] opacity-0 group-hover:opacity-100 transition-all cursor-pointer outline-none shrink-0"
                  title={`Remove ${f.name}`}
                  aria-label={`Remove ${f.name}`}
                >
                  <X size={11} strokeWidth={2.2} />
                </button>
              </span>
              <span className="truncate max-w-[180px] font-medium">{f.name}</span>
            </div>
          ))}
        </div>
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
      <TooltipProvider delayDuration={150}>
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading || disabled}
                  className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-zinc-200/80 dark:hover:bg-zinc-800/80 text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Attach documents, spreadsheets, or images"
                >
                  {isUploading ? (
                    <Loader2 size={13} className="animate-spin text-zinc-400" />
                  ) : (
                    <Plus size={16} className="text-zinc-500 dark:text-zinc-400" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                Attach audit spreadsheets, images, or documents
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="flex items-center gap-2">
            {isStreaming ? (
              localPrompt.trim() ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleSendClick}
                      className="w-7 h-7 rounded-full bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-white dark:hover:bg-zinc-200 dark:text-black flex items-center justify-center transition-all cursor-pointer shadow-sm"
                      aria-label="Queue message"
                    >
                      <ArrowUp size={13} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Queue message</TooltipContent>
                </Tooltip>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button 
                      type="button"
                      onClick={onStop}
                      className="w-7 h-7 rounded-full bg-zinc-100 hover:bg-zinc-200 border border-zinc-300 dark:bg-[#242424] dark:hover:bg-[#2e2e2e] dark:border-zinc-700/60 flex items-center justify-center transition-all cursor-pointer shadow-sm group"
                      aria-label="Stop generation"
                    >
                      <Square size={10} className="text-red-500 fill-red-500" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Stop generation</TooltipContent>
                </Tooltip>
              )
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button 
                    type="button"
                    onClick={handleSendClick}
                    disabled={(!localPrompt.trim() && attachedFiles.length === 0) || disabled || isUploading}
                    className="w-7 h-7 rounded-full bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-white dark:hover:bg-zinc-200 dark:text-black disabled:bg-zinc-200 disabled:text-zinc-400 dark:disabled:bg-[#242424] dark:disabled:text-zinc-600 disabled:opacity-40 flex items-center justify-center transition-all cursor-pointer disabled:cursor-not-allowed shadow-sm"
                    aria-label="Send prompt"
                  >
                    <Send size={12} className="ml-0.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Send prompt</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </TooltipProvider>
    </div>
  );
}
