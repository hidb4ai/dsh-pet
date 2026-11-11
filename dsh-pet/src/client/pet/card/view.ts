/**
 * DOM structure of pet card: root node, stage and two-channel video, hit area, bubble slot, floating prompt. No state
 * is held and no judgment is made: size variables, positioning styles and event callbacks are all passed in by PetCard
 * when the frame is in, here they are only assembled in order. The hit area styles of h and pet/motion/geometry and
 * the class name of shared/tooltip for dependency injection. Invariant: The hit area is within stage, bubble and
 * prompt are direct child nodes of the root node - all three are positioned relative to the root node.
 * @module dsh-pet/src/client/pet/card/view
 */
import { PET_HIT_STYLE } from '../motion/geometry.ts';
import { TOOLTIP_CLASS } from '../../../shared/tooltip.ts';
import type { CSSProperties, ReactNode } from 'react';
import type * as ReactNS from 'react';
import type { jsx } from 'react/jsx-runtime';
import type { Corner } from '../../../shared/types.ts';

/** The rendering input of the pet card view: all are the current frame value, ref and event callback. */
export interface CardViewProps {
  /** Root node: host for positioning and size variables. */
  rootRef: ReactNS.MutableRefObject<HTMLDivElement | null>;
  /** Stage: The displacement is constant, and the foot pads are not canceled with dragging. */
  stageRef: ReactNS.MutableRefObject<HTMLDivElement | null>;
  /** Foreground video (one of A/B double buffers). */
  videoARef: ReactNS.MutableRefObject<HTMLVideoElement | null>;
  /** Backstage video. */
  videoBRef: ReactNS.MutableRefObject<HTMLVideoElement | null>;
  /** Floating prompt: The position is directly written from placeTip to style. */
  tipRef: ReactNS.MutableRefObject<HTMLDivElement | null>;
  /** Corner positioning, write data-corner and get the value from CSS. */
  corner: Corner;
  /** Orientation, write data-facing mirrored by CSS. */
  facing: 'left' | 'right';
  /** Pet width px, injected --dsh-pet-size. */
  size: number;
  /** Horizontal margin px. */
  marginX: number;
  /** Vertical margin px. */
  marginY: number;
  /** bubble text number px. */
  fontBubblePx: number;
  /** The floating prompt font size is px. */
  fontTipPx: number;
  /** Root node positioning style; it is an empty object when not dragged, and the position is given to the CSS variables of the corners and margins. */
  rootStyle: CSSProperties;
  /** Stage displacement style; cancel the pad displacement during dragging. */
  stageStyle: CSSProperties;
  /** The current bubble that should be hung; null means there is no bubble. */
  bubble: ReactNode;
  /** Whether the floating prompt is lit. */
  tipOn: boolean;
  /** Pet name: the content of the floating prompt, and also serves as the barrier-free name of the hit area. */
  name: string;
  /** Click on the hit area. */
  onClick(e: ReactNS.MouseEvent<HTMLDivElement>): void;
  /** Press: Enable pointer capture and dragging. */
  onPointerDown(e: ReactNS.PointerEvent<HTMLDivElement>): void;
  /** Pointer movement: drag to follow. */
  onPointerMove(e: ReactNS.PointerEvent<HTMLDivElement>): void;
  /** Lift and cancel share the same path. */
  onPointerUp(e: ReactNS.PointerEvent<HTMLDivElement>): void;
  /** The pointer enters the hit zone. */
  onPointerEnter(e: ReactNS.PointerEvent<HTMLDivElement>): void;
  /** The pointer leaves the hit area. */
  onPointerLeave(): void;
  /** Right-click menu. */
  onContextMenu(e: ReactNS.MouseEvent<HTMLDivElement>): void;
}

/** Common properties of the two videos: mute, inline playback and automatic playback. */
const VIDEO_PROPS = { muted: true, playsInline: true, autoPlay: true };

/**
 * Create pet card view.
 *
 * @param rt - Injected react capability.
 * @returns is only a pure display component of assemble.
 */
export function makeCardView(rt: { h: typeof jsx }) {
  const { h } = rt;

  return function CardView(props: CardViewProps) {
    return h('div', {
      ref: props.rootRef,
      className: 'dsh-pet-root',
      'data-corner': props.corner,
      'data-facing': props.facing,
      style: Object.assign(
        {
          '--dsh-pet-size': props.size + 'px',
          '--dsh-pet-mx': props.marginX + 'px',
          '--dsh-pet-my': props.marginY + 'px',
          // The final font size injected is px; the CSS side has the original value rolled back, and leaking the injection will not cause damage.
          '--dsh-pet-font-bubble': props.fontBubblePx + 'px',
          '--dsh-pet-font-tip': props.fontTipPx + 'px',
        },
        props.rootStyle,
      ),
      children: [
        // bubble single slot; balance unavailable instructions also go here, manual request and command bubble are not restricted by whisperEnabled.
        props.bubble,
        h('div', {
          ref: props.stageRef,
          className: 'dsh-pet-stage',
          style: props.stageStyle,
          children: [
            h('video', Object.assign({}, VIDEO_PROPS, { ref: props.videoARef, className: 'dsh-pet-video is-front' })),
            h('video', Object.assign({}, VIDEO_PROPS, { ref: props.videoBRef, className: 'dsh-pet-video' })),
            h('div', {
              className: 'dsh-pet-hit',
              style: PET_HIT_STYLE,
              onClick: props.onClick,
              onPointerDown: props.onPointerDown,
              onPointerMove: props.onPointerMove,
              onPointerUp: props.onPointerUp,
              onPointerCancel: props.onPointerUp,
              onPointerEnter: props.onPointerEnter,
              onPointerLeave: props.onPointerLeave,
              onContextMenu: props.onContextMenu,
              // After replacing the original title with a self-drawn floating layer, the accessibility name must still be retained.
              'aria-label': props.name,
            }),
          ],
        }),
        // The permanent floating prompt only cuts class, and the mounting and unloading nodes cannot enjoy the fade-in
        // transition; the coordinates are directly written from placeTip to style. pointer-events:none See
        // TOOLTIP_CSS, otherwise it will block the hit zone and cause enter/leave to flash.
        h('div', {
          ref: props.tipRef,
          className: TOOLTIP_CLASS + (props.tipOn ? ' is-on' : ''),
          'aria-hidden': 'true',
          children: props.name,
        }),
      ],
    });
  };
}
