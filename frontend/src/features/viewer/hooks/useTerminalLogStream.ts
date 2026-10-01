"use client";

import { useState, useRef, useEffect } from 'react';
import type { TabItem } from '../types';
import { fetchTaskLog } from '@/services/tasks';
import { BASE_URL } from '@/services/client';

interface UseTerminalLogStreamProps {
  activeTab?: TabItem;
  viewMode: 'explorer' | 'editor';
  tabContent: Record<string, string>;
  setTabContent: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

export function useTerminalLogStream({
  activeTab,
  viewMode,
  tabContent,
  setTabContent,
}: UseTerminalLogStreamProps) {
  const [terminalStatuses, setTerminalStatuses] = useState<Record<string, 'running' | 'completed' | 'failed'>>({});
  const terminalPreRef = useRef<HTMLDivElement>(null);

  // Auto-scroll terminal on new streamed output only if user is already near bottom
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
  }, [viewMode, activeTab?.id, activeTab?.type]);

  return {
    terminalStatuses,
    terminalPreRef,
  };
}
