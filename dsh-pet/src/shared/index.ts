/**
 * Shared layer export: browser side bundle and desktop shared-core share the same pure logic. It is not responsible
 * for reading, merging and verifying the configuration: the finished configuration is given by readAllConfig on the
 * host side, and this layer only flattens it. The host side must not import this directory (DSH single file loading
 * constraint will split chunk), its implementation is self-contained, and changes must be synchronized with this
 * layer. menu / chat / score-popup / todo / tooltip Export DOM style and mounting: data and criteria are still pure
 * functions, and both rendering ends share the same copy. This file is packaged entry point:
 * scripts/build-desktop-core.mjs. Type it into shared-core.js. The product exposes all symbols as window.PetShared for
 * desktop JS to access (there is no type checking on that side).
 * @module dsh-pet/src/shared/index
 */
export * from './types.ts';
export * from './constants.ts';
export * from './pickers.ts';
export * from './displays.ts';
export * from './motion.ts';
export * from './balance/index.ts';
export * from './whisper.ts';
export * from './config.ts';
export * from './fonts.ts';
export * from './notify.ts';
export * from './menu.ts';
export * from './chat/index.ts';
export * from './physics.ts';
export * from './score.ts';
export * from './score-popup.ts';
export * from './work-status.ts';
export * from './state.ts';
export * from './bubble-hold.ts';
export * from './display-hotkey.ts';
export * from './sleep-hotkey.ts';
export * from './todo/index.ts';
export * from './tooltip.ts';
export * from './voice.ts';
