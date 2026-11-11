import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAiConfig, validateSettings, DEFAULT_AI_SETTINGS } from './ai-config.ts';

const configured = {
  protocol: 'openai-compatible',
  baseUrl: 'https://example.test/v1',
  model: 'chosen-model',
  apiKey: 'test-secret',
  enabled: true,
};

test('validates safe endpoints and explicit configuration with fixed redacted errors', () => {
  for (const baseUrl of [
    'ftp://example.test',
    'https://u:p@example.test',
    'https://example.test/?key=secret',
    'https://example.test/#secret',
    'javascript:alert(1)',
    'https://example.test\\v1',
  ]) {
    assert.throws(
      () => validateSettings({ ...configured, baseUrl }, DEFAULT_AI_SETTINGS),
      /^Error: Invalid standalone AI settings\.$/,
    );
  }
  for (const baseUrl of [
    'http://192.168.1.100:8000/v1',
    'http://localhost:1234/v1',
    'http://127.0.0.1:8080',
    'http://[::1]:8080',
    'https://example.test/v1',
  ]) {
    assert.equal(validateSettings({ ...configured, baseUrl }, DEFAULT_AI_SETTINGS).baseUrl, baseUrl);
  }
  // Half-filled configuration is allowed to be saved: it is only temporarily unavailable and should not be refused even for saving.
  assert.equal(validateSettings({ model: '' }, DEFAULT_AI_SETTINGS).model, '');
  for (const patch of [
    { timeoutMs: 60001 },
    { whisperIntervalSec: 59 },
    { maxTokens: 100000 },
    { hasKey: true },
    { enabled: 'true' },
    { apiKey: 'bad\nkey' },
  ]) {
    assert.throws(
      () => validateSettings({ ...configured, ...patch }, DEFAULT_AI_SETTINGS),
      /Invalid standalone AI settings/,
    );
  }
});

test('Balance service provider: no query by default, only accepts three available routes, and persists with configuration', async () => {
  assert.equal(DEFAULT_AI_SETTINGS.balanceProvider, '');
  assert.equal(validateSettings({}, DEFAULT_AI_SETTINGS).balanceProvider, '');
  for (const balanceProvider of ['deepseek-official', 'opencode-go', 'commandcode']) {
    assert.equal(validateSettings({ balanceProvider }, DEFAULT_AI_SETTINGS).balanceProvider, balanceProvider);
  }
  // deepseek-account reads the login status of DSH. There is no account service in standalone mode, so it does not enter the optional set.
  for (const balanceProvider of ['deepseek-account', 'openai', 'DEEPSEEK-OFFICIAL', ' ']) {
    assert.throws(() => validateSettings({ balanceProvider }, DEFAULT_AI_SETTINGS), /Invalid standalone AI settings/);
  }
  const home = mkdtempSync(join(tmpdir(), 'pet-ai-balance-'));
  try {
    const store = createAiConfig(home);
    assert.equal(store.publicSettings().balanceProvider, '');
    const saved = await store.save({ ...configured, balanceProvider: 'deepseek-official' });
    assert.equal(saved.balanceProvider, 'deepseek-official');
    assert.equal(createAiConfig(home).publicSettings().balanceProvider, 'deepseek-official');
    // When this field is not passed, the previous value is retained and will not be washed away by the default value.
    assert.equal((await store.save({ model: 'next-model' })).balanceProvider, 'deepseek-official');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('persists only in isolated home, redacts keys, supports keep and clear, reloads offline', async () => {
  const home = mkdtempSync(join(tmpdir(), 'pet-ai-'));
  try {
    const store = createAiConfig(home);
    assert.equal(store.publicSettings().hasKey, false);
    const saved = await store.save(configured);
    assert.equal(saved.hasKey, true);
    assert.equal('apiKey' in saved, false);
    assert.equal(saved.maxTokens, 1024);
    assert.equal(saved.whisperIntervalSec, 300);
    assert.equal((await store.save({ apiKey: '', automaticWhispers: true })).hasKey, true);
    assert.equal(createAiConfig(home).publicSettings().model, 'chosen-model');
    assert.match(readFileSync(join(home, 'dsh-pet', 'standalone-ai.json'), 'utf8'), /test-secret/);
    // The enable bit is only reserved for old files: no matter what is transferred, persist to disk will always be true, and the external view will no longer be exposed.
    const forced = await store.save({ enabled: false });
    assert.equal('enabled' in forced, false);
    assert.match(readFileSync(join(home, 'dsh-pet', 'standalone-ai.json'), 'utf8'), /"enabled":true/);
    assert.equal((await store.save({ clearApiKey: true })).hasKey, false);
    assert.equal(createAiConfig(home).publicSettings().hasKey, false);
    writeFileSync(join(home, 'dsh-pet', 'standalone-ai.json'), '{broken');
    assert.throws(() => createAiConfig(home), /^Error: Cannot securely load standalone AI settings\.$/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('The old configuration file is missing fields added at the end: it is still readable after setting the default value, and the overall verification does not fail due to strict', async () => {
  const home = mkdtempSync(join(tmpdir(), 'pet-ai-legacy-'));
  try {
    mkdirSync(join(home, 'dsh-pet'), { recursive: true });
    // Pre-upgrade persist to disk shape: no balanceProvider.
    writeFileSync(
      join(home, 'dsh-pet', 'standalone-ai.json'),
      JSON.stringify({
        protocol: 'openai-compatible',
        baseUrl: 'https://example.test/v1',
        model: 'legacy-model',
        apiKey: 'legacy-secret',
        enabled: true,
        automaticWhispers: false,
        whisperIntervalSec: 300,
        maxTokens: 1024,
        timeoutMs: 30000,
      }),
    );
    const store = createAiConfig(home);
    assert.equal(store.publicSettings().model, 'legacy-model');
    assert.equal(store.publicSettings().hasKey, true);
    assert.equal(store.publicSettings().balanceProvider, '', 'Missing new fields are filled in with default values.');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
