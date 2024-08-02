import { makeModule, withModuleName } from "./makeModule";

export const Module = makeModule({
  transformInput: withModuleName,
});

export type ModuleLive = {
  Module: {
    name: PropertyKey;
  };
};
