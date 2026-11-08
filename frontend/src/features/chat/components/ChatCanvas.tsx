"use client";

import { useState, useRef, useEffect, useCallback, memo, useMemo } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import ChatComposer from '@/features/chat/components/ChatComposer';
import { QuotaBanner, InvalidMediaBanner } from '@/primitives';
import { classifyError } from '@/lib/errorClassification';
import UserMessage from '@/features/chat/components/messages/UserMessage';
import AssistantMessage from '@/features/chat/components/messages/AssistantMessage';
import { ScrollToBottomButton } from '@/features/chat/components/ScrollToBottomButton';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useChatStream } from '@/features/chat/hooks/useChatStream';
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

// Module-level stable empty array prevents breaking AssistantMessage memo on every token
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
}: MountedTurnRowProps) {
  const isSyntheticContext = turn.userMsg.content === '[Earlier Context]';
  const turnIdx = turn.turnIndex ?? globalTurnIdx;

  const handleRetry = useCallback(() => {
    onRetryTurn(turn.userMsg.content, turn.userMsg.sessionId);
  }, [onRetryTurn, turn.userMsg.content, turn.userMsg.sessionId]);

  const handleUndo = useCallback(() => {
    onUndo(turn.flatIdx, turn.userMsg.content, turnIdx, turn.turnId);
  }, [onUndo, turn.flatIdx, turn.userMsg.content, turnIdx, turn.turnId]);

  return (
    <TurnViewportProvider isNearViewport={true}>
      <div 
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
}, (prev, next) => {
  return prev.turn === next.turn &&
         prev.isLastTurn === next.isLastTurn &&
         prev.isStreaming === next.isStreaming &&
         prev.globalTurnIdx === next.globalTurnIdx &&
         prev.turnKey === next.turnKey &&
         prev.artifactsByTurnMsg === next.artifactsByTurnMsg;
});

// Module-hoisted Virtuoso footer prevents component re-creation and DOM remounts on every render frame
const VirtuosoFooter = memo(function VirtuosoFooter() {
  return <div className="max-w-3xl mx-auto w-full pb-6 px-4 sm:px-6" aria-hidden="true" />;
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

  // Virtuoso ref for programmatic scrolling (e.g. scroll-to-bottom button)
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [firstItemIndex, setFirstItemIndex] = useState(100_000);
  const [hitBottom, setHitBottom] = useState(true);

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
    permissionMode,
  });

  const [isQueueExpanded, setIsQueueExpanded] = useState<boolean>(true);
  const [showQuotaBanner, setShowQuotaBanner] = useState<boolean>(false);
  const [showInvalidMediaBanner, setShowInvalidMediaBanner] = useState<boolean>(false);
  const [invalidMediaReason, setInvalidMediaReason] = useState<string>("Maximum number of attachments reached");

  // Reset state when session changes
  useEffect(() => {
    setFirstItemIndex(100_000);
    setShowQuotaBanner(false);
    setShowInvalidMediaBanner(false);
  }, [sessionId]);

  const handleRetryTurn = useCallback((content: string, sid?: string) => {
    retry(content, sid);
  }, [retry]);

  const scrollDomToBottom = useCallback(() => {
    setHitBottom(true);
    virtuosoRef.current?.scrollToIndex({
      index: turns.length - 1,
      align: 'end',
      behavior: 'smooth',
    });
  }, [turns.length]);

  // Immediate wheel & touch intent detection (inspired by assistant-ui useThreadViewportAutoScroll)
  // When the user scrolls upwards, immediately disconnect auto-follow to prevent
  // Virtuoso from snapping back down on streaming token flushes or tool renders.
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY < 0) {
      setHitBottom(false);
    }
  }, []);

  const touchStartYRef = useRef(0);
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    touchStartYRef.current = e.touches[0]?.clientY || 0;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const currentY = e.touches[0]?.clientY || 0;
    if (currentY > touchStartYRef.current + 6) {
      // Finger pulled downwards, which scrolls content upwards away from bottom
      setHitBottom(false);
    }
  }, []);

  const handleLoadEarlier = useCallback(async () => {
    if (isLoadingEarlier || !hasEarlierTurns) return;
    await loadEarlierTurns((prependedCount) => {
      setFirstItemIndex((prev) => prev - prependedCount);
    });
  }, [isLoadingEarlier, hasEarlierTurns, loadEarlierTurns]);

  const lastTurn = turns[turns.length - 1];
  const lastAiMsg = lastTurn?.aiMsgs[lastTurn.aiMsgs.length - 1];

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

  const handleEditQueued = (index = 0) => {
    const msg = queuedMessages?.[index] || queuedMessage;
    if (msg) {
      setInputPrompt(cleanUserPromptForComposer(msg));
      discardQueued(index);
    }
  };

  // Hoisted components with stable identity prevent Virtuoso from unmounting & remounting the Header/Footer on every streaming token flush
  const virtuosoComponents = useMemo(() => ({
    Header: function VirtuosoHeader() {
      return (
        <div className="max-w-3xl mx-auto w-full pt-2 px-4 sm:px-6">
          <ChatHistoryLoadState
            sessionId={sessionId}
            isHistoryLoaded={isHistoryLoaded}
            historyLoadError={historyLoadError}
            retryLoadHistory={retryLoadHistory}
          />
          {hasEarlierTurns && (
            <div className="flex justify-center -mt-1 -mb-1 pb-1.5 min-h-[24px]">
              {earlierLoadError ? (
                <button
                  type="button"
                  onClick={handleLoadEarlier}
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
        </div>
      );
    },
    Footer: VirtuosoFooter,
  }), [
    sessionId,
    isHistoryLoaded,
    historyLoadError,
    retryLoadHistory,
    hasEarlierTurns,
    earlierLoadError,
    isLoadingEarlier,
    handleLoadEarlier,
  ]);

  return (
    <div 
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      className="flex-1 min-w-0 min-h-0 bg-[var(--bg-app)] flex flex-col h-full overflow-hidden relative font-sans text-[var(--text-primary)] transition-colors"
    >
      
      {/* Main Chat Feed (Powered by react-virtuoso for zero-jank dynamic virtualization & prepending) */}
      {chatMessages.length === 0 ? (
        <div 
          ref={chatScrollContainerRef} 
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 sm:px-6 custom-scrollbar relative"
        >
          <div className="max-w-3xl mx-auto flex flex-col min-h-full pb-6 w-full">
            <ChatHistoryLoadState
              sessionId={sessionId}
              isHistoryLoaded={isHistoryLoaded}
              historyLoadError={historyLoadError}
              retryLoadHistory={retryLoadHistory}
            />
          </div>
        </div>
      ) : (
        <Virtuoso
          key={sessionId || 'default_session'}
          ref={virtuosoRef}
          data={turns}
          firstItemIndex={firstItemIndex}
          initialTopMostItemIndex={Math.max(0, turns.length - 1)}
          followOutput={hitBottom ? 'auto' : false}
          startReached={isStreaming ? undefined : handleLoadEarlier}
          computeItemKey={(_, turn) => turn.id || String(turn.flatIdx)}
          atBottomStateChange={setHitBottom}
          atBottomThreshold={40}
          increaseViewportBy={{ top: 1200, bottom: 1200 }}
          scrollerRef={(el) => {
            if (el instanceof HTMLElement) {
              el.style.overflowAnchor = 'none';
              (chatScrollContainerRef as any).current = el;
            }
          }}
          style={{ overflowX: 'hidden', overflowAnchor: 'none' }}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden [overflow-anchor:none] custom-scrollbar relative"
          components={virtuosoComponents}
          itemContent={(index, turn) => {
            const isLastTurn = index === turns.length - 1;
            const turnKey = turn.id || `turn_${turn.flatIdx}_${index}`;
            return (
              <div className="max-w-3xl mx-auto w-full py-1 px-4 sm:px-6">
                <MountedTurnRow
                  turn={turn}
                  turnKey={turnKey}
                  globalTurnIdx={index}
                  isLastTurn={isLastTurn}
                  isStreaming={isLastTurn && isStreaming}
                  artifactsByTurnMsg={artifactsByTurnMsg}
                  onOpenFile={onOpenFile}
                  onContinue={handleContinue}
                  onRetryTurn={handleRetryTurn}
                  onApproveTool={approveToolCall}
                  onUndo={undo}
                />
              </div>
            );
          }}
        />
      )}

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
