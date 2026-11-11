/**
 * DSH 插件的本机记忆生命周期：复用准备流程，卸载时等待子进程退出。
 * 独立应用由自身入口管理记忆，不能再次认领同一个数据库。
 */
import { dirname } from 'node:path';
import { createSetup, type SetupService } from '../../standalone/setup.ts';
import { memoryConfigBinding, type MemoryConfigStore } from './memory-binding.ts';
import type { HostContext } from './context.ts';
import type { HostSetup } from './setup.ts';

/** 准备流程不读取或写入 DSH 的聊天凭据。 */
export function registerManagedMemory(
  ctx: HostContext,
  host: Pick<HostSetup, 'userRoot' | 'optionalService'>,
  config: () => MemoryConfigStore,
): SetupService | undefined {
  if (host.optionalService('standaloneAi')) return;
  const setup = createSetup(
    dirname(host.userRoot),
    undefined,
    memoryConfigBinding({
      read: () => config().read(),
      update: (change) => config().update(change),
    }),
  );
  ctx.effect(() => () => setup.dispose(), 'dsh-pet: managed PowerContext');
  return setup;
}
