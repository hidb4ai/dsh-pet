/**
 * Mounting points for built-in gameplay "eat for nothing": overlays, styles, menu items and click distribution.
 *
 * Directly mounted by apply of app.ts, without registering the second client module - the startup image of DSH is
 * declared according to the package. factory of the second load in the same bundle will not be executed by any line
 * materialize, and apply will never run. The covering layer is carried by the shell.overlay slot (see baifan/layer.ts)
 * and is not hung on the body itself. Menu register and go to HTTP (/ config to determine the gameplay, / menu/item to
 * the host), click to read the Cordis service `petApi7340.menuEvents` in the page: local reading of the same click, no
 * need to go around for long polling.
 * @module dsh-pet/src/client/baifan
 */
import { CSS, OWNER, ROOT_ID, ROUTE, STYLE_TAG } from './baifan/constants.ts';
import { createMenu } from './baifan/menu.ts';
import { createScene } from './baifan/scene.ts';
import { createShow, type Show } from './baifan/show.ts';
import { createTransport } from './baifan/transport.ts';

/** Click polling interval (milliseconds): Memory Map is read, and the interval only determines the maximum delay from click to response. */
const POLL_MS = 150;

/** Retry interval (milliseconds) after menu register failure: DSH Restarting will clear the host's register table. */
const RETRY_MS = 5000;

/** A subset of client context used by this module. */
export interface BaifanContext {
  /** Get the Cordis service in the page (service name → instance); if missing, return undefined. */
  get: (name: string) => unknown;
}

/**
 * Inject stylesheet (only once).
 *
 * @returns is the newly inserted tag this time; if it already exists, it will return null (other people’s tags will
 * not be deleted when unmounting).
 */
function injectCss(): HTMLStyleElement | null {
  if (document.querySelector('style[data-plugin-css="' + STYLE_TAG + '"]') !== null) return null;
  const tag = document.createElement('style');
  tag.dataset.plugin = OWNER;
  tag.dataset.pluginCss = STYLE_TAG;
  tag.textContent = CSS;
  document.head.appendChild(tag);
  return tag;
}

/**
 * Mount "eat for nothing": build overlays, register menus, and click to read the clicks in the page.
 *
 * @param ctx - client context; only used to obtain the read-only service `petApi7340` .
 * @param host - Overlay container, provided by the shell.overlay slot; cannot pass `document.body` .
 * @returns unmount hook: Unmount the menu, stop polling, and clear the overlay.
 */
export function mountBaifan(ctx: BaifanContext, host: HTMLElement): () => void {
  const abort = new AbortController();

  const style = injectCss();
  const layer = document.createElement('div');
  layer.id = ROOT_ID;
  const toastEl = document.createElement('div');
  toastEl.className = 'bf-toast';
  layer.appendChild(toastEl);
  host.appendChild(layer);

  const scene = createScene(layer, toastEl);
  const transport = createTransport(ctx);
  const show: Show = createShow({ transport, scene });
  const menu = createMenu({
    get: (name) => ctx.get(name),
    transport,
    show,
    signal: abort.signal,
    retryMs: RETRY_MS,
  });

  void menu
    .ensureMenu()
    .catch((error: unknown) => console.warn('[dsh-pet] Rice interaction menu registration failed ' + String(error)));
  const timer = window.setInterval(menu.tick, POLL_MS);

  return () => {
    menu.dispose();
    window.clearInterval(timer);
    void show.halt('');
    // Send DELETE first and then abort: abort will cause the deletion to fail immediately, leaving a menu item that will not disappear until TTL.
    void fetch(ROUTE + '/menu/item?owner=' + encodeURIComponent(OWNER), { method: 'DELETE' }).catch(() => {});
    abort.abort();
    layer.remove();
    if (style !== null) style.remove();
  };
}
