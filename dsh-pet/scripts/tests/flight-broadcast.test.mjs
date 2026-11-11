/** Merger, last frame and lifecycle of desktop flight status broadcast. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const { createWindows } = require('../../runtime/electron-helper/main/windows.js');
function setup(t, count = 2) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const manager = createWindows({});
  const messages = [];
  for (let i = 0; i < count; i++)
    manager.state.windows.set('p' + i, {
      isDestroyed: () => false,
      webContents: { send: (channel, state) => messages.push({ id: i, channel, state }) },
      destroy: () => {},
    });
  return { manager, messages };
}
test('Intensive updates are recorded in the station immediately, broadcasts are merged and the last status is adopted.', (t) => {
  const { manager, messages } = setup(t);
  for (let i = 0; i < 100; i++) manager.updatePetState('p0', { x: i, vx: i });
  assert.equal(manager.state.petStates.get('p0').x, 99);
  assert.equal(messages.length, 0);
  t.mock.timers.tick(15);
  assert.equal(messages.length, 0);
  t.mock.timers.tick(1);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].state.p0.x, 99);
  assert.equal(messages[0].state.p0.vx, 99);
});
test('Five pets update the entire station only once in the same frame.', (t) => {
  const { manager, messages } = setup(t, 5);
  for (let i = 0; i < 5; i++) manager.updatePetState('p' + i, { x: i, size: 462 });
  t.mock.timers.tick(16);
  assert.equal(messages.length, 5);
  assert.equal(Object.keys(messages[0].state).length, 5);
});
test('A single pet is still registered, eliminating the need to send back its own collision broadcast.', (t) => {
  const { manager, messages } = setup(t, 1);
  manager.updatePetState('p0', { x: 30, size: 462 });
  t.mock.timers.tick(100);
  assert.equal(manager.state.petStates.get('p0').x, 30);
  assert.equal(messages.length, 0);
});
test('Duplicate status does not schedule broadcast again', (t) => {
  const { manager, messages } = setup(t);
  manager.updatePetState('p0', { x: 30, size: 462 });
  t.mock.timers.tick(16);
  manager.updatePetState('p0', { x: 30, size: 462 });
  t.mock.timers.tick(16);
  assert.equal(messages.length, 2);
});
test('Size or velocity changes from resting positions are still broadcast', (t) => {
  const { manager, messages } = setup(t);
  manager.updatePetState('p0', { x: 30, vx: 400, size: 462 });
  t.mock.timers.tick(16);
  manager.updatePetState('p0', { vx: 0, size: 600 });
  t.mock.timers.tick(16);
  assert.equal(messages.length, 4);
  assert.equal(messages[2].state.p0.vx, 0);
  assert.equal(messages[2].state.p0.size, 600);
});
test('Explicitly refresh and cancel the old timer, and the old status will not be sent again in the future.', (t) => {
  const { manager, messages } = setup(t);
  manager.updatePetState('p0', { x: 5 });
  manager.broadcastPetStates();
  t.mock.timers.tick(16);
  assert.equal(messages.length, 2);
});
test('Skip sending when window has been destroyed', (t) => {
  const { manager, messages } = setup(t);
  manager.updatePetState('p0', { x: 5 });
  manager.state.windows.get('p1').isDestroyed = () => true;
  t.mock.timers.tick(16);
  assert.equal(messages.length, 1);
});
test('Close all windows to clear stations and unsent timers', (t) => {
  const { manager, messages } = setup(t);
  manager.updatePetState('p0', { x: 5 });
  manager.closeAll();
  t.mock.timers.tick(16);
  assert.equal(manager.state.petStates.size, 0);
  assert.equal(messages.length, 0);
});
test('Five pets are updated at 60 frames per second, with a maximum of 300 broadcasts and the last frame of landing is retained.', (t) => {
  const { manager, messages } = setup(t, 5);
  for (let frame = 0; frame < 60; frame++) {
    for (let i = 0; i < 5; i++) manager.updatePetState('p' + i, { x: frame, vx: frame === 59 ? 0 : 600 });
    t.mock.timers.tick(1000 / 60);
  }
  assert.equal(messages.length, 300);
  assert.equal(messages.at(-1).state.p0.x, 59);
  assert.equal(messages.at(-1).state.p0.vx, 0);
});
test('Flight updates window frame by frame and takes the speed with it', () => {
  let callback,
    now = 0;
  class Sprite {}
  const context = {
    PetSprite: Sprite,
    S: {
      throwSubsteps: () => 1,
      throwStepRegion: (s) => ({ ...s, x: s.x + 10, atRest: false, bounced: false, screen: 0 }),
    },
    performance: { now: () => now },
    requestAnimationFrame: (fn) => ((callback = fn), 1),
    cancelAnimationFrame: () => {},
    window: { petBridge: {}, __dshPetDebug: {} },
  };
  vm.runInNewContext(
    readFileSync(new URL('../../runtime/electron-helper/sprite/motion.js', import.meta.url), 'utf8'),
    context,
  );
  const sprite = new Sprite();
  const positions = [];
  Object.assign(sprite, {
    stopDragFollow: () => {},
    stopMove: () => {},
    throwToken: 0,
    throwSpaceOf: () => ({ bounds: [{ maxY: 1000 }] }),
    physics: { petCollision: false },
    sendBounds(x, y) {
      positions.push({ x, y, vx: this.throwState.vx });
    },
  });
  sprite.startThrow(0, 0, 600, 0);
  for (let i = 0; i < 3; i++) {
    now += 17;
    callback();
  }
  assert.equal(positions.length, 3);
  assert.equal(positions[2].x, 30);
  assert.equal(positions[2].vx, 600);
});
