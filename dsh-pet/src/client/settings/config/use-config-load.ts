/**
 * Loading and retrying of resolved configuration: pull `GET /config` once into the page, and if failed, a
 * "retry" entry point will be given. Use AbortController to interrupt the last request when unmounting or retrying,
 * and the late response will not write the status again. Parsing and field mapping are not in this file: the pulled
 * aggregate is handed over to the caller's `onMerged` (`applyConfig` on the settings page).
 * @module dsh-pet/src/client/settings/config/use-config-load
 */
import { loadConfig } from './http.ts';
import type { MergedConfig } from './read.ts';
import type { SettingsRuntime } from '../runtime.ts';

/** When loading status: `error`, the form is disabled as a whole and retry is displayed. */
export type LoadState = 'loading' | 'ready' | 'error';

/** Loading and retrying entry point. */
export interface ConfigLoad {
  /** Current loading status. */
  loadState: LoadState;
  /** Pull it again (for button use); it will return to `loading` first. */
  retry: () => void;
}

/**
 * Pull resolved configuration.
 *
 * @param rt - Only `useState` and `useEffect` are used.
 * @param onMerged - The processing function after getting the aggregate; it must be a stable reference
 * (`useCallback`), otherwise it will be repulsed repeatedly.
 * @returns loading status and retry entry point.
 */
export function useConfigLoad(
  rt: Pick<SettingsRuntime, 'useState' | 'useEffect'>,
  onMerged: (merged: MergedConfig) => void,
): ConfigLoad {
  const { useState, useEffect } = rt;
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    void loadConfig(controller.signal)
      .then((merged) => {
        if (!alive) return;
        if (merged === null) {
          setLoadState('error');
          return;
        }
        onMerged(merged);
        setLoadState('ready');
      })
      // onMerged throws an error (the configuration shape is not available) and must also be implemented: otherwise
      // loadState will always stop at loading, the entire page will be disabled and the entry point will not be
      // retried. Go the same way as "Response Unavailable".
      .catch(() => {
        if (alive) setLoadState('error');
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [onMerged, attempt]);

  const retry = (): void => {
    setLoadState('loading');
    setAttempt((value) => value + 1);
  };

  return { loadState, retry };
}
