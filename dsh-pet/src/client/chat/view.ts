/**
 * The root element of the dialog panel: pet tag strip + toolbar + list + error line + input area.
 *
 * Only assembly is done, the node details are in ./view-node; no numbers are taken, no status is maintained.
 * @module dsh-pet/src/client/chat/view
 */
import { HISTORY_ROUNDS, memoryBoundaryIndex, MEMORY_LINE_ATTR } from './api.ts';
import type { ChatPanelRuntime } from './runtime.ts';
import type { ChatPanelState } from './types.ts';
import { composerNode, confirmNode, orphansNode, personaNode, toolsNode } from './view-node.ts';
import { roundNode } from './view-message.ts';

/** Pet Tag Bar: Click to switch conversations. */
function tabsNode(h: ChatPanelRuntime['h'], state: ChatPanelState): unknown {
  return h('div', {
    className: 'pet-chat-tabs',
    children: state.pets.map((pet) =>
      h('button', {
        key: pet.id,
        type: 'button',
        className: 'pet-chat-tab',
        'aria-pressed': String(pet.id === state.petId),
        onClick: () => state.pickPet(pet.id),
        children: pet.name || pet.id,
      }),
    ),
  });
}

/**
 * Top "load earlier": the same position and form as DSH's own history loading.
 *
 * If there are no earlier rounds in the memory, replace the same position with a line of explanation - otherwise the
 * user will not know whether it is "finished" or "broken" after the button disappears.
 */
function olderNode(h: ChatPanelRuntime['h'], t: ChatPanelRuntime['t'], state: ChatPanelState): unknown {
  if (state.rounds.length === 0) return null; // Empty states are handled by hints in the list
  if (state.hasOlder) {
    return h('div', {
      className: 'pet-chat-older',
      children: [
        h('button', {
          type: 'button',
          className: 'pet-chat-older-btn',
          onClick: () => state.showOlder(),
          children: t('older'),
        }),
      ],
    });
  }
  // When 200 rounds are reached, add an upper limit explanation: No matter how many interfaces are available, they cannot be provided.
  const capped = state.rounds.length >= HISTORY_ROUNDS;
  return h('div', {
    className: 'pet-chat-older',
    children: [
      h('span', {
        className: 'pet-chat-older-note',
        children: capped ? t('olderEndCapped', { n: HISTORY_ROUNDS }) : t('olderEnd'),
      }),
    ],
  });
}

/** Memory Boundary: Below the line is the most recent N round that desktop pet actually brings into context each time. */
function memoryLineNode(h: ChatPanelRuntime['h'], t: ChatPanelRuntime['t'], rounds: number): unknown {
  return h('div', {
    key: 'memory-line',
    className: 'pet-chat-memory',
    // Press this mark on the "Memory Line" button in the toolbar to scroll over: Whether the line is in the window and its position are all determined by rendering.
    [MEMORY_LINE_ATTR]: 'true',
    children: [h('span', { className: 'pet-chat-memory-note', children: t('memoryLine', { n: rounds }) })],
  });
}

/** Message list: load earlier + memory bounds + empty state prompt or render on wheel. */
function listNode(rt: ChatPanelRuntime, state: ChatPanelState): unknown {
  const emptyText = state.loading ? rt.t('loading') : state.petId === '' ? rt.t('emptyNoPet') : rt.t('emptyNoChat');
  const body =
    state.rounds.length === 0
      ? [rt.h('div', { key: 'empty', className: 'pet-chat-hint', children: emptyText })]
      : state.rounds.map((round) => roundNode(rt, state, round));
  const cut = memoryBoundaryIndex(state.rounds.length, state.memoryRounds);
  if (cut !== null && state.memoryRounds !== undefined) {
    body.splice(cut, 0, memoryLineNode(rt.h, rt.t, state.memoryRounds));
  }
  return rt.h('div', {
    className: 'pet-chat-list',
    ref: state.listRef,
    children: [olderNode(rt.h, rt.t, state), ...body],
  });
}

/**
 * Picture enlargement: directly use the `ImageLightbox` of the platform - it is the same component as the picture
 * clicked in the DSH session. It is responsible for the full screen mask, Esc / point mask closing, and the focus
 * returning to the original position after closing.
 *
 * @returns is null when there is no preview or primitives cannot be obtained.
 */
function previewNode(rt: ChatPanelRuntime, state: ChatPanelState): unknown {
  if (state.previewUrl === undefined || rt.ui === undefined) return null;
  const { ImageLightbox } = rt.ui;
  return rt.h(ImageLightbox, {
    src: state.previewUrl,
    alt: rt.t('imageAlt'),
    labels: { dialog: rt.t('lightboxDialog'), close: rt.t('close') },
    onClose: () => state.closeImage(),
  });
}

/**
 * Create panel root elements.
 *
 * @param rt - Injected react capability.
 * @param state - Current status and actions.
 * @returns Panel root element.
 */
export function buildPanel(rt: ChatPanelRuntime, state: ChatPanelState, memoryStatus?: unknown): unknown {
  const { h } = rt;
  return h('div', {
    className: 'pet-chat',
    // Esc close the rolling shutter: it can be received whether the focus is on the button or in the input box (event bubbles to the root node)
    onKeyDown: (event: { key: string }) => {
      if (state.personaOpen && event.key === 'Escape') state.closePersona();
    },
    children: [
      tabsNode(h, state),
      orphansNode(h, rt.t, state),
      toolsNode(h, rt.t, state),
      memoryStatus ?? null,
      personaNode(h, state),
      listNode(rt, state),
      confirmNode(rt, state),
      previewNode(rt, state),
      state.error === '' ? null : h('div', { className: 'pet-chat-error', role: 'alert', children: state.error }),
      composerNode(h, rt.t, state),
    ],
  });
}
