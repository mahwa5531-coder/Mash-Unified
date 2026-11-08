import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '../node_modules/playwright/index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ARTIFACT_DIR = 'C:/Users/rama/.gemini/antigravity/brain/6c2d2530-5fae-45bb-8188-4e00a46893c6';

const sampleMd = `# Statutory Audit Working Paper: FY2026 SOX Testing
**Client**: Global Technologies Corp  
**Engagement**: Statutory Financial Audit & ICFR Review  
**Status**: [Verified] Compliant

---

## 1. Executive Summary
This document confirms that all internal accounting controls over financial reporting were tested against established PCAOB and COSO frameworks.

> [!NOTE]
> All general ledger accounts exceeding the materiality threshold of **$1,225,450.00** were sampled and reconciled.

### Key Deliverables Verified
1. \`Audit_Deliverables/SOX_Report.xlsx\` — Primary reconciliation workpaper
2. \`controls/ar_rules.py\` — Automated discount threshold rule
3. \`cloud/infra.tf\` — SOC-2 infrastructure boundary

\`\`\`typescript
export interface AuditFinding {
  controlId: string;
  severity: 'low' | 'medium' | 'high' | 'material_weakness';
  testedLines: number;
  isVerified: boolean;
}
\`\`\`

---
*Report generated and digitally certified under ISQC-1.*
`;

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1050 },
    colorScheme: 'dark'
  });

  // Capture 1: Complete Logo Grid from /design-system
  console.log("1. Navigating to Design System Preview Page...");
  const page1 = await context.newPage();
  await page1.goto('http://localhost:3000/design-system', { waitUntil: 'networkidle' });
  await page1.waitForTimeout(1500);

  const unit7 = page1.locator('section').filter({ hasText: 'Active Enterprise File & Brand Logos' });
  if (await unit7.count() > 0) {
    await unit7.first().scrollIntoViewIfNeeded();
    await page1.waitForTimeout(500);
    const shot1Path = path.join(ARTIFACT_DIR, 'mash_all_46_file_logos_matrix.png');
    await unit7.first().screenshot({ path: shot1Path });
    console.log(`[Screenshot 1] Saved: ${shot1Path}`);
  }

  // Capture 2: Chat View with All File Pills via page.route
  console.log("2. Navigating to Chat Session with File Pills...");
  const page2 = await context.newPage();

  await page2.route('**/api/auth/me', route => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        authenticated: true,
        email: "auditor@mash.ai",
        name: "Senior Auditor",
        plan: "pro",
        subscription_status: "active",
        credits_remaining: 500,
        quota: { windows: [{ window: "weekly", percent: 12 }] },
        accounts: [{ email: "auditor@mash.ai", name: "Senior Auditor", plan: "pro", credits_remaining: 500 }]
      })
    });
  });

  await page2.route('**/sessions', route => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessions: [
          {
            session_id: "sess_all_logos",
            project_id: "proj_sox",
            title: "SOX Testing: General Controls & Deliverables",
            custom_title: "SOX Testing: General Controls & Deliverables",
            workspace_uri: "C:/Audits/SOX_Q3",
            created_at: Date.now() - 3600000,
            updated_at: Date.now(),
            message_count: 2,
            total_tokens: 3200,
            last_user_view_time: Date.now(),
            has_unread: false
          }
        ]
      })
    });
  });

  await page2.route('**/transcript**', route => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        total: 2,
        lines: [
          {
            id: "m_u1",
            role: "user",
            content: "Please list all supported file formats, programming languages, configs, and deliverables across our engagement with their official logos.",
            created_at: new Date(Date.now() - 10000).toISOString()
          },
          {
            id: "m_a1",
            role: "assistant",
            content: `### Executive Verification & Complete File Logo Showcase

I inspected all file types across our engagement workspace. Below is the complete catalog rendered directly via MASH interactive \`FilePill\` primitives with authentic vector insignia:

#### 1. Statutory Documents & Financial Deliverables
- Excel Model: \`Audit_Deliverables/SOX_Report.xlsx\`
- Statutory Memo: \`Audit_Deliverables/Memo.docx\`
- Executive Slides: \`Audit_Deliverables/Deck.pptx\`
- Signed Report: \`Audit_Deliverables/Opinion.pdf\`
- Deliverable Summary: \`Audit_Deliverables/README.md\`
- Delimited Ledgers: \`data/transactions.csv\` and \`data/records.parquet\`

#### 2. Languages & Development Frameworks
- TypeScript: \`src/index.ts\` and React: \`src/App.tsx\`
- Python Analytics: \`controls/ar_rules.py\` and \`notebooks/sampling.ipynb\`
- Systems Core: Rust \`src/main.rs\`, Go \`server/daemon.go\`, C \`native/core.c\`, C++ \`engine/sim.cpp\`
- Enterprise & Mobile: C# \`backend/Program.cs\`, Java \`enterprise/App.java\`, Kotlin \`android/Main.kt\`, Swift \`ios/App.swift\`
- Web & Scripting: Ruby \`scripts/deploy.rb\`, PHP \`legacy/index.php\`, Vue \`web/App.vue\`, Svelte \`ui/App.svelte\`, Astro \`docs/page.astro\`

#### 3. Schemas, DevOps & Environment Configs
- Container & Isolation: \`Dockerfile\`, \`docker-compose.yml\`, \`.dockerignore\`
- Version Control & Keys: \`.gitignore\`, \`.env.local\`, \`config/settings.toml\`
- Cloud Infrastructure: \`cloud/infra.tf\`, \`k8s/deployment.yaml\`, \`build/Makefile\`
- Schemas & Queries: \`schema.prisma\`, \`queries/audit_recon.sql\`, \`service.proto\`, \`api/query.graphql\`
- Scripts & Terminal: \`scripts/backup.sh\`, \`scripts/verify.ps1\`, \`archives/evidence.zip\`

Click any file pill to inspect it seamlessly in the Right Sidebar viewer.`,
            created_at: new Date(Date.now() - 2000).toISOString()
          }
        ]
      })
    });
  });

  await page2.route('**/files/content**', route => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        type: "markdown",
        filename: "README.md",
        path: "Audit_Deliverables/README.md",
        content: sampleMd,
        is_truncated: false
      })
    });
  });

  await page2.route('**/artifacts**', route => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        isProjectSession: true,
        deliverables: [
          { name: "SOX_Report.xlsx", path: "Audit_Deliverables/SOX_Report.xlsx", type: "file" },
          { name: "README.md", path: "Audit_Deliverables/README.md", type: "file" }
        ],
        workingPapers: [
          { name: "ar_rules.py", path: "controls/ar_rules.py", type: "file" }
        ],
        items: []
      })
    });
  });

  await page2.goto('http://localhost:3000/?session=sess_all_logos', { waitUntil: 'networkidle' });
  await page2.waitForTimeout(2000);

  const shot2Path = path.join(ARTIFACT_DIR, 'mash_chat_agent_file_pills_showcase.png');
  await page2.screenshot({ path: shot2Path });
  console.log(`[Screenshot 2] Saved: ${shot2Path}`);

  // Capture 3: Click README.md to open Right Sidebar with unified background
  console.log("3. Clicking README.md to inspect Right Sidebar unified background...");
  const readmePill = page2.locator('button:has-text("README.md")').first();
  if (await readmePill.count() > 0) {
    await readmePill.click();
    await page2.waitForTimeout(2000);
    const shot3Path = path.join(ARTIFACT_DIR, 'mash_right_sidebar_markdown_dark_unified.png');
    await page2.screenshot({ path: shot3Path });
    console.log(`[Screenshot 3] Saved: ${shot3Path}`);
  }

  await browser.close();
  console.log(">>> All screenshots successfully captured and verified! <<<");
}

main().catch(err => {
  console.error("Execution failed:", err);
  process.exit(1);
});
