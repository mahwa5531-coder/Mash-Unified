"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo, MouseEvent as ReactMouseEvent } from 'react';
import SafeFileViewer from '@/features/viewer/components/SafeFileViewer';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ViewerHeader } from './ViewerHeader';
import { ExplorerPanel } from './ExplorerPanel';
import { ViewerEmptyState } from './ViewerEmptyState';
import { FileBreadcrumbBar } from '@/primitives/FileBreadcrumbBar';
import { TerminalViewer } from './TerminalViewer';
import { MoreVertical, Copy, Download, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { formatArtifactTitle, UNSUPPORTED_DOC_REGEX } from '../utils/artifactPresentation';
import type { TabItem } from '../types';
import { fetchFileContent, getFileContentFromCache } from '@/services/files';
import { fetchTaskLog, fetchBackgroundTasks, killBackgroundTask, BackgroundTaskItem } from '@/services/tasks';
import { fetchSessionArtifacts, ArtifactFileItem } from '@/services/artifacts';
import { BASE_URL } from '@/services/client';

export interface RightSidebarProps {
  onToggle: () => void;
  fileToOpen?: string | null;
  onFileOpened?: () => void;
  sessionId?: string;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
}

interface SessionRightSidebarMemory {
  tabs: TabItem[];
  activeId: string | null;
  mode: 'explorer' | 'editor';
}
// ponytail: Module-level Right Sidebar memory preserves exact open tabs & view state across unmounts/toggles
const globalRightSidebarMemory = new Map<string, SessionRightSidebarMemory>();

export default function RightSidebar({ 
  onToggle, 
  fileToOpen, 
  onFileOpened, 
  sessionId,
  isMaximized: controlledIsMaximized,
  onToggleMaximize
}: RightSidebarProps) {
  // Accordion Sections State (backgroundTasks defaults to collapsed to minimize distraction for auditors)
  const [openSections, setOpenSections] = useState({
    artifacts: true,
    backgroundTasks: false,
  });

  // Expanded items state ("See all")
  const [expandedSection, setExpandedSection] = useState<{
    artifacts: boolean;
    tasks: boolean;
  }>({
    artifacts: false,
    tasks: false,
  });

  // Inline filter search queries
  const [artifactFilter, setArtifactFilter] = useState('');
  const [taskFilter, setTaskFilter] = useState('');

  // Dual-Mode State: 'explorer' (overview) vs 'editor' (file/tab viewer)
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
  const [fileViewMode, setFileViewMode] = useState<'preview' | 'raw'>('preview');

  // Data States
  const [artifacts, setArtifacts] = useState<ArtifactFileItem[]>([]);
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTaskItem[]>([]);

  const prevSessionIdRef = useRef<string | undefined>(sessionId);

  // Resizable Right Sidebar State
  const MIN_WIDTH = 320;
  const MAX_WIDTH = 1100;
  const DEFAULT_WIDTH = 420;
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [internalIsMaximized, setInternalIsMaximized] = useState(false);
  const isMaximized = controlledIsMaximized !== undefined ? controlledIsMaximized : internalIsMaximized;
  const prevWidthRef = useRef<number>(DEFAULT_WIDTH);

  // Load Session Artifacts (strictly scoped to this session)
  const loadArtifacts = useCallback(async () => {
    if (!sessionId) return;
    try {
      const items = await fetchSessionArtifacts(sessionId);
      setArtifacts(items || []);
    } catch {
      setArtifacts([]);
    }
  }, [sessionId]);

  // Load Background Tasks (isolated per session)
  const loadTasks = useCallback(async () => {
    try {
      const tasks = await fetchBackgroundTasks(sessionId);
      setBackgroundTasks(tasks);
    } catch {
      // ignore
    }
  }, [sessionId]);

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

      setArtifactFilter('');
      setTaskFilter('');
    }
  }, [sessionId]);

  // Keep globalRightSidebarMemory synchronized on any tab changes
  useEffect(() => {
    if (sessionId) {
      globalRightSidebarMemory.set(sessionId, {
        tabs: openTabs,
        activeId: activeTabId,
        mode: viewMode,
      });
    }
  }, [sessionId, openTabs, activeTabId, viewMode]);

  // Polling / Initial Load
  useEffect(() => {
    loadArtifacts();
    loadTasks();
  }, [loadArtifacts, loadTasks]);

  // Active background tasks - ponytail: only show live running tasks, not completed historical commands
  const effectiveTasks = useMemo(() => {
    return backgroundTasks.filter(t => t.status === 'running');
  }, [backgroundTasks]);

  // Adaptive, zero-waste background task polling:
  // 1. Only poll if in 'explorer' view mode
  // 2. Poll every 3s ONLY when active tasks are running; slow to 15s when idle
  // 3. Pause completely when document is hidden
  useEffect(() => {
    if (viewMode !== 'explorer') return;

    const hasActiveTasks = effectiveTasks.length > 0;
    const intervalMs = hasActiveTasks ? 3000 : 15000;

    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      loadTasks();
    }, intervalMs);

    const onVisibilityChange = () => {
      if (typeof document !== 'undefined' && !document.hidden && viewMode === 'explorer') {
        loadTasks();
        loadArtifacts();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [viewMode, effectiveTasks.length, loadTasks, loadArtifacts]);

  // Kill individual task
  const handleKillTask = async (e: ReactMouseEvent, pid: number) => {
    e.stopPropagation();
    try {
      setBackgroundTasks((prev) => prev.filter(t => t.pid !== pid));
      await killBackgroundTask(pid);
      loadTasks();
    } catch (err) {
      console.warn('Failed to kill task:', err);
    }
  };

  // Stop all active running tasks
  const handleKillAllTasks = async (e: ReactMouseEvent) => {
    e.stopPropagation();
    const running = effectiveTasks.filter(t => t.status === 'running');
    setBackgroundTasks((prev) => prev.filter(t => t.status !== 'running'));
    for (const t of running) {
      await killBackgroundTask(t.pid);
    }
    loadTasks();
  };

  // Drag Resizing logic with rAF throttling & iframe pointer-events shield
  const sidebarRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef(DEFAULT_WIDTH);

  const startResizing = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    let resizeRaf: number | null = null;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || isMaximized) return;
      let newWidth = window.innerWidth - e.clientX;
      if (newWidth < MIN_WIDTH) newWidth = MIN_WIDTH;
      const safeMax = Math.max(MIN_WIDTH, window.innerWidth - 420);
      if (newWidth > Math.min(MAX_WIDTH, safeMax)) newWidth = Math.min(MAX_WIDTH, safeMax);
      widthRef.current = newWidth;

      // rAF debouncing keeps drag butter-smooth at 120 FPS even with 1000Hz gaming mice
      if (resizeRaf === null) {
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = null;
          if (sidebarRef.current) {
            sidebarRef.current.style.width = `${widthRef.current}px`;
          }
        });
      }
    };

    const handleMouseUp = () => {
      if (resizeRaf !== null) {
        cancelAnimationFrame(resizeRaf);
        resizeRaf = null;
      }
      if (isResizing) {
        setWidth(widthRef.current);
      }
      setIsResizing(false);
    };

    if (isResizing) {
      // Prevent text selection across the page during fast mouse movements
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
      // Shield against PDF embeds/iframes swallowing mouse events
      const iframes = document.querySelectorAll('iframe, embed, object');
      iframes.forEach((el) => ((el as HTMLElement).style.pointerEvents = 'none'));

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      if (resizeRaf !== null) {
        cancelAnimationFrame(resizeRaf);
        resizeRaf = null;
      }
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      const iframes = document.querySelectorAll('iframe, embed, object');
      iframes.forEach((el) => ((el as HTMLElement).style.pointerEvents = ''));

      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, isMaximized]);

  // Maximize / Restore Toggle
  const handleToggleMaximize = useCallback(() => {
    if (onToggleMaximize) {
      onToggleMaximize();
    } else {
      if (internalIsMaximized) {
        setWidth(prevWidthRef.current || DEFAULT_WIDTH);
        setInternalIsMaximized(false);
      } else {
        prevWidthRef.current = width;
        setInternalIsMaximized(true);
      }
    }
  }, [onToggleMaximize, internalIsMaximized, width]);

  const toggleSection = (key: keyof typeof openSections) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Atomic Tab Opening (Guarantees zero duplicate tabs)
  const openFileTab = useCallback((name: string, fullPath: string, type: 'file' | 'image' = 'file') => {
    let cleanPath = decodeURIComponent((fullPath || '').replace(/^file:\/\/\/?/i, ''));
    cleanPath = cleanPath.replace(/^\/([a-zA-Z]:)/, '$1');
    const pathWithoutAnchor = cleanPath.split('#')[0];
    const normalizedPath = pathWithoutAnchor.replace(/\\/g, '/');

    const isImg = type === 'image' || /\.(png|jpg|jpeg|svg|gif|webp|ico|bmp)$/i.test(normalizedPath || name);
    const isPdf = /\.pdf$/i.test(normalizedPath || name);
    const isBinaryExcel = /\.(xlsx|xls|xlsm|xltx|xltm|xlsb|ods)$/i.test(normalizedPath || name);
    const isUnsupported = UNSUPPORTED_DOC_REGEX.test(normalizedPath || name);
    const tabId = isImg ? `img-${normalizedPath}` : `file-${normalizedPath}`;

    setOpenTabs(prev => {
      if (prev.some(t => t.id === tabId)) {
        return prev;
      }
      return [...prev, { id: tabId, title: name, type: isImg ? 'image' : 'file', path: normalizedPath }];
    });

    setActiveTabId(tabId);
    setViewMode('editor');

    // Fetch content dynamically for text/code/data files (skip images, PDFs, binary Excel, and unsupported docs which use direct viewers/fallback cards)
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

  // Listen to fileToOpen prop from chat/workspace and open automatically
  useEffect(() => {
    if (fileToOpen) {
      let cleanPath = decodeURIComponent(fileToOpen.replace(/^file:\/\/\/?/i, ''));
      cleanPath = cleanPath.replace(/^\/([a-zA-Z]:)/, '$1');
      const pathWithoutAnchor = cleanPath.split('#')[0];
      const basename = pathWithoutAnchor.split(/[/\\]/).pop() || pathWithoutAnchor;
      openFileTab(basename, pathWithoutAnchor);
      onFileOpened?.();
    }
  }, [fileToOpen, openFileTab, onFileOpened]);

  // Terminal Tab Opener
  const openTerminalTab = useCallback((taskId: string, title: string) => {
    const tabId = `terminal-${taskId}`;
    setOpenTabs(prev => {
      if (prev.some(t => t.id === tabId)) return prev;
      return [...prev, { id: tabId, title, type: 'terminal' }];
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
    // Evict closed tab content immediately so V8 garbage collection can reclaim memory
    setTabContent(prev => {
      if (!(tabId in prev)) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });

    setOpenTabs(prev => {
      const targetIndex = prev.findIndex(t => t.id === tabId);
      if (targetIndex === -1) return prev;

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

  // ponytail: Parse active tab path into hierarchical breadcrumb segments with horizontal scroll
  const breadcrumbs = useMemo(() => {
    if (!activeTab) return [{ label: 'Overview', isLast: true }];
    if (activeTab.type === 'terminal') {
      return [{ label: 'Terminal', isLast: false }, { label: activeTab.title, isLast: true }];
    }
    const rawPath = activeTab.path || activeTab.title || '';
    let clean = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
    clean = clean.replace(/^[a-zA-Z]:\/?/, '');
    const mashIdx = clean.toLowerCase().indexOf('mash/');
    if (mashIdx !== -1) {
      clean = clean.substring(mashIdx + 5);
    }
    const parts = clean.split('/').filter(Boolean);
    if (parts.length === 0) {
      return [{ label: activeTab.title, isLast: true }];
    }
    return parts.map((part, idx) => ({
      label: part,
      isLast: idx === parts.length - 1,
    }));
  }, [activeTab]);

  // Automatically hydrate content for active file tab from cache or backend
  useEffect(() => {
    if (activeTab && activeTab.type === 'file' && activeTab.path) {
      const isPdf = /\.pdf$/i.test(activeTab.path);
      const isUnsupported = UNSUPPORTED_DOC_REGEX.test(activeTab.path);
      const isBinaryExcel = /\.(xlsx|xls|xlsm|xltx|xltm|xlsb|ods)$/i.test(activeTab.path);
      if (isPdf || isUnsupported || isBinaryExcel) return; // PDFs render in iframe directly, unsupported docs and binary Excel show fallback metadata card

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

  const [terminalStatuses, setTerminalStatuses] = useState<Record<string, 'running' | 'completed' | 'failed'>>({});
  const terminalPreRef = useRef<HTMLDivElement>(null);

  // Auto-scroll terminal on new streamed output only if user is already near bottom (preserves scroll position when reading history)
  const currentTerminalContent = activeTab?.type === 'terminal' ? tabContent[activeTab.id] : undefined;
  useEffect(() => {
    if (activeTab?.type === 'terminal' && terminalPreRef.current) {
      const el = terminalPreRef.current;
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      if (isNearBottom) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [activeTab?.id, activeTab?.type, currentTerminalContent]);

  // SSE streaming for terminal log
  useEffect(() => {
    if (viewMode === 'editor' && activeTab?.type === 'terminal') {
      const taskId = activeTab.id.replace('terminal-', '');
      const tabId = activeTab.id;

      if (tabContent[tabId] && terminalStatuses[tabId] && terminalStatuses[tabId] !== 'running') {
        return;
      }

      setTabContent(prev => ({ ...prev, [tabId]: '' }));

      let es: EventSource | null = null;
      let hasStreamData = false;
      let termBuffer = '';
      let flushTimeout: number | null = null;

      try {
        es = new EventSource(`${BASE_URL}/api/tasks/${taskId}/stream`);
        es.onmessage = (event) => {
          if (event.data === '[DONE]') {
            es?.close();
            return;
          }
          try {
            const data = JSON.parse(event.data);
            if (data.content) {
              hasStreamData = true;
              termBuffer += data.content;
              if (!flushTimeout) {
                flushTimeout = window.setTimeout(() => {
                  setTabContent(prev => ({
                    ...prev,
                    [tabId]: (prev[tabId] || '') + termBuffer
                  }));
                  termBuffer = '';
                  flushTimeout = null;
                }, 100) as unknown as number;
              }
            }
            if (data.status) {
              setTerminalStatuses(prev => ({ ...prev, [tabId]: data.status }));
              if (data.status !== 'running') {
                es?.close();
              }
            }
          } catch {
            // ignore
          }
        };

        es.onerror = () => {
          es?.close();
          if (flushTimeout) clearTimeout(flushTimeout);
          if (!hasStreamData) {
            fetchTaskLog(taskId).then(content => {
              if (content) {
                setTabContent(prev => ({ ...prev, [tabId]: content }));
              }
            }).catch(() => {});
          }
        };
      } catch {
        fetchTaskLog(taskId).then(content => {
          if (content) {
            setTabContent(prev => ({ ...prev, [tabId]: content }));
          }
        }).catch(() => {});
      }

      return () => {
        es?.close();
        if (flushTimeout) clearTimeout(flushTimeout);
      };
    }
  }, [viewMode, activeTab]);


  // Breadcrumbs
  const breadcrumbParts = useMemo(() => {
    if (!activeTab) return [];
    if (activeTab.type === 'terminal') return ['Procedures', activeTab.title];
    if (activeTab.type === 'image') return ['Evidence', activeTab.title];
    return ['Working Papers', formatArtifactTitle(activeTab.title)];
  }, [activeTab]);


  return (
    <TooltipProvider delayDuration={150}>
      <div 
        ref={sidebarRef}
      className={`h-full bg-card text-card-foreground border-l border-white/[0.06] flex flex-col font-sans shrink-0 antialiased relative z-30 select-none ${
        isMaximized ? 'flex-1 w-full min-w-0' : (isResizing ? '' : 'transition-all duration-75')
      }`}
      style={isMaximized ? undefined : { width: `${width}px` }}
    >
      {/* Draggable Resizer Handle (Left edge, visible only when not maximized) */}
      {!isMaximized && (
        <div 
          className="absolute -left-1.5 top-0 w-3 h-full cursor-col-resize z-50 group flex items-center justify-center select-none"
          onMouseDown={startResizing}
          title="Drag to resize sidebar"
        >
          <div className="w-[2px] h-12 rounded-full bg-zinc-300 dark:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
        </div>
      )}

      <ViewerHeader
        viewMode={viewMode}
        setViewMode={setViewMode}
        openTabs={openTabs}
        activeTabId={activeTabId}
        setActiveTabId={setActiveTabId}
        openSections={openSections}
        setOpenSections={setOpenSections}
        isMaximized={isMaximized}
        onToggle={onToggle}
        handleToggleMaximize={handleToggleMaximize}
        handleCloseTab={handleCloseTab}
      />


      {/* Main Content Body */}
      {viewMode === 'explorer' ? (
        <ExplorerPanel
          artifacts={artifacts}
          effectiveTasks={effectiveTasks}
          openSections={openSections}
          toggleSection={toggleSection}
          expandedSection={expandedSection}
          setExpandedSection={setExpandedSection}
          artifactFilter={artifactFilter}
          setArtifactFilter={setArtifactFilter}
          taskFilter={taskFilter}
          setTaskFilter={setTaskFilter}
          openFileTab={openFileTab}
          openTerminalTab={openTerminalTab}
          handleKillTask={handleKillTask}
          handleKillAllTasks={handleKillAllTasks}
        />
      ) : !activeTab ? (
        <ViewerEmptyState setViewMode={setViewMode} />
      ) : (
        <div className="flex-1 overflow-hidden flex flex-col bg-card text-card-foreground">
          <FileBreadcrumbBar
            path={activeTab?.path || activeTab?.title || ''}
            type={activeTab?.type}
            onSegmentClick={() => setViewMode('explorer')}
            actions={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="p-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white bg-transparent hover:bg-transparent transition-colors duration-100 cursor-pointer outline-none"
                    title="More options"
                    aria-label="More options"
                  >
                    <MoreVertical size={13} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 bg-white dark:bg-[#18181a] border border-zinc-200 dark:border-white/[0.08] shadow-xl p-1 rounded-xl">
                  <DropdownMenuItem
                    onClick={() => {
                      if (activeTab) {
                        navigator.clipboard.writeText(tabContent[activeTab.id] || '');
                      }
                    }}
                    className="text-xs gap-2 cursor-pointer rounded-lg py-1.5"
                  >
                    <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>Copy Content</span>
                  </DropdownMenuItem>

                  {activeTab?.path && (
                    <DropdownMenuItem
                      onClick={() => {
                        navigator.clipboard.writeText(activeTab.path!);
                      }}
                      className="text-xs gap-2 cursor-pointer rounded-lg py-1.5"
                    >
                      <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>Copy Path</span>
                    </DropdownMenuItem>
                  )}

                  {activeTab?.path && (
                    <DropdownMenuItem
                      onClick={() => {
                        window.open(`${BASE_URL}/files/content?path=${encodeURIComponent(activeTab.path!)}&raw=true`, '_blank');
                      }}
                      className="text-xs gap-2 cursor-pointer rounded-lg py-1.5"
                    >
                      <Download className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>Download / Open Raw</span>
                    </DropdownMenuItem>
                  )}

                  <DropdownMenuSeparator className="my-1 bg-zinc-200 dark:bg-white/[0.06]" />

                  <DropdownMenuItem
                    onClick={(e) => {
                      if (activeTab) {
                        handleCloseTab(e as any, activeTab.id);
                      }
                    }}
                    className="text-xs gap-2 cursor-pointer rounded-lg py-1.5 text-red-500 hover:text-red-600 focus:text-red-600"
                  >
                    <X className="h-3.5 w-3.5" />
                    <span>Close Tab</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }
          />

          {/* Safe File Viewer Body */}
          <div className="flex-1 overflow-hidden bg-card">
            {activeTab?.type === 'terminal' ? (
              <TerminalViewer
                activeTab={activeTab}
                terminalStatuses={terminalStatuses}
                tabContent={tabContent}
                handleKillTask={handleKillTask}
                terminalPreRef={terminalPreRef}
              />
            ) : (
              <ErrorBoundary scope="safe-file-viewer">
                <SafeFileViewer
                  filename={activeTab?.title || ''}
                  path={activeTab?.path}
                  sessionId={sessionId}
                  content={activeTab ? tabContent[activeTab.id] || '' : ''}
                  isLoading={isLoadingContent}
                  viewMode={fileViewMode}
                  onViewModeChange={setFileViewMode}
                  hideToolbar={true}
                />
              </ErrorBoundary>
            )}
          </div>
        </div>
      )}
      </div>
    </TooltipProvider>
  );
}
