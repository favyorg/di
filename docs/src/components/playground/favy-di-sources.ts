import hktSource from '../../../../di/src/lib/hkt.ts?raw';
import indexSource from '../../../../di/src/index.ts?raw';
import makeModuleSource from '../../../../di/src/lib/makeModule.ts?raw';
import moduleSource from '../../../../di/src/lib/module.ts?raw';

export type FavyDiSourceFile = Readonly<{
  packagePath: `src/${string}.ts`;
  sandboxPath: `/favy-di/${string}.ts`;
  code: string;
}>;

export const favyDiSourceFiles: readonly FavyDiSourceFile[] = [
  {
    packagePath: 'src/index.ts',
    sandboxPath: '/favy-di/index.ts',
    code: indexSource,
  },
  {
    packagePath: 'src/lib/hkt.ts',
    sandboxPath: '/favy-di/lib/hkt.ts',
    code: hktSource,
  },
  {
    packagePath: 'src/lib/makeModule.ts',
    sandboxPath: '/favy-di/lib/makeModule.ts',
    code: makeModuleSource,
  },
  {
    packagePath: 'src/lib/module.ts',
    sandboxPath: '/favy-di/lib/module.ts',
    code: moduleSource,
  },
];
