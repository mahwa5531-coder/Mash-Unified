// Projects: CRUD + local folder selection/resolution + directory browsing.

import { BASE_URL, safeFetch } from './client';

export interface ProjectItem {
  id: string;
  name: string;
  local_folder_path: string;
  created_at?: string;
  session_count?: number;
}

export async function fetchProjects(): Promise<ProjectItem[]> {
  try {
    const res = await safeFetch(`${BASE_URL}/api/projects`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.projects || [];
  } catch {
    return [];
  }
}

export async function createProject(name: string, localFolderPath: string): Promise<ProjectItem | null> {
  try {
    const res = await safeFetch(`${BASE_URL}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, local_folder_path: localFolderPath }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn("Failed to create project:", err);
    return null;
  }
}

export async function createQuickProject(name: string): Promise<ProjectItem | null> {
  try {
    const res = await safeFetch(`${BASE_URL}/api/projects/quick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn("Failed to create quick project:", err);
    return null;
  }
}

export async function renameProject(projectId: string, name: string): Promise<boolean> {
  try {
    const res = await safeFetch(`${BASE_URL}/api/projects/${projectId}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    return res.ok;
  } catch (err) {
    console.warn("Failed to rename project:", err);
    return false;
  }
}

export async function deleteProject(projectId: string): Promise<boolean> {
  try {
    const res = await safeFetch(`${BASE_URL}/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch (err) {
    console.warn("Failed to delete project:", err);
    return false;
  }
}

export async function selectFolder(folderPath?: string): Promise<{
  status: string;
  folder_path: string | null;
  folder_name: string | null;
  detail?: string;
}> {
  try {
    const res = await safeFetch(`${BASE_URL}/api/system/select-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(folderPath ? { folder_path: folderPath } : {}),
    });
    if (!res.ok) return { status: 'error', folder_path: null, folder_name: null };
    return await res.json();
  } catch (err) {
    console.warn("Failed to open folder dialog:", err);
    return { status: 'error', folder_path: null, folder_name: null };
  }
}

export async function resolveFolder(folderName: string, sampleChildren?: string[]): Promise<{
  status: string;
  folder_path: string;
  folder_name: string;
}> {
  try {
    const res = await safeFetch(`${BASE_URL}/api/system/resolve-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_name: folderName, sample_children: sampleChildren }),
    });
    if (!res.ok) return { status: 'error', folder_path: '', folder_name: folderName };
    return await res.json();
  } catch (err) {
    console.warn("Failed to resolve folder:", err);
    return { status: 'error', folder_path: '', folder_name: folderName };
  }
}
