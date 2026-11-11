/**
 * The bubble shell of the to-do panel: insert the shared panel into the bubble slot, and the visibility and priority
 * are determined by the slot. Only mount and unmount, without touching data and positioning; the panel body is at
 * shared/todo/panel.
 * @module dsh-pet/src/client/todo-bubble
 */
import { createTodoPanel } from '../shared/todo/panel.ts';
import type * as ReactNS from 'react';
import type { jsx } from 'react/jsx-runtime';

/** Injected react capability. */
export interface TodoBubbleRuntime {
  /** Create element. */
  h: typeof jsx;
  /** Quote. */
  useRef: <T>(initial: T) => ReactNS.MutableRefObject<T>;
  /** side effect; the panel is mounted once and dispose when unmounted. */
  useEffect: (effect: ReactNS.EffectCallback, deps?: ReactNS.DependencyList) => void;
}

/** Panel bubble of props. */
export interface TodoBubbleProps {
  /** Whether to display; true when the slot is `todo`. */
  on: boolean;
  /** When the panel close button is clicked, the callback is closed by the slot. */
  onClose: () => void;
}

/**
 * Manufacturing the to-do panel bubble component (factory).
 *
 * @param rt - Injected react capability.
 * @returns bubble component of the to-do panel.
 */
export function makeTodoBubble(rt: TodoBubbleRuntime) {
  const { h, useRef, useEffect } = rt;

  return function TodoBubble({ on, onClose }: TodoBubbleProps) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    // callback saves ref: The panel only takes onClose once when mounting, and direct closure will capture the old copy.
    const closeRef = useRef(onClose);
    closeRef.current = onClose;

    useEffect(() => {
      const host = hostRef.current;
      if (host === null) return;
      const panel = createTodoPanel({
        onClose: () => closeRef.current(),
        // Keep the list open when clicking the pet so users can drag the pet while reading the list.
        keepOpenOn: (target) => target instanceof Element && target.closest('.dsh-pet-hit') !== null,
      });
      host.appendChild(panel.el);
      return () => panel.dispose();
    }, []);

    return h('div', {
      ref: hostRef,
      className: 'dsh-pet-bubble dsh-pet-todo-bubble' + (on ? ' is-on' : ''),
    });
  };
}
