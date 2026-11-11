/**
 * Configuration reading: scan the pet directory, migrate old file names, merge the finished configuration and flatten
 * it.
 *
 * It is not responsible for writing to the disk (returned to ./save); if parsing fails, it will fall back to the
 * built-in default and will never return to partial results. It must always be true: all reads go through
 * readAllConfig, and the path must not be spelled out outside the module.
 * @module dsh-pet/src/host/config/read
 */
import { existsSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { warnOnce } from './constants.ts';
import type { ConfigPaths } from './constants.ts';
import { effectiveUserFile, readJsonc } from './jsonc.ts';
import { mergeEntry, packBase } from './merge.ts';
import { DEFAULT_CHAT_MEMORY } from '../../shared/chat-memory-config.ts';

/**
 * One-time migration for old users: main-config.json → main-config.jsonc (renamed, the content remains unchanged). Why
 * change the extension: The user layer has been the original text of JSONC with // annotation since "synchronization",
 * and it is unworthy of the name. json. The new file already exists → do nothing (never overwrite the new file with
 * the old file); rename failure is silently ignored, with fallback on the reading side.
 */
export function migrateUserConfig(paths: ConfigPaths, log?: (message: string) => void): boolean {
  const legacy = paths.legacyUserFile;
  if (!legacy || !existsSync(legacy) || existsSync(paths.userFile)) return false;
  try {
    renameSync(legacy, paths.userFile);
  } catch {
    return false; // Migration failed: read side fallback old path, does not affect use
  }
  log?.(`Migrated user configuration to JSONC: ${legacy} -> ${paths.userFile}`);
  return true;
}

interface PetFileEntry {
  /** Filename prefix = entry key = asset root */
  prefix: string;
  path: string;
}

/** Scan pet / directory: <name>- config .( json | jsonc ) → entries (sorted by file name) */
function scanPetFiles(petDir: string): PetFileEntry[] {
  let entries;
  try {
    entries = readdirSync(petDir, { withFileTypes: true });
  } catch {
    return []; // pet / Directory does not exist = No file pet
  }
  return entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => /^.+?-config\.(json|jsonc)$/.test(name))
    .sort()
    .map((name) => ({ prefix: name.replace(/-config\.(json|jsonc)$/, ''), path: join(petDir, name) }));
}

/**
 * Locate the actual file and disk original object of the file pet by entry key (= file name prefix = asset root). When
 * writing the path (POST /pet-display) to change the display of the file pet, you must not only write back its own
 * configuration file, but also use the existing of the file as a transparent transmission reservation, otherwise the
 * manually modified whisperPrompt / animations / memes will be erased by the whitelist reconstruction. The extension
 * is not hard-coded (. json or . jsonc). If it is written incorrectly, an empty configuration will be created; the
 * prefix does not exist → undefined.
 */
export function readPetConfigEntry(
  paths: ConfigPaths,
  entry: string,
): { path: string; raw: Record<string, unknown> | undefined } | undefined {
  const hit = scanPetFiles(paths.petDir).find((f) => f.prefix === entry);
  return hit ? { path: hit.path, raw: readJsonc(hit.path) } : undefined;
}

/**
 * The only read function: built-in default + user master configuration + file pet field-by-field merged finished
 * product aggregate. Each entry is the original file structure and the fields are filled. The consumer reads it
 * directly; the file is re-read every time it is called, and the configuration changes take effect immediately.
 */
export function readAllConfig(paths: ConfigPaths): Record<string, Record<string, unknown>> {
  const base = readJsonc(paths.defaultFile);
  if (!base)
    throw new Error('dsh-pet: bundled defaults missing or invalid; check the installation:' + paths.defaultFile);
  // Keep optional memory defaults in code so existing packaged configuration files need no migration.
  base.chatMemory ??= { ...DEFAULT_CHAT_MEMORY };
  const basePets = Array.isArray(base.pets) ? (base.pets as Record<string, unknown>[]) : [];
  const seenIds = new Set<string>();
  const out: Record<string, Record<string, unknown>> = {};

  // main entry: built-in default ← main-config.jsonc (editable layer; old users before migration fallback to main-config.json)
  const userFile = effectiveUserFile(paths);
  const mainOverlay = userFile ? readJsonc(userFile) : undefined;
  if (userFile && !mainOverlay) {
    warnOnce(
      'file:' + userFile,
      'User configuration could not be parsed; proceeding without user overrides:' + userFile,
    );
  }
  out.main = mergeEntry(base, mainOverlay, 'main-config.jsonc', basePets, seenIds);

  // File pet entry: pet/<name>-config.json, one entry per file (key = file name prefix = asset root). Base = built-in
  // default, but the whitelist fields (user-level cost/preference/environment) take the user level - "global default +
  // category can be overridden".
  const filePetBase = packBase(base, mainOverlay);
  for (const file of scanPetFiles(paths.petDir)) {
    const parsed = readJsonc(file.path);
    if (!parsed) {
      warnOnce('file:' + file.path, 'Pet-pack configuration could not be parsed; skipping:' + file.path);
      continue;
    }
    out[file.prefix] = mergeEntry(filePetBase, parsed, file.prefix + '-config.json', basePets, seenIds);
  }
  return out;
}

/** Flatten all entries pets into a single list (host consumer uses: desktop pet list/command/current desktop pet analysis) */
export function flattenPetList(merged: Record<string, Record<string, unknown>>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const conf of Object.values(merged)) {
    if (Array.isArray(conf?.pets)) out.push(...(conf.pets as Record<string, unknown>[]));
  }
  return out;
}

/**
 * Locate the pet and its belonging items (host internal consumption index) by instance id in the resolved value
 * aggregate: The item key is the asset root (assetRoot); the item-level field
 * (whisperPrompt/chatMemoryRounds/animations) is taken with the item (the only exception: whisperPrompt can be
 * overwritten by the instance - caller please go to ./persona for the effective value) of petPersona, don’t read conf
 * directly).
 */
export function findPetInstance(
  merged: Record<string, Record<string, unknown>>,
  petId: string,
): { entry: string; conf: Record<string, unknown>; pet: Record<string, unknown> } | undefined {
  for (const [entry, conf] of Object.entries(merged)) {
    const pets = Array.isArray(conf?.pets) ? (conf.pets as Record<string, unknown>[]) : [];
    const found = pets.find((p) => String(p.id) === petId);
    if (found) return { entry, conf, pet: found };
  }
  return undefined;
}
