"use client";

import React from 'react';
import { MoreVertical, Copy, Download, ExternalLink, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { BASE_URL } from '@/services/client';
import { openSystemFile } from '@/services/files';
import type { TabItem } from '../types';

interface ViewerTabMenuProps {
  activeTab: TabItem;
  content?: string;
  onCloseTab: (e: React.MouseEvent, tabId: string) => void;
}

export function ViewerTabMenu({ activeTab, content = '', onCloseTab }: ViewerTabMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="p-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white bg-transparent hover:bg-transparent transition-colors duration-100 cursor-pointer outline-none"
          title="More options"
          aria-label="More options"
        >
          <MoreVertical size={13} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 bg-white dark:bg-[#18181a] border border-zinc-200 dark:border-white/[0.08] shadow-xl p-1 rounded-xl">
        <DropdownMenuItem
          onClick={() => navigator.clipboard.writeText(content)}
          className="text-xs gap-2 cursor-pointer rounded-lg py-1.5"
        >
          <Copy className="h-3.5 w-3.5 text-muted-foreground" />
          <span>Copy Content</span>
        </DropdownMenuItem>

        {activeTab.path && (
          <DropdownMenuItem
            onClick={() => navigator.clipboard.writeText(activeTab.path!)}
            className="text-xs gap-2 cursor-pointer rounded-lg py-1.5"
          >
            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Copy Path</span>
          </DropdownMenuItem>
        )}

        {activeTab.path && (
          <>
            <DropdownMenuItem
              onClick={() => openSystemFile(activeTab.path!)}
              className="text-xs gap-2 cursor-pointer rounded-lg py-1.5"
            >
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Open in Default App</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                const a = document.createElement('a');
                a.href = `${BASE_URL}/files/content?path=${encodeURIComponent(activeTab.path!)}&raw=true`;
                a.download = activeTab.title || 'file';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
              }}
              className="text-xs gap-2 cursor-pointer rounded-lg py-1.5"
            >
              <Download className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Download File</span>
            </DropdownMenuItem>
          </>
        )}

        <DropdownMenuSeparator className="my-1 bg-zinc-200 dark:bg-white/[0.06]" />

        <DropdownMenuItem
          onClick={(e) => onCloseTab(e, activeTab.id)}
          className="text-xs gap-2 cursor-pointer rounded-lg py-1.5 text-red-500 hover:text-red-600 focus:text-red-600"
        >
          <X className="h-3.5 w-3.5" />
          <span>Close Tab</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
