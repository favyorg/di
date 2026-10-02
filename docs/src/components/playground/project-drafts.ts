import type { PlaygroundProject } from './playground-projects';
import { isPlaygroundSourceWithinLimit } from './playground-runtime';

export type ProjectDraft = {
  files: Record<string, string>;
  activeFile: string;
};

const drafts = new Map<string, ProjectDraft>();
const keyFor = (id: string) => `favy-playground-project:v1:${id}`;

export const projectWithinLimit = (files: Readonly<Record<string, string>>) =>
  isPlaygroundSourceWithinLimit(Object.values(files).join('\n'));

export function readProjectDraft(project: PlaygroundProject): ProjectDraft {
  const original = {
    files: { ...project.files },
    activeFile: project.activeFile,
  };
  const cached = drafts.get(project.id);
  if (cached) return cached;
  try {
    const stored: unknown = JSON.parse(
      sessionStorage.getItem(keyFor(project.id)) ?? 'null'
    );
    if (!stored || typeof stored !== 'object' || !('files' in stored))
      return original;
    const files = stored.files;
    if (!files || typeof files !== 'object') return original;
    const paths = Object.keys(project.files);
    if (Object.keys(files).length !== paths.length) return original;
    if (
      !paths.every(
        (path) =>
          Object.hasOwn(files, path) &&
          typeof Reflect.get(files, path) === 'string'
      )
    )
      return original;
    const restored = Object.fromEntries(
      paths.map((path) => [path, Reflect.get(files, path) as string])
    );
    if (!projectWithinLimit(restored)) return original;
    return {
      files: restored,
      activeFile:
        'activeFile' in stored &&
        typeof stored.activeFile === 'string' &&
        paths.includes(stored.activeFile)
          ? stored.activeFile
          : project.activeFile,
    };
  } catch {
    return original;
  }
}

export function saveProjectDraft(
  project: PlaygroundProject,
  draft: ProjectDraft
) {
  drafts.set(project.id, draft);
  const pristine = Object.keys(project.files).every(
    (path) => draft.files[path] === project.files[path]
  );
  try {
    if (!pristine && projectWithinLimit(draft.files))
      sessionStorage.setItem(keyFor(project.id), JSON.stringify(draft));
    else sessionStorage.removeItem(keyFor(project.id));
  } catch {
    // Editing and switching still work when browser storage is unavailable.
  }
}

export function resetProjectDraft(id: string) {
  drafts.delete(id);
  try {
    sessionStorage.removeItem(keyFor(id));
  } catch {
    /* Storage is optional. */
  }
}
