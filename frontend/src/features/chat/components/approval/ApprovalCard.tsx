"use client";

import React, { useState } from 'react';
import { Terminal, FileEdit, Globe, Trash2, ShieldAlert, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ApprovalCardProps {
  toolCallId: string;
  toolName: string;
  toolSummary?: string;
  toolAction?: string;
  command?: string;
  args?: Record<string, any>;
  status?: 'pending' | 'running' | 'completed' | 'denied';
  decision?: 'allow' | 'allow_once' | 'deny' | null;
  onApprove: (action: 'allow_once' | 'allow' | 'deny', feedback?: string) => void | Promise<void>;
  className?: string;
}

function getToolHeaderInfo(toolName: string, command?: string, args?: Record<string, any>) {
  const isDestructive =
    (command && /(rm\s+-|del\s+|Remove-Item|purge|drop\s+table)/i.test(command)) ||
    (toolName === 'run_shell_command' && /(rm\s+|del\s+)/i.test(String(args?.command || '')));

  if (isDestructive) {
    return {
      icon: Trash2,
      iconColor: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
      badgeBorder: 'border-rose-500/30',
      defaultSummary: 'Destructive operation',
      defaultAction: 'Purges or modifies system files that cannot be undone',
    };
  }

  if (toolName === 'run_shell_command') {
    return {
      icon: Terminal,
      iconColor: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
      badgeBorder: 'border-zinc-800',
      defaultSummary: 'Run shell command',
      defaultAction: 'The agent wants to execute a terminal command',
    };
  }

  if (toolName === 'web_fetch' || toolName === 'web_search') {
    return {
      icon: Globe,
      iconColor: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
      badgeBorder: 'border-zinc-800',
      defaultSummary: 'External web request',
      defaultAction: 'The agent requests access to inspect an external URL',
    };
  }

  return {
    icon: FileEdit,
    iconColor: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
    badgeBorder: 'border-zinc-800',
    defaultSummary: 'File modification',
    defaultAction: 'The agent wants to create or modify workpaper files',
  };
}

export function ApprovalCard({
  toolCallId,
  toolName,
  toolSummary,
  toolAction,
  command,
  args = {},
  status = 'pending',
  decision = null,
  onApprove,
  className,
}: ApprovalCardProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localDecision, setLocalDecision] = useState<'allow' | 'allow_once' | 'deny' | null>(decision);

  const resolvedCommand =
    command ||
    (typeof args.command === 'string' ? args.command : '') ||
    (typeof args.CommandLine === 'string' ? args.CommandLine : '');

  const resolvedPath =
    (typeof args.TargetFile === 'string' ? args.TargetFile : '') ||
    (typeof args.file_path === 'string' ? args.file_path : '') ||
    (typeof args.AbsolutePath === 'string' ? args.AbsolutePath : '') ||
    (typeof args.url === 'string' ? args.url : '');

  const info = getToolHeaderInfo(toolName, resolvedCommand, args);
  const IconComponent = info.icon;

  const currentSummary = toolSummary || args.toolSummary || info.defaultSummary;
  const currentAction = toolAction || args.toolAction || info.defaultAction;

  const activeStatus = localDecision
    ? localDecision === 'deny'
      ? 'denied'
      : isSubmitting
      ? 'running'
      : 'completed'
    : status;

  const handleAction = async (act: 'allow_once' | 'allow' | 'deny') => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setLocalDecision(act);
    try {
      await onApprove(act);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className={cn(
        "flex w-full flex-col gap-3 rounded-[20px] p-4 text-[13px] transition-all select-none",
        "bg-white/95 dark:bg-[#18181b]/95",
        "border shadow-xl backdrop-blur-md",
        info.badgeBorder,
        activeStatus === 'denied' && "opacity-75 border-zinc-300 dark:border-zinc-800",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl border",
            info.iconColor
          )}
        >
          <IconComponent size={16} />
        </span>
        <div className="flex flex-col min-w-0">
          <p className="text-[13.5px] font-semibold text-zinc-900 dark:text-zinc-100 truncate">
            {currentSummary}
          </p>
          <p className="text-zinc-500 dark:text-zinc-400 text-xs truncate">
            {currentAction}
          </p>
        </div>
      </div>

      {/* Monospace Command / Path Box */}
      {resolvedCommand ? (
        <div className="bg-zinc-100 dark:bg-zinc-950/80 border border-zinc-200 dark:border-zinc-800/60 text-zinc-800 dark:text-zinc-200 rounded-xl px-3.5 py-2.5 font-mono text-xs select-all overflow-x-auto leading-relaxed">
          {resolvedCommand}
        </div>
      ) : resolvedPath ? (
        <div className="bg-zinc-100 dark:bg-zinc-950/80 border border-zinc-200 dark:border-zinc-800/60 text-zinc-800 dark:text-zinc-200 rounded-xl px-3.5 py-2.5 font-mono text-xs select-all overflow-x-auto leading-relaxed">
          {resolvedPath}
        </div>
      ) : Object.keys(args).length > 0 ? (
        <dl className="bg-zinc-100 dark:bg-zinc-950/80 border border-zinc-200 dark:border-zinc-800/60 rounded-xl px-3.5 py-2 flex flex-col gap-1 text-xs">
          {Object.entries(args)
            .filter(([k]) => !['toolSummary', 'toolAction'].includes(k))
            .slice(0, 3)
            .map(([k, v]) => (
              <div key={k} className="grid grid-cols-[1fr_2fr] gap-2">
                <dt className="font-mono text-zinc-500 truncate">{k}</dt>
                <dd className="text-zinc-700 dark:text-zinc-300 font-mono text-[11px] truncate">
                  {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                </dd>
              </div>
            ))}
        </dl>
      ) : null}

      {/* Footer: Interactive Decisions vs Terminal Receipts */}
      <div className="flex min-h-8 flex-wrap items-center justify-end gap-2 pt-0.5">
        {activeStatus === 'pending' ? (
          <>
            <button
              type="button"
              onClick={() => handleAction('deny')}
              disabled={isSubmitting}
              className="flex items-center justify-center rounded-full text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/80 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 h-8 px-3.5 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
            >
              Deny
            </button>
            <button
              type="button"
              onClick={() => handleAction('allow')}
              disabled={isSubmitting}
              className="flex items-center justify-center rounded-full text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/80 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 h-8 px-3.5 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
            >
              Always allow
            </button>
            <button
              type="button"
              onClick={() => handleAction('allow_once')}
              disabled={isSubmitting}
              className="flex items-center justify-center rounded-full bg-zinc-900 text-white dark:bg-white dark:text-zinc-950 hover:bg-zinc-800 dark:hover:bg-zinc-200 h-8 px-4 text-xs font-semibold transition-all shadow cursor-pointer active:scale-95 disabled:opacity-50"
            >
              {isSubmitting ? (
                <Loader2 size={13} className="animate-spin mr-1.5" />
              ) : null}
              Allow once
            </button>
          </>
        ) : activeStatus === 'running' ? (
          <div className="flex items-center gap-1.5 text-xs text-sky-500 font-medium py-1">
            <Loader2 size={13} className="animate-spin" />
            <span>Approved, executing...</span>
          </div>
        ) : activeStatus === 'completed' ? (
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium py-1">
            <CheckCircle2 size={13} />
            <span>{localDecision === 'allow' ? 'Always allowed' : 'Finished'}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-rose-500 font-medium py-1">
            <XCircle size={13} />
            <span>Denied by user</span>
          </div>
        )}
      </div>
    </div>
  );
}
