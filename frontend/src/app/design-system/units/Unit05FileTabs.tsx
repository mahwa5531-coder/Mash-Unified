"use client";

import React, { useState } from 'react';
import { 
  FileTabStrip, 
  AuditCallout, 
  FluentExcelLogo, 
  AdobePdfLogo, 
  ImplementationPlanLogo, 
  FluentPowerPointLogo, 
  JupyterNotebookLogo, 
  XmlXbrlLogo, 
  AuditWalkthroughLogo, 
  ConsoleTerminalLogo 
} from '@/primitives';

interface Unit05FileTabsProps {
  onSelectComponent: (name: string) => void;
}

export function Unit05FileTabs({ onSelectComponent }: Unit05FileTabsProps) {
  const [demoTabs, setDemoTabs] = useState([
    { id: '1', title: 'Trade_Payables.xlsx', path: 'workpapers/Trade_Payables.xlsx', type: 'file' as const, icon: <FluentExcelLogo size={14} /> },
    { id: '2', title: 'Statutory_Report_FY26.pdf', path: 'reports/Statutory_Report_FY26.pdf', type: 'file' as const, icon: <AdobePdfLogo size={14} /> },
    { id: '3', title: 'audit_plan.md', path: 'plans/audit_plan.md', type: 'file' as const, icon: <ImplementationPlanLogo size={14} /> },
    { id: '4', title: 'Board_Briefing.pptx', path: 'presentations/Board_Briefing.pptx', type: 'file' as const, icon: <FluentPowerPointLogo size={14} /> },
    { id: '5', title: 'Benford_ML.ipynb', path: 'analytics/Benford_ML.ipynb', type: 'file' as const, icon: <JupyterNotebookLogo size={14} /> },
    { id: '6', title: 'MCA_XBRL_Filing.xml', path: 'filings/MCA_XBRL_Filing.xml', type: 'file' as const, icon: <XmlXbrlLogo size={14} /> },
    { id: '7', title: 'walkthrough.md', path: 'controls/walkthrough.md', type: 'file' as const, icon: <AuditWalkthroughLogo size={14} /> },
    { id: '8', title: 'Terminal: python', path: 'terminal', type: 'terminal' as const, icon: <ConsoleTerminalLogo size={14} /> },
  ]);
  const [activeDemoTabId, setActiveDemoTabId] = useState('1');

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
          <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">5</span>
          <span>Workpaper File Tabs (`&lt;FileTab /&gt;`)</span>
        </h2>
        <span className="font-mono text-xs text-[var(--m-text-muted)]">`src/primitives/FileTab.tsx`</span>
      </div>

      <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-4">
        <div className="text-xs text-[var(--m-text-secondary)] leading-relaxed space-y-1.5">
          <div>
            <strong className="text-[var(--m-text-primary)]">Row 1 Header Architecture:</strong> In the right sidebar top row, exactly 3 control sections exist:
          </div>
          <ul className="list-disc pl-5 space-y-0.5 text-[11.5px] text-[var(--m-text-secondary)]">
            <li><strong className="text-[var(--m-text-primary)]">Left:</strong> Audit Workspaces button (`&lt;AuditWorkspacesLogo /&gt;`) — custom executive multi-pane engagement vault.</li>
            <li><strong className="text-[var(--m-text-primary)]">Center:</strong> Workpaper File Tabs (`&lt;FileTab /&gt;`) with smooth sideways scroll (mouse wheel / trackpad).</li>
            <li><strong className="text-[var(--m-text-primary)]">Right:</strong> Maximize button (`&lt;Maximize2 /&gt;`) and Toggle Sidebar button (`&lt;PanelRight /&gt;`). No other buttons crowd this row.</li>
          </ul>
          <div className="pt-1">
            <strong className="text-[var(--m-text-primary)]">Side Ghost Close:</strong> File logo remains permanently visible on the left; a subtle ghost close button (`[X]`) fades in cleanly on the right side when hovering over the tab.
          </div>
        </div>

        {/* Interactive Tab Bar Simulation */}
        <div className="p-3 bg-[var(--m-bg-app)] rounded-xl border border-[var(--m-border)] space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[var(--m-border-subtle)]">
            <span className="text-[11px] font-mono text-[var(--m-text-muted)] uppercase tracking-wider">
              Live Row 1 Header Simulation (Hover tabs to reveal right close [X], scroll wheel to pan)
            </span>
            <button
              type="button"
              onClick={() => {
                setDemoTabs([
                  { id: '1', title: 'Trade_Payables.xlsx', path: 'workpapers/Trade_Payables.xlsx', type: 'file' as const, icon: <FluentExcelLogo size={14} /> },
                  { id: '2', title: 'Statutory_Report_FY26.pdf', path: 'reports/Statutory_Report_FY26.pdf', type: 'file' as const, icon: <AdobePdfLogo size={14} /> },
                  { id: '3', title: 'audit_plan.md', path: 'plans/audit_plan.md', type: 'file' as const, icon: <ImplementationPlanLogo size={14} /> },
                  { id: '4', title: 'Board_Briefing.pptx', path: 'presentations/Board_Briefing.pptx', type: 'file' as const, icon: <FluentPowerPointLogo size={14} /> },
                  { id: '5', title: 'Benford_ML.ipynb', path: 'analytics/Benford_ML.ipynb', type: 'file' as const, icon: <JupyterNotebookLogo size={14} /> },
                  { id: '6', title: 'MCA_XBRL_Filing.xml', path: 'filings/MCA_XBRL_Filing.xml', type: 'file' as const, icon: <XmlXbrlLogo size={14} /> },
                  { id: '7', title: 'walkthrough.md', path: 'controls/walkthrough.md', type: 'file' as const, icon: <AuditWalkthroughLogo size={14} /> },
                  { id: '8', title: 'Terminal: python', path: 'terminal', type: 'terminal' as const, icon: <ConsoleTerminalLogo size={14} /> },
                ]);
                setActiveDemoTabId('1');
              }}
              className="text-xs text-[var(--m-accent)] hover:underline cursor-pointer"
            >
              Reset Demo Tabs
            </button>
          </div>

          <FileTabStrip
            className="rounded-lg border border-zinc-200/70 dark:border-white/[0.08]"
            tabs={demoTabs}
            activeTabId={activeDemoTabId}
            onToggleExplorer={() => onSelectComponent('Row 1: Clicked Audit Workspaces button')}
            onSelectTab={(tabId) => {
              setActiveDemoTabId(tabId);
              const tab = demoTabs.find((t) => t.id === tabId);
              onSelectComponent(`Selected Tab: ${tab?.title}`);
            }}
            onCloseTab={(_e, tabId) => {
              const tab = demoTabs.find((t) => t.id === tabId);
              onSelectComponent(`Closed Tab: ${tab?.title}`);
              setDemoTabs((prev) => prev.filter((t) => t.id !== tabId));
              if (activeDemoTabId === tabId) {
                const remaining = demoTabs.filter((t) => t.id !== tabId);
                if (remaining.length > 0) setActiveDemoTabId(remaining[0].id);
              }
            }}
            onToggleMaximize={() => onSelectComponent('Row 1: Clicked Maximize button')}
            onToggleCollapse={() => onSelectComponent('Row 1: Clicked Toggle Sidebar button')}
          />
        </div>

        <AuditCallout
          status="NOTE"
          title="UX Interaction: Side Ghost Close Button"
          cite="Workpaper Tab System"
        >
          The file extension logo stays permanently anchored on the left so file identity is never lost, while a subtle ghost close button (`[X]`) appears on the right edge upon hover for fast, distraction-free tab closing.
        </AuditCallout>
      </div>
    </section>
  );
}
