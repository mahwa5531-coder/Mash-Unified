"use client";

import { useState, useRef, useEffect, useCallback, memo } from 'react';
import ChatComposer from '@/features/chat/components/ChatComposer';
import { QuotaBanner, InvalidMediaBanner } from '@/primitives';
import { classifyError } from '@/lib/errorClassification';
import UserMessage from '@/features/chat/components/messages/UserMessage';
import AssistantMessage from '@/features/chat/components/messages/AssistantMessage';
import { ScrollToBottomButton } from '@/features/chat/components/ScrollToBottomButton';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useChatStream } from '@/features/chat/hooks/useChatStream';
import { useScrollToBottom } from '@/features/chat/hooks/useScrollToBottom';
import { useTurnViewportWindow } from '@/features/chat/hooks/useTurnViewportWindow';
import { useReverseInfiniteScroll } from '@/features/chat/hooks/useReverseInfiniteScroll';
import { TurnViewportProvider } from '@/features/chat/context/TurnViewportContext';
import type { Turn } from '@/types/chat';
import { ChatHeroView } from './ChatHeroView';
import { SteeringQueueBanner } from './SteeringQueueBanner';
import { ChatHistoryLoadState } from './ChatHistoryLoadState';
import { cleanUserPromptForComposer } from '@/features/chat/utils/sessionHistoryParser';
import { fetchSessionPermissions, updateSessionPermissionMode } from '@/services/sessions';
import type { PermissionMode } from './composer/PermissionModeSelector';

interface ChatCanvasProps {
  sessionId: string | null;
  sessionTitle: string;
  sessionRepo?: string;
  pendingWorkspacePath?: string | null;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  onSessionCreated: (newSessionId: string, title?: string, repoName?: string) => void;
  onSelectProject?: (repoName: string, folderPath?: string) => void;
  isRightSidebarOpen?: boolean;
  onToggleRightSidebar?: () => void;
  onOpenFile?: (path: string) => void;
  onOpenSettings?: (tab?: string) => void;
}

// ponytail: Module-level stable empty array prevents breaking AssistantMessage memo on every token
const EMPTY_ARTIFACTS: any[] = [];

interface MountedTurnRowProps {
  turn: Turn;
  turnKey: string;
  globalTurnIdx: number;
  isLastTurn: boolean;
  isStreaming: boolean;
  artifactsByTurnMsg: Map<string, any[]>;
  onOpenFile?: (path: string) => void;
  onContinue: () => void;
  onRetryTurn: (content: string, sid?: string) => void;
  onApproveTool?: (toolCallId: string, action: 'allow_once' | 'allow' | 'deny', feedback?: string) => Promise<boolean | void> | boolean | void;
  onUndo: (flatIdx: number, content: string, turnIdx?: number, turnId?: string) => void;
  onMeasureHeight: (turnKey: string, height: number) => void;
}

const MountedTurnRow = memo(function MountedTurnRow({
  turn,
  turnKey,
  globalTurnIdx,
  isLastTurn,
  isStreaming,
  artifactsByTurnMsg,
  onOpenFile,
  onContinue,
  onRetryTurn,
  onApproveTool,
  onUndo,
  onMeasureHeight,
}: MountedTurnRowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isSyntheticContext = turn.userMsg.content === '[Earlier Context]';
  const turnIdx = turn.turnIndex ?? globalTurnIdx;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (el.offsetHeight > 0) {
      onMeasureHeight(turnKey, el.offsetHeight);
    }

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const h = entry.borderBoxSize?.[0]?.blockSize ?? (entry.target as HTMLElement).offsetHeight;
          if (h > 0) {
            onMeasureHeight(turnKey, Math.round(h));
          }
        }
      });
      ro.observe(el);
      return () => ro.disconnect();
    }
  }, [turnKey, onMeasureHeight]);

  const handleRetry = useCallback(() => {
    onRetryTurn(turn.userMsg.content, turn.userMsg.sessionId);
  }, [onRetryTurn, turn.userMsg.content, turn.userMsg.sessionId]);

  const handleUndo = useCallback(() => {
    onUndo(turn.flatIdx, turn.userMsg.content, turnIdx, turn.turnId);
  }, [onUndo, turn.flatIdx, turn.userMsg.content, turnIdx, turn.turnId]);

  return (
    <TurnViewportProvider isNearViewport={true}>
      <div 
        ref={containerRef}
        className="flex flex-col w-full relative pb-3 border-b border-zinc-200/50 dark:border-white/[0.04] last:border-b-0 last:pb-1"
      >
        {!isSyntheticContext && (
          <div className="py-2.5">
            <UserMessage
              msg={turn.userMsg}
              onUndo={handleUndo}
              onOpenFile={onOpenFile}
            />
          </div>
        )}
        <div className={!isSyntheticContext ? "mt-1 px-1 sm:px-2 flex flex-col space-y-2.5" : "px-1 sm:px-2 flex flex-col space-y-2.5"}>
          {turn.aiMsgs.map((aiMsg, j) => {
            const isLastMsg = isLastTurn && j === turn.aiMsgs.length - 1;
            return (
              <ErrorBoundary key={`${turnKey}_ai_${j}`} scope="assistant-turn">
                <AssistantMessage
                  msg={aiMsg}
                  artifacts={artifactsByTurnMsg.get(`${turnIdx}_${j}`) || EMPTY_ARTIFACTS}
                  isLast={isLastMsg}
                  isStreaming={isLastMsg && isStreaming}
                  onOpenFile={onOpenFile}
                  onContinue={onContinue}
                  onRetry={handleRetry}
                  onApproveTool={onApproveTool}
                />
              </ErrorBoundary>
            );
          })}
        </div>
      </div>
    </TurnViewportProvider>
  );
});

export default function ChatCanvas({ 
  sessionId, sessionRepo, pendingWorkspacePath,
  onSessionCreated,
  onSelectProject,
  onOpenFile,
  onOpenSettings,
}: ChatCanvasProps) {
  const chatScrollContainerRef = useRef<HTMLDivElement>(null);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');
  const currentSessionIdRef = useRef(sessionId);
  currentSessionIdRef.current = sessionId;

  // Sync permissionMode from backend when viewing a session with stale-session guard and abort signal
  useEffect(() => {
    if (!sessionId) {
      setPermissionMode('default');
      return;
    }
    const ctrl = new AbortController();
    fetchSessionPermissions(sessionId, ctrl.signal).then((mode) => {
      if (mode && currentSessionIdRef.current === sessionId) {
        setPermissionMode(mode as PermissionMode);
      }
    });
    return () => ctrl.abort();
  }, [sessionId]);

  const handlePermissionModeChange = useCallback((newMode: PermissionMode) => {
    setPermissionMode(newMode);
    if (sessionId) {
      updateSessionPermissionMode(sessionId, newMode).catch(() => {});
    }
  }, [sessionId]);

  // Velocity-aware scroll retention hook (synchronous pin ref passed to stream flusher)
  const {
    autoScroll,
    hitBottom,
    isPinnedToBottomRef,
    scrollDomToBottom,
    onChatBodyScroll,
  } = useScrollToBottom(chatScrollContainerRef);

  const {
    chatMessages,
    inputPrompt,
    setInputPrompt,
    isStreaming,
    isHistoryLoaded,
    historyLoadError,
    retryLoadHistory,
    queuedMessages,
    queuedMessage,
    turns,
    artifactsByTurnMsg,
    send,
    stop,
    retry,
    undo,
    approveToolCall,
    injectQueued,
    discardQueued,
    isQueuePaused,
    resumeQueue,
    hasEarlierTurns,
    isLoadingEarlier,
    earlierLoadError,
    loadEarlierTurns,
  } = useChatStream({ 
    sessionId, 
    sessionRepo, 
    pendingWorkspacePath, 
    onSessionCreated,
    scrollContainerRef: chatScrollContainerRef,
    isPinnedToBottomRef,
    permissionMode,
  });

  const [isQueueExpanded, setIsQueueExpanded] = useState<boolean>(true);
  const [showQuotaBanner, setShowQuotaBanner] = useState<boolean>(false);
  const [showInvalidMediaBanner, setShowInvalidMediaBanner] = useState<boolean>(false);
  const [invalidMediaReason, setInvalidMediaReason] = useState<string>("Maximum number of attachments reached");

  // Milestone 1: Zero-dependency dynamic viewport windowing & DOM culling
  const {
    startIndex,
    endIndex,
    turnHeightCache,
    recordTurnHeight,
    estimateTurnHeight,
  } = useTurnViewportWindow({
    containerRef: chatScrollContainerRef,
    turns,
    isStreaming,
  });

  const handleRetryTurn = useCallback((content: string, sid?: string) => {
    retry(content, sid);
  }, [retry]);

  // Reset quota/media banners when session changes
  useEffect(() => {
    setShowQuotaBanner(false);
    setShowInvalidMediaBanner(false);
  }, [sessionId]);

  // Milestone 2: Seamless Reverse Infinite Scroll with Scroll-Anchoring
  const { topSentinelRef } = useReverseInfiniteScroll({
    containerRef: chatScrollContainerRef,
    hasEarlierTurns,
    isLoadingEarlier,
    loadEarlierTurns,
    turnsCount: turns.length,
  });

  const lastTurn = turns[turns.length - 1];
  const lastAiMsg = lastTurn?.aiMsgs[lastTurn.aiMsgs.length - 1];

  // Auto-scroll strictly to bottom when new turns arrive or streaming starts
  // (Token-by-token follow scroll is handled smoothly by useSseBufferFlusher at 60fps)
  useEffect(() => {
    if (autoScroll) {
      scrollDomToBottom();
    }
  }, [
    turns.length, 
    isStreaming, 
    autoScroll, 
    scrollDomToBottom,
  ]);

  // Trigger quota banner ONLY if backend/model returns a rate limit or quota exceeded error
  useEffect(() => {
    const classified = classifyError(lastAiMsg?.error);
    if (classified?.category === 'quota') {
      setShowQuotaBanner(true);
    }
  }, [lastAiMsg?.error]);

  const handleContinue = useCallback(() => {
    send(
      "Continue from where you were interrupted. Please pick up right where the previous step stopped without re-doing completed work."
    );
    scrollDomToBottom();
  }, [send, scrollDomToBottom]);

  const handleSend = useCallback((text: string, stagedSid?: string) => {
    send(text, false, false, stagedSid);
    scrollDomToBottom();
  }, [send, scrollDomToBottom]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    onChatBodyScroll(e.currentTarget);
  }, [onChatBodyScroll]);

  const handleEditQueued = (index = 0) => {
    const msg = queuedMessages?.[index] || queuedMessage;
    if (msg) {
      setInputPrompt(cleanUserPromptForComposer(msg));
      discardQueued(index);
    }
  };

  return (
    <div className="flex-1 min-w-0 min-h-0 bg-[var(--bg-app)] flex flex-col h-full overflow-hidden relative font-sans text-[var(--text-primary)] transition-colors">
      
      {/* Main Chat Feed (Scrollable) */}
      <div 
        ref={chatScrollContainerRef} 
        onScroll={handleScroll} 
        className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 custom-scrollbar relative"
      >
        <div className="max-w-3xl mx-auto flex flex-col min-h-full pb-6 w-full">
          
          <ChatHistoryLoadState
            sessionId={sessionId}
            isHistoryLoaded={isHistoryLoaded}
            historyLoadError={historyLoadError}
            retryLoadHistory={retryLoadHistory}
          />

          {/* Messages Feed */}
          {chatMessages.length > 0 && (
            <div className="flex flex-col pt-3 space-y-3.5">
              {/* Milestone 2: Top Sentinel for Reverse Infinite Scroll */}
              {hasEarlierTurns && (
                <div
                  ref={topSentinelRef}
                  className="flex justify-center -mt-1 -mb-1 pb-1.5 min-h-[24px]"
                  aria-hidden={!earlierLoadError}
                >
                  {earlierLoadError ? (
                    <button
                      type="button"
                      onClick={() => loadEarlierTurns()}
                      className="text-xs text-rose-500 hover:text-rose-600 dark:text-rose-400 dark:hover:text-rose-300 underline font-medium cursor-pointer py-1 px-2 rounded bg-rose-500/10 hover:bg-rose-500/20 transition-colors"
                    >
                      Failed to load earlier turns. Click to retry.
                    </button>
                  ) : isLoadingEarlier ? (
                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                      <div className="w-3.5 h-3.5 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
                      <span>Loading earlier turns...</span>
                    </div>
                  ) : null}
                </div>
              )}

              {turns.map((turn, i) => {
                const globalTurnIdx = i;
                const isLastTurn = globalTurnIdx === turns.length - 1;
                const turnKey = turn.id || `turn_${turn.flatIdx}_${globalTurnIdx}`;
                const isPinnedStreaming = isStreaming && isLastTurn;
                const isVisible = (i >= startIndex && i <= endIndex) || isPinnedStreaming;

                if (!isVisible) {
                  const cachedHeight = turnHeightCache.get(turnKey) || estimateTurnHeight(turn);
                  return (
                    <div
                      key={turnKey}
                      data-turn-idx={globalTurnIdx}
                      data-turn-culled="true"
                      style={{
                        height: `${cachedHeight}px`,
                        containIntrinsicSize: `auto ${cachedHeight}px`,
                        contentVisibility: 'auto',
                      }}
                      className="w-full shrink-0 border-b border-zinc-200/50 dark:border-white/[0.04]"
                      aria-hidden="true"
                    />
                  );
                }

                return (
                  <MountedTurnRow
                    key={turnKey}
                    turn={turn}
                    turnKey={turnKey}
                    globalTurnIdx={globalTurnIdx}
                    isLastTurn={isLastTurn}
                    isStreaming={isStreaming}
                    artifactsByTurnMsg={artifactsByTurnMsg}
                    onOpenFile={onOpenFile}
                    onContinue={handleContinue}
                    onRetryTurn={handleRetryTurn}
                    onApproveTool={approveToolCall}
                    onUndo={undo}
                    onMeasureHeight={recordTurnHeight}
                  />
                );
              })}

              {/* Terminal anchor for browser-native scroll-anchoring */}
              <div className="h-px shrink-0 w-full [overflow-anchor:auto]" aria-hidden="true" />
            </div>
          )}
        </div>
      </div>

      {/* Bottom Composer Dock */}
      <div className="shrink-0 w-full z-20 bg-transparent pb-3 px-4 sm:px-6 relative">
        <div className="max-w-3xl mx-auto w-full relative">

          <SteeringQueueBanner
            queuedMessages={queuedMessages}
            queuedMessage={queuedMessage}
            isQueueExpanded={isQueueExpanded}
            isPaused={isQueuePaused}
            onResumeQueue={resumeQueue}
            onToggleExpand={() => setIsQueueExpanded((prev) => !prev)}
            onInject={(idx) => injectQueued(idx ?? 0)}
            onEdit={(idx) => handleEditQueued(idx ?? 0)}
            onDiscard={(idx) => discardQueued(idx)}
          />

          {/* Floating Scroll-to-Bottom Button */}
          {!hitBottom && (
            <div className="absolute -top-11 left-1/2 -translate-x-1/2 pointer-events-auto z-30">
              <ScrollToBottomButton onClick={scrollDomToBottom} />
            </div>
          )}

          {/* Quota Banner */}
          {showQuotaBanner && (
            <div className="mb-2 w-full max-w-4xl mx-auto px-1">
              <QuotaBanner
                open={showQuotaBanner}
                onOpenChange={setShowQuotaBanner}
                onSeePlans={() => onOpenSettings?.('usage')}
                onDismiss={() => setShowQuotaBanner(false)}
              />
            </div>
          )}

          {/* Invalid Media Banner (Attachment Limit Exceeded) */}
          {showInvalidMediaBanner && (
            <div className="mb-2 w-full">
              <InvalidMediaBanner
                open={showInvalidMediaBanner}
                onOpenChange={setShowInvalidMediaBanner}
                description={invalidMediaReason}
                onDismiss={() => setShowInvalidMediaBanner(false)}
              />
            </div>
          )}

          {/* Left-aligned Project Scope Selector (Hero only: disappears on first message) */}
          {!sessionId && chatMessages.length === 0 && (
            <div className="w-full flex justify-start mb-1.5">
              <ChatHeroView
                selectedRepo={sessionRepo || 'No Repo'}
                pendingWorkspacePath={pendingWorkspacePath}
                onSelectProject={onSelectProject || (() => {})}
              />
            </div>
          )}

          <ChatComposer
            key={sessionId || 'new-session'}
            sessionId={sessionId}
            inputPrompt={inputPrompt}
            setInputPrompt={setInputPrompt}
            onSend={handleSend}
            onStop={stop}
            isStreaming={isStreaming}
            disabled={Boolean(sessionId && !isHistoryLoaded)}
            sessionRepo={sessionRepo}
            onInvalidMedia={(show, reason) => {
              setShowInvalidMediaBanner(show);
              if (reason) setInvalidMediaReason(reason);
              else setInvalidMediaReason("Maximum number of attachments reached");
            }}
            permissionMode={permissionMode}
            onPermissionModeChange={handlePermissionModeChange}
          />
        </div>
      </div>

    </div>
  );
}
