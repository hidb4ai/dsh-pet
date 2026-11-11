/**
 * Shared layer: Flatten the finished configuration of the host side into a pet list for rendering. It is not
 * responsible for reading, merging and verifying - that is the responsibility of host side readAllConfig. This layer
 * only consumes the results. It does not depend on React / DOM; the host side does not depend on import. Its
 * configuration is self-contained and the rules must be synchronized with this layer. Entry-level fields must be
 * pushed into each instance: multiple instances share the same value for the entry they belong to.
 * @module dsh-pet/src/shared/config
 */
import type { Animations, FontConfig, ModelSelection, Pet, PetDisplay, PhysicsParams, Weights } from './types.ts';

/** Display location whitelist. */
export const PET_DISPLAYS: PetDisplay[] = ['web', 'desktop', 'both', 'none'];

/** Whether this pet participates in browser side rendering. */
export const isWebVisible = (display: PetDisplay): boolean => display === 'web' || display === 'both';

/** Whether this pet participates in desktop mode (Electron transparent window) rendering. */
export const isDesktopVisible = (display: PetDisplay): boolean => display === 'desktop' || display === 'both';

/**
 * Flatten the finished aggregate into a pet list for rendering. Entry-level fields (animations / physics / font, etc.)
 * are shared by the corresponding entry and multiple instances; assetRoot takes the entry key, which is the asset
 * root. Non-main entries are marked with extra: file pets cannot be edited on the settings page and are excluded when
 * saving.
 */
export function flattenConfigPets(merged: Record<string, Record<string, unknown>>): Pet[] {
  const out: Pet[] = [];
  for (const [entry, conf] of Object.entries(merged)) {
    const list = Array.isArray(conf?.pets) ? (conf.pets as Pet[]) : [];
    for (const p of list) {
      out.push({
        ...p,
        animations: conf.animations as Animations | undefined,
        animationWeights: conf.animationWeights as Weights | undefined,
        eventsRefreshSec: conf.eventsRefreshSec as Record<string, number> | undefined,
        physics: conf.physics as PhysicsParams | undefined,
        font: conf.font as FontConfig | undefined,
        confineToScreen: conf.confineToScreen as boolean | undefined,
        workStatusTexts: conf.workStatusTexts as string[][] | undefined,
        // Sleep text: The renderer must be able to "talk/whisper and play rejection lines while asleep", so it
        // must be brought out during filming (the same type of entry-level fields as workStatusTexts: multiple
        // instances share the copy of the entry it belongs to).
        sleepStartTexts: conf.sleepStartTexts as string[] | undefined,
        sleepEndTexts: conf.sleepEndTexts as string[] | undefined,
        sleepRefuseTexts: conf.sleepRefuseTexts as string[] | undefined,
        whisperModel: conf.whisperModel as ModelSelection | undefined,
        chatModel: conf.chatModel as ModelSelection | undefined,
        // Three-piece set of memes: The right-click "Pictures" menu must be grouped according to the list and
        // order in the configuration. The client does not read the disk, so it can only be brought out together when
        // taking pictures; whether the file exists is verified by the host when it is generated (see the pool judgment
        // of host/memes).
        memes: conf.memes as Record<string, string> | undefined,
        chatImageEnabled: conf.chatImageEnabled as boolean | undefined,
        chatAnimationEnabled: conf.chatAnimationEnabled as boolean | undefined,
        chatImageLimit: conf.chatImageLimit as number | undefined,
        assetRoot: entry,
        extra: entry !== 'main',
      });
    }
  }
  return out;
}
