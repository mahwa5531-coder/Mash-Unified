"use client";

// Row-2 toolbar above the chat canvas: logo cluster (when sidebar closed),
// back/forward, session breadcrumb, right-panel toggle.
// Pure presentation — all behavior arrives via callbacks.
import { PanelLeft, PanelRight, Sparkles, ArrowRight } from 'lucide-react';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { generateCleanSessionTitle } from '@/utils/sessionTitle';
import { useDesktopAutoUpdate } from '@/hooks/useDesktopAutoUpdate';

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
  const { updateState, handleRestart } = useDesktopAutoUpdate();
  const isProjectSession = Boolean(sessionRepo && sessionRepo !== 'No Repo');
  const cleanTitle = selectedSessionId
    ? generateCleanSessionTitle(sessionTitle || '', selectedSessionId)
    : (sessionTitle || 'New Conversation');

  return (
    <div id="chat-top-toolbar" className="h-9 bg-[#121214] border-b border-zinc-200/70 dark:border-white/[0.06] flex items-center justify-between px-3 select-none shrink-0 z-40 transition-all">
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

                {/* Right Controls Container: Always visible in toolbar */}
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  {/* State A: Downloading Update (raw ghost text, zero badge, zero pill background, zero color) */}
                  {updateState.status === 'downloading' && (
                    <span
                      className="text-zinc-500 dark:text-zinc-400 font-mono text-[11px] leading-none select-none tracking-tight mr-1"
                      title="Downloading update..."
                    >
                      downloading....
                    </span>
                  )}

                  {/* State B: Ready to Restart (exact custom blue #2972BE capsule with right arrow) */}
                  {updateState.status === 'ready' && (
                    <button
                      type="button"
                      onClick={handleRestart}
                      className="group inline-flex items-center gap-1.5 h-5 px-2.5 rounded-full bg-[#2972BE] hover:bg-[#3180D2] active:bg-[#1E5691] text-white font-medium text-[11px] leading-none tracking-tight select-none shadow-xs transition-all cursor-pointer border border-[#4B90D6]/40 active:scale-[0.97]"
                      title="Click to restart and apply update"
                    >
                      <span>restart</span>
                      <ArrowRight size={10} className="shrink-0 transition-transform group-hover:translate-x-0.5" />
                    </button>
                  )}

                  {/* Right Toggle Button: ONLY visible when right sidebar is closed! */}
                  {!isRightSidebarOpen && (
                    <button
                      type="button"
                      onClick={onOpenRightSidebar}
                      className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors cursor-pointer"
                      title="Expand right panel"
                    >
                      <PanelRight size={15} />
                    </button>
                  )}
                </div>
              </div>
  );
}
