/**
 * Bubble single slot: display, stay timing and priority selection of three bubbles: balance, conversation and working
 * status. It is not responsible for when it lights up and is linked to the animation: tick judgment, animation, and
 * logging are all in PetCard; it is not responsible for the appearance, and the dumb components are in
 * client/bubble.ts. Dependency injection of react and two bubble components; the three dwell timers are all cleaned up
 * by this module. Invariant: Only one bubble is rendered at the same time, and the priorities are final tasks,
 * conversations, balances, and non-final tasks.
 * @module dsh-pet/src/client/pet/card/bubble-slots
 */
import { balancePageCount as balancePageCountOf, type BalanceState } from '../../../shared/balance/index.ts';
import {
  BUBBLE_HOLD_IDLE,
  reduceBubbleHold,
  utteranceToHold,
  type BubbleHoldEvent,
  type BubbleHoldState,
} from '../../../shared/bubble-hold.ts';
import { subscribeVoiceState, subscribeVoiceUtterance, type VoiceState } from '../../../shared/voice.ts';
import { BUBBLE_DURATION_MS } from '../timings.ts';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type * as ReactNS from 'react';
import type { jsx } from 'react/jsx-runtime';

/** Which bubble should be hung currently; `none` means that neither condition is true. */
export type BubbleSlot = 'todo' | 'work-terminal' | 'whisper' | 'balance' | 'work' | 'none';

/** The input of the priority determination: all are fait accompli during the rendering period, and the determination itself does not produce side effects. */
export interface BubbleSlotInput {
  /** Whether the to-do panel is open; when it is opened, it occupies the slot exclusively and all other bubbles will give way. */
  todoOn: boolean;
  /** Whether the working state is the final state (success / error). */
  workTerminal: boolean;
  /** Is the work bubble lit? */
  workOn: boolean;
  /** Working bubble text. */
  workText: string | null;
  /** Configure whether to enable working status linkage. */
  workStatusEnabled: boolean;
  /** Whether the speaking bubble is lit. */
  whisperOn: boolean;
  /** Speak bubble text. */
  whisperText: string | null;
  /** Is the balance bubble lit? */
  balanceOn: boolean;
  /** Whether the balance data has been retrieved; null means it has not been retrieved yet. */
  balanceAvailable: boolean;
  /** Configure whether to enable balance. */
  balanceEnabled: boolean;
  /** Whether this balance is manually requested; manual requests are not subject to switch gating. */
  balanceManual: boolean;
}

/**
 * Determine which bubble is currently hanging.
 *
 * The final state task only lives 10 s, so it does not give way; if it is not in the final state, there is no loss in
 * giving up 10 s.
 *
 * @param input - The visibility and switching of three bubbles.
 * The slot hit by @returns; when neither is true, it is `none` .
 */
export function decideBubbleSlot(input: BubbleSlotInput): BubbleSlot {
  // The panel is a window that the user actively opens: when it occupies the slot, all other bubbles will give way, and it will be restored according to the original rules after it is closed.
  if (input.todoOn) return 'todo';
  if (input.workTerminal && input.workOn && input.workText && input.workStatusEnabled) return 'work-terminal';
  if (input.whisperOn && input.whisperText) return 'whisper';
  if (input.balanceOn && input.balanceAvailable && (input.balanceEnabled || input.balanceManual)) return 'balance';
  if (input.workOn && input.workText && input.workStatusEnabled) return 'work';
  return 'none';
}

/**
 * The number of pages that the balance bubble can turn.
 *
 * The page number rule belongs to shared (same origin as the content of each page), and only one fallback of "no
 * result yet" is added here.
 *
 * @param balance - the latest balance result; `null` means there is no data for this beat.
 * @returns Number of pages, at least 1.
 */
export function balancePageCount(balance: BalanceState | null): number {
  return balance ? balancePageCountOf(balance) : 1;
}

/** Balance bubble component; props is consistent with BalanceBubble of `client/bubble.ts`. */
export type BalanceBubbleComponent = (props: {
  state: BalanceState;
  on: boolean;
  index: number;
  onCycle: () => void;
}) => ReactNode;

/** Speech bubble component; choose one of the two pictures, props is consistent with WhisperBubble of `client/bubble.ts`. */
export type WhisperBubbleComponent = (props: {
  text: string;
  image?: string;
  url?: string;
  assetRoot?: string;
  on: boolean;
  /** The callback is clickable; the work bubble uses it to jump to the session, and it is not clickable by default. */
  onClick?: (e: ReactNS.MouseEvent<HTMLDivElement>) => void;
}) => ReactNode;

/** Injected react capability. */
export interface BubbleSlotsRuntime {
  /** Create element. */
  h: typeof jsx;
  /** Status. */
  useState: <T>(init: T) => [T, Dispatch<SetStateAction<T>>];
  /** Quote. */
  useRef: <T>(initial: T) => ReactNS.MutableRefObject<T>;
  /** side effect; used to clear the timer when unmounting. */
  useEffect: (effect: ReactNS.EffectCallback, deps?: ReactNS.DependencyList) => void;
}

/** To-do panel bubble component; props is consistent with TodoBubble of `client/todo-bubble.ts`. */
export type TodoBubbleComponent = (props: { on: boolean; onClose: () => void }) => ReactNode;

/** Three bubble components. */
export interface BubbleComponents {
  /** Balance bubble. */
  balanceBubble: BalanceBubbleComponent;
  /** To-do panel bubble. */
  todoBubble: TodoBubbleComponent;
  /** Talk bubble. */
  whisperBubble: WhisperBubbleComponent;
}

/** View input provided by PetCard is rendered each time. */
export interface BubbleSlotsInput {
  /** The latest balance result. */
  balance: BalanceState | null;
  /** Configure whether to enable balance. */
  balanceEnabled: boolean;
  /** Whether to manually request the balance this time. */
  balanceManual: boolean;
  /** Configure whether to enable working status linkage. */
  workStatusEnabled: boolean;
  /** Is the working state in the final state? */
  workTerminal: boolean;
  /** The session to which the currently displayed item belongs; the work bubble will be clickable only if it has a value. */
  workSessionId?: string | null;
  /** Jump to the work bubble when you click it; it is disabled by default (the web page is switched directly, and the desktop is forwarded by the container). */
  onFocusSession?: (sessionId: string) => void;
  /** The asset root of the speech bubble image. */
  assetRoot?: string;
}

/** Bubble is the external reading and writing surface of a single slot. */
export interface BubbleSlots {
  /** Light up the balance bubble and return to the first page to reset the dwell timer. */
  showBalance(): void;
  /** Click the balance bubble to turn the page and reset the dwell time. */
  cycleBalance(): void;
  /** Light up the speech bubble; when duration is 0, the current bubble will not be changed, and undefined uses the default duration. */
  showWhisper(text: string, parts: { image?: string; url?: string }, duration?: number): void;
  /** Put away the speaking bubble; do not touch the animation and other two bubbles. */
  clearWhisper(): void;
  /** Update the work bubble text, showing and hiding. */
  updateWorkText(text: string | null): void;
  /** Light up the working bubble; terminal automatically closes after deciding 10 s, non-final state permanent. */
  lightWork(terminal: boolean): void;
  /** Collapse the work bubble but keep the text. */
  hideWork(): void;
  /** Return to idle: close the work bubble and clear the text. */
  resetWork(): void;
  /** Open the to-do panel: it occupies the slot exclusively and the rest of the bubbles give way. */
  showTodo(): void;
  /** Collapse the to-do panel and restore the remaining bubbles according to their original priorities. */
  hideTodo(): void;
  /** Switch to-do panel: when opened, close it for shortcut keys. */
  toggleTodo(): void;
  /** Render the currently hanging bubble according to priority; when there is no bubble, it is null. */
  node(): ReactNode;
}

/**
 * Create bubble single-slot hook, and call each PetCard once.
 *
 * @param rt - Injected react capabilities.
 * @param components - Balance and speaking bubble components.
 * @returns hook that receives view input; the internal state and timer of the hook are cleared together with the card
 * unmount.
 */
export function createBubbleSlots(rt: BubbleSlotsRuntime, components: BubbleComponents) {
  const { h, useState, useRef, useEffect } = rt;
  const BalanceBubble = components.balanceBubble;
  const TodoBubble = components.todoBubble;
  const WhisperBubble = components.whisperBubble;

  return function useBubbleSlots(input: BubbleSlotsInput): BubbleSlots {
    // Balance bubble: Show, hide and expand the page.
    const [balanceOn, setBalanceOn] = useState(false);
    const [balancePage, setBalancePage] = useState(0);
    const balanceTimerRef = useRef<number | null>(null);
    // Speech bubble: visible, hidden, text and pictures (choose one of the name in the pool and the complete address).
    // The closing time is bubbleHoldRef: the timing is suspended during speech synthesis, and a short tail is left
    // after playing (see shared/bubble-hold).
    const [whisperOn, setWhisperOn] = useState(false);
    const [whisperText, setWhisperText] = useState<string | null>(null);
    const [whisperImage, setWhisperImage] = useState<string | undefined>(undefined);
    const [whisperUrl, setWhisperUrl] = useState<string | undefined>(undefined);
    const whisperHoldRef = useRef<BubbleHoldState>(BUBBLE_HOLD_IDLE);
    const whisperTextRef = useRef<string | null>(null);
    const whisperTimerRef = useRef<number | null>(null);
    // To-do panel: exclusive slot, no dwell timer, visible and hidden only by the user.
    const [todoOn, setTodoOn] = useState(false);
    // Working status bubble: display, hide and text.
    const [workOn, setWorkOn] = useState(false);
    const [workText, setWorkText] = useState<string | null>(null);
    const workTimerRef = useRef<number | null>(null);
    // Voice broadcast status: Only the sentence that is manually triggered has a value, and the bubble displays the circle/speaker accordingly.
    const [voiceState, setVoiceState] = useState<VoiceState>('idle');

    // subscribe is a module-level singleton: you must unsubscribe when unmounting, otherwise the old card will be re-rendered by subsequent status push
    useEffect(() => subscribeVoiceState(setVoiceState), []);

    // No more setState after unmount: All three timers are cleared here.
    useEffect(
      () => () => {
        if (balanceTimerRef.current !== null) window.clearTimeout(balanceTimerRef.current);
        if (whisperTimerRef.current !== null) window.clearTimeout(whisperTimerRef.current);
        if (workTimerRef.current !== null) window.clearTimeout(workTimerRef.current);
      },
      [],
    );

    /** Reset the dwell time of the balance bubble; clear the old timer first if triggered repeatedly, otherwise the old one will be put away in advance. */
    const armBalanceTimeout = () => {
      if (balanceTimerRef.current !== null) window.clearTimeout(balanceTimerRef.current);
      balanceTimerRef.current = window.setTimeout(() => setBalanceOn(false), BUBBLE_DURATION_MS);
    };

    const showBalance = () => {
      setBalancePage(0); // A new round of query starts from the first page.
      setBalanceOn(true);
      armBalanceTimeout();
    };

    const cycleBalance = () => {
      const pages = balancePageCount(input.balance);
      setBalancePage((page) => (page + 1) % pages);
      // Retiming: There are only 2 seconds left after clicking on the 8th second, and the next page cannot be seen clearly.
      armBalanceTimeout();
    };

    /** Advance the speech bubble collapse plan and reset the timer according to the new plan. */
    const applyWhisperHold = (event: BubbleHoldEvent): void => {
      const next = reduceBubbleHold(whisperHoldRef.current, event);
      if (next === whisperHoldRef.current) return; // Same reference = nothing happens, don’t reset the timer in vain
      whisperHoldRef.current = next;
      setWhisperOn(next.on);
      if (whisperTimerRef.current !== null) window.clearTimeout(whisperTimerRef.current);
      whisperTimerRef.current = null;
      if (next.delayMs === null) return;
      whisperTimerRef.current = window.setTimeout(() => {
        whisperTimerRef.current = null;
        applyWhisperHold({ kind: 'hide' });
      }, next.delayMs);
    };

    // Promote the closing plan when the voice report starts/ends: When the synthesis is slow, the bubble must be hung
    // up, and then closed after the broadcast. Only recognize the sentence with the same text - other pets on the same
    // page share this module singleton state.
    useEffect(
      () =>
        subscribeVoiceUtterance((event) => {
          if (event.text !== whisperTextRef.current) return;
          applyWhisperHold(utteranceToHold(event));
        }),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Subscribe once and read dismissal schedules through refs; resubscribing could miss events.
      [],
    );

    const showWhisper = (text: string, parts: { image?: string; url?: string }, duration?: number) => {
      if (duration === 0) return; // Go here when only linking animation and not changing bubble.
      setWhisperText(text);
      whisperTextRef.current = text;
      setWhisperImage(parts.image);
      setWhisperUrl(parts.url);
      applyWhisperHold({ durationMs: duration ?? BUBBLE_DURATION_MS, kind: 'show' });
    };

    const clearWhisper = () => {
      whisperTextRef.current = null;
      setWhisperText(null);
      setWhisperImage(undefined);
      applyWhisperHold({ kind: 'clear' });
    };

    const lightWork = (terminal: boolean) => {
      setWorkOn(true);
      if (workTimerRef.current !== null) window.clearTimeout(workTimerRef.current);
      // Non-final state permanent, no automatic closing.
      workTimerRef.current = terminal ? window.setTimeout(() => setWorkOn(false), BUBBLE_DURATION_MS) : null;
    };

    const hideWork = () => {
      if (workTimerRef.current !== null) window.clearTimeout(workTimerRef.current);
      workTimerRef.current = null;
      setWorkOn(false);
    };

    const resetWork = () => {
      hideWork();
      setWorkText(null);
    };

    const showTodo = (): void => setTodoOn(true);
    const hideTodo = (): void => setTodoOn(false);
    const toggleTodo = (): void => setTodoOn((on) => !on);

    const node = (): ReactNode => {
      const slot = decideBubbleSlot({
        todoOn,
        workTerminal: input.workTerminal,
        workOn,
        workText,
        workStatusEnabled: input.workStatusEnabled,
        whisperOn,
        whisperText,
        balanceOn,
        balanceAvailable: input.balance !== null,
        balanceEnabled: input.balanceEnabled,
        balanceManual: input.balanceManual,
      });
      if (slot === 'todo') return h(TodoBubble, { on: todoOn, onClose: hideTodo });
      if (slot === 'balance') {
        return input.balance === null
          ? null
          : h(BalanceBubble, { state: input.balance, on: balanceOn, index: balancePage, onCycle: cycleBalance });
      }
      if (slot === 'whisper') {
        return whisperText === null
          ? null
          : h(WhisperBubble, {
              text: whisperText,
              image: whisperImage,
              url: whisperUrl,
              assetRoot: input.assetRoot,
              on: whisperOn,
              voiceState,
            });
      }
      // The final state and the non-final state share the same component, the only difference is the duration and priority.
      if (slot === 'work' || slot === 'work-terminal') {
        if (workText === null) return null;
        const sessionId = input.workSessionId ?? '';
        const onFocus = input.onFocusSession;
        // If you can't get the session, don't make it clickable: clicking on it will go nowhere, which is worse than being unclickable.
        const onClick = sessionId !== '' && onFocus !== undefined ? () => onFocus(sessionId) : undefined;
        return h(WhisperBubble, {
          text: workText,
          on: workOn,
          ...(onClick === undefined ? {} : { onClick }),
        });
      }
      return null;
    };

    return {
      clearWhisper,
      cycleBalance,
      hideTodo,
      hideWork,
      lightWork,
      node,
      resetWork,
      showBalance,
      showTodo,
      showWhisper,
      toggleTodo,
      updateWorkText: setWorkText,
    };
  };
}
