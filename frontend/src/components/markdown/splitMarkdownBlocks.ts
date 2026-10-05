/**
 * Splits a Markdown document into semantic, virtualizable blocks without breaking
 * code fences, tables, or lists.
 */
export function splitMarkdownBlocks(text: string, targetBlockLines: number = 35): string[] {
  if (!text) {
    return [''];
  }

  const lines = text.split('\n');
  if (lines.length <= targetBlockLines) {
    return [text];
  }

  const blocks: string[] = [];
  let currentBlock: string[] = [];
  let inCodeFence = false;
  let fenceDelimiter = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check code fence (``` or ~~~)
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      const fence = fenceMatch[1];
      if (!inCodeFence) {
        inCodeFence = true;
        fenceDelimiter = fence[0];
      } else if (fence.startsWith(fenceDelimiter)) {
        inCodeFence = false;
        fenceDelimiter = '';
      }
    }

    currentBlock.push(line);

    // Only consider boundary split when NOT inside a code fence
    if (!inCodeFence) {
      const isBlank = trimmed === '';
      const isHr = /^(\*\*\*|---|___)$/.test(trimmed);
      const isMajorHeading = /^#{1,3}\s+/.test(trimmed);
      const reachedTargetSize = currentBlock.length >= targetBlockLines;

      if (reachedTargetSize && (isBlank || isHr)) {
        const joined = currentBlock.join('\n').trim();
        if (joined) {
          blocks.push(joined);
          currentBlock = [];
        }
      } else if (isMajorHeading && currentBlock.length > 15) {
        const headingLine = currentBlock.pop()!;
        const joined = currentBlock.join('\n').trim();
        if (joined) {
          blocks.push(joined);
        }
        currentBlock = [headingLine];
      }
    }
  }

  if (currentBlock.length > 0) {
    const joined = currentBlock.join('\n').trim();
    if (joined) {
      blocks.push(joined);
    }
  }

  return blocks.length > 0 ? blocks : [text];
}
