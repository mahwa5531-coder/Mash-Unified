import type { AgentState } from "../types";
import { parseTodos } from "../features/todos/WriteTodosBlock";

export function resolveLeaderId(agents: Record<string, AgentState>): string | null {
  const list = Object.values(agents);
  if (list.length === 0) return null;
  const leaderByRole = list.find((a) => a.roleName?.toLowerCase() === "leader");
  if (leaderByRole) return leaderByRole.agentId;
  return list[0].agentId;
}

export function computeTaskProgressAndLabels(agents: Record<string, AgentState>) {
  const progressMap: Record<string, { done: number; total: number }> = {};
  const labelMap: Record<string, string | null> = {};

  for (const agent of Object.values(agents)) {
    const todoBlocks = agent.blocks.filter(
      (b) => b.kind === "tool_call" && b.name.toLowerCase() === "write_todos"
    );
    if (todoBlocks.length === 0) continue;

    const latest = todoBlocks[todoBlocks.length - 1];
    if (latest.kind !== "tool_call") continue;

    // Reusing canonical parseTodos export (R7)
    const todos = parseTodos(latest.args, true);
    if (!todos || todos.length === 0) continue;

    const total = todos.length;
    const done = todos.filter((t) => t.status === "completed").length;
    progressMap[agent.agentId] = { done, total };

    const inProg = todos.find((t) => t.status === "in_progress");
    const nextPending = todos.find((t) => t.status === "pending");
    const active = inProg || nextPending;
    labelMap[agent.agentId] = active ? active.description : null;
  }

  return { agentTaskProgress: progressMap, agentTodoLabel: labelMap };
}
