/**
 * Shortcut key card: Split the keys into two groups - the pet's own hover keys, and the global shortcut keys
 * distributed by DSH.
 *
 * The hover key is the plugin's own monitoring, and it directly reads the constants of each module; the key position
 * of the global shortcut key can be changed by the user, and you must ask DSH for the current value - otherwise, after
 * changing the binding, the card will still read the default combination. Grouping is not a typesetting preference:
 * the two sets of keys are dispatched by different codes and have different validity conditions (hover vs anywhere on
 * the page). They are mixed in one table and the reader cannot tell the reason why there is no response after pressing
 * them. Like other reference cards at the end of the page, they are collapsed by default; purely for display, the open
 * and closed state only lives in the component.
 * @module dsh-pet/src/client/settings/shortcuts-card
 */
import type { FunctionComponent } from 'react';
import { HEAR_HOTKEY_HINT } from '../../shared/chat/hear-hold.ts';
import { CAPTURE_HOTKEY_HINT, CHAT_HOTKEY_HINT } from '../../shared/chat/hotkey.ts';
import { DISPLAY_HOTKEY_HINTS } from '../../shared/display-hotkey.ts';
import { SLEEP_HOTKEY_HINT } from '../../shared/sleep-hotkey.ts';
import { TODO_HOTKEY_HINT } from '../../shared/todo/hotkey.ts';
import { keycapOf, subscribeShortcutKeycaps, type ShortcutHost } from '../app-shortcut.ts';
import { petChatShortcutKeycap } from '../chat/shortcut.ts';
import { petShortcutKeycap } from '../pet/card/shortcut.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit } from './ui.ts';

/** id for collapsed text: paired with `aria-controls` for title button. */
const BODY_ID = 'pet-cfg-shortcuts';

/** Paste is not our register command. The keycaps are derived according to the platform (macOS is ⌘ V), and the character string is not hard-coded. */
const PASTE_KEYCAP = keycapOf({ code: 'KeyV', modifiers: ['primary'] });

/** The current keycaps for the three rebindable commands; the hover keys are not here - they cannot be rebinded. */
interface GlobalKeycaps {
  /** Switch floating dialog. */
  readonly open: string;
  /** Switch recording on and off. */
  readonly hear: string;
  /** Screenshot. */
  readonly capture: string;
  /** Open the right column dialogue panel. */
  readonly sidebar: string;
}

/** Now read the keycaps of three global commands. */
function readKeycaps(ctx: ShortcutHost): GlobalKeycaps {
  return {
    open: petShortcutKeycap(ctx, 'chat'),
    hear: petShortcutKeycap(ctx, 'hear'),
    capture: petShortcutKeycap(ctx, 'capture'),
    sidebar: petChatShortcutKeycap(ctx),
  };
}

/**
 * Create a shortcut key card.
 *
 * @param rt - Injected react capabilities and translation functions.
 * @param ctx - Client context: read and change the bound key position.
 * @returns card assembly.
 */
export function makeShortcutsCard(rt: SettingsRuntime, ctx: ShortcutHost): FunctionComponent {
  const { h, t, useState, useEffect } = rt;
  const { foldCard } = makeUiKit({ h, t });

  return function ShortcutsCard() {
    const [open, setOpen] = useState(false);
    // Read it once every time you render: the directory is just an array of dozens of lines, and reading it is easier than maintaining a cache.
    const [keycaps, setKeycaps] = useState<GlobalKeycaps>(readKeycaps(ctx));
    // The binding change occurs on the "Settings → Shortcut Keys" page, and you must read it again when you switch back.
    useEffect(() => subscribeShortcutKeycaps(ctx, () => setKeycaps(readKeycaps(ctx))), []);
    /** One line: action name on the left, keycap on the right. */
    const row = (label: string, keys: string) =>
      h('div', {
        className: 'dsh-pet-cfg__field',
        children: [
          h('span', { key: 'l', className: 'dsh-pet-cfg__flabel', children: t(label) }),
          h('span', { key: 'v', className: 'dsh-pet-cfg__note', children: keys }),
        ],
      });

    return foldCard({
      id: BODY_ID,
      title: t('shortcutCardTitle'),
      hint: t('shortcutCardHint'),
      body: [
        h('p', { key: 'petTitle', className: 'dsh-pet-cfg__cardTitle', children: t('shortcutGroupPet') }),
        h('p', { key: 'petHint', className: 'dsh-pet-cfg__note', children: t('shortcutGroupPetHint') }),
        h('div', {
          key: 'petRows',
          className: 'dsh-pet-cfg__grid2',
          children: [
            row('shortcutRowChat', CHAT_HOTKEY_HINT),
            row('shortcutRowHold', HEAR_HOTKEY_HINT),
            row('shortcutRowCapture', CAPTURE_HOTKEY_HINT),
            row('shortcutRowPaste', PASTE_KEYCAP),
            row('shortcutRowTodo', TODO_HOTKEY_HINT),
            row('shortcutRowSleep', SLEEP_HOTKEY_HINT),
            row('shortcutRowDisplay', DISPLAY_HOTKEY_HINTS.join(' · ')),
          ],
        }),
        h('p', { key: 'globalTitle', className: 'dsh-pet-cfg__cardTitle', children: t('shortcutGroupGlobal') }),
        h('p', { key: 'globalHint', className: 'dsh-pet-cfg__note', children: t('shortcutGroupGlobalHint') }),
        h('div', {
          key: 'globalRows',
          className: 'dsh-pet-cfg__grid2',
          children: [
            row('shortcutRowChat', keycaps.open),
            row('shortcutRowHear', keycaps.hear),
            row('shortcutRowCapture', keycaps.capture),
            row('shortcutRowSidebar', keycaps.sidebar),
          ],
        }),
      ],
      open,
      onToggle: () => setOpen(!open),
    });
  };
}
