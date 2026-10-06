"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, History } from 'lucide-react';
import ChatComposer from '@/features/chat/components/ChatComposer';
import { QuotaBanner } from '@/primitives';
import { classifyError } from '@/lib/errorClassification';
import UserMessage from '@/features/chat/components/messages/UserMessage';
import AssistantMessage from '@/features/chat/components/messages/AssistantMessage';
import { ScrollToBottomButton } from '@/features/chat/components/ScrollToBottomButton';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useChatStream } from '@/features/chat/hooks/useChatStream';
import { useScrollToBottom } from '@/features/chat/hooks/useScrollToBottom';
import { ChatHeroView } from './ChatHeroView';
import { SteeringQueueBanner } from './SteeringQueueBanner';
import { ChatHistoryLoadState } from './ChatHistoryLoadState';

interface ChatCanvasProps {
  sessionId: string | null;
  sessionTitle: string;
  sessionRepo?: string;
  pendingWorkspacePath?: string | null;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  onSessionCreated: (newSessionId: string, title?: string, repoName?: string) => void;
  isRightSidebarOpen?: boolean;
  onToggleRightSidebar?: () => void;
  onOpenFile?: (path: string) => void;
  onOpenSettings?: (tab?: string) => void;
}

// ponytail: Module-level stable empty array prevents breaking AssistantMessage memo on every token
const EMPTY_ARTIFACTS: any[] = [];

export default function ChatCanvas({ 
  sessionId, sessionRepo, pendingWorkspacePath,
  onSessionCreated,
  onOpenFile,
  onOpenSettings,
}: ChatCanvasProps) {
  const chatScrollContainerRef = useRef<HTMLDivElement>(null);

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
    injectQueued,
    discardQueued,
    hasEarlierTurns,
    isLoadingEarlier,
    remainingEarlierCount,
    loadEarlierTurns,
  } = useChatStream({ 
    sessionId, 
    sessionRepo, 
    pendingWorkspacePath, 
    onSessionCreated,
    scrollContainerRef: chatScrollContainerRef,
  });

  const [isQueueExpanded, setIsQueueExpanded] = useState<boolean>(true);
  const [showQuotaBanner, setShowQuotaBanner] = useState<boolean>(false);

  // ponytail: Live DOM RAM window - strictly mount at most 100 turns in DOM to prevent tab freezes and RAM bloat
  const MAX_LIVE_TURNS = 100;
  const [windowOffsetFromEnd, setWindowOffsetFromEnd] = useState<number>(0);

  // Auto-reset window to latest turns when streaming or sending prompt
  useEffect(() => {
    if (isStreaming) {
      setWindowOffsetFromEnd(0);
    }
  }, [isStreaming]);

  // Reset window and dismiss quota banner when session changes
  useEffect(() => {
    setWindowOffsetFromEnd(0);
    setShowQuotaBanner(false);
  }, [sessionId]);

  const startIndex = Math.max(0, turns.length - MAX_LIVE_TURNS - windowOffsetFromEnd);
  const endIndex = Math.min(turns.length, startIndex + MAX_LIVE_TURNS);
  const visibleTurns = turns.slice(startIndex, endIndex);

  const olderCount = startIndex + remainingEarlierCount;
  const newerCount = turns.length - endIndex;

  const handleLoadEarlier = async () => {
    if (startIndex > 0) {
      setWindowOffsetFromEnd((prev) => Math.max(0, Math.min(turns.length - MAX_LIVE_TURNS, prev + 50)));
    } else if (hasEarlierTurns) {
      await loadEarlierTurns();
      setWindowOffsetFromEnd((prev) => prev + 50);
    }
  };

  // Velocity-aware scroll retention hook
  const {
    autoScroll,
    hitBottom,
    scrollDomToBottom,
    onChatBodyScroll,
  } = useScrollToBottom(chatScrollContainerRef);

  const lastTurn = turns[turns.length - 1];
  const lastAiMsg = lastTurn?.aiMsgs[lastTurn.aiMsgs.length - 1];
  const lastAiContent = lastAiMsg?.content;
  const lastAiThoughts = lastAiMsg?.thoughts?.length;
  const lastAiTools = lastAiMsg?.tools?.length;

  // Auto-scroll strictly to bottom ONLY when autoScroll is active
  useEffect(() => {
    if (autoScroll) {
      scrollDomToBottom();
    }
  }, [
    turns.length, 
    isStreaming, 
    autoScroll, 
    scrollDomToBottom,
    lastAiContent,
    lastAiThoughts,
    lastAiTools
  ]);

  // Trigger quota banner ONLY if backend/model returns a rate limit or quota exceeded error
  useEffect(() => {
    const classified = classifyError(lastAiMsg?.error);
    if (classified?.category === 'quota') {
      setShowQuotaBanner(true);
    }
  }, [lastAiMsg?.error]);

  const handleProceed = useCallback(() => {
    send(undefined, undefined, "Proceed with the implementation plan");
  }, [send]);

  const handleContinue = useCallback(() => {
    send(
      undefined,
      undefined,
      "Continue from where you were interrupted. Please pick up right where the previous step stopped without re-doing completed work."
    );
    scrollDomToBottom();
  }, [send, scrollDomToBottom]);

  const handleSend = useCallback((text: string) => {
    send(undefined, undefined, text);
    scrollDomToBottom();
  }, [send, scrollDomToBottom]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    onChatBodyScroll(e.currentTarget);
  }, [onChatBodyScroll]);

  const handleEditQueued = (index = 0) => {
    const msg = queuedMessages?.[index] || queuedMessage;
    if (msg) {
      setInputPrompt(msg);
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

          {/* Fresh Hero View (Only for new session when no sessionId is active) */}
          {!sessionId && chatMessages.length === 0 && <ChatHeroView />}

          {/* Messages Feed */}
          {chatMessages.length > 0 && (
            <div className="flex flex-col pt-3 space-y-3.5">
              {/* Earlier Turns Pagination Header */}
              {(olderCount > 0 || hasEarlierTurns) && (
                <div className="flex justify-center -mt-1 -mb-1 pb-1.5">
                  <button
                    type="button"
                    onClick={handleLoadEarlier}
                    disabled={isLoadingEarlier}
                    className="flex items-center gap-2 px-3.5 py-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all cursor-pointer shadow-xs disabled:opacity-50 group"
                  >
                    {isLoadingEarlier ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
                        <span>Loading earlier turns...</span>
                      </>
                    ) : (
                      <>
                        <History size={12} className="text-zinc-400 group-hover:text-zinc-200 transition-colors" />
                        <span>Load earlier turns ({olderCount > 0 ? `${olderCount} older` : 'older turns'})</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {visibleTurns.map((turn, i) => {
                const globalTurnIdx = startIndex + i;
                const isLastTurn = globalTurnIdx === turns.length - 1;
                const isSyntheticContext = turn.userMsg.content === '[Earlier Context]';
                const turnKey = turn.id || `turn_${turn.flatIdx}_${globalTurnIdx}`;
                const turnIdx = turn.turnIndex ?? globalTurnIdx;
                return (
                  <div 
                    key={turnKey} 
                    className="flex flex-col w-full relative pb-3 border-b border-zinc-200/50 dark:border-white/[0.04] last:border-b-0 last:pb-1"
                  >
                    {!isSyntheticContext && (
                      <div className="sticky top-0 z-20 py-2 bg-[var(--bg-app)]/90 backdrop-blur-md border-b border-zinc-200/40 dark:border-white/[0.04] transition-all">
                        <UserMessage
                          msg={turn.userMsg}
                          onUndo={() => undo(turn.flatIdx, turn.userMsg.content, turnIdx)}
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
                              onProceed={handleProceed}
                              onContinue={handleContinue}
                              onRetry={() => retry(turn.userMsg.content, turn.userMsg.sessionId)}
                            />
                          </ErrorBoundary>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Jump to latest turns pill when viewing earlier history */}
              {newerCount > 0 && (
                <div className="flex justify-center pt-2 pb-1 sticky bottom-2 z-20">
                  <button
                    type="button"
                    onClick={() => setWindowOffsetFromEnd(0)}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-medium shadow-md transition-all cursor-pointer select-none"
                  >
                    <span>Jump to latest turns ({newerCount} newer)</span>
                    <ChevronDown size={14} />
                  </button>
                </div>
              )}

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
                onSeePlans={() => onOpenSettings?.('plans')}
                onDismiss={() => setShowQuotaBanner(false)}
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
          />
        </div>
      </div>

    </div>
  );
}
