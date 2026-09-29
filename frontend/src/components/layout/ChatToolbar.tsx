"use client";

// Row-2 toolbar above the chat canvas: logo cluster (when sidebar closed),
// back/forward, session breadcrumb, right-panel toggle.
// Pure presentation — all behavior arrives via callbacks.
import { PanelLeft, PanelRight, Sparkles } from 'lucide-react';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { generateCleanSessionTitle } from '@/utils/sessionTitle';

interface ChatToolbarProps {
  isSidebarOpen: boolean;
  onOpenSidebar: () => void;
  isRightSidebarOpen: boolean;
  onOpenRightSidebar: () => void;
  isHistoryActive: boolean;
  sessionRepo: string;
  sessionTitle: string;
  selectedSessionId: string | null;
}

export function ChatToolbar({
  isSidebarOpen,
  onOpenSidebar,
  isRightSidebarOpen,
  onOpenRightSidebar,
  isHistoryActive,
  sessionRepo,
  sessionTitle,
  selectedSessionId,
}: ChatToolbarProps) {
  const isProjectSession = Boolean(sessionRepo && sessionRepo !== 'No Repo' && sessionRepo !== 'Mash');
  const cleanTitle = selectedSessionId
    ? generateCleanSessionTitle(sessionTitle || '', selectedSessionId)
    : (sessionTitle || 'New Conversation');

  return (
    <div className="h-9 bg-[#121214] border-b border-zinc-200/70 dark:border-white/[0.06] flex items-center justify-between px-3 select-none shrink-0 z-40 transition-all">
                <div className="flex items-center h-full min-w-0 flex-1">
                  {/* When Left Sidebar is CLOSED: show Logo and PanelLeft here */}
                  {!isSidebarOpen && (
                    <div className="flex items-center gap-1.5 shrink-0 mr-3">
                      <div className="w-5 h-5 rounded-md bg-zinc-800 text-zinc-100 flex items-center justify-center font-bold text-[11px] shadow-xs select-none mr-1">
                        M
                      </div>
                      <button
                        type="button"
                        onClick={onOpenSidebar}
                        className="p-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors cursor-pointer"
                        title="Expand sidebar"
                      >
                        <PanelLeft size={15} />
                      </button>
                    </div>
                  )}

                  {/* Breadcrumb: Aligned directly above the chat canvas */}
                  <div className="flex items-center min-w-0 flex-1 pl-1">
                    <Breadcrumb className="min-w-0">
                      <BreadcrumbList className="gap-1.5 sm:gap-2 flex-nowrap overflow-hidden">
                        {isHistoryActive ? (
                          <BreadcrumbItem className="min-w-0">
                            <BreadcrumbPage className="font-medium text-xs text-zinc-200 truncate">
                              History
                            </BreadcrumbPage>
                          </BreadcrumbItem>
                        ) : (
                          <>
                            {isProjectSession && (
                              <>
                                <BreadcrumbItem className="shrink-0">
                                  <span className="text-zinc-400 font-normal text-xs">
                                    {sessionRepo}
                                  </span>
                                </BreadcrumbItem>
                                <BreadcrumbSeparator className="shrink-0 text-zinc-600" />
                              </>
                            )}
                            <BreadcrumbItem className="min-w-0">
                              {!selectedSessionId ? (
                                <BreadcrumbPage className="font-medium text-xs text-zinc-200 flex items-center gap-1.5 truncate">
                                  <Sparkles size={11} className="text-sky-400 shrink-0" />
                                  <span className="truncate">New Conversation</span>
                                </BreadcrumbPage>
                              ) : (
                                <BreadcrumbPage className="font-medium text-xs text-zinc-200 truncate max-w-[280px] sm:max-w-[450px]">
                                  {cleanTitle}
                                </BreadcrumbPage>
                              )}
                            </BreadcrumbItem>
                          </>
                        )}
                      </BreadcrumbList>
                    </Breadcrumb>
                  </div>
                </div>

                {/* Right Toggle Button: ONLY visible when right sidebar is closed! */}
                {!isRightSidebarOpen && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={onOpenRightSidebar}
                      className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors cursor-pointer"
                      title="Expand right panel"
                    >
                      <PanelRight size={15} />
                    </button>
                  </div>
                )}
              </div>
  );
}
