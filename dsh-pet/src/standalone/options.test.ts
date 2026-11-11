/**
 * Single test of standalone mode command line and configuration path derivation (pure logic, zero I/O).
 *
 * Why there is this separate layer: There is no DSH launcher fallback in the standalone mode - if the parameter
 * parsing is wrong, it will directly show up as "the port is wrong/the window does not appear", and if the
 * configuration path is deduced wrong, it will show up as "the changed configuration does not take effect". Both are
 * pure functions, and nailing them here is much cheaper than debugging them end-to-end.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { configPathsFor, describePets, parseArgs } from './options.ts';
import { DEFAULT_STANDALONE_PORT } from './server.ts';

describe('parseArgs - Standalone mode command line contract', () => {
  test('No parameters: default port, no physical examination, no printing usage', () => {
    const parsed = parseArgs([]);
    assert.ok('options' in parsed);
    assert.deepEqual(parsed.options, { port: DEFAULT_STANDALONE_PORT, check: false, help: false, setup: false });
  });

  test('--The two ways of writing port are equivalent', () => {
    const spaced = parseArgs(['--port', '3100']);
    const equals = parseArgs(['--port=3100']);
    assert.ok('options' in spaced && 'options' in equals);
    assert.equal(spaced.options.port, 3100);
    assert.equal(equals.options.port, 3100);
  });

  test('--check and - h /--help are independent', () => {
    const check = parseArgs(['--check']);
    const short = parseArgs(['-h']);
    const long = parseArgs(['--help']);
    assert.ok('options' in check && 'options' in short && 'options' in long);
    assert.equal(check.options.check, true);
    assert.equal(check.options.help, false);
    assert.equal(short.options.help, true);
    assert.equal(long.options.help, true);
  });

  test('Invalid port (out of bounds/non-integer/missing) → error, caller exits with 2', () => {
    for (const argv of [['--port'], ['--port', '0'], ['--port', '70000'], ['--port', '1.5'], ['--port=abc']]) {
      const parsed = parseArgs(argv);
      assert.ok('error' in parsed, JSON.stringify(argv));
      assert.match(parsed.error, /--port/);
    }
  });

  test('Unknown parameter → error (not silently ignored to avoid "I clearly passed the parameter")', () => {
    const parsed = parseArgs(['--standalone']);
    assert.ok('error' in parsed);
    assert.match(parsed.error, /Unknown argument/);
  });
});

describe('configPathsFor - Configuration path derivation (mirror of host/index.ts)', () => {
  // The drift of the image is caused by integration.test.ts using the plugin's own GET /config/meta verify; here
  // verify "concatenate conventions" itself, you can see at a glance which path has been changed when making changes.
  const paths = configPathsFor('/pkg', '/home/.dsh');

  test('Built-in default/user master configuration/old version fallback/file pet directory', () => {
    assert.deepEqual(paths, {
      defaultFile: join('/pkg', 'assets', 'config.jsonc'),
      userFile: join('/home/.dsh', 'dsh-pet', 'main-config.jsonc'),
      legacyUserFile: join('/home/.dsh', 'dsh-pet', 'main-config.json'),
      petDir: join('/home/.dsh', 'dsh-pet', 'pet'),
    });
  });
});

describe('describePets - Display string shared by startup banner and physical examination report', () => {
  test('An empty list explicitly states the reason and does not print empty lines.', () => {
    assert.match(describePets([]), /pets array is empty/);
  });

  test('Print id/size/display as it is (standalone mode does not judge display for the user)', () => {
    const text = describePets([{ id: 'main', size: 462, display: 'both' }]);
    assert.match(text, /main/);
    assert.match(text, /size=462/);
    assert.match(text, /display=both/);
  });
});
