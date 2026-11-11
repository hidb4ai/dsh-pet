/**
 * Finished product → Contract test of rendering list: There is only one fill point for the entry-level field
 * (flattenConfigPets).
 *
 * Background: animations / animationWeights / eventsRefreshSec / physics / confineToScreen / workStatusTexts /
 * whisperModel / chatModel / memes / chatImageEnabled / chatAnimationEnabled / chatImageLimit These twelve entry-level
 * fields must be composed of flattenConfigPets is written into each instance from the "entry"; the client must not
 * have a second fill (the second copy will miss fields, for example, when physics is missing, drag the first frame to
 * read cfg.physics.throwPower and directly throw an error). The settings page is now reflated with the finished
 * aggregate returned by the host write interface. This document verifies this invariant: ① After the resolved value
 * is processed by flattenConfigPets, the entry-level fields of each instance are complete (with the real built-in
 * default configuration); ② The client must no longer fill in the "handwritten entry-level fields", and the host write
 * interface must return the resolved configuration (source code level guard - src/client/pet.ts depends on
 * React/DOM and cannot be used in node Imported in, only source code assertion can be read).
 *
 * Use Node to build test runner (node:test) without introducing any npm dependencies.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { flattenConfigPets } from './config.ts';
import { readAllConfig } from '../host/config.ts';
import type { Pet } from './types.ts';

/** List of entry-level fields: Client-side rendering consumes directly, all are indispensable */
const ENTRY_FIELDS: Array<keyof Pet> = [
  'animations',
  'animationWeights',
  'eventsRefreshSec',
  'physics',
  'confineToScreen',
  'workStatusTexts',
  'whisperModel',
  'chatModel',
  'memes',
  'chatImageEnabled',
  'chatAnimationEnabled',
  'chatImageLimit',
];

/** Source code of files in the package (for guarding; relative to src/shared / parsing) */
const readSource = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('flattenConfigPets - Finished product → the only fill point in the render list', () => {
  test('Real built-in default configuration: each instance has complete entry-level fields (including physics.throwPower)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-flatten-'));
    try {
      const merged = readAllConfig({
        defaultFile: fileURLToPath(new URL('../../assets/config.jsonc', import.meta.url)),
        userFile: join(dir, 'main-config.jsonc'), // Does not exist: only test the built-in default
        petDir: join(dir, 'pet'), // Does not exist: no file pets
      });
      const pets = flattenConfigPets(merged);
      assert.ok(pets.length > 0, 'Built-in default configuration should have at least one pet');
      for (const p of pets) {
        for (const field of ENTRY_FIELDS) {
          assert.ok(p[field] !== undefined, `Pet " ${String(p.id)} " is missing the entry-level field ${field}`);
        }
        // The first frame read by drag and drop is it; the missing one is TypeError (the direct reason for the existence of this file)
        const physics = p.physics as { throwPower?: unknown };
        assert.equal(typeof physics.throwPower, 'number', 'physics.throwPower must be a number');
        // animations is { idle/turn/drag/clicks/moves/categories/events } segment: the standby pool must not be empty
        const animations = p.animations as { idle?: unknown };
        assert.ok(
          Array.isArray(animations.idle) && animations.idle.length > 0,
          'animations.idle should be a non-empty standby animation pool',
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('The source of the entry-level field is "entry" rather than the instance: writing a value with the same name to the instance does not take effect (unique source = conf)', () => {
    const merged = {
      main: {
        physics: { throwPower: 7 },
        animations: ['a.webm'],
        pets: [{ id: 'x', physics: { throwPower: 1 } }],
      },
    };
    const [pet] = flattenConfigPets(merged as Record<string, Record<string, unknown>>);
    assert.deepEqual(pet.physics, { throwPower: 7 });
    assert.deepEqual(pet.animations, ['a.webm']);
  });

  test('Instance-level persona whisperPrompt: brought out as is, not participating in entry-level coverage (fallback is done by host consumer)', () => {
    const merged = {
      main: {
        whisperPrompt: '条目人设',
        pets: [{ id: 'x', whisperPrompt: '实例人设' }, { id: 'y' }],
      },
    };
    const [a, b] = flattenConfigPets(merged as Record<string, Record<string, unknown>>);
    // The entry-level field is "the instance is written in accordance with conf", persona is a counterexample: the instance part must be retained (it is overwritten)
    assert.equal(a.whisperPrompt, '实例人设');
    assert.equal(
      'whisperPrompt' in b,
      false,
      'If it is not written, it is not written. The fallback is done by petPersona of host. The effective value is not filled in here.',
    );
  });

  test('Source code guard: The client only fills this part, and the write interface of host returns the finished aggregate', () => {
    // The container (flattening and rendering list) is in pet/multi.ts and the card is in pet.ts: read both places together so that the guard will not be bypassed by splitting.
    const clientPet = readSource('../client/pet.ts') + '\n' + readSource('../client/pet/multi.ts');
    const clientSettings = readSource('../client/settings.ts') + '\n' + readSource('../client/settings/config/http.ts');
    // Write four files under separate config/ (distribute/save/single pet display position/entire entry): path relocation should not invalidate the guard, so read all files in.
    const host =
      readSource('../host/index.ts') +
      '\n' +
      readSource('../host/routes/config/index.ts') +
      '\n' +
      readSource('../host/routes/config/save.ts') +
      '\n' +
      readSource('../host/routes/config/display.ts') +
      '\n' +
      readSource('../host/routes/config/entry.ts') +
      '\n' +
      readSource('../host/routes/state.ts');

    // ① The old handwritten filling (mc .<field> mapping) and the bypass "setting page pushback list" cannot be resurrected
    assert.ok(
      !/petBridge\.sync/.test(clientPet + clientSettings),
      'petBridge.sync Deleted: The settings page must no longer push the "editable bare instance list" back to the container (that\'s where the physics leak comes from)',
    );
    for (const field of ENTRY_FIELDS) {
      assert.ok(
        !new RegExp(`${field}:\\s*mc\\.`).test(clientPet),
        `The client must obtain entry field ${field} through flattenConfigPets, without duplicating the field mapping`,
      );
    }
    // ② The container must obtain the entry-level fields through flattenConfigPets
    assert.ok(/flattenConfigPets/.test(clientPet), 'The container must be flattened with flattenConfigPets aggregate');
    // ③ GET / PUT / POST /config, POST /pet-display and POST /pet-config of host all return the resolved value
    // aggregate - the caller takes the response of the write interface and flattens it directly, without spelling the
    // fields by itself, and does not add it again. GET (you may get the old configuration during the re-pull). This
    // article can only read the source code: the default configuration in the package is unreachable in source code
    // form, and the success state of the write path cannot be constructed (see the "Configuration Unreachable"
    // conventions of standalone/integration.test.ts), which is a registered text baseline.
    const returns = host.match(/okResult\(readAllConfig\((?:deps\.)?configPaths\)/g) ?? [];
    assert.equal(
      returns.length,
      5,
      'GET / PUT / POST / config, POST / pet-display and POST / pet-config should all be returned to finished product aggregate',
    );
    // Only scan the / config section: the action endpoint (POST /balance, etc.) returns { ok : true }, which is
    // correct (the action does not carry data, and the data only has one outlet / state). Full file scanning will
    // misjudge them as "config write interface returned ok:true".
    const configBlock = /if \(input\.rest === 'config'\) \{([\s\S]*?)\n {2}\}/.exec(host)?.[1] ?? '';
    assert.ok(
      configBlock.length > 0,
      'The / config route segment must be located (it is meaningless if the guard fails)',
    );
    assert.ok(
      !/obj: \{ ok: true \}/.test(configBlock),
      'The config write interface must no longer return { ok : true }: the response body must be the finished aggregate (the setting page takes immediate effect by flattening it)',
    );
    // ④ The saved "transparent transmission reservation" must use the JSONC tolerant parser to read the user layer:
    // the user layer may be written "synchronously" config.jsonc original text with // annotation, strict JSON.parse
    // will throw an error and be swallowed by catch → existing becomes undefined → Whitelist reconstruction → Advanced
    // fields manually modified by the user ( animations/physics/memes…) All are lost. This regression must be verified
    // (advanced fields must not be lost when writing to the user layer synchronously).
    assert.ok(
      /readUserConfig\(configPaths\)/.test(host),
      'PUT / config must use readUserConfig to read the user layer (JSONC tolerated)',
    );
    assert.ok(
      !/JSON\.parse\(await readFile\(userConfigPath/.test(host),
      'Strict JSON.parse must not be used to read the user layer: the annotated configuration will fail to parse, and all advanced fields will be silently discarded when saving.',
    );
    // ⑤ There must be a damage pre-check before saving: if the user layer cannot be parsed, do not write to the disk
    // first, return to 409 and let the settings page pop up (Cancel = do not move the file / Confirm = forcibly
    // rebuild). Without it, "corruption → silent whitelist reconstruction → all configuration lost" will occur.
    assert.ok(
      /userConfigUnparsable\(configPaths\)/.test(host),
      'PUT / config must first perform damage pre-check (userConfigUnparsable). When damaged, 409 will be returned instead of silent rebuilding.',
    );
    // ⑥ The front end must not directly pass handler with default parameters to React: `onClick: save` will let React
    // pass MouseEvent as the first actual parameter → force in save ( force ) becomes a true value → Spell every time
    // you save? force =1 → The host's damage pre-check is bypassed → Silent whitelist reconstruction, all fields are
    // lost, and the window never pops up (real accident). Therefore: onClick must be covered by one layer, and force
    // only recognizes true strictly.
    assert.ok(
      !/onClick:\s*save\b/.test(clientSettings),
      'The save button must write onClick: () => void save (): Directly handing save to React will treat MouseEvent as force',
    );
    assert.ok(
      /force === true \? '\?force=1'/.test(clientSettings),
      'force must be strictly compared to true (truth value judgment will enable forced override of any actual parameters)',
    );
    // ⑦ The system notification switch must be the same as the other three global switches: only change the local
    // status and write with "Save". Instant disk writing (directly PUT /config in toggleNotify) will cause the host
    // to restart the desktop Helper (all desktop pet windows are rebuilt: drag the drop point to clear, and the pet
    // will jump back to the configuration corner) - "Change the notification switch and the desktop will be reset",
    // which is inconsistent with the behavior of other switches. Writing to disk is only allowed in save().
    const toggle = /const toggleNotify = async[\s\S]*?\n {4}\};/.exec(clientSettings);
    assert.ok(toggle, 'The settings page must have toggleNotify (system notification switch)');
    assert.ok(
      !/fetch\(|method: 'PUT'/.test(toggle[0]),
      'The system notification switch cannot write to the disk immediately: the switch only changes the local status and writes with "Save" (otherwise the desktop will be restarted Helper)',
    );
    assert.ok(
      /notificationsEnabled: notifyEnabled/.test(clientSettings),
      'The "save" request body must have a notification switch (otherwise, even if the switch is turned on, the save will not take effect)',
    );
    // ⑧ The physical parameters (the "Physical" area of the settings page) must be truly submitted: physics must be in
    // the whitelist (only in existing during transparent transmission, even if the front-end draws the input box and
    // changes the value, it will be discarded when writing to disk). Guard both sides: the "save" request body must
    // contain physics; the host must use the same physicsValid to verify it. Get the request body literal and then
    // find the key (don’t hardcode `physics: physics` : the packager will compress the abbreviation of the same name
    // into `physics,` ).
    const saveBody = /export function buildSaveBody[\s\S]*?return \{([\s\S]*?)\n {2}\};/.exec(clientSettings);
    assert.ok(saveBody, 'The settings page must have a "save" request body literal');
    assert.ok(
      /(^|[^.\w])physics\b/.test(saveBody[1]),
      'The "save" request body must carry physics (otherwise the physical parameters for setting page changes will not persist to disk)',
    );
    assert.ok(
      /physicsValid\(ph\)/.test(readSource('../host/config/save.ts')),
      'saveUserConfig must use physicsValid to verify physics (the same set of rules as the reading side)',
    );
    // ⑨ The model selection (the two drop-down boxes of "AI Model" on the settings page) must be truly submitted:
    // whisperModel / chatModel. If it is not in the whitelist, the front-end will not be able to write it into the
    // user layer even if it is selected (it will only be covered by the transparent transmission value of existing).
    // Guard both sides: the "save" request body must carry them; the host must use the same modelSelectionValid full
    // segment check.
    assert.ok(
      /(^|[^.\w])whisperModel\b/.test(saveBody[1]) && /(^|[^.\w])chatModel\b/.test(saveBody[1]),
      'The "save" request body must carry whisperModel / chatModel (otherwise the model selected on the page will not persist to disk)',
    );
    const hostConfig = readSource('../host/config/save.ts');
    assert.ok(
      /modelSelectionValid\(wm\)/.test(hostConfig) && /modelSelectionValid\(cm\)/.test(hostConfig),
      'saveUserConfig must use modelSelectionValid to verify whisperModel / chatModel (the same set of rules as the reading side)',
    );
    // The data source of the drop-down box must have the same origin as the model selector of DSH: use the host llm
    // service (listProviders / listModels), and do not create a separate handwritten service provider list - that will
    // drift with the service providers supported by DSH.
    assert.ok(
      /listProviders/.test(host) && /listModels/.test(host),
      'GET / models must be listProviders / listModels served by host llm (same origin as DSH model selector)',
    );
  });
});
