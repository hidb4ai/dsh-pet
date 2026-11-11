/**
 * Rendering contract between message avatar and message node: the avatar address must be generated based on the asset
 * root and version number.
 *
 * Only pin node attributes, do not quote jsdom; use fake `h` to record the tree. Running method: node --
 * experimental-strip-types --test src/client/chat/view-message.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { avatarNode, messageNode } from './view-message.ts';
import { ROUTE_PATH } from '../../shared/constants.ts';
import type { ChatMessageView } from './api.ts';
import type { ChatPanelRuntime } from './runtime.ts';
import { zh } from './locales/zh.ts';

interface Node {
  tag: string;
  props: Record<string, unknown>;
}

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as ChatPanelRuntime['h'];

/** Chinese stub: This file does not assert the text, only uses it to satisfy the runtime contract. */
const t = ((key: string) => (zh as Record<string, string>)[key] ?? key) as unknown as ChatPanelRuntime['t'];

const message: ChatMessageView = { role: 'assistant', text: '在的', ts: 1 };

describe('avatarNode', () => {
  test('Pet side-clicks the asset root and version number to spell the address', () => {
    const node = avatarNode(h, false, 'baimao', 7) as unknown as Node;
    assert.equal(node.tag, 'img');
    assert.equal(node.props.className, 'pet-chat-avatar');
    assert.equal(node.props.src, ROUTE_PATH + '/logo?root=baimao&v=7');
  });

  test('When there is no asset root, only the version number is included (the host returns to the default logo)', () => {
    const node = avatarNode(h, false, '', 7) as unknown as Node;
    assert.equal(node.props.src, ROUTE_PATH + '/logo?v=7');
  });

  test('The user side is inline SVG and does not eat the avatar address.', () => {
    const node = avatarNode(h, true, 'baimao', 7) as unknown as Node;
    assert.equal(node.tag, 'svg');
    assert.equal(node.props.src, undefined);
  });

  test('Version number change → Avatar URL change (this is what breaks the cache)', () => {
    const first = avatarNode(h, false, 'baimao', 1) as unknown as Node;
    const second = avatarNode(h, false, 'baimao', 2) as unknown as Node;
    assert.notEqual(first.props.src, second.props.src);
  });
});

describe('messageNode', () => {
  test('The avatar of the pet message follows the incoming asset root and version number', () => {
    const node = messageNode(h, t, {
      message,
      isMe: false,
      assetRoot: 'baimao',
      avatarVersion: 3,
      onOpenImage: () => {},
    }) as unknown as Node;
    const avatar = (node.props.children as unknown[])[0] as Node;
    assert.equal(avatar.props.src, ROUTE_PATH + '/logo?root=baimao&v=3');
  });

  test('The avatar of user messages is still SVG', () => {
    const node = messageNode(h, t, {
      message: { ...message, role: 'user' },
      isMe: true,
      assetRoot: 'baimao',
      avatarVersion: 3,
      onOpenImage: () => {},
    }) as unknown as Node;
    const avatar = (node.props.children as unknown[])[0] as Node;
    assert.equal(avatar.tag, 'svg');
  });
});
