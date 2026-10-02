import { basicLessons } from './lessons-basics';
import { runtimeLessons } from './lessons-runtime';
import { applicationLessons } from './lessons-applications';
import { extensionLessons } from './lessons-extensions';
import type { PlaygroundProject } from './project-types';
export type { PlaygroundProject } from './project-types';

export const playgroundProjects: readonly PlaygroundProject[] = [
  ...basicLessons,
  ...runtimeLessons,
  ...applicationLessons,
  ...extensionLessons,
];
export const projectById: Readonly<Record<string, PlaygroundProject>> =
  Object.fromEntries(
    playgroundProjects.map((project) => [project.id, project])
  );
export const lessonSections = [
  ...new Set(playgroundProjects.map(({ section }) => section)),
];
