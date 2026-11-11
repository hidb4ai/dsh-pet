/**
 * The assembly root of a pet card: Create the driver and hook in a fixed order, and then combine the current frame
 * capabilities into view input. Only wiring: no determination (determination between shared and each driver), no
 * rendering (DOM on card-view), no cross-card status. The assembly order cannot be changed: the animation chain is
 * earlier than the movement (the callback needs to read the movement), the movement is earlier than the drag (the drag
 * needs to read the flight), and the floating layer is last. The pool must be filled during the rendering period: the
 * driver instance in the late binding slot is only assigned within this rendering and cannot be written elsewhere.
 * @module dsh-pet/src/client/pet/card/runtime
 */
import { pick } from '../../../shared/pickers.ts';
import { postAction } from '../../../shared/state.ts';
import { ROUTE_PATH } from '../../../shared/constants.ts';
import { resolveFontPx } from '../../../shared/fonts.ts';
import { resolvePetSizePx } from '../../../shared/pet-size.ts';
import { makeBalanceBubble, makeWhisperBubble } from '../../bubble.ts';
import { makeTodoBubble } from '../../todo-bubble.ts';
import { petBridge } from '../../settings.ts';
import { playClickSound } from '../click-sound.ts';
import { createMenuActions, type MenuActions } from '../menu-actions.ts';
import { derivePetMetrics, petRootStyle, petStageStyle } from '../motion/geometry.ts';
import { makePlaybackReporter } from '../playback-report.ts';
import { createAnimationFlow } from './animation-flow.ts';
import { createBubbleSlots } from './bubble-slots.ts';
import { createCardAnimation } from './animation.ts';
import { createCardDrag } from './drag.ts';
import { createCardEntry, type CardEntry } from './entry.ts';
import { createCardMotion } from './motion.ts';
import { createCardState } from './state.ts';
import { createCueEffects } from './cue-effects.ts';
import { createLockFreeze } from './lock-freeze.ts';
import type { CardHub } from './hub.ts';
import type { CardLive } from './live.ts';
import type { CardViewProps } from './view.ts';
import type { PetCardProps } from './props.ts';
import type { PetRuntime } from '../types.ts';

/**
 * The factory that creates the card assembly root: component-level singletons (bubble, status, instructions, animation
 * flow) are all built here.
 *
 * @param rt - Injected react capability.
 * @returns receives hook in container props and returns the rendering input given to card-view.
 */
export function createCardRuntime(rt: PetRuntime) {
  const { h, useEffect, useRef, useState } = rt;
  /** Balance bubble: Data and display are passed in from the assembly root. */
  const BalanceBubble = makeBalanceBubble({ h, useState, useEffect });
  /** whisper bubble: Text and visibility are passed in from the assembly root. */
  const WhisperBubble = makeWhisperBubble({ h });
  /** To-do bubble: The panel body hangs on itself, and the close button callback assembly root. */
  const TodoBubble = makeTodoBubble({ h, useEffect, useRef });
  /** The single slots for the four bubbles: visibility, dwell time and priority are all here. */
  const useBubbleSlots = createBubbleSlots(
    { h, useState, useEffect, useRef },
    { balanceBubble: BalanceBubble, todoBubble: TodoBubble, whisperBubble: WhisperBubble },
  );
  const useCardState = createCardState({ useState, useRef });
  const useLockFreeze = createLockFreeze({ useEffect, useRef });
  const useCueEffects = createCueEffects({ useEffect, useRef });
  const useAnimationFlow = createAnimationFlow({ useRef });
  const useCardAnimation = createCardAnimation({ useEffect, useRef });
  const useCardMotion = createCardMotion({ useEffect, useRef });
  const useCardDrag = createCardDrag({ useRef, useEffect });
  const useCardEntry = createCardEntry({ useEffect, useRef });

  return function useCardRuntime(props: PetCardProps): CardViewProps {
    const { arena, balance, balanceManual, cfg, lock, lockTick, menuItemsRef, sleep, sleepTick, workStatus } = props;
    const { onFocusSession } = props;

    // The actual rendering width: the percentage is only parsed once according to the current viewport width when
    // mounting and configuration changes, and does not follow when dragging the window. The physics, font size, and
    // CSS variables all share this value - counting them both once will cause the hitbox and visual misalignment.
    const effectiveSizePx = resolvePetSizePx(cfg.size, cfg.sizePercent, window.innerWidth);

    // Card status container: animation, orientation, drag state, prompts and custom position; write entry point at card-state.
    const card = useCardState({
      anim: cfg.animations.idle[0] ?? '',
      corner: cfg.position.corner,
      margin: { x: cfg.position.marginX, y: cfg.position.marginY },
      size: effectiveSizePx,
    });
    const { actions, state } = card;
    const { corner, customPos, facing, margin, size, tipOn } = state;

    // Driver instance and cross-concern entry point: See the module header for the creation order, and filling is only within this function.
    const liveRef = useRef<CardLive>({} as CardLive);
    const menuActionsRef = useRef<MenuActions | null>(null);
    const entryRef = useRef<CardEntry | null>(null);
    const pendingSquashRef = useRef(false);

    // The latest value of resolved configuration and working status: callback is later than status update and can only read ref.
    const cfgRef = useRef(cfg);
    cfgRef.current = cfg;
    const workStatusRef = useRef(workStatus);
    workStatusRef.current = workStatus;

    // DOM node: The value is available only after the view is mounted, and the driver reads all values through the value function.
    const rootRef = useRef<HTMLDivElement | null>(null);
    const stageRef = useRef<HTMLDivElement | null>(null);
    const videoARef = useRef<HTMLVideoElement | null>(null);
    const videoBRef = useRef<HTMLVideoElement | null>(null);
    const tipRef = useRef<HTMLDivElement | null>(null);

    // The receipt is in playback-report.ts: the address, request body and failure log are all there, and there is only one function here.
    const reportPlayback = makePlaybackReporter({ petId: cfg.id });

    // Dimensions and derived geometry; metric coefficients are in motion/geometry.ts, used here only for destructuring.
    const { halfW, halfH, bottomPad, sideAllow } = derivePetMetrics(size);
    // The font size is calculated according to the size of this pet and is injected into root. The bubble and floating prompts read it.
    const fontPx = resolveFontPx(cfg.font, size);
    const petAnims = cfg.animations;

    // Configuration changes are immediately followed and triggered after the container is re-merged or the settings page is saved.
    useEffect(() => {
      actions.setSize(resolvePetSizePx(cfg.size, cfg.sizePercent, window.innerWidth));
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Setters are stable; only the two configured dimensions trigger updates.
    }, [cfg.size, cfg.sizePercent]);

    useEffect(() => {
      actions.setCorner(cfg.position.corner);
      actions.setMargin({ x: cfg.position.marginX, y: cfg.position.marginY });
      // Changing the position is a clear "put here": clear the drag position in the session and let the configuration
      // take effect again - this is also the channel for the settings page to call back the pet that ran out of the
      // viewport. Only resizing is not included in this list and should not lose its place.
      actions.setCustomPos(null);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Setters are stable; only these three position fields trigger updates.
    }, [cfg.position.corner, cfg.position.marginX, cfg.position.marginY]);

    // The single slots of the four bubbles: visibility, dwell timing and priority are all in bubble-slots. Only view input is fed here.
    const bubbles = useBubbleSlots({
      assetRoot: cfg.assetRoot,
      balance,
      balanceEnabled: cfg.balanceEnabled,
      balanceManual,
      workStatusEnabled: cfg.workStatusEnabled,
      workTerminal: workStatus?.state === 'success' || workStatus?.state === 'error',
      workSessionId: workStatus?.sessionId ?? null,
      ...(onFocusSession === undefined ? {} : { onFocusSession }),
    });

    const ownAnim = useCardAnimation({
      card,
      cfgRef,
      live: liveRef,
      lock,
      pendingSquash: pendingSquashRef,
      petId: cfg.id,
      report: reportPlayback,
      setCuePlayback: actions.setCuePlayback,
      videoA: () => videoARef.current,
      videoB: () => videoBRef.current,
      workStatusRef,
    });

    const motion = useCardMotion({
      arena,
      card,
      cfgRef,
      live: liveRef,
      metrics: { bottomPad, halfH, halfW, sideAllow, size },
      moves: petAnims.moves,
      petId: cfg.id,
      root: () => rootRef.current,
      setAnim: actions.setAnim,
      setCustomPos: actions.setCustomPos,
      setOnce: actions.setOnce,
    });

    const drag = useCardDrag({
      bumpSeq: actions.bumpSeq,
      card,
      cfgRef,
      live: liveRef,
      motion,
      pendingSquash: pendingSquashRef,
      root: () => rootRef.current,
      setAnim: actions.setAnim,
      setCustomPos: actions.setCustomPos,
      setOnce: actions.setOnce,
      setTipOn: actions.setTipOn,
    });

    // Right-click menu, dialogue and floating prompts: Action dispatch is forwarded through ref to avoid looping with the menu-actions construction period.
    const entry = useCardEntry({
      card,
      cfgRef,
      drag,
      live: liveRef,
      menuItemsRef,
      motion,
      runMenuAction: (leaf, playbackId, keepFacing) => menuActionsRef.current?.run(leaf, playbackId, keepFacing),
      showTodo: bubbles.showTodo,
      stage: () => stageRef.current,
      tipRef,
      toggleTodo: bubbles.toggleTodo,
    });
    entryRef.current = entry;

    // Menu action dispatch: relies on movement, dragging, prompts and dialogue around entry points, so place them after them.
    menuActionsRef.current ??= createMenuActions({
      animations: () => cfgRef.current.animations,
      applyMerged: (merged) => petBridge.reload(merged),
      faceLeft: () => actions.setFacing('left'),
      isFacingRight: () => card.facingRef.current === 'right',
      openChat: () => entryRef.current?.openChat(),
      openTodo: () => entryRef.current?.openTodo(),
      petId: cfg.id,
      playOnce: (anim, playbackId) => {
        actions.setOnce(true);
        actions.setAnim(anim);
        actions.setCuePlayback(playbackId);
      },
      report: reportPlayback,
      resetPosition: () => actions.setCustomPos(null),
      // Sleep: The menu must be rejected the moment it is clicked (dialog pop-ups, to-do panels, and action playback requests are all pure front-end behaviors and cannot be blocked by the host)
      say: (text) => liveRef.current.flow?.speak(text, undefined, undefined, undefined, false),
      locked: () => ownAnim.isFrozen(),
      sleepRefuseTexts: () => cfgRef.current.sleepRefuseTexts ?? [],
      sleeping: () => liveRef.current.flow?.sleeping() ?? false,
      stopMove: motion.stopMove,
      stopThrow: () => motion.flight.stop(),
      tryMove: motion.walk.tryMove,
      warn: (message) => console.warn(message),
    });
    const menuActions = menuActionsRef.current;

    // Occupied lock: host is held by memory, renderer is aware of pets .< id >. lock / state leaf. Freezing only
    // blocks self-broadcasting; explicit instructions (say / anim / position / throw) are not blocked at all. That is
    // what the lock holder wants to protect.
    const lockFreeze = useLockFreeze({
      lock,
      lockTick,
      onFrozen: () => {
        // Simply blocking the random chain is not enough: it is only called when the animation is finished playing, and will not stop until the current segment is played without pausing.
        motion.stopMove();
        // Task status bubble: It will be closed as soon as the lock takes effect, and it will not be filled up when it is unfrozen.
        bubbles.hideWork();
      },
      onResumed: () => {
        // Unfreezing: The non-final working state will return to the state position loop, otherwise it will return to idle once, and the animation will be linked back to the random chain after playing.
        if (liveRef.current.flow?.resumeWorkStatusAnim() ?? false) return;
        if (petAnims.idle.length) {
          actions.setAnim(pick(petAnims.idle, card.animRef.current));
          actions.setOnce(true);
          actions.bumpSeq();
        }
      },
      setFrozen: ownAnim.setFrozen,
    });
    liveRef.current.releaseLock = () => {
      lockFreeze.release();
      void postAction(ROUTE_PATH + '/lock/release?pet=' + encodeURIComponent(cfg.id), { force: true });
    };

    // Shared runtime: state containers, drivers and cross-concern actions are combined into one, and instruction processing takes values on demand.
    const hub: CardHub = {
      anims: () => cfgRef.current.animations,
      applyThrow: motion.applyThrow,
      bubbles,
      card,
      cfg: () => cfgRef.current,
      isDragging: () => drag.isActive(),
      ownAnim,
      // The fourth parameter = host command: playback request from pets .< id >. anim, if you do not press "User Click", you will be judged to be asleep.
      playByName: (anim, playbackId, keepFacing) =>
        menuActions.run({ anim, label: anim }, playbackId, keepFacing, true),
      posFollow: motion.posFollow,
      speak: (text, image, url, duration, anim) => liveRef.current.flow?.speak(text, image, url, duration, anim),
      // Sleeping is a status, not a command: the automatic source (working status/balance/whisper) reads it to decide whether to shut up or not.
      sleeping: () => liveRef.current.flow?.sleeping() ?? false,
      // Occupy lock: The semantics of the lock is to hand over control to a third party. Both the sleeping menu gate and the automation gate give way to the lock holder.
      locked: () => ownAnim.isFrozen(),
      stopMotion: motion.stopMove,
      tryWalk: motion.walk.tryMove,
    };
    // The allocation of seven instructions is at cue-effects: here only the current shot props is handed over.
    useCueEffects(hub, props);
    // The animation stream is created one step later than the command processing: it needs to read the working status, and also needs to go through the hub conversation and recovery state.
    const flow = useAnimationFlow(hub, workStatus);
    liveRef.current.flow = flow;

    // Sleeping: The host writes the leaf and the renderer executes it; it is only pushed once when the leaf changes (re-rendering without change does not replay the animation).
    useEffect(() => {
      if (sleep) flow.applySleep(sleep);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Trigger only on leaf revision changes; sleep is the current snapshot.
    }, [sleepTick]);

    const stageStyle = petStageStyle(bottomPad);
    const rootStyle = petRootStyle(
      customPos,
      { width: window.innerWidth, height: window.innerHeight },
      { h: halfH, w: halfW },
    );

    return {
      // bubble single slot: four bubbles share the same set of positioning, and only one is hung according to priority.
      bubble: bubbles.node(),
      corner,
      facing,
      fontBubblePx: fontPx.bubble,
      fontTipPx: fontPx.tip,
      marginX: margin.x,
      marginY: margin.y,
      name: cfg.name,
      onClick: () => {
        // The drag guard must be before the sleeping branch: after the pointer is captured, the browser will reissue
        // click when it is released. It is not a click (it does not matter how long it is dragged). When awake, this
        // branch is judged within drag.onClick, and the sleeping branch bypasses there.
        if (drag.justDragged() || drag.isActive()) return;
        const phase = liveRef.current.flow?.sleepPhase() ?? null;
        // Really asleep (in loop or wake-up transition): click = wake up. The squeeze and sound effects are as usual,
        // but the click response animation is not played - the product this time is "get up".
        if (phase !== null && phase !== 'start') {
          const front = ownAnim.frontVideo();
          if (front) liveRef.current.squash.start(front);
          playClickSound();
          void postAction(ROUTE_PATH + '/wake?pet=' + encodeURIComponent(cfg.id));
          return;
        }
        // Being clicked during the transition to falling asleep: This time falling asleep will be invalidated and processed as a normal click (squeeze + sound effect + click response), and "Get Up" will no longer be played.
        if (phase === 'start') void postAction(ROUTE_PATH + '/wake?pet=' + encodeURIComponent(cfg.id));
        drag.onClick();
      },
      onContextMenu: entry.handleContextMenu,
      onPointerDown: drag.onPointerDown,
      onPointerEnter: entry.onPointerEnter,
      onPointerLeave: entry.onPointerLeave,
      onPointerMove: drag.onPointerMove,
      onPointerUp: drag.onPointerUp,
      rootRef,
      rootStyle,
      size,
      stageRef,
      stageStyle,
      tipOn,
      tipRef,
      videoARef,
      videoBRef,
    };
  };
}
