"use client";

import { useState, useEffect, useCallback, useRef, useMemo, MouseEvent as ReactMouseEvent } from 'react';
import type { TabItem } from '../types';
import { fetchFileContent, getFileContentFromCache, invalidateFileCache } from '@/services/files';
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

export function useViewerTabs(sessionId?: string) {
  const [viewMode, setViewMode] = useState<'explorer' | 'editor'>(() => {
    if (sessionId && globalRightSidebarMemory.has(sessionId)) {
      return globalRightSidebarMemory.get(sessionId)!.mode;
    }
    return 'explorer';
  });

  const [openTabs, setOpenTabs] = useState<TabItem[]>(() => {
    if (sessionId && globalRightSidebarMemory.has(sessionId)) {
      return globalRightSidebarMemory.get(sessionId)!.tabs;
    }
    return [];
  });

  const [activeTabId, setActiveTabId] = useState<string | null>(() => {
    if (sessionId && globalRightSidebarMemory.has(sessionId)) {
      return globalRightSidebarMemory.get(sessionId)!.activeId;
    }
    return null;
  });

  const [tabContent, setTabContent] = useState<Record<string, string>>({});
  const tabContentRef = useRef(tabContent);
  tabContentRef.current = tabContent;
  const [isLoadingContent, setIsLoadingContent] = useState<boolean>(false);

  const prevSessionIdRef = useRef<string | undefined>(sessionId);

  // Session-isolated tabs management: save current session tabs & restore next session tabs
  useEffect(() => {
    if (sessionId !== prevSessionIdRef.current) {
      if (prevSessionIdRef.current) {
        globalRightSidebarMemory.set(prevSessionIdRef.current, {
          tabs: openTabs,
          activeId: activeTabId,
          mode: viewMode,
        });
      }
      prevSessionIdRef.current = sessionId;

      if (sessionId && globalRightSidebarMemory.has(sessionId)) {
        const cached = globalRightSidebarMemory.get(sessionId)!;
        setOpenTabs(cached.tabs);
        setActiveTabId(cached.activeId);
        setViewMode(cached.mode);
      } else {
        setOpenTabs([]);
        setActiveTabId(null);
        setViewMode('explorer');
      }
    }
  }, [sessionId]);

  // Keep globalRightSidebarMemory synchronized on any tab changes (with LRU eviction guard)
  useEffect(() => {
    if (sessionId) {
      if (globalRightSidebarMemory.size >= MAX_SIDEBAR_MEMORY_SESSIONS && !globalRightSidebarMemory.has(sessionId)) {
        const oldest = globalRightSidebarMemory.keys().next().value;
        if (oldest) globalRightSidebarMemory.delete(oldest);
      }
      globalRightSidebarMemory.set(sessionId, {
        tabs: openTabs,
        activeId: activeTabId,
        mode: viewMode,
      });
    }
  }, [sessionId, openTabs, activeTabId, viewMode]);

  // Atomic Tab Opening (Guarantees zero duplicate tabs and enforces MAX_VIEWER_TABS ceiling)
  const openFileTab = useCallback((name: string, fullPath: string, type: 'file' | 'image' = 'file') => {
    const normalizedPath = normalizePath(fullPath);

    const isImg = type === 'image' || /\.(png|jpg|jpeg|svg|gif|webp|ico|bmp)$/i.test(normalizedPath || name);
    const isPdf = /\.pdf$/i.test(normalizedPath || name);
    const isBinaryExcel = /\.(xlsx|xls|xlsm|xltx|xltm|xlsb|ods)$/i.test(normalizedPath || name);
    const isUnsupported = UNSUPPORTED_DOC_REGEX.test(normalizedPath || name);
    const tabId = isImg ? `img-${normalizedPath}` : `file-${normalizedPath}`;

    setOpenTabs(prev => {
      if (prev.some(t => t.id === tabId)) {
        return prev;
      }
      let next = prev;
      if (next.length >= MAX_VIEWER_TABS) {
        const evictIdx = next.findIndex(t => t.id !== activeTabId);
        if (evictIdx !== -1) {
          const evicted = next[evictIdx];
          setTabContent(c => {
            if (!(evicted.id in c)) return c;
            const copy = { ...c };
            delete copy[evicted.id];
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
      const cached = getFileContentFromCache(normalizedPath);
      if (cached !== undefined && !cached.includes('not found on local disk')) {
        setTabContent(c => ({ ...c, [tabId]: cached }));
        setIsLoadingContent(false);
      } else {
        setIsLoadingContent(true);
        fetchFileContent(normalizedPath, sessionId).then(content => {
          setTabContent(c => ({ ...c, [tabId]: content }));
        }).catch(err => {
          setTabContent(c => ({ ...c, [tabId]: `Error loading file: ${err?.message || err}` }));
        }).finally(() => {
          setIsLoadingContent(false);
        });
      }
    }
  }, [sessionId]);

  // Terminal Tab Opener
  const openTerminalTab = useCallback((taskId: string, title: string) => {
    const tabId = `terminal-${taskId}`;
    setOpenTabs(prev => {
      if (prev.some(t => t.id === tabId)) return prev;
      let next = prev;
      if (next.length >= MAX_VIEWER_TABS) {
        const evictIdx = next.findIndex(t => t.id !== activeTabId);
        if (evictIdx !== -1) {
          const evicted = next[evictIdx];
          setTabContent(c => {
            if (!(evicted.id in c)) return c;
            const copy = { ...c };
            delete copy[evicted.id];
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

    setOpenTabs(prev => {
      const targetIndex = prev.findIndex(t => t.id === tabId);
      if (targetIndex === -1) return prev;

      const closedTab = prev[targetIndex];
      if (closedTab?.path) {
        invalidateFileCache(closedTab.path);
      }

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
        const cached = getFileContentFromCache(cleanPath);
        if (cached !== undefined) {
          setTabContent(c => ({ ...c, [tabId]: cached }));
          setIsLoadingContent(false);
        } else {
          setIsLoadingContent(true);
          fetchFileContent(cleanPath, sessionId).then(content => {
            setTabContent(c => ({ ...c, [tabId]: content }));
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
    isLoadingContent,
    openFileTab,
    openTerminalTab,
    handleCloseTab,
    activeTab,
  };
}
