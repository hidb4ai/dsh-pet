/**
 * Pure logical contract for voice input: WAV header by bytes, PCM conversion, silence determination, base64 and
 * failure classification.
 *
 * Why is the nail so thin: host provider checks WAV field by field (`fmt ` length, PCM =1, mono, 16 kHz, byteRate
 * self-consistent). If one field is wrong, the entire audio will be rejected; and this type of error only appears as
 * "didn't hear clearly" on the interface, and it is impossible to tell that the header is written incorrectly. The
 * recording itself (getUserMedia) cannot be run in Node, please see the instructions at the end of the file.
 *
 * Use Node to build test runner (node:test) without introducing any npm dependencies.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { HEAR_SAMPLE_RATE, encodeWave, floatToPcm16, hearAudio, peakOf, toBase64 } from './hear.ts';

/** Take a ASCII mark from bytes and compare it according to the 4 bytes block of the WAV header. */
function tag(bytes: Uint8Array, offset: number): string {
  let text = '';
  for (let i = offset; i < offset + 4; i++) text += String.fromCharCode(bytes[i]);
  return text;
}

describe('encodeWave', () => {
  test('44 bytes header field by field conforms to host verification conventions', () => {
    const pcm = Int16Array.from([0, 1000, -1000]);
    const wave = encodeWave(pcm);
    const view = new DataView(wave.buffer);

    assert.equal(tag(wave, 0), 'RIFF');
    assert.equal(tag(wave, 8), 'WAVE');
    assert.equal(tag(wave, 12), 'fmt ');
    assert.equal(tag(wave, 36), 'data');
    assert.equal(view.getUint32(16, true), 16, 'fmt block length must be 16');
    assert.equal(view.getUint16(20, true), 1, 'The format must be PCM');
    assert.equal(view.getUint16(22, true), 1, 'Must be mono');
    assert.equal(view.getUint32(24, true), HEAR_SAMPLE_RATE, 'Required 16 kHz');
    assert.equal(view.getUint32(28, true), HEAR_SAMPLE_RATE * 2, 'byteRate must be consistent with the sampling rate');
    assert.equal(view.getUint16(32, true), 2, 'blockAlign = channel × bit depth/8');
    assert.equal(view.getUint16(34, true), 16, 'Required 16 bit');
  });

  test('The two lengths are self-consistent, and the sample is written back as it is.', () => {
    const pcm = Int16Array.from([0, 1, -1, 32767, -32768]);
    const wave = encodeWave(pcm);
    const view = new DataView(wave.buffer);

    assert.equal(view.getUint32(4, true), 36 + pcm.length * 2, 'RIFF length = 36 + data length');
    assert.equal(view.getUint32(40, true), pcm.length * 2);
    assert.equal(wave.byteLength, 44 + pcm.length * 2);
    for (let i = 0; i < pcm.length; i++) {
      assert.equal(view.getInt16(44 + i * 2, true), pcm[i], `${i} sample`);
    }
  });

  test('One sample also has 46 bytes (the host requires a minimum of 46, and empty audio will be rejected)', () => {
    assert.equal(encodeWave(Int16Array.from([0])).byteLength, 46);
  });

  test('The sampling rate can be changed, byteRate changes accordingly', () => {
    const wave = encodeWave(Int16Array.from([0]), 8000);
    assert.equal(new DataView(wave.buffer).getUint32(24, true), 8000);
    assert.equal(new DataView(wave.buffer).getUint32(28, true), 16000);
  });
});

describe('floatToPcm16', () => {
  test('The positive and negative half axes are scaled by 32767 / 32768 respectively, and the clamping is out of range.', () => {
    const out = floatToPcm16(Float32Array.from([0, 1, -1, 0.5, -0.5, 2, -2]));
    assert.equal(out[0], 0);
    assert.equal(out[1], 32767);
    assert.equal(out[2], -32768);
    assert.equal(out[3], 16383);
    assert.equal(out[4], -16384);
    assert.equal(out[5], 32767, 'Greater than 1 clipped to 1');
    assert.equal(out[6], -32768, 'Less than -1 Clamped to -1');
  });
});

describe('peakOf', () => {
  test('All zeros are 0, full width is 1, negative numbers take the absolute value', () => {
    assert.equal(peakOf(new Int16Array(128)), 0);
    assert.equal(peakOf(Int16Array.from([-32768, 0, 1])), 1);
    assert.equal(peakOf(Int16Array.from([0, 16384, -16384])), 0.5);
  });
});

describe('toBase64', () => {
  test('Consistent bytes with Buffer (across segment boundaries)', () => {
    const bytes = new Uint8Array(8192 * 2 + 3);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37) % 256;
    assert.equal(toBase64(bytes), Buffer.from(bytes).toString('base64'));
  });

  test('Empty bytes gives empty string', () => {
    assert.equal(toBase64(new Uint8Array(0)), '');
  });
});

/** Replace the global fetch with a stub and collect the request body. */
function stubFetch(make: () => Response): { bodies: string[]; urls: string[]; restore: () => void } {
  const bodies: string[] = [];
  const urls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    urls.push(String(url));
    bodies.push(String(init?.body ?? ''));
    return make();
  }) as typeof fetch;
  return {
    bodies,
    urls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/** Create a JSON response. */
function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('hearAudio', () => {
  test('Success: The request body is only audio, and the text is returned as is (including the empty string)', async () => {
    const stub = stubFetch(() => json({ ok: true, text: '你好' }));
    try {
      const outcome = await hearAudio('http://127.0.0.1/dsh-pet-7340/voice/hear', 'AAAA');
      assert.deepEqual(outcome, { ok: true, text: '你好' });
      assert.equal(stub.urls[0], 'http://127.0.0.1/dsh-pet-7340/voice/hear');
      assert.deepEqual(JSON.parse(stub.bodies[0]), { audio: 'AAAA' }, 'Do not send fields such as language easily');
    } finally {
      stub.restore();
    }
  });

  test('An empty string is also considered a success (no one speaks in this paragraph, which is a valid conclusion, not an error)', async () => {
    const stub = stubFetch(() => json({ ok: true, text: '' }));
    try {
      assert.deepEqual(await hearAudio('http://x/voice/hear', 'AAAA'), { ok: true, text: '' });
    } finally {
      stub.restore();
    }
  });

  test('When the host says unsupported / bad-request, it is brought back as it is', async () => {
    for (const reason of ['unsupported', 'bad-request']) {
      const stub = stubFetch(() => json({ ok: false, reason, message: '原因' }));
      try {
        const outcome = await hearAudio('http://x/voice/hear', 'AAAA');
        assert.deepEqual(outcome, { ok: false, reason, message: '原因' });
      } finally {
        stub.restore();
      }
    }
  });

  test('Unknown reason converges to generate-error, and message is missing to the empty string', async () => {
    const stub = stubFetch(() => json({ ok: false, reason: 'locked' }));
    try {
      assert.deepEqual(await hearAudio('http://x/voice/hear', 'AAAA'), {
        ok: false,
        reason: 'generate-error',
        message: '',
      });
    } finally {
      stub.restore();
    }
  });

  test('When the response is not JSON, it is considered a network failure and no exception is thrown.', async () => {
    const stub = stubFetch(() => new Response('<html>502</html>', { status: 502 }));
    try {
      const outcome = await hearAudio('http://x/voice/hear', 'AAAA');
      assert.equal(outcome.ok, false);
      if (!outcome.ok) assert.equal(outcome.reason, 'network');
    } finally {
      stub.restore();
    }
  });

  test('fetch even throws an error and converges to a network failure.', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    try {
      const outcome = await hearAudio('http://x/voice/hear', 'AAAA');
      assert.deepEqual(outcome, { ok: false, reason: 'network', message: 'ECONNREFUSED' });
    } finally {
      globalThis.fetch = original;
    }
  });
});

// startRecording / canRecord are not tested here: they only do the wiring of getUserMedia + AudioContext, and there is
// no corresponding implementation in Node. mock is only tested for mock. A one-time probe run of the real link route
// on the desktop (load shared-core.js → press and hold → record → hit host / voice/hear), see submission instructions.
