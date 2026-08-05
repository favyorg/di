import React from 'react';
import { renderToString } from 'react-dom/server';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { Playground } from '../src/components/playground/playground';
import { playgroundExampleById } from '../src/components/playground/playground-examples';
import type {
  PlaygroundOutputUpdate,
  PlaygroundRunPhase,
  PlaygroundRunRequest,
  PlaygroundRunSettlement,
  PlaygroundSandboxProps,
  PlaygroundSandboxStatus,
} from '../src/components/playground/playground-sandbox';

let mockSandboxProps: PlaygroundSandboxProps[] = [];
let mockSandboxMounts: string[] = [];
let mockMountedSandboxes = 0;
let mockMaximumMountedSandboxes = 0;
let mockVisibleSandpackEditors = 0;
let mockTypeScriptEditorProps: any[] = [];

jest.mock('../src/components/playground/playground-sandbox', () => {
  const React = jest.requireActual<typeof import('react')>('react');

  const PlaygroundSandbox = (props: any) => {
    mockSandboxProps.push(props);
    const sandboxKey = React.useRef(props.sandboxKey);
    React.useEffect(() => {
      mockMountedSandboxes += 1;
      mockMaximumMountedSandboxes = Math.max(
        mockMaximumMountedSandboxes,
        mockMountedSandboxes
      );
      mockSandboxMounts.push(sandboxKey.current);
      return () => {
        mockMountedSandboxes -= 1;
      };
    }, []);
    return <>{props.children}</>;
  };

  return { PlaygroundSandbox };
});

jest.mock('@codesandbox/sandpack-react', () => ({
  SandpackCodeEditor: () => {
    mockVisibleSandpackEditors += 1;
    return <pre>Sandpack editor fallback</pre>;
  },
}));

jest.mock('../src/components/typescript-editor', () => {
  const React = jest.requireActual<typeof import('react')>('react');

  const TypeScriptEditor = React.forwardRef<any, any>(
    function MockTypeScriptEditor(props, ref) {
      const { ariaLabel, onChange, value } = props;
      const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
      const valueRef = React.useRef(value);
      valueRef.current = value;
      mockTypeScriptEditorProps.push(props);

      React.useImperativeHandle(
        ref,
        () => ({
          readValue: () => textareaRef.current?.value ?? valueRef.current,
          capture: () => {
            const textarea = textareaRef.current;
            if (!textarea) return undefined;
            const backward = textarea.selectionDirection === 'backward';
            return {
              hadFocus: globalThis.document.activeElement === textarea,
              anchor: backward
                ? textarea.selectionEnd
                : textarea.selectionStart,
              head: backward ? textarea.selectionStart : textarea.selectionEnd,
            };
          },
          restore: ({ hadFocus, anchor, head }: any) => {
            const textarea = textareaRef.current;
            if (!textarea) return;
            textarea.setSelectionRange(
              Math.min(anchor, head),
              Math.max(anchor, head),
              anchor > head ? 'backward' : 'forward'
            );
            if (hadFocus) textarea.focus();
          },
        }),
        []
      );

      return (
        <textarea
          ref={textareaRef}
          aria-label={ariaLabel}
          value={value}
          onChange={(event) => onChange?.(event.currentTarget.value)}
        />
      );
    }
  );

  return { TypeScriptEditor };
});

const latestSandbox = (): PlaygroundSandboxProps => {
  const props = mockSandboxProps.at(-1);
  if (!props) throw new Error('No rendered PlaygroundSandbox.');
  return props;
};

const editor = (): HTMLTextAreaElement => {
  const element = screen.getByRole('textbox', {
    name: 'TypeScript playground editor',
  });
  if (!(element instanceof HTMLTextAreaElement)) {
    throw new Error('Missing mocked TypeScript content editor.');
  }
  return element;
};

const edit = (code: string): void => {
  fireEvent.change(editor(), { target: { value: code } });
};

const latestTypingVersions = (): Record<string, string> | undefined =>
  mockTypeScriptEditorProps.at(-1)?.typingVersions;

const emitReady = (): void => {
  act(() => {
    const sandbox = latestSandbox();
    sandbox.onReady(sandbox.sandboxKey);
    sandbox.onStatus('Ready');
  });
};

const emitStatus = (status: PlaygroundSandboxStatus): void => {
  act(() => latestSandbox().onStatus(status));
};

const activeRequest = (): PlaygroundRunRequest => {
  const request = latestSandbox().runRequest;
  if (!request) throw new Error('No active playground request.');
  return request;
};

const clickRun = (): PlaygroundRunRequest => {
  fireEvent.click(screen.getByRole('button', { name: 'Run code' }));
  return activeRequest();
};

const emitPhase = (phase: PlaygroundRunPhase): void => {
  const request = activeRequest();
  act(() => latestSandbox().onPhaseChange(request.runToken, phase));
};

const emitOutput = (update: PlaygroundOutputUpdate): void => {
  act(() => latestSandbox().onOutput(update));
};

const settle = (settlement: PlaygroundRunSettlement): void => {
  act(() => {
    const sandbox = latestSandbox();
    sandbox.onStatus(
      settlement.outcome === 'completed'
        ? settlement.failed
          ? 'Failed'
          : 'Ready'
        : settlement.outcome === 'cancelled'
        ? 'Ready'
        : 'Failed'
    );
    sandbox.onSettled(settlement);
  });
};

const renderReadyPlayground = (): void => {
  render(<Playground />);
  emitReady();
};

beforeEach(() => {
  jest.useFakeTimers();
  mockSandboxProps = [];
  mockSandboxMounts = [];
  mockMountedSandboxes = 0;
  mockMaximumMountedSandboxes = 0;
  mockVisibleSandpackEditors = 0;
  mockTypeScriptEditorProps = [];
  document.documentElement.dataset.theme = 'light';
});

afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
  delete document.documentElement.dataset.theme;
});

it('renders deterministic light loading markup before hydration', () => {
  document.documentElement.dataset.theme = 'dark';

  const markup = renderToString(<Playground />);

  expect(mockSandboxProps.map(({ theme }) => theme)).toEqual(['light']);
  expect(markup).toContain('Loading editor');
});

it('follows the document theme after mounting and when it changes', async () => {
  document.documentElement.dataset.theme = 'dark';

  render(<Playground />);

  expect(mockSandboxProps[0]?.theme).toBe('light');
  expect(latestSandbox().theme).toBe('dark');

  await act(async () => {
    document.documentElement.dataset.theme = 'light';
    await Promise.resolve();
  });
  expect(latestSandbox().theme).toBe('light');
});

it('shows preparation progress and visible feedback for queued and active runs', () => {
  render(<Playground />);
  emitStatus('Starting Vite');
  expect(screen.getByRole('status').textContent).toBe('Starting Vite');

  const runButton = screen.getByRole('button', { name: 'Run code' });
  fireEvent.click(runButton);
  expect(runButton.textContent).toContain('Preparing…');
  expect(runButton.querySelector('.playground__spinner')).toBeTruthy();

  emitStatus('Installing packages');
  expect(screen.getByRole('status').textContent).toBe('Installing packages');
  expect(runButton.textContent).toContain('Preparing…');

  emitPhase('executing');
  emitStatus('Running');
  expect(runButton.textContent).toContain('Running…');
  expect(runButton.querySelector('.playground__spinner')).toBeTruthy();
});

it('exposes the playground controls and regions with accessible semantics', () => {
  renderReadyPlayground();

  expect(
    screen.getByRole('navigation', { name: 'Playground examples' })
  ).toBeTruthy();
  expect(screen.getByRole('combobox', { name: 'Example' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Reset example' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Run code' })).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('Ready');
  expect(
    screen.getByRole('region', { name: 'TypeScript playground' })
  ).toBeTruthy();
  const navigation = screen.getByRole('navigation', {
    name: 'Playground examples',
  });
  expect(within(navigation).getAllByRole('button')).toHaveLength(6);
  const selectedExample = within(navigation).getByRole('button', {
    name: 'Basic module',
    pressed: true,
  });
  expect(selectedExample.textContent).toContain(
    'Create and call one named module.'
  );
  const toolbar = screen.getByRole('toolbar', {
    name: 'Playground controls',
  });
  expect(
    within(toolbar)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'))
  ).toEqual(['Reset example', 'Run code']);
  expect(within(toolbar).getByText('Ctrl/⌘ + Enter')).toBeTruthy();
  expect(toolbar.getAttribute('aria-busy')).toBe('false');
  expect(screen.getByRole('region', { name: 'Code' })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Console output' })).toBeTruthy();
});

it('keeps the editor and console in the visible sandbox child boundary', () => {
  render(<Playground />);

  expect(latestSandbox()).toMatchObject({
    sandboxKey: '@favy/di@local',
    dependencies: { '@favy/di': 'local' },
    initialCode: playgroundExampleById.basic.source,
    theme: 'light',
    runRequest: null,
    cancelRunToken: null,
  });
  expect(editor()).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Console output' })).toBeTruthy();
  expect(mockVisibleSandpackEditors).toBe(0);
  expect(mockMountedSandboxes).toBe(1);
});

it('restores drafts and resets only the active example without running', () => {
  renderReadyPlayground();
  const basicSource = playgroundExampleById.basic.source;
  const compositionSource = playgroundExampleById.composition.source;
  const basicDraft = `${basicSource}\n// Basic draft`;
  const compositionDraft = `${compositionSource}\n// Composition draft`;

  edit(basicDraft);
  fireEvent.click(screen.getByRole('button', { name: 'Composition' }));
  expect(editor().value).toBe(compositionSource);

  edit(compositionDraft);
  fireEvent.click(screen.getByRole('button', { name: 'Basic module' }));
  expect(editor().value).toBe(basicDraft);

  fireEvent.click(screen.getByRole('button', { name: 'Reset example' }));
  expect(editor().value).toBe(basicSource);

  fireEvent.click(screen.getByRole('button', { name: 'Composition' }));
  expect(editor().value).toBe(compositionDraft);
  expect(latestSandbox().runRequest).toBeNull();
});

it('keeps one dependency session across same-signature switch and reset', () => {
  render(<Playground />);
  const mounts = [...mockSandboxMounts];

  fireEvent.click(screen.getByRole('button', { name: 'Composition' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reset example' }));
  fireEvent.click(screen.getByRole('button', { name: 'Basic module' }));

  expect(mockSandboxMounts).toEqual(mounts);
  expect(mockMaximumMountedSandboxes).toBe(1);
});

it('waits 1000 ms before replacing the dependency session', () => {
  render(<Playground />);
  edit(`${playgroundExampleById.basic.source}\nimport 'lodash/fp';`);

  act(() => jest.advanceTimersByTime(999));
  expect(mockSandboxMounts).toEqual(['@favy/di@local']);

  act(() => jest.advanceTimersByTime(1));
  expect(mockSandboxMounts).toEqual([
    '@favy/di@local',
    '@favy/di@local|lodash@latest',
  ]);
  expect(mockMaximumMountedSandboxes).toBe(1);
});

it('passes validated non-favy versions to automatic typings', () => {
  render(<Playground />);
  edit("import { z } from 'zod';\nvoid z.string();");

  act(() => jest.advanceTimersByTime(1_000));

  expect(latestTypingVersions()).toEqual({ zod: 'latest' });
});

it('keeps the prepared dependency session for an incomplete import', () => {
  renderReadyPlayground();
  const mounts = [...mockSandboxMounts];

  edit(`${playgroundExampleById.basic.source}\nimport value from '`);
  act(() => jest.advanceTimersByTime(1_000));

  expect(screen.getByRole('status').textContent).toBe('Checking imports');
  expect(
    (screen.getByRole('button', { name: 'Run code' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  expect(mockSandboxMounts).toEqual(mounts);
  expect(mockMountedSandboxes).toBe(1);
});

it('shows an unsupported import without replacing the prepared session', () => {
  renderReadyPlayground();
  const mounts = [...mockSandboxMounts];
  edit("import '_hidden';");
  act(() => jest.advanceTimersByTime(1_000));

  expect(screen.getByRole('status').textContent).toBe(
    'Unsupported import: _hidden'
  );
  emitStatus('Ready');
  expect(screen.getByRole('status').textContent).toBe(
    'Unsupported import: _hidden'
  );
  expect(mockSandboxMounts).toEqual(mounts);
});

it.each([
  ['unsupported', "import '_hidden';", 'Unsupported import: _hidden'],
  ['incomplete', "import value from '", 'Checking imports'],
])(
  'keeps a saved %s draft blocked after switching away and back',
  (_, source, expectedStatus) => {
    renderReadyPlayground();
    edit(source);
    act(() => jest.advanceTimersByTime(1_000));

    fireEvent.click(screen.getByRole('button', { name: 'Composition' }));
    fireEvent.click(screen.getByRole('button', { name: 'Basic module' }));

    expect(editor().value).toBe(source);
    expect(screen.getByRole('status').textContent).toBe(expectedStatus);
    expect(
      (screen.getByRole('button', { name: 'Run code' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(mockSandboxMounts).toEqual(['@favy/di@local']);
  }
);

it.each([
  ['incomplete', "import value from '"],
  ['malformed', "import { value as } from 'lodash';"],
])('does not run when the immediate import scan is %s', (_, source) => {
  renderReadyPlayground();
  edit(`${playgroundExampleById.basic.source}\n${source}`);

  fireEvent.click(screen.getByRole('button', { name: 'Run code' }));

  expect(latestSandbox().runRequest).toBeNull();
  expect(screen.getByRole('status').textContent).toBe('Checking imports');
});

it('queues one source snapshot while the runtime is preparing', () => {
  render(<Playground />);
  const queuedSource = `${playgroundExampleById.basic.source}\n// queued`;
  edit(queuedSource);

  const request = clickRun();

  expect(request).toEqual({
    runToken: 1,
    sandboxKey: '@favy/di@local',
    code: queuedSource,
  });
  expect(screen.getByRole('status').textContent).toBe('Preparing runtime');
  expect(
    screen.getByRole('button', { name: 'Run code' }).textContent
  ).toContain('Preparing…');
});

it('keeps the snapshot captured by an early run after later edits', () => {
  render(<Playground />);
  const queuedSource = `${playgroundExampleById.basic.source}\n// queued`;
  const laterSource = `${playgroundExampleById.basic.source}\n// later edit`;
  edit(queuedSource);

  const request = clickRun();
  edit(laterSource);

  expect(request.code).toBe(queuedSource);
  expect(activeRequest().code).toBe(queuedSource);
  expect(editor().value).toBe(laterSource);
});

it('shows matching output, clear, and truncation updates', () => {
  renderReadyPlayground();
  const request = clickRun();

  emitOutput({
    type: 'append',
    runToken: request.runToken,
    method: 'log',
    data: ['first', 1],
  });
  expect(screen.getByRole('log').textContent).toContain('first 1');

  emitOutput({ type: 'clear', runToken: request.runToken });
  emitOutput({
    type: 'append',
    runToken: request.runToken,
    method: 'warn',
    data: ['second'],
  });
  emitOutput({ type: 'truncated', runToken: request.runToken });

  expect(screen.getByRole('log').textContent).not.toContain('first 1');
  expect(screen.getByRole('log').textContent).toContain('second');
  expect(screen.getByRole('log').textContent).toContain('[Output truncated]');
});

it('renders non-JSON console values without breaking the playground', () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  renderReadyPlayground();
  const request = clickRun();

  emitOutput({
    type: 'append',
    runToken: request.runToken,
    method: 'log',
    data: [1n, circular] as any,
  });

  expect(screen.getByRole('log').textContent).toContain('1 [object Object]');
});

it('settles a child error as failed and releases the Run button', () => {
  renderReadyPlayground();
  const request = clickRun();
  emitPhase('executing');
  emitStatus('Running');
  emitOutput({
    type: 'append',
    runToken: request.runToken,
    method: 'error',
    data: ['Error: child boom'],
  });

  settle({
    runToken: request.runToken,
    outcome: 'completed',
    failed: true,
  });

  expect(screen.getByRole('log').textContent).toContain('Error: child boom');
  expect(screen.getByRole('status').textContent).toBe('Failed');
  expect(
    (screen.getByRole('button', { name: 'Run code' }) as HTMLButtonElement)
      .disabled
  ).toBe(false);
});

it.each([
  ['runtime-unavailable', 'Failed — runtime unavailable'],
  ['runtime-restarted', 'Failed — runtime restarted'],
] as const)('maps %s settlement to visible status', (outcome, expected) => {
  renderReadyPlayground();
  const request = clickRun();

  settle({ runToken: request.runToken, outcome });

  expect(screen.getByRole('status').textContent).toBe(expected);
  expect(latestSandbox().runRequest).toBeNull();
});

it('marks the controls busy while a request is active', () => {
  renderReadyPlayground();
  clickRun();

  expect(
    screen
      .getByRole('toolbar', { name: 'Playground controls' })
      .getAttribute('aria-busy')
  ).toBe('true');
});

it('defers a matured dependency replacement until the active run settles', () => {
  renderReadyPlayground();
  const request = clickRun();
  edit(`${playgroundExampleById.basic.source}\nimport 'lodash';`);

  act(() => jest.advanceTimersByTime(1_000));
  expect(mockSandboxMounts).toEqual(['@favy/di@local']);

  settle({
    runToken: request.runToken,
    outcome: 'completed',
    failed: false,
  });
  expect(mockSandboxMounts).toEqual([
    '@favy/di@local',
    '@favy/di@local|lodash@latest',
  ]);
});

it('keeps a pending import scan visible when a run completes first', () => {
  renderReadyPlayground();
  const request = clickRun();
  edit(`${playgroundExampleById.basic.source}\n// edit during run`);

  settle({
    runToken: request.runToken,
    outcome: 'completed',
    failed: false,
  });

  expect(screen.getByRole('status').textContent).toBe('Checking imports');
  act(() => jest.advanceTimersByTime(1_000));
  expect(screen.getByRole('status').textContent).toBe('Ready');
});

it('ignores output from a request cleared by example navigation', () => {
  renderReadyPlayground();
  const request = clickRun();
  const staleOutput = latestSandbox().onOutput;

  fireEvent.click(screen.getByRole('button', { name: 'Composition' }));
  act(() =>
    staleOutput({
      type: 'append',
      runToken: request.runToken,
      method: 'log',
      data: ['stale output'],
    })
  );

  expect(screen.getByRole('log').textContent).not.toContain('stale output');
});

it('allocates increasing run tokens without replacing the dependency session', () => {
  renderReadyPlayground();
  const first = clickRun();
  settle({ runToken: first.runToken, outcome: 'completed', failed: false });
  const second = clickRun();

  expect([first.runToken, second.runToken]).toEqual([1, 2]);
  expect(mockSandboxMounts).toEqual(['@favy/di@local']);
});

it('launches once under StrictMode effect replay', () => {
  render(
    <React.StrictMode>
      <Playground />
    </React.StrictMode>
  );
  emitReady();

  const request = clickRun();

  expect(request.runToken).toBe(1);
  expect(activeRequest()).toBe(request);
});

it('restores selection and focus after a dependency remount', () => {
  render(<Playground />);
  const source = `${playgroundExampleById.basic.source}\nimport 'lodash';`;
  const input = editor();
  input.focus();

  edit(source);
  input.setSelectionRange(7, 19, 'backward');
  act(() => jest.advanceTimersByTime(1_000));

  expect(editor()).not.toBe(input);
  expect(document.activeElement).toBe(editor());
  expect(editor().selectionStart).toBe(7);
  expect(editor().selectionEnd).toBe(19);
  expect(editor().selectionDirection).toBe('backward');
});

it('flushes a pending scan, remounts, and queues exactly once', () => {
  renderReadyPlayground();
  const source = `${playgroundExampleById.basic.source}\nimport 'lodash';`;
  edit(source);

  const request = clickRun();

  expect(request).toMatchObject({
    runToken: 1,
    sandboxKey: '@favy/di@local|lodash@latest',
    code: source,
  });
  expect(mockSandboxMounts).toEqual([
    '@favy/di@local',
    '@favy/di@local|lodash@latest',
  ]);
  expect(jest.getTimerCount()).toBe(0);
});

it.each([{ key: 'Control' }, { key: 'Meta' }])(
  'runs with $key+Enter',
  ({ key }) => {
    renderReadyPlayground();

    fireEvent.keyDown(editor(), {
      key: 'Enter',
      ctrlKey: key === 'Control',
      metaKey: key === 'Meta',
    });

    expect(activeRequest().runToken).toBe(1);
  }
);
