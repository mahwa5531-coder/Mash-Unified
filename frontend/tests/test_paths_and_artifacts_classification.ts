import assert from 'node:assert/strict';
import { isScratchPath, shouldExcludePath, isArtifactPath, getArtifactCanonicalGroup } from '../src/features/artifacts/utils/paths';
import { extractArtifacts } from '../src/features/artifacts/utils/extraction';
import { extractEditedFiles } from '../src/features/artifacts/utils/extractEditedFiles';
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

// Suite 2: Artifact Classification (Positive Domain Scoping)
console.log('\n[Suite 2: Artifact Classification]');
// Case 2A: Root Markdown Reports (Executive Deliverables)
assert.equal(isArtifactPath('Audit_Report.md'), true, 'Root Audit_Report.md is an executive artifact');
assert.equal(isArtifactPath('Executive_Summary.md'), true, 'Root Executive_Summary.md is an artifact');
assert.equal(isArtifactPath('Tax_Findings.md'), true, 'Root Tax_Findings.md is an artifact');
assert.equal(isArtifactPath('notes.md'), true, 'Project notes.md is an artifact');

// Case 2B: Designated Deliverable Folders (Supports .md, .xlsx, .csv, .pdf, images)
assert.equal(isArtifactPath('workpapers/Trade_Payables.xlsx'), true, 'workpapers Excel sheet is an artifact');
assert.equal(isArtifactPath('working_papers/FY26_Balance_Sheet.xlsx'), true, 'working_papers Excel sheet is an artifact');
assert.equal(isArtifactPath('working_papers/Ledger_Reconciliation.csv'), true, 'working_papers CSV is an artifact');
assert.equal(isArtifactPath('Audit_Deliverables/Statutory_Audit_Opinion.pdf'), true, 'Audit_Deliverables PDF is an artifact');
assert.equal(isArtifactPath('deliverables/Final_Report.md'), true, 'deliverables markdown report is an artifact');
assert.equal(isArtifactPath('Audit_Deliverables/architecture_diagram.png'), true, 'Audit_Deliverables PNG is an artifact');
assert.equal(isArtifactPath('working_papers/flowchart.svg'), true, 'working_papers SVG is an artifact');

// Case 2C: Canonical Plans & Walkthroughs
assert.equal(isArtifactPath('implementation_plan.md'), true, 'Canonical implementation_plan.md is an artifact');
assert.equal(isArtifactPath('walkthrough.md'), true, 'Canonical walkthrough.md is an artifact');
assert.equal(isArtifactPath('plan.md'), true, 'Canonical plan.md is an artifact');

// Case 2D: Explicit Tool Metadata
assert.equal(isArtifactPath('summary.txt', { Summary: 'Custom Executive Brief' }), true, 'Metadata summary marks artifact');
assert.equal(isArtifactPath('review.json', { RequestFeedback: true }), true, 'RequestFeedback marks artifact');
assert.equal(isArtifactPath('internal.py', { UserFacing: false }), false, 'UserFacing: false rejects artifact');

// Case 2E: Scratchpad Exclusions take Precedence
assert.equal(isArtifactPath('scratch/Audit_Report.md'), false, 'Scratchpad markdown must NEVER be an artifact');
assert.equal(isArtifactPath('.scratch/walkthrough.md'), false, '.scratch walkthrough must NEVER be an artifact');
assert.equal(isArtifactPath('tmp/plan.md'), false, 'tmp plan must NEVER be an artifact');

// Case 2F: Source Code & Data Files Are NOT Artifact Cards
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

// Deliverables: exactly 2 (Statutory_Opinion.md and Trade_Payables.xlsx)
assert.equal(extractedArtifacts.length, 2, 'Must extract exactly 2 deliverable artifacts');
assert.equal(extractedArtifacts[0].title, 'Statutory Opinion');
assert.equal(extractedArtifacts[1].title, 'Trade Payables');

// Edited files drawer: includes source code and deliverables, but EXCLUDES scratchpad
const filePaths = extractedFiles.files.map((f) => f.path);
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
        CommandLine: 'python scripts/generate_caro.py > Audit_Deliverables/CARO_2020.pdf',
      },
      status: 'completed',
      output: 'Successfully generated Audit_Deliverables/CARO_2020.pdf (142 KB)',
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
assert.equal(cmdArtifacts.length, 2, 'Must extract both deliverables created via run_command');
assert.equal(cmdArtifacts[0].filePath, 'Audit_Deliverables/CARO_2020.pdf');
assert.equal(cmdArtifacts[1].filePath, 'workpapers/Trade_Payables_Substantive.xlsx');
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

console.log('\n======================================================');
console.log('>>> ALL PATHS & ARTIFACTS CLASSIFICATION TESTS PASSED (100% GREEN) <<<');
console.log('======================================================');
