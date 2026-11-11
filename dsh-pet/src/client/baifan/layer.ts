/**
 * Slot carrier for the "free rice" overlay: hook the imperative overlay into shell.overlay of DSH.
 *
 * The overlay must live in [ data-shell-overlay ] of AppFrame and cannot be attached to body by itself: body's direct
 * children will hit the no-drag rule written by the host for macOS and drag the title bar into a dead zone;
 * shell.overlay is the officially designated all-application floating layer seat and comes with z-index:20 Stacking
 * context, the overlay is therefore only pressed on the desktop pet and will not jump over the host modal box.
 * @module dsh-pet/src/client/baifan/layer
 */
import type * as ReactNS from 'react';
import type { jsx } from 'react/jsx-runtime';

/** Injected react capabilities: only take the three used by this component. */
export interface LayerRuntime {
  /** Create element. */
  h: typeof jsx;
  /** Quote: The container node must survive across renderings and be cleared accordingly when unmounting. */
  useRef: <T>(initial: T) => ReactNS.MutableRefObject<T>;
  /** side effect: Mounting and cleaning appear in pairs. */
  useEffect: (effect: ReactNS.EffectCallback, deps?: ReactNS.DependencyList) => void;
}

/**
 * Build slot assembly.
 *
 * @param rt - Injected react capability.
 * @param mount - Unmount hook to unmount the overlay on the given container.
 * @returns can register components of `shell.overlay` .
 */
export function makeBaifanLayer(rt: LayerRuntime, mount: (host: HTMLDivElement) => () => void) {
  return function BaifanLayer(): ReactNS.ReactNode {
    const ref = rt.useRef<HTMLDivElement | null>(null);
    rt.useEffect(() => {
      const host = ref.current;
      if (host === null) return undefined;
      return mount(host);
      // The empty dependency is intentional: the container only appears once when mounting, and the overlay manages
      // the internal state by itself, and does not follow the parent component to re-render and re-hang - re-hanging
      // will rebuild the entire state of rice and scores.
    }, []);
    return rt.h('div', { ref });
  };
}
