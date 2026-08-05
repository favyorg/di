import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';

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
  const environment = { ...process.env, DOCS_SMOKE_PORT: '0' };
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
  const environment = {
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
