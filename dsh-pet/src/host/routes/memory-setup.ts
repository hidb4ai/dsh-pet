/** DSH 本机记忆管理接口；模型凭据只进入准备流程，不回显。 */
import { setupErrorCode } from '../../standalone/setup-models.ts';
import { readAllConfig } from '../config.ts';
import type { RouteHandler } from './types.ts';
import { failResult, methodNotAllowed, okResult } from './result.ts';

/** 返回准备进度与落盘的记忆绑定，供设置页同步表单。 */
export const handleMemorySetupRoutes: RouteHandler = async (deps, { rest, method, body }) => {
  if (rest !== 'powercontext/setup') return;
  if (method !== 'GET' && method !== 'POST') return methodNotAllowed();
  const setup = deps.memorySetup;
  if (!setup)
    return method === 'GET'
      ? okResult({ ok: true, available: false })
      : failResult('unsupported', 'memory_setup_unavailable');
  if (method === 'POST') {
    try {
      const input = JSON.parse(body ?? 'null');
      if (input?.action === 'models' && setup.discover) return okResult(await setup.discover(input));
      setup.submit(input);
    } catch (error) {
      return failResult('bad-request', error instanceof SyntaxError ? 'invalid_setup' : setupErrorCode(error));
    }
  }
  const main = readAllConfig(deps.configPaths).main;
  return okResult({
    ok: true,
    ...(setup.status() as Record<string, unknown>),
    available: true,
    binding: { chatMemory: main.chatMemory, chatMemoryRounds: main.chatMemoryRounds },
  });
};
