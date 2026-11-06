import React from "react";
import { X } from "lucide-react";
import { MarkdownRenderer } from "./MarkdownRenderer";
import {
  AskUserQuestion,
  ChoiceInput,
  normalizeNewlines,
  useAskUserForm,
} from "./AskUserBlock";

interface AskUserModalProps {
  questions: AskUserQuestion[];
  agentId: string;
  roleName?: string;
  onSendMessage: (content: string, toAgentId: string) => void;
  onClose?: () => void;
  onSubmitted?: () => void;
  onHide?: () => void;
}

export function AskUserModal({
  questions,
  agentId,
  roleName,
  onSendMessage,
  onClose,
  onSubmitted,
  onHide,
}: AskUserModalProps) {
  const handleDismiss = onClose || onHide || onSubmitted || (() => {});
  const handleComplete = onSubmitted || onClose || onHide || (() => {});
  const { answers, setAnswer, handleSubmit } = useAskUserForm({
    questions,
    agentId,
    answered: false,
    onSendMessage,
    onSubmitted: handleComplete,
  });

  return (
    <div style={modalStyles.overlay}>
      <div style={modalStyles.modal}>
        <div style={modalStyles.header}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={modalStyles.badge}>ASK USER</span>
            <span style={modalStyles.title}>
              {roleName ? `Question from ${roleName}` : "Question from Leader"}
            </span>
          </div>
          <button onClick={handleDismiss} style={modalStyles.closeBtn}>
            <X size={16} />
          </button>
        </div>

        <div style={modalStyles.body}>
          {questions.map((q, i) => {
            const qType = q.type || (q.options && q.options.length > 0 ? "choice" : "text");
            return (
              <div key={i} style={modalStyles.questionBlock}>
                <div style={modalStyles.qHeader}>{q.header}</div>
                <div style={modalStyles.qText}>
                  <MarkdownRenderer content={normalizeNewlines(q.question)} />
                </div>
                {q.multiSelect && (
                  <div style={modalStyles.multiSelectHint}>Select multiple</div>
                )}
                {qType === "choice" && q.options && (
                  <ChoiceInput
                    options={q.options}
                    multiSelect={q.multiSelect ?? false}
                    value={answers[i]}
                    onChange={(v) => setAnswer(i, v)}
                  />
                )}
                {qType === "text" && (
                  <input
                    type="text"
                    placeholder={q.placeholder || "Your answer..."}
                    value={(answers[i] as string) || ""}
                    onChange={(e) => setAnswer(i, e.target.value)}
                    style={modalStyles.textInput}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div style={modalStyles.footer}>
          <button onClick={handleDismiss} style={modalStyles.cancelBtn}>
            Dismiss
          </button>
          <button onClick={handleSubmit} style={modalStyles.submitBtn}>
            Submit Answer
          </button>
        </div>
      </div>
    </div>
  );
}

const modalStyles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  modal: {
    background: "#FAF8F5",
    border: "1px solid #D4CDC5",
    borderRadius: 8,
    width: "90%",
    maxWidth: 520,
    maxHeight: "85vh",
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
    overflow: "hidden",
  },
  header: {
    padding: "12px 16px",
    borderBottom: "1px solid #E2DDD5",
    display: "flex",
    alignItems: "center",
    justifyContent: "between",
  },
  badge: {
    padding: "2px 6px",
    borderRadius: 3,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: "#fff",
    background: "#FF8C42",
  },
  title: {
    fontSize: 13,
    fontWeight: 600,
    color: "#2D2A26",
  },
  closeBtn: {
    border: "none",
    background: "transparent",
    cursor: "pointer",
    color: "#8A8279",
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    padding: 2,
  },
  body: {
    padding: "16px",
    overflowY: "auto",
    flex: 1,
  },
  questionBlock: {
    marginBottom: 16,
  },
  qHeader: {
    fontSize: 12,
    fontWeight: 600,
    color: "#2D2A26",
    marginBottom: 3,
  },
  qText: {
    fontSize: 13,
    color: "#5A544E",
    marginBottom: 8,
  },
  multiSelectHint: {
    fontSize: 11,
    color: "#8A8279",
    fontStyle: "italic",
    marginBottom: 4,
  },
  textInput: {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 4,
    border: "1px solid #D4CDC5",
    fontSize: 12,
    color: "#2D2A26",
    background: "#fff",
    boxSizing: "border-box",
  },
  footer: {
    padding: "10px 16px",
    borderTop: "1px solid #E2DDD5",
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
    background: "#F5F2EC",
  },
  cancelBtn: {
    padding: "6px 12px",
    borderRadius: 4,
    border: "1px solid #D4CDC5",
    background: "#fff",
    color: "#6B6560",
    fontSize: 12,
    cursor: "pointer",
  },
  submitBtn: {
    padding: "6px 14px",
    borderRadius: 4,
    border: "none",
    background: "#FF8C42",
    color: "#fff",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
};
