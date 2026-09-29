"use client";

import React, { useState } from 'react';
import { 
  Download, Upload, Trash2, Play, Copy, ArrowRight, FileSpreadsheet, Check, Sun, Moon, 
  Maximize2, Minimize2, PanelLeft, PanelRight, ShieldCheck, Undo2, Redo2, Clock, Timer, History,
  Folder, FolderOpen, FolderPlus, FolderArchive, FolderTree, Plus, ChevronRight, ChevronDown, 
  ExternalLink, Search, Filter, SlidersHorizontal, RefreshCw, RotateCcw, Share2, Eye, EyeOff,
  Lock, Unlock, Terminal, Settings
} from 'lucide-react';
import { 
  Button, 
  AuditBadge, 
  FilePill, 
  PathPill,
  ExtensionBadge,
  WorkingPaperCard,
  AuditCallout, 
  FileTab, 
  FileTabStrip,
  FileBreadcrumbBar, 
  FluentExcelLogo, 
  AdobePdfLogo, 
  AuthenticPythonLogo, 
  ConsoleTerminalLogo,
  ImplementationPlanLogo,
  AuditWalkthroughLogo,
  FluentWordLogo,
  CsvDelimitedLogo,
  OfficialMarkdownLogo,
  SqlDatabaseLogo,
  JsonObjectLogo,
  EnterpriseFolderLogo,
  AuditWorkspacesLogo,
  FluentPowerPointLogo,
  JupyterNotebookLogo,
  XmlXbrlLogo,
  YamlConfigLogo,
  ZipArchiveLogo,
  ImageEvidenceLogo,
  MediaEvidenceLogo,
  WebLink,
  QuotaBanner,
} from '@/primitives';
import { TurnFilesGenerated } from '@/features/artifacts';

interface ActiveLogoInfo {
  id: string;
  name: string;
  extensions: string;
  category: string;
  badge: string;
  component: (props: { size?: number; className?: string }) => React.ReactElement;
  role: string;
}

const ACTIVE_ENTERPRISE_LOGOS: ActiveLogoInfo[] = [
  {
    id: 'xlsx',
    name: 'Microsoft Excel 365',
    extensions: '.xlsx, .xls, .xlsm',
    category: 'Financial Workpapers',
    badge: 'Fluent 365 3D Tile',
    component: FluentExcelLogo,
    role: 'Financial models, trial balances, general ledgers, vouching workpapers',
  },
  {
    id: 'pdf',
    name: 'Adobe Acrobat PDF',
    extensions: '.pdf',
    category: 'Statutory Reports',
    badge: 'Acrobat Official Knot',
    component: AdobePdfLogo,
    role: 'Signed audit reports, board resolutions, tax orders, statutory filings',
  },
  {
    id: 'csv',
    name: 'Delimited Data (CSV)',
    extensions: '.csv, .tsv, .parquet',
    category: 'Analytics & Datasets',
    badge: 'Teal Matrix Badge',
    component: CsvDelimitedLogo,
    role: 'ERP bank statements, raw journal dumps, statistical sampling pools',
  },
  {
    id: 'docx',
    name: 'Microsoft Word 365',
    extensions: '.docx, .doc',
    category: 'Statutory Memos',
    badge: 'Fluent 365 3D Tile',
    component: FluentWordLogo,
    role: 'Audit committee briefs, engagement agreements, legal representation',
  },
  {
    id: 'plan',
    name: 'Implementation Plan',
    extensions: 'plan.md, audit_plan.md',
    category: 'Execution Strategy',
    badge: 'Checklist Task Flow',
    component: ImplementationPlanLogo,
    role: 'Multi-stage audit scope, field-work checklists, milestone schedules',
  },
  {
    id: 'walkthrough',
    name: 'Audit Walkthrough',
    extensions: 'walkthrough.md, worklog.md',
    category: 'Internal Controls (ICFR)',
    badge: 'Process Route Nodes',
    component: AuditWalkthroughLogo,
    role: 'End-to-end process cycles, inquiry notes, risk control matrix trails',
  },
  {
    id: 'py',
    name: 'Python Analytics',
    extensions: '.py, pyproject.toml',
    category: 'Automation & AI',
    badge: 'PSF Authentic Snakes',
    component: AuthenticPythonLogo,
    role: 'Benford fraud analysis, automated sampling engines, reconciliation ETL',
  },
  {
    id: 'sql',
    name: 'SQL Database Query',
    extensions: '.sql, .db, .sqlite',
    category: 'ERP Data Extraction',
    badge: 'Relational DB Cylinders',
    component: SqlDatabaseLogo,
    role: 'SAP / Oracle journal extractions, duplicate payment query scripts',
  },
  {
    id: 'md',
    name: 'Official Markdown',
    extensions: '.md, .markdown',
    category: 'Working Documentation',
    badge: 'Official Octicon M↓',
    component: OfficialMarkdownLogo,
    role: 'Partner review notes, client query lists, audit evidence summaries',
  },
  {
    id: 'json',
    name: 'JSON Object Payload',
    extensions: '.json, package.json',
    category: 'Structured Data',
    badge: 'Curly Braces {}',
    component: JsonObjectLogo,
    role: 'Audit configuration maps, API responses, schema definitions',
  },
  {
    id: 'terminal',
    name: 'Interactive Terminal',
    extensions: 'Terminal Console',
    category: 'Developer & CLI',
    badge: 'CLI Console >_',
    component: ConsoleTerminalLogo,
    role: 'Interactive Python REPL, background workers, shell commands',
  },
  {
    id: 'folder',
    name: 'Enterprise Audit Folder',
    extensions: 'Directory / Binder',
    category: 'File System',
    badge: 'Manila Gold Binder',
    component: EnterpriseFolderLogo,
    role: 'Client fiscal binders, lead schedule folders, engagement archives',
  },
  {
    id: 'pptx',
    name: 'Microsoft PowerPoint 365',
    extensions: '.pptx, .ppt, .odp',
    category: 'Presentations & Decks',
    badge: 'Fluent 365 3D Tile',
    component: FluentPowerPointLogo,
    role: 'Audit committee decks, board presentations, partner findings briefings',
  },
  {
    id: 'ipynb',
    name: 'Jupyter Notebook',
    extensions: '.ipynb',
    category: 'Data Science & Fraud',
    badge: 'Jupyter Orbital Core',
    component: JupyterNotebookLogo,
    role: 'Machine learning fraud detection, journal clustering, algorithmic sampling',
  },
  {
    id: 'xml',
    name: 'XML & XBRL Regulatory Filing',
    extensions: '.xml, .xbrl',
    category: 'Regulatory Electronic Filings',
    badge: 'Statutory Markup Tag',
    component: XmlXbrlLogo,
    role: 'MCA / SEC EDGAR corporate statutory balance sheet electronic filings',
  },
  {
    id: 'yaml',
    name: 'YAML Pipeline & Audit Config',
    extensions: '.yaml, .yml',
    category: 'Configuration & CI/CD',
    badge: 'Structured Config Tag',
    component: YamlConfigLogo,
    role: 'Docker pipelines, extraction parameters, engagement orchestration specs',
  },
  {
    id: 'zip',
    name: 'Forensic Evidence Archive',
    extensions: '.zip, .7z, .tar, .gz',
    category: 'Evidence & Backups',
    badge: 'Gold Zipper Pack',
    component: ZipArchiveLogo,
    role: 'Compressed client ledger dumps, forensic image archives, evidence packs',
  },
  {
    id: 'img',
    name: 'Scanned Voucher & Invoice',
    extensions: '.png, .jpg, .webp, .tiff',
    category: 'Voucher & Physical Evidence',
    badge: 'Photo Frame & Lens',
    component: ImageEvidenceLogo,
    role: 'Signed delivery challans, physical fixed asset photos, invoice vouchers',
  },
  {
    id: 'media',
    name: 'Statutory Interview Recording',
    extensions: '.mp4, .mov, .mp3, .wav',
    category: 'Investigation Audio/Video',
    badge: 'Media Recording Badge',
    component: MediaEvidenceLogo,
    role: 'Fraud investigation interviews, whistleblower recordings, walkthrough tapes',
  },
  {
    id: 'workspaces',
    name: 'Audit Workspaces Hub',
    extensions: 'Engagement Portfolio',
    category: 'Workspace Scope',
    badge: 'Executive Multi-Pane Vault',
    component: AuditWorkspacesLogo,
    role: 'Client fiscal engagements, multi-period statutory workpaper scopes',
  },
];

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

export default function DesignSystemPreviewPage() {
  const [isDark, setIsDark] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [lastClicked, setLastClicked] = useState<string>('None');
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
  const [quotaBannerOpen, setQuotaBannerOpen] = useState(true);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      if (next) {
        root.classList.add('dark');
        root.setAttribute('data-theme', 'dark');
      } else {
        root.classList.remove('dark');
        root.setAttribute('data-theme', 'light');
      }
    }
  };

  return (
    <div className={`min-h-screen bg-[var(--m-bg-app)] text-[var(--m-text-primary)] p-6 sm:p-12 font-sans transition-colors ${isDark ? 'dark' : ''}`}>
      <div className="max-w-4xl mx-auto space-y-10">

        {/* Top Header Row with Theme Toggle */}
        <div className="flex items-center justify-between pb-6 border-b border-[var(--m-border-subtle)]">
          <div>
            <span className="font-mono text-xs uppercase tracking-wider text-[var(--m-text-muted)]">MASh Audit Operating System</span>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--m-text-primary)] mt-1">Design System & Primitive Verification</h1>
            <p className="text-sm text-[var(--m-text-secondary)] mt-1">
              Verify atomic Lego-block components in isolation before assembling screens.
            </p>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--m-border)] bg-[var(--m-bg-surface)] hover:bg-[var(--m-bg-surface-hover)] text-xs font-medium cursor-pointer shadow-xs transition-colors"
          >
            {isDark ? <Sun size={14} className="text-amber-400" /> : <Moon size={14} className="text-indigo-600" />}
            <span>{isDark ? 'Switch to Light' : 'Switch to Dark'}</span>
          </button>
        </div>

        {/* Verification Status Banner */}
        <div className="p-3.5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[var(--m-success)]" />
            <span className="text-[var(--m-text-secondary)]">Last Component Clicked:</span>
            <span className="font-mono font-medium text-[var(--m-text-primary)]">{lastClicked}</span>
          </div>
          <button
            type="button"
            onClick={() => setIsLoading((v) => !v)}
            className="text-[var(--m-accent)] hover:underline cursor-pointer"
          >
            Toggle Button Loading State: {isLoading ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* UNIT 1: Button Primitive */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
              <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">1</span>
              <span>Button Primitive (`&lt;Button /&gt;`)</span>
            </h2>
            <span className="font-mono text-xs text-[var(--m-text-muted)]">`src/primitives/Button.tsx`</span>
          </div>

          <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-6">
            
            {/* Variants */}
            <div>
              <span className="text-xs font-mono uppercase tracking-wider text-[var(--m-text-muted)] block mb-2.5">Variants</span>
              <div className="flex flex-wrap gap-2.5 items-center">
                <Button variant="primary" loading={isLoading} onClick={() => setLastClicked('Primary Button')}>
                  Primary Action
                </Button>
                <Button variant="secondary" loading={isLoading} onClick={() => setLastClicked('Secondary Button')}>
                  Secondary Action
                </Button>
                <Button variant="ghost" loading={isLoading} onClick={() => setLastClicked('Ghost Button')}>
                  Ghost Action
                </Button>
                <Button variant="danger" loading={isLoading} onClick={() => setLastClicked('Danger Button')}>
                  Destructive
                </Button>
                <Button variant="danger-soft" loading={isLoading} onClick={() => setLastClicked('Danger-Soft Button')}>
                  Danger Soft
                </Button>
                <Button variant="secondary" disabled>
                  Disabled
                </Button>
              </div>
            </div>

            {/* Sizes & Icons */}
            <div>
              <span className="text-xs font-mono uppercase tracking-wider text-[var(--m-text-muted)] block mb-2.5">Sizes & Icons</span>
              <div className="flex flex-wrap gap-2.5 items-center">
                <Button size="sm" variant="secondary" icon={<Download size={13} />} onClick={() => setLastClicked('Small Button')}>
                  Small (h-7)
                </Button>
                <Button size="md" variant="primary" icon={<Play size={13} />} onClick={() => setLastClicked('Medium Button')}>
                  Medium (h-8)
                </Button>
                <Button size="lg" variant="secondary" icon={<ArrowRight size={15} />} iconPosition="right" onClick={() => setLastClicked('Large Button')}>
                  Large (h-10)
                </Button>
                <Button size="icon" variant="ghost" icon={<Copy size={14} />} onClick={() => setLastClicked('Icon Button')} title="Copy" />
                <Button size="icon" variant="danger-soft" icon={<Trash2 size={14} />} onClick={() => setLastClicked('Delete Icon Button')} title="Delete" />
              </div>
            </div>

          </div>
        </section>

        {/* UNIT 2: AuditBadge Primitive */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
              <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">2</span>
              <span>Audit Compliance Badges (`&lt;AuditBadge /&gt;`) — Non-Alarmist Palette</span>
            </h2>
            <span className="font-mono text-xs text-[var(--m-text-muted)]">`src/primitives/AuditBadge.tsx`</span>
          </div>

          <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-4">
            <div className="text-xs text-[var(--m-text-secondary)] leading-relaxed">
              <strong className="text-[var(--m-text-primary)]">Non-Alarmist Palette:</strong> Calibrated light shades (subtle 8–12% desaturated tints) that smoothly work on dark and light backgrounds. Eliminates glaring neon colors and background-clashing bright fills.
            </div>

            <div>
              <span className="text-xs font-mono uppercase tracking-wider text-[var(--m-text-muted)] block mb-2.5">Pre-Mapped Standard Audit Statuses</span>
              <div className="flex flex-wrap gap-2 items-center">
                <AuditBadge status="COMPLIANT" />
                <AuditBadge status="PASS" />
                <AuditBadge status="NO EXCEPTION" />
                <AuditBadge status="EXCEPTION" />
                <AuditBadge status="MATERIAL WEAKNESS" />
                <AuditBadge status="FAIL" />
                <AuditBadge status="SIGNIFICANT DEFICIENCY" />
                <AuditBadge status="CONTROL DEFICIENCY" />
                <AuditBadge status="HIGH RISK" />
                <AuditBadge status="MEDIUM RISK" />
                <AuditBadge status="LOW RISK" />
                <AuditBadge status="NOTE" />
                <AuditBadge status="WARNING" />
              </div>
            </div>

            <div className="pt-2 border-t border-[var(--m-border-subtle)]">
              <span className="text-xs font-mono uppercase tracking-wider text-[var(--m-text-muted)] block mb-2.5">Custom Ad-Hoc Auditor Tags</span>
              <div className="flex flex-wrap gap-2 items-center">
                <AuditBadge variant="danger">BENFORD LAW ANOMALY</AuditBadge>
                <AuditBadge variant="warning">PENDING PARTNER SIGN-OFF</AuditBadge>
                <AuditBadge variant="success">SAMPLE RECONCILED</AuditBadge>
                <AuditBadge variant="info">CARO 2020 DISCLOSURE</AuditBadge>
              </div>
            </div>
          </div>
        </section>

        {/* UNIT 3: AuditCallout Primitive (Blockquotes vs Badges) */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
              <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">3</span>
              <span>Audit Observation Blockquotes (`&lt;AuditCallout /&gt;`) — Content-First</span>
            </h2>
            <span className="font-mono text-xs text-[var(--m-text-muted)]">`src/primitives/AuditCallout.tsx`</span>
          </div>

          <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-5">
            <div className="text-xs text-[var(--m-text-secondary)] leading-relaxed">
              <strong className="text-[var(--m-text-primary)]">Clean Reference Blockquote:</strong> Solid 3px vertical accent bar on the left, transparent background, bold colored uppercase label on top, followed by clean body text. No artificial card boxes, no clashing borders.
            </div>

            {/* Direct Comparison */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3.5 rounded-lg bg-[var(--m-bg-app)] border border-[var(--m-border-subtle)]">
              <div>
                <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--m-text-muted)] block mb-1.5">❌ Flawed: Tiny Isolated Badge</span>
                <div className="p-3 bg-[var(--m-bg-surface)] rounded-md border border-[var(--m-border)] text-xs space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--m-text-muted)]">Observation #1:</span>
                    <AuditBadge status="MATERIAL WEAKNESS" />
                  </div>
                  <p className="text-[var(--m-text-secondary)] text-[11px] pt-1">
                    Discrepancy detected in fixed assets inventory. (Hard to notice, no authority anchor)
                  </p>
                </div>
              </div>

              <div>
                <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--m-success)] block mb-1.5">✅ Reference Blockquote (Exact Match)</span>
                <AuditCallout status="NOTE">
                  In <strong>&quot;Pro&quot; Reasoning Mode</strong>, the model generates hidden reasoning tokens (Chain-of-Thought) before writing code or checking ledger balances. We model both <strong>Standard Output</strong> (~416 tokens/call) and <strong>Pro Reasoning Output</strong> (~1,000 tokens/call including reasoning tokens).
                </AuditCallout>
              </div>
            </div>

            {/* All Statutory Callout Variants */}
            <div className="space-y-3 pt-2">
              <span className="text-xs font-mono uppercase tracking-wider text-[var(--m-text-muted)] block">All Statutory Finding Callouts</span>

              <AuditCallout
                status="EXCEPTION"
                cite="CGST Act 2017 / Rule 36(4)"
              >
                14 vendor invoices totaling ₹28.5 Lakhs claimed in GSTR-3B do not reflect in auto-populated GSTR-2B portal data for Q3.
              </AuditCallout>

              <AuditCallout
                status="CONTROL DEFICIENCY"
                title="Inadequate Segregation of Duties in ERP Vendor Master"
                cite="Section 143(3)(i) ICFR Framework"
              >
                Accounts payable executives possess dual rights to create vendor records and release payments exceeding threshold limits.
              </AuditCallout>

              <AuditCallout
                status="COMPLIANT"
                title="Statutory Dues Remittance Verified"
                cite="PF & ESI Act / CARO Clause 3(vii)"
              >
                Undisputed statutory dues including Provident Fund, ESI, and TDS have been regularly deposited with appropriate authorities without delays.
              </AuditCallout>

              <AuditCallout
                status="NOTE"
                title="Management Representation Letter Pending Signature"
                cite="SA 580 Written Representations"
              >
                Draft representation letter submitted to CFO on Sept 22; final signed copy awaited prior to report sign-off.
              </AuditCallout>
            </div>
          </div>
        </section>

        {/* UNIT 4: FilePill Primitive (Calm Ghost Styling) */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
              <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">4</span>
              <span>Interactive File Pills (`&lt;FilePill /&gt;`) — Ghost Style</span>
            </h2>
            <span className="font-mono text-xs text-[var(--m-text-muted)]">`src/primitives/FilePill.tsx`</span>
          </div>

          <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-4">
            <div className="space-y-1">
              <span className="text-xs font-mono uppercase tracking-wider text-[var(--m-text-muted)] block">
                Ghost Interaction: Calm Neutral Surface, Authentic Left Logo, Smooth Hover Highlight
              </span>
              <p className="text-[12px] text-[var(--m-text-secondary)]">
                Replaces the artificial mustard-yellow glow with a calm ghost chip. The left SVG logo provides the authentic file identity, while the chip brightens subtly upon cursor hover without layout shifts or distracting neon borders.
              </p>
            </div>

            <div className="flex flex-wrap gap-2.5 items-center p-3.5 rounded-lg bg-[var(--m-bg-app)] border border-[var(--m-border-subtle)]">
              <FilePill path="workpapers/Trade_Payables_Vouching.xlsx" line="42" onClick={() => setLastClicked('FilePill: Trade_Payables.xlsx:42')} />
              <FilePill path="reports/Statutory_Audit_Report_FY26.pdf" onClick={() => setLastClicked('FilePill: Audit_Report.pdf')} />
              <FilePill path="data/Ledger_Sampling_Results.csv" line="100-250" onClick={() => setLastClicked('FilePill: Sampling.csv:100-250')} />
              <FilePill path="plans/audit_plan.md" onClick={() => setLastClicked('FilePill: audit_plan.md')} />
              <FilePill path="controls/walkthrough.md" onClick={() => setLastClicked('FilePill: walkthrough.md')} />
              <FilePill path="procedures/benford_fraud_detection.py" line="18" onClick={() => setLastClicked('FilePill: benford.py:18')} />
              <FilePill path="queries/sap_duplicate_invoices.sql" onClick={() => setLastClicked('FilePill: duplicate_invoices.sql')} />
              <FilePill path="filings/MCA_XBRL_FY26.xml" onClick={() => setLastClicked('FilePill: XBRL_FY26.xml')} />
            </div>

            <div className="text-[11.5px] text-[var(--m-text-muted)] flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>Hover any file pill above to preview the cursor highlight response. Active click dispatches to the workspace editor.</span>
            </div>
          </div>
        </section>

        {/* UNIT 4B: ExtensionBadge, PathPill & TurnFilesGenerated (Audit Non-Alarmist Primitives) */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
              <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">4B</span>
              <span>Audit Primitives: `&lt;ExtensionBadge /&gt;`, `&lt;PathPill /&gt;` & `&lt;TurnFilesGenerated /&gt;`</span>
            </h2>
            <span className="font-mono text-xs text-[var(--m-text-muted)]">Non-Alarmist Palette for CAs & Auditors</span>
          </div>

          <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-5">
            {/* 1. Standalone File Extension Badges */}
            <div className="space-y-2">
              <span className="text-xs font-mono uppercase tracking-wider text-[var(--m-text-muted)] block">
                1. Standalone Extension Badges (`&lt;ExtensionBadge /&gt;`)
              </span>
              <p className="text-[12px] text-[var(--m-text-secondary)]">
                Static ghost badges for file formats (`.xlsx`, `.pdf`, `.md`). Logos and cursor glow removed for a clean, non-distracting monochrome audit appearance.
              </p>
              <div className="flex flex-wrap gap-2 items-center p-3 rounded-lg bg-[var(--m-bg-app)] border border-[var(--m-border-subtle)]">
                <ExtensionBadge extension=".xlsx" />
                <ExtensionBadge extension=".pdf" />
                <ExtensionBadge extension=".csv" />
                <ExtensionBadge extension=".docx" />
                <ExtensionBadge extension=".md" />
                <ExtensionBadge extension=".py" />
                <ExtensionBadge extension=".sql" />
                <ExtensionBadge extension=".json" />
                <ExtensionBadge extension=".zip" />
              </div>
            </div>

            {/* 2. Directory / Partial Path Pills */}
            <div className="space-y-2">
              <span className="text-xs font-mono uppercase tracking-wider text-[var(--m-text-muted)] block">
                2. Directory & Partial Path Pills (`&lt;PathPill /&gt;`) — Strictly Static
              </span>
              <p className="text-[12px] text-[var(--m-text-secondary)]">
                Renders workspace folders and directories cleanly. <strong className="text-[var(--m-text-primary)]">Strictly non-clickable</strong>: only files with complete paths and links are interactive, eliminating false click targets.
              </p>
              <div className="flex flex-wrap gap-2 items-center p-3 rounded-lg bg-[var(--m-bg-app)] border border-[var(--m-border-subtle)]">
                <PathPill path="workpapers/FY26/" />
                <PathPill path="Audit_Deliverables/CARO_2020/" />
                <PathPill path="procedures/statutory_vouching/" />
                <PathPill path="evidence/bank_confirmations/" />
                <PathPill path="src/primitives/" />
              </div>
            </div>

            {/* 3. Created .md Deliverables & Working Paper Cards (Rendered Before TurnFilesGenerated) */}
            <div className="space-y-2">
              <span className="text-xs font-mono uppercase tracking-wider text-[var(--m-text-muted)] block">
                3. Created .md Deliverables & Working Paper Cards (`&lt;WorkingPaperCard /&gt;`)
              </span>
              <p className="text-[12px] text-[var(--m-text-secondary)]">
                Rendered at the end of an audit procedure turn, <em>immediately before</em> the files generated section. Presents working paper memos, substantive schedules, and walkthroughs with humanized titles, executive findings, and sign-off status.
              </p>
              <div className="p-3 rounded-lg bg-[var(--m-bg-app)] border border-[var(--m-border-subtle)] space-y-2">
                <WorkingPaperCard
                  title="Revenue Recognition Testing Memo (Ind AS 115)"
                  filePath="Audit_Deliverables/Revenue_Recognition_Memo.md"
                  summary="Substantive testing of 45 high-value customer contracts; verified 5-step performance obligation satisfaction and accrued rebates."
                  type="memo"
                  status="ready_for_review"
                  onOpen={(p) => setLastClicked(`Review Working Paper: ${p}`)}
                />

                <WorkingPaperCard
                  title="Procure-to-Pay ICFR Walkthrough Documentation"
                  filePath="Audit_Deliverables/Controls_Walkthrough_P2P.md"
                  summary="End-to-end testing of 3-way matching controls between purchase orders, goods receipt notes, and vendor tax invoices."
                  type="walkthrough"
                  status="ready_for_review"
                  onOpen={(p) => setLastClicked(`Review Walkthrough: ${p}`)}
                />

                <WorkingPaperCard
                  title="Trade Payables Substantive Verification Schedule"
                  filePath="workpapers/Trade_Payables_Substantive_Testing.xlsx"
                  summary="100% sampling of balances exceeding materiality threshold (₹10 Lakhs); circularization confirmations reconciled."
                  type="schedule"
                  status="signed_off"
                  onOpen={(p) => setLastClicked(`Review Schedule: ${p}`)}
                />
              </div>
            </div>

            {/* 4. TurnFilesGenerated Component */}
            <div className="space-y-2">
              <span className="text-xs font-mono uppercase tracking-wider text-[var(--m-text-muted)] block">
                4. Files Generated at End of Turn (`&lt;TurnFilesGenerated /&gt;`)
              </span>
              <p className="text-[12px] text-[var(--m-text-secondary)]">
                Rendered at the end of an assistant turn right before the footer. Displays files produced or updated in that procedure, complete with authentic vector logos and one-click &quot;Open&quot; action into the side viewer.
              </p>
              <div className="p-3 rounded-lg bg-[var(--m-bg-app)] border border-[var(--m-border-subtle)]">
                <TurnFilesGenerated
                  files={[
                    {
                      filename: 'Revenue_Recognition_Memo.md',
                      path: 'Audit_Deliverables/Revenue_Recognition_Memo.md',
                      dir: 'Audit_Deliverables',
                      addedLines: 84,
                    },
                    {
                      filename: 'Trade_Payables_Substantive_Testing.xlsx',
                      path: 'workpapers/Trade_Payables_Substantive_Testing.xlsx',
                      dir: 'workpapers',
                      addedLines: 230,
                    },
                    {
                      filename: 'CARO_Clause_3_Summary.pdf',
                      path: 'reports/CARO_Clause_3_Summary.pdf',
                      dir: 'reports',
                    },
                  ]}
                  onOpenFile={(p) => setLastClicked(`Open Generated File: ${p}`)}
                />
              </div>
            </div>

            {/* 5. Color Grading: Calm Executive Neutral vs Old False-Alarm Yellow */}
            <div className="space-y-2 pt-1 border-t border-[var(--m-border-subtle)]">
              <span className="text-xs font-mono uppercase tracking-wider text-[var(--m-text-muted)] block">
                5. Audit Color Grading: Calm Executive Neutral vs Old False-Alarm Amber
              </span>
              <p className="text-[12px] text-[var(--m-text-secondary)]">
                In auditing, amber/yellow signals <strong className="text-amber-500 font-medium">CAUTION / RISK / DEFICIENCY</strong>. Neutral parameters and code tokens are now rendered in crisp neutral zinc to eliminate false alarms:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.04] space-y-1.5">
                  <span className="text-[11px] font-mono font-semibold text-amber-600 dark:text-amber-400 block uppercase">
                    ❌ Old Style (Jarring False Alarm)
                  </span>
                  <p className="text-xs text-[var(--m-text-secondary)]">
                    Checked formula <code className="bg-amber-500/10 text-amber-800 dark:text-amber-200 border border-amber-500/20 px-1 py-0.5 rounded font-mono text-[11px]">SUM(D2:D140)</code> under account <code className="bg-amber-500/10 text-amber-800 dark:text-amber-200 border border-amber-500/20 px-1 py-0.5 rounded font-mono text-[11px]">GL_2100_TradePayables</code>.
                  </p>
                  <span className="text-[10.5px] text-amber-700/80 dark:text-amber-400/70 block">
                    Distracting amber makes routine account codes look like audit violations.
                  </span>
                </div>

                <div className="p-3 rounded-lg border border-zinc-200/80 dark:border-white/[0.1] bg-zinc-50 dark:bg-white/[0.02] space-y-1.5">
                  <span className="text-[11px] font-mono font-semibold text-emerald-600 dark:text-emerald-400 block uppercase">
                    ✓ New Calm Executive Tone
                  </span>
                  <p className="text-xs text-[var(--m-text-secondary)]">
                    Checked formula <code className="bg-zinc-100 dark:bg-white/[0.06] text-zinc-800 dark:text-zinc-200 border border-zinc-200/80 dark:border-white/[0.08] px-1 py-0.5 rounded font-mono text-[11px]">SUM(D2:D140)</code> under account <code className="bg-zinc-100 dark:bg-white/[0.06] text-zinc-800 dark:text-zinc-200 border border-zinc-200/80 dark:border-white/[0.08] px-1 py-0.5 rounded font-mono text-[11px]">GL_2100_TradePayables</code>.
                  </p>
                  <span className="text-[10.5px] text-[var(--m-text-muted)] block">
                    Clear, calm neutral text. Amber is preserved exclusively for actual risk tags.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* UNIT 4C: QuotaBanner Primitive (System & Quota Notifications) */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
              <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">4C</span>
              <span>Quota & Rate Limit Banners (`&lt;QuotaBanner /&gt;`)</span>
            </h2>
            <span className="font-mono text-xs text-[var(--m-text-muted)]">`src/primitives/QuotaBanner.tsx`</span>
          </div>

          <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-5">
            <div className="text-xs text-[var(--m-text-secondary)] leading-relaxed space-y-1">
              <p>
                <strong className="text-[var(--m-text-primary)]">Chat UI Location & Trigger:</strong> The Quota Banner is mounted in <code className="bg-zinc-100 dark:bg-white/[0.06] text-zinc-800 dark:text-zinc-200 border border-zinc-200/80 dark:border-white/[0.08] px-1 py-0.5 rounded font-mono text-[11px]">ChatCanvas.tsx</code> directly above the bottom chat composer dock. It triggers automatically whenever the LLM or gateway returns a 429 rate limit or quota exhaustion event.
              </p>
            </div>

            {/* Interactive Control Toolbar */}
            <div className="flex flex-wrap gap-2.5 items-center p-3 rounded-lg bg-[var(--m-bg-app)] border border-[var(--m-border-subtle)] text-xs">
              <span className="text-[11px] font-mono text-[var(--m-text-muted)] uppercase tracking-wider mr-1">Controls:</span>
              <button
                type="button"
                onClick={() => setQuotaBannerOpen((v) => !v)}
                className="px-2.5 py-1 rounded-md border border-[var(--m-border)] bg-[var(--m-bg-surface)] hover:bg-[var(--m-bg-surface-hover)] font-medium cursor-pointer transition-colors"
              >
                {quotaBannerOpen ? 'Hide Banner' : 'Show Banner'}
              </button>
              <span className="text-zinc-500 text-[11.5px] ml-2">
                (Faithful 1:1 match to production Antigravity quota design — single canonical style)
              </span>
            </div>

            {/* Live Interactive Banner Display */}
            {quotaBannerOpen ? (
              <div className="space-y-3">
                <span className="text-[11px] font-mono text-[var(--m-text-muted)] uppercase tracking-wider block">
                  Live Production Quota Banner Preview
                </span>
                <QuotaBanner
                  open={quotaBannerOpen}
                  onOpenChange={setQuotaBannerOpen}
                  title="Baseline model quota reached"
                  refreshDate={new Date(Date.now() + 24 * 3600 * 1000)}
                  onSeePlans={() => setLastClicked('QuotaBanner: Clicked See Plans')}
                  onEnableOverages={() => setLastClicked('QuotaBanner: Clicked Enable Overages')}
                  onDismiss={() => {
                    setQuotaBannerOpen(false);
                    setLastClicked('QuotaBanner: Dismissed');
                  }}
                />
              </div>
            ) : (
              <div className="p-4 rounded-xl border border-dashed border-[var(--m-border)] text-center text-xs text-[var(--m-text-muted)]">
                Banner is dismissed. Click &quot;Show Banner&quot; above to re-open.
              </div>
            )}
          </div>
        </section>

        {/* UNIT 5: FileTab Primitive (Zero-Layout-Shift Hover Swap) */}
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

              {/* Row 1 Complete Header Bar (Canonical FileTabStrip Primitive) */}
              <FileTabStrip
                className="rounded-lg border border-zinc-200/70 dark:border-white/[0.08]"
                tabs={demoTabs}
                activeTabId={activeDemoTabId}
                onToggleExplorer={() => setLastClicked('Row 1: Clicked Audit Workspaces button')}
                onSelectTab={(tabId) => {
                  setActiveDemoTabId(tabId);
                  const tab = demoTabs.find((t) => t.id === tabId);
                  setLastClicked(`Selected Tab: ${tab?.title}`);
                }}
                onCloseTab={(_e, tabId) => {
                  const tab = demoTabs.find((t) => t.id === tabId);
                  setLastClicked(`Closed Tab: ${tab?.title}`);
                  setDemoTabs((prev) => prev.filter((t) => t.id !== tabId));
                  if (activeDemoTabId === tabId) {
                    const remaining = demoTabs.filter((t) => t.id !== tabId);
                    if (remaining.length > 0) setActiveDemoTabId(remaining[0].id);
                  }
                }}
                onToggleMaximize={() => setLastClicked('Row 1: Clicked Maximize button')}
                onToggleCollapse={() => setLastClicked('Row 1: Clicked Toggle Sidebar button')}
              />
            </div>

            {/* Explanatory Feature Callout */}
            <AuditCallout
              status="NOTE"
              title="UX Interaction: Side Ghost Close Button"
              cite="Workpaper Tab System"
            >
              The file extension logo stays permanently anchored on the left so file identity is never lost, while a subtle ghost close button (`[X]`) appears on the right edge upon hover for fast, distraction-free tab closing.
            </AuditCallout>
          </div>
        </section>

        {/* UNIT 6: FileBreadcrumbBar Primitive (Second Row Toolbar) */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
              <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">6</span>
              <span>Subheader File Breadcrumb Bar (`&lt;FileBreadcrumbBar /&gt;`)</span>
            </h2>
            <span className="font-mono text-xs text-[var(--m-text-muted)]">`src/primitives/FileBreadcrumbBar.tsx`</span>
          </div>

          <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-4">
            <div className="text-xs text-[var(--m-text-secondary)] leading-relaxed">
              <strong className="text-[var(--m-text-primary)]">Ghost Text Whitening with Leaf File Logo:</strong> The second row displays the full directory path hierarchy. Leading directory words are ghost-muted and transition individually to crisp white on cursor hover (no shadow/shining, no background box). The final item renders the active file with its authentic <strong>file extension logo + filename</strong>. On the far right, only the vertical 3-dots menu button remains.
            </div>

            {/* Live Interactive Breadcrumb Simulation */}
            <div className="p-3 bg-[var(--m-bg-app)] rounded-xl border border-[var(--m-border)] space-y-2">
              <span className="text-[11px] font-mono text-[var(--m-text-muted)] uppercase tracking-wider block">
                Sample 1: Deep Nested Financial Audit Workpaper (Hover individual words to test white highlight)
              </span>
              <div className="bg-[var(--m-bg-surface)] rounded-md border border-[var(--m-border-subtle)]">
                <FileBreadcrumbBar
                  path="audit_engagements/FY26_Statutory/working_papers/Trade_Payables_Vouching.xlsx"
                  onMenuClick={() => setLastClicked('FileBreadcrumbBar: 3-dots Menu')}
                />
              </div>

              <span className="text-[11px] font-mono text-[var(--m-text-muted)] uppercase tracking-wider block pt-2">
                Sample 2: Statutory Compliance Report (PDF)
              </span>
              <div className="bg-[var(--m-bg-surface)] rounded-md border border-[var(--m-border-subtle)]">
                <FileBreadcrumbBar
                  path="deliverables/CARO_2020_Clause_3_Exceptions.pdf"
                  onMenuClick={() => setLastClicked('FileBreadcrumbBar: 3-dots Menu')}
                />
              </div>

              <span className="text-[11px] font-mono text-[var(--m-text-muted)] uppercase tracking-wider block pt-2">
                Sample 3: Python Automation Procedure
              </span>
              <div className="bg-[var(--m-bg-surface)] rounded-md border border-[var(--m-border-subtle)]">
                <FileBreadcrumbBar
                  path="procedures/benford_fraud_analysis.py"
                  onMenuClick={() => setLastClicked('FileBreadcrumbBar: 3-dots Menu')}
                />
              </div>
            </div>
          </div>
        </section>

        {/* UNIT 7: Active Enterprise File & Brand Logos (<FileLogos />) */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
              <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">7</span>
              <span>Active Enterprise File & Brand Logos (`&lt;FileLogos /&gt;`)</span>
            </h2>
            <span className="font-mono text-xs text-[var(--m-text-muted)]">`src/primitives/FileLogos.tsx`</span>
          </div>

          <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-5">
            <div className="text-xs text-[var(--m-text-secondary)] leading-relaxed">
              <strong className="text-[var(--m-text-primary)]">Curated Active Brand & File Vector Logos:</strong> Standard Lucide generic document outlines look amateur in audit workpapers. Below are the 12 authentic, high-DPI vector logos actively integrated across MASh file tabs, breadcrumbs, and directory trees. Click any card to inspect its metadata.
            </div>

            {/* Active Logos Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {ACTIVE_ENTERPRISE_LOGOS.map((item) => {
                const Component = item.component;

                return (
                  <div
                    key={item.id}
                    onClick={() => setLastClicked(`Clicked Logo: ${item.name} (${item.extensions})`)}
                    className="p-3.5 rounded-lg bg-[var(--m-bg-app)] border border-[var(--m-border-subtle)] hover:border-[var(--m-accent)]/50 transition-all cursor-pointer flex flex-col justify-between space-y-3 group select-none shadow-2xs"
                  >
                    {/* Top: 16px tab scale & 22px hi-res previews */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {/* 16px Tab Scale */}
                        <div 
                          className="w-7 h-7 rounded flex items-center justify-center bg-zinc-100 dark:bg-zinc-900 border border-[var(--m-border-subtle)] group-hover:border-[var(--m-accent)]/40 transition-colors"
                          title="16px Tab Scale Preview"
                        >
                          <Component size={16} />
                        </div>
                        {/* 22px Hi-Res Scale */}
                        <div 
                          className="w-8 h-8 rounded-md flex items-center justify-center bg-zinc-100 dark:bg-zinc-900 border border-[var(--m-border-subtle)] group-hover:border-[var(--m-accent)]/40 transition-colors shadow-2xs"
                          title="Hi-Res Scale Preview"
                        >
                          <Component size={22} />
                        </div>
                      </div>

                      <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-zinc-200/50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-[var(--m-border-subtle)]">
                        {item.category}
                      </span>
                    </div>

                    {/* Middle: Name & Extensions */}
                    <div>
                      <div className="font-semibold text-xs text-[var(--m-text-primary)] group-hover:text-[var(--m-accent)] transition-colors">
                        {item.name}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="font-mono text-[10.5px] text-[var(--m-accent)] font-medium">
                          {item.extensions}
                        </span>
                        <span className="text-[10px] text-[var(--m-text-muted)]">• {item.badge}</span>
                      </div>
                    </div>

                    {/* Bottom: Auditor Context & Role */}
                    <p className="text-[11px] text-[var(--m-text-secondary)] leading-relaxed pt-1.5 border-t border-[var(--m-border-subtle)]">
                      {item.role}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Authoritative Legal & Trademark Compliance Callout */}
            <AuditCallout
              status="COMPLIANT"
              title="Legal & Trademark Compliance: Zero-Risk Nominative Fair Use"
              cite="Lanham Act §33(b)(4) / Universal Industry Standard (VS Code, JetBrains, GitHub, Notion)"
            >
              <div className="space-y-1.5 text-xs text-[var(--m-text-secondary)]">
                <p>
                  <strong className="text-[var(--m-text-primary)]">1. Protected Nominative Fair Use:</strong> Using a brand's emblem or extension identifier solely to indicate document format compatibility (e.g. indicating a file is an Excel spreadsheet or PDF document) is standard nominative fair use under international and US trademark law.
                </p>
                <p>
                  <strong className="text-[var(--m-text-primary)]">2. 100% Self-Drawn Vector Code:</strong> MASh does not extract, redistribute, or bundle proprietary fonts, DLLs, or trademarked artwork scraped from Microsoft Office, Adobe Acrobat, or commercial software installers. Every icon in <code className="font-mono text-[11px] text-[var(--m-accent)]">FileLogos.tsx</code> is a clean, original inline vector graphic.
                </p>
                <p>
                  <strong className="text-[var(--m-text-primary)]">3. Universal Industry Standard:</strong> Every major IDE and enterprise platform follows this exact practice without legal issue — including Microsoft VS Code (which ships file extension logos for thousands of formats), JetBrains, GitHub, GitLab, Notion, Slack, and Google Drive.
                </p>
                <p>
                  <strong className="text-[var(--m-text-primary)]">4. Zero Customer Confusion:</strong> MASh is an audit workspace operating system. There is no representation or claim that MASh is Microsoft, Adobe, or Python, eliminating any Lanham Act confusion claim.
                </p>
              </div>
            </AuditCallout>
          </div>
        </section>

        {/* UNIT 8: Interactive Web Links & External Anchors (<WebLink />) */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
              <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">8</span>
              <span>Interactive Web Links & External Anchors (`&lt;WebLink /&gt;`)</span>
            </h2>
            <span className="font-mono text-xs text-[var(--m-text-muted)]">`src/primitives/WebLink.tsx`</span>
          </div>

          <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-5">
            <div className="text-xs text-[var(--m-text-secondary)] leading-relaxed">
              <strong className="text-[var(--m-text-primary)]">Standardized Web & Citation Hyperlinks:</strong> All outbound URLs and statutory references render with standard security (<code className="font-mono text-[11px] text-[var(--m-accent)]">target="_blank" rel="noopener noreferrer"</code>) and the standard external indicator (<code className="font-mono text-[11px] text-[var(--m-accent)]">↗</code>). Optional one-click copy badge allows auditors to copy URLs directly into audit workpaper citations.
            </div>

            {/* Direct Match to User Specification */}
            <div className="p-4 rounded-xl bg-[var(--m-bg-app)] border border-[var(--m-border-subtle)] space-y-3">
              <span className="text-[11px] font-mono text-[var(--m-text-muted)] uppercase tracking-wider block">
                User Specification: Standard Blue Web Link with External Icon (↗)
              </span>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <WebLink href="http://localhost:3000/design-system">
                  http://localhost:3000/design-system
                </WebLink>
                <WebLink href="https://github.com" withCopy>
                  https://github.com
                </WebLink>
              </div>
            </div>

            {/* Regulatory & Statutory Citations */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              <div className="p-3.5 rounded-lg bg-[var(--m-bg-app)] border border-[var(--m-border-subtle)] space-y-2">
                <span className="text-[11px] font-mono text-[var(--m-text-muted)] uppercase tracking-wider block">
                  Statutory Regulatory Portals
                </span>
                <div className="flex flex-col space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--m-text-secondary)]">Ministry of Corporate Affairs:</span>
                    <WebLink href="https://www.mca.gov.in" withCopy>mca.gov.in</WebLink>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--m-text-secondary)]">PCAOB Auditing Standards:</span>
                    <WebLink href="https://pcaobus.org/oversight/standards" withCopy>pcaobus.org</WebLink>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--m-text-secondary)]">ICAI Standards on Auditing:</span>
                    <WebLink href="https://www.icai.org" withCopy>icai.org</WebLink>
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-[var(--m-bg-app)] border border-[var(--m-border-subtle)] space-y-2">
                <span className="text-[11px] font-mono text-[var(--m-text-muted)] uppercase tracking-wider block">
                  Inline Workpaper Statutory Anchors (`variant="citation"`)
                </span>
                <p className="text-xs text-[var(--m-text-secondary)] leading-relaxed">
                  As mandated under <WebLink href="https://www.mca.gov.in" variant="citation">MCA Section 143(3)(i)</WebLink> and reporting requirements of <WebLink href="https://www.mca.gov.in" variant="citation">CARO 2020 Clause 3(vii)</WebLink>, fixed asset register reconciliations must adhere to <WebLink href="https://www.icai.org" variant="citation">SA 315 Risk Assessment</WebLink>.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* UNIT 9: Enterprise System & Action Icons Suite */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
              <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">9</span>
              <span>Enterprise System & Action Icons (`&lt;SystemIcons /&gt;`)</span>
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
                    onClick={() => setLastClicked(`Clicked Icon: ${item.name}`)}
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

        {/* UNIT 10: Canvas Surfaces, Elevation Shades & Semantic Audit Color Tokens */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
              <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">10</span>
              <span>Elevation Tiers, Background Shades & Color Tokens Matrix</span>
            </h2>
            <span className="font-mono text-xs text-[var(--m-text-muted)]">`src/foundation/tokens.css`</span>
          </div>

          <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-6">
            <div>
              <span className="text-xs font-mono uppercase tracking-wider text-[var(--m-text-muted)] block mb-1">
                1. Four-Tier Surface Elevation Hierarchy (Dark & Light Adaptive)
              </span>
              <p className="text-[12px] text-[var(--m-text-secondary)] mb-3">
                Strict z-index and elevation tokens ensuring consistent depth between background canvas, panels, modals, and toolbars.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { name: 'Layer 0: App Canvas', token: '--m-bg-app', hexDark: '#101012', hexLight: '#F7F8F9', desc: 'Main window backdrop' },
                  { name: 'Layer 1: Surface Card', token: '--m-bg-surface', hexDark: '#141416', hexLight: '#FFFFFF', desc: 'Sidebars, cards, panels' },
                  { name: 'Layer 2: Raised Modal', token: '--m-bg-raised', hexDark: '#1A1A1D', hexLight: '#FFFFFF', desc: 'Dialogs & popovers' },
                  { name: 'Layer 3: Toolbar Row', token: '--m-bg-toolbar', hexDark: '#121214', hexLight: '#F1F3F5', desc: 'Row 1 & Row 2 headers' },
                  { name: 'Hover State Surface', token: '--m-bg-surface-hover', hexDark: 'rgba(255,255,255,0.05)', hexLight: '#F1F3F5', desc: 'Hover feedback' },
                  { name: 'Active State Surface', token: '--m-bg-surface-active', hexDark: 'rgba(255,255,255,0.09)', hexLight: '#E9ECEF', desc: 'Pressed / active items' },
                ].map((tier) => (
                  <button
                    key={tier.token}
                    type="button"
                    onClick={() => setLastClicked(`Selected Token: ${tier.token}`)}
                    className="p-3 rounded-lg border border-[var(--m-border-subtle)] text-left space-y-2 hover:border-[var(--m-accent)] transition-all cursor-pointer group"
                    style={{ backgroundColor: `var(${tier.token})` }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono text-[var(--m-text-muted)] uppercase tracking-wider">Depth</span>
                      <span className="w-2 h-2 rounded-full border border-white/20" style={{ backgroundColor: `var(${tier.token})` }} />
                    </div>
                    <div className="font-semibold text-xs text-[var(--m-text-primary)] group-hover:text-[var(--m-accent)] transition-colors">
                      {tier.name}
                    </div>
                    <div className="font-mono text-[10.5px] text-[var(--m-text-muted)]">
                      {tier.token}
                    </div>
                    <div className="text-[11px] text-[var(--m-text-secondary)]">
                      {tier.desc}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="text-xs font-mono uppercase tracking-wider text-[var(--m-text-muted)] block mb-1">
                2. Audit Semantic State Palette
              </span>
              <p className="text-[12px] text-[var(--m-text-secondary)] mb-3">
                Restrained, statutory-compliant color tokens for audit findings, risks, and execution status.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { label: 'Executive Accent', token: '--m-accent', color: '#007ACC', bgSoft: 'rgba(0, 122, 204, 0.12)', meaning: 'Primary actions, active tab accents, focus rings' },
                  { label: 'Audit Success / Pass', token: '--m-success', color: '#059669', bgSoft: 'rgba(5, 150, 105, 0.12)', meaning: 'Compliant controls, clean reconciliations, verified vouches' },
                  { label: 'Audit Warning / Risk', token: '--m-warning', color: '#B45309', bgSoft: 'rgba(180, 83, 9, 0.12)', meaning: 'Sampling exceptions, pending client queries, scope alerts' },
                  { label: 'Audit Danger / Defect', token: '--m-danger', color: '#DC2626', bgSoft: 'rgba(220, 38, 38, 0.12)', meaning: 'Material weaknesses, unrecorded liabilities, fraud flags' },
                  { label: 'Audit Information / Scope', token: '--m-info', color: '#0369A1', bgSoft: 'rgba(3, 105, 161, 0.12)', meaning: 'Standards citation (SA 500, ICAI), walkthrough guidance' },
                ].map((item) => (
                  <button
                    key={item.token}
                    type="button"
                    onClick={() => setLastClicked(`Selected Semantic Color: ${item.label} (${item.token})`)}
                    className="p-3.5 rounded-lg border border-[var(--m-border-subtle)] text-left space-y-2 hover:border-[var(--m-border)] transition-all cursor-pointer bg-[var(--m-bg-app)]"
                  >
                    <div className="flex items-center justify-between">
                      <span className="w-3.5 h-3.5 rounded-md" style={{ backgroundColor: item.color }} />
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono" style={{ backgroundColor: item.bgSoft, color: item.color }}>
                        {item.token}
                      </span>
                    </div>
                    <div className="font-semibold text-xs text-[var(--m-text-primary)]">
                      {item.label}
                    </div>
                    <p className="text-[11px] text-[var(--m-text-secondary)] leading-tight">
                      {item.meaning}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
