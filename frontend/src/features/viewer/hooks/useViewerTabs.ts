"use client";

import { useState, useEffect, useCallback, useRef, useMemo, MouseEvent as ReactMouseEvent } from 'react';
import type { TabItem } from '../types';
import { fetchFileContent, getFileContentFromCache, isFileTruncatedFromCache, invalidateFileCache } from '@/services/files';
import { deletedSessionIds } from '@/services/sessions';
import { fetchTaskLog } from '@/services/tasks';
import { normalizePath } from '@/utils/normalizePath';
import { UNSUPPORTED_DOC_REGEX } from '../utils/artifactPresentation';

interface SessionRightSidebarMemory {
  tabs: TabItem[];
  activeId: string | null;
  mode: 'explorer' | 'editor';
}

const MAX_VIEWER_TABS = 20;
const MAX_SIDEBAR_MEMORY_SESSIONS = 6;
const globalRightSidebarMemory = new Map<string, SessionRightSidebarMemory>();

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
      if (prev.some(t => t.id === tabId)) {
        return prev;
      }
      let next = prev;
      if (next.length >= MAX_VIEWER_TABS) {
        let oldestTime = Infinity;
        let evictIdx = -1;
        for (let i = 0; i < next.length; i++) {
          if (next[i].id !== activeTabId) {
            const lastAccess = tabAccessTimeRef.current.get(next[i].id) ?? 0;
            if (lastAccess < oldestTime) {
              oldestTime = lastAccess;
              evictIdx = i;
            }
          }
        }
        if (evictIdx !== -1) {
          const evictedId = next[evictIdx].id;
          tabAccessTimeRef.current.delete(evictedId);
          setTabContent(c => {
            if (!(evictedId in c)) return c;
            const copy = { ...c };
            delete copy[evictedId];
            return copy;
          });
          setTabTruncated(t => {
            if (!(evictedId in t)) return t;
            const copy = { ...t };
            delete copy[evictedId];
            return copy;
          });
          next = next.filter((_, i) => i !== evictIdx);
        }
      }
      return [...next, { id: tabId, title: name, type: isImg ? 'image' : 'file', path: normalizedPath }];
    });

    setActiveTabId(tabId);
    setViewMode('editor');

    if (!isImg && !isPdf && !isUnsupported && !isBinaryExcel) {
      const cached = getFileContentFromCache(normalizedPath, sessionId);
      if (cached !== undefined && !cached.includes('not found on local disk')) {
        setTabContent(c => ({ ...c, [tabId]: cached }));
        setTabTruncated(t => ({ ...t, [tabId]: isFileTruncatedFromCache(normalizedPath, sessionId) }));
        setIsLoadingContent(false);
      } else {
        setIsLoadingContent(true);
        fetchFileContent(normalizedPath, sessionId).then(content => {
          setTabContent(c => ({ ...c, [tabId]: content }));
          setTabTruncated(t => ({ ...t, [tabId]: isFileTruncatedFromCache(normalizedPath, sessionId) }));
        }).catch(err => {
          setTabContent(c => ({ ...c, [tabId]: `Error loading file: ${err?.message || err}` }));
        }).finally(() => {
          setIsLoadingContent(false);
        });
      }
    }
  }, [activeTabId, sessionId]);

  // Terminal Tab Opener
  const openTerminalTab = useCallback((taskId: string, title: string) => {
    const tabId = `terminal-${taskId}`;
    tabAccessTimeRef.current.set(tabId, Date.now());

    setOpenTabs(prev => {
      if (prev.some(t => t.id === tabId)) return prev;
      let next = prev;
      if (next.length >= MAX_VIEWER_TABS) {
        let oldestTime = Infinity;
        let evictIdx = -1;
        for (let i = 0; i < next.length; i++) {
          if (next[i].id !== activeTabId) {
            const lastAccess = tabAccessTimeRef.current.get(next[i].id) ?? 0;
            if (lastAccess < oldestTime) {
              oldestTime = lastAccess;
              evictIdx = i;
            }
          }
        }
        if (evictIdx !== -1) {
          const evictedId = next[evictIdx].id;
          tabAccessTimeRef.current.delete(evictedId);
          setTabContent(c => {
            if (!(evictedId in c)) return c;
            const copy = { ...c };
            delete copy[evictedId];
            return copy;
          });
          setTabTruncated(t => {
            if (!(evictedId in t)) return t;
            const copy = { ...t };
            delete copy[evictedId];
            return copy;
          });
          next = next.filter((_, i) => i !== evictIdx);
        }
      }
      return [...next, { id: tabId, title, type: 'terminal' }];
    });

    setActiveTabId(tabId);
    setViewMode('editor');

    setTabContent(prev => {
      if (prev[tabId] === undefined) {
        setIsLoadingContent(true);
        fetchTaskLog(taskId).then(content => {
          setTabContent(c => ({ ...c, [tabId]: content }));
        }).catch(err => {
          setTabContent(c => ({ ...c, [tabId]: `Error loading log: ${err?.message || err}` }));
        }).finally(() => {
          setIsLoadingContent(false);
        });
      }
      return prev;
    });
  }, []);

  // Tab Close
  const handleCloseTab = useCallback((e: ReactMouseEvent, tabId: string) => {
    e.stopPropagation();
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
      const targetIndex = prev.findIndex(t => t.id === tabId);
      if (targetIndex === -1) return prev;

      const closedTab = prev[targetIndex];
      if (closedTab?.path) {
        invalidateFileCache(closedTab.path, sessionId);
      }
      tabAccessTimeRef.current.delete(tabId);

      const newTabs = prev.filter((_, i) => i !== targetIndex);

      if (activeTabId === tabId) {
        const nextActive = newTabs[targetIndex] || newTabs[targetIndex - 1] || null;
        setActiveTabId(nextActive ? nextActive.id : null);
        if (newTabs.length === 0) {
          setViewMode('explorer');
        }
      }
      return newTabs;
    });
  }, [activeTabId]);

  const activeTab = useMemo(() => openTabs.find(t => t.id === activeTabId), [openTabs, activeTabId]);

  // Automatically hydrate content for active file tab from cache or backend
  useEffect(() => {
    if (activeTab && activeTab.type === 'file' && activeTab.path) {
      const isPdf = /\.pdf$/i.test(activeTab.path);
      const isUnsupported = UNSUPPORTED_DOC_REGEX.test(activeTab.path);
      const isBinaryExcel = /\.(xlsx|xls|xlsm|xltx|xltm|xlsb|ods)$/i.test(activeTab.path);
      if (isPdf || isUnsupported || isBinaryExcel) return;

      const tabId = activeTab.id;
      if (tabContentRef.current[tabId] === undefined) {
        const cleanPath = activeTab.path.split('#')[0];
        const cached = getFileContentFromCache(cleanPath, sessionId);
        if (cached !== undefined) {
          setTabContent(c => ({ ...c, [tabId]: cached }));
          setTabTruncated(t => ({ ...t, [tabId]: isFileTruncatedFromCache(cleanPath, sessionId) }));
          setIsLoadingContent(false);
        } else {
          setIsLoadingContent(true);
          fetchFileContent(cleanPath, sessionId).then(content => {
            setTabContent(c => ({ ...c, [tabId]: content }));
            setTabTruncated(t => ({ ...t, [tabId]: isFileTruncatedFromCache(cleanPath, sessionId) }));
          }).catch(err => {
            setTabContent(c => ({ ...c, [tabId]: `Error loading file: ${err?.message || err}` }));
          }).finally(() => {
            setIsLoadingContent(false);
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
    activeTab,
  };
}
