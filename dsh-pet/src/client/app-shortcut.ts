/**
 * Application-level shortcut key register shell: softly retrieve the `shortcuts` service, expand the default key
 * position according to the environment file, and only lose the shortcut key if it fails.
 *
 * The shortcut key service of DSH may not exist on the old host, and the register may also be rejected (the key
 * position does not match the Web whitelist, id or the key position conflicts). In both cases, only this one command
 * will disappear and will not slow down the plugin loading. The key positions are always "one command, one key":
 * instead of giving different default values by desktop/web page, you have to change them in settings. The same
 * service also provides a reading interface for "currently effective keycaps": after the user changes the binding, the
 * display must change accordingly, and the default value cannot be read again.
 * @module dsh-pet/src/client/app-shortcut
 */

/** A physical key: `primary` expands into Command on macOS, and Control on other platforms. */
export interface ShortcutBinding {
  /** Physical key code (`KeyboardEvent.code`), such as `KeyL`. */
  readonly code: string;
  readonly modifiers: readonly string[];
}

/** Display name of modifier key: `primary` Expand by platform. */
const MODIFIER_LABELS: Readonly<Record<string, string>> = {
  alt: 'Alt',
  control: 'Ctrl',
  meta: 'Cmd',
  shift: 'Shift',
};

/**
 * Convert bindings into human-readable keycaps (such as `Ctrl+Shift+L` ).
 *
 * Only for menu and setting page display; `primary` is Command on macOS, and Control on other platforms.
 *
 * @param binding - Declared binding.
 * @returns keycap copy connected to `+` .
 */
export function keycapOf(binding: ShortcutBinding): string {
  const isMac = /Mac/i.test(navigator.platform || navigator.userAgent);
  const modifiers = binding.modifiers.map((modifier) =>
    modifier === 'primary' ? (isMac ? 'Cmd' : 'Ctrl') : (MODIFIER_LABELS[modifier] ?? modifier),
  );
  return [...modifiers, binding.code.replace(/^Key/, '')].join('+');
}

/** A row in the directory: only take the two fields needed for display. */
interface ShortcutCatalogRow {
  readonly id: string;
  /** The keycap fragment has been expanded according to the platform, such as `['Ctrl', '+', 'Shift', '+', 'L']`; macOS is the symbol without `+`. */
  readonly keys: readonly string[];
}

/** The read-only side of the directory; the snapshot will change after the user changes the binding. */
interface ShortcutCatalog {
  getSnapshot(): readonly ShortcutCatalogRow[];
  subscribe(listener: () => void): () => void;
}

/** The minimum shape of the shortcut key service (declared according to the members used, without citing the entire package type). */
interface ShortcutsService {
  /** The directory is an additional side for display, and the old host may not have it. */
  readonly catalog?: ShortcutCatalog;
  register(command: {
    readonly id: string;
    readonly label: () => string;
    readonly aliases: readonly string[];
    readonly defaults: Readonly<Record<string, unknown>>;
    readonly regions: readonly string[];
    readonly modals: readonly string[];
    resolve: (
      context: unknown,
    ) => { status: 'handled'; run(): void } | { status: 'blocked'; reason: string } | { status: 'pass' };
  }): () => void;
}

/** register required context (only soft fetch service is used). */
export interface ShortcutHost {
  /** Soft retrieval of Cordis: Unable to obtain undefined. */
  get?(name: string): unknown;
}

/**
 * Environment file for default key positions.
 *
 * **Excluding `web:linux` **: DSH has a whitelist for Web side shortcut keys, Linux only allows a few fixed
 * combinations, and assigning it ordinary combinations will cause the entire register to be rejected. Users of that
 * environment can bind it themselves in the settings.
 */
export const SHORTCUT_PROFILES = [
  'desktop:macos',
  'desktop:windows',
  'desktop:linux',
  'web:macos',
  'web:windows',
] as const;

/** The definition of a command: the register shell only cares about these four things. */
export interface AppShortcut {
  /** Command id, take `<domain>.<action>`; repeated register will be rejected by the service. */
  readonly id: string;
  /** Set the title displayed on the page; lazy evaluation, it will be recalculated after switching languages. */
  readonly label: () => string;
  readonly binding: ShortcutBinding;
  /** Action performed when triggered. */
  readonly run: () => void;
}

/**
 * register an application-level shortcut key.
 *
 * @param ctx - client context.
 * @param shortcut - Command definition.
 * @returns `registered` indicates whether the registration is really successful; `dispose` is used for logout (empty
 * function when failed),
 * When getting `registered: false` , the caller cannot give commandId to other places - pointing to a non-existent
 * command will cause the other party's register to throw an error.
 */
export function registerAppShortcut(
  ctx: ShortcutHost,
  shortcut: AppShortcut,
): { registered: boolean; dispose: () => void } {
  const shortcuts = ctx.get?.('shortcuts') as ShortcutsService | undefined;
  if (shortcuts === undefined || typeof shortcuts.register !== 'function') {
    console.warn('[dsh-pet] Shortcut service unavailable; "' + shortcut.id + '" was not registered');
    return { registered: false, dispose: () => {} };
  }
  try {
    const defaults = Object.fromEntries(SHORTCUT_PROFILES.map((profile) => [profile, shortcut.binding]));
    const dispose = shortcuts.register({
      id: shortcut.id,
      label: shortcut.label,
      aliases: [],
      defaults,
      // Must contain editable: As soon as the floating dialogue is opened, the focus is put into its own input box,
      // and subsequent keystrokes will be judged as editable. If write-only page is pressed for the second time, the
      // pop-up window will not be closed, nor will preventDefault - the browser's native action will still be
      // executed.
      regions: ['page', 'editable'],
      modals: [],
      resolve: () => ({ status: 'handled', run: shortcut.run }),
    });
    return { registered: true, dispose: () => dispose() };
  } catch (error) {
    // register rejected (key position not accepted / id conflict): only this shortcut key is lost
    console.warn('[dsh-pet] Shortcut registration failed:' + (error instanceof Error ? error.message : String(error)));
    return { registered: false, dispose: () => {} };
  }
}

/**
 * Read the keycap currently in effect for a command.
 *
 * After the user changes the binding in "Settings → Shortcut Keys", the default combination is no longer true, and the
 * display must be requested by the service.
 *
 * @param ctx - client context.
 * @param id - command id.
 * @returns keycap (such as `Ctrl+Shift+L` ); when undefined is not registered, changed to conflict, clear or host has
 * no directory.
 */
export function readShortcutKeycap(ctx: ShortcutHost, id: string): string | undefined {
  const catalog = (ctx.get?.('shortcuts') as ShortcutsService | undefined)?.catalog;
  if (catalog === undefined) return undefined;
  const row = catalog.getSnapshot().find((item) => item.id === id);
  return row === undefined || row.keys.length === 0 ? undefined : row.keys.join('');
}

/**
 * Subscribe key position changes: changing binding, restoring to default, and clear will all trigger.
 *
 * @param ctx - client context.
 * @param listener - change callback; only cares about "re-reading" and does not receive snapshots.
 * @returns unregister function; it is an empty function when host has no directory.
 */
export function subscribeShortcutKeycaps(ctx: ShortcutHost, listener: () => void): () => void {
  const catalog = (ctx.get?.('shortcuts') as ShortcutsService | undefined)?.catalog;
  if (catalog === undefined) return () => {};
  return catalog.subscribe(listener);
}
