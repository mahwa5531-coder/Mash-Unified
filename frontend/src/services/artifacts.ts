// Session artifacts: deliverable files and working papers for the explorer panel.

import { BASE_URL, safeFetch } from './client';

export interface ArtifactFileItem {
  name: string;
  path: string;
  type: 'walkthrough' | 'plan' | 'doc' | 'code' | 'sheet';
  group?: 'deliverables' | 'working_papers';
  size?: number;
  mtime?: number;
}

export interface SessionArtifactsData {
  isProjectSession: boolean;
  deliverables: ArtifactFileItem[];
  workingPapers: ArtifactFileItem[];
  deliverablesDirectory?: string;
  workingPapersDirectory?: string;
  projectDirectory?: string;
  brainDirectory?: string;
  items: ArtifactFileItem[];
}

function parseArtifactItem(raw: any, defaultGroup: 'deliverables' | 'working_papers' = 'working_papers'): ArtifactFileItem {
  const name = raw.name || raw.path?.split(/[/\\]/).pop() || '';
  const lower = name.toLowerCase();
  let type: 'walkthrough' | 'plan' | 'doc' | 'code' | 'sheet' = 'doc';
  if (lower.includes('walkthrough')) type = 'walkthrough';
  else if (lower.includes('plan')) type = 'plan';
  else if (/\.(xlsx?|csv|xlsm)$/.test(lower)) type = 'sheet';
  else if (/\.(py|ts|tsx|js|sql|sh|ps1|json|ya?ml)$/.test(lower)) type = 'code';

  return {
    name,
    path: raw.path || '',
    type,
    group: raw.group || defaultGroup,
    size: raw.size,
    mtime: raw.mtime,
  };
}

export async function fetchSessionArtifactsData(sessionId: string): Promise<SessionArtifactsData> {
  const empty: SessionArtifactsData = {
    isProjectSession: false,
    deliverables: [],
    workingPapers: [],
    items: [],
  };

  try {
    const res = await safeFetch(`${BASE_URL}/artifacts/session/${encodeURIComponent(sessionId)}`);
    if (!res.ok) return empty;
    const data = await res.json();

    const isProjectSession = Boolean(data.is_project_session);
    const deliverables: ArtifactFileItem[] = Array.isArray(data.deliverables)
      ? data.deliverables.map((it: any) => parseArtifactItem(it, 'deliverables'))
      : [];
    const workingPapers: ArtifactFileItem[] = Array.isArray(data.working_papers)
      ? data.working_papers.map((it: any) => parseArtifactItem(it, 'working_papers'))
      : [];

    let items: ArtifactFileItem[] = [];
    if (data.items && Array.isArray(data.items)) {
      items = data.items.map((it: any) => parseArtifactItem(it));
    } else {
      items = [...deliverables, ...workingPapers];
    }

    return {
      isProjectSession,
      deliverables,
      workingPapers,
      deliverablesDirectory: data.deliverables_directory,
      workingPapersDirectory: data.working_papers_directory,
      projectDirectory: data.project_directory,
      brainDirectory: data.brain_directory,
      items,
    };
  } catch (err) {
    console.warn("Failed to fetch session artifacts data:", err);
    return empty;
  }
}

export async function fetchSessionArtifacts(sessionId: string): Promise<ArtifactFileItem[]> {
  const data = await fetchSessionArtifactsData(sessionId);
  return data.items;
}
