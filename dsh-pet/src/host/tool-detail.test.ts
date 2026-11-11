/**
 * Single test of host tool detail mapping - verify five things: ① The copy is a candidate sentence in the data table
 * (pick a sentence at random), and must have a specific object name; ② The command is checked according to
 * "command/command + subcommand"; commands without semantics (npm / python / node) fallback; ③ Compound command ( `;`
 * `|` `&&` newline) will always return null, allowing the front-end fallback configuration copy; ④ Security
 * boundaries: command parameters (including credentials) do not appear on the screen, are oversized arguments are not
 * parsed, are invalid JSON are not thrown, and the name on the prototype chain does not hit the table; ⑤ Tools that
 * should not appear ( todo_write / ask_user_question / goal series) → null.
 *
 * Running method: node --experimental-strip-types --test src/host/tool-detail.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { toolDetailFromEvent } from './tool-detail.ts';
import { TASK_TEXT_MAX } from './work-status.ts';

/** Create a tool/call event; the object passed by args will be serialized into a JSON character string (the same shape as the host event) */
function call(name: string, args?: Record<string, unknown>): Parameters<typeof toolDetailFromEvent>[0] {
  return { data: { name, arguments: args === undefined ? undefined : JSON.stringify(args) } };
}

/** Copywriters are randomly selected, and assertions can only fall within the candidate set. */
function oneOf(actual: string | null, expected: readonly string[]): void {
  assert.ok(actual !== null && expected.includes(actual), `Got ${String(actual)}, not in [ ${expected.join(' | ')} ]`);
}

describe('Tool text - 3 sentence candidates for each tool, with specific objects', () => {
  test('read: The file name must appear in the sentence', () => {
    oneOf(toolDetailFromEvent(call('read', { file_path: 'a.ts' })), [
      '翻翻 a.ts 看看嘛',
      'a.ts 里面写了啥呢',
      '我先瞅瞅 a.ts 哈',
    ]);
  });

  test('read_image: Use different text from read (picture ≠ text)', () => {
    oneOf(toolDetailFromEvent(call('read_image', { file_path: 'logo.png' })), [
      '这 logo.png 长啥样呀',
      '让我瞧瞧 logo.png 呗',
      'logo.png 是张什么图呢',
    ]);
  });

  test('edit: long path compressed into file name', () => {
    oneOf(toolDetailFromEvent(call('edit', { file_path: 'D:\\Projects\\Web\\pet\\dsh-pet\\src\\host\\index.ts' })), [
      'index.ts 得改改啦',
      '我来动动 index.ts 哦',
      'index.ts 这里要修一下',
    ]);
  });

  test('write / glob / grep / present / skill / web_search / web_fetch can all make sentences', () => {
    oneOf(toolDetailFromEvent(call('write', { file_path: 'notes.md' })), [
      '写点东西到 notes.md',
      'notes.md 马上写出来',
      '给 notes.md 添点料',
    ]);
    oneOf(toolDetailFromEvent(call('glob', { pattern: '*.ts' })), [
      '*.ts 都躲哪儿了呢',
      '找找 *.ts 在不在',
      '*.ts 藏在哪个角落呀',
    ]);
    oneOf(toolDetailFromEvent(call('grep', { pattern: 'TODO' })), [
      'TODO 藏哪儿了呢',
      '搜搜 TODO 在哪',
      '哪儿有 TODO 呀',
    ]);
    oneOf(toolDetailFromEvent(call('present', { files: [{ path: 'a.png' }] })), [
      '给你看 a.png 哦',
      'a.png 拿来给你瞧瞧',
      '喏，a.png 在这儿',
    ]);
    oneOf(toolDetailFromEvent(call('skill', { name: 'git-commit' })), [
      '学个新本事 git-commit',
      'git-commit 这招得记住',
      '把 git-commit 学起来',
    ]);
    oneOf(toolDetailFromEvent(call('web_search', { queries: ['electron'] })), [
      '我去查查 electron',
      'electron 得搜搜才知道',
      '上网问问 electron 吧',
    ]);
    oneOf(toolDetailFromEvent(call('web_fetch', { url: 'https://github.com/x/y' })), [
      '去 github.com 瞅瞅有啥',
      'github.com 这页我翻翻',
      '看看 github.com 上写了啥',
    ]);
  });

  test('workflow: The entire sentence can be produced without an object (no target is required)', () => {
    oneOf(toolDetailFromEvent(call('workflow')), ['把活排个序，开工咯', '几件事一起安排上', '按顺序一件件来']);
  });

  test('Unable to get the target → null (does not overwrite existing copy, nor spit out half a sentence)', () => {
    assert.equal(toolDetailFromEvent(call('read')), null);
    assert.equal(toolDetailFromEvent(call('edit', {})), null);
  });
});

describe('pwsh ——Command/subcommand table lookup', () => {
  test('Semantic command: cd / git table movement', () => {
    oneOf(toolDetailFromEvent(call('pwsh', { command: 'cd D:\\Projects\\Web\\pet' })), [
      '先把位置挪一挪',
      '切到那个目录去',
      '挪个地方继续干活',
    ]);
    oneOf(toolDetailFromEvent(call('pwsh', { command: 'git status -s' })), [
      '看看现在改了些什么',
      '查查工作区干不干净',
      '目前是啥状况呢',
    ]);
    oneOf(toolDetailFromEvent(call('pwsh', { command: 'git push origin main' })), [
      '该推上去了吧，我来',
      '推送一下，交给我',
      '该让远端知道了',
    ]);
    oneOf(toolDetailFromEvent(call('pwsh', { command: 'git log --oneline -3' })), [
      '让我康康你的提交历史',
      '翻翻最近都提交了啥',
      '看看这些天干了什么',
    ]);
  });

  test('git misses subcommand → use general git text', () => {
    oneOf(toolDetailFromEvent(call('pwsh', { command: 'git frobnicate' })), [
      '折腾折腾 git 仓库',
      '跟 git 打个交道',
      'git 这边动一动',
    ]);
  });

  test('Command without semantics (npm / python / node) → fallback, with command name', () => {
    oneOf(toolDetailFromEvent(call('pwsh', { command: 'npm test' })), [
      '跑一下 npm 咯',
      'npm 跑起来了',
      '让 npm 干点活',
    ]);
    oneOf(toolDetailFromEvent(call('pwsh', { command: 'python train.py --epochs 10' })), [
      '跑一下 python 咯',
      'python 跑起来了',
      '让 python 干点活',
    ]);
    oneOf(toolDetailFromEvent(call('pwsh', { command: 'node script.js' })), [
      '跑一下 node 咯',
      'node 跑起来了',
      '让 node 干点活',
    ]);
  });
});

describe('Compound command - no guessing, fallback configuration copy', () => {
  test('Semicolon / pipe / && / newline all return null', () => {
    assert.equal(toolDetailFromEvent(call('pwsh', { command: 'cd D:\\x; npx prettier --write a.ts' })), null);
    assert.equal(toolDetailFromEvent(call('pwsh', { command: 'git status | head -5' })), null);
    assert.equal(toolDetailFromEvent(call('pwsh', { command: 'cd D:\\x && npm test' })), null);
    assert.equal(toolDetailFromEvent(call('pwsh', { command: 'npm test\nnpm run lint' })), null);
    assert.equal(toolDetailFromEvent(call('pwsh', { command: 'echo a || echo b' })), null);
  });

  test('The compound command starting with character string literal → null', () => {
    const real =
      '"== 18016 监听 =="; (Get-NetTCPConnection -LocalPort 18016 -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count';
    assert.equal(toolDetailFromEvent(call('pwsh', { command: real })), null);
  });
});

describe('Security and Robustness', () => {
  test('Command parameters (including credentials) never appear on the screen', () => {
    const detail = toolDetailFromEvent(
      call('pwsh', { command: 'curl -H "Authorization: Bearer sk-live-secret" https://api.example.com' }),
    );
    oneOf(detail, ['去问问接口有没有人', '敲敲门看看通不通', '请求一下那个地址']);
    assert.equal(String(detail).includes('sk-live-secret'), false, 'Credentials do not appear on the screen');
    assert.equal(String(detail).includes('api.example.com'), false, 'Parameters do not appear on the screen');
  });

  test('Invalid event shape / invalid JSON / non-object → null, not thrown', () => {
    assert.equal(toolDetailFromEvent(null), null);
    assert.equal(toolDetailFromEvent({}), null);
    assert.equal(toolDetailFromEvent({ data: { name: 123 } }), null);
    assert.equal(toolDetailFromEvent({ data: { name: 'edit', arguments: '{not json' } }), null);
    assert.equal(toolDetailFromEvent({ data: { name: 'edit', arguments: '[]' } }), null);
  });

  test('The name on the prototype chain does not hit the table: constructor / toString / __proto__ is treated as unknown', () => {
    for (const name of ['constructor', 'toString', '__proto__', 'valueOf']) {
      assert.equal(toolDetailFromEvent(call(name)), '这工具是干嘛的', name);
    }
    oneOf(toolDetailFromEvent(call('pwsh', { command: 'constructor' })), [
      '跑一下 constructor 咯',
      'constructor 跑起来了',
      '让 constructor 干点活',
    ]);
    // The same is true for the command list: `git constructor` hits the general git copy, and `constructor` is not regarded as a subcommand.
    oneOf(toolDetailFromEvent(call('pwsh', { command: 'git constructor' })), [
      '折腾折腾 git 仓库',
      '跟 git 打个交道',
      'git 这边动一动',
    ]);
  });

  test('arguments is also recognized as a direct object (not a character string)', () => {
    oneOf(toolDetailFromEvent({ data: { name: 'read', arguments: { file_path: 'x/y.ts' } } }), [
      '翻翻 x/y.ts 看看嘛',
      'x/y.ts 里面写了啥呢',
      '我先瞅瞅 x/y.ts 哈',
    ]);
  });

  test('Oversized arguments (write with the entire file content) is not parsed → null', () => {
    const huge = JSON.stringify({ file_path: 'a.ts', content: 'x'.repeat(70 * 1024) });
    assert.equal(toolDetailFromEvent({ data: { name: 'write', arguments: huge } }), null);
  });

  test('Output never exceeds TASK_TEXT_MAX + 1 (ellipsis)', () => {
    const cases = [
      call('read', { file_path: 'x'.repeat(200) }),
      call('web_search', { queries: ['长'.repeat(200)] }),
      call('frobnicate'),
      call('pwsh', { command: 'a'.repeat(200) }),
    ];
    for (const event of cases) {
      const detail = toolDetailFromEvent(event);
      assert.notEqual(detail, null);
      assert.ok(Array.from(String(detail)).length <= TASK_TEXT_MAX + 1, `Extra long: ${String(detail)}`);
    }
  });
});

describe('The target is too long - change the atmosphere without a name fallback', () => {
  test('The regex of grep is too long (the one in the live screenshot) → Do not insert sentences into it', () => {
    assert.equal(
      toolDetailFromEvent(call('grep', { pattern: 'WORK_STATE_GAP_MS|busyFlip|workFlushTimer' })),
      '到处翻翻看',
    );
  });

  test('Filename too long (more than 20 code points) → fallback sentence for the tool', () => {
    assert.equal(toolDetailFromEvent(call('read', { file_path: 'work-status-lifecycle.test.ts' })), '翻翻代码看看');
    assert.equal(
      toolDetailFromEvent(call('read_image', { file_path: 'some-very-long-image-name.png' })),
      '看看这张图是啥',
    );
  });

  test('Boundary: 20 yard point hold, 21 yard point fallback', () => {
    const twenty = 'a'.repeat(20);
    oneOf(toolDetailFromEvent(call('read', { file_path: twenty })), [
      `翻翻 ${twenty} 看看嘛`,
      `${twenty} 里面写了啥呢`,
      `我先瞅瞅 ${twenty} 哈`,
    ]);
    assert.equal(toolDetailFromEvent(call('read', { file_path: 'a'.repeat(21) })), '翻翻代码看看');
  });

  test('Command name is too long → fallback without name', () => {
    assert.equal(toolDetailFromEvent(call('pwsh', { command: 'Get-NetTCPConnectionDetail' })), '跑一个命令咯');
  });

  test('Short command names are still displayed on the screen (npm / python are informative)', () => {
    oneOf(toolDetailFromEvent(call('pwsh', { command: 'npm test' })), [
      '跑一下 npm 咯',
      'npm 跑起来了',
      '让 npm 干点活',
    ]);
  });
});

describe('fallback and skip', () => {
  test('Unknown tool → A casual sentence, without reporting the tool name', () => {
    assert.equal(toolDetailFromEvent(call('frobnicate')), '这工具是干嘛的');
  });

  test('Tools whose semantics have been expressed elsewhere → null (more specific copy is not allowed to be obscured)', () => {
    for (const name of [
      'todo_write',
      'ask_user_question',
      'update_goal',
      'get_goal',
      'create_goal',
      'exit_plan_mode',
    ]) {
      assert.equal(toolDetailFromEvent(call(name, { action: 'complete' })), null, name);
    }
  });
});
