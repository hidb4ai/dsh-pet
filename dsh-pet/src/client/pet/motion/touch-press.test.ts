/**
 * Contract test of touch screen long press (src/client/pet/motion/touch-press.ts): trigger once when the point is
 * reached, and it will be canceled if the movement exceeds the tolerance or is released during the timing, and the
 * mouse and pen cannot function. Use node's fake timer driver, and the callback parameter is based on the live object
 * assertion.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createTouchPress, type TouchPressTarget } from './touch-press.ts';

/** False element: only release capture and dispatch are left. */
function fakeEl() {
  const released: number[] = [];
  const dispatched: string[] = [];
  return {
    el: {
      hasPointerCapture: () => true,
      releasePointerCapture: (id: number) => released.push(id),
      dispatchEvent: (event: Event) => dispatched.push(event.type),
    } as unknown as HTMLElement,
    released,
    dispatched,
  };
}

/** Create a pressed scene. */
function target(pointerType = 'touch'): { value: TouchPressTarget; fake: ReturnType<typeof fakeEl> } {
  const fake = fakeEl();
  return { fake, value: { el: fake.el, pointerId: 7, pointerType, x: 120, y: 240 } };
}

describe('createTouchPress——point trigger', () => {
  test('Touch screen full press time: callback once, with the pressed scene', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const seen: TouchPressTarget[] = [];
    const press = createTouchPress({ stillHolding: () => true, onMenu: (value) => seen.push(value) });
    const { value } = target();
    press.arm(value);
    assert.equal(press.isArmed(), true);
    t.mock.timers.tick(499);
    assert.equal(seen.length, 0, 'It should not be triggered if the duration is not full.');
    t.mock.timers.tick(1);
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0], value);
    assert.equal(press.isArmed(), false);
  });

  test('Mouse and pen: can’t afford the watch', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const seen: TouchPressTarget[] = [];
    const press = createTouchPress({ stillHolding: () => true, onMenu: (value) => seen.push(value) });
    press.arm(target('mouse').value);
    press.arm(target('pen').value);
    assert.equal(press.isArmed(), false);
    t.mock.timers.tick(1000);
    assert.equal(seen.length, 0);
  });

  test('Pressing has ended when the point is reached: callback abandons itself', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let holding = true;
    const seen: TouchPressTarget[] = [];
    const press = createTouchPress({ stillHolding: () => holding, onMenu: (value) => seen.push(value) });
    press.arm(target().value);
    holding = false;
    t.mock.timers.tick(500);
    assert.equal(seen.length, 0);
  });

  test('Repeat the table: only keep the last time, and only trigger once when the point is reached.', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const seen: TouchPressTarget[] = [];
    const press = createTouchPress({ stillHolding: () => true, onMenu: (value) => seen.push(value) });
    press.arm(target().value);
    t.mock.timers.tick(200);
    press.arm(target().value);
    t.mock.timers.tick(500);
    assert.equal(seen.length, 1);
  });
});

describe('createTouchPress - Cancel', () => {
  test('Movement exceeds tolerance: Cancel, not triggered when reaching the point', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const seen: TouchPressTarget[] = [];
    const press = createTouchPress({ stillHolding: () => true, onMenu: (value) => seen.push(value) });
    press.arm(target().value);
    press.move(8);
    assert.equal(press.isArmed(), true, 'It is not canceled when it is exactly equal to the tolerance.');
    press.move(9);
    assert.equal(press.isArmed(), false);
    t.mock.timers.tick(500);
    assert.equal(seen.length, 0);
  });

  test('Let go and cancel: not triggered when the point is reached', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const seen: TouchPressTarget[] = [];
    const press = createTouchPress({ stillHolding: () => true, onMenu: (value) => seen.push(value) });
    press.arm(target().value);
    press.cancel();
    assert.equal(press.isArmed(), false);
    t.mock.timers.tick(500);
    assert.equal(seen.length, 0);
  });

  test('When the table is not started, moving and canceling are no-ops.', () => {
    const press = createTouchPress({ stillHolding: () => true, onMenu: () => {} });
    press.move(100);
    press.cancel();
    assert.equal(press.isArmed(), false);
  });
});
