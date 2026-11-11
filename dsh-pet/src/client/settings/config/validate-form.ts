/**
 * Setting page form verification: before saving, block "host must be a combination of 400" and give a red text prompt.
 * Rules correspond to hosts one-to-one (invalid combination of hosts returns 400, which is equivalent to pushing the
 * error to a network round trip before discovering it). Pure function: only look at the passed in value, return the
 * copy key of the first unqualified item, and the order is the prompt priority.
 * @module dsh-pet/src/client/settings/config/validate-form
 */
import { FONT_PRESETS, FONT_SIZE_MAX, FONT_SIZE_MIN } from '../../../shared/fonts.ts';
import { isValidSizePercent } from '../../../shared/pet-size.ts';
import type { FontConfig, ModelSelection, Pet, PhysicsParams } from '../../../shared/types.ts';

/** The copy key returned when verification fails. */
export type InvalidKey =
  'invalid' | 'invalidPhysics' | 'invalidModel' | 'invalidChatMemory' | 'invalidChatImageLimit' | 'invalidFont';

/** All form values to be verified before saving. */
export interface FormValues {
  pets: readonly Pet[];
  physics: PhysicsParams;
  whisperModel: ModelSelection;
  chatModel: ModelSelection;
  chatMemory: number;
  chatImageLimit: number;
  font: FontConfig;
}

/** Is "service provider + model" valid? Either leave both blank (follow the current conversation), or both are not blank. */
export const modelPairValid = (model: ModelSelection): boolean =>
  (model.provider.trim() === '') === (model.model.trim() === '');

/** Pet: The width must be a positive number, the percentage defaults or a number not less than 1, and the two offsets must be finite numbers (negative numbers are valid, and the pet can be pushed out of the screen). */
const petValid = (pet: Pet): boolean =>
  Number.isFinite(pet.size) &&
  pet.size > 0 &&
  (pet.sizePercent === undefined || isValidSizePercent(pet.sizePercent)) &&
  Number.isFinite(pet.position.marginX) &&
  Number.isFinite(pet.position.marginY);

/** Physical parameters: Rules with the same name as host `physicsValid`, the client only overrides numeric fields (Boolean items are provided by host fallback). */
const physicsValid = (physics: PhysicsParams): boolean =>
  Number.isFinite(physics.gravity) &&
  physics.gravity >= 0 &&
  Number.isFinite(physics.restitution) &&
  physics.restitution >= 0 &&
  physics.restitution <= 1 &&
  Number.isFinite(physics.groundFriction) &&
  physics.groundFriction >= 0 &&
  Number.isFinite(physics.throwPower) &&
  physics.throwPower > 0;

/** Font: The type must be in the default white list, and the font size must be in the closed range. */
const fontValid = (font: FontConfig): boolean =>
  FONT_PRESETS.some((preset) => preset.id === font.family) &&
  Number.isFinite(font.size) &&
  font.size >= FONT_SIZE_MIN &&
  font.size <= FONT_SIZE_MAX;

/**
 * Verify the entire form.
 *
 * @param values - All values to be submitted before saving.
 * @returns The copy key of the first unqualified item; all qualified items return `null` .
 */
export function validateForm(values: FormValues): InvalidKey | null {
  if (!values.pets.every(petValid)) return 'invalid';
  if (!physicsValid(values.physics)) return 'invalidPhysics';
  // Filling in only half (selecting the service provider but not the model, or vice versa) is invalid.
  if (!modelPairValid(values.whisperModel) || !modelPairValid(values.chatModel)) return 'invalidModel';
  if (!Number.isFinite(values.chatMemory) || values.chatMemory < 0) return 'invalidChatMemory';
  // 0 = No limit, valid.
  if (!Number.isFinite(values.chatImageLimit) || values.chatImageLimit < 0) return 'invalidChatImageLimit';
  if (!fontValid(values.font)) return 'invalidFont';
  return null;
}
