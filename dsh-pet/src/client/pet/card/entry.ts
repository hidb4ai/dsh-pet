/**
 * The entry point of the right-click menu, dialogue pop-up window and floating prompt: all three are floating layers
 * attached to the pet, sharing the same set of closing and positioning timings. Not responsible for the action itself:
 * the menu leaves are distributed by menu-actions, and the conversation content is handled by shared/chat and host /
 * chat. The floating layer handle is only held by this module and is closed when unmounted; directly write style at
 * the prompt position and do not enter the React state.
 * @module dsh-pet/src/client/pet/card/entry
 */
import {
  CHAT_HOTKEY_HINT,
  createHearHold,
  isCaptureHotkey,
  mountChatDialog,
  type ChatDialogMount,
  type EncodedImage,
} from '../../../shared/chat/index.ts';
import { captureDisplayFrame } from '../../../shared/chat/capture.ts';
import { displayOfHotkey } from '../../../shared/display-hotkey.ts';
import { SLEEP_HOTKEY_HINT, isSleepHotkey } from '../../../shared/sleep-hotkey.ts';
import { TODO_HOTKEY_HINT, isTodoHotkey } from '../../../shared/todo/hotkey.ts';
import type { PetDisplay } from '../../../shared/types.ts';
import { bindOpenChat } from './open-chat.ts';
import { registerPetChatHandle } from './registry.ts';
import {
  buildMemeBranch,
  buildMenuTree,
  buildMoreBranch,
  displayMenuBranch,
  memeThumbUrl,
  mountContextMenu,
  type MenuNode,
} from '../../../shared/menu.ts';
import { ROUTE_PATH } from '../../../shared/constants.ts';
import { TOOLTIP_GAP_RATIO, tooltipPlacement } from '../../../shared/tooltip.ts';
import type { MenuMoreItem } from '../../../shared/menu.ts';
import type { CardLive } from './live.ts';
import type { CardMotion } from './motion.ts';
import type { CardStateApi } from './state.ts';
import type { Drag } from '../motion/drag.ts';
import type { MenuActions } from '../menu-actions.ts';
import type { RuntimePet } from '../types.ts';
import type * as ReactNS from 'react';

/** Injected react capability. */
export interface CardEntryRuntime {
  /** side effect; close the floating layer when unmounting. */
  useEffect: (effect: ReactNS.EffectCallback, deps?: ReactNS.DependencyList) => void;
  /** Reference; floating layer handle and prompt node. */
  useRef: <T>(initial: T) => ReactNS.MutableRefObject<T>;
}

/** Input of floating layer entry point. */
export interface CardEntryInput {
  /** Card status: Prompt showing and hiding and writing entry point. */
  card: CardStateApi;
  /** Latest value of resolved configuration. */
  cfgRef: ReactNS.MutableRefObject<RuntimePet>;
  /** Assemble root binding groove. */
  live: ReactNS.MutableRefObject<CardLive>;
  /** Sports surface: Stop and go before opening the menu. */
  motion: CardMotion;
  /** Drag driver: The menu does not pop up during dragging or just after dragging. */
  drag: Drag;
  /** Snapshot of third-party menu items; only read at the moment of right-clicking. */
  menuItemsRef: ReactNS.MutableRefObject<MenuMoreItem[]>;
  /** Menu action dispatch. */
  runMenuAction: MenuActions['run'];
  /** Open the to-do panel: the panel occupies the bubble slot, and the visibility is returned to the bubble single slot tube. */
  showTodo: () => void;
  /** Switch to-do panel: Used for D keys, closed if opened. */
  toggleTodo: () => void;
  /** Floating prompt node: The position is directly written by this module to style. */
  tipRef: ReactNS.MutableRefObject<HTMLDivElement | null>;
  /** Stage node: The upper right corner of the hit area of the dialogue pop-up window. */
  stage: () => HTMLDivElement | null;
}

/** The external reading and writing surface of the floating layer entry point. */
export interface CardEntry {
  /** Place the prompt box to the lower right of the cursor. If it cannot be placed, turn it over and clip it back to the viewport. */
  placeTip: (clientX: number, clientY: number) => void;
  /** Open the right-click menu. */
  handleContextMenu: (e: ReactNS.MouseEvent<HTMLDivElement>) => void;
  /** Open the dialogue pop-up window: Go here for the "Dialogue" item in the menu; when adding a picture, directly enter the pending state (drag and drop). */
  openChat: (image?: File) => void;
  /** Open the to-do panel (right-click menu entry point). */
  openTodo: () => void;
  /** Pointer entry: first set the position and then display. */
  onPointerEnter: (e: ReactNS.PointerEvent<HTMLDivElement>) => void;
  /** The pointer leaves: hide the prompt. */
  onPointerLeave: () => void;
}

/**
 * Create floating layer entry point hook.
 *
 * @param rt - Injected react capabilities.
 * @returns receives the hook of assembly input and returns the entry point for menus, dialogs and prompts.
 */
export function createCardEntry(rt: CardEntryRuntime) {
  const { useEffect, useRef } = rt;

  return function useCardEntry(input: CardEntryInput): CardEntry {
    const { card, cfgRef, drag, live, menuItemsRef, motion, runMenuAction, showTodo, stage, tipRef, toggleTodo } =
      input;
    // The current handle of the right-click menu and dialog pop-up window should be cleared before unmounting or reopening. In the dialogue pop-up window, you also need to press and hold to speak to remotely start recording/cleanup.
    const menuRef = useRef<{ close: () => void } | null>(null);
    const chatRef = useRef<ChatDialogMount | null>(null);

    /**
     * Place the prompt box to the lower right of the cursor. If it cannot be placed, turn it over and clip it back to
     * the viewport. Directly write DOM style: every time the mouse moves, the React state will cause the entire
     * PetCard to be re-rendered.
     */
    const placeTip = (clientX: number, clientY: number): void => {
      const tipEl = tipRef.current;
      if (!tipEl) return;
      const viewport = document.documentElement;
      const p = tooltipPlacement(
        { x: clientX, y: clientY },
        { w: tipEl.offsetWidth, h: tipEl.offsetHeight },
        { x: 0, y: 0, w: viewport.clientWidth, h: viewport.clientHeight },
        motion.metrics().size * TOOLTIP_GAP_RATIO,
      );
      tipEl.style.left = p.x + 'px';
      tipEl.style.top = p.y + 'px';
    };

    // Close the right-click menu and dialog pop-up window that may be open when unmounting.
    useEffect(
      () => () => {
        if (menuRef.current) {
          menuRef.current.close();
          menuRef.current = null;
        }
        if (chatRef.current) {
          chatRef.current.close();
          chatRef.current = null;
        }
      },
      [],
    );

    /** Mount dialog pop-up window: The pop-up window is attached to the upper right corner of the body hit area, and the upper right corner of the video frame is not equal to the upper right corner of the pet; it is clipped back beyond the viewport. */
    const mountChat = (seed: { image?: File; encoded?: EncodedImage }): void => {
      if (chatRef.current) chatRef.current.close();
      const hitRect = stage()?.querySelector('.dsh-pet-hit')?.getBoundingClientRect();
      chatRef.current = mountChatDialog({
        petId: cfgRef.current.id,
        baseUrl: ROUTE_PATH + '/chat',
        surface: 'web',
        x: hitRect ? hitRect.right + 6 : window.innerWidth - 256,
        y: hitRect ? hitRect.top + 6 : 8,
        ...(seed.image ? { initialImage: seed.image } : {}),
        ...(seed.encoded ? { initialEncoded: seed.encoded } : {}),
        // Browser side screenshot: getDisplayMedia captures a frame, the system selector is confirmed by the user
        capture: captureDisplayFrame,
        onSent: () => {
          // Sent successfully: the reply has been written into / state, long polling will return immediately and pop the bubble.
          console.info('[dsh-pet] Chat sent pet=' + cfgRef.current.id);
        },
        onClose: () => {
          chatRef.current = null;
        },
      });
    };

    /** Open the dialogue (menu, hover L, drag and drop all go this way); when adding a picture, enter the pending state directly. */
    const openChat = (image?: File): void => mountChat(image ? { image } : {});

    /** Send a picture into the conversation: insert it if it is already open (without losing the half-written words), or open it with the picture if it is not open. */
    const openChatWithImage = (file: File): void => {
      const existing = chatRef.current;
      if (existing !== null) {
        void existing.setImageFile(file);
        return;
      }
      openChat(file);
    };

    /** Open the to-do panel: the panel occupies the bubble slot, and repeated clicks are idempotent. */
    const openTodo = (): void => showTodo();

    /** Press "Hold to speak": If the pop-up window is not open, open it first, and then let it start recording; if it is open, start recording directly on it. */
    const startChatHear = (): void => {
      if (!chatRef.current) openChat();
      chatRef.current?.startHear();
    };
    /** "Press and speak" release: only cleanup, do not close the pop-up window - the recognition result must fall into the input box for people to take a look. */
    const stopChatHear = (): void => {
      chatRef.current?.stopHear();
    };
    /** Open a dialog: If it is already open, just return the focus to the input box. If you reopen it, the half-typed words will be lost. */
    const openChatOrFocus = (): void => {
      const existing = chatRef.current;
      if (existing === null) {
        openChat();
        return;
      }
      existing.el.querySelector<HTMLTextAreaElement>('.dsh-pet-chat-input')?.focus();
    };

    /** Cut a frame and insert it into the dialogue; if the cut cannot be taken, the pop-up window will still open and the reason will be written in the pop-up window - silent failure will be treated as a broken shortcut key. */
    const captureInto = async (): Promise<void> => {
      let encoded: EncodedImage;
      try {
        encoded = await captureDisplayFrame();
      } catch (error) {
        const reason = '截屏失败：' + (error instanceof Error ? error.message : String(error));
        const opened = chatRef.current;
        if (opened !== null) {
          opened.flash(reason);
          return;
        }
        mountChat({});
        chatRef.current?.flash(reason);
        return;
      }
      const existing = chatRef.current;
      if (existing !== null) {
        existing.setEncoded(encoded);
        return;
      }
      mountChat({ encoded });
    };

    /** The external shape of the screenshot action; asynchronous collection is inside, the caller does not care. */
    const screenshot = (): void => {
      void captureInto();
    };

    // Hover mark: Shortcut keys and drag will only take effect when "the mouse is parked on this pet" to avoid grabbing events from other interactions on the page.
    const hoverRef = useRef(false);
    // Register the listener once when mounting, but the latest openChat closure is always called (it reads ref and cannot capture the old value).
    const openChatRef = useRef<(image?: File) => void>(openChat);
    openChatRef.current = openChat;
    // stage is getter (the node does not exist when rendering for the first time), fetch it again from effect, and use ref to avoid dependency warnings.
    const stageGetterRef = useRef(stage);
    stageGetterRef.current = stage;
    // The to-do switch also only takes effect when hovering; ref is saved because it is newly created every time it is rendered, and the closure will capture the old one.
    const toggleTodoRef = useRef(toggleTodo);
    toggleTodoRef.current = toggleTodo;
    // Sleeping also has switching semantics: the moment you press it, the current reading state determines whether to send / sleep or / wake (the same thing as the menu item).
    const toggleSleepRef = useRef<() => void>(() => {});
    toggleSleepRef.current = () => {
      const asleep = live.current.flow?.sleeping() ?? false;
      runMenuAction(asleep ? { label: '起来', action: 'wake' } : { label: '睡觉', action: 'sleep' });
    };
    // Numeric keys change the display position: the same action is dispatched as the right-click "Display Position" submenu (write display configuration, the host restarts to take effect).
    const switchDisplayRef = useRef<(display: PetDisplay) => void>(() => {});
    switchDisplayRef.current = (display) => {
      runMenuAction({ label: '显示位置', action: 'set-display', display });
    };
    // When pressing/releasing while holding down the language, a new closure will be created for each rendering; the state machine is only built once, and the latest two can only be fetched through ref.
    const startChatHearRef = useRef<() => void>(startChatHear);
    startChatHearRef.current = startChatHear;
    const stopChatHearRef = useRef<() => void>(stopChatHear);
    stopChatHearRef.current = stopChatHear;
    const openChatOrFocusRef = useRef<() => void>(openChatOrFocus);
    openChatOrFocusRef.current = openChatOrFocus;
    const openChatWithImageRef = useRef<(file: File) => void>(openChatWithImage);
    openChatWithImageRef.current = openChatWithImage;
    const screenshotRef = useRef<() => void>(screenshot);
    screenshotRef.current = screenshot;
    // The global shortcut keys must be able to control this one: register the switch window, switch the recording, and
    // remove it when unmounting. All ref is used in the handle, and card re-rendering will not let the registration
    // table get the expired closure; cfgRef itself is also a stable reference, and the dependency is only included to
    // satisfy the rules.
    useEffect(
      () =>
        registerPetChatHandle(cfgRef.current.id, {
          open: () => openChatOrFocusRef.current(),
          // close pops up the pop-up window's own onClose, the handle is then left blank, and isOpen immediately turns fake.
          close: () => chatRef.current?.close(),
          isOpen: () => chatRef.current !== null,
          startHear: () => startChatHearRef.current(),
          stopHear: () => stopChatHearRef.current(),
          isHearing: () => chatRef.current?.isHearing() ?? false,
          screenshot: () => screenshotRef.current(),
        }),
      [cfgRef],
    );
    // The hover keys share one mount: L opens a conversation, press and hold M to speak, S takes a screenshot, Z
    // switches sleep/wake, D switches to-do, 1-4 switches display positions. All of them only take effect when the
    // mouse is parked on this pet; there is another one when pressing and talking - the focus is in the pet's own
    // pop-up window, but it does not count when typing in the pop-up window input box (otherwise m in Pinyin will be
    // regarded as open recording, see createHearHold).
    useEffect(() => {
      // Register the listener once when mounting, but the latest closure is always called (they read ref and cannot capture old values).
      const offChat = bindOpenChat({
        stage: stageGetterRef.current(),
        isHovered: () => hoverRef.current,
        openChat: (image) => (image === undefined ? openChatRef.current() : openChatWithImageRef.current(image)),
      });
      // Press and hold M: press to start recording, release to cleanup. The state machine takes care of automatic repetition and release, so here we just send the events.
      const hearHold = createHearHold({
        isArmed: () => {
          if (hoverRef.current) return true;
          const chat = chatRef.current;
          const active = document.activeElement;
          return !!chat && !!active && chat.el.contains(active);
        },
        onPress: () => startChatHearRef.current(),
        onRelease: () => stopChatHearRef.current(),
      });
      const onKeyDown = (e: KeyboardEvent): void => {
        if (hearHold.onKeyDown(e)) {
          e.preventDefault();
          return;
        }
        if (!hoverRef.current) return;
        const display = displayOfHotkey(e);
        if (display !== undefined) {
          e.preventDefault();
          switchDisplayRef.current(display);
          return;
        }
        if (isCaptureHotkey(e)) {
          e.preventDefault();
          screenshotRef.current();
          return;
        }
        if (isSleepHotkey(e)) {
          e.preventDefault();
          toggleSleepRef.current();
          return;
        }
        if (!isTodoHotkey(e)) return;
        e.preventDefault();
        toggleTodoRef.current();
      };
      const onKeyUp = (e: KeyboardEvent): void => hearHold.onKeyUp(e);
      document.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('keyup', onKeyUp, true);
      return () => {
        offChat();
        document.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('keyup', onKeyUp, true);
      };
    }, []);
    // The action surface of the menu contains a "Dialogue" item. Just register the callback once: the pop-up window handle is in the closure.
    live.current.placeTip = placeTip;
    live.current.tipOn = () => card.state.tipOn;

    /** Open the right-click menu. */
    const handleContextMenu = (e: ReactNS.MouseEvent<HTMLDivElement>): void => {
      // Tool items and action tree; "View balance" is displayed unconditionally, and manual requests are not subject
      // to switch restrictions. Third-party menu items are unified under "More": label is the only tile, press owner
      // molecule menu with the same name (see buildMoreBranch).
      const more = buildMoreBranch(menuItemsRef.current);
      // "Pictures": According to the list in the configuration, it is divided into "Pictures included in the
      // conversation/others", click on one and use it to say a sentence. When there is no available picture, null is
      // returned, and the entire item does not appear (it does not occupy an empty menu when clicked). The thumbnail
      // is located at /pic/memes/<asset root>/<name>. png: The asset root is the entry key that is usually written.
      const pic = cfgRef.current;
      const memes = buildMemeBranch(pic, (name) => memeThumbUrl(ROUTE_PATH, pic.assetRoot, name));
      // Sleeping/waking up are two texts of the same entry point: clicking it when sleeping is equivalent to
      // waking up (synonymous with "clicking on the pet"). If this entry is not configured with animations.sleep, the
      // entire entry will not appear - consistent with the configuration comment "not written = no sleep function".
      const asleep = live.current.flow?.sleeping() ?? false;
      const canSleep = (cfgRef.current.animations.sleep ?? []).length > 0;
      const sleepItem: MenuNode = asleep
        ? { label: '起来', action: 'wake', hint: SLEEP_HOTKEY_HINT }
        : { label: '睡觉', action: 'sleep', hint: SLEEP_HOTKEY_HINT };
      // The order is the same as the desktop version: balance / to-do / whisper / conversation / picture / sleep →
      // action tree → display position / return to the initial position. The two desktop-specific items (opening the
      // software and reloading the configuration) have no corresponding actions on the web page and do not appear.
      const tools: MenuNode[] = [
        { label: '查看余额', action: 'show-balance' },
        { label: '待办事项', action: 'todo', hint: TODO_HOTKEY_HINT },
        { label: '碎碎念', action: 'whisper' },
        { label: '对话', action: 'chat', hint: CHAT_HOTKEY_HINT },
        ...(memes ? [memes] : []),
        ...(canSleep ? [sleepItem] : []),
      ];
      const tail: MenuNode[] = [
        // The display position submenu is the same as the desktop version; after changing it to a value that does not contain web, the pet will disappear from the page.
        displayMenuBranch(),
        { label: '回到初始位置', action: 'home' },
      ];
      const tree: MenuNode[] = [
        ...tools,
        ...buildMenuTree(cfgRef.current.animations),
        ...tail,
        ...(more ? [more] : []),
      ];
      if (!tree.length) return;
      e.preventDefault();
      e.stopPropagation(); // The menu and right-click processing of the DSH page are not touched.
      if (drag.isActive() || drag.justDragged()) return;
      motion.flight.stop(); // Stop the flying pet before the menu pops up.
      motion.stopMove(); // Pets do not roam during menu hover.
      if (menuRef.current) menuRef.current.close();
      menuRef.current = mountContextMenu({
        tree,
        x: e.clientX,
        y: e.clientY,
        onAction: runMenuAction,
        // Clear the handle when an outside click or Escape closes the menu, avoiding stale references.
        onClose: () => {
          if (menuRef.current) menuRef.current = null;
        },
      });
    };

    return {
      handleContextMenu,
      onPointerEnter: (e) => {
        hoverRef.current = true;
        placeTip(e.clientX, e.clientY); // Set the position first and then display it, otherwise it will flash for one frame at the fallback coordinates.
        card.actions.setTipOn(true);
      },
      onPointerLeave: () => {
        hoverRef.current = false;
        card.actions.setTipOn(false);
      },
      openChat,
      openTodo,
      placeTip,
    };
  };
}
