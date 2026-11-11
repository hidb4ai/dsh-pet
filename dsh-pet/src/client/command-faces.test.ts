/**
 * Contract test of host command face patch - verify all prerequisites of "package `commandUi.candidates` ". DSH does
 * not have an official entry point for assigning icons to the third-party host command (`CommandDefinition` has no
 * icon field, `CommandDecoration` only recognizes ui, and `candidates()` only recognizes the whitelist of 6
 * first-party packages). This plugin can only rely on the "own attribute masking prototype method" to make up for the
 * problem. The failure is manifested in the menu having no icon instead of an error, and it is prone to silent
 * degradation after upgrading. Each premise must have an assertion handle:
 * - After packaging, the closure of DSH ( `(s, r) => this.candidates(s, r)` ) can get the processed rows;
 * - Commands without faces, non-array returns, and non-object elements will be released as they are;
 * - The rows DSH gave to icon will not be overwritten; label will be taken every time (the language switch will take
 * effect in the next round);
 * - When the mapping logic throws an error, the original row will be returned, but original's own errors will not be
 * swallowed;
 * - If `candidates` is missing, it will not be installed at all; dispose can be restored. Running method: node --
 * experimental-strip-types --test src/client/command-faces.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { installCommandFaces, type CommandFace, type CommandUiLike } from './command-faces.ts';

/** Menu candidate rows (only these fields are concerned in the test). */
type Row = Record<string, unknown>;

/**
 * Key form of `CommandUiRuntime` that replicates dsh-client-ui-commands: `candidates` is a prototype method (not an
 * instance field), so its own attributes can obscure it.
 */
class FakeCommandUi {
  rows: unknown[];
  /** The number of times original was actually called (verifying that the wrapper was indeed forwarded). */
  calls = 0;
  /** The actual parameters received by original (verify that the package is transparently transmitted to session / req). */
  lastArgs: unknown[] = [];

  constructor(rows: unknown[]) {
    this.rows = rows;
  }

  async candidates(session: unknown, req: unknown): Promise<unknown> {
    this.calls += 1;
    this.lastArgs = [session, req];
    return this.rows;
  }
}

/** Rewrite the writing method of DSH register source: the closure takes `candidates` from the instance at runtime. */
function sourceOf(ui: FakeCommandUi): { candidates: (s: unknown, r: unknown) => Promise<unknown> } {
  return { candidates: (session: unknown, req: unknown) => ui.candidates(session, req) };
}

/** Walk through the closure path of DSH and get back the rows. */
async function rowsOf(source: { candidates: (s: unknown, r: unknown) => Promise<unknown> }): Promise<Row[]> {
  return (await source.candidates({}, {})) as Row[];
}

/** Fake icon component: the type is `ComponentType<IconProps>`, the test does not render it. */
const ICON: CommandFace['icon'] = () => null;

/** Fixed title faces. */
function face(label: string): CommandFace {
  return { label: () => label, icon: ICON };
}

/**
 * Temporarily take over `console.warn` and return the collected messages and restore function. Warnings on the downgrade
 * path must be assertions (otherwise the "silent failure" section will not be guarded) and should not pollute the test
 * output.
 */
function captureWarn(): { messages: string[]; restore: () => void } {
  const messages: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    messages.push(args.map((arg) => String(arg)).join(' '));
  };
  return {
    messages,
    restore: () => {
      console.warn = original;
    },
  };
}

describe('installCommandFaces —— Packaging commandUi.candidates', () => {
  test('After installing the patch, the line obtained by the closure of DSH contains label and icon', async () => {
    const ui = new FakeCommandUi([{ name: 'chat' }, { name: 'other' }]);
    const source = sourceOf(ui);
    const dispose = installCommandFaces(ui, new Map([['chat', face('对话')]]));

    const rows = await rowsOf(source);
    assert.equal(rows[0].label, '对话');
    assert.equal(rows[0].icon, ICON);
    // Commands without faces remain unchanged.
    assert.equal(rows[1].label, undefined);
    assert.equal(rows[1].icon, undefined);
    // The package is indeed forwarded to the original method, and the parameters are transparently transmitted as they are.
    assert.equal(ui.calls, 1);
    assert.deepEqual(ui.lastArgs, [{}, {}]);

    dispose();
  });

  test('It installs its own attributes, thus covering the prototype method (this is the premise of the entire mechanism)', () => {
    const ui = new FakeCommandUi([]);
    const before = ui.candidates;
    assert.equal(Object.prototype.hasOwnProperty.call(ui, 'candidates'), false);

    const dispose = installCommandFaces(ui, new Map());
    assert.notEqual(ui.candidates, before);
    assert.equal(Object.prototype.hasOwnProperty.call(ui, 'candidates'), true);

    dispose();
  });

  test('label Each candidate polling is taken now - the language switch takes effect when the next round of menu is opened', async () => {
    const ui = new FakeCommandUi([{ name: 'chat' }]);
    const source = sourceOf(ui);
    let lang = 'zh';
    const dispose = installCommandFaces(
      ui,
      new Map([['chat', { label: () => (lang === 'zh' ? '对话' : 'Chat'), icon: ICON }]]),
    );

    assert.equal((await rowsOf(source))[0].label, '对话');
    lang = 'en';
    assert.equal((await rowsOf(source))[0].label, 'Chat');

    dispose();
  });

  test('The row DSH has already given to icon will not be overwritten (it will automatically give way after official support in the future)', async () => {
    const official = () => null;
    const ui = new FakeCommandUi([{ name: 'chat', icon: official, label: '官方标题' }]);
    const source = sourceOf(ui);
    const dispose = installCommandFaces(ui, new Map([['chat', face('对话')]]));

    const row = (await rowsOf(source))[0];
    assert.equal(row.icon, official);
    assert.equal(row.label, '官方标题');

    dispose();
  });

  test('Return to the original row when the mapping logic throws an error (the menu will not be broken)', async () => {
    const ui = new FakeCommandUi([{ name: 'chat', description: '来自宿主' }]);
    const source = sourceOf(ui);
    const boom: CommandFace = {
      label: () => {
        throw new Error('label 炸了');
      },
      icon: ICON,
    };
    const warn = captureWarn();
    const dispose = installCommandFaces(ui, new Map([['chat', boom]]));

    const rows = await rowsOf(source);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'chat');
    assert.equal(rows[0].label, undefined);
    assert.equal(rows[0].description, '来自宿主');
    // The downgrade must leave traces, otherwise the "silent failure" will be left unattended.
    assert.equal(warn.messages.length, 1);
    assert.match(warn.messages[0], /using the original menu item/);
    assert.match(warn.messages[0], /label 炸了/);

    dispose();
    warn.restore();
  });

  test("Do not swallow original's own error (DSH already has source-failed fallback)", async () => {
    const ui = new FakeCommandUi([]);
    (ui as unknown as { candidates: () => Promise<unknown> }).candidates = async () => {
      throw new Error('DSH 自己的错');
    };
    const source = sourceOf(ui);
    installCommandFaces(ui, new Map([['chat', face('对话')]]));

    await assert.rejects(() => source.candidates({}, {}), /DSH 自己的错/);
  });

  test('Non-array return values are released as they are (don’t guess the return shape of DSH)', async () => {
    const ui = new FakeCommandUi([]);
    (ui as unknown as { candidates: () => Promise<unknown> }).candidates = async () => 'nope';
    const source = sourceOf(ui);
    installCommandFaces(ui, new Map([['chat', face('对话')]]));

    assert.equal(await source.candidates({}, {}), 'nope');
  });

  test('Non-object elements in the array are released as they are', async () => {
    const ui = new FakeCommandUi([null, 42, 'x', { name: 'chat' }]);
    const source = sourceOf(ui);
    const dispose = installCommandFaces(ui, new Map([['chat', face('对话')]]));

    const rows = await rowsOf(source);
    assert.deepEqual(rows.slice(0, 3), [null, 42, 'x']);
    assert.equal(rows[3].label, '对话');

    dispose();
  });

  test('candidates is missing → not installed at all, only warning', () => {
    const ui: CommandUiLike = {};
    const warn = captureWarn();
    const dispose = installCommandFaces(ui, new Map([['chat', face('对话')]]));

    assert.equal(ui.candidates, undefined);
    assert.equal(typeof dispose, 'function');
    assert.equal(warn.messages.length, 1);
    assert.match(warn.messages[0], /commandUi\.candidates missing/);

    dispose();
    warn.restore();
  });

  test('dispose restores the original method (the closure re-fetches the unprocessed rows)', async () => {
    const ui = new FakeCommandUi([{ name: 'chat' }]);
    const source = sourceOf(ui);
    const dispose = installCommandFaces(ui, new Map([['chat', face('对话')]]));
    assert.equal((await rowsOf(source))[0].label, '对话');

    dispose();
    assert.equal((await rowsOf(source))[0].label, undefined);
  });

  test('dispose only restores its own share - the packaging of latecomers will not be erased', () => {
    const ui = new FakeCommandUi([{ name: 'chat' }]);
    const first = installCommandFaces(ui, new Map([['chat', face('第一层')]]));
    const patchedFirst = ui.candidates;
    const second = installCommandFaces(ui, new Map([['chat', face('第二层')]]));
    const patchedSecond = ui.candidates;

    // First layer first dispose: At this time, the instance is the second layer and should not be wiped as a prototype method
    first();
    assert.equal(ui.candidates, patchedSecond);

    // The second layer dispose: restore to the first layer (not the prototype method); the first layer then dispose before returning to the prototype
    second();
    assert.equal(ui.candidates, patchedFirst);
    first();
  });

  test('When two layers of packaging are superimposed, the outer layer does not cover the faces that have been set in the inner layer (icon short-circuit also takes effect)', async () => {
    const ui = new FakeCommandUi([{ name: 'chat' }]);
    const first = installCommandFaces(ui, new Map([['chat', face('第一层')]]));
    const second = installCommandFaces(ui, new Map([['chat', face('第二层')]]));

    // The inner layer runs first, and there is already icon on the line → the short-circuit rule of the outer layer allows it to be passed as it is, so the title remains the inner layer.
    assert.equal((await rowsOf(sourceOf(ui)))[0].label, '第一层');

    second();
    first();
  });
});
