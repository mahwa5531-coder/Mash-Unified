// Pure timeline construction: tool/thought/step -> chronological entries.
import type { ToolCallItem, TimelineEntry } from './types';

export function isToolRunning(tool?: ToolCallItem, isStreaming?: boolean): boolean {
  if (!tool) return false;
  if (tool.status === 'completed' || tool.status === 'failed' || (tool.status as string) === 'cancelled') return false;
  if (tool.status === 'running') return true;
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

export function formatDurationDisplay(secs: number): string {
  if (secs <= 0) return '0s';
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) {
    return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}

export function parseToolItem(t: ToolCallItem, tIdx: number | string): TimelineEntry {
  const name = (t.name || '').toLowerCase();
  let args = t.args || {};
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch { args = {}; }
  }

  if (
    name.includes('run_shell_command') || 
    name.includes('run_command') || 
    name.includes('shell') || 
    name.includes('run_code') ||
    name.includes('bash') ||
    name.includes('terminal')
  ) {
    const rawCmd = args.CommandLine || args.command || args.cmd || args.code || args.source_code || (typeof args === 'string' ? args : 'command');
    const cleanCmd = String(rawCmd).replace(/^powershell\s+-Command\s+/i, '').trim();
    const toolSummary = args.toolSummary || args.tool_summary || args.summary || args.description || (t as any).summary || null;
    return {
      id: `tool-${tIdx}`,
      type: 'command',
      data: { tool: t, cmd: cleanCmd, fullCmd: String(rawCmd), toolSummary }
    };
  } else if (name.includes('list_directory') || name.includes('list_dir') || name.includes('browse')) {
    const p = args.DirectoryPath || args.dir_path || args.path || 'directory';
    const fname = String(p).split(/[/\\]/).pop() || p;
    return {
      id: `tool-${tIdx}`,
      type: 'folder_view',
      data: { tool: t, foldername: fname, folderPath: String(p) }
    };
  } else if (name.includes('read_file') || name.includes('view_file') || name.includes('read_many_files') || name.includes('get_file')) {
    const p = args.TargetFile || args.AbsolutePath || args.file_path || args.path || 'file';
    const fname = String(p).split(/[/\\]/).pop() || p;
    const isDir = !fname.includes('.') || name.includes('list');
    if (isDir) {
      return {
        id: `tool-${tIdx}`,
        type: 'folder_view',
        data: { tool: t, foldername: fname, folderPath: String(p) }
      };
    } else {
      return {
        id: `tool-${tIdx}`,
        type: 'file_read',
        data: { tool: t, filename: fname, filePath: String(p), lineRange: extractLineRange(args) }
      };
    }
  } else if (
    name === 'replace' ||
    name.includes('replace_file_content') ||
    name.includes('write_file') ||
    name.includes('write_to_file') ||
    name.includes('edit_file') ||
    name.includes('multiedit') ||
    name.includes('apply_patch') ||
    name.includes('patch') ||
    name === 'write'
  ) {
    const p = args.TargetFile || args.AbsolutePath || args.file_path || args.path || args.target_file || args.filepath || 'file';
    const fname = String(p).split(/[/\\]/).pop() || p;
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
        lineRange: extractLineRange(args) 
      }
    };
  } else if (name.includes('search_web') || (name.includes('web') && name.includes('search'))) {
    const query = args.Query || args.query || args.search_term || args.pattern || '*';
    const toolSummary = args.toolSummary || args.description || null;
    return {
      id: `tool-${tIdx}`,
      type: 'web_search',
      data: { tool: t, query: String(query), toolSummary }
    };
  } else if (name.includes('web_fetch') || name.includes('read_url_content') || name.includes('fetch_url') || (name.includes('web') && name.includes('fetch'))) {
    const url = args.Url || args.url || args.target_url || args.link || 'url';
    const toolSummary = args.toolSummary || args.description || null;
    return {
      id: `tool-${tIdx}`,
      type: 'web_fetch',
      data: { tool: t, url: String(url), toolSummary }
    };
  } else if (
    name.includes('search') || 
    name.includes('glob') || 
    name.includes('grep') || 
    name.includes('find')
  ) {
    const pattern = args.Query || args.Pattern || args.pattern || args.query || args.search_term || '*';
    const toolSummary = args.toolSummary || args.description || null;
    let countStr = '';
    if (t.output) {
      const lines = t.output.split('\n').filter((l) => l.trim().length > 0);
      countStr = `${lines.length} result${lines.length !== 1 ? 's' : ''}`;
    }
    return {
      id: `tool-${tIdx}`,
      type: 'code_search',
      data: { tool: t, pattern: String(pattern), countStr, toolSummary }
    };
  } else if (name.includes('invoke_subagent') || name.includes('define_subagent') || (name.includes('subagent') && !name.includes('manage'))) {
    let subagentRoles: string[] = [];
    if (Array.isArray(args.Subagents)) {
      subagentRoles = args.Subagents.map((s: any) => s.Role || s.TypeName || 'Subagent');
    } else if (args.Role || args.TypeName) {
      subagentRoles = [args.Role || args.TypeName];
    }
    const roleLabel = subagentRoles.length > 0 ? subagentRoles.join(', ') : (args.toolSummary || args.description || 'Subagent');
    return {
      id: `tool-${tIdx}`,
      type: 'subagent',
      data: { tool: t, roleLabel, args }
    };
  } else if (
    name.includes('task') || 
    name.includes('manage_task')
  ) {
    const isStatusCheck = args.Action === 'status';
    let taskName = args.toolSummary || args.description || args.Prompt || '';
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
      data: { tool: t, taskName: String(taskName), isStatusCheck, action: args.Action }
    };
  } else {
    return {
      id: `tool-${tIdx}`,
      type: 'other',
      data: { tool: t }
    };
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
    if (current.type === 'search' || current.type === 'code_search' || current.type === 'file_read' || current.type === 'folder_view') {
      const group: TimelineEntry[] = [current];
      let j = i + 1;
      while (
        j < entries.length && 
        (entries[j].type === 'search' || entries[j].type === 'code_search' || entries[j].type === 'file_read' || entries[j].type === 'folder_view')
      ) {
        group.push(entries[j]);
        j++;
      }
      if (group.length > 1) {
        const isRunning = group.some(e => isToolRunning(e.data?.tool));
        const isCancelled = group.some(e => e.data?.tool?.status === 'cancelled');
        const allReads = group.every(e => e.type === 'file_read');
        const allSearches = group.every(e => e.type === 'search');
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
