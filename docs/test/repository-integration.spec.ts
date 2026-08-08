import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type PackageManifest = Readonly<{
  scripts: Readonly<Record<string, string>>;
}>;

type ProjectConfiguration = Readonly<{
  targets: Readonly<Record<string, unknown>>;
}>;

type NxConfiguration = Readonly<{
  targetDefaults: Readonly<
    Record<string, Readonly<{ outputs?: readonly string[] }>>
  >;
}>;

const workspace = path.resolve(__dirname, '../..');

const readJson = <Value>(relativePath: string): Value =>
  JSON.parse(readFileSync(path.join(workspace, relativePath), 'utf8')) as Value;

const packageJson = readJson<PackageManifest>('docs/package.json');
const project = readJson<ProjectConfiguration>('docs/project.json');
const nxJson = readJson<NxConfiguration>('nx.json');
const workflowPath = path.join(workspace, '.github/workflows/ci.yml');
const workflowSource = existsSync(workflowPath)
  ? readFileSync(workflowPath, 'utf8')
  : '';
const readmeSource = readFileSync(path.join(workspace, 'README.md'), 'utf8');
const historicalPlaygroundDesignSource = readFileSync(
  path.join(
    workspace,
    'docs/superpowers/specs/2026-08-04-interactive-playground-design.md'
  ),
  'utf8'
);

it('exposes serial Jest and managed browser smoke package scripts', () => {
  expect(packageJson.scripts).toEqual(
    expect.objectContaining({
      test: 'jest --runInBand',
      smoke: 'node scripts/run-docs-smoke.mjs',
    })
  );
  expect(
    existsSync(path.join(workspace, 'docs/scripts/run-docs-smoke.mjs'))
  ).toBe(true);
});

it('rejects an invalid managed smoke port before starting Astro', () => {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DOCS_SMOKE_PORT: '0',
  };
  delete environment.DOCS_URL;

  const result = spawnSync(
    process.execPath,
    [path.join(workspace, 'docs/scripts/run-docs-smoke.mjs')],
    {
      cwd: workspace,
      encoding: 'utf8',
      env: environment,
      timeout: 5_000,
    }
  );

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(
    'DOCS_SMOKE_PORT must be an integer from 1 through 65535'
  );
});

it('confirms only the complete expected Astro Local origin from startup stdout', () => {
  const wrapperUrl = pathToFileURL(
    path.join(workspace, 'docs/scripts/run-docs-smoke.mjs')
  ).href;
  const probe = `
    import { inspectAstroStartupOutput } from ${JSON.stringify(wrapperUrl)};

    const expectedOrigin = 'http://127.0.0.1:4399';
    process.stdout.write(JSON.stringify([
      inspectAstroStartupOutput([
        '\\u001b[2',
        'm┃\\u001b[0m Lo',
        'cal    \\u001b[36mhttp://127.0.0.1:',
        '4399/\\u001b[0m\\n',
      ], expectedOrigin),
      inspectAstroStartupOutput([
        '┃ Local    http://127.0.0.1:4400/\\n',
      ], expectedOrigin),
      inspectAstroStartupOutput([
        '┃ Local    http://127.0.0.1:439',
      ], expectedOrigin),
    ]));
  `;
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DOCS_SMOKE_PORT: '0',
  };
  delete environment.FORCE_COLOR;
  delete environment.NO_COLOR;
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', probe],
    {
      cwd: workspace,
      encoding: 'utf8',
      env: environment,
      timeout: 5_000,
    }
  );

  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([
    { status: 'confirmed', origin: 'http://127.0.0.1:4399' },
    {
      status: 'rejected',
      expectedOrigin: 'http://127.0.0.1:4399',
      actualOrigin: 'http://127.0.0.1:4400',
    },
    { status: 'pending' },
  ]);
});

it('does not accept HTTP readiness from a port Astro did not bind', async () => {
  const fixtureRoot = realpathSync(
    mkdtempSync(path.join(tmpdir(), 'docs-smoke-owner-'))
  );
  const fixtureDocs = path.join(fixtureRoot, 'docs');
  const fixtureScripts = path.join(fixtureDocs, 'scripts');
  const fixtureAstro = path.join(fixtureDocs, 'node_modules/astro');
  const marker = path.join(fixtureRoot, 'smoke-imported');
  const wrapper = path.join(fixtureScripts, 'run-docs-smoke.mjs');
  mkdirSync(fixtureScripts, { recursive: true });
  mkdirSync(fixtureAstro, { recursive: true });
  copyFileSync(
    path.join(workspace, 'docs/scripts/run-docs-smoke.mjs'),
    wrapper
  );
  writeFileSync(
    path.join(fixtureScripts, 'docs-pages-smoke.mjs'),
    `import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.DOCS_SMOKE_IMPORTED_MARKER, 'imported');\n`
  );
  writeFileSync(
    path.join(fixtureAstro, 'package.json'),
    JSON.stringify({ type: 'module' })
  );

  const portProbe = createServer();
  await new Promise<void>((resolve, reject) => {
    portProbe.once('error', reject);
    portProbe.listen(0, '127.0.0.1', resolve);
  });
  const address = portProbe.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing ownership-test port.');
  }
  await new Promise<void>((resolve, reject) =>
    portProbe.close((error) => (error ? reject(error) : resolve()))
  );
  const movedPort =
    address.port === 65_535 ? address.port - 1 : address.port + 1;
  writeFileSync(
    path.join(fixtureAstro, 'astro.js'),
    `import { createServer } from 'node:net';
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
const server = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end('unrelated server');
});
server.listen(port, '127.0.0.1', () => {
  process.stdout.write('┃ Local    http://127.0.0.1:${movedPort}/\\n');
});
const stop = () => server.close(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
`
  );

  try {
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      DOCS_SMOKE_IMPORTED_MARKER: marker,
      DOCS_SMOKE_PORT: String(address.port),
    };
    delete environment.DOCS_URL;
    const result = spawnSync(process.execPath, [wrapper], {
      cwd: fixtureRoot,
      encoding: 'utf8',
      env: environment,
      timeout: 5_000,
    });
    const output = `${result.stdout}${result.stderr}`;

    expect(result.error).toBeUndefined();
    expect(output).toContain(
      `Astro preview reported Local origin http://127.0.0.1:${movedPort}, expected http://127.0.0.1:${address.port}.`
    );
    expect(result.status).not.toBe(0);
    expect(existsSync(marker)).toBe(false);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

it('binds and inspects the execution Worker on the exact active Vite run route', () => {
  const smokeSource = readFileSync(
    path.join(workspace, 'docs/scripts/docs-pages-smoke.mjs'),
    'utf8'
  );

  expect(smokeSource).toContain(
    'const executionWorkerUrl = new URL(executionWorker.url());'
  );
  expect(smokeSource).toContain(
    'assert.equal(executionWorkerUrl.origin, externalViteOrigin);'
  );
  expect(smokeSource).toContain(
    "assert.equal(executionWorkerUrl.pathname, '/runtime-worker.ts');"
  );
  expect(smokeSource).toContain(
    String.raw`/^\?mode=run&session=(\d+)&run=(\d+)$/`
  );
  expect(smokeSource).toContain(
    "output.includes('undefined,undefined,undefined,undefined')"
  );
  expect(smokeSource).toContain('executionWorkerUrl.href');
  expect(smokeSource).toContain(
    String.raw`/\/@vite\/client|__vite__injectQuery/`
  );
});

it('surfaces Worker and module request failures during execution waits', () => {
  const smokeSource = readFileSync(
    path.join(workspace, 'docs/scripts/docs-pages-smoke.mjs'),
    'utf8'
  );

  expect(smokeSource).toContain(
    "page.on('requestfailed', collectExternalRequestFailed);"
  );
  expect(smokeSource).toContain('request.failure()?.errorText');
  expect(smokeSource).toMatch(
    /const executionWorker = await Promise\.race\(\[\s*executionWorkerPromise,\s*externalWorkerFailure,\s*\]\);/
  );
  expect(smokeSource).toMatch(
    /await Promise\.race\(\[\s*page\.waitForFunction\([\s\S]*?output\?\.includes\('workerModuleGraph'\)[\s\S]*?\),\s*externalWorkerFailure,\s*\]\);/
  );
});

it('refuses an occupied smoke port without replacing its server', async () => {
  const sentinel = createServer();
  await new Promise<void>((resolve, reject) => {
    sentinel.once('error', reject);
    sentinel.listen(0, '127.0.0.1', resolve);
  });
  const address = sentinel.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing occupied-port test address.');
  }
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DOCS_SMOKE_PORT: String(address.port),
  };
  delete environment.DOCS_URL;
  const wrapper = spawn(
    process.execPath,
    [path.join(workspace, 'docs/scripts/run-docs-smoke.mjs')],
    {
      cwd: workspace,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let output = '';
  wrapper.stdout.on('data', (chunk) => (output += String(chunk)));
  wrapper.stderr.on('data', (chunk) => (output += String(chunk)));
  const wrapperExit = new Promise<Readonly<{ code: number | null }>>(
    (resolve) => wrapper.once('exit', (code) => resolve({ code }))
  );
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = await Promise.race([
      wrapperExit,
      new Promise<never>(
        (_resolve, reject) =>
          (timeout = setTimeout(
            () =>
              reject(new Error('Occupied-port wrapper did not exit in 3s.')),
            3_000
          ))
      ),
    ]);
    expect(result.code).not.toBe(0);
    expect(output).toContain(
      `Smoke preview port ${address.port} is already in use before Astro preview startup.`
    );
    expect(sentinel.listening).toBe(true);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (wrapper.exitCode === null && wrapper.signalCode === null) {
      wrapper.kill('SIGKILL');
      await wrapperExit;
    }
    await new Promise<void>((resolve, reject) =>
      sentinel.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

it('defines smoke as an explicit non-cacheable Nx target after docs build', () => {
  expect(project.targets.smoke).toEqual(
    expect.objectContaining({
      executor: 'nx:run-commands',
      cache: false,
      dependsOn: ['build'],
      options: { command: 'npm --prefix docs run smoke' },
    })
  );
  expect(project.targets.test).toBeUndefined();
});

it('declares the Astro build output at the project dist directory', () => {
  expect(nxJson.targetDefaults['@nxtensions/astro:build'].outputs).toContain(
    '{projectRoot}/dist'
  );
});

it('discovers CI only from the GitHub Actions workflow directory', () => {
  expect(existsSync(workflowPath)).toBe(true);
  expect(existsSync(path.join(workspace, 'workflows/ci.yml'))).toBe(false);
});

it('runs the clean docs release gates in their required order', () => {
  expect(workflowSource).toContain(`on:
  push:
    branches:
      - main
  pull_request:`);
  expect(workflowSource).toContain(`    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: |
            package-lock.json
            docs/package-lock.json
      - run: npm ci
      - run: npm ci
        working-directory: docs
      - uses: nrwl/nx-set-shas@v4
      - run: npx nx affected -t lint test build
      - run: npx playwright install --with-deps chromium
        working-directory: docs
      - run: npx nx build docs --skip-nx-cache
      - run: npx nx run docs:smoke --skip-nx-cache`);
});

it('prominently routes README readers to the standalone playground', () => {
  expect(readmeSource).toContain(
    '## Documentation\n\n- [Playground](https://di.favy.dev/playground/)'
  );
});

it('routes obsolete playground decisions to all superseding designs', () => {
  const supersededNotice = historicalPlaygroundDesignSource.slice(
    0,
    historicalPlaygroundDesignSource.indexOf('## Goal')
  );

  expect(supersededNotice).toContain('**Superseded decisions:**');
  expect(supersededNotice).toContain(
    '[playground prewarm design](2026-08-04-playground-prewarm-design.md)'
  );
  expect(supersededNotice).toContain(
    '[playground type-hover design](2026-08-05-playground-type-hover-design.md)'
  );
  expect(supersededNotice).toContain(
    '[standalone playground design](2026-08-05-standalone-playground-design.md)'
  );
  expect(supersededNotice).toContain(
    '[playground merge-hardening design](2026-08-05-playground-merge-hardening-design.md)'
  );
});
