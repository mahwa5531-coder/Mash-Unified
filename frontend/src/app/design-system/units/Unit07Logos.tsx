"use client";

import React from 'react';
import { 
  AuditCallout, 
  FluentExcelLogo, 
  AdobePdfLogo, 
  CsvDelimitedLogo, 
  FluentWordLogo, 
  ImplementationPlanLogo, 
  AuditWalkthroughLogo, 
  AuthenticPythonLogo, 
  SqlDatabaseLogo, 
  OfficialMarkdownLogo, 
  JsonObjectLogo, 
  ConsoleTerminalLogo, 
  EnterpriseFolderLogo, 
  FluentPowerPointLogo, 
  JupyterNotebookLogo, 
  XmlXbrlLogo, 
  YamlConfigLogo, 
  ZipArchiveLogo, 
  ImageEvidenceLogo, 
  MediaEvidenceLogo, 
  AuditWorkspacesLogo 
} from '@/primitives';

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

interface Unit07LogosProps {
  onSelectComponent: (name: string) => void;
}

export function Unit07Logos({ onSelectComponent }: Unit07LogosProps) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
          <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">7</span>
          <span>Active Enterprise File &amp; Brand Logos (`&lt;FileLogos /&gt;`)</span>
        </h2>
        <span className="font-mono text-xs text-[var(--m-text-muted)]">`src/primitives/FileLogos.tsx`</span>
      </div>

      <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-5">
        <div className="text-xs text-[var(--m-text-secondary)] leading-relaxed">
          <strong className="text-[var(--m-text-primary)]">Curated Active Brand & File Vector Logos:</strong> Standard Lucide generic document outlines look amateur in audit workpapers. Below are the authentic, high-DPI vector logos actively integrated across MASh file tabs, breadcrumbs, and directory trees. Click any card to inspect its metadata.
        </div>

        {/* Active Logos Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {ACTIVE_ENTERPRISE_LOGOS.map((item) => {
            const Component = item.component;

            return (
              <div
                key={item.id}
                onClick={() => onSelectComponent(`Clicked Logo: ${item.name} (${item.extensions})`)}
                className="p-3.5 rounded-lg bg-[var(--m-bg-app)] border border-[var(--m-border-subtle)] hover:border-[var(--m-accent)]/50 transition-all cursor-pointer flex flex-col justify-between space-y-3 group select-none shadow-2xs"
              >
                {/* Top: 16px tab scale & 22px hi-res previews */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-7 h-7 rounded flex items-center justify-center bg-zinc-100 dark:bg-zinc-900 border border-[var(--m-border-subtle)] group-hover:border-[var(--m-accent)]/40 transition-colors"
                      title="16px Tab Scale Preview"
                    >
                      <Component size={16} />
                    </div>
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
              <strong className="text-[var(--m-text-primary)]">1. Protected Nominative Fair Use:</strong> Using a brand's emblem or extension identifier solely to indicate document format compatibility is standard nominative fair use under international and US trademark law.
            </p>
            <p>
              <strong className="text-[var(--m-text-primary)]">2. 100% Self-Drawn Vector Code:</strong> MASh does not extract, redistribute, or bundle proprietary fonts, DLLs, or trademarked artwork scraped from commercial installers. Every icon in <code className="font-mono text-[11px] text-[var(--m-accent)]">FileLogos.tsx</code> is a clean, original inline vector graphic.
            </p>
          </div>
        </AuditCallout>
      </div>
    </section>
  );
}
