/**
 * Register "desktop pet conversation" as a tab in the right column of DSH.
 *
 * The right column is an optional capability in DSH: when the `sidebarRightTabs` service is missing, it only alerts
 * and does not register. The pet overlay and the settings page work as usual - the failure of one optional panel
 * should not cause the entire plugin to fail to load.
 * @module dsh-pet/src/client/chat/register
 */
import { LOGO_URL } from './api.ts';
import { makePetChatPanel, type ChatPanelRuntime } from './panel.ts';
import { injectPanelCss } from './styles.ts';
import { disposeTip } from './tooltip.ts';

/** Tag implements identity; also key for body and title slots. */
const TAB_ID = 'dsh-pet-chat';
/** Label type; `openTab` Press it to open. */
const TAB_KIND = 'pet-chat';

/** The minimum shape of the right column label register table (declared according to the members used, without citing the entire package type). */
interface SidebarTabRegistry {
  register(definition: {
    readonly id: string;
    readonly kind: string;
    readonly priority: 'extension';
    readonly title: () => string;
    readonly guide: readonly {
      id: string;
      order: number;
      title: () => string;
      description?: () => string;
      /** The icon component on the left side of the guide page card; does not draw a cube placeholder for the time frame. */
      icon?: () => unknown;
      /** The shortcut key command corresponding to this entry point is id: If given, the keycap will be displayed on the right side of the card. */
      commandId?: string;
    }[];
  }): () => void;
}

/** Minimum context required to register dialog tags. */
export interface PetChatTabHost {
  /** Cordis’s soft retrieval service: Unable to obtain undefined. */
  get?(name: string): unknown;
  /** Slot register table. */
  slots: {
    /** Wait until a slot is declared before executing register (the same waiting method as shell.overlay). */
    inject(name: string, generator: () => Generator<unknown, void, unknown>): void;
    /**
     * register a mount point.
     *
     * The keyed slot is assigned as `key` (the value is `id` defined by the tag type); writing it as `id` will make
     * the main text unavailable in the sidebar, and fallback to the fallback text of "There is no available
     * viewing method for this type of content."
     */
    register(registration: { name: string; key: string; order: number }, component: () => unknown): () => void;
  };
}

/**
 * Open the conversation tab in the right column.
 *
 * The sidebar navigation surface may arrive later than the register table, and nothing will be done if it is not
 * available. The triggering action of the shortcut key goes here, so that the fact of "label type" still only appears
 * once in registerPetChatTab.
 *
 * @param ctx - client context (only soft fetches are used).
 */
export function openPetChatTab(ctx: PetChatTabHost): void {
  const controller = ctx.get?.('sidebarRight') as { openTab?(kind: string): void } | undefined;
  controller?.openTab?.(TAB_KIND);
}

/**
 * register dialog tag (tag type + body slot + style).
 *
 * @param ctx - client context.
 * @param rt - Injected react capabilities.
 * @param options.commandId - shortcut key command id; only the command is successfully registered. Pointing to a
 * non-existent command will cause an error in the sidebar.
 * @returns Unregisters the function of the label type and releases the style; the body slot is handed over to the
 * scope of slots.inject with the plugin unmount.
 */
export function registerPetChatTab(
  ctx: PetChatTabHost,
  rt: ChatPanelRuntime,
  options: { commandId?: string } = {},
): () => void {
  const tabs = ctx.get?.('sidebarRightTabs') as SidebarTabRegistry | undefined;
  if (tabs === undefined || typeof tabs.register !== 'function') {
    console.warn('[dsh-pet] Chat tab not registered: sidebarRightTabs service unavailable');
    return () => {};
  }
  const disposeCss = injectPanelCss();
  const Panel = makePetChatPanel(rt);
  /** The icon of the guide page card: plugin logo; the position given by the frame is only about 16 px, which is filled with CSS. */
  const GuideIcon = () => rt.h('img', { className: 'pet-chat-guide-icon', src: LOGO_URL, alt: '', loading: 'lazy' });

  const commandId = options.commandId;

  const disposeType = tabs.register({
    id: TAB_ID,
    kind: TAB_KIND,
    // extension is the highest priority band of external plugins: it does not compete with the built-in type for addresses, but it can cover kind with the same name.
    priority: 'extension',
    title: () => rt.t('tabTitle'),
    guide: [
      {
        id: TAB_KIND,
        order: 400,
        title: () => rt.t('tabTitle'),
        description: () => rt.t('tabGuide'),
        icon: GuideIcon,
        ...(commandId === undefined ? {} : { commandId }),
      },
    ],
  });
  // The right column may be mounted later than this plugin: wait for the slot to be declared before registering to avoid "opening the label but blank"
  ctx.slots.inject('sidebar.right.pane.tab', function* () {
    yield ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID, order: 100 }, () => rt.h(Panel, {}));
  });
  return () => {
    disposeType();
    disposeTip();
    disposeCss();
  };
}
