// File content: LRU-cached reads, in-flight dedup, paged Excel access.

import { BASE_URL, safeFetch } from './client';

// Client-side in-memory cache with LRU eviction: keeps active working-set tabs instantly accessible with 0ms network latency
const MAX_FILE_CACHE_SIZE = 25;
const fileContentMemoryCache = new Map<string, string>();
const inFlightFileFetches = new Map<string, Promise<string>>();

function cacheFileContent(cleanKey: string, content: string): void {
  if (fileContentMemoryCache.has(cleanKey)) {
    fileContentMemoryCache.delete(cleanKey);
  } else if (fileContentMemoryCache.size >= MAX_FILE_CACHE_SIZE) {
    const oldestKey = fileContentMemoryCache.keys().next().value;
    if (oldestKey) fileContentMemoryCache.delete(oldestKey);
  }
  fileContentMemoryCache.set(cleanKey, content);
}

export function getFileContentFromCache(filePath: string): string | undefined {
  const cleanKey = decodeURIComponent((filePath || '').replace(/^file:\/\/\/?/i, '')).replace(/^\/([a-zA-Z]:)/, '$1').replace(/\\/g, '/').split('#')[0];
  return fileContentMemoryCache.get(cleanKey);
}

export function setFileContentInCache(filePath: string, content: string): void {
  const cleanKey = decodeURIComponent((filePath || '').replace(/^file:\/\/\/?/i, '')).replace(/^\/([a-zA-Z]:)/, '$1').replace(/\\/g, '/').split('#')[0];
  cacheFileContent(cleanKey, content);
}

export function invalidateFileCache(filePath?: string): void {
  if (filePath) {
    const cleanKey = decodeURIComponent((filePath || '').replace(/^file:\/\/\/?/i, '')).replace(/^\/([a-zA-Z]:)/, '$1').replace(/\\/g, '/').split('#')[0];
    fileContentMemoryCache.delete(cleanKey);
    inFlightFileFetches.delete(cleanKey);
  } else {
    fileContentMemoryCache.clear();
    inFlightFileFetches.clear();
  }
}

export async function fetchFileContent(filePath: string, sessionId?: string, bypassCache: boolean = false): Promise<string> {
  const cleanKey = decodeURIComponent((filePath || '').replace(/^file:\/\/\/?/i, '')).replace(/^\/([a-zA-Z]:)/, '$1').replace(/\\/g, '/').split('#')[0];
  if (!bypassCache && fileContentMemoryCache.has(cleanKey)) {
    return fileContentMemoryCache.get(cleanKey)!;
  }
  if (!bypassCache && inFlightFileFetches.has(cleanKey)) {
    return inFlightFileFetches.get(cleanKey)!;
  }

  const fetchPromise = (async () => {
    try {
      const qs = sessionId ? `&session_id=${encodeURIComponent(sessionId)}` : '';
      const res = await safeFetch(`${BASE_URL}/files/content?path=${encodeURIComponent(cleanKey)}${qs}`);
      if (!res.ok) return "Failed to load file content.";
      const data = await res.json();
      if (data.type === 'excel' || data.type === 'univer') {
        const serialized = JSON.stringify(data);
        cacheFileContent(cleanKey, serialized);
        return serialized;
      }
      const content = data.content !== undefined ? data.content : "";
      if (data.error || content.includes('not found on local disk')) {
        return content || "File not found on local disk.";
      }
      cacheFileContent(cleanKey, content);
      return content;
    } catch (err) {
      console.warn("Failed to fetch file content:", err);
      return "Error fetching file content.";
    } finally {
      inFlightFileFetches.delete(cleanKey);
    }
  })();

  inFlightFileFetches.set(cleanKey, fetchPromise);
  return fetchPromise;
}

export async function fetchExcelData(
  filePath: string,
  sheet?: string,
  page: number = 0,
  pageSize: number = 200
): Promise<any> {
  try {
    let url = `${BASE_URL}/files/content?path=${encodeURIComponent(filePath)}&page=${page}&page_size=${pageSize}`;
    if (sheet) url += `&sheet=${encodeURIComponent(sheet)}`;
    const res = await safeFetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn("Failed to fetch Excel data:", err);
    return null;
  }
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

