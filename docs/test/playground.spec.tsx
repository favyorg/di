import React from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { Playground } from '../src/components/playground/playground';
import { playgroundExampleById } from '../src/components/playground/playground-examples';

type MockSandpackMessage =
  | { type: 'done'; compilatonError: false }
  | { type: 'action'; action: 'show-error' };

type MockSandpackContext = {
  code: string;
  setCode(code: string): void;
  runSandpack: jest.Mock<Promise<void>, []>;
  listen(listener: (message: MockSandpackMessage) => void): () => void;
};

let mockEvents: string[] = [];
let mockMountedProviders = 0;
let mockMaximumMountedProviders = 0;
let mockConsoleMountCounter = 0;

jest.mock('@codesandbox/sandpack-react', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const SandpackContext = React.createContext<any>(null);

  const useMockSandpack = () => {
    const context = React.useContext(SandpackContext);
    if (!context) throw new Error('Missing mocked SandpackProvider');
    return context;
  };

  const signatureFor = (dependencies: Record<string, string>): string =>
    Object.entries(dependencies)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, version]) => `${name}@${version}`)
      .join('|');

  const SandpackProvider = ({ children, customSetup, files }: any) => {
    const signature = signatureFor(customSetup.dependencies);
    const [code, setCode] = React.useState(files['/index.ts']);
    const listeners = React.useRef(new Set<(mockMessage: any) => void>());
    const runSandpack = React.useMemo(
      () =>
        jest.fn(async () => {
          mockEvents.push(`run:${signature}`);
          setTimeout(() => {
            listeners.current.forEach((listener) =>
              listener({ type: 'done', compilatonError: false })
            );
          }, 0);
        }),
      [signature]
    );
    const listen = React.useCallback(
      (mockListener: (mockMessage: any) => void) => {
        listeners.current.add(mockListener);
        return () => listeners.current.delete(mockListener);
      },
      []
    );

    React.useEffect(() => {
      mockMountedProviders += 1;
      mockMaximumMountedProviders = Math.max(
        mockMaximumMountedProviders,
        mockMountedProviders
      );
      mockEvents.push(`mount:${signature}`);
      return () => {
        mockEvents.push(`unmount:${signature}`);
        mockMountedProviders -= 1;
      };
    }, [signature]);

    const value = React.useMemo(
      () => ({ code, setCode, runSandpack, listen }),
      [code, listen, runSandpack]
    );
    return (
      <SandpackContext.Provider value={value}>
        {children}
      </SandpackContext.Provider>
    );
  };

  const SandpackCodeEditor = React.forwardRef<any, any>(
    function MockSandpackCodeEditor(_props, ref) {
      const { code, setCode } = useMockSandpack();
      const textareaRef = React.useRef<any>(null);

      React.useImperativeHandle(ref, () => ({
        getCodemirror: () => {
          const textarea = textareaRef.current;
          if (!textarea) return undefined;
          return {
            get hasFocus() {
              return globalThis.document.activeElement === textarea;
            },
            state: {
              selection: {
                main: {
                  anchor: textarea.selectionStart,
                  head: textarea.selectionEnd,
                },
              },
            },
            dispatch: (mockTransaction: any) =>
              textarea.setSelectionRange(
                mockTransaction.selection.anchor,
                mockTransaction.selection.head
              ),
            focus: () => textarea.focus(),
          };
        },
      }));

      return (
        <textarea
          ref={textareaRef}
          aria-label="TypeScript playground editor"
          value={code}
          onChange={(event) => setCode(event.currentTarget.value)}
        />
      );
    }
  );

  const SandpackConsole = () => {
    const [mountId] = React.useState(() => ++mockConsoleMountCounter);
    return (
      <div aria-label="Console output" data-mount-id={mountId.toString()} />
    );
  };

  return {
    SandpackCodeEditor,
    SandpackConsole,
    SandpackProvider,
    useActiveCode: () => {
      const context = useMockSandpack();
      return {
        code: context.code,
        readOnly: false,
        updateCode: context.setCode,
      };
    },
    useSandpack: () => {
      const context = useMockSandpack();
      return {
        sandpack: { runSandpack: context.runSandpack },
        listen: context.listen,
      };
    },
  };
});

const editor = (): HTMLTextAreaElement =>
  screen.getByLabelText('TypeScript playground editor');

const consoleMountId = (): string | null =>
  screen.getByLabelText('Console output').getAttribute('data-mount-id');

const mountEvents = (): string[] =>
  mockEvents.filter((event) => event.startsWith('mount:'));

beforeEach(() => {
  jest.useFakeTimers();
  mockEvents = [];
  mockMountedProviders = 0;
  mockMaximumMountedProviders = 0;
  mockConsoleMountCounter = 0;
  document.documentElement.dataset.theme = 'light';
});

afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
  delete document.documentElement.dataset.theme;
});

it('stays ready through StrictMode effect replay', () => {
  render(
    <React.StrictMode>
      <Playground />
    </React.StrictMode>
  );

  expect(screen.getByRole('status').textContent).toBe('Ready');
  expect(mockEvents.filter((event) => event.startsWith('run:'))).toEqual([]);
  expect(jest.getTimerCount()).toBe(0);
});

it('mounts one provider, restores drafts, and resets only the active example', () => {
  render(<Playground />);
  const basicSource = playgroundExampleById.basic.source;
  const compositionSource = playgroundExampleById.composition.source;
  const basicDraft = `${basicSource}\n// Basic draft`;
  const compositionDraft = `${compositionSource}\n// Composition draft`;
  const initialConsole = consoleMountId();

  fireEvent.change(editor(), { target: { value: basicDraft } });
  fireEvent.click(screen.getByRole('button', { name: 'Composition' }));
  expect(editor().value).toBe(compositionSource);
  expect(consoleMountId()).not.toBe(initialConsole);

  fireEvent.change(editor(), { target: { value: compositionDraft } });
  fireEvent.click(screen.getByRole('button', { name: 'Basic module' }));
  expect(editor().value).toBe(basicDraft);
  const consoleBeforeReset = consoleMountId();

  fireEvent.click(screen.getByRole('button', { name: 'Reset example' }));
  expect(editor().value).toBe(basicSource);
  expect(consoleMountId()).not.toBe(consoleBeforeReset);

  fireEvent.click(screen.getByRole('button', { name: 'Composition' }));
  expect(editor().value).toBe(compositionDraft);
  expect(mockMountedProviders).toBe(1);
  expect(mockMaximumMountedProviders).toBe(1);
  expect(mockEvents.filter((event) => event.startsWith('run:'))).toEqual([]);
});

it('waits 1000 ms before remounting for a valid new import', () => {
  render(<Playground />);
  fireEvent.change(editor(), {
    target: {
      value: `${playgroundExampleById.basic.source}\nimport 'lodash/fp';`,
    },
  });

  act(() => jest.advanceTimersByTime(999));
  expect(mountEvents()).toEqual(['mount:@favy/di@3.0.0']);

  act(() => jest.advanceTimersByTime(1));
  expect(mountEvents()).toEqual([
    'mount:@favy/di@3.0.0',
    'mount:@favy/di@3.0.0|lodash@latest',
  ]);
  expect(mockMaximumMountedProviders).toBe(1);
});

it('keeps the last valid dependency generation for an incomplete import', () => {
  render(<Playground />);
  const initialConsole = consoleMountId();

  fireEvent.change(editor(), {
    target: {
      value: `${playgroundExampleById.basic.source}\nimport value from '`,
    },
  });
  act(() => jest.advanceTimersByTime(1000));

  expect(mountEvents()).toEqual(['mount:@favy/di@3.0.0']);
  expect(consoleMountId()).toBe(initialConsole);
  expect(mockMountedProviders).toBe(1);
});

it('restores selection and focus after a dependency remount', () => {
  render(<Playground />);
  fireEvent.change(editor(), {
    target: {
      value: `${playgroundExampleById.basic.source}\nimport 'lodash/fp';`,
    },
  });
  editor().focus();
  editor().setSelectionRange(10, 20);

  act(() => jest.advanceTimersByTime(1000));
  act(() => jest.advanceTimersByTime(0));

  expect(document.activeElement).toBe(editor());
  expect(editor().selectionStart).toBe(10);
  expect(editor().selectionEnd).toBe(20);
});

it('flushes a pending scan, remounts, and runs exactly once', async () => {
  render(<Playground />);
  fireEvent.change(editor(), {
    target: {
      value: `${playgroundExampleById.basic.source}\nimport 'lodash/fp';`,
    },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Run code' }));
  await act(async () => jest.runAllTimersAsync());

  const dependencyMount = 'mount:@favy/di@3.0.0|lodash@latest';
  const run = 'run:@favy/di@3.0.0|lodash@latest';
  expect(mockEvents.indexOf(dependencyMount)).toBeLessThan(
    mockEvents.indexOf(run)
  );
  expect(mockEvents.filter((event) => event.startsWith('run:'))).toEqual([
    'run:@favy/di@3.0.0|lodash@latest',
  ]);
  expect(mockMaximumMountedProviders).toBe(1);
});

it.each([{ key: 'Control' }, { key: 'Meta' }])(
  'runs with $key+Enter',
  async ({ key }) => {
    render(<Playground />);
    const shortcut = {
      key: 'Enter',
      ctrlKey: key === 'Control',
      metaKey: key === 'Meta',
    };

    fireEvent.keyDown(editor(), shortcut);
    fireEvent.keyDown(editor(), shortcut);
    await act(async () => jest.runAllTimersAsync());

    expect(mockEvents.filter((event) => event.startsWith('run:'))).toEqual([
      'run:@favy/di@3.0.0',
    ]);
  }
);
