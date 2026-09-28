"use client";

// Row-2 sub-header: scrollable breadcrumb + Preview/Raw pill + 3-dots menu.
import React, { MouseEvent as ReactMouseEvent } from 'react';
import { ChevronRight, Copy, Download, X, MoreVertical, Menu, Image as ImageIcon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { BASE_URL } from '@/services/client';
import type { TabItem } from '../types';

interface EditorSubheaderProps {
  breadcrumbs: Array<{ label: string; isLast: boolean }>;
  activeTab: TabItem | undefined;
  tabContent: Record<string, string>;
  fileViewMode: 'preview' | 'raw';
  setFileViewMode: React.Dispatch<React.SetStateAction<'preview' | 'raw'>>;
  setViewMode: React.Dispatch<React.SetStateAction<'explorer' | 'editor'>>;
  handleCloseTab: (e: ReactMouseEvent, tabId: string) => void;
}

export function EditorSubheader({
  breadcrumbs,
  activeTab,
  tabContent,
  fileViewMode,
  setFileViewMode,
  setViewMode,
  handleCloseTab,
}: EditorSubheaderProps) {
  return (
    <div className="h-8 bg-zinc-100/60 dark:bg-zinc-900/30 border-b border-zinc-200/70 dark:border-white/[0.06] flex items-center justify-between px-3 select-none shrink-0 text-xs gap-2">
      {/* Left: Horizontally Scrollable Breadcrumb */}
      <div 
        onWheel={(e) => {
          if (e.deltaY !== 0) {
            e.currentTarget.scrollLeft += e.deltaY;
          }
        }}
        className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto no-scrollbar whitespace-nowrap text-zinc-500 dark:text-zinc-400 text-[11.5px] py-1"
      >
        <button 
          type="button"
          onClick={() => setViewMode('explorer')}
          className="hover:text-zinc-900 dark:hover:text-zinc-200 cursor-pointer shrink-0 transition-colors font-medium flex items-center gap-1"
          title="Return to Explorer"
        >
          <span>Mash</span>
        </button>

        {breadcrumbs.map((crumb, idx) => (
          <React.Fragment key={idx}>
            <ChevronRight size={11} className="text-zinc-400 dark:text-zinc-600 shrink-0 select-none" />
            {crumb.isLast ? (
              <span 
                className="text-zinc-800 dark:text-zinc-100 font-medium shrink-0 flex items-center gap-1 bg-zinc-200/50 dark:bg-zinc-800/40 px-1.5 py-0.5 rounded border border-zinc-300/60 dark:border-white/[0.04] max-w-[220px] truncate" 
                title={crumb.label}
              >
                {activeTab?.type === 'image' && <ImageIcon size={11} className="text-purple-400 shrink-0" />}
                {crumb.label}
              </span>
            ) : (
              <span className="hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors shrink-0">
                {crumb.label}
              </span>
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Right: Preview / Raw sliding pill + 3 dots menu + list icon */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Segmented Pill for Preview | Raw */}
        <div className="flex items-center bg-zinc-200/60 dark:bg-zinc-950/80 border border-zinc-300/80 dark:border-white/[0.08] rounded-md p-0.5 shadow-2xs">
          <button
            type="button"
            onClick={() => setFileViewMode('preview')}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
              fileViewMode === 'preview' 
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs' 
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => setFileViewMode('raw')}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
              fileViewMode === 'raw' 
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs' 
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            Raw
          </button>
        </div>

              {/* 3-dots Dropdown Menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="p-1 rounded text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-200/50 dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
                    title="More options"
                    aria-label="More options"
                  >
                    <MoreVertical size={13} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 bg-white dark:bg-[#18181a] border border-zinc-200 dark:border-white/[0.08] shadow-xl p-1 rounded-xl">
                  <DropdownMenuItem
                    onClick={() => {
                      if (activeTab) {
                        navigator.clipboard.writeText(tabContent[activeTab.id] || '');
                      }
                    }}
                    className="text-xs gap-2 cursor-pointer rounded-lg py-1.5"
                  >
                    <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>Copy Content</span>
                  </DropdownMenuItem>

                  {activeTab?.path && (
                    <DropdownMenuItem
                      onClick={() => {
                        navigator.clipboard.writeText(activeTab.path!);
                      }}
                      className="text-xs gap-2 cursor-pointer rounded-lg py-1.5"
                    >
                      <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>Copy Path</span>
                    </DropdownMenuItem>
                  )}

                  {activeTab?.path && (
                    <DropdownMenuItem
                      onClick={() => {
                        window.open(`${BASE_URL}/files/content?path=${encodeURIComponent(activeTab.path!)}&raw=true`, '_blank');
                      }}
                      className="text-xs gap-2 cursor-pointer rounded-lg py-1.5"
                    >
                      <Download className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>Download / Open Raw</span>
                    </DropdownMenuItem>
                  )}

                  <DropdownMenuSeparator className="my-1 bg-zinc-200 dark:bg-white/[0.06]" />

                  <DropdownMenuItem
                    onClick={() => {
                      if (activeTab) {
                        handleCloseTab({ stopPropagation: () => {} } as any, activeTab.id);
                      }
                    }}
                    className="text-xs gap-2 cursor-pointer rounded-lg py-1.5 text-red-500 hover:text-red-600 focus:text-red-600"
                  >
                    <X className="h-3.5 w-3.5" />
                    <span>Close Tab</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Menu / list icon */}
              <button
                type="button"
                onClick={() => setViewMode(prev => prev === 'explorer' ? 'editor' : 'explorer')}
                className="p-1 rounded text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-200/50 dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
                title="Toggle artifacts overview"
              >
                <Menu size={13} />
              </button>
            </div>
          </div>
  );
}
