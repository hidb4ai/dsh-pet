/**
 * Host data pulled once when the page is opened: persist to disk location list (`/config/meta`) and candidate model
 * list (`/models`). The two requests are independent of each other and do not block the form if they fail: the absence
 * of meta only affects the two path cards, and the absence of the candidate list only affects the drop-down box. By
 * the way, the judgment of "component has been unmounted" is left in hook to avoid requesting to come back and write
 * status to the dead component.
 * @module dsh-pet/src/client/settings/use-remote-data
 */
import { type ConfigMeta, loadMeta, loadModelCatalog } from './config/index.ts';
import type { ModelCatalogGroup } from './picker/index.ts';
import type { SettingsRuntime } from './runtime.ts';

/** The result of one-time pull. */
export interface RemoteData {
  /** Path and storage list; `null` = Not obtained yet or failed to read. */
  paths: ConfigMeta | null;
  /** Candidate model list; `null` = Not available yet or failed to access. */
  catalog: ModelCatalogGroup[] | null;
  /** Failed to pull the candidate list (the drop-down box should display a line of prompts). */
  catalogFailed: boolean;
}

/**
 * Pull meta information and candidate list.
 *
 * @param rt - Only `useState` and `useEffect` are used.
 * @returns Three read-only results.
 */
export function useRemoteData(rt: Pick<SettingsRuntime, 'useState' | 'useEffect'>): RemoteData {
  const { useState, useEffect } = rt;
  const [paths, setPaths] = useState<ConfigMeta | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalogGroup[] | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadMeta().then((meta) => {
      if (alive) setPaths(meta);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void loadModelCatalog().then((groups) => {
      if (!alive) return;
      if (groups === null) setCatalogFailed(true);
      else setCatalog(groups);
    });
    return () => {
      alive = false;
    };
  }, []);

  return { paths, catalog, catalogFailed };
}
