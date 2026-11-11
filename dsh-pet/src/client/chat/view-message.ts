/**
 * A message and a round of dialogue nodes: avatar, bubble (text + picture), round (question + answer + time).
 *
 * Pure mapping, no numbers and status are taken; the time position is the only agreement: stick to the last message of
 * this round.
 * @module dsh-pet/src/client/chat/view-message
 */
import { attachmentUrl, avatarUrl, memeUrl, type ChatMessageView } from './api.ts';
import type { ChatPanelRuntime } from './runtime.ts';
import { formatStamp } from './stamp.ts';
import { tipAttrs } from './tooltip.ts';
import type { ChatPanelState } from './types.ts';

/** Voice broadcast button: Pasted to the right of the time, four states can be distinguished at a glance - playable / generate mid-circle / highlighted during play / retry if failed. */
function speakNode(
  h: ChatPanelRuntime['h'],
  t: ChatPanelRuntime['t'],
  text: string,
  ts: number,
  state: ChatPanelState,
): unknown {
  const phase = state.speaking?.ts === ts ? state.speaking.phase : 'idle';
  const label =
    phase === 'loading'
      ? t('speakGenerate')
      : phase === 'playing'
        ? t('speakPlaying')
        : phase === 'failed'
          ? t('speakFailed')
          : t('speakPlay');
  return h('button', {
    type: 'button',
    className: 'pet-chat-speak is-' + phase,
    'aria-label': label,
    ...tipAttrs(label),
    onClick: (event: { stopPropagation: () => void }) => {
      // In multi-select mode, the whole round can be clicked: you must block it here, otherwise clicking the speaker will switch the selection smoothly.
      event.stopPropagation();
      // It is allowed to click again even if it fails: there is no need to refresh the panel when synthesis fails accidentally.
      if (phase === 'idle' || phase === 'failed') state.speakRound(ts, text);
    },
    // During generation, the :: before of CSS draws a circle, but the button itself does not put the character; if it fails, it is replaced with a silent speaker.
    children: phase === 'loading' ? null : phase === 'failed' ? '🔇' : '🔊',
  });
}

/**
 * Action playback button: When answering an action performed in this round, stick it to the right side of the speaker,
 * and display the action name in a floating manner. Click to replay.
 *
 * The floating bubble only displays the action name itself (without adding a prefix such as "play action:"); the
 * semantics required for screen reading are placed on aria-label.
 */
function actionNode(
  h: ChatPanelRuntime['h'],
  t: ChatPanelRuntime['t'],
  action: string,
  state: ChatPanelState,
): unknown {
  return h('button', {
    type: 'button',
    className: 'pet-chat-action',
    'aria-label': t('speakAction', { name: action }),
    ...tipAttrs(action),
    onClick: (event: { stopPropagation: () => void }) => {
      // In multi-select mode, you can click the whole round: you must block it here, otherwise clicking the action button will switch the selection smoothly.
      event.stopPropagation();
      state.playAction(action);
    },
    children: h('svg', {
      className: 'pet-chat-action-icon',
      viewBox: '0 0 16 16',
      'aria-hidden': 'true',
      children: h('path', { d: 'M4.5 2.5v11l9-5.5z', fill: 'currentColor' }),
    }),
  });
}

/**
 * Avatar: The pet uses the avatar uploaded on the settings page (the host fallback plugin logo has not been
 * uploaded). I have a Q version of the small face (round face + dull hair + blush + stars).
 *
 * On my side, I draw inline SVG instead of a picture: I can use the theme token directly (dark and light colors
 * automatically follow), and there is no need to make an additional resource request. The shape is aligned with the
 * two-dimensional tonality of the desktop pet, and does not compete with the pet avatar in style.
 */
export function avatarNode(h: ChatPanelRuntime['h'], isMe: boolean, assetRoot: string, version: number): unknown {
  if (!isMe) {
    return h('img', { className: 'pet-chat-avatar', src: avatarUrl(assetRoot, version), alt: '', loading: 'lazy' });
  }
  return h('svg', {
    className: 'pet-chat-avatar',
    viewBox: '0 0 32 32',
    'aria-hidden': 'true',
    children: [
      h('circle', { cx: 16, cy: 16, r: 16, fill: 'var(--dsw-specific-bubble)' }),
      h('circle', { cx: 16, cy: 17.5, r: 9.5, fill: 'var(--dsw-alias-bg-layer-1)' }),
      // Bangs: covering the upper edge of the face, leaving dull hair
      h('path', {
        d: 'M6.8 15.5a9.2 9.2 0 0 1 18.4 0q-4.6-4.2-9.2-4.2t-9.2 4.2z',
        fill: 'var(--dsw-alias-label-tertiary)',
        opacity: 0.75,
      }),
      h('path', {
        d: 'M16 9.2q1.1-2.6 3.4-1.7',
        fill: 'none',
        stroke: 'var(--dsw-alias-label-tertiary)',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
        opacity: 0.75,
      }),
      // Eyes + Highlight
      h('ellipse', { cx: 12.4, cy: 17.6, rx: 1.5, ry: 2, fill: 'var(--dsw-alias-label-primary)' }),
      h('ellipse', { cx: 19.6, cy: 17.6, rx: 1.5, ry: 2, fill: 'var(--dsw-alias-label-primary)' }),
      h('circle', { cx: 12.9, cy: 16.8, r: 0.5, fill: 'var(--dsw-alias-bg-layer-1)' }),
      h('circle', { cx: 20.1, cy: 16.8, r: 0.5, fill: 'var(--dsw-alias-bg-layer-1)' }),
      // Blush
      h('ellipse', {
        cx: 9.6,
        cy: 21,
        rx: 1.7,
        ry: 1.1,
        fill: 'var(--dsw-alias-state-error-secondary)',
        opacity: 0.45,
      }),
      h('ellipse', {
        cx: 22.4,
        cy: 21,
        rx: 1.7,
        ry: 1.1,
        fill: 'var(--dsw-alias-state-error-secondary)',
        opacity: 0.45,
      }),
      // Mouth
      h('path', {
        d: 'M14.6 21.6q1.4 1.5 2.8 0',
        fill: 'none',
        stroke: 'var(--dsw-alias-label-secondary)',
        strokeWidth: 1,
        strokeLinecap: 'round',
      }),
      // Star: Click on the feeling of "I am"
      h('path', {
        d: 'M25.5 5.5v4M23.5 7.5h4',
        fill: 'none',
        stroke: 'var(--dsw-alias-state-business-primary)',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
        opacity: 0.9,
      }),
    ],
  });
}

/** Rendering input of a message; if the parameters exceed 4, the object will be included, and the call point does not need to rely on position memory. */
export interface MessageNodeInput {
  /** The message body and its attachments are quoted. */
  readonly message: ChatMessageView;
  /** true = User's own side (inline small face avatar). */
  readonly isMe: boolean;
  /** The asset root to which the pet belongs: both avatars and emoticons are taken from it. */
  readonly assetRoot: string;
  /** Broken cache version number of avatar address. */
  readonly avatarVersion: number;
  /** Click to open the large picture; passed in from the wheel node, this module does not touch the panel state. */
  readonly onOpenImage: (url: string) => void;
}

/**
 * A message: avatar + bubble; the picture is arranged after the text, click to enlarge.
 */
export function messageNode(h: ChatPanelRuntime['h'], t: ChatPanelRuntime['t'], input: MessageNodeInput): unknown {
  const { message, isMe, assetRoot, avatarVersion, onOpenImage } = input;
  const image =
    message.image !== undefined
      ? attachmentUrl(message.image)
      : message.meme !== undefined
        ? memeUrl(message.meme, assetRoot)
        : undefined;
  return h('div', {
    className: 'pet-chat-msg ' + (isMe ? 'is-me' : 'is-pet'),
    children: [
      avatarNode(h, isMe, assetRoot, avatarVersion),
      h('div', {
        className: 'pet-chat-bubble',
        children: [
          h('div', { className: 'pet-chat-text', children: message.text }),
          image === undefined
            ? null
            : h('button', {
                type: 'button',
                className: 'pet-chat-img-btn',
                'aria-label': t('imageOpen'),
                ...tipAttrs(t('imageOpen')),
                onClick: () => onOpenImage(image),
                children: h('img', { className: 'pet-chat-img', src: image, alt: t('imageAlt'), loading: 'lazy' }),
              }),
        ],
      }),
    ],
  });
}

/** One round: Question + Answer + Time; the checkbox only appears in multi-select mode. */
export function roundNode(
  rt: ChatPanelRuntime,
  state: ChatPanelState,
  round: ChatPanelState['rounds'][number],
): unknown {
  const { h, t } = rt;
  const selected = state.selected.includes(round.ts);
  // In multi-select mode, the whole round is a clickable card: selected will have a light background, and unselected will be transparent (consistent with the bean bag)
  const className = 'pet-chat-round' + (state.selecting ? ' is-selecting' : '') + (selected ? ' is-selected' : '');
  return h('div', {
    key: String(round.ts),
    className,
    // The entire row can be clicked in multi-select mode; when clicking check boxes, picture buttons or links, let them handle themselves to avoid switching twice.
    onClick: state.selecting
      ? (event: { target: unknown }) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          if (target.closest('.pet-chat-pick, button, a, [role="button"]') !== null) return;
          state.toggleRound(round.ts);
        }
      : undefined,
    children: [
      state.selecting
        ? h('label', {
            className: 'pet-chat-pick',
            title: t('selectRoundTitle'),
            children: [
              h('input', {
                type: 'checkbox',
                checked: selected,
                onChange: () => state.toggleRound(round.ts),
                'aria-label': t('selectRound'),
              }),
            ],
          })
        : null,
      h('div', {
        className: 'pet-chat-round-body',
        children: [
          round.user === undefined
            ? null
            : messageNode(h, t, {
                message: round.user,
                isMe: true,
                assetRoot: state.assetRoot,
                avatarVersion: state.avatarVersion,
                onOpenImage: state.showImage,
              }),
          round.assistant === undefined
            ? null
            : messageNode(h, t, {
                message: round.assistant,
                isMe: false,
                assetRoot: state.assetRoot,
                avatarVersion: state.avatarVersion,
                onOpenImage: state.showImage,
              }),
          // Time will follow the last message of this round: If you have an answer, post it below the answer, otherwise post it below my question.
          round.ts > 0
            ? h('div', {
                className: 'pet-chat-time ' + (round.assistant === undefined ? 'is-me' : 'is-pet'),
                children: [
                  formatStamp(round.ts, Date.now(), t),
                  // Only the answer sentence can playback request: the user's own words have no voice.
                  round.assistant === undefined ? null : speakNode(h, t, round.assistant.text, round.ts, state),
                  // The action button is attached to the right side of the speaker: the whole block does not appear when no action is performed in this round.
                  round.assistant?.action === undefined ? null : actionNode(h, t, round.assistant.action, state),
                ],
              })
            : null,
        ],
      }),
    ],
  });
}
