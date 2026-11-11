/**
 * Contract test for playback request receipt (src/client/pet/playback-report.ts).
 *
 * Three contracts:
 * 1. The address is spelled according to the playback number, and the number must be encoded (the third-party number
 * may contain `/` and spaces);
 * 2. Only report `reason` if there is a reason. If not, only report `status` - `?wait=` of host and the state machine
 * converge according to these two fields;
 * 3. All four reportable states are available (`accepted` is the host acceptance state, renderer is not allowed to
 * write).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { playbackReportRequest } from './playback-report.ts';
import { ROUTE_PATH } from '../../shared/constants.ts';
import { REPORTABLE_STATUSES } from '../../shared/playback.ts';

describe('playbackReportRequest - Receipt Request', () => {
  test('Address: / playback /< id >/ report, number is over-encoded', () => {
    const request = playbackReportRequest('pb/1 2', 'playing');
    assert.equal(request.url, ROUTE_PATH + '/playback/' + encodeURIComponent('pb/1 2') + '/report');
  });

  test('No reason: only bring status', () => {
    assert.deepEqual(playbackReportRequest('pb1', 'playing').body, { status: 'playing' });
  });

  test('There is a reason: status and reason both have', () => {
    assert.deepEqual(playbackReportRequest('pb1', 'failed', 'asset-load').body, {
      status: 'failed',
      reason: 'asset-load',
    });
  });

  test('All four reportable states can construct requests', () => {
    for (const status of REPORTABLE_STATUSES) {
      const request = playbackReportRequest('pb1', status);
      assert.equal(request.body.status, status);
      assert.ok(request.url.endsWith('/report'));
    }
  });
});
