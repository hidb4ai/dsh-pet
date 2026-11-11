/**
 * "Eat for nothing" menu and playback request trigger: register host menu item, click to read and click, and start the
 * show according to configuration.
 *
 * The click source is the Cordis service `petApi7340.menuEvents` (read and consume) in the page, and there is no long
 * polling around HTTP; only the menu register goes through HTTP. Restarting DSH will clear the host's register table,
 * so when owner is not in the snapshot, the register will be filled in at intervals.
 * @module dsh-pet/src/client/baifan/menu
 */
import { activityAssets } from './assets.ts';
import { ACTIVITY, LABEL, OWNER } from './constants.ts';
import type { Show } from './show.ts';
import type { Transport } from './transport.ts';

/** The minimum shape of the click source on the page: `ok: false` means that this owner does not have a menu item on this page. */
interface MenuEventSource {
  /** Read and consume: all marks are cleared to null after return. */
  menuEvents?: (owner: string) => { ok: boolean; events?: Record<string, string | null> };
}

/** Dependence of menu and playback request. */
export interface MenuDeps {
  /** Get the Cordis service in the page (service name → instance); if missing, return undefined. */
  get: (name: string) => unknown;
  /** Transport layer; adjust the interface to use its `call`, with timeout and signal forwarding. */
  transport: Transport;
  /** Performance; start the performance after finding the belonging entry. */
  show: Show;
  /** Mount level cancellation signal: menu register should not be canceled by the end of a single show. */
  signal: AbortSignal;
  /** Register interval (milliseconds): Press it to try again when owner is not in the snapshot. */
  retryMs: number;
}

/**
 * Create a menu controller.
 *
 * @param deps - see {@link MenuDeps} .
 * @returns one-shot entry point, first register and unmount hook.
 */
export function createMenu(deps: MenuDeps) {
  /** The last time register was attempted (`performance.now()`); compare with `retryMs` to decide whether to make up for it. */
  let registeredAt = 0;
  let disposed = false;

  /** Click once to read the page; if the service is missing (old version dsh-pet) or owner has not entered the snapshot, it will return null. */
  function readMarks(): Record<string, string | null> | null {
    const api = deps.get('petApi7340') as MenuEventSource | undefined;
    const read = api?.menuEvents;
    if (typeof read !== 'function') return null;
    const result = read.call(api, OWNER);
    return result.ok === true && result.events ? result.events : null;
  }

  /** Only the main entry configured with animations.baifan can be registered, otherwise this pet does not have this gameplay. */
  async function ensureMenu(): Promise<void> {
    const cfg = await deps.transport.call('GET', '/config', undefined, deps.signal);
    const main = cfg.main;
    if (!main || typeof main !== 'object') return;
    const animations = (main as Record<string, unknown>).animations;
    if (!animations || typeof animations !== 'object') return;
    if ((animations as Record<string, unknown>)[ACTIVITY] === undefined) return;
    const r = await deps.transport.call(
      'POST',
      '/menu/item',
      { owner: OWNER, labels: [LABEL], target: 'web' },
      deps.signal,
    );
    if (r.ok === true) registeredAt = performance.now();
  }

  /** One shot: read click; if owner is not in the snapshot, register at intervals. */
  function tick(): void {
    if (disposed) return;
    const marks = readMarks();
    if (marks === null) {
      // No items = not registered yet, or the host register table is empty after DSH restarts; retry at intervals without waiting for the next click.
      if (performance.now() - registeredAt > deps.retryMs) {
        registeredAt = performance.now();
        void ensureMenu().catch(() => {});
      }
      return;
    }
    const pet = marks[LABEL];
    if (typeof pet === 'string') void launch(pet);
  }

  /**
   * According to the entry of the clicked pet, take the name of five animations and start the performance; if the
   * configuration cannot be found, it will not play.
   *
   * The 5 animation names come from the animations.baifan of this entry - different pets can use different actions,
   * which is the meaning of the existence of the configuration item; the asset address is spelled by the renderer of
   * each end based on the asset root of the pet, and the client only passes the name here.
   */
  async function launch(petId: string): Promise<void> {
    try {
      const cfg = await deps.transport.call('GET', '/config', undefined, deps.signal);
      for (const raw of Object.values(cfg)) {
        if (!raw || typeof raw !== 'object') continue;
        const conf = raw as Record<string, unknown>;
        const pets = conf.pets;
        if (!Array.isArray(pets)) continue;
        const owns = pets.some(
          (item) => item !== null && typeof item === 'object' && (item as Record<string, unknown>).id === petId,
        );
        if (!owns) continue;
        const animations = conf.animations;
        const names =
          animations && typeof animations === 'object' ? (animations as Record<string, unknown>)[ACTIVITY] : undefined;
        if (!Array.isArray(names)) return;
        const slots = names.filter((name): name is string => typeof name === 'string');
        deps.show.start(petId, activityAssets(slots));
        return;
      }
    } catch (error) {
      console.warn('[dsh-pet] Rice interaction startup failed ' + String(error));
    }
  }

  return {
    /** One shot: click to read, register if necessary. */
    tick,
    /** Register menu item for the first time; nothing will be done if there is no such gameplay in the configuration. */
    ensureMenu,
    /** Stop subsequent shooting; the request has been sent by `signal` cleanup. */
    dispose: (): void => {
      disposed = true;
    },
  };
}
