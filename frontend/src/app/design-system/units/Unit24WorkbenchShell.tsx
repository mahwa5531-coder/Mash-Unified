"use client";

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  FileTabStrip,
  FileBreadcrumbBar,
  WorkbenchShell,
  FluentExcelLogo,
  ImplementationPlanLogo,
} from '@/primitives';
import { SidebarBrandToggle } from '@/features/sessions/components/SidebarHeader';
import { SidebarFooter } from '@/features/sessions/components/SidebarFooter';
import { PanelRight, Plus } from 'lucide-react';

export function Unit24WorkbenchShell() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isRightOpen, setIsRightOpen] = useState(true);
  const [isRightMaximized, setIsRightMaximized] = useState(false);
  const [longList, setLongList] = useState(true);
  const [activeTabId, setActiveTabId] = useState('t1');
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const syncScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollUp(el.scrollTop > 4);
    setCanScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 6);
  }, []);

  useEffect(() => {
    const raf = requestAnimationFrame(syncScroll);
    return () => cancelAnimationFrame(raf);
  }, [syncScroll, longList, isSidebarOpen]);

  const demoTabs = [
    { id: 't1', title: 'Sidebar.tsx', path: 'src/features/sessions/components/Sidebar.tsx', type: 'file' as const, icon: <ImplementationPlanLogo size={14} /> },
    { id: 't2', title: 'Payables.xlsx', path: 'workpapers/Payables.xlsx', type: 'file' as const, icon: <FluentExcelLogo size={14} /> },
  ];

  const demoSessions = longList
    ? Array.from({ length: 14 }, (_, i) => `Session Audit #${i + 1}`)
    : ['Audit Report Verification', 'Tax Compliance Check'];

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
          <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">24</span>
          <span>Unified Inset Workbench Shell (`&lt;WorkbenchShell /&gt;`)</span>
        </h2>
        <span className="font-mono text-xs text-[var(--m-text-muted)]">`src/primitives/WorkbenchShell.tsx`</span>
      </div>

      <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-[var(--m-text-secondary)]">
            Bottom bar blends flat when short (`Short List`) and smoothly differentiates with fade + hairline when sessions overflow/scroll (`Scrollable`).
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setLongList((v) => !v)}
              className="px-2.5 py-1 rounded-md border border-[var(--m-border)] bg-[var(--m-bg-app)] text-[var(--m-text-primary)] cursor-pointer hover:border-[var(--m-accent)]"
            >
              Sessions: {longList ? 'Scrollable (14)' : 'Short (2)'}
            </button>
            <button
              type="button"
              onClick={() => setIsSidebarOpen((v) => !v)}
              className="px-2.5 py-1 rounded-md border border-[var(--m-border)] bg-[var(--m-bg-app)] text-[var(--m-text-primary)] cursor-pointer hover:border-[var(--m-accent)]"
            >
              Left Sidebar: {isSidebarOpen ? 'OPEN' : 'CLOSED'}
            </button>
            <button
              type="button"
              onClick={() => { setIsRightOpen((v) => !v); setIsRightMaximized(false); }}
              className="px-2.5 py-1 rounded-md border border-[var(--m-border)] bg-[var(--m-bg-app)] text-[var(--m-text-primary)] cursor-pointer hover:border-[var(--m-accent)]"
            >
              Right Panel: {isRightOpen ? 'OPEN' : 'CLOSED'}
            </button>
            {isRightOpen && (
              <button
                type="button"
                onClick={() => setIsRightMaximized((v) => !v)}
                className="px-2.5 py-1 rounded-md border border-[var(--m-border)] bg-[var(--m-bg-app)] text-[var(--m-text-primary)] cursor-pointer hover:border-[var(--m-accent)]"
              >
                Maximize: {isRightMaximized ? 'ON' : 'OFF'}
              </button>
            )}
          </div>
        </div>

        <WorkbenchShell
          className="h-[420px] rounded-xl border border-[var(--m-border)] shadow-md"
          titleBar={
            <div className="h-[30px] bg-[var(--bg-sidebar)] flex items-center justify-between px-3 text-[11px] text-zinc-500 dark:text-zinc-400 select-none shrink-0">
              <span className="font-semibold tracking-wider text-zinc-900 dark:text-zinc-100">MASH</span>
              <span className="font-mono text-[10px]">Window Frame Row 1 (Merged Chrome)</span>
            </div>
          }
          isSidebarOpen={isSidebarOpen}
          sidebar={
            <div className="w-[215px] h-full bg-[var(--bg-sidebar)] flex flex-col shrink-0 select-none">
              <div className="h-9 bg-[var(--bg-sidebar)] flex items-center px-3 shrink-0">
                <SidebarBrandToggle onToggle={() => setIsSidebarOpen(false)} title="Collapse sidebar" />
              </div>
              <div className="px-2.5 pt-2 pb-2 shrink-0">
                <div className="h-[32px] px-3 rounded-lg border border-zinc-200/90 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] flex items-center gap-2 text-xs font-medium text-zinc-900 dark:text-zinc-100">
                  <Plus size={13} /> New Conversation
                </div>
              </div>
              <div
                className={`relative flex-1 min-h-0 flex flex-col border-t transition-colors duration-150 ${
                  canScrollUp ? 'border-zinc-200/70 dark:border-white/[0.06]' : 'border-transparent'
                }`}
              >
                <div
                  ref={scrollRef}
                  onScroll={syncScroll}
                  className="flex-1 overflow-y-auto custom-scrollbar px-2 py-1 space-y-0.5 text-[11.5px] text-zinc-500 dark:text-zinc-400"
                >
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-400 sticky top-0 bg-[var(--bg-sidebar)]">Conversations</div>
                  {demoSessions.map((label, idx) => (
                    <div
                      key={label}
                      className={`px-2 py-1.5 rounded-lg truncate ${
                        idx === 0
                          ? 'bg-zinc-200/90 dark:bg-white/[0.08] text-zinc-900 dark:text-zinc-100 font-medium'
                          : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
                      }`}
                    >
                      {label}
                    </div>
                  ))}
                </div>
                <div
                  className={`pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-[var(--bg-sidebar)] via-[var(--bg-sidebar)]/85 to-transparent transition-opacity duration-150 z-10 ${
                    canScrollDown ? 'opacity-100' : 'opacity-0'
                  }`}
                />
              </div>
              <SidebarFooter
                isScrolled={canScrollUp || canScrollDown}
                canScrollDown={canScrollDown}
                authUser={{ authenticated: true, name: 'Rama', email: 'rama@mash.ai', plan: 'pro', quota: { windows: [{ percent: 18 }] } } as any}
              />
            </div>
          }
          chatToolbar={
            <div className="h-9 bg-[var(--bg-sidebar)] flex items-center justify-between px-3 text-xs select-none">
              <div className="flex items-center gap-2">
                {!isSidebarOpen && (
                  <SidebarBrandToggle onToggle={() => setIsSidebarOpen(true)} title="Expand sidebar" />
                )}
                <span className="text-zinc-500 dark:text-zinc-400">Mash</span>
                <span className="text-zinc-400 dark:text-zinc-600">/</span>
                <span className="font-medium text-zinc-800 dark:text-zinc-200">Audit Report Verification</span>
              </div>
              {!isRightOpen && (
                <button type="button" onClick={() => setIsRightOpen(true)} className="p-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer">
                  <PanelRight size={14} />
                </button>
              )}
            </div>
          }
          rightHeader={
            <FileTabStrip
              tabs={demoTabs}
              activeTabId={activeTabId}
              isExplorerMode={false}
              onToggleExplorer={() => {}}
              onSelectTab={setActiveTabId}
              onCloseTab={() => {}}
              isMaximized={isRightMaximized}
              onToggleMaximize={() => setIsRightMaximized((v) => !v)}
              onToggleCollapse={() => { setIsRightOpen(false); setIsRightMaximized(false); }}
            />
          }
          mainContent={
            <div className="flex-1 flex flex-col justify-between p-4 bg-[var(--bg-app)]">
              <div className="space-y-2 max-w-md mx-auto w-full text-xs text-[var(--text-secondary)]">
                <div className="font-semibold text-[var(--text-primary)]">Chat Canvas (--bg-app)</div>
                <p>Chat feed + Composer live together inside the rounded inset box, framed cleanly by outer chrome (--bg-sidebar).</p>
              </div>
              <div className="max-w-md mx-auto w-full rounded-xl border border-zinc-200/80 dark:border-white/[0.08] bg-zinc-50 dark:bg-[#141416] px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
                Ask Mash about your workspace...
              </div>
            </div>
          }
          rightContent={
            <div className="flex-1 flex flex-col bg-[var(--bg-app)]">
              <FileBreadcrumbBar path="src/features/sessions/components/Sidebar.tsx" type="file" />
              <div className="flex-1 p-4 font-mono text-[11px] text-zinc-500 dark:text-zinc-400 space-y-1">
                <div>85   sessions,</div>
                <div>86   setSessions,</div>
                <div>87   registeredProjects,</div>
              </div>
            </div>
          }
          isRightOpen={isRightOpen}
          isRightMaximized={isRightMaximized}
          rightWidth={280}
        />
      </div>
    </section>
  );
}
