import assert from 'node:assert';
import { safeUrlTransform } from '../src/components/markdown/urlPolicy';
import { isFullFilePath, isFileExtension, isDirectoryPath } from '../src/features/chat/components/messages/proseHelpers';
import { isFileLoadError } from '../src/features/viewer/hooks/useViewerTabs';

console.log("=== Running E2E Findings Verification Tests ===");

// -------------------------------------------------------------
// F-1 Verification: Bare markdown file links & safeUrlTransform
// -------------------------------------------------------------
console.log("1. Testing F-1: Bare markdown links & safeUrlTransform allowlist...");
assert.strictEqual(safeUrlTransform("notes.md"), "notes.md", "Bare filename notes.md must be permitted");
assert.strictEqual(safeUrlTransform("findings.csv"), "findings.csv", "Bare filename findings.csv must be permitted");
assert.strictEqual(safeUrlTransform("./notes.md"), "./notes.md", "Relative path ./notes.md must be permitted");
assert.strictEqual(safeUrlTransform("../audit/report.xlsx"), "../audit/report.xlsx", "Parent relative path must be permitted");
assert.strictEqual(safeUrlTransform("subfolder/data.json"), "subfolder/data.json", "Subfolder path without prefix must be permitted");
assert.strictEqual(safeUrlTransform("#section-2"), "#section-2", "Anchor links must be permitted");
assert.strictEqual(safeUrlTransform("https://example.com/test"), "https://example.com/test", "HTTPS must be permitted");
assert.strictEqual(safeUrlTransform("mailto:test@example.com"), "mailto:test@example.com", "Mailto must be permitted");
assert.strictEqual(safeUrlTransform("data:image/png;base64,iVBORw0KGgo="), "data:image/png;base64,iVBORw0KGgo=", "Base64 image must be permitted");
assert.strictEqual(safeUrlTransform("C:\\audit\\report.xlsx"), "C:\\audit\\report.xlsx", "Windows absolute path must be permitted");
assert.strictEqual(safeUrlTransform("file:///C:/audit/report.xlsx"), "file:///C:/audit/report.xlsx", "File URI must be permitted");

// Security checks: dangerous schemes must be stripped
assert.strictEqual(safeUrlTransform("javascript:alert(1)"), "", "javascript: scheme must be blocked");
assert.strictEqual(safeUrlTransform("javascript:void(0)"), "", "javascript: scheme must be blocked");
assert.strictEqual(safeUrlTransform("vbscript:msgbox(1)"), "", "vbscript: scheme must be blocked");
assert.strictEqual(safeUrlTransform("data:text/html,<script>alert(1)</script>"), "", "Non-image data: scheme must be blocked");
assert.strictEqual(safeUrlTransform("app://secret-storage"), "", "app:// scheme must be blocked");
console.log("   -> F-1 Passed!");

// -------------------------------------------------------------
// F-3 Verification: Plain prose image paths recognition
// -------------------------------------------------------------
console.log("2. Testing F-3: Image paths recognition in prose...");
assert.strictEqual(isFullFilePath("chart.png"), true, "chart.png must be recognized as full file path");
assert.strictEqual(isFullFilePath("revenue_q3.jpeg"), true, "revenue_q3.jpeg must be recognized as full file path");
assert.strictEqual(isFullFilePath("diagram.svg"), true, "diagram.svg must be recognized as full file path");
assert.strictEqual(isFullFilePath("./audit_deliverables/summary.webp"), true, "summary.webp must be recognized as full file path");

// Test regex matching on prose string
const FILE_PATH_IN_PROSE_REGEX = /((?:\.env(?:\.[a-zA-Z0-9_-]+)?|(?:(?:file:\/\/\/?|[a-zA-Z]:[/\\]|\/(?:Users|home|tmp)\/|\.\.?\/|[a-zA-Z0-9_.-]+[/\\])[^\s'",;()<>]+\.(?:xlsx?|xlsm|xlsb|ods|csv|tsv|parquet|pdf|docx?|pptx?|py|pyw|ipynb|tsx?|jsx?|mjs|cjs|json|ya?ml|toml|sql|db|sqlite|md|markdown|txt|diff|patch|html|css|log|xml|xbrl|png|jpe?g|gif|svg|webp|env)))(?:#L\d+(?:-\d+)?)?)/gi;
const sampleProse = "Review the architecture in ./assets/arch_diagram.png and docs/notes.md before continuing.";
const matches = sampleProse.match(FILE_PATH_IN_PROSE_REGEX);
assert.ok(matches && matches.includes("./assets/arch_diagram.png"), "Prose regex must capture ./assets/arch_diagram.png");
assert.ok(matches && matches.includes("docs/notes.md"), "Prose regex must capture docs/notes.md");
console.log("   -> F-3 Passed!");

// -------------------------------------------------------------
// F-2 Verification: Access Denied error classification
// -------------------------------------------------------------
console.log("3. Testing F-2: Access Denied classification in viewer tabs...");
assert.strictEqual(isFileLoadError("Access denied: file is outside authorized workspace directories."), true);
assert.strictEqual(isFileLoadError("Access denied: Cross-session file access is strictly forbidden."), true);
assert.strictEqual(isFileLoadError("File 'notes.md' not found on local disk."), true);
assert.strictEqual(isFileLoadError("# Valid Markdown Header\nSome content"), false);
console.log("   -> F-2 Passed!");

console.log("\nALL VERIFICATION CHECKS PASSED SUCCESSFULLY!");
