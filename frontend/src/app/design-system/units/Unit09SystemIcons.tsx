"use client";

import React from 'react';
import { 
  Download, Upload, Trash2, Copy, Check, 
  Maximize2, Minimize2, PanelLeft, PanelRight, ShieldCheck, Undo2, Redo2, Clock, Timer, History,
  Folder, FolderOpen, FolderPlus, FolderArchive, FolderTree, Plus, ChevronRight, ChevronDown, 
  ExternalLink, Search, Filter, SlidersHorizontal, RefreshCw, RotateCcw, Share2, Eye, EyeOff,
  Lock, Unlock, Terminal, Settings 
} from 'lucide-react';

interface SystemIconItem {
  id: string;
  name: string;
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
}

const ENTERPRISE_SYSTEM_ICONS: SystemIconItem[] = [
  // 1. Actions & Clipboard
  { id: 'copy', name: 'Copy Content', icon: Copy },
  { id: 'check', name: 'Confirm / Verified', icon: Check },
  { id: 'download', name: 'Download / Export', icon: Download },
  { id: 'upload', name: 'Upload Evidence', icon: Upload },
  { id: 'share', name: 'Share Engagement', icon: Share2 },
  { id: 'external', name: 'Open External Link', icon: ExternalLink },

  // 2. History, Undo & Time
  { id: 'undo', name: 'Undo Edit', icon: Undo2 },
  { id: 'redo', name: 'Redo Edit', icon: Redo2 },
  { id: 'reset', name: 'Reset / Revert', icon: RotateCcw },
  { id: 'history', name: 'Audit Trail History', icon: History },
  { id: 'clock', name: 'Execution Timestamp', icon: Clock },
  { id: 'timer', name: 'Duration / Latency', icon: Timer },

  // 3. Workspaces, Folders & Projects
  { id: 'folder', name: 'Folder Closed', icon: Folder },
  { id: 'folder-open', name: 'Folder Open', icon: FolderOpen },
  { id: 'folder-plus', name: 'Create Project in Workspace', icon: FolderPlus },
  { id: 'folder-archive', name: 'Archive Folder', icon: FolderArchive },
  { id: 'folder-tree', name: 'Directory Hierarchy Tree', icon: FolderTree },
  { id: 'plus', name: 'Add New Item / Session', icon: Plus },

  // 4. Navigation & Layout
  { id: 'panel-left', name: 'Toggle Left Navigation', icon: PanelLeft },
  { id: 'panel-right', name: 'Toggle Right Sidebar', icon: PanelRight },
  { id: 'maximize', name: 'Maximize Canvas', icon: Maximize2 },
  { id: 'minimize', name: 'Restore / Minimize', icon: Minimize2 },
  { id: 'chevron-down', name: 'Accordion Expanded', icon: ChevronDown },
  { id: 'chevron-right', name: 'Accordion Collapsed', icon: ChevronRight },

  // 5. Search, Filter & Inspection
  { id: 'search', name: 'Search Workpapers', icon: Search },
  { id: 'filter', name: 'Filter Transactions', icon: Filter },
  { id: 'sliders', name: 'Adjust Parameters', icon: SlidersHorizontal },
  { id: 'refresh', name: 'Sync / Refresh Procedures', icon: RefreshCw },
  { id: 'eye', name: 'View Preview', icon: Eye },
  { id: 'eye-off', name: 'Hide Details', icon: EyeOff },

  // 6. Security, Compliance & System
  { id: 'shield', name: 'Statutory Compliance Verified', icon: ShieldCheck },
  { id: 'lock', name: 'Encrypted / Read-Only', icon: Lock },
  { id: 'unlock', name: 'Unlocked for Editing', icon: Unlock },
  { id: 'terminal', name: 'Terminal Console', icon: Terminal },
  { id: 'settings', name: 'Engagement Settings', icon: Settings },
  { id: 'trash', name: 'Delete / Purge', icon: Trash2 },
];

interface Unit09SystemIconsProps {
  onSelectComponent: (name: string) => void;
}

export function Unit09SystemIcons({ onSelectComponent }: Unit09SystemIconsProps) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
          <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">9</span>
          <span>Enterprise System &amp; Action Icons (`&lt;SystemIcons /&gt;`)</span>
        </h2>
        <span className="font-mono text-xs text-[var(--m-text-muted)]">36 Core Icons • Pure White Line Art</span>
      </div>

      <div className="p-6 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-4">
        <div className="text-xs text-[var(--m-text-secondary)] leading-relaxed">
          <strong className="text-[var(--m-text-primary)]">Colorless White Line Icons:</strong> Operational controls across MASh — copy, check, undo, redo, timestamps, tree folders, workspace project creation (<code className="font-mono text-[11px] text-[var(--m-accent)]">&lt;FolderPlus /&gt;</code>), navigation, and security. Arranged in a clean horizontal and vertical matrix. Click any icon to test.
        </div>

        {/* Matrix of White-Bordered Minimal Line Icons */}
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-9 lg:grid-cols-12 gap-2.5 pt-2">
          {ENTERPRISE_SYSTEM_ICONS.map((item) => {
            const IconComponent = item.icon;

            return (
              <button
                key={item.id}
                type="button"
                title={item.name}
                aria-label={item.name}
                onClick={() => onSelectComponent(`Clicked Icon: ${item.name}`)}
                className="h-11 rounded-lg border border-zinc-200 dark:border-white/[0.12] bg-zinc-100/80 dark:bg-[#121214] hover:bg-zinc-200 dark:hover:bg-white/[0.1] hover:border-zinc-400 dark:hover:border-white/40 flex items-center justify-center cursor-pointer transition-all outline-none focus-visible:ring-1 focus-visible:ring-white/50 group select-none shadow-2xs"
              >
                <IconComponent
                  size={18}
                  strokeWidth={1.5}
                  className="text-zinc-700 dark:text-zinc-200 group-hover:text-black dark:group-hover:text-white transition-colors shrink-0"
                />
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
