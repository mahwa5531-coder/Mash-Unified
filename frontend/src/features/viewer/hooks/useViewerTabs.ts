"use client";

import { useState, useEffect, useCallback, useRef, useMemo, MouseEvent as ReactMouseEvent } from 'react';
import type { TabItem } from '../types';
import { fetchFileContent, getFileContentFromCache, isFileTruncatedFromCache, invalidateFileCache } from '@/services/files';
import { deletedSessionIds } from '@/services/sessions';
import { fetchTaskLog } from '@/services/tasks';
import { normalizePath } from '@/utils/normalizePath';
import { UNSUPPORTED_DOC_REGEX } from '../utils/artifactPresentation';

export function isFileLoadError(content?: string): boolean {
  if (!content) return false;
  return (
    content.startsWith('Error loading file:') ||
    content.includes('not found on local disk') ||
    content.includes('File not found') ||
    content.includes('Failed to load file content')
  );
}

interface SessionRightSidebarMemory {
  tabs: TabItem[];
  activeId: string | null;
  mode: 'explorer' | 'editor';
}

export const MAX_VIEWER_TABS = 20;
export const MAX_SIDEBAR_MEMORY_SESSIONS = 6;
const globalRightSidebarMemory = new Map<string, SessionRightSidebarMemory>();

export function computeNextOpenTabs(
  prev: TabItem[],
  tabId: string,
  title: string,
  type: 'file' | 'image' | 'terminal',
  path?: string,
  activeTabId?: string | null,
  tabAccessTime?: Map<string, number>
): { nextTabs: TabItem[]; evictedTabId: string | null } {
  if (prev.some(t => t.id === tabId)) {
    return { nextTabs: prev, evictedTabId: null };
  }
  let next = prev;
  let evictedTabId: string | null = null;
  if (next.length >= MAX_VIEWER_TABS) {
    let oldestTime = Infinity;
    let evictIdx = -1;
    for (let i = 0; i < next.length; i++) {
      if (next[i].id !== activeTabId) {
        const lastAccess = tabAccessTime?.get(next[i].id) ?? 0;
        if (lastAccess < oldestTime) {
          oldestTime = lastAccess;
          evictIdx = i;
        }
      }
    }
    if (evictIdx !== -1) {
      evictedTabId = next[evictIdx].id;
      next = next.filter((_, i) => i !== evictIdx);
    }
  }
  return {
    nextTabs: [...next, { id: tabId, title, type, ...(path ? { path } : {}) }],
    evictedTabId,
  };
}

export function computeCloseTab(
  prev: TabItem[],
  tabId: string,
  activeTabId: string | null
): { nextTabs: TabItem[]; nextActiveId: string | null } {
  const targetIndex = prev.findIndex(t => t.id === tabId);
  if (targetIndex === -1) {
    return { nextTabs: prev, nextActiveId: activeTabId };
  }
  const nextTabs = prev.filter((_, i) => i !== targetIndex);
  let nextActiveId = activeTabId;
  if (activeTabId === tabId) {
    const nextActive = nextTabs[targetIndex] || nextTabs[targetIndex - 1] || null;
    nextActiveId = nextActive ? nextActive.id : null;
  }
  return { nextTabs, nextActiveId };
}

// ponytail: sessionStorage fallback guarantees tabs survive browser F5 reload per session
function getPersistedSidebarMemory(sessionId: string): SessionRightSidebarMemory | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(`mash_sidebar_${sessionId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setPersistedSidebarMemory(sessionId: string, data: SessionRightSidebarMemory): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(`mash_sidebar_${sessionId}`, JSON.stringify(data));
  } catch {}
}

export function evictRightSidebarMemory(sessionId?: string): void {
  if (sessionId) {
    globalRightSidebarMemory.delete(sessionId);
    if (typeof window !== 'undefined') {
      try { sessionStorage.removeItem(`mash_sidebar_${sessionId}`); } catch {}
    }
  } else {
    globalRightSidebarMemory.clear();
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('mash:evict_sidebar_memory', { detail: { sessionId } }));
  }
}

export function useViewerTabs(sessionId?: string) {
  const [viewMode, setViewMode] = useState<'explorer' | 'editor'>(() => {
    if (sessionId && !deletedSessionIds.has(sessionId)) {
      if (globalRightSidebarMemory.has(sessionId)) {
        return globalRightSidebarMemory.get(sessionId)!.mode;
      }
      const persisted = getPersistedSidebarMemory(sessionId);
      if (persisted) return persisted.mode;
    }
    return 'explorer';
  });

  const [openTabs, setOpenTabs] = useState<TabItem[]>(() => {
    if (sessionId && !deletedSessionIds.has(sessionId)) {
      if (globalRightSidebarMemory.has(sessionId)) {
        return globalRightSidebarMemory.get(sessionId)!.tabs;
      }
      const persisted = getPersistedSidebarMemory(sessionId);
      if (persisted) return persisted.tabs;
    }
    return [];
  });

  const [activeTabId, setActiveTabId] = useState<string | null>(() => {
    if (sessionId && !deletedSessionIds.has(sessionId)) {
      if (globalRightSidebarMemory.has(sessionId)) {
        return globalRightSidebarMemory.get(sessionId)!.activeId;
      }
      const persisted = getPersistedSidebarMemory(sessionId);
      if (persisted) return persisted.activeId;
    }
    return null;
  });

  const [tabContent, setTabContent] = useState<Record<string, string>>({});
  const [tabTruncated, setTabTruncated] = useState<Record<string, boolean>>({});
  const tabContentRef = useRef(tabContent);
  tabContentRef.current = tabContent;
  const [isLoadingContent, setIsLoadingContent] = useState<boolean>(false);
  const tabAccessTimeRef = useRef<Map<string, number>>(new Map());

  const openTabsRef = useRef(openTabs);
  openTabsRef.current = openTabs;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const inFlightTabFetchesRef = useRef<Set<string>>(new Set());

  const prevSessionIdRef = useRef<string | undefined>(sessionId);

  // Close tabs belonging to this session when eviction event is triggered
  useEffect(() => {
    const handleEvict = (e: any) => {
      const evictedId = e?.detail?.sessionId;
      if (!evictedId || evictedId === sessionId) {
        setOpenTabs([]);
        setActiveTabId(null);
        setViewMode('explorer');
        setTabContent({});
        setTabTruncated({});
        tabAccessTimeRef.current.clear();
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('mash:evict_sidebar_memory', handleEvict);
      return () => window.removeEventListener('mash:evict_sidebar_memory', handleEvict);
    }
  }, [sessionId]);

  // Session-isolated tabs management: save current session tabs & restore next session tabs
  useEffect(() => {
    if (sessionId !== prevSessionIdRef.current) {
      if (prevSessionIdRef.current && !deletedSessionIds.has(prevSessionIdRef.current)) {
        if (globalRightSidebarMemory.has(prevSessionIdRef.current)) {
          globalRightSidebarMemory.delete(prevSessionIdRef.current);
        }
        globalRightSidebarMemory.set(prevSessionIdRef.current, {
          tabs: openTabs,
          activeId: activeTabId,
          mode: viewMode,
        });
      }
      prevSessionIdRef.current = sessionId;
      setTabContent({});
      setTabTruncated({});
      tabAccessTimeRef.current.clear();

      if (sessionId && !deletedSessionIds.has(sessionId)) {
        const cached = globalRightSidebarMemory.get(sessionId) || getPersistedSidebarMemory(sessionId);
        if (cached) {
          setOpenTabs(cached.tabs);
          setActiveTabId(cached.activeId);
          setViewMode(cached.mode);
          if (cached.activeId) {
            tabAccessTimeRef.current.set(cached.activeId, Date.now());
          }
        } else {
          setOpenTabs([]);
          setActiveTabId(null);
          setViewMode('explorer');
        }
      } else {
        setOpenTabs([]);
        setActiveTabId(null);
        setViewMode('explorer');
      }
    }
  }, [sessionId]);

  // Keep globalRightSidebarMemory synchronized on any tab changes (with true MRU order and LRU eviction guard)
  useEffect(() => {
    if (sessionId && !deletedSessionIds.has(sessionId)) {
      if (globalRightSidebarMemory.has(sessionId)) {
        globalRightSidebarMemory.delete(sessionId);
      } else if (globalRightSidebarMemory.size >= MAX_SIDEBAR_MEMORY_SESSIONS) {
        const oldest = globalRightSidebarMemory.keys().next().value;
        if (oldest) globalRightSidebarMemory.delete(oldest);
      }
      const memObj: SessionRightSidebarMemory = {
        tabs: openTabs,
        activeId: activeTabId,
        mode: viewMode,
      };
      globalRightSidebarMemory.set(sessionId, memObj);
      setPersistedSidebarMemory(sessionId, memObj);
    }
  }, [sessionId, openTabs, activeTabId, viewMode]);

  // Update access time whenever activeTabId changes
  useEffect(() => {
    if (activeTabId) {
      tabAccessTimeRef.current.set(activeTabId, Date.now());
    }
  }, [activeTabId]);

  // Atomic Tab Opening (Guarantees zero duplicate tabs and enforces MAX_VIEWER_TABS ceiling with true LRU eviction)
  const openFileTab = useCallback((name: string, fullPath: string, type: 'file' | 'image' = 'file') => {
    const normalizedPath = normalizePath(fullPath);

    const isImg = type === 'image' || /\.(png|jpg|jpeg|svg|gif|webp|ico|bmp)$/i.test(normalizedPath || name);
    const isPdf = /\.pdf$/i.test(normalizedPath || name);
    const isBinaryExcel = /\.(xlsx|xls|xlsm|xltx|xltm|xlsb|ods)$/i.test(normalizedPath || name);
    const isUnsupported = UNSUPPORTED_DOC_REGEX.test(normalizedPath || name);
    const tabId = isImg ? `img-${normalizedPath}` : `file-${normalizedPath}`;

    tabAccessTimeRef.current.set(tabId, Date.now());

    setOpenTabs(prev => {
      const { nextTabs, evictedTabId } = computeNextOpenTabs(
        prev,
        tabId,
        name,
        isImg ? 'image' : 'file',
        normalizedPath,
        activeTabId,
        tabAccessTimeRef.current
      );
      if (evictedTabId) {
        tabAccessTimeRef.current.delete(evictedTabId);
        setTabContent(c => {
          if (!(evictedTabId in c)) return c;
          const copy = { ...c };
          delete copy[evictedTabId];
          return copy;
        });
        setTabTruncated(t => {
          if (!(evictedTabId in t)) return t;
          const copy = { ...t };
          delete copy[evictedTabId];
          return copy;
        });
      }
      return nextTabs;
    });

    setActiveTabId(tabId);
    setViewMode('editor');

    if (!isImg && !isPdf && !isUnsupported && !isBinaryExcel) {
      const cached = getFileContentFromCache(normalizedPath, sessionId);
      if (cached !== undefined && !isFileLoadError(cached)) {
        setTabContent(c => ({ ...c, [tabId]: cached }));
        setTabTruncated(t => ({ ...t, [tabId]: isFileTruncatedFromCache(normalizedPath, sessionId) }));
        setIsLoadingContent(false);
      } else {
        const capturedSessionId = sessionId;
        inFlightTabFetchesRef.current.add(tabId);
        setIsLoadingContent(true);
        fetchFileContent(normalizedPath, sessionId).then(content => {
          // ponytail: discard stale fetch if tab was closed or session switched mid-flight
          if (sessionIdRef.current !== capturedSessionId) return;
          if (!openTabsRef.current.some(t => t.id === tabId)) return;
          setTabContent(c => ({ ...c, [tabId]: content }));
          setTabTruncated(t => ({ ...t, [tabId]: isFileTruncatedFromCache(normalizedPath, sessionId) }));
        }).catch(err => {
          if (sessionIdRef.current !== capturedSessionId) return;
          if (!openTabsRef.current.some(t => t.id === tabId)) return;
          setTabContent(c => ({ ...c, [tabId]: `Error loading file: ${err?.message || err}` }));
        }).finally(() => {
          inFlightTabFetchesRef.current.delete(tabId);
          setIsLoadingContent(inFlightTabFetchesRef.current.size > 0);
        });
      }
    }
  }, [activeTabId, sessionId]);

  // Terminal Tab Opener
  const openTerminalTab = useCallback((taskId: string, title: string) => {
    const tabId = `terminal-${taskId}`;
    tabAccessTimeRef.current.set(tabId, Date.now());

    setOpenTabs(prev => {
      const { nextTabs, evictedTabId } = computeNextOpenTabs(
        prev,
        tabId,
        title,
        'terminal',
        undefined,
        activeTabId,
        tabAccessTimeRef.current
      );
      if (evictedTabId) {
        tabAccessTimeRef.current.delete(evictedTabId);
        setTabContent(c => {
          if (!(evictedTabId in c)) return c;
          const copy = { ...c };
          delete copy[evictedTabId];
          return copy;
        });
        setTabTruncated(t => {
          if (!(evictedTabId in t)) return t;
          const copy = { ...t };
          delete copy[evictedTabId];
          return copy;
        });
      }
      return nextTabs;
    });

    setActiveTabId(tabId);
    setViewMode('editor');

    setTabContent(prev => {
      if (prev[tabId] === undefined) {
        const capturedSessionId = sessionId;
        inFlightTabFetchesRef.current.add(tabId);
        setIsLoadingContent(true);
        fetchTaskLog(taskId).then(content => {
          if (sessionIdRef.current !== capturedSessionId) return;
          if (!openTabsRef.current.some(t => t.id === tabId)) return;
          setTabContent(c => ({ ...c, [tabId]: content }));
        }).catch(err => {
          if (sessionIdRef.current !== capturedSessionId) return;
          if (!openTabsRef.current.some(t => t.id === tabId)) return;
          setTabContent(c => ({ ...c, [tabId]: `Error loading log: ${err?.message || err}` }));
        }).finally(() => {
          inFlightTabFetchesRef.current.delete(tabId);
          setIsLoadingContent(inFlightTabFetchesRef.current.size > 0);
        });
      }
      return prev;
    });
  }, [sessionId]);

  // Tab Close
  const handleCloseTab = useCallback((e: ReactMouseEvent, tabId: string) => {
    e.stopPropagation();
    inFlightTabFetchesRef.current.delete(tabId);
    setTabContent(prev => {
      if (!(tabId in prev)) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });

    setTabTruncated(prev => {
      if (!(tabId in prev)) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });

    setOpenTabs(prev => {
      const closedTab = prev.find(t => t.id === tabId);
      if (closedTab?.path) {
        invalidateFileCache(closedTab.path, sessionId);
      }
      tabAccessTimeRef.current.delete(tabId);

      const { nextTabs, nextActiveId } = computeCloseTab(prev, tabId, activeTabId);
      if (activeTabId === tabId) {
        setActiveTabId(nextActiveId);
        if (nextTabs.length === 0) {
          setViewMode('explorer');
        }
      }
      return nextTabs;
    });
  }, [activeTabId]);

  const activeTab = useMemo(() => openTabs.find(t => t.id === activeTabId), [openTabs, activeTabId]);

  // Retry tab content loading on demand (invalidates cache and re-fetches)
  const retryTabContent = useCallback(async (tabId?: string) => {
    const targetId = tabId || activeTabId;
    if (!targetId) return;
    const targetTab = openTabs.find(t => t.id === targetId);
    if (!targetTab || targetTab.type !== 'file' || !targetTab.path) return;

    const cleanPath = targetTab.path.split('#')[0];
    invalidateFileCache(cleanPath, sessionId);
    const capturedSessionId = sessionId;
    inFlightTabFetchesRef.current.add(targetId);
    setIsLoadingContent(true);
    try {
      const content = await fetchFileContent(cleanPath, sessionId, true);
      if (sessionIdRef.current === capturedSessionId && openTabsRef.current.some(t => t.id === targetId)) {
        setTabContent(c => ({ ...c, [targetId]: content }));
        setTabTruncated(t => ({ ...t, [targetId]: isFileTruncatedFromCache(cleanPath, sessionId) }));
      }
    } catch (err: any) {
      if (sessionIdRef.current === capturedSessionId && openTabsRef.current.some(t => t.id === targetId)) {
        setTabContent(c => ({ ...c, [targetId]: `Error loading file: ${err?.message || err}` }));
      }
    } finally {
      inFlightTabFetchesRef.current.delete(targetId);
      setIsLoadingContent(inFlightTabFetchesRef.current.size > 0);
    }
  }, [activeTabId, openTabs, sessionId]);

  // Automatically hydrate content for active file tab from cache or backend
  useEffect(() => {
    if (activeTab && activeTab.type === 'file' && activeTab.path) {
      const isPdf = /\.pdf$/i.test(activeTab.path);
      const isUnsupported = UNSUPPORTED_DOC_REGEX.test(activeTab.path);
      const isBinaryExcel = /\.(xlsx|xls|xlsm|xltx|xltm|xlsb|ods)$/i.test(activeTab.path);
      if (isPdf || isUnsupported || isBinaryExcel) return;

      const tabId = activeTab.id;
      const current = tabContentRef.current[tabId];
      if (current === undefined || isFileLoadError(current)) {
        const cleanPath = activeTab.path.split('#')[0];
        if (isFileLoadError(current)) {
          invalidateFileCache(cleanPath, sessionId);
        }
        const cached = getFileContentFromCache(cleanPath, sessionId);
        if (cached !== undefined && !isFileLoadError(cached)) {
          setTabContent(c => ({ ...c, [tabId]: cached }));
          setTabTruncated(t => ({ ...t, [tabId]: isFileTruncatedFromCache(cleanPath, sessionId) }));
          setIsLoadingContent(false);
        } else {
          const capturedSessionId = sessionId;
          inFlightTabFetchesRef.current.add(tabId);
          setIsLoadingContent(true);
          fetchFileContent(cleanPath, sessionId, true).then(content => {
            if (sessionIdRef.current !== capturedSessionId) return;
            if (!openTabsRef.current.some(t => t.id === tabId)) return;
            setTabContent(c => ({ ...c, [tabId]: content }));
            setTabTruncated(t => ({ ...t, [tabId]: isFileTruncatedFromCache(cleanPath, sessionId) }));
          }).catch(err => {
            if (sessionIdRef.current !== capturedSessionId) return;
            if (!openTabsRef.current.some(t => t.id === tabId)) return;
            setTabContent(c => ({ ...c, [tabId]: `Error loading file: ${err?.message || err}` }));
          }).finally(() => {
            inFlightTabFetchesRef.current.delete(tabId);
            setIsLoadingContent(inFlightTabFetchesRef.current.size > 0);
          });
        }
      }
    }
  }, [activeTab?.id, activeTab?.path, activeTab?.type, sessionId]);

  return {
    viewMode,
    setViewMode,
    openTabs,
    setOpenTabs,
    activeTabId,
    setActiveTabId,
    tabContent,
    setTabContent,
    tabTruncated,
    isLoadingContent,
    openFileTab,
    openTerminalTab,
    handleCloseTab,
    retryTabContent,
    activeTab,
  };
}
