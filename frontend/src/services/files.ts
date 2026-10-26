// File content: LRU-cached reads, in-flight dedup, paged Excel access.

import { BASE_URL, safeFetch } from './client';
import { normalizePath } from '@/utils/normalizePath';

// Client-side in-memory cache with LRU eviction: keeps active working-set tabs instantly accessible with 0ms network latency
export const MAX_FILE_CACHE_SIZE = 25;
const fileContentMemoryCache = new Map<string, string>();
const fileTruncationMemoryCache = new Map<string, boolean>();
const inFlightFileFetches = new Map<string, Promise<string>>();

export function makeCacheKey(filePath: string, sessionId?: string): string {
  const clean = normalizePath(filePath);
  const isAbs = clean.startsWith('/') || /^[a-zA-Z]:[/\\]/.test(clean);
  if (!isAbs && sessionId) {
    return `${sessionId}:${clean}`;
  }
  return clean;
}

export function cacheFileContent(cacheKey: string, content: string, isTruncated: boolean = false): void {
  if (fileContentMemoryCache.has(cacheKey)) {
    fileContentMemoryCache.delete(cacheKey);
    fileTruncationMemoryCache.delete(cacheKey);
  } else if (fileContentMemoryCache.size >= MAX_FILE_CACHE_SIZE) {
    const oldestKey = fileContentMemoryCache.keys().next().value;
    if (oldestKey) {
      fileContentMemoryCache.delete(oldestKey);
      fileTruncationMemoryCache.delete(oldestKey);
    }
  }
  fileContentMemoryCache.set(cacheKey, content);
  fileTruncationMemoryCache.set(cacheKey, isTruncated);
}

export function getFileContentFromCache(filePath: string, sessionId?: string): string | undefined {
  const cacheKey = makeCacheKey(filePath, sessionId);
  return fileContentMemoryCache.get(cacheKey);
}

export function isFileTruncatedFromCache(filePath: string, sessionId?: string): boolean {
  const cacheKey = makeCacheKey(filePath, sessionId);
  return fileTruncationMemoryCache.get(cacheKey) ?? false;
}

export function invalidateFileCache(filePath?: string, sessionId?: string): void {
  if (filePath) {
    const cacheKey = makeCacheKey(filePath, sessionId);
    const cleanKey = normalizePath(filePath);
    fileContentMemoryCache.delete(cacheKey);
    fileTruncationMemoryCache.delete(cacheKey);
    inFlightFileFetches.delete(cacheKey);
    if (cacheKey !== cleanKey) {
      fileContentMemoryCache.delete(cleanKey);
      fileTruncationMemoryCache.delete(cleanKey);
      inFlightFileFetches.delete(cleanKey);
    }
  } else {
    fileContentMemoryCache.clear();
    fileTruncationMemoryCache.clear();
    inFlightFileFetches.clear();
  }
}

export async function fetchFileContent(filePath: string, sessionId?: string, bypassCache: boolean = false): Promise<string> {
  const cleanKey = normalizePath(filePath);
  const cacheKey = makeCacheKey(filePath, sessionId);

  if (!bypassCache && fileContentMemoryCache.has(cacheKey)) {
    return fileContentMemoryCache.get(cacheKey)!;
  }
  if (!bypassCache && inFlightFileFetches.has(cacheKey)) {
    return inFlightFileFetches.get(cacheKey)!;
  }

  const fetchPromise = (async () => {
    try {
      const isCsv = /\.csv$/i.test(cleanKey);
      const qs = sessionId ? `&session_id=${encodeURIComponent(sessionId)}` : '';
      const url = `${BASE_URL}/files/content?path=${encodeURIComponent(cleanKey)}${qs}${isCsv ? '&raw=true' : ''}`;
      const res = await safeFetch(url);
      if (!res.ok) {
        if (res.status === 404) {
          try {
            const errData = await res.json();
            return errData.detail || `File '${cleanKey}' not found on local disk.`;
          } catch {
            return `File '${cleanKey}' not found on local disk.`;
          }
        }
        return "Failed to load file content.";
      }
      if (isCsv) {
        const csvContent = await res.text();
        cacheFileContent(cacheKey, csvContent);
        return csvContent;
      }
      const data = await res.json();
      if (data.type === 'excel' || data.type === 'univer') {
        const serialized = JSON.stringify(data);
        cacheFileContent(cacheKey, serialized);
        return serialized;
      }
      const content = data.content !== undefined ? data.content : "";
      if (data.error || content.includes('not found on local disk')) {
        return content || "File not found on local disk.";
      }
      const isTruncated = Boolean(data.is_truncated);
      cacheFileContent(cacheKey, content, isTruncated);
      return content;
    } catch (err) {
      console.warn("Failed to fetch file content:", err);
      return "Error fetching file content.";
    } finally {
      inFlightFileFetches.delete(cacheKey);
    }
  })();

  inFlightFileFetches.set(cacheKey, fetchPromise);
  return fetchPromise;
}

export async function openSystemFile(filePath: string, sessionId?: string): Promise<boolean> {
  try {
    const res = await safeFetch(`${BASE_URL}/api/system/open-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: filePath, session_id: sessionId }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.status === 'success';
  } catch (err) {
    console.warn("Failed to open file in system application:", err);
    return false;
  }
}
