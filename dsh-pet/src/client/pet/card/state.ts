/**
 * Responsive status and writing entry point of a pet card: animation, orientation, prompts and custom position. It is
 * not responsible for derived geometry (geometry is responsible) and driver instances (held by the assembly root), nor
 * does it make any decisions. Dependency injection react; the state is only used within the card and is not shared
 * across cards. Invariants: anim / once / seq. The three jointly decide whether to change the source. Changing only
 * one of them will lead to the anti-replication branch.
 * @module dsh-pet/src/client/pet/card/state
 */
import type { Center } from '../motion/geometry.ts';
import type { Corner } from '../../../shared/types.ts';
import type { PetFacing } from '../../../shared/state.ts';
import type * as ReactNS from 'react';

/** The status of a pet card. */
export interface CardState {
  /** The current animation name may be an absolute address. */
  anim: string;
  /** This section is played only once; false means loop. */
  once: boolean;
  /** Source changing serial number: Use this to force the source to be changed again when the same animation is replayed. */
  seq: number;
  /** The playback request number is associated with the receipt issued by anim; it must be cleared when changing the source of the self-broadcast. */
  cuePlayback: string | null;
  /** Orientation, determines the mirroring and moving direction. */
  facing: PetFacing;
  /** The floating prompt is shown and hidden. */
  tipOn: boolean;
  /** Normalized center after user dragging; null means still positioned according to corners. */
  customPos: Center | null;
  /** Pet width (px); configure the mirror and set it to follow when the page changes size. */
  size: number;
  /** Corner positioning. */
  corner: Corner;
  /** Corner margin (px). */
  margin: { x: number; y: number };
}

/** The status is written as entry point; the read-only consumer can use state. */
export interface CardStateActions {
  /** Change to the specified animation. */
  setAnim(anim: string): void;
  /** Set whether to play only once. */
  setOnce(once: boolean): void;
  /** Increment the source sequence number and force replay of the current animation. */
  bumpSeq(): void;
  /** Set playback request number; self-broadcast source change null. */
  setCuePlayback(id: string | null): void;
  /** Set orientation. */
  setFacing(facing: PetFacing): void;
  /** Set the prompt to show or hide. */
  setTipOn(on: boolean): void;
  /** Set the normalization center; null means returning to the corner positioning, and also accepts functional updates to force rearrangement. */
  setCustomPos(pos: ReactNS.SetStateAction<Center | null>): void;
  /** Set pet width. */
  setSize(size: number): void;
  /** Set corners. */
  setCorner(corner: Corner): void;
  /** Set corner margins. */
  setMargin(margin: { x: number; y: number }): void;
  /**
   * One-time source change: set animation and playback methods, optional forced replay.
   *
   * @param anim - The name or absolute address of the animation to be played.
   * @param opts - once defaults to true; when replay is true, the sequence number is incremented to force another
   * pass; cue is the playback request number.
   */
  play(anim: string, opts?: { once?: boolean; replay?: boolean; cue?: string | null }): void;
}

/** Card status container: status, write entry point and three ref synchronized with the status. */
export interface CardStateApi {
  /** When frame status. */
  state: CardState;
  /** Write entry point. */
  actions: CardStateActions;
  /** The latest value of the current animation name; the driver and callback read it to prevent the closure from reading the old value. */
  animRef: ReactNS.MutableRefObject<string>;
  /** The latest value of orientation. */
  facingRef: ReactNS.MutableRefObject<PetFacing>;
  /** Latest value of normalized center. */
  customPosRef: ReactNS.MutableRefObject<Center | null>;
}

/** Injected react capability. */
export interface CardStateRuntime {
  /** Status. */
  useState: <T>(init: T) => [T, ReactNS.Dispatch<ReactNS.SetStateAction<T>>];
  /** Quote. */
  useRef: <T>(initial: T) => ReactNS.MutableRefObject<T>;
}

/** Initial values: Dimensions, premiere animation, corners and margins are all from the finished configuration. */
export interface CardStateInit {
  /** Pet width (px). */
  size: number;
  /** The name of the first animation. */
  anim: string;
  /** Corner positioning. */
  corner: Corner;
  /** Corner margin (px). */
  margin: { x: number; y: number };
}

/**
 * hook making card status container.
 *
 * @param rt - Injected react capabilities.
 * @returns receives the initial value of hook; state with ref is retained across renders within the card.
 */
export function createCardState(rt: CardStateRuntime) {
  const { useState, useRef } = rt;

  return function useCardState(init: CardStateInit): CardStateApi {
    const [anim, setAnim] = useState(init.anim);
    const [once, setOnce] = useState(true);
    const [seq, setSeq] = useState(0);
    const [cuePlayback, setCuePlayback] = useState<string | null>(null);
    const [facing, setFacing] = useState<PetFacing>('left');
    const [tipOn, setTipOn] = useState(false);
    const [customPos, setCustomPos] = useState<Center | null>(null);
    const [size, setSize] = useState(init.size);
    const [corner, setCorner] = useState<Corner>(init.corner);
    const [margin, setMargin] = useState(init.margin);

    // ref is a mirror image of the state: the driver and event callback read them outside the closure and cannot wait for the next frame.
    const animRef = useRef(anim);
    animRef.current = anim;
    const facingRef = useRef(facing);
    facingRef.current = facing;
    const customPosRef = useRef(customPos);
    customPosRef.current = customPos;

    const bumpSeq = () => setSeq((s) => s + 1);
    const play: CardStateActions['play'] = (next, opts) => {
      setAnim(next);
      setOnce(opts?.once ?? true);
      if (opts?.replay) bumpSeq();
      if (opts?.cue !== undefined) setCuePlayback(opts.cue);
    };

    return {
      actions: {
        bumpSeq,
        play,
        setAnim,
        setCorner,
        setCuePlayback,
        setCustomPos,
        setFacing,
        setMargin,
        setOnce,
        setSize,
        setTipOn,
      },
      animRef,
      customPosRef,
      facingRef,
      state: { anim, corner, cuePlayback, customPos, facing, margin, once, seq, size, tipOn },
    };
  };
}
