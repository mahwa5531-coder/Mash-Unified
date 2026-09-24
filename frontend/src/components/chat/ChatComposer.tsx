"use client";

import { useState, useRef, useEffect, KeyboardEvent, DragEvent, ChangeEvent } from 'react';
import { Send, Square, Plus, Sparkles, ArrowUp, Paperclip, X, FileText, Loader2 } from 'lucide-react';
import { uploadSessionFile } from '@/utils/apiClient';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';

export interface ChatComposerProps {
  sessionId?: string | null;
  inputPrompt?: string;
  setInputPrompt?: (val: string) => void;
  onSend: (text?: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  sessionRepo?: string;
  selectedModel?: string;
  onSelectModel?: (modelId: string) => void;
}

export const AVAILABLE_MODELS = [
  { id: 'default', name: 'Environment Default (.env)', provider: 'Backend Config', badge: 'Active Model' },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 3.8 Flash High', provider: 'Google (OpenRouter)', badge: 'Fast & Vision' },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 3.8 Pro Reasoning', provider: 'Google (OpenRouter)', badge: 'Deep Reasoning' },
  { id: 'openai/gpt-5.6-luna', name: 'GPT-5.6 Luna', provider: 'OpenAI (OpenRouter)', badge: 'Fast & Smart' },
  { id: 'openai/gpt-5.6-terra', name: 'GPT-5.6 Terra', provider: 'OpenAI (OpenRouter)', badge: 'Deep Reasoning' },
  { id: 'openrouter/free', name: 'Free Models Auto-Router', provider: 'OpenRouter (Free)', badge: 'Auto Router' },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', name: 'Nemotron 3 Ultra 550B', provider: 'NVIDIA (Free)', badge: '550B Flagship' },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free', name: 'Nemotron 3 Super 120B', provider: 'NVIDIA (Free)', badge: '120B Free' },
  { id: 'google/gemma-4-31b-it:free', name: 'Gemma 4 31B', provider: 'Google (Free)', badge: '31B Free' },
  { id: 'meta/muse-spark-1.3-contributor', name: 'Muse Spark 1.3 Contributor', provider: 'Meta / OpenRouter', badge: '1M Max Reasoning' },
];

export const THINKING_LEVELS = [
  { id: 'max', name: 'Max Reasoning', desc: 'Maximum chain-of-thought tokens' },
  { id: 'high', name: 'Deep Reasoning', desc: 'High chain-of-thought' },
  { id: 'medium', name: 'Medium Effort', desc: 'Balanced multi-step reasoning' },
  { id: 'low', name: 'Low Effort', desc: 'Fast turnaround' },
];

export default function ChatComposer({
  sessionId,
  inputPrompt = '',
  setInputPrompt,
  onSend,
  onStop,
  isStreaming,
  disabled = false,
  sessionRepo,
  selectedModel = 'default',
  onSelectModel,
}: ChatComposerProps) {
  const [localPrompt, setLocalPrompt] = useState<string>(inputPrompt);
  const [attachedFiles, setAttachedFiles] = useState<Array<{ name: string; path: string; previewUrl?: string }>>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isSubmittingRef = useRef<boolean>(false);

  // Sync when parent changes inputPrompt (e.g. on Undo or reset)
  useEffect(() => {
    setLocalPrompt(inputPrompt);
  }, [inputPrompt]);

  // Auto-resize textarea to fit content cleanly
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 220)}px`;
    }
  }, [localPrompt]);

  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  const handleUploadFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    const validFiles = Array.from(files);
    if (validFiles.length === 0) return;
    setIsUploading(true);
    const uploadedList: Array<{ name: string; path: string; previewUrl?: string }> = [];
    const sid = sessionId || 'default_session';
    for (const file of validFiles) {
      const res = await uploadSessionFile(sid, file);
      if (res && res.path) {
        const isImg = file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg|bmp)$/i.test(file.name);
        uploadedList.push({ 
          name: file.name, 
          path: res.path,
          previewUrl: isImg && typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : undefined,
        });
      }
    }
    if (uploadedList.length > 0) {
      setAttachedFiles((prev) => [...prev, ...uploadedList]);
    }
    setIsUploading(false);
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleUploadFiles(e.target.files);
    }
    e.target.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
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
    setAttachedFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSendClick = () => {
    // Synchronous submission lock to prevent double-Enter race conditions
    if (isSubmittingRef.current) return;
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
        accept="image/*,.pdf,.xlsx,.xls,.csv,.doc,.docx,.txt,.json"
        multiple 
        disabled={disabled}
        className="hidden" 
      />

      {/* Attached Images Chips */}
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1 pt-1 pb-0.5">
          {attachedFiles.map((f, i) => (
            <div key={i} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-800/90 border border-zinc-200 dark:border-zinc-700/80 text-[11px] text-zinc-800 dark:text-zinc-200 shadow-xs select-none">
              {f.previewUrl ? (
                <img src={f.previewUrl} alt={f.name} className="w-4 h-4 rounded object-cover" />
              ) : (
                <Paperclip size={10} className="text-zinc-500 dark:text-zinc-400" />
              )}
              <span className="truncate max-w-[160px] font-medium">{f.name}</span>
              <button 
                type="button" 
                onClick={() => removeAttachedFile(i)} 
                className="text-zinc-400 hover:text-red-500 p-0.5 rounded transition-colors cursor-pointer"
                title="Remove attachment"
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Main Input Textarea - Local State to eliminate keystroke lag */}
      <textarea 
        ref={textareaRef}
        value={disabled ? '' : localPrompt}
        onChange={(e) => !disabled && setLocalPrompt(e.target.value)}
        onKeyDown={disabled ? undefined : handleKeyDown}
        onPaste={disabled ? undefined : handlePaste}
        disabled={disabled}
        rows={1}
        placeholder={
          disabled
            ? "Loading conversation history..."
            : isDragOver 
              ? "Drop spreadsheets or documents to attach..." 
              : sessionRepo && sessionRepo !== 'No Repo' 
                ? `Ask or audit in ${sessionRepo}...` 
                : "Ask an audit question or attach financial documents..."
        }
        className="w-full bg-transparent text-[13.5px] text-zinc-900 dark:text-zinc-100 focus:outline-none resize-none min-h-[38px] max-h-[450px] placeholder:text-zinc-400 dark:placeholder:text-zinc-500 custom-scrollbar leading-relaxed px-1 disabled:cursor-not-allowed"
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
                  aria-label="Attach document, spreadsheet, or image"
                >
                  {isUploading ? (
                    <Loader2 size={13} className="animate-spin text-zinc-400" />
                  ) : (
                    <Plus size={16} className="text-zinc-500 dark:text-zinc-400" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                Attach document, spreadsheet, or image
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="flex items-center gap-2">
            {isStreaming ? (
              <>
                {localPrompt.trim() && (
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
                )}
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
              </>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button 
                    type="button"
                    onClick={handleSendClick}
                    disabled={!localPrompt.trim() || disabled}
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
