// Session title derivation from user prompts (Title Case, acronyms, path detection).

const TITLE_ACRONYMS = new Set([
  'MCP', 'API', 'PDF', 'CPA', 'DB', 'AI', 'UI', 'UX', 'JSON', 
  'REST', 'SQL', 'AGI', 'LLM', 'OS', 'CLI', 'SDK', 'URL', 'HTTP', 'HTML', 'CSS', 'RAM', 'CPU', 'GPU'
]);

const TITLE_MINOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'so', 'the', 'to', 'up', 'yet', 'with'
]);

export function toTitleCase(str: string): string {
  if (!str) return '';
  if (str.length > 1 && str === str.toUpperCase() && !str.includes(' ')) {
    return str;
  }
  const words = str.split(/\s+/).filter(Boolean);
  return words
    .map((word, index) => {
      const cleanWord = word.replace(/[^a-zA-Z0-9_-]/g, '');
      const upper = cleanWord.toUpperCase();
      if (TITLE_ACRONYMS.has(upper)) {
        return word.replace(cleanWord, upper);
      }
      const lower = cleanWord.toLowerCase();
      if (index > 0 && TITLE_MINOR_WORDS.has(lower)) {
        return word.replace(cleanWord, lower);
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

function truncateAtWordBoundary(str: string, maxLen = 32): string {
  if (str.length <= maxLen) return str;
  const sliced = str.slice(0, maxLen);
  const lastSpace = sliced.lastIndexOf(' ');
  if (lastSpace > 12) {
    return sliced.slice(0, lastSpace).trim() + '...';
  }
  return sliced.trim() + '...';
}

/**
 * ponytail: extracts clean, human-readable session titles from user prompts.
 * Formats in Title Case, preserves acronyms, and avoids cutting words in half.
 */
export function generateCleanSessionTitle(rawText: string, fallbackId = ''): string {
  if (!rawText || typeof rawText !== 'string') {
    return fallbackId ? `Session ${fallbackId.slice(0, 8)}` : 'New Session';
  }

  let t = rawText.trim().replace(/^["'`\s]+|["'`\s]+$/g, '').trim();
  if (!t) {
    return fallbackId ? `Session ${fallbackId.slice(0, 8)}` : 'New Session';
  }

  // 0. Clean mid-flight steering envelope
  if (t.includes('<USER_STEERING>') || t.includes('[USER MID-FLIGHT INSTRUCTION]:') || t.includes('</USER_STEERING>')) {
    const match = t.match(/<USER_STEERING>[\s\S]*?(?:\[USER MID-FLIGHT INSTRUCTION\]:)?\s*([\s\S]*?)(?:\s*Adapt your current plan and respond to this instruction immediately\.?)?\s*<\/USER_STEERING>/i);
    if (match && match[1] && match[1].trim()) {
      t = match[1].trim();
    } else {
      t = t.replace(/<\/?USER_STEERING>/gi, '').replace(/\[USER MID-FLIGHT INSTRUCTION\]:\s*/gi, '').replace(/Adapt your current plan and respond to this instruction immediately\.?/gi, '').trim();
    }
  }

  // 1. Extract attached file basename as fallback and strip attachment tags
  let attachedFallback = '';
  const attMatch = t.match(/\[Attached (?:file|files):\s*([^\]]+)\]/i);
  if (attMatch && attMatch[1]) {
    const rawPath = attMatch[1].trim();
    const parts = rawPath.split(/[\\/]/).filter(Boolean);
    const last = parts.pop() || rawPath;
    attachedFallback = last.replace(/[\]"')]+$/, '').trim();
  }
  t = t.replace(/\[Attached (?:file|files)[^\]]*\]/gi, '').trim();
  if (t === 'Please inspect and analyze the attached audit documents:' || t === 'Please inspect and analyze the attached audit documents') {
    t = '';
  }

  // Strip protocol sentinels
  t = t.replace(/^(?:#+\s*)?(?:User|Assistant)\s+Message\s*:\s*|\[(?:VERIFIED|DONE|END|empty)\]|<\/?(?:user[\s_]+message|assistant[\s_]+message|identity|user_rules|system_prompt)>/gi, '').trim();

  // If user only sent an attachment, use the attached filename
  if (!t && attachedFallback) {
    return truncateAtWordBoundary(toTitleCase(attachedFallback), 34);
  }

  // Prefer first conversational line if prompt has multiple lines
  const firstNonEmptyLine = t.split('\n').map(l => l.trim()).find(l => l.length > 0) || '';
  if (firstNonEmptyLine && !firstNonEmptyLine.startsWith('[') && firstNonEmptyLine.length > 3) {
    t = firstNonEmptyLine;
  }

  // 1. Detect leading file/folder path (e.g. "C:\Users\...\file.xlsx" or /path/to/file)
  const pathMatch = t.match(/^([a-zA-Z]:[\\/][^"'`\r\n]*|\/[^"'`\r\n]+)/);
  if (pathMatch) {
    const rawPath = pathMatch[1].trim().replace(/^["']+|["']+$/g, '');
    const remainder = t.slice(pathMatch[0].length).replace(/^["'`\s,:;\-]+/, '').trim();
    const basename = rawPath.split(/[\\/]/).filter(Boolean).pop() || rawPath;

    if (remainder) {
      const verbMatch = remainder.match(/^(?:please\s+|can you\s+|could you\s+|kindly\s+)?(analyse|analyze|review|fix|check|run|inspect|explain|read|summarize|test|process|plot|visualize|debug|load|parse|clean|convert)\b/i);
      if (verbMatch && verbMatch[1]) {
        const verb = toTitleCase(verbMatch[1]);
        const candidate = `${verb} ${toTitleCase(basename)}`;
        return truncateAtWordBoundary(candidate, 34);
      }

      let cleanRemainder = remainder
        .replace(/^(?:please\s+|can you\s+|could you\s+|kindly\s+|help me\s+(?:to\s+)?|i want you to\s+|i want to\s+|i need to\s+)+/i, '')
        .trim();

      if (cleanRemainder) {
        cleanRemainder = toTitleCase(cleanRemainder);
        const candidate = `${truncateAtWordBoundary(cleanRemainder, 20)} (${basename})`;
        return truncateAtWordBoundary(candidate, 34);
      }
    }
    return truncateAtWordBoundary(toTitleCase(basename), 34);
  }

  // 2. Legacy filesystem paths stored in DB (e.g. standalone path string "C:\Projects\benchmark...")
  if (!t.includes(' ') && (t.includes('\\') || (t.includes('/') && t.split('/').length > 2))) {
    const parts = t.split(/[\\/]/).filter(Boolean);
    if (parts.length > 1) {
      const last = parts.pop() || '';
      if (last.length > 2) {
        return truncateAtWordBoundary(toTitleCase(last.replace(/[\]\.)]+$/, '')), 32);
      }
    }
  }

  // 3. Normal user message: strip polite opening filler and question fluff
  t = t.replace(/^(?:please\s+|can you\s+|could you\s+|kindly\s+|help me\s+(?:to\s+)?|i want you to\s+|i want to\s+|i need to\s+|tell me about\s+|tell me\s+|explain\s+|what do you know about\s+|what is\s+|how to\s+|how do i\s+|i think we have to\s+|look at this\s*[,:]?\s*)+/i, '').trim();

  // Strip trailing punctuation
  t = t.replace(/[?!.:;]+$/, '').trim();

  if (t) {
    t = toTitleCase(t);
  }

  return truncateAtWordBoundary(t, 32) || (fallbackId ? `Session ${fallbackId.slice(0, 8)}` : 'New Session');
}
