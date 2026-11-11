/**
 * Single segment HTTP Range analysis: used for asset response of bridge.
 *
 * It has the same semantics as parseRange of src/host/http.ts on the host side; the running environment and build
 * boundary of both sides are different (Node http and Electron protocol.handle), each implements one copy.
 * @module dsh-pet/runtime/electron-helper/range
 */
'use strict';

/**
 * Parsing single segment Range header.
 *
 * Only three single-segment forms, `bytes=<start>-<end>` , `bytes=<start>-` , and `bytes=-<suffix>` , are accepted; if
 * multiple segments, units do not match, or the syntax is invalid, null (return to the whole copy) will be returned.
 * If the starting point is out of bounds or start > end, 'unsatisfiable' (return to 416) will be returned.
 * @param header - The original value of the request header, which may be null.
 * @param totalBytes - the total number of bytes in the file; Range is ignored if it is not a positive number.
 * @returns closed interval `{ start, end }` , ' unsatisfiable ' or null.
 */
function parseRange(header, totalBytes) {
  if (!header || totalBytes <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match) return null;
  const startText = match[1];
  const endText = match[2];
  if (startText === '' && endText === '') return null;

  if (startText === '') {
    // Suffix form: bytes =- N, take the last N bytes
    const suffixLength = Number(endText);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, totalBytes - suffixLength), end: totalBytes - 1 };
  }

  const start = Number(startText);
  const end = endText === '' ? totalBytes - 1 : Number(endText);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= totalBytes) return 'unsatisfiable';
  return { start, end: Math.min(end, totalBytes - 1) };
}

module.exports = { parseRange };
