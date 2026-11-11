/**
 * Contract test between the panel toolbar and the input area: the new "memory line" and "refresh" entry point, as well
 * as the graying + circle during generation.
 *
 * Use fake `h` to record the node as a `{ tag, props }` tree. The assertion is the rendered shape connected to the
 * callback, and react is not started. Running method: node --experimental-strip-types --test
 * src/client/chat/view-node.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { ChatPanelRuntime } from './runtime.ts';
import type { ChatPanelState } from './types.ts';
import { composerNode, toolsNode } from './view-node.ts';
import { zh } from './locales/zh.ts';

/** False node: `h` only records labels and attributes. */
interface Node {
  readonly tag: unknown;
  readonly props: Record<string, unknown>;
}

const h = ((tag: unknown, props?: Record<string, unknown> | null): Node => ({
  tag,
  props: props ?? {},
})) as unknown as ChatPanelRuntime['h'];

/** Chinese pile: Continue to write Chinese copy for assertion, and replace parameters according to `{name}` rules. */
const t = ((key: string, params?: Record<string, unknown>) => {
  const text = (zh as Record<string, string>)[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_match: string, name: string) => String(params?.[name] ?? ''));
}) as unknown as ChatPanelRuntime['t'];

/** Deeply traverse the node tree ( children may be an array, a single node, or text). */
function walk(node: unknown, visit: (one: Node) => void): void {
  if (node === null || typeof node !== 'object') return;
  const one = node as Node;
  visit(one);
  const children = one.props.children;
  if (Array.isArray(children)) {
    for (const child of children) walk(child, visit);
    return;
  }
  walk(children, visit);
}

/** Press the button copy to find the element; if not found, undefined is returned. */
function buttonByText(root: unknown, text: string): Node | undefined {
  let found: Node | undefined;
  walk(root, (one) => {
    if (one.tag === 'button' && one.props.children === text) found = one;
  });
  return found;
}

/** Press class to find the element; if not found, return undefined. */
function byClass(root: unknown, className: string): Node | undefined {
  let found: Node | undefined;
  walk(root, (one) => {
    if (one.props.className === className) found = one;
  });
  return found;
}

/** Create a minimum state that is enough for rendering; the action defaults to an empty implementation and will be overridden when assertion is required. */
function stateOf(overrides: Partial<ChatPanelState> = {}): ChatPanelState {
  return {
    pets: [],
    petId: 'main',
    messages: [],
    draft: '',
    attachment: undefined,
    busy: false,
    loading: false,
    error: '',
    selected: [],
    selecting: false,
    orphans: [],
    pending: null,
    visibleRounds: 10,
    previewUrl: undefined,
    roundsByEntry: {},
    personas: {},
    personaOpen: false,
    speaking: null,
    rounds: [],
    hasOlder: false,
    petName: '鲸鲸',
    assetRoot: '',
    memoryRounds: 5,
    hasMemoryLine: true,
    persona: '',
    onDraftKeyDown: () => {},
    onDraftCompositionStart: () => {},
    onDraftCompositionEnd: () => {},
    ...overrides,
  } as unknown as ChatPanelState;
}

describe('toolsNode ——Memory line and refresh entry point', () => {
  test('Equipped with the number of memory rounds → "Memory line" appears, click to go jumpToMemory', () => {
    let jumped = 0;
    const node = toolsNode(h, t, stateOf({ jumpToMemory: () => (jumped += 1) }));
    const line = buttonByText(node, '记忆线');
    assert.ok(line !== undefined, 'The toolbar should have a "Memory Line" button');
    assert.equal(line?.props.disabled, false, 'The button is available when there is a dividing line');
    (line?.props.onClick as () => void)();
    assert.equal(jumped, 1, 'Clicking should trigger a jump');
  });

  test('The history does not exceed the number of memory rounds → "Memory Line" is grayed out (no line to jump)', () => {
    const node = toolsNode(h, t, stateOf({ hasMemoryLine: false }));
    assert.equal(buttonByText(node, '记忆线')?.props.disabled, true);
  });

  test('There is no memory round number in the configuration → "memory line" does not appear (no line is drawn)', () => {
    const node = toolsNode(h, t, stateOf({ memoryRounds: undefined, hasMemoryLine: false }));
    assert.equal(buttonByText(node, '记忆线'), undefined);
  });

  test('"Refresh" is always on, click to go refresh', () => {
    let refreshed = 0;
    const node = toolsNode(h, t, stateOf({ memoryRounds: undefined, refresh: () => (refreshed += 1) }));
    const button = buttonByText(node, '刷新');
    assert.ok(button !== undefined, 'The toolbar should have a "refresh" button');
    (button?.props.onClick as () => void)();
    assert.equal(refreshed, 1);
  });
});

describe('composerNode - graying and turning during generation', () => {
  test('busy → Container with is-busy and aria-busy, the send key is changed to a circle', () => {
    const node = composerNode(h, t, stateOf({ busy: true }));
    const composer = node as Node;
    assert.match(String(composer.props.className), /is-busy/);
    assert.equal(composer.props['aria-busy'], 'true');

    const spinner = byClass(node, 'pet-chat-send-spinner');
    assert.ok(spinner !== undefined, 'The circle node should be rendered during generation');
    assert.equal(spinner?.tag, 'span');
    const send = byClass(node, 'pet-chat-send is-busy');
    assert.equal(send?.props.disabled, true, 'Send key should be disabled during generation');
  });

  test('Not busy → There is no graying and turning, and the send button is a clickable arrow.', () => {
    const node = composerNode(h, t, stateOf({ busy: false }));
    const composer = node as Node;
    assert.doesNotMatch(String(composer.props.className), /is-busy/);
    assert.equal(byClass(node, 'pet-chat-send-spinner'), undefined);
    const send = byClass(node, 'pet-chat-send');
    assert.equal(send?.props.disabled, false);
    assert.equal((send?.props.children as Node).tag, 'svg', 'Arrow icon when idle');
  });
});

describe('composerNode - Enter to send to avoid input method', () => {
  test('The input box is connected to the combination event and key handler', () => {
    const area = byClass(composerNode(h, t, stateOf()), 'pet-chat-input');
    assert.ok(area !== undefined, 'There should be an input box');
    assert.equal(typeof area?.props.onKeyDown, 'function');
    assert.equal(typeof area?.props.onCompositionStart, 'function');
    assert.equal(typeof area?.props.onCompositionEnd, 'function');
  });

  test('The three processors are transferred to state as they are (determined at enter, sent at state)', () => {
    const calls: string[] = [];
    const node = composerNode(
      h,
      t,
      stateOf({
        onDraftKeyDown: () => calls.push('keydown'),
        onDraftCompositionStart: () => calls.push('start'),
        onDraftCompositionEnd: () => calls.push('end'),
      }),
    );
    const area = byClass(node, 'pet-chat-input');
    const keydown = area?.props.onKeyDown as (e: unknown) => void;
    keydown({ key: 'Enter', shiftKey: false, preventDefault: () => {} });
    (area?.props.onCompositionStart as () => void)();
    (area?.props.onCompositionEnd as () => void)();
    assert.deepEqual(calls, ['keydown', 'start', 'end']);
  });
});
