/**
 * pickers event file logic unit test - verify two sets of semantics: "array slot = random within file + avoid
 * continuous repetition" and "member judgment must click-through the array slot" (direct includes will miss nested
 * candidates), as well as the source code guard of random chain roll rollKind (including pet fixed fixedEnabled) and
 * "both ends must pass this switch".
 *
 * Running method: node --experimental-strip-types --test src/shared/pickers.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  isEventAnim,
  nextWorkStatusAnim,
  pickSleepSet,
  pickSlot,
  poolIncludes,
  rollKind,
  slotIncludes,
} from './pickers.ts';

describe('pickSleepSet——The whole set of sleeping actions is random', () => {
  const sets = [
    { start: ['蹲-开始'], loop: ['蹲-循环'], end: ['蹲-起来'] },
    { start: ['趴-开始'], loop: ['趴-循环'], end: ['趴-起来'] },
  ];

  test('What was drawn is a complete set: start/loop/end has the same origin and will not be spelled across sets.', () => {
    const saved = Math.random;
    try {
      Math.random = () => 0;
      assert.deepEqual(pickSleepSet(sets), sets[0]);
      Math.random = () => 0.999;
      assert.deepEqual(pickSleepSet(sets), sets[1]);
    } finally {
      Math.random = saved;
    }
  });

  test('Empty array returns null: caller hides the "sleep" entry point accordingly', () => {
    assert.equal(pickSleepSet([]), null);
  });
});

describe('pickSlot——Event state value', () => {
  test('The character string slot is returned unchanged (the original behavior remains unchanged), exclude does not affect the character string', () => {
    assert.equal(pickSlot('工作思考'), '工作思考');
    assert.equal(pickSlot('工作思考', '工作思考'), '工作思考');
  });

  test('Randomly draw 1 from the array slot', () => {
    const saved = Math.random;
    try {
      Math.random = () => 0.1;
      assert.equal(pickSlot(['A', 'B']), 'A');
      Math.random = () => 0.9;
      assert.equal(pickSlot(['A', 'B']), 'B');
    } finally {
      Math.random = saved;
    }
  });

  test('exclude Priority Avoidance: Excluded items will not be drawn when the pool after exclusion is not empty.', () => {
    const saved = Math.random;
    try {
      // After excluding ' B ', only [' C '] remains: no matter how big the random number is, only ' C ' can be drawn
      Math.random = () => 0.999;
      assert.equal(pickSlot(['B', 'C'], 'B'), 'C');
    } finally {
      Math.random = saved;
    }
  });

  test('Single candidate + exclude yourself: return the original array, would rather repeat than return undefined', () => {
    const saved = Math.random;
    try {
      Math.random = () => 0.0;
      assert.equal(pickSlot(['Solo'], 'Solo'), 'Solo');
    } finally {
      Math.random = saved;
    }
  });
});

describe('Member judgment - array slot members must also hit', () => {
  // Isomorphic to config.jsonc: balance / whisper / workStatus, some of the states are candidate arrays
  const events = {
    balance: ['余额-钱袋满溢', ['余额-金袋叮当', '余额-金袋叮当2']],
    workStatus: [['工作思考', '开始工作'], '认真工作'],
  };

  test('slotIncludes: character string by name, array member search', () => {
    assert.equal(slotIncludes('认真工作', '认真工作'), true);
    assert.equal(slotIncludes('认真工作', '开始工作'), false);
    assert.equal(slotIncludes(['工作思考', '开始工作'], '开始工作'), true);
    assert.equal(slotIncludes(['工作思考', '开始工作'], '认真工作'), false);
  });

  test('poolIncludes: Gear array (including nested candidates) hit', () => {
    assert.equal(poolIncludes(events.workStatus, '工作思考'), true);
    assert.equal(poolIncludes(events.workStatus, '开始工作'), true);
    assert.equal(poolIncludes(events.workStatus, '认真工作'), true);
    assert.equal(poolIncludes(events.workStatus, '余额-钱袋满溢'), false);
  });

  test('isEventAnim: The entire events segment (including nested candidates) hits; undefined returns false', () => {
    assert.equal(isEventAnim(events, '余额-钱袋满溢'), true);
    assert.equal(isEventAnim(events, '余额-金袋叮当2'), true);
    assert.equal(isEventAnim(events, '开始工作'), true);
    assert.equal(isEventAnim(events, '不存在'), false);
    assert.equal(isEventAnim(undefined, '开始工作'), false);
  });
});

describe('nextWorkStatusAnim —— workStatus Decision to continue broadcasting after broadcasting (rotation within the file)', () => {
  // Isomorphic with config.jsonc: file 0 double candidate, file 1 single animation, and the rest single animations
  const wsPool = [['工作思考', '开始工作'], '认真工作', '长时间工作看表', '工作被打扰', '工作结束', '摸鱼被抓'];

  test('Multiple candidate positions: exclude the current segment and return another candidate (do not draw the same one consecutively)', () => {
    const saved = Math.random;
    try {
      Math.random = () => 0.999; // If you exclude the failure, you will get Work Thoughts
      assert.equal(nextWorkStatusAnim(wsPool, '工作思考'), '开始工作');
      Math.random = () => 0.0;
      assert.equal(nextWorkStatusAnim(wsPool, '开始工作'), '工作思考');
    } finally {
      Math.random = saved;
    }
  });

  test('Rotations must come and go: two consecutive rotations under double candidates must be in different segments.', () => {
    const pool = [['A', 'B']];
    assert.equal(nextWorkStatusAnim(pool, 'A'), 'B');
    assert.equal(nextWorkStatusAnim(pool, 'B'), 'A');
  });

  test('Single animation/single candidate position → null (continue as it is, no rotation)', () => {
    assert.equal(nextWorkStatusAnim(wsPool, '认真工作'), null);
    assert.equal(nextWorkStatusAnim(wsPool, '长时间工作看表'), null);
    assert.equal(nextWorkStatusAnim([['Solo']], 'Solo'), null);
  });

  test('The animation does not belong to the workStatus pool → null (processed according to the original semantics, such as returning to idle)', () => {
    assert.equal(nextWorkStatusAnim(wsPool, '余额-钱袋满溢'), null);
    assert.equal(nextWorkStatusAnim([], '认真工作'), null);
  });
});

describe('rollKind - Random chain roll (including pet fixed fixedEnabled)', () => {
  /** Top weight with the same shape as the built-in config.jsonc (idle 10 / turn 5 / move 5 / margin 80 = random action) */
  const w = { idle: 10, turn: 5, move: 5 };

  test('Default: three-state boundary (idle / turn / move / margin action)', () => {
    assert.equal(rollKind(0, w), 'idle');
    assert.equal(rollKind(0.0999, w), 'idle');
    assert.equal(rollKind(0.1, w), 'turn');
    assert.equal(rollKind(0.1499, w), 'turn');
    assert.equal(rollKind(0.15, w), 'move');
    assert.equal(rollKind(0.1999, w), 'move');
    assert.equal(rollKind(0.2, w), 'action');
    assert.equal(rollKind(0.9999, w), 'action');
  });

  test('Pet fixed: turn / move, the two states are calculated as 0, only idle or action is possible', () => {
    // The absolute boundary of idle remains unchanged (no normalization: the share of turn/move is directly merged into action)
    assert.equal(rollKind(0, w, { fixed: true }), 'idle');
    assert.equal(rollKind(0.0999, w, { fixed: true }), 'idle');
    // The two intervals that originally fell into turn / move are now all under action
    assert.equal(rollKind(0.1, w, { fixed: true }), 'action');
    assert.equal(rollKind(0.15, w, { fixed: true }), 'action');
    assert.equal(rollKind(0.1999, w, { fixed: true }), 'action');
    assert.equal(rollKind(0.9999, w, { fixed: true }), 'action');
  });

  test('Pet fixed + full range scan: never return turn / move', () => {
    for (let i = 0; i < 1000; i++) {
      const roll = i / 1000;
      const k = rollKind(roll, w, { fixed: true });
      assert.ok(
        k === 'idle' || k === 'action',
        `roll=${roll} selected ${k}, which must be excluded when the pet is fixed`,
      );
    }
  });

  test('Pet fixed + idle = 0: Degenerated to only broadcast random actions in place (no division by zero, no loss)', () => {
    const zero = { idle: 0, turn: 5, move: 5 };
    assert.equal(rollKind(0, zero, { fixed: true }), 'action');
    assert.equal(rollKind(0.9999, zero, { fixed: true }), 'action');
  });

  test('Default/Explicit false = Original behavior (random chain unchanged bit by bit when switch is off)', () => {
    for (const roll of [0, 0.05, 0.12, 0.17, 0.5, 0.9999]) {
      assert.equal(
        rollKind(roll, w, {}),
        rollKind(roll, w),
        `roll = ${roll}: An empty option should be equivalent to not passing`,
      );
      assert.equal(
        rollKind(roll, w, { fixed: false }),
        rollKind(roll, w),
        `roll = ${roll}: false should be equivalent to not passing`,
      );
    }
  });
});

describe('Pet Immobilization - Unanimous Guarding on Both Ends (Both ends must pass this switch into the roll)', () => {
  // Background: The random chain has a thin shell at each end (Browser React component / Desktop DOM sprite), and the
  // roll itself shares src/shared/pickers's rollKind. If fixed is only transmitted to one end, the pet on the other
  // end will still walk/turn by itself, which will appear as "the settings page is unchecked" - and it only recurs in
  // one display mode, making it extremely difficult to troubleshoot. Here put verify on both sides. The dice rolling
  // on the browser side is in the card animation flow (the React component is only responsible for assembly), and on
  // the desktop side in sprite.js.
  const browserShell =
    readFileSync(fileURLToPath(new URL('../client/pet/card/animation-flow.ts', import.meta.url)), 'utf8') +
    '\n' +
    readFileSync(fileURLToPath(new URL('../client/pet.ts', import.meta.url)), 'utf8');
  // The pet body has been split into sprite.js and sprite -* according to their responsibilities.js: The dice roll of the desktop shell is in sprite-playback, and the guard must read the full copy
  const desktopShell = [
    readFileSync(fileURLToPath(new URL('../../runtime/electron-helper/sprite.js', import.meta.url)), 'utf8'),
    ...readdirSync(fileURLToPath(new URL('../../runtime/electron-helper/sprite/', import.meta.url))).map((name) =>
      readFileSync(fileURLToPath(new URL('../../runtime/electron-helper/sprite/' + name, import.meta.url)), 'utf8'),
    ),
  ].join('\n');

  test('The browser shell (pickNext in the animation stream) transmitted fixed', () => {
    // When the actual parameter contains hub.cfg(), this type of call cannot use simple matching "until the first right bracket".
    assert.ok(
      /rollKind\([\s\S]{0,200}fixed:/.test(browserShell),
      'The dice roll on the browser side must pass fixed into rollKind (otherwise the pets in the browser will still wander around)',
    );
  });

  test('Desktop shell (playIdle of sprite.js) passed fixed', () => {
    assert.ok(
      /rollKind\([^)]*fixed:/.test(desktopShell),
      'playIdle of runtime/electron-helper/sprite.js must transfer fixed to rollKind (otherwise the pets on the desktop will still wander around)',
    );
  });

  test('Both ends transmit the pet’s own configuration items (not hard-coded true/false)', () => {
    assert.ok(
      /fixed:\s*hub\.cfg\(\)\.fixedEnabled/.test(browserShell),
      'The browser shell must pass the pet’s own fixedEnabled',
    );
    assert.ok(
      /fixed:\s*this\.pet\.fixedEnabled/.test(desktopShell),
      'Desktop shell must be passed this.pet.fixedEnabled',
    );
  });
});
