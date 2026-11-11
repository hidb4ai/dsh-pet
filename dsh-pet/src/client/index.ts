/**
 * Browser side bundle shell: built from tsdown to lib/client.js. It is only responsible for handing over the module
 * created by makeFactory() to the window.__ModuleLoader__ injected by the host. Not responsible for business logic;
 * relies on app.ts's factory and the module system that has been injected before loading. Must always be true: the
 * entire file is a normal side effect script and cannot have top-level ESM import / export (react is obtained from
 * require of factory).
 * @module dsh-pet/src/client/index
 */
import { makeFactory } from './app.ts';

declare const window: {
  __ModuleLoader__: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DSH injects the module-system contract f(require) => module.
    load(info: { id: string; factory: (require: (m: string) => any) => any }): void;
  };
};

window.__ModuleLoader__.load({
  id: 'dsh-pet-powercontext',
  factory: makeFactory(),
});
