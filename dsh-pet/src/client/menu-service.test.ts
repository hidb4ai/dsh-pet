/**
 * Menu mirroring behavior contract: same shape as / menu/events, read and consume, isolate by owner, latch follow item
 * survival.
 *
 * Unexpected rendering and reporting here - the reporting point is at pet/menu-actions and the snapshot
 * synchronization point is at pet/multi.
 */
import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetMenuEvents, setMenuClick, setMenuItems, takeMenuEvents } from './menu-service.ts';

describe('menu-service ——Menu mirroring within the page', () => {
  beforeEach(() => {
    resetMenuEvents();
  });

  test('Not synchronized to snapshot yet: any owner is unknown', () => {
    assert.deepEqual(takeMenuEvents('baifan'), { ok: false, reason: 'unknown-owner' });
  });

  test('I just registered and no one clicked: Every item in the full mapping is null', () => {
    setMenuItems([
      { label: '喂鱼', owner: 'baifan' },
      { label: '摸头', owner: 'baifan' },
    ]);
    assert.deepEqual(takeMenuEvents('baifan'), { events: { 喂鱼: null, 摸头: null }, ok: true });
  });

  test('Read and consume: Clear null after reading, and you will not get it again after reading it again.', () => {
    setMenuItems([{ label: '喂鱼', owner: 'baifan' }]);
    setMenuClick('baifan', '喂鱼', 'main');
    assert.deepEqual(takeMenuEvents('baifan'), { events: { 喂鱼: 'main' }, ok: true });
    assert.deepEqual(takeMenuEvents('baifan'), { events: { 喂鱼: null }, ok: true });
  });

  test('Isolation by owner: Clicks from one owner will not be read by another owner', () => {
    setMenuItems([
      { label: 'x', owner: 'a' },
      { label: 'y', owner: 'b' },
    ]);
    setMenuClick('a', 'x', 'main');
    assert.deepEqual(takeMenuEvents('b'), { events: { y: null }, ok: true });
    assert.deepEqual(takeMenuEvents('a'), { events: { x: 'main' }, ok: true });
  });

  test('Click first and then synchronize the snapshot: this time it will not be lost', () => {
    setMenuClick('baifan', '喂鱼', 'main');
    setMenuItems([{ label: '喂鱼', owner: 'baifan' }]);
    assert.deepEqual(takeMenuEvents('baifan'), { events: { 喂鱼: 'main' }, ok: true });
  });

  test('The item is no longer readable after it is offline: owner will not read the last remnant even if it is re-registered.', () => {
    setMenuItems([{ label: '喂鱼', owner: 'baifan' }]);
    setMenuClick('baifan', '喂鱼', 'main');
    setMenuItems([{ label: '摸头', owner: 'baifan' }]);
    assert.deepEqual(takeMenuEvents('baifan'), { events: { 摸头: null }, ok: true });
  });
});
