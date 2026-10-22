import assert from 'node:assert';

// ==============================================================================
// 1. Emulate File Viewer Matrix & FileViewerNotice logic
// ==============================================================================
const UNSUPPORTED_REGEX = /\.(docx|doc|pptx|ppt|zip|tar|gz|7z|rar|exe|bin|iso|dmg|dll|so|dylib)$/i;
const MASSIVE_FILE_LIMIT = 10_000_000; // 10 MB limit

function getFileViewerNoticeData(message, filename, path) {
  const displayName = filename || (path ? path.split(/[/\\]/).pop() : undefined);
  const ext = displayName?.includes('.') ? displayName.split('.').pop()?.toLowerCase() : undefined;
  return {
    message,
    displayName,
    ext,
    hasExtBadge: Boolean(ext),
  };
}

function resolveViewerMode(filename, path, content, isTruncated = false) {
  const cleanName = (path || filename || '').toLowerCase();
  const isImage = /\.(png|jpg|jpeg|svg|gif|webp|ico|bmp)$/.test(cleanName);
  const isMarkdown = /\.md$/i.test(cleanName);
  const isBinaryExcel = /\.(xlsx|xls|xlsm|xltx|xltm|xlsb|ods)$/i.test(cleanName);
  const isPdf = /\.pdf$/i.test(cleanName);
  const isUnsupported = UNSUPPORTED_REGEX.test(cleanName);

  const isFileNotFound = Boolean(
    content && (
      content.includes('not found on local disk') ||
      content.includes('File not found') ||
      content.includes('Failed to load file content') ||
      content.startsWith('Error loading file:')
    )
  );

  if (isFileNotFound) {
    return {
      renderer: 'notice',
      notice: getFileViewerNoticeData('File not found', filename, path),
    };
  }

  if (isBinaryExcel) {
    return { renderer: 'excel' };
  }

  if (isUnsupported) {
    return {
      renderer: 'notice',
      notice: getFileViewerNoticeData('File format not supported', filename, path),
    };
  }

  if (isImage) return { renderer: 'image' };
  if (isPdf) return { renderer: 'pdf' };

  // Text / Code handling
  let displayedContent = content;
  if (!content) {
    displayedContent = '// Empty file';
  } else if (content.length > 100_000 && !content.includes('\n')) {
    displayedContent = content.slice(0, 5000) + '... [line truncated for browser safety]';
  }

  return {
    renderer: isMarkdown ? 'markdown' : 'editor',
    displayedContent,
    isMassiveFile: Boolean(isTruncated || (content?.length || 0) >= MASSIVE_FILE_LIMIT),
  };
}

// ==============================================================================
// 2. Emulate Slash Command Autocomplete & Navigation
// ==============================================================================
const AVAILABLE_COMMANDS = [
  { command: '/audit', label: 'Run statutory audit verification checklist', category: 'workflow' },
  { command: '/clear', label: 'Clear current session transcript', category: 'action' },
  { command: '/default', label: 'Set permission mode to Default', category: 'mode' },
  { command: '/help', label: 'View all commands and tools', category: 'help' },
  { command: '/review', label: 'Set permission mode to Request Review', category: 'mode' },
  { command: '/test', label: 'Run automated test suites', category: 'test' },
  { command: '/turbo', label: 'Set permission mode to Turbo Autonomous', category: 'mode' },
];

function filterSlashCommands(input) {
  if (!input || !input.startsWith('/')) {
    return [];
  }
  const query = input.trim().toLowerCase();
  return AVAILABLE_COMMANDS.filter((cmd) => cmd.command.toLowerCase().startsWith(query));
}

function handleAutocompleteNavigation(currentIndex, key, itemCount) {
  if (itemCount <= 0) return { newIndex: -1, confirmed: false, dismissed: false };

  if (key === 'ArrowDown') {
    // Down wraps to top
    const nextIdx = (currentIndex + 1) % itemCount;
    return { newIndex: nextIdx, confirmed: false, dismissed: false };
  }
  if (key === 'ArrowUp') {
    // Up wraps to bottom
    const prevIdx = currentIndex <= 0 ? itemCount - 1 : currentIndex - 1;
    return { newIndex: prevIdx, confirmed: false, dismissed: false };
  }
  if (key === 'Enter' || key === 'Tab') {
    return { newIndex: currentIndex, confirmed: true, dismissed: false };
  }
  if (key === 'Escape') {
    return { newIndex: -1, confirmed: false, dismissed: true };
  }
  return { newIndex: currentIndex, confirmed: false, dismissed: false };
}

// ==============================================================================
// 3. Emulate Input Composer KeyDown & Submit Rules
// ==============================================================================
function evaluateComposerAction({ key, shiftKey, isUploading, isSubmitting, text, attachedFiles }) {
  if (key === 'Enter' && !shiftKey) {
    if (isUploading) {
      return { action: 'blocked_uploading' };
    }
    if (isSubmitting) {
      return { action: 'blocked_submitting' };
    }

    const trimmed = (text || '').trim();
    if (!trimmed && (!attachedFiles || attachedFiles.length === 0)) {
      return { action: 'ignored_empty' };
    }

    let payloadText = trimmed;
    if (attachedFiles && attachedFiles.length > 0) {
      const fileRefs = attachedFiles.map((f) => `[Attached file: ${f.path}]`).join('\n');
      payloadText = payloadText
        ? `${payloadText}\n\n${fileRefs}`
        : `Please inspect and analyze the attached audit documents:\n${fileRefs}`;
    }

    return { action: 'submit', payload: payloadText };
  }

  if (key === 'Enter' && shiftKey) {
    return { action: 'newline' };
  }

  return { action: 'none' };
}

console.log("======================================================================");
console.log("STARTING FILE VIEWER MATRIX & COMPOSER AUTOCOMPLETE TESTS");
console.log("======================================================================\n");

// -----------------------------------------------------------------------------
// Test 1: File Viewer Matrix — 404 Notice with Filename + Ext Badge
// -----------------------------------------------------------------------------
console.log("[Test 1] File Viewer 404 Notice with Filename + Extension Badge");
{
  // 1a. File with standard extension
  const res1 = resolveViewerMode("balance_sheet.xlsx", "reports/balance_sheet.xlsx", "Error: File not found on local disk.");
  assert.strictEqual(res1.renderer, 'notice');
  assert.strictEqual(res1.notice.message, 'File not found');
  assert.strictEqual(res1.notice.displayName, 'balance_sheet.xlsx');
  assert.strictEqual(res1.notice.ext, 'xlsx');
  assert.strictEqual(res1.notice.hasExtBadge, true);

  // 1b. Deep path with Windows backslashes
  const res2 = resolveViewerMode(undefined, "C:\\Users\\audit\\documents\\vouching_memo.pdf", "File not found");
  assert.strictEqual(res2.renderer, 'notice');
  assert.strictEqual(res2.notice.displayName, 'vouching_memo.pdf');
  assert.strictEqual(res2.notice.ext, 'pdf');
  assert.strictEqual(res2.notice.hasExtBadge, true);

  // 1c. File without extension (e.g. Makefile, Dockerfile)
  const res3 = resolveViewerMode("Dockerfile", "/repo/Dockerfile", "Failed to load file content");
  assert.strictEqual(res3.renderer, 'notice');
  assert.strictEqual(res3.notice.displayName, 'Dockerfile');
  assert.strictEqual(res3.notice.ext, undefined);
  assert.strictEqual(res3.notice.hasExtBadge, false, "Files without dots must NOT render an ext badge");

  // 1d. Hidden dotfile (e.g. .gitignore, .env)
  const resDot = resolveViewerMode(".gitignore", "/repo/.gitignore", "File not found");
  assert.strictEqual(resDot.renderer, 'notice');
  assert.strictEqual(resDot.notice.displayName, '.gitignore');
  assert.strictEqual(resDot.notice.ext, 'gitignore');
  assert.strictEqual(resDot.notice.hasExtBadge, true);

  // 1e. Filename ending with trailing dot
  const resTrailing = resolveViewerMode("backup.", "/repo/backup.", "File not found");
  assert.strictEqual(resTrailing.notice.ext, '');
  assert.strictEqual(resTrailing.notice.hasExtBadge, false);

  console.log("  -> PASSED: 404 notices correctly extract filename, extension badge, and paths");
}

// -----------------------------------------------------------------------------
// Test 2: File Viewer Matrix — Unsupported Binary Formats
// -----------------------------------------------------------------------------
console.log("\n[Test 2] File Viewer Matrix — Unsupported Binary Formats");
{
  const unsupportedList = [
    'archive.zip', 'package.tar.gz', 'backup.7z', 'installer.exe',
    'library.dll', 'binary.bin', 'firmware.iso', 'memo.docx', 'slides.pptx'
  ];

  for (const filename of unsupportedList) {
    const res = resolveViewerMode(filename, `/files/${filename}`, 'BINARY_DATA');
    assert.strictEqual(res.renderer, 'notice', `File ${filename} must route to notice renderer`);
    assert.strictEqual(res.notice.message, 'File format not supported');
    assert.strictEqual(res.notice.displayName, filename);
  }

  // Ensure supported files are NOT mistakenly flagged as unsupported
  const supportedList = [
    'index.ts', 'app.py', 'style.css', 'data.json', 'README.md',
    'sheet.xlsx', 'report.pdf', 'photo.png', 'records.csv'
  ];

  for (const filename of supportedList) {
    const res = resolveViewerMode(filename, `/files/${filename}`, 'Hello world');
    assert.notStrictEqual(res.notice?.message, 'File format not supported', `File ${filename} must NOT be flagged as unsupported`);
  }

  console.log("  -> PASSED: All 9 binary formats correctly guarded; standard formats bypass notice cleanly");
}

// -----------------------------------------------------------------------------
// Test 3: File Viewer Matrix — Zero-Byte Files & Massive File Safety
// -----------------------------------------------------------------------------
console.log("\n[Test 3] Zero-Byte Files & Massive File Protection");
{
  // Zero-byte code file
  const zeroCode = resolveViewerMode("main.py", "/app/main.py", "");
  assert.strictEqual(zeroCode.renderer, 'editor');
  assert.strictEqual(zeroCode.displayedContent, '// Empty file', "Empty code file must return placeholder");

  // Zero-byte markdown file (SafeFileViewer.tsx returns '// Empty file' for all empty files)
  const zeroMd = resolveViewerMode("notes.md", "/app/notes.md", "");
  assert.strictEqual(zeroMd.renderer, 'markdown');
  assert.strictEqual(zeroMd.displayedContent, '// Empty file', "Empty markdown must return safe placeholder");

  // Zero-byte TypeScript file
  const zeroTs = resolveViewerMode("types.ts", "/src/types.ts", "");
  assert.strictEqual(zeroTs.displayedContent, '// Empty file');

  // Massive file exceeding 10MB
  const massiveContent = "x".repeat(11 * 1024 * 1024);
  const massiveRes = resolveViewerMode("giant_log.txt", "/logs/giant_log.txt", massiveContent);
  assert.strictEqual(massiveRes.isMassiveFile, true, "Files >= 10MB must trigger massive file shield");

  // Massive file truncated by backend (head chunk < 10MB with isTruncated: true)
  const truncatedHeadChunk = "x".repeat(9_999_500);
  const truncatedRes = resolveViewerMode("truncated.log", "/logs/truncated.log", truncatedHeadChunk, true);
  assert.strictEqual(truncatedRes.isMassiveFile, true, "Backend isTruncated flag must trigger massive file shield even when chunk < 10MB");

  // File under 10MB (e.g. 2MB)
  const mediumContent = "x".repeat(2 * 1024 * 1024);
  const mediumRes = resolveViewerMode("medium.log", "/logs/medium.log", mediumContent);
  assert.strictEqual(mediumRes.isMassiveFile, false, "Files under 10MB must NOT trigger massive file shield");

  // Single huge un-wrapped line (> 100k chars)
  const hugeSingleLine = "A".repeat(120_000);
  const lineTruncRes = resolveViewerMode("minified.js", "/dist/minified.js", hugeSingleLine);
  assert.ok(lineTruncRes.displayedContent.includes("[line truncated for browser safety]"));
  assert.strictEqual(lineTruncRes.displayedContent.length < 6000, true);

  console.log("  -> PASSED: Zero-byte files render safe placeholders; massive files and minified lines safely capped");
}

// -----------------------------------------------------------------------------
// Test 4: Composer Slash Command Autocomplete & Prefix Filtering
// -----------------------------------------------------------------------------
console.log("\n[Test 4] Composer Slash Command Autocomplete Filtering");
{
  // Query starting with /
  const matchesA = filterSlashCommands("/a");
  assert.strictEqual(matchesA.length, 1);
  assert.strictEqual(matchesA[0].command, "/audit");

  const matchesT = filterSlashCommands("/t");
  assert.strictEqual(matchesT.length, 2);
  const tCmds = matchesT.map(c => c.command);
  assert.ok(tCmds.includes("/test"));
  assert.ok(tCmds.includes("/turbo"));

  // Exact command match
  const matchesExact = filterSlashCommands("/help");
  assert.strictEqual(matchesExact.length, 1);
  assert.strictEqual(matchesExact[0].command, "/help");

  // Non-matching slash query
  const matchesNone = filterSlashCommands("/nonexistent");
  assert.strictEqual(matchesNone.length, 0);

  // Normal sentence without leading slash must not trigger autocomplete
  const matchesProse = filterSlashCommands("can you check /var/log/audit.log");
  assert.strictEqual(matchesProse.length, 0, "Prose containing slash must NOT trigger command autocomplete");

  console.log("  -> PASSED: Slash prefix filtering accurately isolates commands without false triggering on file paths");
}

// -----------------------------------------------------------------------------
// Test 5: Composer Keyboard Navigation & Selection State Machine
// -----------------------------------------------------------------------------
console.log("\n[Test 5] Composer Keyboard Navigation State Machine (Arrows, Wrap-around, Escape)");
{
  const total = 3; // Commands [0, 1, 2]

  // ArrowDown navigation
  let state = handleAutocompleteNavigation(0, 'ArrowDown', total);
  assert.strictEqual(state.newIndex, 1);

  state = handleAutocompleteNavigation(1, 'ArrowDown', total);
  assert.strictEqual(state.newIndex, 2);

  // Down wrap-around at bottom
  state = handleAutocompleteNavigation(2, 'ArrowDown', total);
  assert.strictEqual(state.newIndex, 0, "ArrowDown at bottom must wrap to index 0");

  // Up wrap-around at top
  state = handleAutocompleteNavigation(0, 'ArrowUp', total);
  assert.strictEqual(state.newIndex, 2, "ArrowUp at index 0 must wrap to bottom index");

  // Confirm selection with Enter
  state = handleAutocompleteNavigation(1, 'Enter', total);
  assert.strictEqual(state.confirmed, true);
  assert.strictEqual(state.newIndex, 1);

  // Dismiss with Escape
  state = handleAutocompleteNavigation(1, 'Escape', total);
  assert.strictEqual(state.dismissed, true);
  assert.strictEqual(state.newIndex, -1);

  console.log("  -> PASSED: Keyboard navigation wrap-around, Enter confirmation, and Escape dismissal 100% verified");
}

// -----------------------------------------------------------------------------
// Test 6: Composer Submission, Multi-Attachment & Double-Enter Protection
// -----------------------------------------------------------------------------
console.log("\n[Test 6] Composer Submit Rules, Double-Enter Lock & Attachments");
{
  // 1. Enter without shift: triggers submit
  const resSubmit = evaluateComposerAction({
    key: 'Enter',
    shiftKey: false,
    isUploading: false,
    isSubmitting: false,
    text: "Calculate gross margin",
  });
  assert.strictEqual(resSubmit.action, 'submit');
  assert.strictEqual(resSubmit.payload, 'Calculate gross margin');

  // 2. Shift+Enter: inserts newline
  const resNewline = evaluateComposerAction({
    key: 'Enter',
    shiftKey: true,
    isUploading: false,
    isSubmitting: false,
    text: "Line 1",
  });
  assert.strictEqual(resNewline.action, 'newline');

  // 3. Double-Enter race condition protection: blocked while isSubmitting is true
  const resSubmitting = evaluateComposerAction({
    key: 'Enter',
    shiftKey: false,
    isUploading: false,
    isSubmitting: true,
    text: "Calculate gross margin",
  });
  assert.strictEqual(resSubmitting.action, 'blocked_submitting', "Double-Enter must be blocked by synchronous lock");

  // 4. Blocked while uploads are in flight
  const resUploading = evaluateComposerAction({
    key: 'Enter',
    shiftKey: false,
    isUploading: true,
    isSubmitting: false,
    text: "Calculate gross margin",
  });
  assert.strictEqual(resUploading.action, 'blocked_uploading');

  // 5. Attachments payload formatting with user text
  const resAttached = evaluateComposerAction({
    key: 'Enter',
    shiftKey: false,
    isUploading: false,
    isSubmitting: false,
    text: "Verify invoices",
    attachedFiles: [{ path: "invoices/inv_001.pdf" }, { path: "invoices/inv_002.pdf" }],
  });
  assert.strictEqual(resAttached.action, 'submit');
  assert.ok(resAttached.payload.includes("Verify invoices"));
  assert.ok(resAttached.payload.includes("[Attached file: invoices/inv_001.pdf]"));
  assert.ok(resAttached.payload.includes("[Attached file: invoices/inv_002.pdf]"));

  // 6. Attachments payload formatting with EMPTY text (auto-generates audit inspection prompt)
  const resAttachedEmptyText = evaluateComposerAction({
    key: 'Enter',
    shiftKey: false,
    isUploading: false,
    isSubmitting: false,
    text: "",
    attachedFiles: [{ path: "ledger.xlsx" }],
  });
  assert.strictEqual(resAttachedEmptyText.action, 'submit');
  assert.ok(resAttachedEmptyText.payload.includes("Please inspect and analyze the attached audit documents:"));
  assert.ok(resAttachedEmptyText.payload.includes("[Attached file: ledger.xlsx]"));

  console.log("  -> PASSED: Synchronous submission locks, Shift+Enter newlines, and attached document schemas verified");
}

console.log("\n======================================================================");
console.log("ALL FILE VIEWER MATRIX & COMPOSER TESTS PASSED (6/6)");
console.log("======================================================================");
