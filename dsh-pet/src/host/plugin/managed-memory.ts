/**
 * The native memory lifecycle of the DSH plugin: reuse the preparation process, and wait for the child process to
 * exit when unmounting. A stand-alone application manages its memory through its own entry point and cannot claim the
 * same database again.
 */
import { dirname } from 'node:path';
import { createSetup, type SetupService } from '../../standalone/setup.ts';
import { memoryConfigBinding, type MemoryConfigStore } from './memory-binding.ts';
import type { HostContext } from './context.ts';
import type { HostSetup } from './setup.ts';

/** The prepare process does not read or write the chat credentials for DSH. */
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
