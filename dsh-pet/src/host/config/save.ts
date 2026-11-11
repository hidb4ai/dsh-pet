/**
 * Configuration writing: whitelist to rebuild the user layer, or synchronize the entire built-in default to the user.
 *
 * Not responsible for reading and merging (owned by ./read), nor restarting desktop Helper (determined by caller).
 * Must always be true: write-only whitelist fields, non-whitelist fields manually modified by users must be brought
 * back as they are.
 * @module dsh-pet/src/host/config/save
 */
import { defaultLog } from '../log-file.ts';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CORNER_SET, isValidPetId, PET_DISPLAY_SET } from './constants.ts';
import { isValidSizePercent } from '../../shared/pet-size.ts';
import type { ConfigPaths } from './constants.ts';
import { fontValid, modelSelectionValid, physicsValid, topFieldValid } from './validate.ts';

/**
 * Saving user layer ( PUT /config ): accepts pets + global switch + physics / font / two models / dialog parameters.
 * The non-whitelist top-level fields (whisperPrompt, eventsRefreshSec, memes, etc.) are transparently transmitted from
 * existing and retained as they are - the fine-tuned configuration manually edited by the user will not be erased by
 * the settings page save; the whitelist field is only considered whitelisted when the request body is actually
 * transmitted. Invalid → Return null, route returns 200 + failed entity. Decoupled from reading: file pets never write
 * back.
 */
export function saveUserConfig(
  raw: unknown,
  existing?: Record<string, unknown>,
): { pets: unknown[]; [key: string]: unknown } | null {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const arr = Array.isArray(o.pets) ? o.pets : null;
  if (!arr || !arr.length) return null;
  const out: unknown[] = [];
  const seenIds = new Set<string>();
  for (const p of arr) {
    if (!p || typeof p !== 'object') return null;
    const pp = p as Record<string, unknown>;
    // It is consistent with the identity rule of mergePet: first trim, then determine the uniqueness, and finally write to the disk.
    const id = typeof pp.id === 'string' ? pp.id.trim() : '';
    // Intentional filtering of invalid file names (Windows reserved character + control character) to prevent configuration values from escaping the main-config.jsonc path
    if (!isValidPetId(id) || seenIds.has(id)) return null;
    seenIds.add(id);
    const size = Number(pp.size);
    if (!Number.isFinite(size) || size <= 0) return null;
    // Percentage size (optional): The same judgment as the reading side. The number passed must be no less than 1 (no
    // upper limit), otherwise the whole package will be 400; the default means no percentage is used - the default
    // value is not backfilled here, otherwise clear will become "explicitly write back a percentage".
    const sizePercent = pp.sizePercent;
    if (sizePercent !== undefined && sizePercent !== null && !isValidSizePercent(sizePercent)) return null;
    // Display name: repeatable and not verified to be unique; missing/blank/non-character string → Process as the pet id (compatible with old configuration) and alert
    let name = typeof pp.name === 'string' ? pp.name.trim() : '';
    if (!name) {
      defaultLog('warn', `dsh-pet: pet ${id} has no name; using its ID ${id}`);
      name = id;
    }
    const balanceEnabled = pp.balanceEnabled;
    if (typeof balanceEnabled !== 'boolean') return null;
    const whisperEnabled = pp.whisperEnabled;
    if (whisperEnabled !== undefined && typeof whisperEnabled !== 'boolean') return null;
    const workStatusEnabled = pp.workStatusEnabled;
    if (workStatusEnabled !== undefined && typeof workStatusEnabled !== 'boolean') return null;
    // Pet fixed (random chain no longer selects the "Turn/Move" two states): The same semantics as the above two
    // switches - optional, if passed it must be Boolean, if not passed, the following default value on the read side
    // will be used (built-in default false = not fixed).
    const fixedEnabled = pp.fixedEnabled;
    if (fixedEnabled !== undefined && typeof fixedEnabled !== 'boolean') return null;
    const display = String(pp.display ?? '');
    if (!PET_DISPLAY_SET.has(display)) return null;
    const pos = pp.position && typeof pp.position === 'object' ? (pp.position as Record<string, unknown>) : {};
    const corner = String(pos.corner ?? '');
    if (!CORNER_SET.has(corner)) return null;
    const marginX = Number(pos.marginX);
    const marginY = Number(pos.marginY);
    if (!Number.isFinite(marginX) || !Number.isFinite(marginY)) return null;
    // Instance-level persona (optional): Only non-empty character strings persist to disk (written after trim); empty
    // string/pure blank = do not write the key - persist to disk The result is "This pet does not have its own
    // coverage", and the reading side (petPersona of ./persona) automatically falls back to the corresponding entry.
    // That is: clear input box + save = delete override, instead of writing an empty persona. Non-character strings
    // (and not undefined/null) have the same conventions as other fields: the whole package is 400, and user input is
    // not silently lost.
    const rawPersona = pp.whisperPrompt;
    if (rawPersona !== undefined && rawPersona !== null && typeof rawPersona !== 'string') return null;
    const persona = typeof rawPersona === 'string' ? rawPersona.trim() : '';
    const pet: Record<string, unknown> = {
      id,
      name,
      size,
      balanceEnabled,
      whisperEnabled,
      workStatusEnabled,
      fixedEnabled,
      display,
      position: { corner, marginX, marginY },
    };
    if (persona) pet.whisperPrompt = persona;
    if (sizePercent !== undefined && sizePercent !== null) pet.sizePercent = sizePercent;
    out.push(pet);
  }
  const ne = o.notificationsEnabled;
  if (ne !== undefined && typeof ne !== 'boolean') return null;
  // Click the sound effect switch (global Boolean, the same semantics as notificationsEnabled): if it is passed, it must be Boolean, if it is not passed, it will be retained through transparent transmission.
  const cse = o.clickSoundEnabled;
  if (cse !== undefined && typeof cse !== 'boolean') return null;
  const wie = o.whisperImageEnabled;
  if (wie !== undefined && typeof wie !== 'boolean') return null;
  const cie = o.chatImageEnabled;
  if (cie !== undefined && typeof cie !== 'boolean') return null;
  // Dialogue action linkage switch (global Boolean): The same set of semantics as the above switches - if it is passed, it must be Boolean, if it is not passed, it will be retained through transparent transmission.
  const cae = o.chatAnimationEnabled;
  if (cae !== undefined && typeof cae !== 'boolean') return null;
  const cts = o.confineToScreen;
  if (cts !== undefined && typeof cts !== 'boolean') return null;
  // Voice broadcast switch and voice (global): The same semantics as the above booleans; the voice must fall in the
  // white list, and the verification directly reuses topFieldValid on the reading side, reading and writing the same
  // rule.
  const ve = o.voiceEnabled;
  if (ve !== undefined && typeof ve !== 'boolean') return null;
  const vn = o.voiceName;
  if (vn !== undefined && !topFieldValid('voiceName', vn)) return null;
  // Playback volume (global coefficient, 0–1): The same set of semantics as above - if it is passed, it must be valid, if it is not passed, it will be retained through transparent transmission.
  const vv = o.voiceVolume;
  if (vv !== undefined && !topFieldValid('voiceVolume', vv)) return null;
  // Two subdivision switches for voice broadcast (periodic whisper / to-do reminder): The same semantics as the above
  // two Boolean - if it is passed, it must be Boolean, if it is not passed, it will be retained through transparent
  // transmission; for verification, directly reuse topFieldValid on the reading side, and read and write the same
  // rule.
  const vwe = o.voiceWhisperEnabled;
  if (vwe !== undefined && !topFieldValid('voiceWhisperEnabled', vwe)) return null;
  const vte = o.voiceTodoEnabled;
  if (vte !== undefined && !topFieldValid('voiceTodoEnabled', vte)) return null;
  const vne = o.voiceNotifyEnabled;
  if (vne !== undefined && !topFieldValid('voiceNotifyEnabled', vne)) return null;
  // System system tray switch (global, desktop mode only): The same semantics as the above global booleans - if it is passed, it must be Boolean, if it is not passed, it will be retained through transparent transmission.
  const te = o.trayEnabled;
  if (te !== undefined && typeof te !== 'boolean') return null;
  // physics (drag and throw feel, graphic editing in the "Physics" area of the settings page): The entire verification
  // - physicsValid and the reading side are the same rules (gravity/groundFriction ≥ 0, restitution ∈ [0,1],
  // throwPower > 0, two Boolean). If it is passed, it will be written according to the white list; if it is not
  // passed, it will be retained through transparent transmission below (the value manually modified by the user will
  // remain unchanged).
  const ph = o.physics;
  if (ph !== undefined && !physicsValid(ph)) return null;
  // animationWeights (action frequency; this is what is written on the "action frequency" card on the settings page):
  // The same set of semantics as physics - if it is passed, the entire segment will be verified and then entered into
  // the whitelist. If it is not passed, the transparent transmission and retention below will be used. Verify
  // topFieldValid on the read side of reuse (the three weights are all non-negative finite numbers), and persist to
  // disk only leaves three numbers idle / turn / move.
  const aw = o.animationWeights;
  if (aw !== undefined && !topFieldValid('animationWeights', aw)) return null;
  // font (font type / font size / whether to scale with pets; it is written in the "Appearance and Font" area of the
  // settings page): The same set of semantics as physics - if it is passed, the entire paragraph will be verified and
  // entered into the whitelist, if not passed, the transparent transmission and retention below will be used. The
  // verification directly reuses fontValid on the reading side (family white list / size 4~200 / followPet Boolean),
  // reading and writing the same rule.
  const fo = o.font;
  if (fo !== undefined && !fontValid(fo)) return null;
  // whisperModel / chatModel (whisper / talk to the respective service provider + model; they are written in the two
  // drop-down boxes on the settings page): The same set of semantics as physics - if it is passed, the entire
  // paragraph will be verified and then entered into the whitelist, if not passed, the transparent transmission and
  // retention below will be used. When persisting to disk, it is normalized into { provider , model } and two trim
  // passed character strings (the keys in the request body are not written into the user layer).
  const wm = o.whisperModel;
  if (wm !== undefined && !modelSelectionValid(wm)) return null;
  const cm = o.chatModel;
  if (cm !== undefined && !modelSelectionValid(cm)) return null;
  // chatMemoryRounds (the number of dialogue history entries; this is what is written in the number input box in the
  // "AI Model and Dialog Context" area of the settings page): The same semantics as physics / model - if it is passed,
  // it will be verified and then entered into the whitelist, if not passed, the transparent transmission and retention
  // below will be used. The verification directly reuses topFieldValid on the reading side (limited and ≥ 0), reading
  // and writing the same rule, without writing another set.
  const cmr = o.chatMemoryRounds;
  if (cmr !== undefined && !topFieldValid('chatMemoryRounds', cmr)) return null;
  const memory = o.chatMemory;
  if (memory !== undefined && !topFieldValid('chatMemory', memory)) return null;
  // chatImageLimit (the upper limit of the number of dialogue images; it is written in the number input box in the "AI
  // Model and Dialog Context" area of the settings page): The same set of semantics as chatMemoryRounds - if it is
  // passed, it will be verified and then entered into the whitelist, if it is not passed, it will be retained through
  // transparent transmission below.
  const cil = o.chatImageLimit;
  if (cil !== undefined && !topFieldValid('chatImageLimit', cil)) return null;
  const cleanModel = (v: Record<string, unknown>): { provider: string; model: string } => ({
    provider: String(v.provider).trim(),
    model: String(v.model).trim(),
  });
  const cleanWeights = (v: Record<string, unknown>): { idle: number; turn: number; move: number } => ({
    idle: Number(v.idle),
    turn: Number(v.turn),
    move: Number(v.move),
  });
  // Whitelist editable fields: pets comes from the request body, and the rest (four global switches / physics / two
  // models / number of conversation history entries) are also written only when the request body is actually
  // transmitted (if not transmitted, the following transparent transmission is used to retain it, and no value is
  // created out of thin air)
  const outConfig: { pets: unknown[]; [key: string]: unknown } = { pets: out };
  if (ne !== undefined) outConfig.notificationsEnabled = ne;
  if (cse !== undefined) outConfig.clickSoundEnabled = cse;
  if (wie !== undefined) outConfig.whisperImageEnabled = wie;
  if (cie !== undefined) outConfig.chatImageEnabled = cie;
  if (cae !== undefined) outConfig.chatAnimationEnabled = cae;
  if (cts !== undefined) outConfig.confineToScreen = cts;
  if (ve !== undefined) outConfig.voiceEnabled = ve;
  if (vn !== undefined) outConfig.voiceName = vn;
  if (vv !== undefined) outConfig.voiceVolume = vv;
  if (vwe !== undefined) outConfig.voiceWhisperEnabled = vwe;
  if (vte !== undefined) outConfig.voiceTodoEnabled = vte;
  if (vne !== undefined) outConfig.voiceNotifyEnabled = vne;
  if (te !== undefined) outConfig.trayEnabled = te;
  if (ph !== undefined) outConfig.physics = ph;
  if (aw !== undefined) outConfig.animationWeights = cleanWeights(aw as Record<string, unknown>);
  if (fo !== undefined) outConfig.font = fo;
  if (wm !== undefined) outConfig.whisperModel = cleanModel(wm as Record<string, unknown>);
  if (cm !== undefined) outConfig.chatModel = cleanModel(cm as Record<string, unknown>);
  // Value normalization persist to disk: request body "9" is also stored as 9 (consistent with the Number() conventions of topFieldValid on the reading side)
  if (cmr !== undefined) outConfig.chatMemoryRounds = Number(cmr);
  if (memory !== undefined) outConfig.chatMemory = memory;
  if (cil !== undefined) outConfig.chatImageLimit = Number(cil);
  // Transparent transmission retention: The top-level fields not carried in the request body are brought back as they
  // are from existing (existing user files on the disk) - the settings page only submits pets (+global
  // switch+physics+model+number of conversation history items), and the manually modified whisperPrompt/memes /... are
  // preserved. The whitelist field is only considered whitelisted when "the request body is passed" (it has been
  // written from above); if it is not passed, go here to transparently transmit the old disk value - otherwise the
  // caller called by the whole package misses a field and will quietly erase the user's existing settings to default.
  const bodyOwned = new Set(['pets']);
  if (ne !== undefined) bodyOwned.add('notificationsEnabled');
  if (cse !== undefined) bodyOwned.add('clickSoundEnabled');
  if (wie !== undefined) bodyOwned.add('whisperImageEnabled');
  if (cie !== undefined) bodyOwned.add('chatImageEnabled');
  if (cae !== undefined) bodyOwned.add('chatAnimationEnabled');
  if (cts !== undefined) bodyOwned.add('confineToScreen');
  if (ve !== undefined) bodyOwned.add('voiceEnabled');
  if (vn !== undefined) bodyOwned.add('voiceName');
  if (vv !== undefined) bodyOwned.add('voiceVolume');
  if (vwe !== undefined) bodyOwned.add('voiceWhisperEnabled');
  if (vte !== undefined) bodyOwned.add('voiceTodoEnabled');
  if (vne !== undefined) bodyOwned.add('voiceNotifyEnabled');
  if (te !== undefined) bodyOwned.add('trayEnabled');
  if (ph !== undefined) bodyOwned.add('physics');
  if (aw !== undefined) bodyOwned.add('animationWeights');
  if (fo !== undefined) bodyOwned.add('font');
  if (wm !== undefined) bodyOwned.add('whisperModel');
  if (cm !== undefined) bodyOwned.add('chatModel');
  if (cmr !== undefined) bodyOwned.add('chatMemoryRounds');
  if (memory !== undefined) bodyOwned.add('chatMemory');
  if (cil !== undefined) bodyOwned.add('chatImageLimit');
  if (existing && typeof existing === 'object') {
    for (const key of Object.keys(existing)) {
      if (bodyOwned.has(key)) continue; // The whitelist fields are determined by the request body. Only the top-level fields that can be fine-tuned are
      // transparently transmitted, and the rest (such as memes/unknown/placeholders) are retained without discarding user
      // content.
      outConfig[key] = existing[key];
    }
  }
  return outConfig;
}

/**
 * Synchronize user layer (POST /config, settings page "Synchronization"): Write the original built-in default
 * configuration into the user's main configuration file. Copy the original text instead of deleting the user layer: it
 * is equivalent to restoring the default (merged result = built-in default), but also allows the user to get a
 * complete configuration with all comments and editable out of the box. On the reading side, use stripJsonc uniformly,
 * and writing with comments can still be read. Note: Once the file is generated, it becomes an explicit overlay. After
 * the plugin is upgraded and the built-in default is changed, the old values in the file will still take effect. The
 * default file is missing/the directory is not writable → throw it directly, and route will return 200 + failed
 * entities (`generate-error`), never leaving half of the configuration file silently.
 */
export function syncUserConfigFromDefault(paths: ConfigPaths): void {
  const raw = readFileSync(paths.defaultFile, 'utf8');
  mkdirSync(dirname(paths.userFile), { recursive: true });
  writeFileSync(paths.userFile, raw, 'utf8');
}

/**
 * Dialogue memory interception: take the tail rounds rounds (1 round = 1 question, 1 answer → 2 items). Cannot write
 * messages.slice (- rounds * 2): when rounds = 0 -0 === 0, slice (-0) returns the entire array, and "turn off history"
 * becomes "with all history". Explicit branches here: 0 → empty list, > 0 → truncate.
 */
export function sliceMemoryRounds<T>(messages: T[], rounds: number): T[] {
  return rounds > 0 ? messages.slice(-Math.floor(rounds) * 2) : [];
}

/**
 * Dialogue memory is deleted in rounds: `ts` messages falling into the set are removed in the entire round (two in a
 * round share the same `ts` , so they are naturally paired).
 *
 * Don't use "empty set = delete all" to express clear: that will make the caller silently erase the entire history
 * when missing parameters. clear is another explicit branch of caller (passing an empty array = none is deleted).
 *
 * @param messages - memory array.
 * @param ts - The set of round timestamps to delete.
 * @returns Messages retained and the number removed.
 */
export function removeRoundsByTs<T extends { ts: number }>(
  messages: readonly T[],
  ts: readonly number[],
): { messages: T[]; removed: number } {
  const doomed = new Set(ts);
  const messages_ = messages.filter((m) => !doomed.has(m.ts));
  return { messages: messages_, removed: messages.length - messages_.length };
}
