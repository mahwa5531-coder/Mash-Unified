import React, { useCallback, useRef, useState } from "react";
import { parse as parsePartialJson } from "partial-json";
import { MarkdownRenderer } from "./MarkdownRenderer";

/** Convert literal \n in LLM output to real newlines */
export function normalizeNewlines(text: string | undefined): string {
  if (!text) return "";
  return text.replace(/\\n/g, "\n");
}

export interface AskUserQuestion {
  question: string;
  header: string;
  type?: "choice" | "text" | "yesno";
  options?: Array<{ label: string; description: string }>;
  multiSelect?: boolean;
  placeholder?: string;
}

export interface AskUserFormState {
  answers: Record<number, string | string[]>;
  submitted: boolean;
  setAnswer: (idx: number, value: string | string[]) => void;
  handleSubmit: () => void;
}

export function serializeAskUserAnswers(
  questions: AskUserQuestion[],
  answers: Record<number, string | string[]>
): string {
  const parts: string[] = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const ans = answers[i];
    const label = q.header || `Q${i + 1}`;
    if (Array.isArray(ans)) {
      parts.push(`${label}: ${ans.join(", ")}`);
    } else if (ans) {
      parts.push(`${label}: ${ans}`);
    }
  }
  if (parts.length === 0) {
    parts.push("(no answer)");
  }
  return questions.length === 1 ? parts[0] : parts.join("\n");
}

export function useAskUserForm({
  questions,
  agentId,
  answered,
  onSendMessage,
  onSubmitted,
}: {
  questions: AskUserQuestion[];
  agentId: string;
  answered: boolean;
  onSendMessage: (content: string, toAgentId: string) => void;
  onSubmitted?: () => void;
}): AskUserFormState {
  const [answers, setAnswers] = useState<Record<number, string | string[]>>({});
  const [submitted, setSubmitted] = useState(answered);
  const submittingRef = useRef(false);

  const setAnswer = useCallback((idx: number, value: string | string[]) => {
    setAnswers((prev) => ({ ...prev, [idx]: value }));
  }, []);

  const handleSubmit = useCallback(() => {
    if (submittingRef.current) return;
    const message = serializeAskUserAnswers(questions, answers);
    submittingRef.current = true;
    onSendMessage(message, agentId);
    setSubmitted(true);
    onSubmitted?.();
  }, [questions, answers, agentId, onSendMessage, onSubmitted]);

  return { answers, submitted, setAnswer, handleSubmit };
}

export function ChoiceInput({
  options,
  multiSelect,
  value,
  onChange,
  disabled = false,
}: {
  options: Array<{ label: string; description: string }>;
  multiSelect: boolean;
  value: string | string[] | undefined;
  onChange: (v: string | string[]) => void;
  disabled?: boolean;
}) {
  const [otherActive, setOtherActive] = useState(false);
  const [otherText, setOtherText] = useState("");

  const selected = multiSelect
    ? Array.isArray(value)
      ? value
      : []
    : typeof value === "string"
      ? value
      : "";

  const optionLabels = options.map((o) => o.label);
  const isOtherValue =
    !multiSelect &&
    typeof selected === "string" &&
    selected !== "" &&
    !optionLabels.includes(selected);

  const effectiveOtherActive = otherActive || isOtherValue;

  const toggle = (label: string) => {
    if (disabled) return;
    if (multiSelect) {
      const arr = selected as string[];
      const filtered = arr.filter((l) => optionLabels.includes(l));
      const next = filtered.includes(label)
        ? filtered.filter((l) => l !== label)
        : [...filtered, label];
      if (otherActive && otherText) {
        onChange([...next, `Other: ${otherText}`]);
      } else {
        onChange(next);
      }
    } else {
      setOtherActive(false);
      onChange(label);
    }
  };

  const handleOtherClick = () => {
    if (disabled) return;
    if (multiSelect) {
      const newActive = !otherActive;
      setOtherActive(newActive);
      const arr = (selected as string[]).filter((l) => optionLabels.includes(l));
      if (newActive && otherText) {
        onChange([...arr, `Other: ${otherText}`]);
      } else {
        onChange(arr);
      }
    } else {
      setOtherActive(true);
      onChange(otherText || "");
    }
  };

  const handleOtherChange = (text: string) => {
    setOtherText(text);
    if (multiSelect) {
      const arr = (selected as string[]).filter((l) => optionLabels.includes(l));
      if (text) {
        onChange([...arr, `Other: ${text}`]);
      } else {
        onChange(arr);
      }
    } else {
      onChange(text);
    }
  };

  return (
    <div style={choiceStyles.container}>
      {options.map((opt, oi) => {
        const isChecked = multiSelect
          ? (selected as string[]).includes(opt.label)
          : selected === opt.label;
        return (
          <button
            key={oi}
            type="button"
            disabled={disabled}
            onClick={() => toggle(opt.label)}
            style={{
              ...choiceStyles.optionBtn,
              borderColor: isChecked ? "#4A90D9" : "#D4CDC5",
              background: isChecked ? "#EBF3FB" : "#fff",
              cursor: disabled ? "default" : "pointer",
            }}
          >
            <span
              style={{
                ...choiceStyles.indicator,
                borderRadius: multiSelect ? 3 : "50%",
                borderColor: isChecked ? "#4A90D9" : "#C0B8AE",
                background: isChecked ? "#4A90D9" : "transparent",
              }}
            >
              {isChecked && (
                <span
                  style={{
                    color: "#fff",
                    fontSize: 10,
                    lineHeight: 1,
                    display: "block",
                  }}
                >
                  ✓
                </span>
              )}
            </span>
            <span style={choiceStyles.labelWrapper}>
              <span style={choiceStyles.optLabel}>{opt.label}</span>
              {opt.description && (
                <span style={choiceStyles.optDesc}>{opt.description}</span>
              )}
            </span>
          </button>
        );
      })}

      <div style={choiceStyles.otherWrapper}>
        <button
          type="button"
          disabled={disabled}
          onClick={handleOtherClick}
          style={{
            ...choiceStyles.optionBtn,
            borderColor: effectiveOtherActive ? "#4A90D9" : "#D4CDC5",
            background: effectiveOtherActive ? "#EBF3FB" : "#fff",
            cursor: disabled ? "default" : "pointer",
          }}
        >
          <span
            style={{
              ...choiceStyles.indicator,
              borderRadius: multiSelect ? 3 : "50%",
              borderColor: effectiveOtherActive ? "#4A90D9" : "#C0B8AE",
              background: effectiveOtherActive ? "#4A90D9" : "transparent",
            }}
          >
            {effectiveOtherActive && (
              <span
                style={{
                  color: "#fff",
                  fontSize: 10,
                  lineHeight: 1,
                  display: "block",
                }}
              >
                ✓
              </span>
            )}
          </span>
          <span style={choiceStyles.optLabel}>Other...</span>
        </button>
        {effectiveOtherActive && !disabled && (
          <input
            type="text"
            placeholder="Please specify..."
            value={otherText || (isOtherValue ? (selected as string) : "")}
            onChange={(e) => handleOtherChange(e.target.value)}
            style={choiceStyles.otherInput}
            autoFocus
          />
        )}
      </div>
    </div>
  );
}

interface AskUserBlockProps {
  questions: AskUserQuestion[];
  agentId: string;
  answered: boolean;
  onSendMessage: (content: string, toAgentId: string) => void;
  onSubmitted?: () => void;
}

export function AskUserBlock({
  questions,
  agentId,
  answered,
  onSendMessage,
  onSubmitted,
}: AskUserBlockProps) {
  const { answers, submitted, setAnswer, handleSubmit } = useAskUserForm({
    questions,
    agentId,
    answered,
    onSendMessage,
    onSubmitted,
  });

  if (submitted) {
    return (
      <div style={{ ...styles.container, opacity: 0.75 }}>
        <div style={styles.headerRow}>
          <span style={styles.badge}>ASK USER</span>
          <span style={styles.answeredLabel}>Answered</span>
        </div>
        {questions.map((q, i) => {
          const qType = q.type || (q.options && q.options.length > 0 ? "choice" : "text");
          return (
            <div key={i} style={styles.questionBlock}>
              <div style={styles.qHeader}>{q.header}</div>
              <div style={styles.qText}>
                <MarkdownRenderer content={normalizeNewlines(q.question)} />
              </div>
              {qType === "choice" && q.options && (
                <ChoiceInput
                  options={q.options}
                  multiSelect={q.multiSelect ?? false}
                  value={answers[i]}
                  onChange={() => {}}
                  disabled
                />
              )}
              {qType === "text" && (
                <input
                  type="text"
                  value={(answers[i] as string) || ""}
                  readOnly
                  style={{ ...styles.textInput, background: "#F5F2EC", cursor: "default" }}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.headerRow}>
        <span style={styles.badge}>ASK USER</span>
      </div>
      {questions.map((q, i) => {
        const qType = q.type || (q.options && q.options.length > 0 ? "choice" : "text");
        return (
          <div key={i} style={styles.questionBlock}>
            <div style={styles.qHeader}>{q.header}</div>
            <div style={styles.qText}>
              <MarkdownRenderer content={normalizeNewlines(q.question)} />
            </div>
            {q.multiSelect && (
              <div style={styles.multiSelectHint}>Select multiple</div>
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
                style={styles.textInput}
              />
            )}
          </div>
        );
      })}
      <button onClick={handleSubmit} style={styles.submitBtn}>
        Submit
      </button>
    </div>
  );
}

export function parseAskUserQuestions(argsString: string, _isStreaming?: boolean): AskUserQuestion[] {
  try {
    const parsed = parsePartialJson(argsString);
    if (parsed && Array.isArray(parsed.questions)) {
      return parsed.questions;
    }
  } catch {
    // partial JSON ignored
  }
  return [];
}

export function isAskUserAnswered(
  currentAskId: string | null,
  submittedAskIds: Set<string>,
  isStreaming: boolean,
  hasStopEvent: boolean
): boolean {
  if (!currentAskId) return true;
  if (submittedAskIds.has(currentAskId)) return true;
  if (!isStreaming && !hasStopEvent) return true;
  return false;
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    margin: "8px 0",
    padding: "12px 14px",
    background: "#FAF8F5",
    borderRadius: 6,
    border: "1px solid #E2DDD5",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  badge: {
    display: "inline-block",
    padding: "2px 6px",
    borderRadius: 3,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: "#fff",
    background: "#FF8C42",
  },
  answeredLabel: {
    fontSize: 11,
    color: "#8A8279",
    fontWeight: 500,
  },
  questionBlock: {
    marginBottom: 12,
  },
  qHeader: {
    fontSize: 12,
    fontWeight: 600,
    color: "#2D2A26",
    marginBottom: 2,
  },
  qText: {
    fontSize: 12,
    color: "#5A544E",
    marginBottom: 6,
  },
  multiSelectHint: {
    fontSize: 11,
    color: "#8A8279",
    fontStyle: "italic",
    marginBottom: 4,
  },
  textInput: {
    width: "100%",
    padding: "6px 8px",
    borderRadius: 4,
    border: "1px solid #D4CDC5",
    fontSize: 12,
    color: "#2D2A26",
    background: "#fff",
    boxSizing: "border-box",
  },
  submitBtn: {
    padding: "5px 12px",
    borderRadius: 4,
    border: "none",
    background: "#FF8C42",
    color: "#fff",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 4,
  },
};

const choiceStyles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  optionBtn: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 4,
    border: "1px solid #D4CDC5",
    background: "#fff",
    textAlign: "left",
    width: "100%",
    boxSizing: "border-box",
  },
  indicator: {
    width: 14,
    height: 14,
    border: "1.5px solid #C0B8AE",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    boxSizing: "border-box",
  },
  labelWrapper: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
  },
  optLabel: {
    fontSize: 12,
    fontWeight: 500,
    color: "#2D2A26",
  },
  optDesc: {
    fontSize: 11,
    color: "#8A8279",
    marginTop: 1,
  },
  otherWrapper: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  otherInput: {
    width: "100%",
    padding: "5px 8px",
    borderRadius: 4,
    border: "1px solid #D4CDC5",
    fontSize: 11,
    color: "#2D2A26",
    background: "#fff",
    boxSizing: "border-box",
  },
};
