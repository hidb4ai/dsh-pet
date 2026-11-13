/**
 * route distributor: serially tries each field processor in a fixed order, and the first one that gives a response
 * takes effect.
 *
 * Order is semantics - asset route is the end fallback (any unknown path will fall to it and return 400), and must be
 * last; the remaining fields match `rest` exactly and do not overlap each other, and the order only affects
 * readability. URL is not parsed and the business is not judged: `rest` is cut by the caller, and the processors
 * define matching conditions respectively.
 * @module dsh-pet/src/host/routes/index
 */
import type { RouteResult } from '../http.ts';
import { handleAssetsRoutes } from './assets.ts';
import { handleAttachmentRoutes } from './attachment.ts';
import { handleAvatarRoutes } from './avatar.ts';
import { handleBalanceRoutes } from './balance.ts';
import { handleCharacterRoutes } from './character.ts';
import { handleChatRoutes } from './chat.ts';
import { handleMemoryLibraryRoutes } from './memory-library.ts';
import { handleMemorySetupRoutes } from './memory-setup.ts';
import { handleRobotRoutes } from './robot.ts';
import { handleConfigRoutes } from './config/index.ts';
import { handleDesktopRoutes } from './desktop.ts';
import { handleInteractionRoutes } from './interaction.ts';
import { handleMenuRoutes } from './menu.ts';
import { handleMotionRoutes } from './motion.ts';
import { handlePlaybackRoutes } from './playback.ts';
import { handleSessionRoutes } from './session.ts';
import { handleStateRoutes } from './state.ts';
import { handleSleepRoutes } from './sleep.ts';
import { handleTodoRoutes } from './todos.ts';
import { handleVoiceRoutes } from './voice.ts';
import type { PetRouteDeps, RouteHandler } from './types.ts';

/** Processor order: the earlier, the first to match; asset fallback must be at the end. */
const HANDLERS: readonly RouteHandler[] = [
  handleConfigRoutes,
  handleDesktopRoutes,
  handleMenuRoutes,
  handleStateRoutes,
  handleSessionRoutes,
  handleBalanceRoutes,
  handleInteractionRoutes,
  handleMotionRoutes,
  handlePlaybackRoutes,
  handleSleepRoutes,
  handleChatRoutes,
  handleMemoryLibraryRoutes,
  handleMemorySetupRoutes,
  handleRobotRoutes,
  handleAttachmentRoutes,
  handleTodoRoutes,
  handleVoiceRoutes,
  handleAvatarRoutes,
  handleCharacterRoutes,
  handleAssetsRoutes,
];

/**
 * Endpoints to be rejected during sleep: only "disturbance type" is listed.
 *
 * Deliberately use a whitelist instead of a blacklist - newly added endpoints are allowed by default, and maintenance
 * actions (changing display positions, reloading configurations) or drag links (/position, /throw) will not be locked
 * because of forgetting to exclude them; conversely, missing an interfering endpoint will only allow it to be used,
 * and will not cause "pets that won't wake up".
 */
function sleepGated(rest: string, method: string): boolean {
  if (rest === 'chat') return method === 'POST';
  if (rest === 'todos') return method === 'POST' || method === 'DELETE';
  return (
    rest === 'anim' ||
    rest === 'whisper' ||
    rest === 'balance' ||
    rest === 'broadcast' ||
    rest === 'bubble/clear' ||
    rest === 'menu/click' ||
    rest === 'voice'
  );
}

/**
 * The route distributor is constructed from the dependency table (`apply` is only called once).
 * @param deps - route layer dependency (store, path, action function).
 * @returns is a function that receives URL/rest/method/request body/disconnect signal and gives a response.
 */
export function createPetRouter(
  deps: PetRouteDeps,
): (url: URL, rest: string, method: string, body?: string, signal?: AbortSignal) => Promise<RouteResult> {
  return async (url, rest, method, body, signal) => {
    // The sleep gate is placed before distribution: processors in various fields do not need to know about "sleeping"
    // at all, and they will not miss any place. Only requests with ? pet = are blocked (the list of / todos is global
    // and will not be blocked if there is no belonging pet).
    if (sleepGated(rest, method)) {
      const petId = String(url.searchParams.get('pet') ?? '').trim();
      if (petId) {
        const blocked = deps.sleepBlocked(petId, url.searchParams);
        if (blocked) return blocked;
      }
    }
    for (const handle of HANDLERS) {
      const result = await handle(deps, { url, rest, method, body, signal });
      if (result !== undefined) return result;
    }
    // The asset processor will always give a response. This will only be reached when the new domain processor misses the fallback.
    return { kind: 'text', status: 404, body: 'dsh-pet: not found' };
  };
}
