/**
 * Contract test of confirmation pop-up window (src/client/settings/dialog.ts).
 *
 * Three contracts:
 * 1. Each of the four scenarios has its own text and button combination: no "confirm" will be given when there is only
 * one left; the confirmation colors for synchronization and deletion are different;
 * 2. Clicking Mask, Cancel, or "Got it" will only close it and will not trigger an action; click Confirm to callback;
 * 3. The current pet id is brought out in the deletion copy, and the real writing path is brought out in the damage
 * copy (the user must follow this to back up).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { makeDialog, type DialogProps, type DialogState } from './dialog.ts';

interface Node {
  tag: string;
  props: Record<string, unknown>;
}

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;
const Dialog = makeDialog({ h, t: (key: string) => key } as never);

function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  return [element, ...flatten(element.props?.children)];
}

const texts = (tree: unknown): string[] =>
  flatten(tree)
    .map((node) => node.props.children)
    .filter((child): child is string => typeof child === 'string');

const buttons = (tree: unknown): Node[] =>
  flatten(tree).filter((node) => node.tag === 'button' && node.props.type === 'button');

/** Render a scene and return the node tree and callback count. */
function render(dialog: Exclude<DialogState, null>, selId = 'pet-2'): { tree: unknown; calls: string[] } {
  const calls: string[] = [];
  const props: DialogProps = {
    dialog,
    selId,
    onDismiss: () => calls.push('dismiss'),
    onConfirm: () => calls.push('confirm'),
  };
  return { tree: Dialog(props), calls };
}

describe('SettingsDialog —— Confirmation pop-up window', () => {
  test('Delete: bring pet id, cancel + dangerous color confirmation', () => {
    const { tree } = render({ kind: 'remove' }, 'pet-2');
    assert.ok(texts(tree).includes('confirmRemove'), 'The copywriting is confirmRemove (contains { id } placeholder)');
    assert.ok(texts(tree).includes('confirmTitle'));
    const all = buttons(tree);
    assert.equal(all.length, 2);
    assert.equal(all[1].props.className, 'dsh-pet-cfg__btn is-danger');
  });

  test('Only one left: only "got it", no confirmation button', () => {
    const { tree } = render({ kind: 'lastOne' });
    const all = buttons(tree);
    assert.equal(all.length, 1);
    assert.equal(all[0].props.children, 'ok');
    assert.ok(texts(tree).includes('atLeastOne'));
  });

  test('There is only one left of a certain type: only "got it", the copy brings out the type name', () => {
    const { tree } = render({ kind: 'lastOfKind', entry: 'glm' });
    const all = buttons(tree);
    assert.equal(all.length, 1, 'No confirmable action');
    assert.equal(all[0].props.children, 'ok');
    assert.ok(texts(tree).includes('lastOfKind'), 'Copywriting is lastOfKind (contains { entry } placeholder)');
  });

  test('Synchronization: the confirmation button is the main color (not the danger color)', () => {
    const { tree } = render({ kind: 'sync' });
    const all = buttons(tree);
    assert.equal(all[1].props.className, 'dsh-pet-cfg__btn is-primary');
    assert.equal(all[1].props.children, 'sync');
  });

  test('Damaged: The title and text are replaced with the damaged ones, and the text contains the real path.', () => {
    const { tree } = render({ kind: 'corrupt', path: 'C:/x/main-config.jsonc' });
    assert.ok(texts(tree).includes('corruptTitle'));
    assert.ok(texts(tree).includes('corruptBody'), 'The main text is corruptBody (containing { path } placeholder)');
    assert.equal(buttons(tree)[1].props.children, 'corruptConfirm');
  });

  test('Cancel, got it, and click mask are all closed; only callback is confirmed.', () => {
    const remove = render({ kind: 'remove' });
    (buttons(remove.tree)[0].props.onClick as () => void)();
    assert.deepEqual(remove.calls, ['dismiss']);

    const lastOne = render({ kind: 'lastOne' });
    (buttons(lastOne.tree)[0].props.onClick as () => void)();
    assert.deepEqual(lastOne.calls, ['dismiss']);

    const confirm = render({ kind: 'remove' });
    (buttons(confirm.tree)[1].props.onClick as () => void)();
    assert.deepEqual(
      confirm.calls,
      ['confirm'],
      'Confirm button must not be closed incidentally (determined by housing)',
    );
  });
});
