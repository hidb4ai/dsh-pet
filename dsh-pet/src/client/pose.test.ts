/**
 * Single test of the live register table (src/client/pose.ts) on the web page - issue #122 Article 1.
 *
 * Three contracts:
 * 1. Read on demand: The value is re-retrieved every time it is called (not a snapshot), so it can be read during the
 * move/throw;
 * 2. No register / empty id / non-character string → `null` , never thrown to a third party;
 * 3. When the same id is remounted, the cleanup function of the old instance cannot remove the new read function
 * (otherwise the port will be silently invalid).
 *
 * Use Node to build test runner without introducing any npm dependencies.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { poseReaderCount, readPose, registerPose } from './pose.ts';

const pose = (x: number, y: number, facing: 'left' | 'right') => ({ x, y, facing });

describe('registerPose / readPose —— Live on the page', () => {
  test('The current value can be read after registering, and the value is re-retrieved every time it is called (on demand, not a snapshot)', () => {
    let x = 0.1;
    const off = registerPose('p1', () => pose(x, 0.2, 'left'));
    assert.deepEqual(readPose('p1'), { x: 0.1, y: 0.2, facing: 'left' });
    x = 0.9; // Simulated position midway
    assert.deepEqual(
      readPose('p1'),
      { x: 0.9, y: 0.2, facing: 'left' },
      'Read on demand: the latest value should be obtained',
    );
    off();
    assert.equal(readPose('p1'), null, 'Unable to read after removal');
  });

  test('No register / empty id / non-character string → null (not thrown)', () => {
    assert.equal(readPose('nope'), null);
    assert.equal(readPose(''), null);
    assert.equal(readPose(undefined as unknown as string), null);
    assert.equal(readPose(42 as unknown as string), null);
  });

  test('The same id is remounted: the old cleanup function cannot remove the new read function', () => {
    const off1 = registerPose('p2', () => pose(0, 0, 'left'));
    const off2 = registerPose('p2', () => pose(1, 1, 'right'));
    off1(); // The old instance is unmounted (later than the new instance)
    assert.deepEqual(readPose('p2'), { x: 1, y: 1, facing: 'right' }, 'The new read function must still exist');
    off2();
    assert.equal(readPose('p2'), null);
  });

  test('Repeated calls to the cleanup function are harmless and the register number is not leaked.', () => {
    const before = poseReaderCount();
    const off = registerPose('p3', () => pose(0, 0, 'left'));
    assert.equal(poseReaderCount(), before + 1);
    off();
    off();
    assert.equal(poseReaderCount(), before);
  });
});
