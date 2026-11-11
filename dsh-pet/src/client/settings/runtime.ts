/**
 * Set the runtime dependencies of the page component: react capabilities and translation functions, injected by the
 * host when `__ModuleLoader__` is assembled. The browser side is in the form of a single file bundle. react can only
 * be provided by the host, so the components are all received by the factory and are not directly import. The only
 * dependencies are `h` , four hook and `t` ; the component is not allowed to obtain a second translation source, nor
 * is it allowed to read react on the global `window` .
 * @module dsh-pet/src/client/settings/runtime
 */
import type { Dispatch, SetStateAction } from 'react';
import type * as ReactNS from 'react';
import type { jsx } from 'react/jsx-runtime';

/** Set the runtime dependencies of the page; each sub-component only takes the ones it uses as needed. */
export interface SettingsRuntime {
  h: typeof jsx;
  useState: <T>(init: T) => [T, Dispatch<SetStateAction<T>>];
  // Use React namespace type instead of typeof: type-only import of hook cannot enter declaration export (TS4078)
  useEffect: (effect: ReactNS.EffectCallback, deps?: ReactNS.DependencyList) => void;
  useRef: <T>(initial: T) => ReactNS.MutableRefObject<T>;
  useCallback: typeof ReactNS.useCallback;
  /** Copy translation; the key is taken from `zh` in the dictionary on this page. */
  t: (key: string) => string;
}
