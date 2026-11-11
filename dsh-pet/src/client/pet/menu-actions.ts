/**
 * Action dispatch of right-click menu: Translate menu leaves (built-in actions, third-party items, display position,
 * playback request animation) into a side effect. Only "what happens after clicking" is done, no menu is built, no
 * floating layer positioning and switching timing are ignored - those belong to the right-click entry point.
 * Dependencies are injected with value functions to avoid capturing state snapshots during rendering.
 * @module dsh-pet/src/client/pet/menu-actions
 */
import { isNoMirrorAnimation, isSleepAllowedAction } from '../../shared/menu.ts';
import type { MenuLeaf } from '../../shared/menu.ts';
import { ROUTE_PATH } from '../../shared/constants.ts';
import type { Animations } from '../../shared/types.ts';
import { postAction } from '../../shared/state.ts';
import { setMenuClick } from '../menu-service.ts';

/** Dependencies on menu dispatch. */
export interface MenuActionDeps {
  /** Pet id: reporting, playback request and display position switching are required. */
  petId: string;
  /** The pet's animation pool (movement pool, category mirroring rules all read it). */
  animations: () => Animations;
  /** Is the current orientation to the right (look at it before forcing the text animation to face left). */
  isFacingRight: () => boolean;
  /** Change the orientation to left and synchronize the fact value for the source change. */
  faceLeft: () => void;
  /** Try to initiate a movement; `true` = occupied, `false` = unable to move, character string = action name. */
  tryMove: (preferredName?: string) => boolean | string;
  /** Stop moving and position following. */
  stopMove: () => void;
  /** Stop throwing flight. */
  stopThrow: () => void;
  /** Submit a self-broadcast switch (once semantics). */
  playOnce: (anim: string, playbackId: string | null) => void;
  /** Clear the session location and return to the configuration corner. */
  resetPosition: () => void;
  /** Open the dialogue pop-up window. */
  openChat: () => void;
  /** Open the to-do panel. */
  openTodo: () => void;
  /** Report playback request receipt. */
  report: (playbackId: string, status: 'failed', reason: string) => void;
  /** After the display position is switched, the finished aggregate returned by the host is handed over to the container for re-rendering. */
  applyMerged: (merged: Record<string, Record<string, unknown>>) => void;
  /** A line of warning will be displayed when the action fails (text has its own reasons). */
  warn: (message: string) => void;
  /** Whether you are sleeping: Any "disturbing" actions while sleeping will only play the rejection line and will not be executed. The default is to be awake. */
  sleeping?: () => boolean;
  /** Whether it is frozen by the occupied lock: the semantics of the lock is to hand over control to a third party, and at this time the sleeping gate gives way. The default is that the lock is not held. */
  locked?: () => boolean;
  /** Play a bubble (refuse to use lines, do not change animation). Default = no bomb. */
  say?: (text: string) => void;
  /** Sleep rejection line pool (entry level configuration). Default = silently reject, no text will be played. */
  sleepRefuseTexts?: () => string[];
}

/** Menu actions that are still allowed while sleeping are determined by isSleepAllowedAction of shared/menu (shared by both ends). */

/** Menu action dispatcher. */
export interface MenuActions {
  /**
   * Execute a menu leaf.
   *
   * @param leaf - Menu leaf: built-in action or an animation pending playback request.
   * @param playbackId - This playback request number; self-broadcast animation will not be transmitted.
   * @param keepFacing - Skip the mirroring correction of "text types are forced to face left", and the explicit
   * orientation takes precedence.
   * @param hostInstruction - This is the explicit command written by the host into `pets.<id>.anim` (not the user's
   * menu click):
   * The renderer is not judged to be sleeping, and whether it is released or not is determined by the host gate
   * according to the "lock priority".
   */
  run: (leaf: MenuLeaf, playbackId?: string, keepFacing?: boolean, hostInstruction?: boolean) => void;
}

/** Display position: After writing the configuration, the host returns the resolved configuration and hands it to the container for re-rendering. */
async function switchDisplay(deps: MenuActionDeps, display: string): Promise<void> {
  try {
    const response = await fetch(ROUTE_PATH + '/pet-display', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: deps.petId, display }),
    });
    if (!response.ok) throw new Error('pet-display HTTP ' + response.status);
    const body = (await response.json()) as Record<string, unknown>;
    // The business failure is HTTP 200 + { ok:false , reason }: Just looking at the status code will treat the failure body as the resolved configuration.
    if (body.ok === false) throw new Error('pet-display rejected:' + String(body.reason ?? ''));
    // The response body is the modified aggregate and must be handed to the container; otherwise GET /config will be pulled again, and the old value may be obtained.
    deps.applyMerged(body as Record<string, Record<string, unknown>>);
  } catch (error) {
    deps.warn('[dsh-pet] 显示位置切换失败 ' + (error instanceof Error ? error.message : String(error)));
  }
}

/**
 * Build a menu dispatcher.
 *
 * @param deps - Pet logo, animation pool and various side effect callbacks.
 * @returns single entry point {@link MenuActions.run} .
 */
export function createMenuActions(deps: MenuActionDeps): MenuActions {
  const { petId } = deps;

  /** Action endpoint: POST once, failure leaves only one line warn - the result is sent back by / state, no return value is available here. */
  const fireAction = (route: string, label: string): void => {
    postAction(route)
      .then((ok: boolean) => {
        if (!ok) deps.warn('[dsh-pet] ' + label + '失败 pet=' + petId);
      })
      .catch((error: unknown) => deps.warn('[dsh-pet] ' + label + '异常 pet=' + petId + ' ' + String(error)));
  };

  const run = (leaf: MenuLeaf, playbackId?: string, keepFacing = false, hostInstruction = false): void => {
    // Sleep: Interruption actions will be rejected at the moment of clicking - play a line and nothing will be
    // executed. Putting them at the front is intentional: dialogue pop-ups, to-do panels, and action playback requests
    // are all pure front-end behaviors, and the host gate cannot stop them. hostInstruction: The host writes
    // pets.<id>. The explicit command of anim (third-party locked playback request/external driver) is not judged here
    // - whether it should be released or not is determined by the "lock priority" of the host gate; if the renderer
    // blocks again, it will lose the timing difference of the leaf arrival.
    if (
      !hostInstruction &&
      deps.sleeping?.() === true &&
      deps.locked?.() !== true &&
      !isSleepAllowedAction(leaf.action)
    ) {
      const pool = deps.sleepRefuseTexts?.() ?? [];
      const text = pool[Math.floor(Math.random() * pool.length)];
      if (text !== undefined) deps.say?.(text);
      return;
    }
    if (leaf.action === 'third-party') {
      // The third-party menu item only reports owner, label and the current pet id. The specific action is queried by the register party.
      const owner = leaf.owner ?? '';
      if (owner !== '') {
        // The consumer of the same page (petApi7340.menuEvents) can get it on the spot; HTTP is still reported, and the desktop and old extensions still read the host's copy.
        setMenuClick(owner, leaf.label, petId);
        postAction(ROUTE_PATH + '/menu/click', { owner, label: leaf.label, pet: petId }).catch((error: unknown) =>
          deps.warn('[dsh-pet] 第三方菜单点击上报失败 ' + String(error)),
        );
      }
      return;
    }
    if (leaf.action === 'sleep' || leaf.action === 'wake') {
      // The state of sleeping/waking up is determined by the host: the renderer only sends the intention, and the three animation names and gates are on the host side.
      const route = leaf.action === 'sleep' ? '/sleep' : '/wake';
      console.info('[dsh-pet] Menu ' + (leaf.action === 'sleep' ? 'Sleep' : 'Wake') + ' pet=' + petId);
      fireAction(ROUTE_PATH + route + '?pet=' + encodeURIComponent(petId), leaf.action === 'sleep' ? 'Sleep' : 'Wake');
      return;
    }
    if (leaf.action === 'show-balance') {
      // The action endpoint tells the host to refresh and write / state without the page doing anything.
      console.info('[dsh-pet] Menu balance request pet=' + petId);
      fireAction(ROUTE_PATH + '/balance', '余额刷新动作');
      return;
    }
    if (leaf.action === 'whisper') {
      // Manual whisper: The text is delivered with long polling and is not restricted by whisperEnabled; surface is required and this page is the web page.
      console.info('[dsh-pet] Menu whisper request pet=' + petId + (leaf.image ? ' image=' + leaf.image : ''));
      // The "Picture" menu clicks on a specific picture → add a name to let the host use this picture (the host will
      // return unknown-image if it is not in the pool); the other entry points do not include it, and pictures are
      // still randomly selected according to the configuration. The name may contain spaces and Chinese characters and
      // must be encoded.
      const pic = leaf.image ? '&image=' + encodeURIComponent(leaf.image) : '';
      fireAction(ROUTE_PATH + '/whisper?pet=' + encodeURIComponent(petId) + '&surface=web' + pic, '碎碎念手动触发');
      return;
    }
    if (leaf.action === 'chat') {
      deps.openChat();
      return;
    }
    if (leaf.action === 'todo') {
      deps.openTodo();
      return;
    }
    if (leaf.action === 'set-display') {
      const display = leaf.display;
      if (!display) return;
      console.info('[dsh-pet] Menu display change pet=' + petId + ' display=' + display);
      void switchDisplay(deps, display);
      return;
    }
    if (leaf.action === 'home') {
      // Return to the initial position: stop roaming and throwing, clear the session position, and return to the configuration corner.
      deps.stopThrow();
      deps.stopMove();
      deps.resetPosition();
      return;
    }
    if (!leaf.anim) return;
    const cuePlaybackId = playbackId ?? null;
    // The text type's right-facing posture is mirrored, and it is forced to face left before the playback request; it is skipped when keepFacing is used, and the explicit orientation takes precedence.
    if (!keepFacing && isNoMirrorAnimation(deps.animations().categories, leaf.anim) && deps.isFacingRight()) {
      deps.faceLeft();
    }
    // playback request mobile animation: real displacement, only "which animation to choose" is determined by the menu; when it cannot move within the boundary, it degenerates into pure playback.
    const movies = deps.animations().moves.actions;
    if (movies.some((action) => action.name === leaf.anim)) {
      if (deps.tryMove(leaf.anim) === false) {
        deps.stopMove();
        deps.playOnce(leaf.anim, cuePlaybackId);
      } else if (cuePlaybackId !== null) {
        // The mobile system takes over and the video source is not changed. This playback request will not be played and will be returned to failed.
        deps.report(cuePlaybackId, 'failed', 'busy');
      }
      return;
    }
    deps.stopMove();
    deps.playOnce(leaf.anim, cuePlaybackId);
  };

  return { run };
}
