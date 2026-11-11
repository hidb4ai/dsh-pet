/**
 * The toolbar and input area nodes of the panel: orphan prompts, multi-select switches, preview to be sent, input
 * boxes and send keys.
 *
 * Messages and wheels are in ./view-message; only the interaction of "panel shell" is placed here, and `confirm` is
 * left here to describe click semantics.
 * @module dsh-pet/src/client/chat/view-node
 */
import { claimFileDragOver, claimFileDrop, markDropTarget, unmarkDropTarget } from '../file-drop.ts';
import type { DragLike, DropTargetLike } from '../file-drop.ts';
import type { Key } from './locales/index.ts';
import type { ChatPanelRuntime } from './runtime.ts';
import type { ChatPanelState, ConfirmKind, DraftKeyEvent } from './types.ts';

/**
 * Prompt bar for deleted pet residual history: display the number and give a "Clean" message.
 *
 * This type of pet is no longer in the configuration and cannot be seen in the panel list - without prompting here,
 * the user will not have any entry points to clear.
 */
export function orphansNode(h: ChatPanelRuntime['h'], t: ChatPanelRuntime['t'], state: ChatPanelState): unknown {
  if (state.orphans.length === 0) return null;
  const messages = state.orphans.reduce((sum, one) => sum + one.messages, 0);
  return h('div', {
    className: 'pet-chat-orphans',
    children: [
      h('span', { children: t('orphansSummary', { pets: state.orphans.length, messages }) }),
      h('span', { className: 'pet-chat-composer-spacer' }),
      h('button', {
        type: 'button',
        className: 'pet-chat-tool',
        onClick: () => state.ask('clear-orphans'),
        children: t('orphansClear'),
      }),
    ],
  });
}

/** id shared by roller shutter block and button: `aria-controls` should point to it. */
const PERSONA_PANEL_ID = 'pet-chat-persona';

/** "persona" button: Click to expand/collapse the roller shutter below the toolbar. */
function personaButton(h: ChatPanelRuntime['h'], t: ChatPanelRuntime['t'], state: ChatPanelState): unknown {
  return h('button', {
    type: 'button',
    className: 'pet-chat-tool',
    'aria-expanded': String(state.personaOpen),
    'aria-controls': PERSONA_PANEL_ID,
    onClick: () => state.togglePersona(),
    children: t('toolsPersona'),
  });
}

/**
 * persona roller blind: the text currently being used by this pet.
 *
 * Expand in the normal flow, push the message list down - the persona can be very long, and floating on the
 * conversation will block the content. When collapsing, keep DOM and only reset the height to zero, otherwise there
 * will be no expansion transition to play.
 */
export function personaNode(h: ChatPanelRuntime['h'], state: ChatPanelState): unknown {
  return h('div', {
    id: PERSONA_PANEL_ID,
    className: 'pet-chat-persona' + (state.personaOpen ? ' is-open' : ''),
    'aria-hidden': String(!state.personaOpen),
    children: [
      h('div', {
        className: 'pet-chat-persona-clip',
        children: [h('div', { className: 'pet-chat-persona-body', children: state.persona })],
      }),
    ],
  });
}

/** Toolbar: multi-select switch, delete selected (with quantity), memory line positioning, refresh and clear history; to delete, go through the confirmation bar in the panel first. */
export function toolsNode(h: ChatPanelRuntime['h'], t: ChatPanelRuntime['t'], state: ChatPanelState): unknown {
  return h('div', {
    className: 'pet-chat-tools',
    children: [
      personaButton(h, t, state),
      h('button', {
        type: 'button',
        className: 'pet-chat-tool',
        'aria-pressed': String(state.selecting),
        onClick: () => state.toggleSelecting(),
        children: state.selecting ? t('toolsCancelSelect') : t('toolsSelect'),
      }),
      state.selecting
        ? h('button', {
            type: 'button',
            className: 'pet-chat-tool',
            disabled: state.selected.length === 0,
            onClick: () => state.ask('delete-selected'),
            children:
              state.selected.length === 0
                ? t('toolsDeleteSelected')
                : t('toolsDeleteSelectedN', { n: state.selected.length }),
          })
        : null,
      // No line is drawn when there is no chatMemoryRounds in the configuration, so this entry point should not appear.
      state.memoryRounds === undefined
        ? null
        : h('button', {
            type: 'button',
            className: 'pet-chat-tool',
            disabled: !state.hasMemoryLine,
            // The reason for being grayed out is only for reading the screen: the visible copy remains clean like other toolbar buttons.
            ...(state.hasMemoryLine ? {} : { 'aria-label': t('toolsMemoryLineHint') }),
            onClick: () => state.jumpToMemory(),
            children: t('toolsMemoryLine'),
          }),
      h('button', {
        type: 'button',
        className: 'pet-chat-tool',
        onClick: () => state.refresh(),
        children: t('toolsRefresh'),
      }),
      h('button', {
        type: 'button',
        className: 'pet-chat-tool',
        onClick: () => state.ask('clear-all'),
        children: t('toolsClearAll'),
      }),
    ],
  });
}

/** Copy key of the operation to be confirmed: each item clearly states "what is deleted and cannot be recovered". */
const CONFIRM_TEXT: Record<ConfirmKind, Key> = {
  'delete-selected': 'confirmDeleteSelected',
  'clear-all': 'confirmClearAll',
  'clear-orphans': 'confirmClearOrphans',
};

/**
 * The confirmation bar in the panel: replaces the browser's native `confirm` and looks the same as the panel.
 *
 * @returns is null when there is no pending operation.
 */
export function confirmNode(rt: ChatPanelRuntime, state: ChatPanelState): unknown {
  if (state.pending === null) return null;
  const { h, ui, t } = rt;
  const count =
    state.pending === 'delete-selected'
      ? t('confirmCountRounds', { n: state.selected.length })
      : state.pending === 'clear-orphans'
        ? t('confirmCountOrphans', { n: state.orphans.length })
        : '';
  const description = t(CONFIRM_TEXT[state.pending]) + count + t('confirmIrreversible') + ' ' + t('localDeleteOnly');
  // When the platform primitive is missing (old host), it degenerates into an inline confirmation bar. The function is not lost, but the style is a little worse.
  if (ui === undefined) {
    return h('div', {
      className: 'pet-chat-confirm',
      role: 'alertdialog',
      children: [
        h('span', { children: description }),
        h('span', { className: 'pet-chat-composer-spacer' }),
        h('button', {
          type: 'button',
          className: 'pet-chat-danger',
          onClick: () => state.confirmAsk(),
          children: t('confirmDelete'),
        }),
        h('button', {
          type: 'button',
          className: 'pet-chat-tool',
          onClick: () => state.cancelAsk(),
          children: t('confirmCancel'),
        }),
      ],
    });
  }
  const { Button, Modal } = ui;
  return h(Modal, {
    open: true,
    title: t('confirmTitle'),
    closeLabel: t('close'),
    description,
    onClose: () => state.cancelAsk(),
    footer: h('div', {
      className: 'pet-chat-confirm-actions',
      children: [
        h(Button, { variant: 'ghost', type: 'button', onClick: () => state.cancelAsk(), children: t('confirmCancel') }),
        h(Button, {
          variant: 'primary',
          type: 'button',
          onClick: () => state.confirmAsk(),
          children: t('confirmDelete'),
        }),
      ],
    }),
  });
}

/** Preview bar of the picture to be sent. */
function previewNode(h: ChatPanelRuntime['h'], t: ChatPanelRuntime['t'], state: ChatPanelState): unknown {
  if (state.attachment === undefined) return null;
  return h('div', {
    className: 'pet-chat-preview',
    children: [
      h('img', { className: 'pet-chat-preview-img', src: state.attachment.previewUrl, alt: t('composerImageAlt') }),
      h('span', {
        className: 'pet-chat-preview-meta',
        children: state.attachment.width + '×' + state.attachment.height,
      }),
      h('button', {
        type: 'button',
        className: 'pet-chat-tool',
        onClick: () => state.clearAttachment(),
        children: t('composerRemove'),
      }),
    ],
  });
}

/** The arrow in the send key: a round button shape consistent with the DSH input box. */
function sendIcon(h: ChatPanelRuntime['h']): unknown {
  return h('svg', {
    viewBox: '0 0 24 24',
    width: 16,
    height: 16,
    'aria-hidden': 'true',
    children: [
      h('path', {
        d: 'M12 19V6M6 12l6-6 6 6',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
    ],
  });
}

/**
 * Input area: integrated rounded corner container - upper input box, lower tool row (picture attached/sent).
 *
 * The shape aligns DSH's own input box; `focus-within` makes the entire container change color instead of the inner
 * box, because the inner textarea has no border.
 */
export function composerNode(h: ChatPanelRuntime['h'], t: ChatPanelRuntime['t'], state: ChatPanelState): unknown {
  return h('div', {
    className: 'pet-chat-composer' + (state.busy ? ' is-busy' : ''),
    // The entire block is grayed out during generation: both screen reading and visual interpretation indicate that "this item has been sent."
    'aria-busy': state.busy ? 'true' : undefined,
    onDragEnter: markDropTarget,
    onDragLeave: unmarkDropTarget,
    onDragOver: (event: DragLike) => {
      claimFileDragOver(event);
    },
    onDrop: (event: DropTargetLike) => {
      const file = claimFileDrop(event);
      if (file !== undefined) state.pickFile(file);
      // dragleave will no longer be received after putting it down. The highlight is automatically removed here, otherwise the border will always be on.
      unmarkDropTarget(event);
    },
    children: [
      previewNode(h, t, state),
      h('textarea', {
        className: 'pet-chat-input',
        ref: state.draftRef,
        value: state.draft,
        rows: 2,
        placeholder: t('composerPlaceholder'),
        onChange: (event: { target: { value: string } }) => state.setDraft(event.target.value),
        onPaste: (event: { clipboardData: DataTransfer | null; preventDefault: () => void }) => {
          const file = event.clipboardData?.files?.[0];
          if (file === undefined) return; // Pasting plain text remains the same
          event.preventDefault();
          state.pickFile(file);
        },
        onKeyDown: (event: DraftKeyEvent) => state.onDraftKeyDown(event),
        onCompositionStart: () => state.onDraftCompositionStart(),
        onCompositionEnd: () => state.onDraftCompositionEnd(),
      }),
      h('div', {
        className: 'pet-chat-composer-bar',
        children: [
          h('label', {
            className: 'pet-chat-attach',
            title: t('composerAttachTip'),
            children: [
              t('composerAttach'),
              h('input', {
                className: 'pet-chat-file',
                type: 'file',
                accept: 'image/png,image/jpeg,image/webp,image/gif',
                onChange: (event: { target: { files: FileList | null; value: string } }) => {
                  const file = event.target.files?.[0];
                  if (file !== undefined) state.pickFile(file);
                  event.target.value = '';
                },
              }),
            ],
          }),
          h('span', { className: 'pet-chat-composer-spacer' }),
          h('button', {
            type: 'button',
            className: 'pet-chat-send' + (state.busy ? ' is-busy' : ''),
            'aria-label': state.busy ? t('composerSending') : t('composerSend'),
            onClick: () => state.send(),
            disabled: state.busy,
            // Switching circles during generation: leaving the arrows on will make people think they can still click (the button is disabled at this time)
            children: state.busy
              ? h('span', { className: 'pet-chat-send-spinner', 'aria-hidden': 'true' })
              : sendIcon(h),
          }),
        ],
      }),
    ],
  });
}
