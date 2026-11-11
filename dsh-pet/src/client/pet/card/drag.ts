/**
 * Pointer drag assembly: Bundle the current frame capability into DragCard, and then hand it over to the driver for
 * long-term holding. Rely on the animation flow, locks and cues in motion's motion surface and late binding slots -
 * they are created later and are only read in the callback. Build only once: The driver comes with a pointer state
 * machine and capture. Rebuilding will cause the pressed gesture to be lost.
 * @module dsh-pet/src/client/pet/card/drag
 */
import { createDrag, type Drag, type DragCard } from '../motion/drag.ts';
import { boxToRatio, clampReachableBox } from '../motion/geometry.ts';
import { playClickSound } from '../click-sound.ts';
import type { CardLive } from './live.ts';
import type { CardMotion } from './motion.ts';
import type { CardStateApi } from './state.ts';
import type { RuntimePet } from '../types.ts';
import type * as ReactNS from 'react';

/** Injected react capability. */
export interface CardDragRuntime {
  /** side effect; remove the driver's mouse and release fallback monitoring when unmounting. */
  useEffect: (effect: ReactNS.EffectCallback, deps?: ReactNS.DependencyList) => void;
  /** Quote; the drag driver is only built once. */
  useRef: <T>(initial: T) => ReactNS.MutableRefObject<T>;
}

/** Input for drag-and-drop assembly. */
export interface CardDragInput {
  /** Card status: latest values of animation name and geometry. */
  card: CardStateApi;
  /** Latest value of resolved configuration. */
  cfgRef: ReactNS.MutableRefObject<RuntimePet>;
  /** Assemble root binding groove. */
  live: ReactNS.MutableRefObject<CardLive>;
  /** Motion surface: flight, movement, and bounding boxes all pass through it. */
  motion: CardMotion;
  /** Pet root node. */
  root: () => HTMLDivElement | null;
  /** Wait for the new first frame to be in place before pressing Q. */
  pendingSquash: ReactNS.MutableRefObject<boolean>;
  /** Normalization center writes entry point. */
  setCustomPos: CardStateApi['actions']['setCustomPos'];
  /** Change the source once. */
  setOnce: (on: boolean) => void;
  /** Change to the specified animation. */
  setAnim: (anim: string) => void;
  /** Increment the source sequence number and force replay. */
  bumpSeq: () => void;
  /** The floating prompt is shown and hidden. */
  setTipOn: (on: boolean) => void;
}

/**
 * Create drag assembly of hook.
 *
 * @param rt - Injected react capabilities.
 * @returns receives the hook input from the assembly and returns the drag driver of this card.
 */
export function createCardDrag(rt: CardDragRuntime) {
  const { useRef, useEffect } = rt;

  return function useCardDrag(input: CardDragInput): Drag {
    const { bumpSeq, card, cfgRef, live, motion, pendingSquash, root, setAnim, setCustomPos } = input;
    const { setOnce, setTipOn } = input;

    // The drag driver takes the current frame capability for each event: rendering-by-render reconstruction, and the driver holds this getter for a long time.
    const dragCard = (): DragCard => {
      const metrics = motion.metrics();
      return {
        petId: cfgRef.current.id,
        size: metrics.size,
        halfW: metrics.halfW,
        halfH: metrics.halfH,
        physics: cfgRef.current.physics,
        // No drag animation when sleeping: you can drag, and the position follows the hand, but the sleeping position is maintained (empty pool = the driver degrades to only dragging without changing the source)
        dragAnims: (live.current.flow?.sleeping() ?? false) ? [] : cfgRef.current.animations.drag,
        clickAnims: cfgRef.current.animations.clicks,
        // Same as letting go: the idle animation will not be returned when falling asleep, otherwise the sleeping position will be changed by dragging it.
        idleAnims: (live.current.flow?.sleeping() ?? false) ? [] : cfgRef.current.animations.idle,
        currentAnim: card.animRef.current,
        setOnce: (on) => setOnce(on),
        playAnim: (name) => setAnim(name),
        bumpSeq: () => bumpSeq(),
        markSquash: () => {
          pendingSquash.current = true;
        },
        resumeWork: () => live.current.flow?.resumeWorkStatusAnim() ?? false,
        stopAutonomy: () => motion.stopMove(),
        stopFlight: () => motion.flight.stop(),
        startFlight: motion.startThrow,
        isFrozen: () => live.current.ownAnim.isFrozen(),
        releaseLock: () => live.current.releaseLock(),
        grabVelocity: () => (motion.flight.isFlying() ? motion.flight.velocity() : null),
        playClickSound: () => playClickSound(),
        tipOn: () => live.current.tipOn(),
        placeTip: (x, y) => live.current.placeTip(x, y),
        setTipOn,
        root,
        box: () => motion.box(),
        setBox: (box) => motion.setBox(box),
        commitPlace: (box) => {
          const metrics = motion.metrics();
          const viewport = { width: window.innerWidth, height: window.innerHeight };
          const half = { w: metrics.halfW, h: metrics.halfH };
          const reached = clampReachableBox(box, viewport, metrics);
          // During dragging, follow is directly changed to DOM; the proportion after clamping may be the same as the last rendering, and React will skip the writing of style.
          const rootEl = root();
          if (rootEl) {
            rootEl.style.left = reached.x + 'px';
            rootEl.style.top = reached.y + 'px';
            rootEl.style.right = 'auto';
            rootEl.style.bottom = 'auto';
          }
          motion.setBox(reached);
          setCustomPos(boxToRatio(reached, viewport, half));
        },
      };
    };

    const dragRef = useRef<Drag | null>(null);
    dragRef.current ??= createDrag(dragCard);
    const drag = dragRef.current;
    // To unmount, release the mouse on window. Fallback: The driver outlives the card. If it is not removed, the removed node will be hit.
    useEffect(() => () => drag.dispose(), [drag]);
    live.current.drag = drag;
    return drag;
  };
}
