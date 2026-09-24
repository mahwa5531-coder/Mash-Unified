"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo, MouseEvent as ReactMouseEvent } from 'react';
import { 
  ChevronDown, ChevronRight, FileText, 
  BookOpen, X,
  Terminal, RefreshCw, Maximize2, Minimize2,
  StopCircle, Loader2,
  MoreVertical, Copy, Image as ImageIcon,
  CheckCircle2, Clock, Download, Code,
  FolderKanban, Search, FileSpreadsheet,
  PanelRight, FileCode, Menu
} from 'lucide-react';
import SafeFileViewer from './SafeFileViewer';
import { ErrorBoundary } from './ErrorBoundary';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from './ui/dropdown-menu';
import { 
  fetchFileContent, 
  getFileContentFromCache,
  fetchTaskLog, 
  fetchSessionArtifacts,
  fetchBackgroundTasks,
  killBackgroundTask,
  ArtifactFileItem,
  BackgroundTaskItem,
  BASE_URL
} from '../utils/apiClient';

export interface RightSidebarProps {
  onToggle: () => void;
  fileToOpen?: string | null;
  onFileOpened?: () => void;
  sessionId?: string;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
}

interface TabItem {
  id: string;
  title: string;
  type: 'file' | 'terminal' | 'image';
  path?: string;
}

function formatArtifactTitle(name: string): string {
  const clean = name.replace(/^scratch\//i, '').replace(/\.(md|markdown|txt|py|ts|tsx|js|json|sql|sh)$/i, '');
  const words = clean.replace(/[_-]+/g, ' ').trim();
  return words.replace(/\b\w/g, (c) => c.toUpperCase()) || name;
}

const UNSUPPORTED_DOC_REGEX = /\.(docx|doc|pptx|ppt|zip|tar|gz|7z|rar|exe|bin|iso|dmg|dll|so|dylib)$/i;

function getArtifactIcon(item: ArtifactFileItem) {
  const lower = item.name.toLowerCase();
  if (/\.pdf$/i.test(lower)) {
    return <FileText size={14} className="text-red-400 group-hover:text-red-300 shrink-0" />;
  }
  if (/\.(png|jpg|jpeg|svg|gif|webp|ico|bmp)$/i.test(lower)) {
    return <ImageIcon size={14} className="text-purple-400 group-hover:text-purple-300 shrink-0" />;
  }
  if (/\.(xlsx|xls|csv|xlsm)$/i.test(lower)) {
    return <FileSpreadsheet size={14} className="text-emerald-400 group-hover:text-emerald-300 shrink-0" />;
  }
  if (lower.includes('walkthrough')) {
    return <BookOpen size={14} className="text-muted-foreground group-hover:text-foreground shrink-0" />;
  }
  if (/\.(py|ts|tsx|js|sql|sh|ps1)$/.test(lower) || item.type === 'code' || item.name.startsWith('scratch/')) {
    return <Code size={14} className="text-muted-foreground group-hover:text-foreground shrink-0" />;
  }
  return <FileText size={14} className="text-muted-foreground group-hover:text-foreground shrink-0" />;
}

interface CollapsibleSectionProps {
  title: string;
  count: number;
  isOpen: boolean;
  onToggle: () => void;
  rightAction?: React.ReactNode;
  children: React.ReactNode;
}

function CollapsibleSection({ title, count, isOpen, onToggle, rightAction, children }: CollapsibleSectionProps) {
  return (
    <div className="mb-3">
      <div 
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        className="flex items-center justify-between py-1.5 px-2 cursor-pointer select-none group focus:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-md hover:bg-muted/50 transition-colors"
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <div className="flex items-center gap-2">
          <ChevronDown 
            size={12} 
            className={`text-muted-foreground group-hover:text-foreground transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`} 
          />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-foreground transition-colors">
            {title}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {rightAction && (
            <div onClick={(e) => e.stopPropagation()}>
              {rightAction}
            </div>
          )}
          <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-mono font-normal">
            {count}
          </Badge>
        </div>
      </div>
      {isOpen && (
        <div className="flex flex-col space-y-0.5 mt-1">
          {children}
        </div>
      )}
    </div>
  );
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
  // Accordion Sections State
  const [openSections, setOpenSections] = useState({
    artifacts: true,
    backgroundTasks: true,
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

  useEffect(() => {
    const interval = setInterval(loadTasks, 2500);
    return () => clearInterval(interval);
  }, [loadTasks]);

  // Active background tasks
  const effectiveTasks = useMemo(() => {
    return backgroundTasks;
  }, [backgroundTasks]);

  // Kill individual task
  const handleKillTask = async (e: ReactMouseEvent, pid: number) => {
    e.stopPropagation();
    try {
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
    for (const t of running) {
      await killBackgroundTask(t.pid);
    }
    loadTasks();
  };

  // Drag Resizing logic
  const sidebarRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef(DEFAULT_WIDTH);

  const startResizing = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || isMaximized) return;
      let newWidth = window.innerWidth - e.clientX;
      if (newWidth < MIN_WIDTH) newWidth = MIN_WIDTH;
      const safeMax = Math.max(MIN_WIDTH, window.innerWidth - 420);
      if (newWidth > Math.min(MAX_WIDTH, safeMax)) newWidth = Math.min(MAX_WIDTH, safeMax);
      widthRef.current = newWidth;
      if (sidebarRef.current) {
        sidebarRef.current.style.width = `${newWidth}px`;
      }
    };

    const handleMouseUp = () => {
      if (isResizing) {
        setWidth(widthRef.current);
      }
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
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

    // Fetch content dynamically for text/code/data files (skip images, PDFs, and unsupported docs which use direct viewers/fallback cards)
    if (!isImg && !isPdf && !isUnsupported) {
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

  // Automatically hydrate content for active file tab from cache or backend
  useEffect(() => {
    if (activeTab && activeTab.type === 'file' && activeTab.path) {
      const isPdf = /\.pdf$/i.test(activeTab.path);
      const isUnsupported = UNSUPPORTED_DOC_REGEX.test(activeTab.path);
      if (isPdf || isUnsupported) return; // PDFs render in iframe directly, unsupported docs show fallback download card

      const tabId = activeTab.id;
      if (tabContent[tabId] === undefined) {
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
  }, [activeTab, tabContent, sessionId]);

  const [terminalStatuses, setTerminalStatuses] = useState<Record<string, 'running' | 'completed' | 'failed'>>({});
  const terminalPreRef = useRef<HTMLPreElement>(null);

  // Auto-scroll terminal on new streamed output
  useEffect(() => {
    if (activeTab?.type === 'terminal' && terminalPreRef.current) {
      terminalPreRef.current.scrollTop = terminalPreRef.current.scrollHeight;
    }
  }, [activeTab, tabContent]);

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
    if (activeTab.type === 'terminal') return ['Terminal', activeTab.title];
    if (activeTab.type === 'image') return ['Uploads', activeTab.title];
    return ['Artifacts', formatArtifactTitle(activeTab.title)];
  }, [activeTab]);

  // Filtered lists for inline search
  const filteredArtifacts = useMemo(() => {
    if (!artifactFilter.trim()) return artifacts;
    const q = artifactFilter.toLowerCase().trim();
    return artifacts.filter(a => a.name.toLowerCase().includes(q) || formatArtifactTitle(a.name).toLowerCase().includes(q));
  }, [artifacts, artifactFilter]);

  const filteredTasks = useMemo(() => {
    if (!taskFilter.trim()) return effectiveTasks;
    const q = taskFilter.toLowerCase().trim();
    return effectiveTasks.filter(t => (t.command || '').toLowerCase().includes(q));
  }, [effectiveTasks, taskFilter]);

  // Slice lists for "See all"
  const displayedArtifacts = useMemo(() => {
    if (expandedSection.artifacts) return filteredArtifacts;
    return filteredArtifacts.slice(0, 5);
  }, [filteredArtifacts, expandedSection.artifacts]);

  const displayedTasks = useMemo(() => {
    if (expandedSection.tasks) return filteredTasks;
    return filteredTasks.slice(0, 5);
  }, [filteredTasks, expandedSection.tasks]);

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

      {/* Row 1: Top Header & Tabs Bar (height h-9 = 36px, matching Row 2 of window) */}
      <div className="h-9 bg-[#121214] border-b border-zinc-200/70 dark:border-white/[0.06] flex items-center justify-between px-2 shrink-0 w-full overflow-hidden select-none">
        {/* Left: Quick Navigation Icons + Divider */}
        <div className="flex items-center space-x-1 shrink-0 mr-1.5">
          {/* Artifacts & Overview Icon */}
          <button
            type="button"
            onClick={() => {
              setViewMode('explorer');
              setOpenSections(prev => ({ ...prev, artifacts: true }));
            }}
            className={`p-1.5 rounded-md transition-colors cursor-pointer ${
              viewMode === 'explorer' 
                ? 'text-zinc-100 bg-white/[0.08]' 
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
            }`}
            title="Artifacts & Files"
          >
            <FileText size={14} />
          </button>

          {/* Documents / Code Editor Switch Icon */}
          <button
            type="button"
            onClick={() => {
              if (openTabs.length > 0) {
                setViewMode('editor');
              }
            }}
            className={`p-1.5 rounded-md transition-colors cursor-pointer ${
              viewMode === 'editor' && activeTab?.type !== 'terminal'
                ? 'text-zinc-100 bg-white/[0.08]' 
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
            }`}
            title="Code / Document Viewer"
          >
            <FileCode size={14} />
          </button>

          {/* Terminal Icon */}
          <button
            type="button"
            onClick={() => {
              if (effectiveTasks.length > 0) {
                const t = effectiveTasks[0];
                openTerminalTab(String(t.pid), t.command || 'Terminal');
              } else {
                openTerminalTab('active', 'Terminal');
              }
            }}
            className={`p-1.5 rounded-md transition-colors cursor-pointer ${
              activeTab?.type === 'terminal' && viewMode === 'editor'
                ? 'text-zinc-100 bg-white/[0.08]' 
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
            }`}
            title="Terminal"
          >
            <Terminal size={14} />
          </button>

          {/* Vertical subtle divider */}
          <div className="h-3.5 w-[1px] bg-zinc-700/60 mx-1 shrink-0" />
        </div>

        {/* Center: Open File Tabs (Pill style with X close button) */}
        <div className="flex-1 flex items-center gap-1.5 overflow-x-auto no-scrollbar h-full shrink min-w-0 py-1">
          {openTabs.map(tab => {
            const isActive = activeTabId === tab.id && viewMode === 'editor';
            return (
              <div 
                key={tab.id}
                onClick={() => { setActiveTabId(tab.id); setViewMode('editor'); }}
                className={`flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-md text-[11.5px] transition-all cursor-pointer select-none max-w-[220px] shrink-0 font-medium group/tab ${
                  isActive 
                    ? 'bg-zinc-800 text-zinc-100 border border-white/[0.08] shadow-xs' 
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                {/* Logo / M symbol icon matching image: M with arrow down */}
                <span className="text-[11px] font-bold text-sky-400 shrink-0 select-none">M↓</span>
                <span className="truncate italic font-medium flex-1">{formatArtifactTitle(tab.title)}</span>
                <button
                  type="button"
                  onClick={(e) => handleCloseTab(e, tab.id)}
                  className="p-0.5 ml-0.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-white/10 opacity-70 group-hover/tab:opacity-100 transition-opacity cursor-pointer shrink-0"
                  title="Close tab"
                  aria-label={`Close ${tab.title}`}
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
          {openTabs.length === 0 && (
            <span className="text-[11px] text-zinc-500 italic truncate select-none">No file open</span>
          )}
        </div>

        {/* Right: Maximize Button beside Toggle Button */}
        <div className="flex items-center gap-1 shrink-0 ml-1.5">
          {/* Maximize Button */}
          <button
            type="button"
            onClick={handleToggleMaximize}
            className={`p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors cursor-pointer ${
              isMaximized ? 'text-zinc-100' : ''
            }`}
            title={isMaximized ? 'Restore sidebar width' : 'Maximize'}
          >
            {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>

          {/* Right Sidebar Toggle Button */}
          <button
            type="button"
            onClick={onToggle}
            className="p-1.5 rounded-md text-zinc-100 bg-white/[0.08] hover:bg-white/[0.12] transition-colors cursor-pointer"
            title="Collapse sidebar"
          >
            <PanelRight size={15} />
          </button>
        </div>
      </div>

      {/* Main Content Body */}
      {viewMode === 'explorer' ? (
        <div className="flex-1 py-3 px-3 flex flex-col overflow-y-auto custom-scrollbar bg-card">
          
          {/* Section 1: Artifacts */}
          <CollapsibleSection 
            title="Artifacts" 
            count={artifacts.length} 
            isOpen={openSections.artifacts} 
            onToggle={() => toggleSection('artifacts')}
          >
            {/* Inline search filter when expanded */}
            {expandedSection.artifacts && artifacts.length > 5 && (
              <div className="relative mb-1.5 px-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  type="text"
                  value={artifactFilter}
                  onChange={(e) => setArtifactFilter(e.target.value)}
                  placeholder="Filter artifacts..."
                  className="h-7 pl-8 pr-7 text-xs bg-muted/40 border border-zinc-200/70 dark:border-white/[0.06] focus-visible:bg-background"
                />
                {artifactFilter && (
                  <button 
                    type="button" 
                    onClick={() => setArtifactFilter('')} 
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}

            {displayedArtifacts.length === 0 ? (
              <div className="text-[12px] text-muted-foreground py-1.5 px-2 italic">
                {artifactFilter ? 'No matching artifacts' : 'No artifacts generated yet'}
              </div>
            ) : (
              <>
                {displayedArtifacts.map((item, idx) => {
                  const isExcel = /\.(xlsx|xls|csv|xlsm)$/i.test(item.name);
                  return (
                    <div 
                      key={idx}
                      onClick={() => openFileTab(item.name, item.path)}
                      className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-muted/60 cursor-pointer text-muted-foreground hover:text-foreground transition-colors text-[13px] font-normal group"
                      title={item.path || item.name}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        {getArtifactIcon(item)}
                        <span className="truncate font-normal flex-1">{formatArtifactTitle(item.name)}</span>
                      </div>
                      {isExcel && (
                        <a
                          href={`${BASE_URL}/files/content?path=${encodeURIComponent(item.path || item.name)}&raw=true`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-emerald-500 transition-opacity p-0.5"
                          title="Download spreadsheet to open in Microsoft Excel"
                        >
                          <Download size={12} />
                        </a>
                      )}
                    </div>
                  );
                })}

                {/* See all (N) link */}
                {artifacts.length > 5 && (
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedSection(prev => ({ ...prev, artifacts: !prev.artifacts }));
                      if (expandedSection.artifacts) setArtifactFilter('');
                    }}
                    className="py-1.5 px-2 text-[12px] text-muted-foreground hover:text-foreground text-left transition-colors font-normal select-none"
                  >
                    {expandedSection.artifacts ? 'Show less' : `See all (${artifacts.length})`}
                  </button>
                )}
              </>
            )}
          </CollapsibleSection>

          {/* Section 2: Background Tasks */}
          <CollapsibleSection 
            title="Background Tasks" 
            count={effectiveTasks.length} 
            isOpen={openSections.backgroundTasks} 
            onToggle={() => toggleSection('backgroundTasks')}
            rightAction={
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleKillAllTasks}
                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  >
                    <StopCircle className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left" className="text-xs">
                  Stop all tasks
                </TooltipContent>
              </Tooltip>
            }
          >
            {/* Inline search filter when expanded */}
            {expandedSection.tasks && effectiveTasks.length > 5 && (
              <div className="relative mb-1.5 px-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  type="text"
                  value={taskFilter}
                  onChange={(e) => setTaskFilter(e.target.value)}
                  placeholder="Filter tasks..."
                  className="h-7 pl-8 pr-7 text-xs bg-muted/40 border border-zinc-200/70 dark:border-white/[0.06] focus-visible:bg-background"
                />
                {taskFilter && (
                  <button 
                    type="button" 
                    onClick={() => setTaskFilter('')} 
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}

            {displayedTasks.length === 0 ? (
              <div className="text-[12px] text-muted-foreground py-1.5 px-2 italic">
                {taskFilter ? 'No matching tasks' : 'No background tasks'}
              </div>
            ) : (
              <>
                {displayedTasks.map((t) => {
                  const isRunning = t.status === 'running';
                  const isTimer = t.command.toLowerCase().startsWith('timer');
                  return (
                    <div 
                      key={t.pid}
                      onClick={() => openTerminalTab(t.pid.toString(), t.command || `Task ${t.pid}`)}
                      className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-muted/60 transition-colors cursor-pointer group"
                    >
                      <div className="flex items-center min-w-0 flex-1 mr-2">
                        {isRunning ? (
                          <Loader2 size={14} className="mr-2.5 animate-spin text-muted-foreground shrink-0" />
                        ) : isTimer ? (
                          <Clock size={14} className="mr-2.5 text-muted-foreground shrink-0" />
                        ) : (
                          <CheckCircle2 size={14} className="mr-2.5 text-muted-foreground shrink-0" />
                        )}
                        <span className={`font-mono text-[12.5px] truncate ${
                          isRunning ? 'text-foreground font-medium' : 'text-muted-foreground font-normal group-hover:text-foreground'
                        }`}>
                          {t.command || `Task ${t.pid}`}
                        </span>
                      </div>
                      <div className="shrink-0">
                        {isRunning && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={(e) => handleKillTask(e, t.pid)}
                                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                              >
                                <StopCircle className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="text-xs">
                              Kill task
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* See all (N) link */}
                {effectiveTasks.length > 5 && (
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedSection(prev => ({ ...prev, tasks: !prev.tasks }));
                      if (expandedSection.tasks) setTaskFilter('');
                    }}
                    className="py-1.5 px-2 text-[12px] text-muted-foreground hover:text-foreground text-left transition-colors font-normal select-none"
                  >
                    {expandedSection.tasks ? 'Show less' : `See all (${effectiveTasks.length})`}
                  </button>
                )}
              </>
            )}
          </CollapsibleSection>

        </div>
      ) : !activeTab ? (
        /* Empty State when no tab is open */
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-card select-none">
          <div className="w-10 h-10 rounded-xl bg-muted/50 border border-border/40 flex items-center justify-center mb-3 text-muted-foreground shadow-2xs">
            <FileText size={18} />
          </div>
          <div className="text-xs font-medium text-foreground mb-1">No file selected</div>
          <p className="text-[11.5px] text-muted-foreground max-w-[220px] mb-4 leading-relaxed">
            Select an artifact or click a file link in chat to preview here.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setViewMode('explorer')}
            className="h-7 text-xs border-border/60 hover:bg-muted/60"
          >
            Browse Artifacts & Tasks
          </Button>
        </div>
      ) : (
        /* Editor / Viewer View (SafeFileViewer / Terminal / Image Preview) */
        <div className="flex-1 overflow-hidden flex flex-col bg-card text-card-foreground">
          {/* Row 2: Sub-header Toolbar (Breadcrumb until half + Preview/Raw sliding pill + 3-dots + Menu) */}
          <div className="h-8 bg-zinc-900/30 border-b border-zinc-200/70 dark:border-white/[0.06] flex items-center justify-between px-3 select-none shrink-0 text-xs">
            {/* Left: Breadcrumb (until half) */}
            <div className="flex items-center gap-1.5 min-w-0 max-w-[50%] overflow-hidden text-zinc-400 text-[11.5px]">
              <span 
                onClick={() => setViewMode('explorer')}
                className="hover:text-zinc-200 cursor-pointer shrink-0"
              >
                Mash
              </span>
              <span className="text-zinc-600 shrink-0">&gt;</span>
              <span className="text-[11px] font-bold text-sky-400 shrink-0 select-none">M↓</span>
              <span className="text-zinc-200 font-medium truncate">
                {activeTab ? activeTab.title : 'Overview'}
              </span>
            </div>

            {/* Right: Preview / Raw sliding pill + 3 dots menu + list icon */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Segmented Pill for Preview | Raw */}
              <div className="flex items-center bg-zinc-950/80 border border-white/[0.08] rounded-md p-0.5 shadow-2xs">
                <button
                  type="button"
                  onClick={() => setFileViewMode('preview')}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                    fileViewMode === 'preview' 
                      ? 'bg-zinc-800 text-zinc-100 shadow-xs' 
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => setFileViewMode('raw')}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                    fileViewMode === 'raw' 
                      ? 'bg-zinc-800 text-zinc-100 shadow-xs' 
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Raw
                </button>
              </div>

              {/* 3-dots Dropdown Menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] transition-colors cursor-pointer"
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
                    onClick={() => {
                      if (activeTab) {
                        handleCloseTab({ stopPropagation: () => {} } as any, activeTab.id);
                      }
                    }}
                    className="text-xs gap-2 cursor-pointer rounded-lg py-1.5 text-red-500 hover:text-red-600 focus:text-red-600"
                  >
                    <X className="h-3.5 w-3.5" />
                    <span>Close Tab</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Menu / list icon */}
              <button
                type="button"
                onClick={() => setViewMode(prev => prev === 'explorer' ? 'editor' : 'explorer')}
                className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] transition-colors cursor-pointer"
                title="Toggle artifacts overview"
              >
                <Menu size={13} />
              </button>
            </div>
          </div>

          {/* Safe File Viewer Body */}
          <div className="flex-1 overflow-hidden bg-card">
            {activeTab?.type === 'terminal' ? (
              <div className="flex flex-col h-full bg-zinc-950 overflow-hidden text-zinc-100">
                <div className="px-3 py-2 border-b border-zinc-800 bg-zinc-950 text-[11px] font-mono text-zinc-400 flex items-center justify-between">
                  <span>Terminal Process Output</span>
                  <span className={`flex items-center gap-1.5 ${
                    (terminalStatuses[activeTab.id] || 'running') === 'running' 
                      ? 'text-emerald-400' 
                      : (terminalStatuses[activeTab.id] === 'failed' ? 'text-red-400' : 'text-zinc-400')
                  }`}>
                    {(terminalStatuses[activeTab.id] || 'running') === 'running' && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    )}
                    {(terminalStatuses[activeTab.id] || 'running') === 'running' ? 'Running' : (terminalStatuses[activeTab.id] === 'failed' ? 'Failed' : 'Completed')}
                  </span>
                </div>
                <pre ref={terminalPreRef} className="p-4 overflow-auto custom-scrollbar font-mono text-[12px] leading-relaxed text-zinc-300 whitespace-pre flex-1">
                  {tabContent[activeTab?.id || ''] || '// Waiting for process output...'}
                </pre>
              </div>
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
