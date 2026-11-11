/**
 * Contract test for desktop pet determination (src/host/plugin/desktop/pets.ts).
 *
 * Three contracts: The three value functions read the configuration each time (the modified file will take effect the
 * next time it is called, without caching and refreshing); if it cannot be read, press "No desktop pets, still need
 * system tray" to downgrade without throwing away; determine whether the log contains the number of pets and the
 * conclusion. Use real temporary configuration files to drive readAllConfig, not the mock configuration layer.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDesktopPets } from './plugin/desktop/pets.ts';
import type { ConfigPaths } from './config.ts';

/** Minimum available configuration: The entire section animations must be valid (the merge is the entire section replacement/entire section rollback). */
const baseConfig = (display: string, trayEnabled = true) => ({
  animations: {
    idle: ['idle1'],
    turn: ['turn1'],
    drag: ['drag1'],
    clicks: ['click1'],
    moves: { default: {}, actions: [] },
  },
  animationWeights: { idle: 100, turn: 0, move: 0 },
  eventsRefreshSec: {},
  pets: [{ id: 'main', size: 200, display, position: { corner: 'bottom-right', marginX: 24, marginY: 0 } }],
  trayEnabled,
});

/** Create a temporary configuration directory; return the path, write the entry point and cleanup function of the user layer. */
function fixture(initial: { display: string; trayEnabled?: boolean }): {
  paths: ConfigPaths;
  write: (next: { display: string; trayEnabled?: boolean }) => void;
  writeRaw: (raw: string) => void;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-desktop-pets-'));
  const paths: ConfigPaths = {
    defaultFile: join(dir, 'default.jsonc'),
    userFile: join(dir, 'main-config.jsonc'),
    petDir: join(dir, 'pet'),
  };
  writeFileSync(paths.defaultFile, JSON.stringify(baseConfig(initial.display, initial.trayEnabled)));
  return {
    paths,
    write: (next) => writeFileSync(paths.defaultFile, JSON.stringify(baseConfig(next.display, next.trayEnabled))),
    writeRaw: (raw) => writeFileSync(paths.defaultFile, raw),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** Silence logger (the module under test only uses info/warn, and the other members are meaningless in the use case). */
const quietLog = { info: () => {}, warn: () => {} } as unknown as Parameters<typeof createDesktopPets>[0]['log'];

describe('createDesktopPets - It is determined that the configuration must be read now', () => {
  test('display = web: It is determined that there is no desktop pet', () => {
    const f = fixture({ display: 'web' });
    try {
      const pets = createDesktopPets({ configPaths: f.paths, effectivePetList: () => [], log: quietLog });
      assert.equal(pets.getHasDesktopPet(), false);
    } finally {
      f.cleanup();
    }
  });

  test('Change the configuration after createDesktopPets: read the new value immediately on the next call (no refresh required)', () => {
    const f = fixture({ display: 'web' });
    try {
      const pets = createDesktopPets({ configPaths: f.paths, effectivePetList: () => [], log: quietLog });
      assert.equal(pets.getHasDesktopPet(), false, 'Prerequisite: There is no desktop pet when creating');

      f.write({ display: 'desktop' });
      assert.equal(
        pets.getHasDesktopPet(),
        true,
        'No cache: after changing the configuration, the next call should be true',
      );
    } finally {
      f.cleanup();
    }
  });

  test('Changing back to web will also take effect immediately.', () => {
    const f = fixture({ display: 'both' });
    try {
      const pets = createDesktopPets({ configPaths: f.paths, effectivePetList: () => [], log: quietLog });
      assert.equal(pets.getHasDesktopPet(), true);
      f.write({ display: 'web' });
      assert.equal(pets.getHasDesktopPet(), false);
    } finally {
      f.cleanup();
    }
  });

  test('The system tray switch also reads the current value.', () => {
    const f = fixture({ display: 'web', trayEnabled: true });
    try {
      const pets = createDesktopPets({ configPaths: f.paths, effectivePetList: () => [], log: quietLog });
      assert.equal(pets.getTrayOn(), true);
      f.write({ display: 'web', trayEnabled: false });
      assert.equal(pets.getTrayOn(), false);
    } finally {
      f.cleanup();
    }
  });

  test('The configuration cannot be read: press "No desktop pet, still need system tray" to downgrade without discarding', () => {
    const f = fixture({ display: 'desktop' });
    try {
      const pets = createDesktopPets({ configPaths: f.paths, effectivePetList: () => [], log: quietLog });
      f.writeRaw('{ 这不是 JSON');
      assert.equal(pets.getHasDesktopPet(), false, 'I would rather not read out spawn');
      assert.equal(pets.getTrayOn(), true, 'Keep system tray conservatively');
      assert.deepEqual(pets.desktopPetList(), []);
    } finally {
      f.cleanup();
    }
  });

  test('logDesktopDecision Enter a line of judgment log, including the number of pets and the conclusion', () => {
    const f = fixture({ display: 'desktop', trayEnabled: false });
    try {
      const lines: string[] = [];
      const log = { info: (line: string) => lines.push(line), warn: () => {} } as unknown as Parameters<
        typeof createDesktopPets
      >[0]['log'];
      const pets = createDesktopPets({ configPaths: f.paths, effectivePetList: () => [], log });
      assert.equal(lines.length, 1, 'Type a line first when assembling');
      pets.logDesktopDecision();
      assert.equal(lines.length, 2);
      const line = lines[1];
      assert.ok(line.includes('visible=1(main)'), line);
      assert.ok(line.includes('hasDesktopPet=true'), line);
      assert.ok(line.includes('tray=false'), line);
    } finally {
      f.cleanup();
    }
  });
});
