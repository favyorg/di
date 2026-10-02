import { useEffect, useMemo, useRef, useState } from 'react';
import {
  SandpackFileExplorer,
  SandpackProvider,
  useSandpack,
} from '@codesandbox/sandpack-react';
import * as Tabs from '@radix-ui/react-tabs';
import {
  playgroundProjects,
  projectById,
  type PlaygroundProject,
} from './playground-projects';
import { ProjectEditor, type ProjectEditorRuntime } from './project-editor';
import { useExampleRunner } from '../example-runner';
import {
  projectWithinLimit,
  readProjectDraft,
  resetProjectDraft,
  saveProjectDraft,
} from './project-drafts';
import './project-playground.css';

type Theme = 'light' | 'dark';
const emptyModels: ProjectEditorRuntime['models'] = new Map();

function selectedProject() {
  const id = new URL(window.location.href).searchParams.get('example');
  return id && Object.hasOwn(projectById, id) ? id : playgroundProjects[0].id;
}

export function ProjectPlayground() {
  const [selectedId, setSelectedId] = useState(playgroundProjects[0].id);
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState<Theme>('light');
  const [reset, setReset] = useState(0);

  useEffect(() => {
    const select = () => setSelectedId(selectedProject());
    const updateTheme = () =>
      setTheme(
        document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
      );
    select();
    updateTheme();
    setReady(true);
    window.addEventListener('popstate', select);
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => {
      window.removeEventListener('popstate', select);
      observer.disconnect();
    };
  }, []);

  const select = (id: string) => {
    if (!Object.hasOwn(projectById, id) || selectedId === id) return;
    const url = new URL(window.location.href);
    url.searchParams.set('example', id);
    window.history.pushState(null, '', url);
    setSelectedId(id);
  };
  const project = projectById[selectedId];
  const index = playgroundProjects.findIndex(({ id }) => id === selectedId);

  return (
    <section className="project-playground" aria-label="Project playground">
      <div className="project-catalog">
        <div className="project-catalog__select">
          <label htmlFor="project-example">Lesson</label>
          <select
            id="project-example"
            value={selectedId}
            onChange={(event) => select(event.target.value)}
          >
            {playgroundProjects.map(({ id, title }, index) => (
              <option key={id} value={id}>
                {index + 1}. {title}
              </option>
            ))}
          </select>
        </div>
        <nav className="project-pagination" aria-label="Example pages">
          <button
            type="button"
            aria-label="Previous example"
            disabled={index === 0}
            onClick={() => select(playgroundProjects[index - 1].id)}
          >
            ← Previous
          </button>
          <span aria-live="polite">
            {index + 1} / {playgroundProjects.length}
          </span>
          <button
            type="button"
            aria-label="Next example"
            disabled={index === playgroundProjects.length - 1}
            onClick={() => select(playgroundProjects[index + 1].id)}
          >
            Next →
          </button>
        </nav>
        <a className="project-basics-link" href="/playground/basics/">
          More examples ↗
        </a>
      </div>
      <div className="project-intro">
        <div>
          <h2>{project.title}</h2>
          <p>{project.description}</p>
        </div>
        <span className="project-kind">{project.concept}</span>
      </div>
      <p className="project-exercise">
        <strong>Try it:</strong> {project.exercise}
      </p>
      {ready ? (
        <ProjectSession
          key={`${project.id}:${reset}`}
          project={project}
          theme={theme}
          onReset={() => {
            resetProjectDraft(project.id);
            setReset((generation) => generation + 1);
          }}
        />
      ) : (
        <div className="project-loading" role="status">
          Loading workspace…
        </div>
      )}
    </section>
  );
}

function ProjectSession({
  project,
  theme,
  onReset,
}: {
  project: PlaygroundProject;
  theme: Theme;
  onReset(): void;
}) {
  const [draft] = useState(() => readProjectDraft(project));
  const [options] = useState(() => ({
    autorun: false,
    autoReload: false,
    activeFile: draft.activeFile,
    visibleFiles: Object.keys(project.files),
  }));
  return (
    <SandpackProvider
      className="project-editor-provider"
      template="vite"
      files={draft.files}
      options={options}
      theme={theme}
    >
      <ProjectWorkspace project={project} onReset={onReset} />
    </SandpackProvider>
  );
}

function ProjectWorkspace({
  project,
  onReset,
}: {
  project: PlaygroundProject;
  onReset(): void;
}) {
  const { sandpack } = useSandpack();
  const [runFiles, setRunFiles] = useState<Record<string, string>>();
  const [runtime, setRuntime] = useState<ProjectEditorRuntime>();
  const [filesOpen, setFilesOpen] = useState(false);
  const [opened, setOpened] = useState([sandpack.activeFile]);
  const discardingDraft = useRef(false);
  const files = useMemo(
    () =>
      Object.fromEntries(
        Object.keys(project.files).map((path) => [
          path,
          sandpack.files[path].code,
        ])
      ),
    [project.files, sandpack.files]
  );
  const draft = useRef({ files, activeFile: sandpack.activeFile });
  draft.current = { files, activeFile: sandpack.activeFile };
  const withinLimit = projectWithinLimit(files);
  const runner = useExampleRunner({
    entry: project.entry,
    monaco: runtime?.monaco,
    models: runtime?.models ?? emptyModels,
  });
  const changed =
    runFiles &&
    Object.keys(files).some((path) => files[path] !== runFiles[path]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!discardingDraft.current) saveProjectDraft(project, draft.current);
    }, 250);
    return () => clearTimeout(timeout);
  }, [files, sandpack.activeFile, project]);

  useEffect(() => {
    const flush = () => {
      if (!discardingDraft.current) saveProjectDraft(project, draft.current);
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [project]);

  useEffect(() => {
    setOpened((current) =>
      current.includes(sandpack.activeFile)
        ? current
        : [...current, sandpack.activeFile]
    );
  }, [sandpack.activeFile]);

  const start = () => {
    if (!withinLimit || !runtime || runner.busy) return;
    setRunFiles({ ...files });
    void runner.start();
  };
  const active = sandpack.activeFile;
  return (
    <div
      className="project-session"
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          start();
        }
      }}
    >
      <div
        className="project-toolbar"
        role="toolbar"
        aria-label="Project controls"
      >
        <button
          className="project-files-toggle"
          type="button"
          aria-expanded={filesOpen}
          aria-controls="project-file-tree"
          onClick={() => setFilesOpen((open) => !open)}
        >
          Files
        </button>
        <button
          className="project-run"
          type="button"
          disabled={!withinLimit || !runtime || runner.busy}
          onClick={start}
        >
          ▶ Run
        </button>
        <button type="button" disabled={!runner.busy} onClick={runner.stop}>
          Stop
        </button>
        <button
          type="button"
          onClick={() => {
            discardingDraft.current = true;
            onReset();
          }}
        >
          Reset example
        </button>
        <span className="project-run-status" role="status">
          {!withinLimit
            ? 'Project exceeds the 64 KiB limit.'
            : changed
            ? 'Changes ready to run'
            : runner.status || 'Run to see the output'}
        </span>
        <span className="project-shortcut">⌘ / Ctrl + Enter</span>
      </div>
      <div className="project-workspace">
        <aside
          id="project-file-tree"
          className="project-file-tree"
          data-open={filesOpen}
          aria-label="Project files"
        >
          <h3>
            Files <span>{Object.keys(files).length}</span>
          </h3>
          <SandpackFileExplorer autoHiddenFiles />
          <p>Edits stay in this tab.</p>
        </aside>
        <Tabs.Root
          className="project-code"
          value={active}
          onValueChange={(path) => sandpack.setActiveFile(path)}
        >
          <Tabs.List className="project-tabs" aria-label="Open files">
            {opened.map((path) => (
              <Tabs.Trigger
                className="project-tab"
                key={path}
                value={path}
                title={path}
              >
                {path.split('/').at(-1)}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <Tabs.Content
            className="project-code-panel"
            value={active}
            tabIndex={-1}
          >
            <ProjectEditor
              projectId={project.id}
              files={files}
              activeFile={active}
              onSelect={(path) => sandpack.setActiveFile(path)}
              onChange={(path, code) => sandpack.updateFile(path, code, false)}
              onReady={setRuntime}
            />
          </Tabs.Content>
          <div className="project-file-path">{active}</div>
        </Tabs.Root>
        <div className="project-result" aria-label="Project result">
          {runFiles ? (
            runner.output
          ) : (
            <div className="project-empty">
              <span className="project-empty__icon" aria-hidden="true">
                ▷
              </span>
              <h3>Console output</h3>
              <p>Press Run to execute app.ts. The output will appear here.</p>
              <button
                type="button"
                disabled={!withinLimit || !runtime}
                onClick={start}
              >
                Run example →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
