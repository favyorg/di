import {
  makeModule,
  type DefaultModuleFactory,
  withModuleName,
} from './makeModule';

export type ModuleLive = {
  Module: { name: PropertyKey };
};

export const Module = makeModule({
  transformInput: withModuleName,
}) as DefaultModuleFactory;
