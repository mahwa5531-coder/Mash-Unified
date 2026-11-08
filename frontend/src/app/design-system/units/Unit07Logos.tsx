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
  AuditWorkspacesLogo,
  TypeScriptLogo,
  JavaScriptLogo,
  ReactLogo,
  RustLogo,
  GoLogo,
  CLogo,
  CppLogo,
  CSharpLogo,
  JavaLogo,
  KotlinLogo,
  SwiftLogo,
  RubyLogo,
  PhpLogo,
  VueLogo,
  SvelteLogo,
  AstroLogo,
  HtmlLogo,
  CssLogo,
  SassLogo,
  TailwindLogo,
  GraphqlLogo,
  PrismaLogo,
  ProtobufLogo,
  DartLogo,
  LuaLogo,
  ZigLogo,
  ElixirLogo,
  ScalaLogo,
  HaskellLogo,
  DockerLogo,
  GitLogo,
  EnvConfigLogo,
  ConfigSettingsLogo,
  KubernetesLogo,
  TerraformLogo,
  MakefileLogo,
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
  // 1. Core Statutory & Documents
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
    id: 'pptx',
    name: 'Microsoft PowerPoint 365',
    extensions: '.pptx, .ppt, .odp',
    category: 'Presentations & Decks',
    badge: 'Fluent 365 3D Tile',
    component: FluentPowerPointLogo,
    role: 'Audit committee decks, board presentations, partner findings briefings',
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

  // 2. TypeScript & JavaScript Ecosystem
  {
    id: 'ts',
    name: 'TypeScript',
    extensions: '.ts, .mts, tsconfig.json',
    category: 'Frontend & Fullstack',
    badge: 'Official Blue TS Tile',
    component: TypeScriptLogo,
    role: 'Type-safe enterprise applications, API schemas, fullstack backends',
  },
  {
    id: 'tsx',
    name: 'React Ecosystem',
    extensions: '.tsx, .jsx',
    category: 'Frontend & UI',
    badge: 'Official Cyan Atom',
    component: ReactLogo,
    role: 'Interactive UI components, design system widgets, chat canvas views',
  },
  {
    id: 'js',
    name: 'JavaScript',
    extensions: '.js, .mjs, .cjs',
    category: 'Frontend & Node.js',
    badge: 'Official Gold JS Tile',
    component: JavaScriptLogo,
    role: 'Web client scripts, Node.js microservices, browser automation',
  },

  // 3. Data Science & Backend
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
    id: 'ipynb',
    name: 'Jupyter Notebook',
    extensions: '.ipynb',
    category: 'Data Science & Fraud',
    badge: 'Jupyter Orbital Core',
    component: JupyterNotebookLogo,
    role: 'Machine learning fraud detection, journal clustering, algorithmic sampling',
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

  // 4. Systems Programming
  {
    id: 'rs',
    name: 'Rust',
    extensions: '.rs, Cargo.toml',
    category: 'Systems & Security',
    badge: 'Official Gear R',
    component: RustLogo,
    role: 'High-performance cryptographic verification, parsing engines, WASM',
  },
  {
    id: 'go',
    name: 'Go Language',
    extensions: '.go, go.mod',
    category: 'Cloud & Services',
    badge: 'Official Cyan GO',
    component: GoLogo,
    role: 'Distributed audit microservices, concurrent log streaming, network daemons',
  },
  {
    id: 'c',
    name: 'C Language',
    extensions: '.c, .h',
    category: 'Systems & Embedded',
    badge: 'Blue Hexagon C',
    component: CLogo,
    role: 'Embedded firmware, hardware verification, native C bindings',
  },
  {
    id: 'cpp',
    name: 'C++ Language',
    extensions: '.cpp, .hpp, .cc',
    category: 'High Performance',
    badge: 'Blue Hexagon C++',
    component: CppLogo,
    role: 'High-throughput algorithmic computation, quantitative simulation',
  },
  {
    id: 'cs',
    name: 'C# / .NET',
    extensions: '.cs, .csx',
    category: 'Enterprise .NET',
    badge: 'Purple Hexagon C#',
    component: CSharpLogo,
    role: 'Enterprise ERP connectors, Microsoft Azure integrations, Windows apps',
  },
  {
    id: 'java',
    name: 'Java',
    extensions: '.java, .jar',
    category: 'Enterprise Backend',
    badge: 'Duke Coffee Cup',
    component: JavaLogo,
    role: 'Banking infrastructure, large-scale transaction ledgers, Spring Boot',
  },
  {
    id: 'kt',
    name: 'Kotlin',
    extensions: '.kt, .kts',
    category: 'Mobile & Cloud',
    badge: 'Official Kotlin Polygon',
    component: KotlinLogo,
    role: 'Android enterprise clients, modern multiplatform backends',
  },
  {
    id: 'swift',
    name: 'Swift',
    extensions: '.swift',
    category: 'Apple & Mobile',
    badge: 'Official Orange Bird',
    component: SwiftLogo,
    role: 'iOS client security agents, macOS executive audit cockpits',
  },
  {
    id: 'rb',
    name: 'Ruby',
    extensions: '.rb, Gemfile',
    category: 'Web & Scripting',
    badge: 'Ruby Red Gem',
    component: RubyLogo,
    role: 'Rails web applications, rapid prototyping, DevOps automation',
  },
  {
    id: 'php',
    name: 'PHP',
    extensions: '.php',
    category: 'Web Platforms',
    badge: 'Indigo Oval php',
    component: PhpLogo,
    role: 'Legacy eCommerce audits, WordPress/Drupal security assessments',
  },

  // 5. Modern Web Frameworks & Markup
  {
    id: 'vue',
    name: 'Vue.js',
    extensions: '.vue',
    category: 'Web Frameworks',
    badge: 'Official Emerald V',
    component: VueLogo,
    role: 'Progressive web applications, interactive enterprise dashboards',
  },
  {
    id: 'svelte',
    name: 'Svelte',
    extensions: '.svelte',
    category: 'Reactive UI',
    badge: 'Bright Orange S',
    component: SvelteLogo,
    role: 'Zero-runtime reactive interfaces, lightning fast visual widgets',
  },
  {
    id: 'astro',
    name: 'Astro',
    extensions: '.astro',
    category: 'Content Web',
    badge: 'Rocket Badge',
    component: AstroLogo,
    role: 'Content-driven client knowledge portals, fast documentation hubs',
  },
  {
    id: 'html',
    name: 'HTML5',
    extensions: '.html, .htm',
    category: 'Web Structure',
    badge: 'W3C Orange Shield',
    component: HtmlLogo,
    role: 'Rendered statutory reports, email evidence templates, web structures',
  },
  {
    id: 'css',
    name: 'CSS3',
    extensions: '.css',
    category: 'Web Styling',
    badge: 'Blue Shield #',
    component: CssLogo,
    role: 'Custom audit themes, typography sheets, print media styling',
  },
  {
    id: 'scss',
    name: 'Sass / SCSS',
    extensions: '.scss, .sass',
    category: 'CSS Preprocessor',
    badge: 'Pink SCSS Badge',
    component: SassLogo,
    role: 'Modular style architectures, design token pre-processing',
  },
  {
    id: 'tailwind',
    name: 'Tailwind CSS',
    extensions: 'tailwind.config.js',
    category: 'Utility Styling',
    badge: 'Cyan Dual Crest',
    component: TailwindLogo,
    role: 'Design system primitives, responsive tokens, rapid UI assembly',
  },

  // 6. Schemas, APIs & Data
  {
    id: 'graphql',
    name: 'GraphQL',
    extensions: '.graphql, .gql',
    category: 'API & Schemas',
    badge: 'Pink Hexagon Nodes',
    component: GraphqlLogo,
    role: 'Federated audit data graphs, client query schemas, field-level access',
  },
  {
    id: 'prisma',
    name: 'Prisma ORM',
    extensions: '.prisma',
    category: 'Database ORM',
    badge: 'Slate & Cyan Prism',
    component: PrismaLogo,
    role: 'Declarative database models, schema migrations, relation graphs',
  },
  {
    id: 'proto',
    name: 'Protocol Buffers',
    extensions: '.proto',
    category: 'Binary RPC',
    badge: 'Blue Proto Badge',
    component: ProtobufLogo,
    role: 'gRPC streaming definitions, high-efficiency binary transport',
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
    id: 'yaml',
    name: 'YAML Pipeline Config',
    extensions: '.yaml, .yml',
    category: 'Configuration & CI/CD',
    badge: 'Purple YML Tag',
    component: YamlConfigLogo,
    role: 'Docker pipelines, extraction parameters, engagement orchestration specs',
  },
  {
    id: 'xml',
    name: 'XML & XBRL Regulatory',
    extensions: '.xml, .xbrl',
    category: 'Regulatory Electronic Filings',
    badge: 'Statutory XML Tag',
    component: XmlXbrlLogo,
    role: 'MCA / SEC EDGAR corporate statutory balance sheet electronic filings',
  },

  // 7. DevOps & Infrastructure
  {
    id: 'docker',
    name: 'Docker Container',
    extensions: 'Dockerfile, .dockerignore',
    category: 'Containers & Isolation',
    badge: 'Official Whale Grid',
    component: DockerLogo,
    role: 'Sandboxed Python execution environments, air-gapped auditor runtimes',
  },
  {
    id: 'git',
    name: 'Git Version Control',
    extensions: '.gitignore, .gitmodules',
    category: 'Version Control',
    badge: 'Orange Branch Diamond',
    component: GitLogo,
    role: 'Audit trail versioning, immutable workpaper commit histories',
  },
  {
    id: 'env',
    name: 'Secret & Environment Config',
    extensions: '.env, .env.local',
    category: 'Secrets & Keys',
    badge: 'Amber Lock & Key',
    component: EnvConfigLogo,
    role: 'API credentials, database tokens, encrypted workspace environment variables',
  },
  {
    id: 'config',
    name: 'Configuration Settings',
    extensions: '.toml, .ini, .conf',
    category: 'System Config',
    badge: 'Sliders & Gear',
    component: ConfigSettingsLogo,
    role: 'Server configs, system settings, linting rules, workspace preferences',
  },
  {
    id: 'k8s',
    name: 'Kubernetes',
    extensions: '.k8s, helm',
    category: 'Cloud Orchestration',
    badge: 'Blue Helm Wheel',
    component: KubernetesLogo,
    role: 'Container orchestration, multi-tenant auditor cluster deployment',
  },
  {
    id: 'tf',
    name: 'Terraform',
    extensions: '.tf, .tfvars',
    category: 'Infrastructure as Code',
    badge: 'Purple Prisms',
    component: TerraformLogo,
    role: 'Automated cloud infrastructure provisioning, SOX cloud governance',
  },
  {
    id: 'makefile',
    name: 'Makefile / Build',
    extensions: 'Makefile, GNUmakefile',
    category: 'Build Automation',
    badge: 'Charcoal Build M',
    component: MakefileLogo,
    role: 'Build recipes, test automation pipelines, compilation rules',
  },
  {
    id: 'terminal',
    name: 'Interactive Terminal',
    extensions: '.sh, .bash, .ps1',
    category: 'Shell & Terminal',
    badge: 'CLI Console >_',
    component: ConsoleTerminalLogo,
    role: 'PowerShell / Bash audit scripts, automated command execution',
  },

  // 8. Specialized Languages
  {
    id: 'dart',
    name: 'Dart',
    extensions: '.dart',
    category: 'Cross-Platform',
    badge: 'Cyan Chevron',
    component: DartLogo,
    role: 'Flutter mobile client development, client-facing survey apps',
  },
  {
    id: 'lua',
    name: 'Lua',
    extensions: '.lua',
    category: 'Embedded Scripts',
    badge: 'Blue Planet Moon',
    component: LuaLogo,
    role: 'Nginx request inspection, Redis Lua transactional audit scripts',
  },
  {
    id: 'zig',
    name: 'Zig Language',
    extensions: '.zig',
    category: 'Low-Level Systems',
    badge: 'Orange Z',
    component: ZigLogo,
    role: 'Zero-overhead memory-safe binary validation, modern C replacement',
  },
  {
    id: 'elixir',
    name: 'Elixir',
    extensions: '.ex, .exs',
    category: 'Erlang VM / BEAM',
    badge: 'Purple Teardrop',
    component: ElixirLogo,
    role: 'Fault-tolerant distributed log streaming, real-time telemetry processing',
  },
  {
    id: 'scala',
    name: 'Scala',
    extensions: '.scala',
    category: 'Big Data & Spark',
    badge: 'Crimson Stairs',
    component: ScalaLogo,
    role: 'Apache Spark petabyte transaction analytics, functional data pipelines',
  },
  {
    id: 'haskell',
    name: 'Haskell',
    extensions: '.hs',
    category: 'Pure Functional',
    badge: 'Purple Lambda',
    component: HaskellLogo,
    role: 'Formal verification, provably correct accounting equation proofs',
  },

  // 9. Media, System & Workspace
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
    id: 'folder',
    name: 'Enterprise Audit Folder',
    extensions: 'Directory / Binder',
    category: 'File System',
    badge: 'Manila Gold Binder',
    component: EnterpriseFolderLogo,
    role: 'Client fiscal binders, lead schedule folders, engagement archives',
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
        <div className="text-xs text-[var(--m-text-secondary)] leading-relaxed flex items-center justify-between">
          <span>
            <strong className="text-[var(--m-text-primary)]">Curated Active Brand &amp; File Vector Logos ({ACTIVE_ENTERPRISE_LOGOS.length} Authentic Emblems):</strong> Every logo is rendered as pure SVG vector geometry with authentic brand branding.
          </span>
          <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-mono">
            {ACTIVE_ENTERPRISE_LOGOS.length} Active Logos
          </span>
        </div>

        {/* Active Logos Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {ACTIVE_ENTERPRISE_LOGOS.map((item) => {
            const Component = item.component;

            return (
              <div
                key={item.id}
                onClick={() => onSelectComponent(`Clicked Logo: ${item.name} (${item.extensions})`)}
                className="p-3 rounded-lg bg-[var(--m-bg-app)] border border-[var(--m-border-subtle)] hover:border-[var(--m-accent)]/50 transition-all cursor-pointer flex flex-col justify-between space-y-2.5 group select-none shadow-2xs"
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

                  <span className="font-mono text-[9.5px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-200/50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-[var(--m-border-subtle)]">
                    {item.category}
                  </span>
                </div>

                {/* Middle: Name & Extensions */}
                <div>
                  <div className="font-semibold text-xs text-[var(--m-text-primary)] group-hover:text-[var(--m-accent)] transition-colors truncate">
                    {item.name}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="font-mono text-[10px] text-[var(--m-accent)] font-medium truncate">
                      {item.extensions}
                    </span>
                  </div>
                </div>

                {/* Bottom: Role */}
                <p className="text-[10.5px] text-[var(--m-text-secondary)] leading-relaxed pt-1.5 border-t border-[var(--m-border-subtle)] line-clamp-2">
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
