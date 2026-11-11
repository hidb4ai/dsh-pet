/**
 * host configuration merge unit test - verify animations.events slot "string | string []" verification: Array slots
 * (random candidates in the file) must be released; invalid slots such as empty character strings/empty
 * arrays/numbers/objects must be rolled back to the built-in default in the entire section (otherwise it will cause
 * all events to be lost).
 *
 * Follow the complete readAllConfig pipeline (built-in default + user main configuration merged, the same path as
 * production), and do not export the verification function separately. Use temporary directories to isolate real
 * files.
 *
 * Running method: node --experimental-strip-types --test src/host/config.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CHAT_MEMORY } from '../shared/chat-memory-config.ts';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  migrateUserConfig,
  readAllConfig,
  readUserConfig,
  removeRoundsByTs,
  saveUserConfig,
  sliceMemoryRounds,
  syncUserConfigFromDefault,
  userConfigUnparsable,
  type ConfigPaths,
} from './config.ts';

/** Complete minimal form of built-in default configuration (animations entire section must be valid - merging is entire section replacement/entire section rollback) */
const BASE = {
  pets: [
    {
      id: 'main',
      name: '主宠',
      size: 462,
      balanceEnabled: false,
      whisperEnabled: false,
      workStatusEnabled: false,
      fixedEnabled: false,
      display: 'web',
      position: { corner: 'bottom-right', marginX: 40, marginY: 40 },
    },
  ],
  animations: {
    idle: ['待机'],
    turn: ['转向'],
    drag: ['拖拽'],
    clicks: ['点击'],
    moves: {
      default: { minDist: 100, maxDist: 300, margin: 100, leadSec: 0.2, tailSec: 0.2 },
      actions: [{ name: '走动', params: {} }],
    },
    categories: [],
    events: {
      balance: ['余额A'],
      whisper: ['碎碎念A'],
      workStatus: ['工作A', '工作B'],
    },
  },
  animationWeights: { idle: 10, turn: 5, move: 5 },
  physics: {
    gravity: 1400,
    restitution: 0.78,
    groundFriction: 2.5,
    ceilingBounce: true,
    throwPower: 1.0,
    petCollision: false,
  },
  whisperPrompt: '你是桌面宠物',
  chatMemoryRounds: 4,
  notificationsEnabled: true,
  eventsRefreshSec: { balance: 1800, whisper: 300 },
  workStatusTexts: [['在干活']],
};

/** User layer animations that is isomorphic to BASE.animations and only replaces events (the top-level field is replaced in its entirety, so it must be complete) */
function animationsWithEvents(events: unknown): Record<string, unknown> {
  return { ...BASE.animations, events };
}

interface Suite {
  overlay: Record<string, unknown>;
  /** Which object is expected to be consistent with events.workStatus after merging? */
  expectWorkStatus: unknown[];
}

function cases(suite: Suite): void {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-config-test-'));
  try {
    const paths: ConfigPaths = {
      defaultFile: join(dir, 'default.jsonc'),
      userFile: join(dir, 'main-config.jsonc'),
      petDir: join(dir, 'pet'), // Does not exist = no file pet, scanPetFiles fallback
    };
    writeFileSync(paths.defaultFile, JSON.stringify(BASE));
    writeFileSync(paths.userFile, JSON.stringify(suite.overlay));
    const merged = readAllConfig(paths);
    const workStatus = (merged.main.animations as Record<string, unknown>).events as {
      workStatus: unknown[];
    };
    assert.deepEqual(workStatus.workStatus, suite.expectWorkStatus);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('readAllConfig —— events slot string | string [] Verification', () => {
  test('The character string slot is released as it is (the original behavior remains unchanged)', () => {
    cases({
      overlay: { animations: animationsWithEvents({ workStatus: ['工作A', '工作B'] }) },
      expectWorkStatus: ['工作A', '工作B'],
    });
  });

  test('Array slot release (random candidate in file, fully backward compatible with character string)', () => {
    cases({
      overlay: {
        animations: animationsWithEvents({
          balance: BASE.animations.events.balance, // Existing rules: events.balance is a required non-empty array (if the user changes workStatus, it will be retained)
          whisper: BASE.animations.events.whisper,
          workStatus: [['工作思考', '开始工作'], '认真工作', '长时间工作看表', '工作被打扰', '工作结束', '摸鱼被抓'],
        }),
      },
      expectWorkStatus: [['工作思考', '开始工作'], '认真工作', '长时间工作看表', '工作被打扰', '工作结束', '摸鱼被抓'],
    });
  });

  test('The empty character string slot is invalid → animations The entire segment falls back to the default', () => {
    cases({
      overlay: { animations: animationsWithEvents({ workStatus: ['工作A', ''] }) },
      expectWorkStatus: BASE.animations.events.workStatus,
    });
  });

  test('Invalid empty array slot → fallback to default for the entire section', () => {
    cases({
      overlay: { animations: animationsWithEvents({ workStatus: [['工作A'], []] }) },
      expectWorkStatus: BASE.animations.events.workStatus,
    });
  });

  test('The empty character string member in the array is invalid → fall back to the default for the entire section', () => {
    cases({
      overlay: { animations: animationsWithEvents({ workStatus: [['工作A', ''], '工作B'] }) },
      expectWorkStatus: BASE.animations.events.workStatus,
    });
  });

  test('Invalid number/object slot → fallback to default for the entire section', () => {
    for (const bad of [42 as unknown, { name: 'x' } as unknown, null as unknown, true as unknown]) {
      cases({
        overlay: { animations: animationsWithEvents({ workStatus: [bad, '工作B'] }) },
        expectWorkStatus: BASE.animations.events.workStatus,
      });
    }
  });
});

describe('readAllConfig —— events will still fall back to the default if it is missing (the existing behavior will not fall back)', () => {
  test('animations is not written at all in the user layer → use the built-in default', () => {
    cases({
      overlay: { whisperPrompt: '改个提示词' },
      expectWorkStatus: BASE.animations.events.workStatus,
    });
  });
});

describe('readAllConfig —— animations.sleep (optional section) verification', () => {
  /** Overwrite the built-in default animations with the given sleep, and read back the animations of the main entry in the resolved value */
  function mergedAnimations(sleep: unknown): Record<string, unknown> {
    const animations = sleep === undefined ? BASE.animations : { ...BASE.animations, sleep };
    return readAllConfig(withBase({}, { animations })).main.animations as Record<string, unknown>;
  }

  test('The entire valid set is retained as is (three candidate arrays start / loop / end)', () => {
    const sleep = [{ start: ['蹲-开始'], loop: ['蹲-循环'], end: ['蹲-起来'] }];
    assert.deepEqual(mergedAnimations(sleep).sleep, sleep);
  });

  test('Do not write sleep: valid, this entry just does not have a sleep function (other animations are not affected)', () => {
    const anim = mergedAnimations(undefined);
    assert.equal(anim.sleep, undefined);
    assert.deepEqual(anim.idle, BASE.animations.idle);
  });

  test('Invalid form of whole segment fallback default: empty array/empty segment/missing segment/empty string member/non-character string member/non-array', () => {
    const bad: unknown[] = [
      [],
      [{ start: [], loop: ['蹲-循环'], end: ['蹲-起来'] }],
      [{ start: ['蹲-开始'], loop: ['蹲-循环'] }],
      [{ start: ['蹲-开始'], loop: ['蹲-循环'], end: [''] }],
      [{ start: ['蹲-开始'], loop: ['蹲-循环'], end: [1] }],
      'sleep',
    ];
    for (const sleep of bad) {
      assert.deepEqual(
        mergedAnimations(sleep),
        BASE.animations,
        `Illegal sleep must be rolled back in its entirety: ${JSON.stringify(sleep)}`,
      );
    }
  });

  test('Write animations in the category file yourself but do not write sleep: valid, but this category does not have a sleep function', () => {
    const paths = withBase({});
    mkdirSync(paths.petDir, { recursive: true });
    writeFileSync(
      join(paths.petDir, 'pig-config.json'),
      JSON.stringify({
        pets: [{ id: 'pig1', name: '猪', display: 'web' }],
        animations: BASE.animations,
        animationWeights: BASE.animationWeights,
      }),
    );
    const pig = readAllConfig(paths).pig.animations as Record<string, unknown>;
    assert.equal(pig.sleep, undefined);
    assert.deepEqual(
      pig.idle,
      BASE.animations.idle,
      'Failure to write sleep shall not invalidate the entire animations',
    );
  });
});

describe('readAllConfig —— animations.baifan (built-in gameplay animation, optional segment) verification', () => {
  /** Overwrite the built-in default animations with the given baifan, and read back the animations of the main entry in the resolved value */
  function mergedAnimations(baifan: unknown): Record<string, unknown> {
    const animations = baifan === undefined ? BASE.animations : { ...BASE.animations, baifan };
    return readAllConfig(withBase({}, { animations })).main.animations as Record<string, unknown>;
  }

  /** Five valid slots (the order is the gameplay contract, see Animations of shared/types) */
  const SLOTS = ['跑向底部', '侧身追', '期待', '吃碗饭', '吃饭团'];

  test('The five valid names are retained as they are.', () => {
    assert.deepEqual(mergedAnimations(SLOTS).baifan, SLOTS);
  });

  test('Do not write baifan: valid, this entry just does not have this gameplay (other animations are not affected)', () => {
    const anim = mergedAnimations(undefined);
    assert.equal(anim.baifan, undefined);
    assert.deepEqual(anim.idle, BASE.animations.idle);
  });

  test('Invalid form of whole segment fallback default: one less / one more / empty string / non-character string / non-array', () => {
    const bad: unknown[] = [
      ['跑向底部', '侧身追', '期待', '吃碗饭'],
      [...SLOTS, '吃饭团'],
      ['跑向底部', '侧身追', '期待', '吃碗饭', ''],
      ['跑向底部', '侧身追', '期待', '吃碗饭', 1],
      'baifan',
    ];
    for (const baifan of bad) {
      assert.deepEqual(
        mergedAnimations(baifan),
        BASE.animations,
        `Illegal baifan must be rolled back in its entirety: ${JSON.stringify(baifan)}`,
      );
    }
  });
});

/** Take a trip to readAllConfig: base is the built-in default (emoticon switch can be injected), overlay is the user layer */
function withBase(baseExtra: Record<string, unknown>, overlay?: Record<string, unknown>): ConfigPaths {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-config-test-'));
  const paths: ConfigPaths = {
    defaultFile: join(dir, 'default.jsonc'),
    userFile: join(dir, 'main-config.jsonc'),
    petDir: join(dir, 'pet'),
  };
  writeFileSync(paths.defaultFile, JSON.stringify({ ...BASE, ...baseExtra }));
  if (overlay) writeFileSync(paths.userFile, JSON.stringify(overlay));
  return paths;
}

/** Make a trip to saveUserConfig: Return the object written to the user layer (null = rejected by sanitize) */
function saveOnce(body: Record<string, unknown>, existing?: Record<string, unknown>): Record<string, unknown> | null {
  return saveUserConfig(body, existing) as Record<string, unknown> | null;
}

/** Create a set of paths: default file = BASE; the original text of the user layer is given by caller (can be commented) */
function pathsWithUser(raw: string | null): { paths: ConfigPaths; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-user-config-'));
  const paths: ConfigPaths = {
    defaultFile: join(dir, 'default.jsonc'),
    userFile: join(dir, 'main-config.jsonc'),
    legacyUserFile: join(dir, 'main-config.json'),
    petDir: join(dir, 'pet'),
  };
  writeFileSync(paths.defaultFile, JSON.stringify(BASE));
  if (raw !== null) writeFileSync(paths.userFile, raw);
  return { paths, dir };
}

describe('migrateUserConfig ——Old user main-config.json → main-config.jsonc', () => {
  /** Only write a copy of the user layer in the old path (simulating the old user before upgrade) */
  function legacyOnly(raw: string): { paths: ConfigPaths; dir: string } {
    const { paths, dir } = pathsWithUser(null);
    writeFileSync(paths.legacyUserFile as string, raw);
    return { paths, dir };
  }

  test('The old file exists but the new file does not exist → Rename (the content remains unchanged) and the old file disappears', () => {
    const raw = '// 老用户的配置\n{\n  "physics": ' + JSON.stringify(BASE.physics) + '\n}\n';
    const { paths, dir } = legacyOnly(raw);
    try {
      const logs: string[] = [];
      assert.equal(
        migrateUserConfig(paths, (m) => logs.push(m)),
        true,
      );
      assert.equal(existsSync(paths.legacyUserFile as string), false, 'Old files should have been renamed away');
      assert.equal(
        readFileSync(paths.userFile, 'utf8'),
        raw,
        'The content of the new file must be consistent byte by byte with the old file',
      );
      assert.equal(logs.length, 1, 'A log should be left during migration');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('New file already exists → do nothing (never overwrite new file with old file)', () => {
    const { paths, dir } = pathsWithUser('{ "physics": ' + JSON.stringify(BASE.physics) + ' }\n');
    try {
      writeFileSync(paths.legacyUserFile as string, '{ "physics": { "gravity": 1 } }');
      assert.equal(migrateUserConfig(paths), false);
      assert.equal(existsSync(paths.legacyUserFile as string), true, 'Old files remain intact');
      assert.equal(readUserConfig(paths)?.physics !== undefined, true, 'The new file is still effective');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('Old file does not exist → do nothing (first use)', () => {
    const { paths, dir } = pathsWithUser(null);
    try {
      assert.equal(migrateUserConfig(paths), false);
      assert.equal(existsSync(paths.userFile), false, 'Don’t create documents out of thin air');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('Reading the fallback old path when migration has not been performed (migration failed/not run): the configuration still takes effect.', () => {
    const { paths, dir } = legacyOnly('{ "physics": ' + JSON.stringify(BASE.physics) + ' }\n');
    try {
      assert.equal(readUserConfig(paths)?.physics !== undefined, true, 'Read fallback old . json');
      assert.equal(userConfigUnparsable(paths), false, 'The old path is legal → not damaged');
      assert.deepEqual(readAllConfig(paths).main.physics, BASE.physics);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('userConfigUnparsable - Pre-check for damage before saving (a window must pop up when damaged, and silent loss of configuration is not allowed)', () => {
  test('True damage (syntax error) → true: The host returns 409 accordingly and does not write to the disk.', () => {
    const { paths, dir } = pathsWithUser('{ "physics": { 这不是 JSON');
    try {
      assert.equal(userConfigUnparsable(paths), true);
      assert.equal(
        readUserConfig(paths),
        undefined,
        'Prefix: Existing fields cannot be read when damaged (whitelist reconstruction will lose content)',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('Annotated but valid (original text written synchronously) → false: Not damaged, saved normally', () => {
    const { paths, dir } = pathsWithUser('// 注释\n{\n  "physics": ' + JSON.stringify(BASE.physics) + '\n}\n');
    try {
      assert.equal(userConfigUnparsable(paths), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('The file does not exist → false: There is nothing to lose when saving for the first time, so it does not disturb the user.', () => {
    const { paths, dir } = pathsWithUser(null);
    try {
      assert.equal(userConfigUnparsable(paths), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('readUserConfig - Userland reads must tolerate the JSONC annotation (return to save missing fields)', () => {
  test('The annotated original text written by "Synchronization": readUserConfig is analyzed (strictly JSON.parse will be undefined)', () => {
    const { paths, dir } = pathsWithUser(
      '// 顶部注释\n{\n  /* 块注释 */\n  "physics": ' + JSON.stringify(BASE.physics) + '\n}\n',
    );
    try {
      assert.throws(() => JSON.parse(readFileSync(paths.userFile, 'utf8')), '前置：严格 JSON.parse 确实读不了');
      const existing = readUserConfig(paths);
      assert.ok(existing, 'Annotated user layer must be parsable by readUserConfig');
      assert.deepEqual(existing.physics, BASE.physics);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('Annotated User Layer + Save: Advanced fields (animations/physics/memes) all retained', () => {
    const { paths, dir } = pathsWithUser(
      '// 用户手改的配置\n{\n' +
        '  "animations": ' +
        JSON.stringify(BASE.animations) +
        ',\n  "physics": ' +
        JSON.stringify(BASE.physics) +
        ',\n  "memes": { "可爱": "我改过的描述" }\n}\n',
    );
    try {
      const out = saveUserConfig({ pets: PETS, notificationsEnabled: true }, readUserConfig(paths)) as Record<
        string,
        unknown
      >;
      assert.deepEqual(out.animations, BASE.animations, 'animations must not be lost when saving');
      assert.deepEqual(out.physics, BASE.physics, 'physics must not be lost when saving');
      assert.deepEqual(out.memes, { 可爱: '我改过的描述' }, 'Handwritten memes must not be lost when saving');
      assert.equal(out.notificationsEnabled, true, 'The whitelist fields are still subject to the request body.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('User layer does not exist/is damaged → undefined (processed as no existing fields, does not block saving)', () => {
    const missing = pathsWithUser(null);
    try {
      assert.equal(readUserConfig(missing.paths), undefined);
    } finally {
      rmSync(missing.dir, { recursive: true, force: true });
    }
    const broken = pathsWithUser('{ 这不是 JSON');
    try {
      assert.equal(readUserConfig(broken.paths), undefined);
    } finally {
      rmSync(broken.dir, { recursive: true, force: true });
    }
  });
});

describe('saveUserConfig ——System system tray switch (trayEnabled)', () => {
  test('Reject the entire package of invalid values (same conventions as other global booleans, do not silently discard user input)', () => {
    assert.equal(saveUserConfig({ pets: PETS, trayEnabled: 'false' }, undefined), null);
    assert.equal(saveUserConfig({ pets: PETS, trayEnabled: 0 }, undefined), null);
  });

  test('The request body is not included → Transparently transmit the old disk value (the system tray that the user has closed must not be opened again)', () => {
    const out = saveUserConfig({ pets: PETS }, { trayEnabled: false }) as Record<string, unknown>;
    assert.equal(out.trayEnabled, false);
  });

  test('The request body is brought → The request body shall prevail', () => {
    const out = saveUserConfig({ pets: PETS, trayEnabled: false }, { trayEnabled: true }) as Record<string, unknown>;
    assert.equal(out.trayEnabled, false);
  });
});

describe('JSONC configuration reading: comment mark and escape in character string', () => {
  const prompts = [
    '请原样解释 // 示例 这段文字',
    '请原样解释 /* 示例 */ 这段文字',
    '链接 https://example.test/a//b?q=/*text*/',
    '请解释 "引号内的 // 内容" 和 /* 内容 */',
    String.raw`反斜杠 \\ 与转义引号 \" 后面的 // 内容`,
    '结尾反斜杠 \\',
  ];

  for (const whisperPrompt of prompts) {
    test(`Read and merge preserve ${JSON.stringify(whisperPrompt)} verbatim`, () => {
      const overlay = { whisperPrompt, metadata: { '/* 字段名 */': '// 字段值' } };
      const { paths, dir } = pathsWithUser('// 外部行注释\n' + JSON.stringify(overlay) + '\n/* 外部块注释 */');
      try {
        assert.deepEqual(readUserConfig(paths), overlay);
        assert.equal(userConfigUnparsable(paths), false);
        assert.equal(readAllConfig(paths).main.whisperPrompt, whisperPrompt);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  test('Quotation marks and comment marks in comments do not affect CRLF, CR and end-of-file line comments', () => {
    const { paths, dir } = pathsWithUser(
      '// " /* 行注释\r\n{\r  /* " // 块注释\r\n */ "chatMemoryRounds": 3\r}\r// 文件末尾',
    );
    try {
      assert.deepEqual(readUserConfig(paths), { chatMemoryRounds: 3 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('Save and retain prompt word content and advanced configuration after reading', () => {
    const overlay = { whisperPrompt: '解释 // 和 /* */', physics: BASE.physics, animations: BASE.animations };
    const { paths, dir } = pathsWithUser(JSON.stringify(overlay));
    try {
      const out = saveUserConfig({ pets: BASE.pets }, readUserConfig(paths)) as Record<string, unknown>;
      assert.equal(out.whisperPrompt, overlay.whisperPrompt);
      assert.deepEqual(out.physics, overlay.physics);
      assert.deepEqual(out.animations, overlay.animations);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const raw of ['{"chatMemoryRounds": 1/* 注释 */2}', '{"chatMemoryRounds": 3} /* 未结束']) {
    test(`Reject corrupted configuration ${raw}`, () => {
      const { paths, dir } = pathsWithUser(raw);
      try {
        assert.equal(readUserConfig(paths), undefined);
        assert.equal(userConfigUnparsable(paths), true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

const PETS = BASE.pets;

describe('saveUserConfig pet IDs', () => {
  test('rejects repeated IDs before writing a configuration that would lose a pet', () => {
    assert.equal(
      saveOnce({
        pets: [
          { ...PETS[0], name: 'first' },
          { ...PETS[0], name: 'second' },
        ],
      }),
      null,
    );
  });

  test('rejects IDs that collide after the same trimming used during reads', () => {
    assert.equal(
      saveOnce({
        pets: [
          { ...PETS[0], id: ' main ' },
          { ...PETS[0], id: 'main' },
        ],
      }),
      null,
    );
  });

  test('rejects blank and non-string IDs instead of writing unreadable entries', () => {
    for (const id of ['', '   ', '\t\n', 42, true, null, {}, ['main']]) {
      assert.equal(saveOnce({ pets: [{ ...PETS[0], id }] }), null, JSON.stringify(id));
    }
  });

  test('canonical IDs survive a save/read round trip, including Chinese IDs', () => {
    const clean = saveOnce({
      pets: [
        { ...PETS[0], id: ' main ' },
        { ...PETS[0], id: ' 副宠 ' },
      ],
    });
    assert.ok(clean);
    const pets = clean.pets as Record<string, unknown>[];
    assert.deepEqual(
      pets.map((p) => p.id),
      ['main', '副宠'],
    );
    const paths = withBase({}, clean);
    try {
      assert.deepEqual(
        (readAllConfig(paths).main.pets as Record<string, unknown>[]).map((p) => p.id),
        ['main', '副宠'],
      );
    } finally {
      rmSync(dirname(paths.defaultFile), { recursive: true, force: true });
    }
  });

  test('keeps distinct case-sensitive IDs and allows matching display names', () => {
    const clean = saveOnce({
      pets: [
        { ...PETS[0], id: 'Blue' },
        { ...PETS[0], id: 'blue' },
      ],
    });
    assert.ok(clean);
    assert.deepEqual(
      (clean.pets as Record<string, unknown>[]).map((p) => p.id),
      ['Blue', 'blue'],
    );
  });

  test('retains the ID length limit and path character restrictions', () => {
    assert.ok(saveOnce({ pets: [{ ...PETS[0], id: 'a'.repeat(64) }] }));
    for (const id of ['a'.repeat(65), 'pet/name', 'pet\\name', 'pet:name', 'pet\0name']) {
      assert.equal(saveOnce({ pets: [{ ...PETS[0], id }] }), null);
    }
  });
});

describe('saveUserConfig —— Meme image switch (whitelist + transparent transmission reservation)', () => {
  test('Two image switches are written with the request body', () => {
    const out = saveOnce({ pets: PETS, whisperImageEnabled: true, chatImageEnabled: true });
    assert.equal(out?.whisperImageEnabled, true);
    assert.equal(out?.chatImageEnabled, true);
  });

  test('No writing when the switch is not passed (no fields created out of thin air)', () => {
    const out = saveOnce({ pets: PETS });
    assert.equal('whisperImageEnabled' in (out ?? {}), false);
    assert.equal('chatImageEnabled' in (out ?? {}), false);
  });

  test('Switch passes non-boolean → overall rejection (host returns 400)', () => {
    assert.equal(saveOnce({ pets: PETS, whisperImageEnabled: 'yes' }), null);
    assert.equal(saveOnce({ pets: PETS, chatImageEnabled: 1 }), null);
  });

  test('The handwritten memes mapping table is retained by transparent transmission (the setting page is saved and not erased)', () => {
    const memes = { 可爱: '我改过的描述' };
    const out = saveOnce({ pets: PETS, whisperImageEnabled: false }, { pets: PETS, memes });
    assert.deepEqual(out?.memes, memes);
  });

  test('The switch value of the request body overwrites the old value on the disk (not reversely overwritten by existing)', () => {
    const out = saveOnce(
      { pets: PETS, whisperImageEnabled: true },
      { pets: PETS, whisperImageEnabled: false, chatImageEnabled: true },
    );
    assert.equal(out?.whisperImageEnabled, true); // Request body takes priority
    assert.equal(out?.chatImageEnabled, true); // The old values that have not been transmitted are still transparently transmitted and retained.
  });
});

describe('saveUserConfig —— Dialogue action linkage switch (whitelist + transparent transmission reservation)', () => {
  test('Written with the request body, fields are not created out of thin air by default.', () => {
    const out = saveOnce({ pets: PETS, chatAnimationEnabled: false });
    assert.equal(out?.chatAnimationEnabled, false);
    assert.equal('chatAnimationEnabled' in (saveOnce({ pets: PETS }) ?? {}), false);
  });

  test('Passing non-boolean → overall rejection (host returns 400)', () => {
    assert.equal(saveOnce({ pets: PETS, chatAnimationEnabled: 'yes' }), null);
  });

  test('The old value on the disk will be overwritten after the request body is transferred.', () => {
    const out = saveOnce({ pets: PETS, chatAnimationEnabled: true }, { pets: PETS, chatAnimationEnabled: false });
    assert.equal(out?.chatAnimationEnabled, true);
  });
});

describe('readAllConfig ——Dialogue action linkage switch merge (can be overridden by user layer/invalid fallback to default)', () => {
  test('Built-in default true; user layer writes false → reads false', () => {
    assert.equal(readAllConfig(withBase({ chatAnimationEnabled: true })).main.chatAnimationEnabled, true);
    assert.equal(
      readAllConfig(withBase({ chatAnimationEnabled: true }, { chatAnimationEnabled: false })).main
        .chatAnimationEnabled,
      false,
    );
  });

  test('The user layer wrote an invalid value → fall back to the built-in default', () => {
    assert.equal(
      readAllConfig(withBase({ chatAnimationEnabled: true }, { chatAnimationEnabled: 'yes' })).main
        .chatAnimationEnabled,
      true,
    );
  });
});

describe('readAllConfig - Merge the emoticon switch (if missing, take the default/invalid fallback to the default)', () => {
  test('The built-in default value → can be read when the user layer is not writing.', () => {
    const merged = readAllConfig(withBase({ whisperImageEnabled: true, chatImageEnabled: false }));
    assert.equal(merged.main.whisperImageEnabled, true);
    assert.equal(merged.main.chatImageEnabled, false);
  });

  test('The user layer wrote an invalid value → fall back to the built-in default', () => {
    const merged = readAllConfig(
      withBase({ whisperImageEnabled: true, chatImageEnabled: false }, { whisperImageEnabled: 'yes' }),
    );
    assert.equal(merged.main.whisperImageEnabled, true); // Fall back to default true
  });
});

describe('saveUserConfig —— Throw lock switch (white list + transparent transmission reservation)', () => {
  test('Write with request body', () => {
    const out = saveOnce({ pets: PETS, confineToScreen: true });
    assert.equal(out?.confineToScreen, true);
  });

  test('Do not write when not transmitted (do not create fields out of thin air)', () => {
    const out = saveOnce({ pets: PETS });
    assert.equal('confineToScreen' in (out ?? {}), false);
  });

  test('Passing non-boolean → overall rejection (host returns 400)', () => {
    assert.equal(saveOnce({ pets: PETS, confineToScreen: 'yes' }), null);
  });

  test('The value of the request body overwrites the old value on the disk; if it is not transmitted, the old value on the disk is transparently transmitted.', () => {
    const overwritten = saveOnce({ pets: PETS, confineToScreen: true }, { pets: PETS, confineToScreen: false });
    assert.equal(overwritten?.confineToScreen, true); // Request body takes priority
    const kept = saveOnce({ pets: PETS }, { pets: PETS, confineToScreen: true });
    assert.equal(kept?.confineToScreen, true); // The old values that have not been transmitted are still transparently transmitted and retained.
  });
});

describe('saveUserConfig - pet fixed fixedEnabled (per-pet whitelist)', () => {
  /** Get the n pet after persist to disk */
  const petAt = (out: Record<string, unknown> | null, n = 0): Record<string, unknown> =>
    (out?.pets as Record<string, unknown>[])[n];

  test("Pets are written along with the request body (if they are not in the whitelist, they will be saved and quietly discarded - the same model as physics's old bug)", () => {
    const out = saveOnce({ pets: [{ ...PETS[0], fixedEnabled: true }] });
    assert.equal(petAt(out).fixedEnabled, true, 'fixedEnabled must be in the whitelist of saveUserConfig');
  });

  test('The persist to disk is missing when it is not transmitted (the built-in default is used when reading, and the value is not created out of thin air)', () => {
    // Explicitly construct a pet with "fixedEnabled not written": The key in the persist to disk object is undefined
    // (JSON.stringify is discarded), and it will be filled in by the built-in default when merging and reading - when
    // the setting page does not pass it, you must not write a false out of thin air.
    const bare: Record<string, unknown> = { ...PETS[0] };
    delete bare.fixedEnabled;
    assert.equal(petAt(saveOnce({ pets: [bare] })).fixedEnabled, undefined);
  });

  test('Passing non-boolean → overall rejection (host returns 400)', () => {
    assert.equal(saveOnce({ pets: [{ ...PETS[0], fixedEnabled: 'yes' }] }), null);
  });

  test('Instance-by-instance independence: one true and one false persist to disk according to their respective values.', () => {
    const out = saveOnce({
      pets: [
        { ...PETS[0], id: 'a', fixedEnabled: true },
        { ...PETS[0], id: 'b', fixedEnabled: false },
      ],
    });
    const pets = out?.pets as Record<string, unknown>[];
    assert.equal(pets.find((p) => p.id === 'a')?.fixedEnabled, true);
    assert.equal(pets.find((p) => p.id === 'b')?.fixedEnabled, false);
  });
});

describe('readAllConfig ——Instance level persona whisperPrompt (instance override/leave no effective value filled in)', () => {
  const petAt = (merged: Record<string, Record<string, unknown>>, n = 0): Record<string, unknown> =>
    (merged.main.pets as Record<string, unknown>[])[n];

  test('The instance is written → brought out unchanged (consumer replaces the entry persona accordingly)', () => {
    const merged = readAllConfig(withBase({}, { pets: [{ ...BASE.pets[0], whisperPrompt: '我是猫娘' }] }));
    assert.equal(petAt(merged).whisperPrompt, '我是猫娘');
    // The entry-level share is still there: choose one of the two by petPersona, and the merger does not merge.
    assert.equal(merged.main.whisperPrompt, BASE.whisperPrompt);
  });

  test('Not written → There is **no** this key in the result (the fallback entry is made by the consumer, and the combiner does not fill in the effective value)', () => {
    // Once the merger fills in the entry persona into each instance, / pet-display (take the merge result callback
    // saveUserConfig and write it to disk) will solidify the "following entry" into an explicit override, and then
    // change the entry persona and these instances will no longer change - this verify it.
    const pet = petAt(readAllConfig(withBase({})));
    assert.equal('whisperPrompt' in pet, false);
  });

  test('Empty string / pure blank → when nothing is written (the empty string is submitted after the clear input box on the setting page)', () => {
    for (const value of ['', '   \n\t ']) {
      const pet = petAt(readAllConfig(withBase({}, { pets: [{ ...BASE.pets[0], whisperPrompt: value }] })));
      assert.equal('whisperPrompt' in pet, false, `${JSON.stringify(value)} should be treated as not written`);
    }
  });

  test('A non-character string is explicitly written → If it is not written, no error will be thrown (dirty values will never enter the rendering layer)', () => {
    for (const value of [42, { a: 1 }, ['x'], true]) {
      const pet = petAt(readAllConfig(withBase({}, { pets: [{ ...BASE.pets[0], whisperPrompt: value }] })));
      assert.equal('whisperPrompt' in pet, false, `${JSON.stringify(value)} should be ignored`);
    }
  });

  test('Instance-by-instance independence: two pets each write their own, and do not infect each other.', () => {
    const merged = readAllConfig(
      withBase(
        {},
        {
          pets: [
            { ...BASE.pets[0], id: 'a', whisperPrompt: 'A 的人设' },
            { ...BASE.pets[0], id: 'b' },
          ],
        },
      ),
    );
    const pets = merged.main.pets as Record<string, unknown>[];
    assert.equal(pets.find((p) => p.id === 'a')?.whisperPrompt, 'A 的人设');
    assert.equal('whisperPrompt' in (pets.find((p) => p.id === 'b') as Record<string, unknown>), false);
  });
});

describe('saveUserConfig - instance-level persona whisperPrompt (whitelist + clear = delete override)', () => {
  const petAt = (out: Record<string, unknown> | null, n = 0): Record<string, unknown> =>
    (out?.pets as Record<string, unknown>[])[n];

  test('After non-empty character string → trim, persist to disk (if it is not in the whitelist, it will be saved and quietly discarded - physics is the same as the old bug)', () => {
    const out = saveOnce({ pets: [{ ...PETS[0], whisperPrompt: '  我是猫娘\n' }] });
    assert.equal(petAt(out).whisperPrompt, '我是猫娘', 'whisperPrompt must be in the whitelist of saveUserConfig');
  });

  test('Empty string / pure blank → do not write the key (= delete the override, fallback entry for this pet)', () => {
    for (const value of ['', '   ']) {
      assert.equal(
        'whisperPrompt' in petAt(saveOnce({ pets: [{ ...PETS[0], whisperPrompt: value }] })),
        false,
        `${JSON.stringify(value)} should not persist to disk`,
      );
    }
  });

  test('Not transmitted → Do not create fields out of thin air (old client/settings page must not write an empty persona when it is not transmitted)', () => {
    assert.equal('whisperPrompt' in petAt(saveOnce({ pets: [{ ...PETS[0] }] })), false);
  });

  test('A non-character string is passed → overall rejection (the host returns 400 and does not silently discard user input)', () => {
    assert.equal(saveOnce({ pets: [{ ...PETS[0], whisperPrompt: 42 }] }), null);
  });

  test('/ pet-display type round trip: the merged result is directly fed back to save, persona is not lost (nor will it be written as an empty string)', () => {
    const merged = readAllConfig(withBase({}, { pets: [{ ...BASE.pets[0], whisperPrompt: '我是猫娘' }] }));
    const layerPets = merged.main.pets as Record<string, unknown>[];
    assert.equal(petAt(saveOnce({ pets: layerPets })).whisperPrompt, '我是猫娘');
  });
});

describe('Configuration merging and saving - sizePercent (the key will be dropped only if it is valid, and the default consumption is 20)', () => {
  const petAt = (merged: Record<string, Record<string, unknown>>): Record<string, unknown> =>
    (merged.main.pets as Record<string, unknown>[])[0];

  test('The valid percentage is written in the instance → brought out as it is', () => {
    const pet = petAt(readAllConfig(withBase({}, { pets: [{ ...BASE.pets[0], sizePercent: 40 }] })));
    assert.equal(pet.sizePercent, 40);
  });

  test('No writing → No key drop (default is 20 when rendering side presses, the file does not have extra keys; the shape is consistent even when there is no user layer)', () => {
    assert.equal('sizePercent' in petAt(readAllConfig(withBase({}))), false);
  });

  test('Non-digit or less than 1 → Do not drop the key and alert, do not throw an error', () => {
    for (const value of [0, -5, '40', null, { a: 1 }, true]) {
      const pet = petAt(readAllConfig(withBase({}, { pets: [{ ...BASE.pets[0], sizePercent: value }] })));
      assert.equal('sizePercent' in pet, false, `${JSON.stringify(value)} should be ignored`);
    }
  });

  test('Both boundary values and values exceeding 100 are valid (no upper limit)', () => {
    for (const value of [1, 100, 150]) {
      const pet = petAt(readAllConfig(withBase({}, { pets: [{ ...BASE.pets[0], sizePercent: value }] })));
      assert.equal(pet.sizePercent, value);
    }
  });

  test('saveUserConfig: valid percentage persist to disk (if it is not in the whitelist, it will be saved and quietly discarded)', () => {
    const out = saveOnce({ pets: [{ ...PETS[0], sizePercent: 40 }] });
    assert.equal((out?.pets as Record<string, unknown>[])[0].sizePercent, 40);
  });

  test('saveUserConfig: Not transmitted → Do not create fields out of thin air', () => {
    const out = saveOnce({ pets: PETS });
    assert.equal('sizePercent' in (out?.pets as Record<string, unknown>[])[0], false);
  });

  test('saveUserConfig: An invalid value is passed → overall rejection (the host returns 400, and the input is not lost silently)', () => {
    for (const value of [0, -1, '40']) {
      assert.equal(
        saveOnce({ pets: [{ ...PETS[0], sizePercent: value }] }),
        null,
        `${JSON.stringify(value)} should be rejected`,
      );
    }
  });

  test('The merged result is directly fed back to save: the percentage is not lost in the round trip.', () => {
    const merged = readAllConfig(withBase({}, { pets: [{ ...BASE.pets[0], sizePercent: 40 }] }));
    const layerPets = merged.main.pets as Record<string, unknown>[];
    assert.equal((saveOnce({ pets: layerPets })?.pets as Record<string, unknown>[])[0].sizePercent, 40);
  });
});

describe('saveUserConfig ——Physical parameters physics (whitelist + transparent transmission reservation)', () => {
  const PHYS: Record<string, unknown> = BASE.physics;

  test('The entire segment is written with the request body ("Physical" area of the settings page)', () => {
    const out = saveOnce({ pets: PETS, physics: PHYS });
    assert.deepEqual(out?.physics, PHYS, 'physics must be written in the entire request body');
  });

  test('The old disk value is transparently transmitted when it has not been transmitted; if it does not exist on the disk, the field is not created out of thin air.', () => {
    const kept = saveOnce({ pets: PETS }, { pets: PETS, physics: { ...PHYS, gravity: 2000 } });
    assert.deepEqual(
      kept?.physics,
      { ...PHYS, gravity: 2000 },
      'When physics is not transmitted, the manually modified value on the disk must be retained as it is.',
    );
    assert.equal(
      'physics' in (saveOnce({ pets: PETS }) ?? {}),
      false,
      'It is not allowed to write out of thin air when there is nothing on the disk.',
    );
  });

  test('The request body overwrites the old value on disk (same semantics as the four global switches)', () => {
    const out = saveOnce({ pets: PETS, physics: { ...PHYS, throwPower: 2 } }, { pets: PETS, physics: PHYS });
    assert.equal((out?.physics as Record<string, unknown>).throwPower, 2);
  });

  test('hapticEnabled: The missing key is valid (the old configuration is enabled by default), and the entire non-Boolean section is rejected.', () => {
    const missing: Record<string, unknown> = { ...PHYS };
    delete missing.hapticEnabled;
    const kept = saveOnce({ pets: PETS, physics: missing });
    assert.ok(kept, 'Missing keys should not be rejected as a whole');
    assert.equal(
      'hapticEnabled' in (kept?.physics as Record<string, unknown>),
      false,
      'If the key is not written, the key will not be filled out of the air.',
    );
    assert.ok(
      saveOnce({ pets: PETS, physics: { ...PHYS, hapticEnabled: false } }),
      'If explicitly turned off, it must be able to persist to disk.',
    );
    assert.equal(saveOnce({ pets: PETS, physics: { ...PHYS, hapticEnabled: 'yes' } }), null);
  });

  test('tiltGravity / shakeThrow: Missing key is valid (default), non-Boolean whole segment is rejected', () => {
    const missing: Record<string, unknown> = { ...PHYS };
    delete missing.tiltGravity;
    delete missing.shakeThrow;
    assert.ok(saveOnce({ pets: PETS, physics: missing }), 'Missing keys should not be rejected as a whole');
    assert.ok(
      saveOnce({ pets: PETS, physics: { ...PHYS, tiltGravity: true } }),
      'When turning on tilt alone, it must be able to persist to disk',
    );
    assert.ok(saveOnce({ pets: PETS, physics: { ...PHYS, shakeThrow: true } }), 'Shake alone to persist to disk');
    assert.equal(saveOnce({ pets: PETS, physics: { ...PHYS, tiltGravity: 'on' } }), null);
    assert.equal(saveOnce({ pets: PETS, physics: { ...PHYS, shakeThrow: 1 } }), null);
  });

  test('Invalid value → overall rejection (host returns 400; the same set of rules as the read side physicsValid)', () => {
    const bad: Array<[string, unknown]> = [
      ['restitution > 1', { ...PHYS, restitution: 1.5 }],
      ['restitution < 0', { ...PHYS, restitution: -0.1 }],
      ['gravity 负数', { ...PHYS, gravity: -1 }],
      ['groundFriction 负数', { ...PHYS, groundFriction: -1 }],
      ['throwPower = 0', { ...PHYS, throwPower: 0 }],
      ['gravity 非数字', { ...PHYS, gravity: 'fast' }],
      [
        '缺 ceilingBounce',
        { gravity: 1400, restitution: 0.78, groundFriction: 2.5, throwPower: 1, petCollision: false },
      ],
      ['ceilingBounce 非布尔', { ...PHYS, ceilingBounce: 1 }],
      ['physics 非对象', 'yes'],
    ];
    for (const [name, value] of bad) {
      assert.equal(saveOnce({ pets: PETS, physics: value }), null, `${name} must be rejected`);
    }
  });
});

describe('saveUserConfig —— Action frequency animationWeights (white list + transparent transmission reservation)', () => {
  const WEIGHTS = { idle: 30, turn: 5, move: 5 };

  test('The entire segment is written with the request body ("Action Frequency" card on the setting page)', () => {
    const out = saveOnce({ pets: PETS, animationWeights: WEIGHTS });
    assert.deepEqual(out?.animationWeights, WEIGHTS, 'animationWeights must be written in the entire request body');
  });

  test('The old disk value is transparently transmitted when it has not been transmitted; if it does not exist on the disk, the field is not created out of thin air.', () => {
    const kept = saveOnce({ pets: PETS }, { pets: PETS, animationWeights: WEIGHTS });
    assert.deepEqual(
      kept?.animationWeights,
      WEIGHTS,
      'The manually modified value on the disk must be retained as it is before being transferred.',
    );
    assert.equal(
      'animationWeights' in (saveOnce({ pets: PETS }) ?? {}),
      false,
      'It is not allowed to write out of thin air when there is nothing on the disk.',
    );
  });

  test('Numerical normalization: character strings are also numerically persisted to disk', () => {
    const out = saveOnce({ pets: PETS, animationWeights: { idle: '30', turn: 5, move: 5 } });
    assert.deepEqual(out?.animationWeights, WEIGHTS);
  });

  test('Invalid value → overall rejection (negative numbers and non-objects are dirty values)', () => {
    assert.equal(saveOnce({ pets: PETS, animationWeights: { idle: -1, turn: 5, move: 5 } }), null);
    assert.equal(saveOnce({ pets: PETS, animationWeights: '30' }), null);
  });
});

describe('saveUserConfig —— whisper / dialogue model (whitelist + transparent transmission reservation)', () => {
  const WM = { provider: 'deepseek', model: 'deepseek-chat' };
  const CM = { provider: 'opencode', model: 'big-model' };

  test('The entire paragraph is written with the request body (two drop-down boxes of "AI Model" on the setting page)', () => {
    const out = saveOnce({ pets: PETS, whisperModel: WM, chatModel: CM });
    assert.deepEqual(out?.whisperModel, WM, 'whisperModel must be written according to the request body');
    assert.deepEqual(out?.chatModel, CM, 'chatModel must be written according to the request body');
  });

  test('Leaving it blank (following the current conversation) is also a valid value, persist to disk as usual', () => {
    const empty = { provider: '', model: '' };
    const out = saveOnce({ pets: PETS, whisperModel: empty, chatModel: empty });
    assert.deepEqual(out?.whisperModel, empty);
    assert.deepEqual(out?.chatModel, empty);
  });

  test('The old disk value is transparently transmitted when it has not been transmitted; if it does not exist on the disk, the field is not created out of thin air.', () => {
    const kept = saveOnce({ pets: PETS }, { pets: PETS, whisperModel: WM, chatModel: CM });
    assert.deepEqual(
      kept?.whisperModel,
      WM,
      'The manually modified value on the disk must be retained as it is before being transferred.',
    );
    assert.deepEqual(kept?.chatModel, CM);
    const fresh = saveOnce({ pets: PETS }) ?? {};
    assert.equal(
      'whisperModel' in fresh,
      false,
      'It is not allowed to write out of thin air when there is nothing on the disk.',
    );
    assert.equal('chatModel' in fresh, false);
  });

  test('The request body overwrites the old value on disk (same semantics as the four global switches)', () => {
    const out = saveOnce({ pets: PETS, whisperModel: WM }, { pets: PETS, whisperModel: CM });
    assert.deepEqual(out?.whisperModel, WM);
  });

  test('Normalization when persisting to disk: blank trim on both sides, keys with multiple fields in the request body are not written into the user layer', () => {
    const out = saveOnce({
      pets: PETS,
      whisperModel: { provider: ' deepseek ', model: ' deepseek-chat ', reasoningEffort: 'high' },
    });
    assert.deepEqual(out?.whisperModel, WM, 'Only retain provider/model and two trim character strings');
  });

  test('Invalid value → overall rejection (host returns 400; the same set of rules as the read side modelSelectionValid)', () => {
    const bad: Array<[string, unknown]> = [
      ['只填服务商', { provider: 'deepseek', model: '' }],
      ['只填模型', { provider: '', model: 'deepseek-chat' }],
      ['缺 model 字段', { provider: 'deepseek' }],
      ['provider 非字符串', { provider: 1, model: 'deepseek-chat' }],
      ['model 非字符串', { provider: 'deepseek', model: null }],
      ['字符串', 'deepseek/deepseek-chat'],
      ['数组', ['deepseek', 'deepseek-chat']],
      ['null', null],
    ];
    for (const [name, value] of bad) {
      assert.equal(saveOnce({ pets: PETS, whisperModel: value }), null, `whisperModel ${name} must be rejected`);
      assert.equal(saveOnce({ pets: PETS, chatModel: value }), null, `chatModel ${name} must be rejected`);
    }
  });
});

describe('saveUserConfig - Voice subdivision switch (whitelist + transparent transmission reservation)', () => {
  test('Write with the request body (the two switches of the "Voice Broadcast" card on the settings page)', () => {
    const out = saveOnce({ pets: PETS, voiceWhisperEnabled: true, voiceTodoEnabled: true });
    assert.equal(out?.voiceWhisperEnabled, true);
    assert.equal(out?.voiceTodoEnabled, true);
  });

  test('false is a valid value, persist to disk as usual', () => {
    const out = saveOnce({ pets: PETS, voiceWhisperEnabled: false, voiceTodoEnabled: false });
    assert.equal(out?.voiceWhisperEnabled, false, 'false cannot be regarded as "not passed" and passed through.');
    assert.equal(out?.voiceTodoEnabled, false);
  });

  test('The old disk value is transparently transmitted when it has not been transmitted; if it does not exist on the disk, the field is not created out of thin air.', () => {
    const kept = saveOnce({ pets: PETS }, { pets: PETS, voiceWhisperEnabled: true, voiceTodoEnabled: true });
    assert.equal(
      kept?.voiceWhisperEnabled,
      true,
      'The manually modified value on the disk must be retained as it is before being transferred.',
    );
    assert.equal(kept?.voiceTodoEnabled, true);
    const fresh = saveOnce({ pets: PETS }) ?? {};
    assert.equal(
      'voiceWhisperEnabled' in fresh,
      false,
      'It is not allowed to write out of thin air when there is nothing on the disk.',
    );
    assert.equal('voiceTodoEnabled' in fresh, false);
  });

  test('Non-Boolean → overall rejection (host returns 400; the same set of rules as the read side topFieldValid)', () => {
    for (const value of ['true', 1, null, {}, []]) {
      assert.equal(
        saveOnce({ pets: PETS, voiceWhisperEnabled: value }),
        null,
        `voiceWhisperEnabled ${JSON.stringify(value)} must be rejected`,
      );
      assert.equal(
        saveOnce({ pets: PETS, voiceTodoEnabled: value }),
        null,
        `voiceTodoEnabled ${JSON.stringify(value)} must be rejected`,
      );
    }
  });
});

test('Long-term memory works directly with old configurations; settings round-trip save and reject inline credentials', () => {
  const { paths, dir } = pathsWithUser('{}');
  try {
    const main = readAllConfig(paths).main;
    assert.deepEqual(main.chatMemory, DEFAULT_CHAT_MEMORY);
    const chatMemory = { ...DEFAULT_CHAT_MEMORY, backend: 'powercontext', maxHistoryBytes: 6000 };
    const saved = saveUserConfig({ pets: main.pets, chatMemory });
    assert.ok(saved);
    writeFileSync(paths.userFile, JSON.stringify(saved));
    assert.deepEqual(readAllConfig(paths).main.chatMemory, chatMemory);
    assert.equal(saveUserConfig({ pets: main.pets, chatMemory: { ...chatMemory, token: 'fixture' } }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('saveUserConfig - Working status broadcast switch (whitelist + transparent transmission reservation)', () => {
  test('Write with the request body (the fourth switch of the "Voice Broadcast" card on the settings page)', () => {
    const out = saveOnce({ pets: PETS, voiceNotifyEnabled: true });
    assert.equal(out?.voiceNotifyEnabled, true);
  });

  test('false is a valid value, persist to disk as usual', () => {
    const out = saveOnce({ pets: PETS, voiceNotifyEnabled: false });
    assert.equal(out?.voiceNotifyEnabled, false, 'false cannot be regarded as "not passed" and passed through.');
  });

  test('The old disk value is transparently transmitted when it has not been transmitted; if it does not exist on the disk, the field is not created out of thin air.', () => {
    const kept = saveOnce({ pets: PETS }, { pets: PETS, voiceNotifyEnabled: true });
    assert.equal(
      kept?.voiceNotifyEnabled,
      true,
      'The manually modified value on the disk must be retained as it is before being transferred.',
    );
    const fresh = saveOnce({ pets: PETS }) ?? {};
    assert.equal(
      'voiceNotifyEnabled' in fresh,
      false,
      'It is not allowed to write out of thin air when there is nothing on the disk.',
    );
  });

  test('Non-Boolean → Overall rejection (same set of rules as topFieldValid on the read side)', () => {
    for (const value of ['true', 1, null, {}, []]) {
      assert.equal(
        saveOnce({ pets: PETS, voiceNotifyEnabled: value }),
        null,
        `voiceNotifyEnabled ${JSON.stringify(value)} must be rejected`,
      );
    }
  });
});

describe('saveUserConfig ——The number of conversation history items chatMemoryRounds (whitelist + transparent transmission retention)', () => {
  test('Write with the request body (numeric input box of "AI Model and Dialog Context" on the settings page)', () => {
    const out = saveOnce({ pets: PETS, chatMemoryRounds: 9 });
    assert.equal(out?.chatMemoryRounds, 9, 'chatMemoryRounds must be in the whitelist of saveUserConfig');
  });

  test('0 is a valid value (= does not bring history into the context), persist to disk as usual', () => {
    assert.equal(saveOnce({ pets: PETS, chatMemoryRounds: 0 })?.chatMemoryRounds, 0);
  });

  test('Normalized into numbers when persisting to disk ("9" → 9, the same conventions as topFieldValid on the read side)', () => {
    assert.equal(saveOnce({ pets: PETS, chatMemoryRounds: '9' })?.chatMemoryRounds, 9);
  });

  test('The old disk value is transparently transmitted when it has not been transmitted; if it does not exist on the disk, the field is not created out of thin air.', () => {
    const kept = saveOnce({ pets: PETS }, { pets: PETS, chatMemoryRounds: 3 });
    assert.equal(
      kept?.chatMemoryRounds,
      3,
      'The manually modified value on the disk must be retained as it is before being transferred.',
    );
    assert.equal(
      'chatMemoryRounds' in (saveOnce({ pets: PETS }) ?? {}),
      false,
      'It is not allowed to write out of thin air when there is nothing on the disk.',
    );
  });

  test('The request body overwrites the old value on disk (same semantics as the four global switches)', () => {
    const out = saveOnce({ pets: PETS, chatMemoryRounds: 9 }, { pets: PETS, chatMemoryRounds: 3 });
    assert.equal(
      out?.chatMemoryRounds,
      9,
      'The request body takes priority and will not be reversely overwritten by existing',
    );
  });

  test('Invalid value → overall rejection (host returns 400; the same set of rules as the read side topFieldValid)', () => {
    const bad: Array<[string, unknown]> = [
      ['负数', -1],
      ['非数字字符串', 'many'],
      ['对象', { rounds: 5 }],
      ['Infinity', Infinity],
      ['NaN', NaN],
    ];
    for (const [name, value] of bad) {
      assert.equal(saveOnce({ pets: PETS, chatMemoryRounds: value }), null, `${name} must be rejected`);
    }
  });
});

describe('saveUserConfig——The upper limit of the number of dialogue pictures chatImageLimit (whitelist + transparent transmission reservation)', () => {
  test('Write with the request body (numeric input box of "AI Model and Dialog Context" on the settings page)', () => {
    const out = saveOnce({ pets: PETS, chatImageLimit: 8 });
    assert.equal(out?.chatImageLimit, 8, 'chatImageLimit must be in the whitelist of saveUserConfig');
  });

  test('0 is a valid value (= no limit, all sent to the model), persist to disk as usual', () => {
    assert.equal(saveOnce({ pets: PETS, chatImageLimit: 0 })?.chatImageLimit, 0);
  });

  test('Normalize to numbers when persisting to disk ("8" → 8, the same conventions as topFieldValid on the read side)', () => {
    assert.equal(saveOnce({ pets: PETS, chatImageLimit: '8' })?.chatImageLimit, 8);
  });

  test('The old disk value is transparently transmitted when it has not been transmitted; if it does not exist on the disk, the field is not created out of thin air.', () => {
    const kept = saveOnce({ pets: PETS }, { pets: PETS, chatImageLimit: 3 });
    assert.equal(
      kept?.chatImageLimit,
      3,
      'The manually modified value on the disk must be retained as it is before being transferred.',
    );
    assert.equal(
      'chatImageLimit' in (saveOnce({ pets: PETS }) ?? {}),
      false,
      'It is not allowed to write out of thin air when there is nothing on the disk.',
    );
  });

  test('The request body overwrites the old value on disk (same semantics as the four global switches)', () => {
    const out = saveOnce({ pets: PETS, chatImageLimit: 8 }, { pets: PETS, chatImageLimit: 3 });
    assert.equal(
      out?.chatImageLimit,
      8,
      'The request body takes priority and will not be reversely overwritten by existing',
    );
  });

  test('Invalid value → overall rejection (host returns 400; the same set of rules as the read side topFieldValid)', () => {
    const bad: Array<[string, unknown]> = [
      ['负数', -1],
      ['非数字字符串', 'many'],
      ['对象', { n: 3 }],
      ['Infinity', Infinity],
      ['NaN', NaN],
    ];
    for (const [name, value] of bad) {
      assert.equal(saveOnce({ pets: PETS, chatImageLimit: value }), null, `${name} must be rejected`);
    }
  });
});

describe('readAllConfig - Model selection merge (default if missing/invalid fallback to default)', () => {
  const WM = { provider: 'deepseek', model: 'deepseek-chat' };

  test('The built-in default value → can be read when the user layer is not writing (default = empty = follow the current conversation)', () => {
    const merged = readAllConfig(withBase({ whisperModel: WM, chatModel: WM }));
    assert.deepEqual(merged.main.whisperModel, WM);
    assert.deepEqual(merged.main.chatModel, WM);
  });

  test('The user layer writes → overwrites the built-in default', () => {
    const merged = readAllConfig(
      withBase({ whisperModel: WM }, { whisperModel: { provider: 'opencode', model: 'big-model' } }),
    );
    assert.deepEqual(merged.main.whisperModel, { provider: 'opencode', model: 'big-model' });
  });

  test('The user layer wrote an invalid value → fall back to the built-in default (only fill in half / non-character string / non-object)', () => {
    const bad: unknown[] = [
      { provider: 'deepseek', model: '' },
      { provider: '', model: 'deepseek-chat' },
      { provider: 1, model: 'deepseek-chat' },
      'deepseek/deepseek-chat',
      ['deepseek', 'deepseek-chat'],
    ];
    for (const value of bad) {
      const merged = readAllConfig(withBase({ whisperModel: WM }, { whisperModel: value }));
      assert.deepEqual(
        merged.main.whisperModel,
        WM,
        `${JSON.stringify(value)} should fall back to the built-in default`,
      );
    }
  });
});

describe('readAllConfig - Throw lock merge (default if missing/default if invalid)', () => {
  test('The built-in default value → can be read when the user layer is not writing.', () => {
    const merged = readAllConfig(withBase({ confineToScreen: false }));
    assert.equal(merged.main.confineToScreen, false);
  });

  test('The user layer writes true → overwrites the built-in default', () => {
    const merged = readAllConfig(withBase({ confineToScreen: false }, { confineToScreen: true }));
    assert.equal(merged.main.confineToScreen, true);
  });

  test('The user layer wrote an invalid value → fall back to the built-in default', () => {
    const merged = readAllConfig(withBase({ confineToScreen: true }, { confineToScreen: 'yes' }));
    assert.equal(merged.main.confineToScreen, true); // Fall back to default true
  });
});

describe('readAllConfig - Fixed merge of pets (default if missing/invalid fallback to default/instance-by-instance independence)', () => {
  /** Get the nth pet after merging */
  const petAt = (merged: Record<string, Record<string, unknown>>, n = 0): Record<string, unknown> =>
    (merged.main.pets as Record<string, unknown>[])[n];

  test('The built-in default value → can be read when the user layer is not writing (default false = maintain the original behavior)', () => {
    assert.equal(petAt(readAllConfig(withBase({}))).fixedEnabled, false);
  });

  test('The user layer writes true → overwrites the built-in default', () => {
    const merged = readAllConfig(withBase({}, { pets: [{ ...BASE.pets[0], fixedEnabled: true }] }));
    assert.equal(petAt(merged).fixedEnabled, true);
  });

  test('The user layer wrote an invalid value → fall back to the built-in default (warning + default, do not allow dirty values to enter the rendering layer)', () => {
    const merged = readAllConfig(withBase({}, { pets: [{ ...BASE.pets[0], fixedEnabled: 'yes' }] }));
    assert.equal(petAt(merged).fixedEnabled, false);
  });

  test('Per-instance independence: two pets in the same list each take their own values (not entry level, not shared)', () => {
    const merged = readAllConfig(
      withBase(
        {},
        {
          pets: [
            { ...BASE.pets[0], id: 'a', fixedEnabled: true },
            { ...BASE.pets[0], id: 'b', fixedEnabled: false },
          ],
        },
      ),
    );
    const pets = merged.main.pets as Record<string, unknown>[];
    assert.equal(pets.find((p) => p.id === 'a')?.fixedEnabled, true);
    assert.equal(pets.find((p) => p.id === 'b')?.fixedEnabled, false);
  });
});

describe('syncUserConfigFromDefault - Synchronization (built-in default original text is written to the user layer)', () => {
  /** The default file is written to the given original text; the user file is deliberately placed in a subdirectory that does not yet exist (verify that the parent directory is self-created) */
  function fixture(raw: string): { paths: ConfigPaths; dir: string } {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-sync-test-'));
    const paths: ConfigPaths = {
      defaultFile: join(dir, 'default.jsonc'),
      userFile: join(dir, 'dsh-pet', 'main-config.jsonc'),
      petDir: join(dir, 'pet'),
    };
    writeFileSync(paths.defaultFile, raw);
    return { paths, dir };
  }

  test('Copy the original text of the default file byte by byte (retain all comments)', () => {
    const raw = '// 顶部注释\n{\n  "pets": []\n}\n';
    const { paths, dir } = fixture(raw);
    try {
      syncUserConfigFromDefault(paths);
      assert.equal(
        readFileSync(paths.userFile, 'utf8'),
        raw,
        'The user layer must be the original text of the default file (including comments)',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('The user directory does not exist → automatically created (the first synchronization can persist to disk)', () => {
    const { paths, dir } = fixture(JSON.stringify(BASE, null, 2));
    try {
      assert.equal(existsSync(dirname(paths.userFile)), false, 'Prefix: The user directory does not exist');
      syncUserConfigFromDefault(paths);
      assert.equal(existsSync(paths.userFile), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('Finished product after synchronization = no user layer (equivalent to "Delete user configuration")', () => {
    const { paths, dir } = fixture(JSON.stringify(BASE, null, 2));
    try {
      const before = readAllConfig(paths); // No user layer: pure built-in default
      syncUserConfigFromDefault(paths);
      // deepStrictEqual: The value/structure must be exactly the same. Don't look at the key sequence - the user layer
      // will go to mergePets to rebuild the instance, and the key sequence is normalized to id first (pure appearance
      // difference; the measured and confirmed values of the production assets/config.jsonc are exactly the same).
      assert.deepStrictEqual(readAllConfig(paths), before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('The default file is missing → throw an error, and half of the user layer file must not be left (host returns 500)', () => {
    const { paths, dir } = fixture('{}');
    try {
      rmSync(paths.defaultFile, { force: true });
      assert.throws(() => syncUserConfigFromDefault(paths));
      assert.equal(existsSync(paths.userFile), false, 'User level files must not be written out on failure');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * The base of file pet entries - "Global default + type can be overridden".
 *
 * Criteria: The fields listed in GLOBAL_DEFAULT_KEYS (physics / animationWeights / confineToScreen / two picture
 * switches / dialogue action linkage switches / chatImageLimit / chatMemoryRounds / whisperModel / chatModel /
 * eventsRefreshSec, etc.) are user-level "cost / preference / environment / "Rhythm" parameter, if written by the user
 * layer, it will take effect on all entries (including pet pack); if the category file is written by yourself, it will
 * overwrite its own share. The base of the other top-level fields (persona/meme/animation
 * pool/text) is still the built-in default - one persona, one pool, and one meme directory for each
 * type. Writing one copy for each is the meaning of pet pack.
 */
describe('File pet entry - global default (user layer as base) + type can be overridden', () => {
  /** The built-in default must contain all top-level keys: mergeEntry only traverses the keys of base. If the key is missing, the value of the user layer will not flow in. */
  const BASE_FULL: Record<string, unknown> = {
    ...BASE,
    whisperImageEnabled: true,
    chatImageEnabled: true,
    chatAnimationEnabled: true,
    chatImageLimit: 0,
    confineToScreen: false,
    whisperModel: { provider: '', model: '' },
    chatModel: { provider: '', model: '' },
    memes: { 可爱: '卖萌' },
  };
  /** A minimal usable kind file (does not contain any top-level entry-level fields, relies solely on the base) */
  const PACK: Record<string, unknown> = {
    pets: [
      {
        id: 'pig1',
        name: '小猪',
        size: 300,
        balanceEnabled: false,
        display: 'web',
        position: { corner: 'top-left', marginX: 10, marginY: 10 },
      },
    ],
  };

  const rec = (v: unknown): Record<string, unknown> => v as Record<string, unknown>;

  /** Create a set of paths: built-in default = BASE_FULL; optional user layer + a category file; clean the temporary directory after running readAllConfig */
  function merged(opts: {
    overlay?: Record<string, unknown>;
    pack?: Record<string, unknown>;
  }): Record<string, Record<string, unknown>> {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-pack-base-'));
    try {
      const petDir = join(dir, 'pet');
      const paths: ConfigPaths = {
        defaultFile: join(dir, 'default.jsonc'),
        userFile: join(dir, 'main-config.jsonc'),
        petDir,
      };
      writeFileSync(paths.defaultFile, JSON.stringify(BASE_FULL));
      if (opts.overlay) writeFileSync(paths.userFile, JSON.stringify(opts.overlay));
      if (opts.pack) {
        mkdirSync(petDir, { recursive: true });
        writeFileSync(join(petDir, 'pig-config.json'), JSON.stringify(opts.pack));
      }
      return readAllConfig(paths);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test('The user layer writes these fields → category entries are inherited one by one (no longer only the built-in default)', () => {
    const out = merged({
      overlay: {
        physics: { ...(BASE_FULL.physics as Record<string, unknown>), petCollision: true, gravity: 999 },
        animationWeights: { idle: 40, turn: 2, move: 3 },
        confineToScreen: true,
        whisperImageEnabled: false,
        chatImageEnabled: false,
        chatAnimationEnabled: false,
        chatImageLimit: 4,
        chatMemoryRounds: 9,
        whisperModel: { provider: 'p1', model: 'm1' },
        chatModel: { provider: 'p2', model: 'm2' },
        eventsRefreshSec: { balance: 900, whisper: 60 },
      },
      pack: PACK,
    });
    const pig = out.pig;
    assert.equal(rec(pig.physics).petCollision, true, 'physics should inherit the user layer');
    assert.equal(rec(pig.physics).gravity, 999);
    assert.deepEqual(
      pig.animationWeights,
      { idle: 40, turn: 2, move: 3 },
      'animationWeights should inherit the user layer',
    );
    assert.equal(pig.confineToScreen, true);
    assert.equal(pig.whisperImageEnabled, false);
    assert.equal(pig.chatImageEnabled, false);
    assert.equal(pig.chatAnimationEnabled, false, 'chatAnimationEnabled should inherit the user layer');
    assert.equal(pig.chatImageLimit, 4, 'chatImageLimit should inherit the user layer');
    assert.equal(pig.chatMemoryRounds, 9);
    assert.deepEqual(pig.whisperModel, { provider: 'p1', model: 'm1' });
    assert.deepEqual(pig.chatModel, { provider: 'p2', model: 'm2' });
    assert.deepEqual(pig.eventsRefreshSec, { balance: 900, whisper: 60 });
    // Control: The main entry is always the user layer (the behavior remains unchanged)
    assert.equal(rec(out.main.physics).gravity, 999);
    assert.deepEqual(out.main.animationWeights, { idle: 40, turn: 2, move: 3 });
    assert.equal(out.main.chatMemoryRounds, 9);
  });

  test("The type file is written by oneself → overwrites one's own copy; the one that is not written still inherits the user layer", () => {
    const out = merged({
      overlay: {
        physics: { ...(BASE_FULL.physics as Record<string, unknown>), gravity: 999 },
        confineToScreen: true,
        chatMemoryRounds: 9,
        whisperImageEnabled: false,
      },
      pack: {
        ...PACK,
        physics: { ...(BASE_FULL.physics as Record<string, unknown>), gravity: 111 },
        animationWeights: { idle: 5, turn: 5, move: 5 },
        chatMemoryRounds: 2,
        chatImageLimit: 6,
        whisperImageEnabled: true,
      },
    });
    const pig = out.pig;
    assert.equal(rec(pig.physics).gravity, 111, 'I wrote the type myself physics → use my own share');
    assert.deepEqual(
      pig.animationWeights,
      { idle: 5, turn: 5, move: 5 },
      'I wrote the type myself animationWeights → use my own share',
    );
    assert.equal(pig.chatMemoryRounds, 2, 'I wrote the type myself chatMemoryRounds → use my own share');
    assert.equal(pig.chatImageLimit, 6, 'I wrote the type myself chatImageLimit → use my own share');
    assert.equal(pig.whisperImageEnabled, true, 'I wrote the switch myself for the type → use my own share');
    assert.equal(pig.confineToScreen, true, 'The type is not written → still inherit the user layer');
    assert.deepEqual(
      pig.chatModel,
      { provider: '', model: '' },
      'Type not written → Inherit user layer (same value here as default)',
    );
  });

  test('Fields not in the whitelist: the base is still the built-in default (does not inherit the user layer)', () => {
    const out = merged({
      overlay: {
        whisperPrompt: '用户层的人设',
        chatMemoryRounds: 9,
        memes: { 用户图: '用户层的表情包' },
        workStatusTexts: [['用户层的文案']],
      },
      pack: PACK,
    });
    const pig = out.pig;
    assert.equal(
      pig.whisperPrompt,
      BASE.whisperPrompt,
      'persona: Use the built-in default type and do not use the user layer',
    );
    assert.deepEqual(pig.memes, BASE_FULL.memes, 'Emoticon pack: use built-in default for type');
    assert.deepEqual(pig.workStatusTexts, BASE.workStatusTexts, 'Copywriting: use built-in default for categories');
    // Compare: main got the user layer share
    assert.equal(out.main.whisperPrompt, '用户层的人设');
    assert.deepEqual(out.main.memes, { 用户图: '用户层的表情包' });
    // In the same user layer, the whitelist fields are still inherited.
    assert.equal(pig.chatMemoryRounds, 9);
  });

  test('There is no user layer → the type is the built-in default (equivalent to the behavior before the change)', () => {
    const out = merged({ pack: PACK });
    const pig = out.pig;
    assert.deepEqual(pig.physics, BASE_FULL.physics);
    assert.equal(pig.confineToScreen, BASE_FULL.confineToScreen);
    assert.equal(pig.whisperImageEnabled, BASE_FULL.whisperImageEnabled);
    assert.deepEqual(pig.chatModel, BASE_FULL.chatModel);
  });

  test('The user layer wrote an invalid value → skip this field, and the type still uses the built-in default (no error is thrown)', () => {
    const out = merged({ overlay: { physics: { gravity: -1 }, confineToScreen: true }, pack: PACK });
    const pig = out.pig;
    assert.deepEqual(pig.physics, BASE_FULL.physics, 'Illegal physics must not flow into the category base');
    assert.equal(pig.confineToScreen, true, 'Legal fields in the same user layer are inherited as usual');
  });

  test('An invalid value is written in the category file → Fall back to the "user level copy" instead of the built-in default', () => {
    const out = merged({
      overlay: { physics: { ...(BASE_FULL.physics as Record<string, unknown>), petCollision: true } },
      pack: { ...PACK, physics: { gravity: '不是数字' } },
    });
    assert.equal(
      rec(out.pig.physics).petCollision,
      true,
      'Illegal override → fallback base (= user layer), not built-in default',
    );
  });

  test('eventsRefreshSec also enters the global default: written at the user level → type inheritance', () => {
    const out = merged({ overlay: { eventsRefreshSec: { balance: 900, whisper: 60 } }, pack: PACK });
    assert.deepEqual(out.pig.eventsRefreshSec, { balance: 900, whisper: 60 });
    assert.deepEqual(out.main.eventsRefreshSec, { balance: 900, whisper: 60 });
  });

  test('eventsRefreshSec is a whole paragraph replacement: if the type is written as its own, the base will no longer be merged key by key.', () => {
    const out = merged({
      overlay: { eventsRefreshSec: { balance: 900, whisper: 60 } },
      pack: { ...PACK, eventsRefreshSec: { balance: 111 } },
    });
    // The old key-by-key deep merging will make up for the whisper: 60 of the base; the missing keys will be missing if the entire section is replaced.
    assert.deepEqual(out.pig.eventsRefreshSec, { balance: 111 });
  });

  test('eventsRefreshSec write-only half → missing keys will not be filled (consumers each fallback 1800 / 300)', () => {
    const out = merged({ overlay: { eventsRefreshSec: { whisper: 60 } }, pack: PACK });
    assert.deepEqual(out.pig.eventsRefreshSec, { whisper: 60 });
    assert.equal('balance' in rec(out.pig.eventsRefreshSec), false, 'No longer automatically compensate balance');
    assert.deepEqual(out.main.eventsRefreshSec, { whisper: 60 });
  });

  test('Unknown keys in eventsRefreshSec are no longer silently discarded', () => {
    const out = merged({ overlay: { eventsRefreshSec: { balance: 900, foo: 10 } }, pack: PACK });
    assert.deepEqual(out.pig.eventsRefreshSec, { balance: 900, foo: 10 });
  });

  test('eventsRefreshSec The entire section is invalid → Warning + Return to base (type returns to built-in default)', () => {
    for (const bad of [{ whisper: -1 }, { whisper: 'x' }, 'not-an-object', [1, 2]] as unknown[]) {
      const out = merged({ overlay: { eventsRefreshSec: bad }, pack: PACK });
      assert.deepEqual(out.pig.eventsRefreshSec, BASE.eventsRefreshSec, JSON.stringify(bad));
      assert.deepEqual(out.main.eventsRefreshSec, BASE.eventsRefreshSec, JSON.stringify(bad));
    }
  });
});

describe('sliceMemoryRounds —— chatMemoryRounds =0 must be truly without history (to prevent -0 trap regression)', () => {
  // 4 messages = 2 rounds (1 round = 1 question 1 answer)
  const msgs = ['u1', 'a1', 'u2', 'a2'];

  test('rounds =0 → empty list (because slice (-0) returned the entire array and brought all the history)', () => {
    assert.deepEqual(sliceMemoryRounds(msgs, 0), []);
  });

  test('rounds >0 → Truncate the tail rounds wheel', () => {
    assert.deepEqual(sliceMemoryRounds(msgs, 1), ['u2', 'a2']);
    assert.deepEqual(sliceMemoryRounds(msgs, 2), msgs);
  });

  test('rounds exceeds the number of messages → full amount (no more, no less)', () => {
    assert.deepEqual(sliceMemoryRounds(msgs, 99), msgs);
  });

  test('Negative numbers / NaN fallback Press 0 → empty list (does not produce ridiculous slice behavior)', () => {
    assert.deepEqual(sliceMemoryRounds(msgs, -1), []);
    assert.deepEqual(sliceMemoryRounds(msgs, Number.NaN), []);
  });

  test('rounds is a decimal → round down first and then truncate (consistent with Math.floor of memoryRounds)', () => {
    assert.deepEqual(sliceMemoryRounds(msgs, 1.9), ['u2', 'a2']);
  });

  test('rounds =0 and the message list was originally empty → empty', () => {
    assert.deepEqual(sliceMemoryRounds([], 0), []);
  });
});

describe('removeRoundsByTs - Delete by round (two pairs in a round share ts, go in pairs)', () => {
  const msgs = [
    { content: 'u1', ts: 1000 },
    { content: 'a1', ts: 1000 },
    { content: 'u2', ts: 2000 },
    { content: 'a2', ts: 2000 },
  ];

  test('The hit rounds are removed in pairs, and the rest are kept as they are.', () => {
    const r = removeRoundsByTs(msgs, [1000]);
    assert.deepEqual(
      r.messages.map((m) => m.content),
      ['u2', 'a2'],
    );
    assert.equal(r.removed, 2);
  });

  test('ts does not exist → do not change, removed =0', () => {
    const r = removeRoundsByTs(msgs, [999]);
    assert.deepEqual(r.messages, msgs);
    assert.equal(r.removed, 0);
  });

  test('Empty set → delete none (clear is another branch of caller and cannot be expressed by an empty set)', () => {
    const r = removeRoundsByTs(msgs, []);
    assert.equal(r.messages.length, msgs.length);
    assert.equal(r.removed, 0);
  });

  test('All hits → empty list, removed is equal to the original length', () => {
    const r = removeRoundsByTs(msgs, [1000, 2000]);
    assert.deepEqual(r.messages, []);
    assert.equal(r.removed, 4);
  });
});
