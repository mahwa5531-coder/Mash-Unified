// Pure timeline construction: tool/thought/step -> chronological entries.
import type { ToolCallItem, TimelineEntry } from './types';

export function isToolRunning(tool?: ToolCallItem, isStreaming?: boolean): boolean {
  if (!tool) return false;
  if (
    tool.status === 'completed' ||
    tool.status === 'failed' ||
    (tool.status as string) === 'cancelled' ||
    (tool.status === 'pending_approval' && !tool.decision) ||
    tool.status === 'denied'
  ) return false;
  if (tool.status === 'running') return true;
  // explicit status preferred; fallback only when streaming and output has not arrived
  return !!(isStreaming && tool.output === undefined);
}

export function extractLineRange(args?: Record<string, any>): string | null {
  if (!args) return null;
  const start = args.StartLine ?? args.start_line ?? args.startLine;
  const end = args.EndLine ?? args.end_line ?? args.endLine;
  if (start && end) return `#L${start}-${end}`;
  if (start) return `#L${start}`;
  return null;
}

export { formatDurationDisplay } from '@/utils/formatting';

// Keyed Slot Registry for O(1) canonical tool category dispatch (replaces 160-line substring regex ladder)
const EXACT_TOOL_CATEGORY_MAP: Record<string, TimelineEntry['type']> = {
  run_shell_command: 'command',
  run_command: 'command',
  shell: 'command',
  bash: 'command',
  run_code: 'command',
  terminal: 'command',
  audit_skill_tool: 'other',

  read_file: 'file_read',
  view_file: 'file_read',
  read_many_files: 'file_read',
  get_file: 'file_read',

  list_directory: 'folder_view',
  list_dir: 'folder_view',
  browse: 'folder_view',

  write_file: 'edit',
  write_to_file: 'edit',
  write: 'edit',
  replace: 'edit',
  replace_file_content: 'edit',
  edit_file: 'edit',
  multiedit: 'edit',
  apply_patch: 'edit',
  patch: 'edit',

  search_web: 'web_search',
  web_search: 'web_search',

  web_fetch: 'web_fetch',
  read_url_content: 'web_fetch',
  fetch_url: 'web_fetch',

  search_file_content: 'code_search',
  grep: 'code_search',
  find_by_name: 'code_search',
  glob: 'code_search',
  find: 'code_search',

  invoke_subagent: 'subagent',
  define_subagent: 'subagent',

  manage_task: 'task',
  task: 'task',
  schedule: 'task',
};

export function resolveToolCategory(name: string): TimelineEntry['type'] {
  const lower = (name || '').toLowerCase();
  if (EXACT_TOOL_CATEGORY_MAP[lower]) return EXACT_TOOL_CATEGORY_MAP[lower];
  // Fallback for namespaced / prefixed tools (e.g. "mcp__run_command" or "custom_read_file")
  if (lower.includes('command') || lower.includes('shell') || lower.includes('terminal')) return 'command';
  if (lower.includes('edit') || lower.includes('patch') || lower.includes('write')) return 'edit';
  if (lower.includes('read') || lower.includes('view') || lower.includes('cat')) return 'file_read';
  if (lower.includes('list') || lower.includes('browse')) return 'folder_view';
  if (lower.includes('web') && lower.includes('search')) return 'web_search';
  if (lower.includes('web') || lower.includes('fetch') || lower.includes('url')) return 'web_fetch';
  if (lower.includes('search') || lower.includes('grep') || lower.includes('glob')) return 'code_search';
  if (lower.includes('subagent')) return 'subagent';
  if (lower.includes('task')) return 'task';
  return 'other';
}

/**
 * Canonical tool metadata extractor: resolves toolSummary, toolAction, command, and path
 * across runtime events, streaming deltas, and stored history.
 */
export function extractToolMetadata(
  item?: any,
  argsOverride?: any
): {
  toolSummary?: string;
  toolAction?: string;
  command?: string;
  path?: string;
} {
  let args = argsOverride ?? item?.args ?? item?.parameters ?? item?.input ?? {};
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch { args = {}; }
  }
  const rawArgs = typeof args === 'object' && args !== null ? args : {};

  const summary =
    item?.toolSummary ||
    item?.tool_summary ||
    item?.summary ||
    item?.description ||
    rawArgs.toolSummary ||
    rawArgs.tool_summary ||
    rawArgs.description ||
    rawArgs.Instruction ||
    rawArgs.summary;

  const action =
    item?.toolAction ||
    item?.tool_action ||
    rawArgs.toolAction ||
    rawArgs.tool_action;

  const command =
    item?.command ||
    rawArgs.CommandLine ||
    rawArgs.command ||
    rawArgs.cmd ||
    rawArgs.code ||
    rawArgs.source_code;

  const path =
    item?.path ||
    rawArgs.TargetFile ||
    rawArgs.AbsolutePath ||
    rawArgs.file_path ||
    rawArgs.path ||
    rawArgs.Path ||
    rawArgs.target_file ||
    rawArgs.filepath ||
    rawArgs.DirectoryPath ||
    rawArgs.dir_path;

  return {
    toolSummary: summary ? String(summary).trim() : undefined,
    toolAction: action ? String(action).trim() : undefined,
    command: command ? String(command).trim() : undefined,
    path: path ? String(path).trim() : undefined,
  };
}

export function parseToolItem(t: ToolCallItem, tIdx: number | string): TimelineEntry {
  const name = (t.name || '').toLowerCase();
  let args = t.args || (t as any).input || (t as any).parameters || {};
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch { args = {}; }
  }

  const meta = extractToolMetadata(t, args);
  const toolSummary = meta.toolSummary || null;
  const toolAction = meta.toolAction || null;

  // The interactive approval card is ONLY rendered while waiting for human permission.
  // As soon as the user makes a decision (allow/deny) or status transitions, the card vanishes
  // and the tool call renders as its normal canonical timeline item (command, file_view, etc.).
  if (t.status === 'pending_approval' && !t.decision) {
    const rawCmd = (t as any).command || args.CommandLine || args.command || args.cmd || '';
    return {
      id: `tool-${tIdx}`,
      type: 'approval',
      data: {
        tool: t,
        toolCallId: t.id || `tc_${tIdx}`,
        toolName: t.name,
        toolSummary,
        toolAction,
        command: rawCmd ? String(rawCmd).replace(/^powershell\s+-Command\s+/i, '').trim() : undefined,
        args,
        status: 'pending',
        decision: null,
      }
    };
  }

  const category = resolveToolCategory(name);

  switch (category) {
    case 'command': {
      const rawCmd = (t as any).command || args.CommandLine || args.command || args.cmd || args.code || args.source_code || (typeof args === 'string' ? args : 'command');
      const cleanCmd = String(rawCmd).replace(/^powershell\s+-Command\s+/i, '').trim();
      return {
        id: `tool-${tIdx}`,
        type: 'command',
        data: { tool: t, cmd: cleanCmd, fullCmd: String(rawCmd), toolSummary, toolAction }
      };
    }
    case 'folder_view': {
      const p = (t as any).path || args.DirectoryPath || args.dir_path || args.path || args.Path || 'directory';
      const fname = String(p).split(/[/\\]/).pop() || p;
      return {
        id: `tool-${tIdx}`,
        type: 'folder_view',
        data: { tool: t, foldername: fname, folderPath: String(p), toolSummary, toolAction }
      };
    }
    case 'file_read': {
      const p = (t as any).path || args.TargetFile || args.AbsolutePath || args.file_path || args.path || args.Path || args.target_file || (t as any).input?.TargetFile || (t as any).input?.AbsolutePath || (t as any).input?.file_path || (t as any).input?.path || '';
      const fname = p ? (String(p).split(/[/\\]/).pop() || p) : '';
      const isDir = !fname.includes('.') || name.includes('list');
      if (isDir) {
        return {
          id: `tool-${tIdx}`,
          type: 'folder_view',
          data: { tool: t, foldername: fname, folderPath: String(p), toolSummary, toolAction }
        };
      } else {
        return {
          id: `tool-${tIdx}`,
          type: 'file_read',
          data: { tool: t, filename: fname, filePath: String(p), lineRange: extractLineRange(args), toolSummary, toolAction }
        };
      }
    }
    case 'edit': {
      const p = (t as any).path || args.TargetFile || args.AbsolutePath || args.file_path || args.path || args.Path || args.target_file || args.filepath || (t as any).input?.TargetFile || (t as any).input?.AbsolutePath || (t as any).input?.file_path || (t as any).input?.path || '';
      const fname = p ? (String(p).split(/[/\\]/).pop() || p) : '';
      let added = 0;
      let deleted = 0;

      if (args.ReplacementContent !== undefined && args.TargetContent !== undefined) {
        added = String(args.ReplacementContent).split('\n').length;
        deleted = String(args.TargetContent).split('\n').length;
      } else if (args.new_string !== undefined && args.old_string !== undefined) {
        added = String(args.new_string).split('\n').length;
        deleted = String(args.old_string).split('\n').length;
      } else if (Array.isArray(args.edits)) {
        for (const edit of args.edits) {
          if (edit?.new_string) added += String(edit.new_string).split('\n').length;
          if (edit?.old_string) deleted += String(edit.old_string).split('\n').length;
        }
        added = Math.max(1, added);
      } else if (args.patch || args.input) {
        const patchLines = String(args.patch || args.input).split('\n');
        for (const line of patchLines) {
          if (line.startsWith('+') && !line.startsWith('+++')) added++;
          else if (line.startsWith('-') && !line.startsWith('---')) deleted++;
        }
        added = Math.max(1, added);
      } else if (args.CodeContent !== undefined || args.content !== undefined) {
        added = String(args.CodeContent ?? args.content ?? '').split('\n').length;
        deleted = 0;
      }

      return {
        id: `tool-${tIdx}`,
        type: 'edit',
        data: { 
          tool: t, 
          filename: fname, 
          filePath: String(p), 
          added, 
          deleted, 
          lineRange: extractLineRange(args),
          toolSummary,
          toolAction,
        }
      };
    }
    case 'web_search': {
      const query = args.Query || args.query || args.search_term || args.pattern || '*';
      return {
        id: `tool-${tIdx}`,
        type: 'web_search',
        data: { tool: t, query: String(query), toolSummary, toolAction }
      };
    }
    case 'web_fetch': {
      const url = args.Url || args.url || args.target_url || args.link || 'url';
      return {
        id: `tool-${tIdx}`,
        type: 'web_fetch',
        data: { tool: t, url: String(url), toolSummary, toolAction }
      };
    }
    case 'code_search': {
      const pattern = args.Query || args.Pattern || args.pattern || args.query || args.search_term || '*';
      let countStr = '';
      if (t.output) {
        const lines = t.output.split('\n').filter((l) => l.trim().length > 0);
        countStr = `${lines.length} result${lines.length !== 1 ? 's' : ''}`;
      }
      return {
        id: `tool-${tIdx}`,
        type: 'code_search',
        data: { tool: t, pattern: String(pattern), countStr, toolSummary, toolAction }
      };
    }
    case 'subagent': {
      let subagentRoles: string[] = [];
      if (Array.isArray(args.Subagents)) {
        subagentRoles = args.Subagents.map((s: any) => s.Role || s.TypeName || 'Subagent');
      } else if (args.Role || args.TypeName) {
        subagentRoles = [args.Role || args.TypeName];
      }
      const roleLabel = subagentRoles.length > 0 ? subagentRoles.join(', ') : (toolSummary || 'Subagent');
      return {
        id: `tool-${tIdx}`,
        type: 'subagent',
        data: { tool: t, roleLabel, args, toolSummary, toolAction }
      };
    }
    case 'task': {
      const isStatusCheck = args.Action === 'status';
      let taskName = toolSummary || args.Prompt || '';
      if (!taskName) {
        if (args.Action === 'list') taskName = 'Running background tasks';
        else if (args.Action === 'status') taskName = args.TaskId ? `task ${args.TaskId}` : 'task';
        else if (args.Action === 'kill') taskName = `Cancel task ${args.TaskId || ''}`.trim();
        else if (args.TaskId) taskName = `Task ${args.TaskId}`;
        else taskName = 'Background task';
      }
      return {
        id: `tool-${tIdx}`,
        type: 'task',
        data: { tool: t, taskName: String(taskName), isStatusCheck, action: args.Action, toolSummary, toolAction }
      };
    }
    default: {
      return {
        id: `tool-${tIdx}`,
        type: 'other',
        data: { tool: t, toolSummary, toolAction }
      };
    }
  }
}

/**
 * Group consecutive tools (>= 2) of the same category into tidy expandable group entries:
 * - 2+ commands -> 'command_group' ("Ran 3 commands ›")
 * - 2+ edits -> 'edit_group' ("Edited 3 files +25 -4 ›")
 * - 2+ reads/searches -> 'exploration_group' ("Analyzed 4 files ›" or "Searched 3 times ›")
 */
export function groupTimelineEntries(entries: TimelineEntry[]): TimelineEntry[] {
  const result: TimelineEntry[] = [];
  let i = 0;

  while (i < entries.length) {
    const current = entries[i];

    // Preserved standalone: Approval Cards must never be bundled into a collapsible group.
    // Deduplicate by raw toolCallId / command so stream retries never stack duplicate cards (Fix 3)
    if (current.type === 'approval') {
      const tcId = String(current.data?.toolCallId || current.data?.tool?.id || current.id);
      const cleanId = tcId.replace(/^run_[^_]+_/, '').replace(/^run_/, '');
      const curCmd = current.data?.command;
      const isDuplicate = result.some((r) => {
        if (r.type !== 'approval') return false;
        const rId = String(r.data?.toolCallId || r.data?.tool?.id || r.id).replace(/^run_[^_]+_/, '').replace(/^run_/, '');
        const rCmd = r.data?.command;
        if (cleanId && rId === cleanId) return true;
        if (curCmd && rCmd && curCmd === rCmd) return true;
        return false;
      });
      if (!isDuplicate) {
        // Sequential Tool Approval Guard:
        // Only ONE active approval card can be presented to the user at a time.
        // If an undecided approval card is already in the timeline, subsequent parallel tool calls
        // render as calm queued entries until the user resolves the active approval card.
        const hasActiveUndecidedCard = result.some(
          (r) => r.type === 'approval' && !r.data?.decision && r.data?.status === 'pending'
        );
        if (hasActiveUndecidedCard && !current.data?.decision) {
          const fallbackEntry = parseToolItem(
            { ...(current.data?.tool || {}), status: 'queued_approval' },
            current.id
          );
          fallbackEntry.data = {
            ...fallbackEntry.data,
            toolSummary: current.data?.toolSummary || `Queued: awaiting approval of previous tool`,
            toolAction: `Awaiting prior approval`,
            status: 'queued',
          };
          result.push(fallbackEntry);
        } else {
          result.push(current);
        }
      }
      i++;
      continue;
    }

    // 1. Group consecutive commands (>= 2)
    if (current.type === 'command') {
      const group: TimelineEntry[] = [current];
      let j = i + 1;
      while (j < entries.length && entries[j].type === 'command') {
        group.push(entries[j]);
        j++;
      }
      if (group.length > 1) {
        const isRunning = group.some(e => isToolRunning(e.data?.tool));
        const isCancelled = group.some(e => e.data?.tool?.status === 'cancelled');
        result.push({
          id: `cmd-group-${i}`,
          type: 'command_group',
          data: {
            count: group.length,
            isRunning,
            isCancelled,
          },
          items: group,
        });
        i = j;
        continue;
      }
    }

    // 2. Group consecutive edits (>= 2)
    if (current.type === 'edit') {
      const group: TimelineEntry[] = [current];
      let j = i + 1;
      while (j < entries.length && entries[j].type === 'edit') {
        group.push(entries[j]);
        j++;
      }
      if (group.length > 1) {
        const isRunning = group.some(e => isToolRunning(e.data?.tool));
        const isCancelled = group.some(e => e.data?.tool?.status === 'cancelled');
        let totalAdded = 0;
        let totalDeleted = 0;
        group.forEach(e => {
          totalAdded += e.data?.added || 0;
          totalDeleted += e.data?.deleted || 0;
        });
        result.push({
          id: `edit-group-${i}`,
          type: 'edit_group',
          data: {
            count: group.length,
            added: totalAdded,
            deleted: totalDeleted,
            isRunning,
            isCancelled,
          },
          items: group,
        });
        i = j;
        continue;
      }
    }

    // 3. Group consecutive file reads / searches / folder views (>= 2)
    const isExploration = (type: string) =>
      type === 'search' || type === 'code_search' || type === 'web_search' || type === 'web_fetch' || type === 'file_read' || type === 'folder_view';

    if (isExploration(current.type)) {
      const group: TimelineEntry[] = [current];
      let j = i + 1;
      while (j < entries.length && isExploration(entries[j].type)) {
        group.push(entries[j]);
        j++;
      }
      if (group.length > 1) {
        const isRunning = group.some(e => isToolRunning(e.data?.tool));
        const isCancelled = group.some(e => e.data?.tool?.status === 'cancelled');
        const allReads = group.every(e => e.type === 'file_read' || e.type === 'folder_view');
        const allSearches = group.every(e => e.type === 'search' || e.type === 'code_search' || e.type === 'web_search' || e.type === 'web_fetch');
        const label = allReads 
          ? `${group.length} files` 
          : allSearches 
            ? `${group.length} searches` 
            : `${group.length} files & searches`;
        result.push({
          id: `exploration-group-${i}`,
          type: 'exploration_group',
          data: {
            count: group.length,
            label,
            isRunning,
            isCancelled,
          },
          items: group,
        });
        i = j;
        continue;
      }
    }

    // Otherwise single item
    result.push(current);
    i++;
  }

  return result;
}
