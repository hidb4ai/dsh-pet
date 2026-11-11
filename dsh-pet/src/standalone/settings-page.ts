/**
 * Three static resources of the local settings page: HTML, CSS and script.
 *
 * Only provided by ./server on the native loopback; contains no build steps and does not rely on external CDN. Must
 * always be true: the script reads the token from the address fragment once and then clears the fragment immediately;
 * the page does not inline scripts and styles, so that CSP remains default-src ' none '.
 * @module dsh-pet/src/standalone/settings-page
 */
import { CORNER_SET } from '../host/config/constants.ts';
import { VOICES } from '../host/voice/voices.ts';
import { LOGO_URL } from '../shared/avatar.ts';
import { PET_DISPLAYS } from '../shared/config.ts';
import { ROUTE_SEGMENT } from '../shared/constants.ts';
import { DEFAULT_FONT, FONT_PRESETS } from '../shared/fonts.ts';
import { DEFAULT_PHYSICS } from '../shared/physics.ts';
import { DEFAULT_WEIGHTS } from '../shared/weights.ts';
import { aiScript } from './settings-page/script/ai.ts';
import { avatarScript } from './settings-page/script/avatar.ts';
import { bootScript } from './settings-page/script/boot.ts';
import { coreScript } from './settings-page/script/core.ts';
import { globalsScript } from './settings-page/script/globals.ts';
import { modelPickerScript } from './settings-page/script/model-picker.ts';
import { overlayScript } from './settings-page/script/overlay.ts';
import { petCardScript } from './settings-page/script/pet-card.ts';
import { petsScript } from './settings-page/script/pets.ts';
import { widgetsScript } from './settings-page/script/widgets.ts';
import { settingsPage } from './settings-page/chrome.ts';
import { settingsStyle } from './settings-page/style.ts';
import { setupScript } from './settings-page/script/setup.ts';
import { setupModelsScript } from './settings-page/script/setup-models.ts';

export { settingsPage, settingsStyle };

/** The upper limit of the long side of the avatar: aligned with AVATAR_MAX_SIDE of client/settings/avatar-upload.ts; the page script import is less than, verified by the test. */
export const AVATAR_MAX_SIDE_PX = 512;

/** Full page script: common layer + control + avatar + pet/global/AI three panels + model selection + startup. */
export const settingsScript = [
  '(function () {',
  coreScript(ROUTE_SEGMENT, {
    voices: VOICES.map((voice) => ({ id: voice.id, name: voice.name, tag: voice.tag })),
    fonts: FONT_PRESETS.map((preset) => preset.id),
    displays: PET_DISPLAYS,
    corners: [...CORNER_SET],
    physics: DEFAULT_PHYSICS,
    font: DEFAULT_FONT,
    weights: DEFAULT_WEIGHTS,
  }),
  widgetsScript(),
  overlayScript(),
  avatarScript({ logoUrl: LOGO_URL, maxSide: AVATAR_MAX_SIDE_PX }),
  petCardScript(),
  petsScript(),
  globalsScript(),
  modelPickerScript(),
  aiScript(),
  setupModelsScript(),
  setupScript(),
  bootScript(),
  'boot();',
  '})();',
].join('\n');
