"use client";

import React from 'react';
import { Send, Square, Plus, ArrowUp, Loader2 } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';

interface ComposerActionsProps {
  isStreaming: boolean;
  isUploading: boolean;
  disabled: boolean;
  localPrompt: string;
  attachedFilesCount: number;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onSend: () => void;
  onStop: () => void;
}

export function ComposerActions({
  isStreaming,
  isUploading,
  disabled,
  localPrompt,
  attachedFilesCount,
  fileInputRef,
  onSend,
  onStop,
}: ComposerActionsProps) {
  return (
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
                    onClick={onSend}
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
                  onClick={onSend}
                  disabled={(!localPrompt.trim() && attachedFilesCount === 0) || disabled || isUploading}
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
  );
}
