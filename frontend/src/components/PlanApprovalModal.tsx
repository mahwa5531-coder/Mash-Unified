"use client";

import { useState } from 'react';
import { CheckCircle2, XCircle, ShieldAlert, Zap, Lock } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { approvePlan } from '../utils/apiClient';

interface PlanApprovalModalProps {
  sessionId: string;
  planContent: string;
  onClose: () => void;
  onPlanApproved: () => void;
}

export default function PlanApprovalModal({
  sessionId,
  planContent,
  onClose,
  onPlanApproved,
}: PlanApprovalModalProps) {
  const [executionMode, setExecutionMode] = useState<string>('MANUAL_APPROVAL');
  const [feedback, setFeedback] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleAction = async (action: 'proceed' | 'reject') => {
    if (submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const success = await approvePlan(sessionId, action, feedback, executionMode);
      setSubmitting(false);
      if (success) {
        onPlanApproved();
        onClose();
      } else {
        setErrorMsg("Failed to submit approval. Please check backend connection and retry.");
      }
    } catch {
      setSubmitting(false);
      setErrorMsg("Error communicating with server. Please try again.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 font-sans select-none">
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-[750px] max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="h-14 px-6 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--bg-surface)]">
          <div className="flex items-center text-[var(--text-primary)] font-medium text-[15px]">
            <ShieldAlert size={18} className="mr-2 text-amber-500" />
            <span>Implementation Plan Approval Required</span>
          </div>

          {/* Mode Selector */}
          <div className="flex items-center space-x-2 text-[12px] bg-[var(--bg-hover)] px-2.5 py-1 rounded-md border border-[var(--border-subtle)]">
            <Lock size={12} className="text-[var(--text-muted)]" />
            <select
              value={executionMode}
              onChange={(e) => setExecutionMode(e.target.value)}
              className="bg-transparent text-[var(--text-primary)] outline-none cursor-pointer"
            >
              <option value="MANUAL_APPROVAL">Manual Approval</option>
              <option value="AUTO_APPROVE">Auto Approve</option>
              <option value="TURBO">Turbo Mode</option>
            </select>
          </div>
        </div>

        {/* Plan Markdown Content Body */}
        <div className="flex-1 overflow-y-auto p-6 markdown-body text-[14px] leading-relaxed custom-scrollbar">
          <ReactMarkdown>{planContent}</ReactMarkdown>
        </div>

        {/* Optional Feedback Input */}
        <div className="px-6 py-2 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          <input
            type="text"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Optional feedback or change instructions for the agent..."
            className="w-full bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
        </div>

        {/* Error message */}
        {errorMsg && (
          <div className="px-6 py-2 bg-red-500/10 border-t border-red-500/20 text-red-400 text-xs flex items-center justify-between">
            <span>{errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} className="text-zinc-400 hover:text-zinc-200 text-xs">Dismiss</button>
          </div>
        )}

        {/* Footer Action Controls */}
        <div className="h-16 px-6 bg-[var(--bg-surface)] border-t border-[var(--border-subtle)] flex items-center justify-between">
          <button
            onClick={() => handleAction('reject')}
            disabled={submitting}
            className="flex items-center px-4 py-2 bg-[var(--bg-hover)] hover:bg-red-500/10 hover:text-red-500 text-[var(--text-secondary)] rounded-xl text-[13px] font-medium transition-colors cursor-pointer border border-[var(--border-subtle)]"
          >
            <XCircle size={16} className="mr-2" />
            <span>Reject / Request Changes</span>
          </button>

          <div className="flex items-center space-x-3">
            <button
              onClick={() => handleAction('proceed')}
              disabled={submitting}
              className="flex items-center px-5 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-xl text-[13px] font-medium transition-all shadow-md cursor-pointer"
            >
              <CheckCircle2 size={16} className="mr-2" />
              <span>{submitting ? 'Submitting...' : 'Proceed with Plan'}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
