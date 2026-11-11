/**
 * Contract test of standalone mode balance query: only verify two short-circuit that are not connected to the
 * Internet, and the actual number is covered by balance.test.ts of host side.
 *
 * This kind of test does not rely on the public network and real accounts, nor will it become popular due to changes
 * in the service provider's interface.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryStandaloneBalance } from './balance.ts';

test('No service provider selected: direct unsupported, without parsing the key or sending a request', async () => {
  assert.deepEqual(await queryStandaloneBalance('', 'some-key'), {
    ok: false,
    provider: '',
    reason: 'unsupported',
  });
});

test('Missing key: Complete credential-missing and bring back the certificate name of host side', async () => {
  assert.deepEqual(await queryStandaloneBalance('deepseek-official', ''), {
    ok: false,
    provider: 'deepseek-official',
    reason: 'credential-missing',
    message: '缺少凭证 DEEPSEEK_API_KEY',
  });
});

test('Account route: There is no account service in standalone mode. It can only be clearly unavailable instead of forging balances.', async () => {
  assert.deepEqual(await queryStandaloneBalance('deepseek-account', 'some-key'), {
    ok: false,
    provider: 'deepseek-account',
    reason: 'credential-missing',
    message: '缺少账号服务（deepseek-account）',
  });
});
