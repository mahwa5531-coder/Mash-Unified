// Pure attachment references parser (DeepSeek Harness / VS Code pattern)
import { BASE_URL } from '@/services/client';
import { normalizePath } from '@/utils/normalizePath';

export interface AttachmentRef {
  path: string;
  name: string;
  kind: 'image' | 'document';
  size?: number;
  previewUrl?: string;
}

export interface ParsedAttachments {
  cleanText: string;
  images: AttachmentRef[];
  documents: AttachmentRef[];
  all: AttachmentRef[];
}

export function parseAttachmentRefs(rawContent?: string, sessionId?: string | null): ParsedAttachments {
  if (!rawContent || typeof rawContent !== 'string') {
    return { cleanText: '', images: [], documents: [], all: [] };
  }

  const text = rawContent;
  const attachments: AttachmentRef[] = [];
  const seenPaths = new Set<string>();

  // 1. Parse structured XML <attachments><file .../></attachments> (DeepSeek Harness format)
  const fileXmlRegex = /<file\s+([^>]+?)\/?>/gi;
  let xmlMatch: RegExpExecArray | null;
  while ((xmlMatch = fileXmlRegex.exec(text)) !== null) {
    const attrStr = xmlMatch[1];
    const pathMatch = attrStr.match(/path=["']([^"']+)["']/i);
    const rawPath = pathMatch ? pathMatch[1].trim() : '';
    if (!rawPath || seenPaths.has(rawPath)) continue;
    seenPaths.add(rawPath);

    const nameMatch = attrStr.match(/name=["']([^"']+)["']/i);
    const sizeMatch = attrStr.match(/size=["']([^"']+)["']/i);
    const kindMatch = attrStr.match(/kind=["']([^"']+)["']/i);

    const cleanPath = normalizePath(rawPath, false);
    const basename = cleanPath.split(/[/\\]/).pop() || 'file';
    const name = nameMatch ? nameMatch[1].trim() : basename;
    const isImageExt = /\.(png|jpe?g|webp|gif|svg|bmp)$/i.test(name) || /\.(png|jpe?g|webp|gif|svg|bmp)$/i.test(cleanPath);
    const kind: 'image' | 'document' = kindMatch?.[1]?.toLowerCase() === 'image' || isImageExt ? 'image' : 'document';
    const size = sizeMatch ? parseInt(sizeMatch[1], 10) : undefined;

    let previewUrl: string | undefined = undefined;
    if (kind === 'image') {
      const isRemote = cleanPath.startsWith('http://') || cleanPath.startsWith('https://') || cleanPath.startsWith('data:') || cleanPath.startsWith('blob:');
      previewUrl = isRemote ? cleanPath : `${BASE_URL}/files/content?path=${encodeURIComponent(cleanPath)}${sessionId ? `&session_id=${encodeURIComponent(sessionId)}` : ''}`;
    }

    attachments.push({ path: cleanPath, name, kind, size, previewUrl });
  }

  // 2. Parse legacy bracket tags [Attached file: ...] for backwards compatibility
  const legacyTagRegex = /\[Attached (?:file|files):\s*([^\]]+)\]/gi;
  let legacyMatch: RegExpExecArray | null;
  while ((legacyMatch = legacyTagRegex.exec(text)) !== null) {
    const rawPath = legacyMatch[1]?.trim().replace(/[\]"')]+$/, '');
    if (!rawPath || seenPaths.has(rawPath)) continue;
    seenPaths.add(rawPath);

    const cleanPath = normalizePath(rawPath, false);
    const name = cleanPath.split(/[/\\]/).pop() || 'file';
    const isImage = /\.(png|jpe?g|webp|gif|svg|bmp)$/i.test(name);
    const kind: 'image' | 'document' = isImage ? 'image' : 'document';

    let previewUrl: string | undefined = undefined;
    if (isImage) {
      const isRemote = cleanPath.startsWith('http://') || cleanPath.startsWith('https://') || cleanPath.startsWith('data:') || cleanPath.startsWith('blob:');
      previewUrl = isRemote ? cleanPath : `${BASE_URL}/files/content?path=${encodeURIComponent(cleanPath)}${sessionId ? `&session_id=${encodeURIComponent(sessionId)}` : ''}`;
    }

    attachments.push({ path: cleanPath, name, kind, previewUrl });
  }

  // Clean prompt text from all attachment tags and prompts
  const cleanText = text
    .replace(/<attachments>[\s\S]*?<\/attachments>/gi, '')
    .replace(/<file\s+[^>]*\/?>/gi, '')
    .replace(legacyTagRegex, '')
    .replace(/^Please inspect and analyze the attached (?:audit )?documents?:?\s*/i, '')
    .trim();

  const images = attachments.filter((a) => a.kind === 'image');
  const documents = attachments.filter((a) => a.kind === 'document');

  return { cleanText, images, documents, all: attachments };
}
