/**
 * Semantic contract testing of pseudo ctx.
 *
 * Why it is worth testing separately: The standalone mode runs the host half of the plugin (`apply`) on this ctx,
 * and `apply` has 9 effect, two self-renewing polling timers, and the sequence dependency of "the last line only pulls
 * up the desktop Helper". Here are the semantics that verify ctx must satisfy (aligned with Cordis) and the downgrade
 * conventions of service doubles - if any of them are not established, the standalone mode will either fail to start,
 * or quietly become "can run but has no pets".
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { modelCandidates } from '../host/model-selection.ts';
import { generateWhisper } from '../host/whisper.ts';
import { STANDALONE_PROVIDER, createStandaloneContext } from './context.ts';
import type { RegisteredRoute, StandaloneLogger } from './context.ts';

/** Silent logger: test only assertion behavior, without refreshing the console */
function silentLogger(): StandaloneLogger & { errors: string[] } {
  const errors: string[] = [];
  return {
    errors,
    info: () => {},
    warn: () => {},
    error: (message: string) => errors.push(message),
    debug: () => {},
  };
}

type Standalone = ReturnType<typeof createStandaloneContext>;

// The members of pseudo ctx have different shapes (`effect` / `on` themselves are functions, and the rest are
// objects). Take them one by one and do not write general index access - if the shape is wrong, I hope it will be
// reported here, not in the plugin.
const effectOf = (context: Standalone): ((fn: () => unknown, label?: string) => unknown) =>
  context.ctx.effect as (fn: () => unknown, label?: string) => unknown;
const onOf = (context: Standalone): (() => unknown) => context.ctx.on as () => unknown;
const commandsOf = (context: Standalone): { register(): unknown } => context.ctx.commands as { register(): unknown };
const webServerOf = (context: Standalone): { port: number; register(spec: RegisteredRoute): unknown } =>
  context.ctx.webServer as { port: number; register(spec: RegisteredRoute): unknown };
const agentOf = (context: Standalone): { currentSelection(): { provider: string; model: string } } =>
  context.ctx.agentDefaultModel as { currentSelection(): { provider: string; model: string } };
const credentialsOf = (context: Standalone): { resolve(ref: unknown): Promise<unknown> } =>
  context.ctx.credentials as { resolve(ref: unknown): Promise<unknown> };
const llmOf = (
  context: Standalone,
): {
  listProviders(): unknown[];
  listModels(provider: string): Promise<unknown[]>;
  // Shape must be AsyncIterable (llm.stream signature of DSH). If it is written as Promise here, it will make the same
  // mistake as the substitute implementation - it is this assertion that makes the type checking of 0.3.4 out of touch
  // with the real contract.
  stream(options: unknown): AsyncIterable<unknown>;
} =>
  context.ctx.llm as {
    listProviders(): unknown[];
    listModels(provider: string): Promise<unknown[]>;
    stream(options: unknown): AsyncIterable<unknown>;
  };

describe('createStandaloneContext - semantics aligned with Cordis', () => {
  test('effect executes synchronously, collects and releases functions; dispose releases in reverse order and waits for asynchronous release', async () => {
    const context = createStandaloneContext({ port: 1, logger: silentLogger() });
    const order: string[] = [];
    const effect = effectOf(context);
    // Synchronous execution: After apply() returns, the route must be already registered (the warehouse's own routes.test.ts also relies on this)
    effect(() => {
      order.push('first');
      return () => {
        order.push('dispose-first');
      };
    });
    effect(() => {
      order.push('second');
      return async () => {
        await Promise.resolve();
        order.push('dispose-second');
      };
    });
    assert.deepEqual(order, ['first', 'second'], 'effect must be run when called');
    await context.dispose();
    assert.deepEqual(
      order,
      ['first', 'second', 'dispose-second', 'dispose-first'],
      'Release order: register later, release first',
    );
  });

  test('effect internal error is only recorded without interruption (this is where the error occurs when the source code form cannot read assets in the package)', () => {
    const logger = silentLogger();
    const context = createStandaloneContext({ port: 1, logger });
    const effect = effectOf(context);
    effect(() => {
      throw new Error('内置默认配置缺失');
    });
    effect(() => 'not-a-disposer');
    assert.equal(context.failures.length, 1);
    assert.match(context.failures[0] ?? '', /内置默认配置缺失/);
    assert.match(
      logger.errors.join('\n'),
      /内置默认配置缺失/,
      'A log must be left in case of failure and cannot be swallowed.',
    );
  });

  test('webServer.register accepts the route and returns the callable object (the plugin treats it as the effect release function)', () => {
    const context = createStandaloneContext({ port: 1, logger: silentLogger() });
    const webServer = webServerOf(context);
    const handler = (): void => {};
    const dispose = webServer.register({ kind: 'prefix', path: '/dsh-pet-7340', handler });
    assert.equal(typeof dispose, 'function');
    assert.equal(context.routes.length, 1);
    assert.equal(context.routes[0]?.path, '/dsh-pet-7340');
    assert.equal(context.routes[0]?.handler, handler);
    (dispose as () => void)();
    assert.equal(context.routes.length, 0, 'route should be removed after release');
  });

  test('webServer.port lazy reading: the service is started first, and then apply is read. When the plugin reads the real port', () => {
    const portRef = { value: 0 };
    const context = createStandaloneContext({ port: () => portRef.value, logger: silentLogger() });
    const webServer = webServerOf(context);
    assert.equal(
      webServer.port,
      0,
      'The port is 0 when not listening (the plug-in delays retry accordingly and will not accidentally open the window)',
    );
    portRef.value = 31234;
    assert.equal(webServer.port, 31234, 'After the monitoring is completed, the plug-in must read the real port');
  });

  test('on() / commands.register() must return callable objects (plugins use them as release functions)', () => {
    const context = createStandaloneContext({ port: 1, logger: silentLogger() });
    assert.equal(typeof onOf(context)(), 'function');
    assert.equal(typeof commandsOf(context).register(), 'function');
  });
});

describe("Downgrade conventions for service doubles - fail explicitly, don't pretend to succeed", () => {
  test('model of currentSelection is empty → the model candidate chain is empty (generation stops at the candidate stage)', () => {
    const context = createStandaloneContext({ port: 1, logger: silentLogger() });
    const selection = agentOf(context).currentSelection();
    assert.equal(selection.provider, STANDALONE_PROVIDER);
    // model must be empty: model-selection.currentModel() takes "Both provider and model are not empty" as the valid
    // condition, empty model makes the candidate chain empty - this is the structural guarantee of "standalone mode
    // does not generate any model calls", rather than relying on if on an endpoint.
    assert.equal(selection.model, '');
    assert.deepEqual(modelCandidates(context.ctx as never, undefined), []);
  });

  test('whisper uses this ctx to get structured failure provider-missing (not connected to the Internet, not writing copy)', async () => {
    const context = createStandaloneContext({ port: 1, logger: silentLogger() });
    const result = await generateWhisper(context.ctx as never, { system: '你是一只桌宠' });
    assert.deepEqual(result, { ok: false, reason: 'provider-missing', message: '当前对话未配置模型' });
  });

  test('The voucher is never available; the list of llm is empty and the generated entry point is async iterable which "fails the iteration"', async () => {
    const context = createStandaloneContext({ port: 1, logger: silentLogger() });
    assert.equal(await credentialsOf(context).resolve('DEEPSEEK_API_KEY'), undefined);
    const llm = llmOf(context);
    assert.deepEqual(llm.listProviders(), []);
    assert.deepEqual(await llm.listModels('deepseek'), []);
    // Contract: stream() returns AsyncIterable (llm.stream signature of DSH), not Promise. The old assertion was
    // written as "stream() itself reject", solidifying the wrong contract: it never went to for await, so it was
    // completely green; while the real integration collapsed as soon as it ran away (TypeError + rejected promise that
    // no one took over).
    const streamed = llm.stream({});
    assert.equal(typeof streamed[Symbol.asyncIterator], 'function');
    await assert.rejects(async () => {
      for await (const chunk of streamed) void chunk;
    }, /no model configured/);
  });
});
