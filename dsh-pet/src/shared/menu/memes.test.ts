/**
 * Contract test of the picture menu branch (src/shared/menu/memes.ts).
 *
 * Three contracts: Grouping is only counted according to configuration (order = writing order, there is no dialogue
 * group when the switch is off, upper limit 0 = no limit); pictures with empty descriptions are not considered
 * available (the same conventions as the host pool judgment); the entire item does not appear when there is no
 * available picture.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildMemeBranch, groupMemes, memeThumbUrl } from './memes.ts';
import type { MenuBranch, MenuLeaf } from './types.ts';

/** Three available pictures (the order is the order in which they are written). */
const THREE = { 甲: '第一张', 乙: '第二张', 丙: '第三张' };

describe('groupMemes——How to switch conversation groups', () => {
  test('Switch off: the conversation group is empty and all fall into other', () => {
    const groups = groupMemes({ memes: THREE, chatImageEnabled: false, chatImageLimit: 2 });
    assert.deepEqual(groups.chat, [], 'When the switch is turned off, no dialogue will be entered.');
    assert.deepEqual(groups.other, ['甲', '乙', '丙']);
  });

  test('Switch default: press close', () => {
    assert.deepEqual(groupMemes({ memes: THREE }).chat, []);
  });

  test('Switch on + upper limit 2: only take the first two pages written in the configuration', () => {
    const groups = groupMemes({ memes: THREE, chatImageEnabled: true, chatImageLimit: 2 });
    assert.deepEqual(groups.chat, ['甲', '乙'], 'The order must be consistent with the configuration writing order.');
    assert.deepEqual(groups.other, ['丙']);
  });

  test('Switch on + upper limit 0: No limit, all enter the dialogue group', () => {
    const groups = groupMemes({ memes: THREE, chatImageEnabled: true, chatImageLimit: 0 });
    assert.deepEqual(groups.chat, ['甲', '乙', '丙']);
    assert.deepEqual(groups.other, []);
  });

  test('Switch on + upper limit missing: no limit, all enter the dialogue group', () => {
    assert.deepEqual(groupMemes({ memes: THREE, chatImageEnabled: true }).chat, ['甲', '乙', '丙']);
  });

  test('The switch is on + the upper limit exceeds the total number: take the full amount and do not report an error', () => {
    const groups = groupMemes({ memes: THREE, chatImageEnabled: true, chatImageLimit: 99 });
    assert.deepEqual(groups.chat, ['甲', '乙', '丙']);
    assert.deepEqual(groups.other, []);
  });

  test('Pictures with empty or blank descriptions are not considered available (the host pool is also excluded)', () => {
    const groups = groupMemes({
      memes: { 甲: '有描述', 乙: '', 丙: '   ', 丁: '有描述' },
      chatImageEnabled: true,
      chatImageLimit: 10,
    });
    assert.deepEqual(
      groups.chat,
      ['甲', '丁'],
      'The graphical model without description cannot be recognized and should not appear in the menu.',
    );
  });

  test('List missing or wrong shape: both groups are empty', () => {
    assert.deepEqual(groupMemes({ memes: undefined }), { chat: [], other: [] });
    assert.deepEqual(groupMemes({ memes: [] as unknown as Record<string, string> }), { chat: [], other: [] });
  });
});

/** Flatten all the leaves in a branch according to "group name → leaf" to facilitate assertion. */
function leavesOf(branch: MenuBranch): { group: string; leaf: MenuLeaf }[] {
  const out: { group: string; leaf: MenuLeaf }[] = [];
  for (const group of branch.children) {
    if (!('children' in group)) continue;
    for (const child of group.children) {
      if ('children' in child) continue;
      out.push({ group: group.label, leaf: child });
    }
  }
  return out;
}

describe('buildMemeBranch ——Menu shape', () => {
  test('Switch on + demarcation: two-level structure, each item in the group has a picture name and whisper action', () => {
    const branch = buildMemeBranch({ memes: THREE, chatImageEnabled: true, chatImageLimit: 2 });
    assert.ok(branch, 'Branches must be given when a graph is available');
    assert.equal(branch.label, '配图');
    assert.deepEqual(
      branch.children.map((group) => group.label),
      ['纳入对话的配图', '其他'],
    );
    const leaves = leavesOf(branch);
    assert.deepEqual(
      leaves.map((entry) => entry.leaf.label),
      ['甲', '乙', '丙'],
    );
    for (const { leaf } of leaves) {
      assert.equal(leaf.action, 'whisper', 'Click on the picture = Use this picture to say a sentence');
      assert.equal(
        leaf.image,
        leaf.label,
        'The picture name is both the display name and the name passed to the host.',
      );
    }
  });

  test('Switch off: only the "Other" group remains, no empty conversation group appears', () => {
    const branch = buildMemeBranch({ memes: THREE, chatImageEnabled: false });
    assert.ok(branch);
    assert.deepEqual(
      branch.children.map((group) => group.label),
      ['其他'],
    );
    assert.equal(leavesOf(branch).length, 3);
  });

  test('All in the dialogue group: only the "pictures included in the dialogue" group is left', () => {
    const branch = buildMemeBranch({ memes: THREE, chatImageEnabled: true, chatImageLimit: 0 });
    assert.ok(branch);
    assert.deepEqual(
      branch.children.map((group) => group.label),
      ['纳入对话的配图'],
    );
  });

  test('No image available: return null, the caller does not insert this item accordingly', () => {
    assert.equal(buildMemeBranch({}), null);
    assert.equal(buildMemeBranch({ memes: { 甲: '' } }), null);
  });
});

describe('memeThumbUrl——Thumbnail address', () => {
  test('The asset root and name each occupy one paragraph: Chinese characters and spaces must be encoded.', () => {
    assert.equal(
      memeThumbUrl('/dsh-pet-7340', 'my pack', '大的 要来啦'),
      '/dsh-pet-7340/pic/memes/my%20pack/%E5%A4%A7%E7%9A%84%20%E8%A6%81%E6%9D%A5%E5%95%A6.png',
    );
  });

  test('asset root default or pure blank: press main (consistent with the ownership semantics of host / pic)', () => {
    assert.equal(memeThumbUrl('/x', undefined, 'a'), '/x/pic/memes/main/a.png');
    assert.equal(memeThumbUrl('/x', '   ', 'a'), '/x/pic/memes/main/a.png');
  });
});

describe('buildMemeBranch - Thumbnail', () => {
  test('Given the address generator: each leaf has thumb and has the same name as image', () => {
    const branch = buildMemeBranch({ memes: THREE, chatImageEnabled: true, chatImageLimit: 1 }, (name) => 'u:' + name);
    assert.ok(branch);
    for (const { leaf } of leavesOf(branch)) {
      assert.equal(leaf.thumb, 'u:' + leaf.label, 'thumb must be generated from the name and cannot be misplaced');
      assert.equal(leaf.image, leaf.label);
    }
  });

  test('No generator: leaf does not have thumb field (menu only has text)', () => {
    const branch = buildMemeBranch({ memes: THREE, chatImageEnabled: true });
    assert.ok(branch);
    for (const { leaf } of leavesOf(branch)) {
      assert.equal(
        'thumb' in leaf,
        false,
        'By default, the space should not be occupied, otherwise the line height and alignment will change.',
      );
    }
  });
});
