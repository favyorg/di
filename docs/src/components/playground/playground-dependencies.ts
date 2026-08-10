import { parse as parseTypeScript, type ParserOptions } from '@babel/parser';
import jsTokens, { type Token } from 'js-tokens';

export type PlaygroundDependencyVersion = 'local' | 'latest';
export type PlaygroundDependencies = Readonly<
  Record<string, PlaygroundDependencyVersion>
>;
export type DependencyResolution =
  | { readonly kind: 'ready'; readonly dependencies: PlaygroundDependencies }
  | { readonly kind: 'incomplete' }
  | { readonly kind: 'unsupported'; readonly specifier: string };

const URI_SCHEME = /^[A-Za-z][A-Za-z\d+.-]*:/;
const PACKAGE_NAME =
  /^(?:@[-A-Za-z\d][A-Za-z\d._~-]*\/)?[-A-Za-z\d][A-Za-z\d._~-]*$/;

export const isNpmPackageName = (name: string): boolean =>
  name.length <= 214 && PACKAGE_NAME.test(name);

const PARSER_OPTIONS: ParserOptions = {
  allowUndeclaredExports: true,
  createImportExpressions: true,
  plugins: [
    ['importAttributes', { deprecatedAssertSyntax: true }],
    'decorators-legacy',
    'typescript',
  ],
  sourceType: 'module',
};

type SourceToken = {
  readonly token: Token;
  readonly start: number;
  readonly end: number;
};

const tokensFor = (source: string): SourceToken[] => {
  let offset = 0;
  return Array.from(jsTokens(source), (token) => {
    const positioned = {
      token,
      start: offset,
      end: offset + token.value.length,
    };
    offset = positioned.end;
    return positioned;
  });
};

const isTrivia = ({ token }: SourceToken): boolean =>
  token.type === 'WhiteSpace' ||
  token.type === 'LineTerminatorSequence' ||
  token.type.endsWith('Comment');

const nextCodeToken = (tokens: SourceToken[], start: number): number => {
  let index = start + 1;
  while (index < tokens.length && isTrivia(tokens[index])) index += 1;
  return index;
};

const nestingDelta = ({ token }: SourceToken): number => {
  if (token.type === 'TemplateHead') return 1;
  if (token.type === 'TemplateTail') return -1;
  if (token.type !== 'Punctuator') return 0;
  if ('{[('.includes(token.value)) return 1;
  if ('}])'.includes(token.value)) return -1;
  return 0;
};

const hasLineBreak = ({ token }: SourceToken): boolean =>
  token.type === 'LineTerminatorSequence' ||
  (token.type === 'MultiLineComment' && /[\n\r\u2028\u2029]/.test(token.value));

const isStaticLiteral = ({ token }: SourceToken): boolean =>
  token.type === 'StringLiteral' || token.type === 'NoSubstitutionTemplate';

const MODULE_SOURCE_NODES = new Set([
  'ExportAllDeclaration',
  'ExportNamedDeclaration',
  'ImportDeclaration',
  'ImportExpression',
]);

const staticStringValue = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const node = value as Record<string, unknown>;
  if (node.type === 'StringLiteral' && typeof node.value === 'string') {
    return node.value;
  }
  if (
    node.type === 'TemplateLiteral' &&
    Array.isArray(node.expressions) &&
    node.expressions.length === 0 &&
    Array.isArray(node.quasis)
  ) {
    const first = node.quasis[0] as
      | { value?: { cooked?: unknown } }
      | undefined;
    if (typeof first?.value?.cooked === 'string') return first.value.cooked;
  }
  return undefined;
};

const hasOnlyTypeSpecifiers = (
  node: Record<string, unknown>,
  kind: 'exportKind' | 'importKind'
): boolean =>
  Array.isArray(node.specifiers) &&
  node.specifiers.length > 0 &&
  node.specifiers.every(
    (specifier) =>
      !!specifier &&
      typeof specifier === 'object' &&
      (specifier as Record<string, unknown>)[kind] === 'type'
  );

const isTypeOnlyModuleReference = (node: Record<string, unknown>): boolean =>
  node.type === 'TSImportType' ||
  (node.type === 'ImportDeclaration' &&
    (node.importKind === 'type' ||
      hasOnlyTypeSpecifiers(node, 'importKind'))) ||
  ((node.type === 'ExportAllDeclaration' ||
    node.type === 'ExportNamedDeclaration') &&
    (node.exportKind === 'type' ||
      (node.type === 'ExportNamedDeclaration' &&
        hasOnlyTypeSpecifiers(node, 'exportKind'))));

const collectSpecifiers = (
  value: unknown,
  names: string[],
  runtimeOnly = false
): void => {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((child) => collectSpecifiers(child, names, runtimeOnly));
    return;
  }

  const node = value as Record<string, unknown>;
  const specifier =
    runtimeOnly && isTypeOnlyModuleReference(node)
      ? undefined
      : MODULE_SOURCE_NODES.has(String(node.type))
      ? node.source
      : node.type === 'TSImportType'
      ? node.argument
      : undefined;
  const name = staticStringValue(specifier);
  if (name !== undefined) names.push(name);

  for (const [key, child] of Object.entries(node)) {
    if (key !== 'loc' && key !== 'extra') {
      collectSpecifiers(child, names, runtimeOnly);
    }
  }
};

const parseSpecifiers = (
  source: string,
  runtimeOnly = false
): string[] | undefined => {
  try {
    const names: string[] = [];
    collectSpecifiers(
      parseTypeScript(source, PARSER_OPTIONS),
      names,
      runtimeOnly
    );
    return names;
  } catch {
    return undefined;
  }
};

const exportDependencyIntent = (
  tokens: SourceToken[],
  startIndex: number,
  endIndex: number
): boolean => {
  let clauseIndex = nextCodeToken(tokens, startIndex);
  if (tokens[clauseIndex]?.token.value === 'type') {
    clauseIndex = nextCodeToken(tokens, clauseIndex);
  }
  const clause = tokens[clauseIndex]?.token.value;
  const reexportShape = clause === '{' || clause === '*';
  let nesting = 0;
  let sawFrom = false;
  let sawLiteral = false;

  for (let index = clauseIndex; index < endIndex; index += 1) {
    const current = tokens[index];
    if (isTrivia(current)) continue;
    if (nesting === 0) {
      if (current.token.value === 'from') sawFrom = true;
      if (isStaticLiteral(current)) sawLiteral = true;
    }
    nesting = Math.max(0, nesting + nestingDelta(current));
  }
  return reexportShape && (sawFrom || sawLiteral);
};

const staticStatementSpecifiers = (
  source: string,
  tokens: SourceToken[],
  startIndex: number,
  kind: 'export' | 'import'
): string[] | undefined => {
  const start = tokens[startIndex].start;
  let nesting = 0;
  for (let index = startIndex; index < tokens.length; index += 1) {
    const current = tokens[index];
    nesting = Math.max(0, nesting + nestingDelta(current));
    const semicolon = current.token.value === ';';
    if (nesting === 0 && (semicolon || hasLineBreak(current))) {
      const end = semicolon ? current.end : current.start;
      const specifiers = parseSpecifiers(source.slice(start, end));
      const continuation =
        tokens[nextCodeToken(tokens, index)]?.token.value ?? '';
      const continuesStatement =
        ['assert', 'from', 'with'].includes(continuation) ||
        (kind === 'export' && ['*', 'type', '{'].includes(continuation));
      if (specifiers && (semicolon || !continuesStatement)) {
        return specifiers;
      }
      const hasDependencyIntent =
        kind === 'import' ||
        exportDependencyIntent(tokens, startIndex, index + 1);
      if (semicolon) return hasDependencyIntent ? undefined : [];
      if (!hasDependencyIntent && !continuesStatement) {
        return [];
      }
    }
  }
  const specifiers = parseSpecifiers(source.slice(start));
  if (specifiers) return specifiers;
  return kind === 'export' &&
    !exportDependencyIntent(tokens, startIndex, tokens.length)
    ? []
    : undefined;
};

const hasDirectLiteralArgument = (
  tokens: SourceToken[],
  openingIndex: number,
  closingIndex: number
): boolean => {
  let nesting = 0;
  let firstArgument = true;
  let expression = tokens
    .slice(openingIndex + 1, closingIndex)
    .filter((current) => {
      if (isTrivia(current)) return false;
      if (!firstArgument) return false;
      if (nesting === 0 && current.token.value === ',') {
        firstArgument = false;
        return false;
      }
      nesting = Math.max(0, nesting + nestingDelta(current));
      return true;
    });

  while (
    expression[0]?.token.value === '(' &&
    expression.at(-1)?.token.value === ')'
  ) {
    let depth = 0;
    const wrapsExpression = expression.every((current, index) => {
      if (current.token.value === '(') depth += 1;
      if (current.token.value === ')') depth -= 1;
      return depth > 0 || index === expression.length - 1;
    });
    if (!wrapsExpression) break;
    expression = expression.slice(1, -1);
  }
  return expression.length === 1 && isStaticLiteral(expression[0]);
};

const dynamicImportSpecifiers = (
  source: string,
  tokens: SourceToken[],
  importIndex: number
): string[] | undefined => {
  const openingIndex = nextCodeToken(tokens, importIndex);
  let nesting = 0;
  for (let index = openingIndex; index < tokens.length; index += 1) {
    const current = tokens[index];
    if (current.token.type !== 'Punctuator') continue;
    if (current.token.value === '(') nesting += 1;
    if (current.token.value === ')' && --nesting === 0) {
      // Only literal imports change Sandpack dependencies. Its compiler reports
      // syntax errors in runtime-computed imports after the user presses Run.
      if (!hasDirectLiteralArgument(tokens, openingIndex, index)) return [];
      return parseSpecifiers(
        source.slice(tokens[importIndex].start, current.end)
      );
    }
  }
  return undefined;
};

type ModuleSpecifiers = Readonly<{
  specifiers: readonly string[];
  incomplete: boolean;
}>;

const moduleSpecifiers = (source: string): ModuleSpecifiers => {
  const completeProgram = parseSpecifiers(source);
  if (completeProgram) {
    return { specifiers: completeProgram, incomplete: false };
  }

  const tokens = tokensFor(source);
  const names: string[] = [];
  let nesting = 0;
  let statementStart = true;
  let previousCode = '';

  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index];
    const topLevel = nesting === 0;
    if (isTrivia(current)) {
      if (topLevel && hasLineBreak(current)) statementStart = true;
      continue;
    }

    const nextIndex = nextCodeToken(tokens, index);
    const next = tokens[nextIndex]?.token.value;
    const propertyAccess = previousCode === '.' || previousCode === '?.';
    const dynamicImport =
      current.token.value === 'import' && next === '(' && !propertyAccess;
    if (dynamicImport) {
      const specifiers = dynamicImportSpecifiers(source, tokens, index);
      if (!specifiers) return { specifiers: names, incomplete: true };
      names.push(...specifiers);
    } else if (topLevel && statementStart) {
      const staticModule =
        (current.token.value === 'import' &&
          next !== '(' &&
          next !== '.' &&
          !propertyAccess) ||
        (current.token.value === 'export' && !propertyAccess);
      if (staticModule) {
        const specifiers = staticStatementSpecifiers(
          source,
          tokens,
          index,
          current.token.value === 'export' ? 'export' : 'import'
        );
        if (!specifiers) return { specifiers: names, incomplete: true };
        names.push(...specifiers);
      }
    }

    const previousNesting = nesting;
    nesting = Math.max(0, nesting + nestingDelta(current));
    const closedTopLevelBlock =
      previousNesting > 0 &&
      nesting === 0 &&
      current.token.type === 'Punctuator' &&
      current.token.value === '}';
    statementStart =
      (topLevel && current.token.value === ';') || closedTopLevelBlock;
    previousCode = current.token.value;
  }
  return { specifiers: names, incomplete: false };
};

type PackageSpecifier =
  | { readonly kind: 'ignored' }
  | { readonly kind: 'package'; readonly name: string }
  | { readonly kind: 'unsupported'; readonly specifier: string };

const classifySpecifier = (specifier: string): PackageSpecifier => {
  if (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('#') ||
    URI_SCHEME.test(specifier)
  ) {
    return { kind: 'ignored' };
  }

  const parts = specifier.split('/');
  const name = specifier.startsWith('@')
    ? parts.length >= 2
      ? `${parts[0]}/${parts[1]}`
      : specifier
    : parts[0];
  return isNpmPackageName(name)
    ? { kind: 'package', name }
    : { kind: 'unsupported', specifier };
};

export const isNpmPackageSpecifier = (specifier: string): boolean =>
  classifySpecifier(specifier).kind === 'package';

export const resolvePlaygroundWarmupImports = (
  source: string
): readonly string[] => {
  const specifiers = parseSpecifiers(source, true);
  if (!specifiers) return [];
  return [...new Set(specifiers.filter(isNpmPackageSpecifier))].sort(
    (left, right) => left.localeCompare(right)
  );
};

export const resolvePlaygroundDependencies = (
  source: string
): DependencyResolution => {
  const { specifiers, incomplete } = moduleSpecifiers(source);
  const packages: string[] = [];
  for (const specifier of specifiers) {
    const classified = classifySpecifier(specifier);
    if (classified.kind === 'unsupported') return classified;
    if (classified.kind === 'package') packages.push(classified.name);
  }
  if (incomplete) return { kind: 'incomplete' };

  const dependencies = Object.fromEntries(
    [...new Set(packages)]
      .sort((left, right) => left.localeCompare(right))
      .map((name) => [name, name === '@favy/di' ? 'local' : 'latest'])
  ) as Record<string, PlaygroundDependencyVersion>;
  return { kind: 'ready', dependencies };
};

export const dependencySignature = (
  dependencies: PlaygroundDependencies
): string =>
  Object.entries(dependencies)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, version]) => `${name}@${version}`)
    .join('|');
