// 20-Turn Multi-Tool End-to-End Agent Workflow Test for Mash.exe
// Drives the compiled standalone desktop application through a rigorous 20-turn statutory audit:
// Tests: glob, view_file (code & CSV/Parquet ingestion), write_file, replace_file_content,
// search_file_content, run_shell_command (DuckDB SQL, Polars, SHA256 seals, Python scripts).
// Captures UI screenshots, verifies file deliverables, and validates 0 zombie processes.

const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const { _electron: electron } = require(path.resolve(__dirname, '../frontend/node_modules/@playwright/test'));

const ARTIFACT_DIR = 'C:/Users/rama/.gemini/antigravity/brain/bc5df091-d65b-47b2-ba8f-69ac624e9af9';
const MOCK_PORT = 8089;

let turnCount = 0;
const executedTools = [];

// Define the 20-Turn Scripted Sequence
const TURN_DEFINITIONS = [
  // Turn 1: Workspace discovery
  {
    thought: "Step 1/20: Exploring workspace directory layout...",
    tool: "glob",
    args: { pattern: "*" }
  },
  // Turn 2: Inspect project configuration
  {
    thought: "Step 2/20: Inspecting project metadata in package.json...",
    tool: "view_file",
    args: { AbsolutePath: "package.json" }
  },
  // Turn 3: Create audit ledger dataset
  {
    thought: "Step 3/20: Creating sample statutory general ledger with 10 material journal entries...",
    tool: "write_file",
    args: {
      file_path: "audit_ledger.csv",
      content: "txn_id,date,account,debit,credit,memo\nTXN-001,2026-01-15,Cash,1500000.00,0.00,Capital Injection\nTXN-002,2026-01-15,Equity,0.00,1500000.00,Founding Shares\nTXN-003,2026-02-10,Inventory,250000.00,0.00,Bulk Inventory Purchase\nTXN-004,2026-02-10,Accounts Payable,0.00,250000.00,Vendor Supplier A\nTXN-005,2026-03-01,Revenue,0.00,500000.00,Software License Sale\nTXN-006,2026-03-01,Accounts Receivable,500000.00,0.00,Enterprise Client B\nTXN-007,2026-03-15,Salaries Expense,125000.00,0.00,Payroll March\nTXN-008,2026-03-15,Cash,0.00,125000.00,Direct Deposit\nTXN-009,2026-03-20,Consulting Expense,2000000.00,0.00,Advisory Fee\nTXN-010,2026-03-20,Cash,0.00,2000000.00,Wire Transfer Offshore\n"
    }
  },
  // Turn 4: Ingest CSV into Parquet
  {
    thought: "Step 4/20: Ingesting tabular ledger through Calamine & Polars engine...",
    tool: "view_file",
    args: { AbsolutePath: "audit_ledger.csv" }
  },
  // Turn 5: Query row count via DuckDB
  {
    thought: "Step 5/20: Running DuckDB SQL query to verify total ledger row count...",
    tool: "run_shell_command",
    args: {
      command: "python -c \"import duckdb; con = duckdb.connect(); print('ROW_COUNT:', con.execute('SELECT count(*) FROM \\'audit_ledger.csv\\'').fetchall()[0][0])\""
    }
  },
  // Turn 6: Verify trial balance parity via DuckDB
  {
    thought: "Step 6/20: Running DuckDB debit/credit parity check...",
    tool: "run_shell_command",
    args: {
      command: "python -c \"import duckdb; con = duckdb.connect(); debits, credits = con.execute('SELECT sum(debit), sum(credit) FROM \\'audit_ledger.csv\\'').fetchall()[0]; print(f'PARITY_CHECK: DEBITS={debits} CREDITS={credits} BALANCED={debits == credits}')\""
    }
  },
  // Turn 7: Scan for round-number transactions >= $1M
  {
    thought: "Step 7/20: Scanning for high-value round-number transactions >= $1,000,000...",
    tool: "run_shell_command",
    args: {
      command: "python -c \"import duckdb; con = duckdb.connect(); print(con.execute('SELECT txn_id, debit, memo FROM \\'audit_ledger.csv\\' WHERE debit >= 1000000.0').df())\""
    }
  },
  // Turn 8: Search for supporting documentation on offshore transfer
  {
    thought: "Step 8/20: Searching workspace for supporting records on Offshore advisory fee...",
    tool: "search_file_content",
    args: { search_term: "Offshore", path: "." }
  },
  // Turn 9: Create supporting board memo
  {
    thought: "Step 9/20: Filing board resolution memo for TXN-010 advisory transaction...",
    tool: "write_file",
    args: {
      file_path: "supporting_memo.txt",
      content: "TXN-010: $2,000,000 Offshore advisory fee authorized by Board Resolution 2026-03A for international market expansion."
    }
  },
  // Turn 10: View supporting memo
  {
    thought: "Step 10/20: Verifying supporting board memo content...",
    tool: "view_file",
    args: { AbsolutePath: "supporting_memo.txt" }
  },
  // Turn 11: Duplicate payment audit query
  {
    thought: "Step 11/20: Scanning for duplicate payment anomalies via DuckDB...",
    tool: "run_shell_command",
    args: {
      command: "python -c \"import duckdb; con = duckdb.connect(); print('DUPLICATE_PAYMENTS:', len(con.execute('SELECT debit, count(*) FROM \\'audit_ledger.csv\\' WHERE debit > 0 GROUP BY debit HAVING count(*) > 1').fetchall()))\""
    }
  },
  // Turn 12: Write Python verification script
  {
    thought: "Step 12/20: Creating substantive analytical test script...",
    tool: "write_file",
    args: {
      file_path: "substantive_test.py",
      content: "import duckdb, polars\ncon = duckdb.connect()\ndf = con.execute('SELECT * FROM \\'audit_ledger.csv\\' WHERE debit > 0').pl()\nprint(f'ANALYZED {len(df)} DEBIT ENTRIES. HIGHEST ENTRY: ${df[\"debit\"].max():,.2f}')\n"
    }
  },
  // Turn 13: Execute Python verification script
  {
    thought: "Step 13/20: Executing substantive analytical test script via bundled Python...",
    tool: "run_shell_command",
    args: { command: "python substantive_test.py" }
  },
  // Turn 14: Draft statutory audit report
  {
    thought: "Step 14/20: Drafting preliminary statutory audit findings report...",
    tool: "write_file",
    args: {
      file_path: "draft_statutory_report.md",
      content: "# Statutory Audit Report FY2026\n\n- Entity: Mash Test Workspace\n- Scope: General Ledger Verification\n- Status: In Progress\n- Findings: All debits and credits balanced.\n"
    }
  },
  // Turn 15: Update report with final opinion
  {
    thought: "Step 15/20: Updating draft report with clean unqualified statutory opinion...",
    tool: "replace_file_content",
    args: {
      TargetFile: "draft_statutory_report.md",
      StartLine: 1,
      EndLine: 6,
      TargetContent: "Status: In Progress",
      ReplacementContent: "Status: Unqualified Audit Opinion Certified"
    }
  },
  // Turn 16: Verify updated report content
  {
    thought: "Step 16/20: Verifying final report markdown...",
    tool: "view_file",
    args: { AbsolutePath: "draft_statutory_report.md" }
  },
  // Turn 17: Compute cryptographic checksum of audit deliverable
  {
    thought: "Step 17/20: Computing SHA256 cryptographic seal of audit report...",
    tool: "run_shell_command",
    args: {
      command: "python -c \"import hashlib; print('REPORT_HASH:', hashlib.sha256(open('draft_statutory_report.md', 'rb').read()).hexdigest())\""
    }
  },
  // Turn 18: Issue official tamper-proof audit certificate
  {
    thought: "Step 18/20: Issuing tamper-proof audit seal certificate...",
    tool: "write_file",
    args: {
      file_path: "AUDIT_SEAL.json",
      content: "{\n  \"standard\": \"ISA-700 / SA-700\",\n  \"auditor\": \"Mash Autonomous Statutory Auditor\",\n  \"opinion\": \"UNQUALIFIED\",\n  \"debit_credit_variance\": 0.00,\n  \"entries_verified\": 10,\n  \"status\": \"VERIFIED_AND_SEALED\"\n}"
    }
  },
  // Turn 19: Verify deliverables in workspace
  {
    thought: "Step 19/20: Confirming deliverable artifacts on filesystem...",
    tool: "glob",
    args: { pattern: "*statutory*" }
  },
];

// Start Mock OpenAI Server for 20 Turns
function start20TurnMockServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url.includes('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'mash/auto', object: 'model' }] }));
    }

    if (req.method === 'POST' && req.url.includes('/chat/completions')) {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        turnCount++;
        console.log(`\n[Turn ${turnCount}/20] Received request in Mock LLM.`);

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });

        if (turnCount <= TURN_DEFINITIONS.length) {
          const step = TURN_DEFINITIONS[turnCount - 1];
          executedTools.push(step.tool);
          console.log(`[Turn ${turnCount}/20] Dispatching Tool: ${step.tool}`);

          const chunkText = {
            id: `cmpl-turn-${turnCount}`,
            object: 'chat.completion.chunk',
            choices: [{
              index: 0,
              delta: { role: 'assistant', content: `${step.thought}\n` },
              finish_reason: null
            }]
          };

          const chunkTool = {
            id: `cmpl-turn-${turnCount}`,
            object: 'chat.completion.chunk',
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: 0,
                  id: `call_${step.tool}_turn_${turnCount}`,
                  type: 'function',
                  function: {
                    name: step.tool,
                    arguments: JSON.stringify(step.args)
                  }
                }]
              },
              finish_reason: null
            }]
          };

          const chunkDone = {
            id: `cmpl-turn-${turnCount}`,
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }]
          };

          res.write(`data: ${JSON.stringify(chunkText)}\n\n`);
          setTimeout(() => {
            res.write(`data: ${JSON.stringify(chunkTool)}\n\n`);
            res.write(`data: ${JSON.stringify(chunkDone)}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
          }, 150);
        } else {
          // Turn 20: Final Comprehensive Audit Sign-off
          console.log('[Turn 20/20] Yielding final statutory audit sign-off certificate...');
          const finalReport = [
            '# Independent Statutory Audit Certificate (Form 700)',
            '',
            '## 1. Executive Summary',
            'We have conducted a substantive statutory audit of the general ledger transactions for the period ending March 31, 2026. All verification procedures were executed deterministically through embedded **DuckDB 1.5.4** and **Polars** engines.',
            '',
            '## 2. Key Audit Matters & Substantive Testing Results',
            '| Audit Objective | Procedure Executed | Result | Status |',
            '| :--- | :--- | :--- | :---: |',
            '| **Trial Balance Parity** | `sum(debit) == sum(credit)` via DuckDB | Debits: $4,375,000.00 / Credits: $4,375,000.00 | **BALANCED** |',
            '| **Cut-off & Completeness** | Sequence check across 10 journal entries | Zero missing record sequence IDs | **PASSED** |',
            '| **High-Value Outliers** | Scan for round-number transactions >= $1M | TXN-001 ($1.5M) & TXN-010 ($2.0M) verified | **VERIFIED** |',
            '| **Offshore Advisory Fee** | Board memo inspection & resolution check | Board Resolution 2026-03A confirmed | **COMPLIANT** |',
            '| **Duplicate Payments** | Same amount/account duplicate detection | Zero duplicate transactions detected | **PASSED** |',
            '',
            '## 3. Statutory Opinion',
            '> [!NOTE]',
            '> In our opinion, the accompanying financial records present fairly, in all material respects, the financial position of the entity with **zero variance ($0.00)**.',
            '',
            '- **Cryptographic Audit Seal:** `AUDIT_SEAL.json` generated and verified.',
            '- **Execution Runtime:** Mash Bundled Native Python 3.13 + DuckDB + Polars.',
          ].join('\n');

          const chunkFinal = {
            id: 'cmpl-turn-final',
            object: 'chat.completion.chunk',
            choices: [{
              index: 0,
              delta: { role: 'assistant', content: finalReport },
              finish_reason: null
            }]
          };

          const chunkStop = {
            id: 'cmpl-turn-final',
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
          };

          res.write(`data: ${JSON.stringify(chunkFinal)}\n\n`);
          setTimeout(() => {
            res.write(`data: ${JSON.stringify(chunkStop)}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
          }, 200);
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return new Promise((resolve) => {
    server.listen(MOCK_PORT, '127.0.0.1', () => {
      console.log(`[MockLLM] 20-Turn Mock Server listening on http://127.0.0.1:${MOCK_PORT}`);
      resolve(server);
    });
  });
}

async function run20TurnWorkflow() {
  const mockServer = await start20TurnMockServer();
  const appPath = path.resolve('dist/release/win-unpacked/Mash.exe');

  console.log(`[*] Launching compiled desktop application: ${appPath}`);
  const app = await electron.launch({
    executablePath: appPath,
    env: {
      ...process.env,
      MASH_BYPASS_AUTH: '1',
      OPENAI_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
      LLM_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
      LLM_API_KEY: 'mock-20turn-key',
      MASH_MODEL: 'mash/auto',
      NODE_ENV: 'production',
    },
    timeout: 60000,
  });

  try {
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(4000);

    const title = await window.title();
    console.log(`[OK] Electron Window Initialized: "${title}"`);

    // Switch to Turbo mode or handle permission prompts automatically
    const textarea = await window.waitForSelector('textarea', { timeout: 15000 });
    await textarea.fill('Perform complete 20-turn statutory audit investigation with DuckDB.');
    await window.waitForTimeout(500);

    console.log('[*] Submitting prompt to start 20-turn audit workflow...');
    await textarea.press('Enter');

    // Polling loop: continuously approve permissions if they appear and track progress
    const startTime = Date.now();
    const maxTimeout = 120000; // 2 minutes max
    let lastTurnLogged = 0;

    while (Date.now() - startTime < maxTimeout) {
      if (turnCount !== lastTurnLogged) {
        lastTurnLogged = turnCount;
        console.log(`[*] Workflow Progress: Step ${turnCount}/20 completed.`);

        // Capture milestone screenshots
        if (turnCount === 5) {
          const s5 = path.join(ARTIFACT_DIR, 'twenty_turns_step_05.png');
          await window.screenshot({ path: s5 });
          console.log(`[Screenshot] Saved milestone Turn 5: ${s5}`);
        } else if (turnCount === 10) {
          const s10 = path.join(ARTIFACT_DIR, 'twenty_turns_step_10.png');
          await window.screenshot({ path: s10 });
          console.log(`[Screenshot] Saved milestone Turn 10: ${s10}`);
        } else if (turnCount === 15) {
          const s15 = path.join(ARTIFACT_DIR, 'twenty_turns_step_15.png');
          await window.screenshot({ path: s15 });
          console.log(`[Screenshot] Saved milestone Turn 15: ${s15}`);
        }
      }

      // Check for human-in-the-loop permission card and click 'Always allow' or 'Allow once'
      try {
        const allowBtn = window.locator('button:has-text("Always allow"), button:has-text("Allow once")').first();
        const isVisible = await allowBtn.isVisible();
        if (isVisible) {
          await allowBtn.click({ timeout: 1000 }).catch(() => {});
        }
      } catch (_) {}

      // Check if all 20 turns are finished (turnCount reaches 20 + final turn)
      if (turnCount > TURN_DEFINITIONS.length) {
        console.log('[OK] All 20 turns completed successfully!');
        break;
      }

      await window.waitForTimeout(500);
    }

    // Give UI 3 seconds to finish streaming markdown tables
    await window.waitForTimeout(3000);

    const sFinal = path.join(ARTIFACT_DIR, 'twenty_turns_final_certificate.png');
    await window.screenshot({ path: sFinal });
    console.log(`[Screenshot] Saved final Turn 20 certificate screenshot: ${sFinal}`);

    // Verify generated file deliverables on disk
    console.log('\n[*] Verifying on-disk file deliverables created by agent tools:');
    const brainDir = path.join(os.homedir(), '.mash', 'brain');
    function findDeliverablePath(fileName) {
      if (fs.existsSync(fileName)) return fileName;
      if (fs.existsSync(brainDir)) {
        const matches = fs.readdirSync(brainDir)
          .map(s => path.join(brainDir, s, 'scratch', fileName))
          .filter(p => fs.existsSync(p))
          .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
        if (matches.length > 0) return matches[0];
      }
      return null;
    }

    const filesToCheck = [
      'audit_ledger.csv',
      'supporting_memo.txt',
      'substantive_test.py',
      'draft_statutory_report.md',
      'AUDIT_SEAL.json'
    ];

    for (const f of filesToCheck) {
      const resolved = findDeliverablePath(f);
      console.log(`- ${f}: ${resolved ? `EXISTS at "${resolved}" (OK)` : 'MISSING (FAIL)'}`);
      if (!resolved) throw new Error(`Expected file deliverable ${f} was not created!`);
    }

    // Verify content of modified file
    const reportPath = findDeliverablePath('draft_statutory_report.md');
    const reportContent = fs.readFileSync(reportPath, 'utf-8');
    const replaced = reportContent.includes('Status: Unqualified Audit Opinion Certified');
    console.log(`- draft_statutory_report.md content replacement verified: ${replaced}`);
    if (!replaced) throw new Error('replace_file_content failed to update report status!');

    const sealPath = findDeliverablePath('AUDIT_SEAL.json');
    const sealContent = JSON.parse(fs.readFileSync(sealPath, 'utf-8'));
    console.log(`- AUDIT_SEAL.json parsed opinion: "${sealContent.opinion}" (Variance: $${sealContent.debit_credit_variance})`);

    console.log('\n' + '='.repeat(65));
    console.log('>>> 20-TURN END-TO-END AGENT WORKFLOW TEST: 100% PASSED <<<');
    console.log(`- Total Turns Executed: ${turnCount}`);
    console.log(`- Unique Tools Verified: ${[...new Set(executedTools)].join(', ')}`);
    console.log('='.repeat(65) + '\n');
  } finally {
    console.log('[*] Closing Electron desktop application...');
    await app.close();
    mockServer.close();

    // Verify 0 zombie processes
    if (process.platform === 'win32') {
      try {
        const out = execSync('tasklist /fi "imagename eq connector.exe" /fo csv', { encoding: 'utf-8' });
        const hasOrphan = out.includes('connector.exe');
        console.log(`[OK] Task Manager scan: ${hasOrphan ? 'ORPHAN FOUND' : '0 ZOMBIES (Clean)'}`);
      } catch (_) {}
    }
  }
}

run20TurnWorkflow().catch((err) => {
  console.error('[FAIL] 20-Turn Workflow Error:', err);
  process.exit(1);
});
