/**
 * Contract test of pet configuration card (src/client/settings/pet-card.ts).
 *
 * Three contracts:
 * 1. When the selected pet is empty, only the "No Pets" prompt will be displayed, and half of the form will not be
 * rendered;
 * 2. Each control changes its own field: the name/size goes to the top level, and the corner/offset goes to the
 * position sub-patch (misalignment will silently write bad configuration);
 * 3. When the form is busy, all controls are disabled and the saved results are displayed in the upper right corner of
 * the card.
 *
 * Use fake `h` to record the node tree (do not reference jsdom); the two drop-downs are self-drawn components, and
 * `value` and `onChange(id)` are directly stored on the nodes.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { makePetCard } from './pet-card.ts';
import type { PetPatch } from './pet-card-parts.ts';
import { PET_DISPLAYS } from '../../shared/config.ts';
import { ROUTE_PATH } from '../../shared/constants.ts';
import type { Pet } from '../../shared/types.ts';

interface Node {
  tag: unknown;
  props: Record<string, unknown>;
}

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;
/** False runtime: hook is only called in the component body. Here it only needs to be able to return the initial value and install ref. */
const rt = {
  h,
  t: (key: string) => key,
  useState: <T>(init: T) => [init, () => {}] as [T, (next: T) => void],
  useEffect: () => {},
  useRef: <T>(init: T) => ({ current: init }),
};
const PetCard = makePetCard(rt as never);

/** Flatten the entire tree; the function component (avatar grid/field group) is called once here, which is equivalent to React rendering layer. */
function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  if (typeof element.tag === 'function') {
    // Not only retain the component node itself (the self-drawn drop-down options is hung on it props), but also expand the content rendered by it.
    return [element, ...flatten((element.tag as (props: Record<string, unknown>) => unknown)(element.props))];
  }
  return [element, ...flatten(element.props?.children)];
}

const pet = {
  id: 'pet-1',
  name: '小桌宠',
  size: 260,
  display: 'both',
  balanceEnabled: true,
  whisperEnabled: false,
  workStatusEnabled: true,
  fixedEnabled: false,
  position: { corner: 'bottom-left', marginX: 40, marginY: 60 },
  whisperPrompt: '你是一只猫',
} as unknown as Pet;

/** Find controls by label + value to avoid relying on node order. */
function control(tree: unknown, tag: string, match: (props: Record<string, unknown>) => boolean): Node {
  const found = flatten(tree).find((node) => node.tag === tag && match(node.props));
  assert.ok(found, `No ${tag} that meets the conditions was found.`);
  return found;
}

/** Find the drop-down based on the current value: the drop-down node has the `options` array, and the value is directly hung on props. */
function picker(tree: unknown, value: string): Node {
  const found = flatten(tree).find((node) => node.props.value === value && Array.isArray(node.props.options));
  assert.ok(found, `The drop-down with the current value ${value} was not found`);
  return found;
}

const render = (onChange: (patch: PetPatch) => void, extra: Record<string, unknown> = {}) =>
  PetCard({ pet, busy: false, msg: { kind: '', text: '' }, entryPrompt: '条目人设', onChange, ...extra } as never);

describe('PetCard ——Pet configuration card', () => {
  test('No pet is selected: only the prompt "No pet yet" is given.', () => {
    const tree = PetCard({
      pet: null,
      busy: false,
      msg: { kind: '', text: '' },
      entryPrompt: '',
      onChange: () => {},
      onSave: () => {},
      onRemove: () => {},
    } as never);
    assert.equal(flatten(tree).length, 1);
    assert.equal(flatten(tree)[0].props.children, 'emptyPets');
  });

  test('Name and size go to top-level fields', () => {
    const patches: PetPatch[] = [];
    const tree = render((patch) => patches.push(patch));
    const name = control(tree, 'input', (props) => props.value === '小桌宠');
    (name.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: '新名字' } });
    // The number box is uncontrolled: it will be submitted only when it is out of focus, and it will not be written back when it is deleted.
    const size = control(tree, 'input', (props) => props.defaultValue === '260');
    (size.props.onBlur as (e: { target: { value: string } }) => void)({ target: { value: '300' } });
    assert.deepEqual(patches, [{ name: '新名字' }, { size: 300 }]);
  });

  test('Percentage input: The empty box is out of focus and will not be written back. It will only be submitted if there is a new value.', () => {
    const patches: PetPatch[] = [];
    const tree = render((patch) => patches.push(patch));
    const percent = control(tree, 'input', (props) => props.min === '1' && props.step === '1');
    assert.equal(percent.props.defaultValue, '20', 'When not configured, the default value is 20.');
    const fire = percent.props.onBlur as (e: { target: { value: string } }) => void;
    fire({ target: { value: '  ' } });
    assert.deepEqual(patches, [], 'Empty frame out of focus = give up this edit');
    fire({ target: { value: '30' } });
    assert.deepEqual(patches, [{ sizePercent: 30 }]);
  });

  test('Display position drop-down: changed to top level display', () => {
    const patches: PetPatch[] = [];
    const tree = render((patch) => patches.push(patch));
    const display = picker(tree, 'both');
    assert.deepEqual(
      (display.props.options as { id: string }[]).map((option) => option.id),
      [...PET_DISPLAYS],
      'Options come from PET_DISPLAYS, copywriting is provided by t',
    );
    (display.props.onChange as (id: string) => void)('desktop');
    assert.deepEqual(patches, [{ display: 'desktop' }]);
  });

  test('Corner with two offsets walking position sub-patch', () => {
    const patches: PetPatch[] = [];
    const tree = render((patch) => patches.push(patch));
    const corner = picker(tree, 'bottom-left');
    (corner.props.onChange as (id: string) => void)('top-right');
    const marginX = control(tree, 'input', (props) => props.defaultValue === '40');
    (marginX.props.onBlur as (e: { target: { value: string } }) => void)({ target: { value: '12' } });
    const marginY = control(tree, 'input', (props) => props.defaultValue === '60');
    (marginY.props.onBlur as (e: { target: { value: string } }) => void)({ target: { value: '34' } });
    assert.deepEqual(patches, [
      { position: { corner: 'top-right' } },
      { position: { marginX: 12 } },
      { position: { marginY: 34 } },
    ]);
  });

  test('Each of the four function switches returns its own key', () => {
    const patches: PetPatch[] = [];
    const tree = render((patch) => patches.push(patch));
    const checkboxes = flatten(tree).filter((node) => node.tag === 'input' && node.props.type === 'checkbox');
    assert.equal(checkboxes.length, 4);
    for (const box of checkboxes) {
      (box.props.onChange as (e: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    }
    assert.deepEqual(patches, [
      { balanceEnabled: true },
      { whisperEnabled: true },
      { workStatusEnabled: true },
      { fixedEnabled: true },
    ]);
  });

  test('persona: echo the current value, placeholder entry persona, character count displayed in the lower right corner', () => {
    const tree = render(() => {});
    const area = control(tree, 'textarea', () => true);
    assert.equal(area.props.value, '你是一只猫');
    assert.equal(area.props.placeholder, '条目人设');
    assert.ok(flatten(tree).some((node) => node.props.children === 'personaCount'));
  });

  test('All controls are disabled when busy; saved results are displayed nearby', () => {
    const tree = PetCard({
      pet,
      busy: true,
      msg: { kind: 'err', text: '保存失败' },
      entryPrompt: '',
      onChange: () => {},
      onSave: () => {},
      onRemove: () => {},
    } as never);
    const controls = flatten(tree).filter((node) => node.tag === 'input' || node.tag === 'textarea');
    assert.ok(controls.length > 0);
    for (const node of controls) assert.equal(node.props.disabled, true, `${node.tag} should be disabled`);
    const pickers = flatten(tree).filter((node) => Array.isArray(node.props.options));
    assert.equal(pickers.length, 2, 'Both the display position and the corner drop-down must be rendered.');
    for (const node of pickers) assert.equal(node.props.disabled, true, 'Dropdown should be disabled');
    assert.ok(
      flatten(tree).some(
        (node) => node.props.children === '保存失败' && String(node.props.className).includes('is-err'),
      ),
      'Error feedback should contain is-err (red letter)',
    );
  });
});

describe('PetCard —— Avatar upload', () => {
  /** Avatar file selection box. */
  const fileInput = (tree: unknown): Node => {
    const found = flatten(tree).find((node) => node.tag === 'input' && node.props.type === 'file');
    assert.ok(found, 'Avatar selection box should be rendered');
    return found;
  };

  test('The preview uses the incoming address, and the selection box only accepts four kinds of pictures.', () => {
    const tree = render(() => {}, { avatarSrc: ROUTE_PATH + '/logo?root=cat&v=1', onAvatar: () => {} });
    const img = flatten(tree).find((node) => node.tag === 'img' && String(node.props.className).includes('avatarImg'));
    assert.ok(img, 'Avatar preview should be rendered');
    assert.equal(img.props.src, ROUTE_PATH + '/logo?root=cat&v=1');
    const file = fileInput(tree);
    assert.equal(file.props.accept, 'image/png,image/jpeg,image/webp,image/gif');
    assert.equal(file.props.disabled, false);
  });

  test('Not uploading onAvatar (built-in entry) → only preview, no entry point uploaded', () => {
    const tree = render(() => {}, { avatarSrc: ROUTE_PATH + '/logo?root=main&v=1' });
    const img = flatten(tree).find((node) => node.tag === 'img' && String(node.props.className).includes('avatarImg'));
    assert.ok(img, 'Preview still needs to be displayed');
    assert.equal(
      flatten(tree).some((node) => node.tag === 'input' && node.props.type === 'file'),
      false,
      'The file selection box should not appear for built-in items',
    );
  });

  test('Return onAvatar after selecting a file, and clear input to reselect the same file', () => {
    const picked: File[] = [];
    const tree = render(() => {}, { onAvatar: (file: File) => picked.push(file) });
    const file = fileInput(tree);
    const chosen = { name: 'a.png' } as File;
    const target = { files: [chosen], value: 'C:\\fakepath\\a.png' };
    (file.props.onChange as (e: { target: typeof target }) => void)({ target });
    assert.deepEqual(picked, [chosen]);
    assert.equal(target.value, '', 'The same file can be triggered again after clearing change');
  });

  test('When it is replaceable: the floating mask text is "replacement", and the click area is the avatar itself.', () => {
    const tree = render(() => {}, { onAvatar: () => {} });
    const mask = flatten(tree).find((node) => String(node.props.className).includes('avatarMask'));
    assert.ok(mask, 'Hover masks should be rendered');
    assert.equal(mask.props.children, 'avatarChange');
    // The mask and file frame are both in the same clickable container: there is no independent upload button
    const pick = flatten(tree).find((node) => String(node.props.className).includes('avatarPick'));
    assert.ok(pick, 'The avatar itself should be a clickable area');
    assert.equal(
      flatten(tree).some((node) => node.tag === 'button' && String(node.props.children).includes('avatarUpload')),
      false,
      'There should no longer be a separate upload button',
    );
  });

  test('Uploading: The mask is changed to copy and the selection box is disabled', () => {
    const tree = render(() => {}, { avatarBusy: true, onAvatar: () => {} });
    const mask = flatten(tree).find((node) => String(node.props.className).includes('avatarMask'));
    assert.ok(mask, 'Hover masks should be rendered');
    assert.equal(mask.props.children, 'avatarUploading');
    assert.equal(fileInput(tree).props.disabled, true);
  });

  test('The floating instructions are data-tip instead of the native title.', () => {
    const tree = render(() => {}, { onAvatar: () => {} });
    const pick = flatten(tree).find((node) => String(node.props.className).includes('avatarPick'));
    assert.ok(pick, 'The avatar should be a clickable area');
    // Use data-tip + ./tip-layer to position the page; title will create an uncontrollable browser floating frame.
    assert.equal(pick.props['data-tip'], 'avatarHint');
    assert.equal(pick.props.title, undefined);
  });
});
