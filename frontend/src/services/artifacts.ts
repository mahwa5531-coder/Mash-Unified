// Session artifacts: deliverable files for the explorer panel.

import { BASE_URL, safeFetch } from './client';

export interface ArtifactFileItem {
  name: string;
  path: string;
  type: 'walkthrough' | 'plan' | 'doc' | 'code';
}

export async function fetchSessionArtifacts(sessionId: string): Promise<ArtifactFileItem[]> {
  try {
    const res = await safeFetch(`${BASE_URL}/artifacts/session/${encodeURIComponent(sessionId)}`);
    if (!res.ok) return [];
    const data = await res.json();
    if (data.items && Array.isArray(data.items)) {
      return data.items.map((item: any) => {
        const lower = (item.name || '').toLowerCase();
        let type: 'walkthrough' | 'plan' | 'doc' | 'code' = 'doc';
        if (lower.includes('walkthrough')) type = 'walkthrough';
        else if (lower.includes('plan')) type = 'plan';
        else if (/\.(py|ts|tsx|js|sql|sh|ps1)$/.test(lower)) type = 'code';
        return {
          name: item.name,
          path: item.path,
          type,
        };
      });
    }
    const files: string[] = data.files || [];
    const brainDir: string = data.brain_directory || '';
    const projectDir: string = data.project_directory || '';
    return files.map(f => {
      const lower = f.toLowerCase();
      let type: 'walkthrough' | 'plan' | 'doc' | 'code' = 'doc';
      if (lower.includes('walkthrough')) type = 'walkthrough';
      else if (lower.includes('plan')) type = 'plan';
      else if (/\.(py|ts|tsx|js|sql|sh|ps1)$/.test(lower)) type = 'code';
      const baseDir = (f.startsWith('Audit_Deliverables') || f.startsWith('NexAU_Outputs')) && projectDir ? projectDir : brainDir;
      return {
        name: f.split(/[/\\]/).pop() || f,
        path: baseDir ? `${baseDir}/${f}`.replace(/\\/g, '/') : f,
        type,
      };
    });
  } catch (err) {
    console.warn("Failed to fetch session artifacts:", err);
    return [];
  }
}
