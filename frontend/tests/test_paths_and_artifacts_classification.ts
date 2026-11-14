import assert from 'node:assert/strict';
import { isScratchPath, shouldExcludePath, isArtifactPath, getArtifactCanonicalGroup } from '../src/features/artifacts/utils/paths';
import { extractArtifacts } from '../src/features/artifacts/utils/extraction';
import { extractEditedFiles } from '../src/features/artifacts/utils/extractEditedFiles';
import { formatDisplayPath } from '../src/features/artifacts/components/TurnFilesGenerated';
import { Message } from '../src/types/chat';

console.log('--- STARTING PATHS & ARTIFACT CLASSIFICATION VERTICAL MATRIX ---');

// Suite 1: Scratch and Temp File Detection
console.log('\n[Suite 1: Scratch & Temp File Detection]');
assert.equal(isScratchPath('scratch/calc.py'), true, 'scratch/ prefix must be detected');
assert.equal(isScratchPath('/workspace/scratch/calc.py'), true, '/scratch/ segment must be detected');
assert.equal(isScratchPath('C:\\workspace\\scratch\\notes.md'), true, 'Windows backslash scratch detected');
assert.equal(isScratchPath('.scratch/temp.json'), true, '.scratch prefix detected');
assert.equal(isScratchPath('tmp/cache.dat'), true, 'tmp/ prefix detected');
assert.equal(isScratchPath('/tmp/scratch.log'), true, '/tmp/ segment detected');
assert.equal(isScratchPath('temp/worker.py'), true, 'temp/ prefix detected');
assert.equal(isScratchPath('.system_generated/logs/transcript.jsonl'), true, '.system_generated detected');
assert.equal(isScratchPath('src/features/chat/index.ts'), false, 'Normal source file is not scratch');
assert.equal(isScratchPath('Audit_Report.md'), false, 'Root report is not scratch');
assert.equal(shouldExcludePath('scratch/test.py'), true, 'shouldExcludePath alias is compatible');
console.log('  ✓ Scratch and temp path isolation passed.');

// Suite 2: Artifact Classification (Strict .md Deliverable Cards)
console.log('\n[Suite 2: Artifact Classification]');
// Case 2A: Root Markdown Reports (Executive Deliverables)
assert.equal(isArtifactPath('Audit_Report.md'), true, 'Root Audit_Report.md is an executive artifact');
assert.equal(isArtifactPath('Executive_Summary.md'), true, 'Root Executive_Summary.md is an artifact');
assert.equal(isArtifactPath('Tax_Findings.md'), true, 'Root Tax_Findings.md is an artifact');
assert.equal(isArtifactPath('notes.md'), true, 'Project notes.md is an artifact');

// Case 2B: Designated Deliverable Folders (.md only for cards; non-md files go to TurnFilesGenerated)
assert.equal(isArtifactPath('Audit_Deliverables/Statutory_Audit_Opinion.md'), true, 'Audit_Deliverables .md is an artifact card');
assert.equal(isArtifactPath('workpapers/Audit_Plan.md'), true, 'workpapers .md is an artifact card');
assert.equal(isArtifactPath('working_papers/FY26_Testing_Memo.md'), true, 'working_papers .md is an artifact card');

// Case 2C: Non-markdown files (.xlsx, .csv, .pdf, images) must NEVER be artifact cards
assert.equal(isArtifactPath('workpapers/Trade_Payables.xlsx'), false, 'Spreadsheet is NOT an artifact card');
assert.equal(isArtifactPath('working_papers/Ledger_Reconciliation.csv'), false, 'CSV is NOT an artifact card');
assert.equal(isArtifactPath('Audit_Deliverables/Statutory_Audit_Opinion.pdf'), false, 'PDF is NOT an artifact card');
assert.equal(isArtifactPath('Audit_Deliverables/architecture_diagram.png'), false, 'Images must NEVER be artifact cards');
assert.equal(isArtifactPath('working_papers/flowchart.svg'), false, 'SVG must NEVER be an artifact card');

// Case 2D: Canonical Plans & Walkthroughs
assert.equal(isArtifactPath('implementation_plan.md'), true, 'Canonical implementation_plan.md is an artifact');
assert.equal(isArtifactPath('walkthrough.md'), true, 'Canonical walkthrough.md is an artifact');
assert.equal(isArtifactPath('plan.md'), true, 'Canonical plan.md is an artifact');

// Case 2E: Explicit Tool Metadata (only for .md)
assert.equal(isArtifactPath('summary.md', { Summary: 'Custom Executive Brief' }), true, 'Metadata summary marks artifact');
assert.equal(isArtifactPath('review.md', { RequestFeedback: true }), true, 'RequestFeedback marks artifact');
assert.equal(isArtifactPath('summary.txt', { Summary: 'Text file' }), false, 'Non-md is rejected even with summary');
assert.equal(isArtifactPath('internal.py', { UserFacing: false }), false, 'UserFacing: false rejects artifact');

// Case 2F: Scratchpad Exclusions take Precedence
assert.equal(isArtifactPath('scratch/Audit_Report.md'), false, 'Scratchpad markdown must NEVER be an artifact');
assert.equal(isArtifactPath('.scratch/walkthrough.md'), false, '.scratch walkthrough must NEVER be an artifact');
assert.equal(isArtifactPath('tmp/plan.md'), false, 'tmp plan must NEVER be an artifact');

// Case 2G: Source Code & Data Files Are NOT Artifact Cards
assert.equal(isArtifactPath('src/components/Button.tsx'), false, 'Source code is not an artifact card');
assert.equal(isArtifactPath('connector/main.py'), false, 'Backend python script is not an artifact card');
assert.equal(isArtifactPath('package.json'), false, 'Config file is not an artifact card');
assert.equal(isArtifactPath('data/transactions.csv'), false, 'Non-deliverable CSV is not an artifact card');
console.log('  ✓ Artifact classification positive domain scoping passed.');

// Suite 3: Canonical Group Mapping
console.log('\n[Suite 3: Canonical Group Mapping]');
assert.equal(getArtifactCanonicalGroup('implementation_plan.md'), 'implementation_plan.md');
assert.equal(getArtifactCanonicalGroup('/path/to/my_implementation_plan.md'), 'implementation_plan.md');
assert.equal(getArtifactCanonicalGroup('walkthrough.md'), 'walkthrough.md');
assert.equal(getArtifactCanonicalGroup('session_walkthrough.md'), 'walkthrough.md');
assert.equal(getArtifactCanonicalGroup('Audit_Report.md'), 'audit_report.md');
console.log('  ✓ Canonical group mapping passed.');

// Suite 4: End-to-End Extraction Integration
console.log('\n[Suite 4: End-to-End Extraction Integration]');
const sampleAssistantMessage: Message = {
  id: 'msg_1',
  role: 'assistant',
  content: 'Here are the deliverables for this turn.',
  tools: [
    {
      id: 'tool_1',
      name: 'write_file',
      args: {
        path: 'Audit_Deliverables/Statutory_Opinion.md',
        content: '# Statutory Audit Opinion\n\nAll reconciliations clean.',
      },
      status: 'completed',
      output: 'Wrote 3 lines to Audit_Deliverables/Statutory_Opinion.md',
    },
    {
      id: 'tool_2',
      name: 'write_file',
      args: {
        path: 'workpapers/Trade_Payables.xlsx',
        content: '<binary>',
      },
      status: 'completed',
      output: 'Saved spreadsheet to workpapers/Trade_Payables.xlsx',
    },
    {
      id: 'tool_3',
      name: 'write_file',
      args: {
        path: 'src/features/auth/login.ts',
        content: 'export function login() { return true; }',
      },
      status: 'completed',
      output: 'Updated src/features/auth/login.ts',
    },
    {
      id: 'tool_4',
      name: 'write_file',
      args: {
        path: 'scratch/temp_calc.py',
        content: 'print(2 + 2)',
      },
      status: 'completed',
      output: 'Executed scratch script',
    },
  ],
};

const extractedArtifacts = extractArtifacts(sampleAssistantMessage);
const extractedFiles = extractEditedFiles(sampleAssistantMessage);

// Deliverables: strictly .md files created in this turn (Statutory_Opinion.md)
assert.equal(extractedArtifacts.length, 1, 'Cards are strictly for .md deliverables created in this turn');
assert.equal(extractedArtifacts[0].title, 'Statutory Opinion');

// Generated files drawer: includes all created files (spreadsheets, source code, deliverables) but EXCLUDES scratchpad
const filePaths = extractedFiles.files.map((f) => f.path);
assert.ok(filePaths.includes('workpapers/Trade_Payables.xlsx'), 'Spreadsheet must be in generated files drawer');
assert.ok(filePaths.includes('src/features/auth/login.ts'), 'Source code must be in edited files drawer');
assert.ok(!filePaths.includes('scratch/temp_calc.py'), 'Scratchpad script must NEVER be in edited files drawer');
console.log('  ✓ End-to-end artifact & edited files extraction integration passed.');

// Suite 5: Command Tool Output & Redirection Detection (run_command support)
console.log('\n[Suite 5: Command Tool Output & Redirection Detection]');
const commandGeneratedMessage: Message = {
  id: 'msg_cmd_1',
  role: 'assistant',
  content: 'Generated reports via Python script.',
  tools: [
    {
      id: 'tool_cmd_1',
      name: 'run_command',
      args: {
        CommandLine: 'python generate_caro.py > Audit_Deliverables/CARO_2020.md',
      },
      status: 'completed',
      output: 'Successfully generated Audit_Deliverables/CARO_2020.md (142 lines)',
    },
    {
      id: 'tool_cmd_2',
      name: 'run_command',
      args: {
        CommandLine: 'powershell -Command "python export_vouchers.py"',
      },
      status: 'completed',
      output: 'Saved 450 records to workpapers/Trade_Payables_Substantive.xlsx',
    },
  ],
};

const cmdArtifacts = extractArtifacts(commandGeneratedMessage);
assert.equal(cmdArtifacts.length, 1, 'Must extract .md deliverable created via run_command');
assert.equal(cmdArtifacts[0].filePath, 'Audit_Deliverables/CARO_2020.md');

const cmdEditedFiles = extractEditedFiles(commandGeneratedMessage);
const cmdEditedPaths = cmdEditedFiles.files.map((f) => f.path);
assert.ok(cmdEditedPaths.includes('Audit_Deliverables/CARO_2020.md'));
assert.ok(cmdEditedPaths.includes('workpapers/Trade_Payables_Substantive.xlsx'));
console.log('  ✓ run_command deliverable extraction passed.');

// Suite 6: Turn-to-Turn Isolation Invariant (Zero Cross-Contamination)
console.log('\n[Suite 6: Turn-to-Turn Isolation Invariant]');
const turn2MentionOnlyMessage: Message = {
  id: 'msg_turn_2',
  role: 'assistant',
  content: 'As shown in our earlier [Audit Plan](working_papers/plan.md) and [Opinion](Audit_Deliverables/Statutory_Opinion.md), the audit is complete.',
  tools: [], // Turn 2 executed NO tools creating files
};

const turn2Artifacts = extractArtifacts(turn2MentionOnlyMessage);
assert.equal(turn2Artifacts.length, 0, 'Turn 2 must NOT resurrect artifacts merely because prose links mention them');
console.log('  ✓ Strict turn-to-turn isolation invariant passed.');

// Suite 7: Antigravity Files Changed Drawer & Path Formatting (formatDisplayPath)
console.log('\n[Suite 7: Antigravity Files Changed Drawer & Path Formatting]');
// 7A: Windows drive path formatting matching Antigravity drawer (/c:/Users/...)
const winPath = formatDisplayPath('C:\\Users\\rama\\Downloads\\Mash\\working_papers\\vouchers.xlsx');
assert.equal(winPath.filename, 'vouchers.xlsx', 'Filename extracted cleanly');
assert.equal(winPath.displayDir, '/C:/Users/rama/Downloads/Mash/working_papers', 'Path formatted with leading slash matching Antigravity drawer');

// 7B: Relative deliverable and workpaper paths
const delivPath = formatDisplayPath('Audit_Deliverables/sub_quarter/summary.xlsx');
assert.equal(delivPath.filename, 'summary.xlsx');
assert.equal(delivPath.displayDir, '/Audit_Deliverables/sub_quarter');

const workpaperPath = formatDisplayPath('workpapers/Trade_Payables.xlsx');
assert.equal(workpaperPath.filename, 'Trade_Payables.xlsx');
assert.equal(workpaperPath.displayDir, '/workpapers');

// 7C: Root files without parent directory
const rootPath = formatDisplayPath('app.py');
assert.equal(rootPath.filename, 'app.py');
assert.equal(rootPath.displayDir, '', 'Root file must have empty displayDir');

// 7D: Explicit directory
const explicitWinDir = formatDisplayPath('audit_test.xlsx', 'C:/Users/rama/Downloads/Mash/Audit_Deliverables');
assert.equal(explicitWinDir.filename, 'audit_test.xlsx');
assert.equal(explicitWinDir.displayDir, '/C:/Users/rama/Downloads/Mash/Audit_Deliverables');
console.log('  ✓ formatDisplayPath & Antigravity drawer path formatting passed.');

console.log('\n======================================================');
console.log('>>> ALL PATHS & ARTIFACTS CLASSIFICATION TESTS PASSED (100% GREEN) <<<');
console.log('======================================================');
