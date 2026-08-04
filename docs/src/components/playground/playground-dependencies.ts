import { parse } from 'es-module-lexer/js';

export type PlaygroundDependencyVersion = '3.0.0' | 'latest';
export type PlaygroundDependencies = Readonly<
  Record<string, PlaygroundDependencyVersion>
>;
export type DependencyResolution =
  | { readonly ok: true; readonly dependencies: PlaygroundDependencies }
  | { readonly ok: false };

const packageName = (specifier: string): string | undefined => {
  if (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('node:') ||
    specifier.startsWith('http:') ||
    specifier.startsWith('https:') ||
    specifier.startsWith('data:')
  ) {
    return undefined;
  }

  const parts = specifier.split('/');
  return specifier.startsWith('@')
    ? parts.length >= 2
      ? `${parts[0]}/${parts[1]}`
      : undefined
    : parts[0] || undefined;
};

export const resolvePlaygroundDependencies = (
  source: string,
): DependencyResolution => {
  try {
    const names = parse(source)[0]
      .map(({ n }) => (n ? packageName(n) : undefined))
      .filter((name): name is string => name !== undefined);
    const dependencies = Object.fromEntries(
      [...new Set(names)]
        .sort((left, right) => left.localeCompare(right))
        .map((name) => [name, name === '@favy/di' ? '3.0.0' : 'latest']),
    ) as Record<string, PlaygroundDependencyVersion>;
    return { ok: true, dependencies };
  } catch {
    return { ok: false };
  }
};

export const dependencySignature = (
  dependencies: PlaygroundDependencies,
): string =>
  Object.entries(dependencies)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, version]) => `${name}@${version}`)
    .join('|');
