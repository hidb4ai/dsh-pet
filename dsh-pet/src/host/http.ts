/**
 * Host side's HTTP pipeline: asset path verification, file/JSON/text response, request body collection, MIME mapping
 * and image type determination.
 *
 * It only does things at the protocol layer: it does not judge the business, does not read the configuration, and does
 * not touch the status; the route layer (./routes) decides what to respond, and here it is decided how to persist to
 * disk. Must always be true: asset paths are always restricted to a given root directory via resolveAsset, and no
 * concatenates are allowed to escape from this root.
 * @module dsh-pet/src/host/http
 */
import { createReadStream, existsSync, fstatSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, normalize, sep } from 'node:path';

/** Content-Type mapping corresponding to different extensions */
export const MIME: Record<string, string> = {
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.wav': 'audio/wav',
  '.json': 'application/json; charset=utf-8',
  '.jsonc': 'application/json; charset=utf-8',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** The maximum number of bytes that needs to be read for image magic number determination: WebP needs to see the 12th bytes. */
export const IMAGE_HEAD_BYTES = 16;

/**
 * Determine the image type according to the magic number of the file header.
 *
 * Only look at the first {@link IMAGE_HEAD_BYTES} bytes, without parsing the complete picture: the caller has either
 * just finished writing the verified bytes, or does not have a file with a trusted extension (the attachment object is
 * named according to a hash, and the avatar can be changed to any format by the user).
 *
 * @param header - File header buffer (may be full of {@link IMAGE_HEAD_BYTES} ).
 * @param size - The number of bytes actually read in header.
 * @returns is the Content-Type of the picture; returns undefined if it is not one of PNG / JPEG / GIF / WebP.
 */
export function imageTypeOf(header: Buffer, size: number): string | undefined {
  if (size >= 8 && header.readUInt32BE(0) === 0x89504e47 && header.readUInt32BE(4) === 0x0d0a1a0a) {
    return 'image/png';
  }
  if (size >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return 'image/jpeg';
  if (size >= 6) {
    const tag = header.toString('latin1', 0, 6);
    if (tag === 'GIF87a' || tag === 'GIF89a') return 'image/gif';
  }
  if (size >= 12 && header.toString('latin1', 0, 4) === 'RIFF' && header.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return undefined;
}

/**
 * Image Content-Type → persist to disk extension.
 *
 * @param contentType - the return value of {@link imageTypeOf} .
 * @returns Dotted extension; returns undefined if not supported.
 */
export function imageExtOf(contentType: string): string | undefined {
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/jpeg') return '.jpg';
  if (contentType === 'image/webp') return '.webp';
  if (contentType === 'image/gif') return '.gif';
  return undefined;
}

/**
 * Normalize and verify the request path to ensure it is within the assets root directory (to prevent path traversal).
 * @returns is the normalized absolute file path; if it is invalid (traveling), undefined is returned.
 */
export function resolveAsset(root: string, rel: string): string | undefined {
  if (rel.length === 0) return undefined;
  const candidate = normalize(join(root, rel));
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (candidate !== root && !candidate.startsWith(rootWithSep)) return undefined;
  return candidate;
}

/** Parse and confirm the existence of the entity under root; return undefined when it is invalid (travel) or does not exist */
export function resolveExisting(root: string, rel: string): string | undefined {
  const candidate = resolveAsset(root, rel);
  return candidate && existsSync(candidate) ? candidate : undefined;
}

/** Single segment bytes interval (closed interval). */
export type ByteRange = { readonly start: number; readonly end: number };

/** Range Judgment: hit range, out of bounds (return to 416), ignore (return to full 200). */
export type RangeDecision = ByteRange | 'unsatisfiable' | null;

/**
 * Parsing single segment `Range` header.
 *
 * Only three single-segment forms, `bytes=<start>-<end>` , `bytes=<start>-` and `bytes=-<suffix>` , are accepted. If
 * there are multiple segments, units do not match, or the syntax is invalid, null (return to the whole copy) will be
 * returned; if the starting point is out of bounds or start > end, ' unsatisfiable ' (return to 416) will be returned.
 * @param header - The original value of the request header, which may be undefined.
 * @param totalBytes - the total number of bytes in the file; Range is ignored if it is not a positive number.
 * @returns closed interval, ' unsatisfiable ' or null.
 */
export function parseRange(header: string | undefined, totalBytes: number): RangeDecision {
  if (!header || totalBytes <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const startText = match[1] ?? '';
  const endText = match[2] ?? '';
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

/**
 * Streaming returns a file (with Content-Type/length/cache headers).
 *
 * Content-Length must be taken from the fd being read (fstat in the open event): first stat and then open another
 * stream, the length will be declared to be greater than the actual bytes when the asset is overwritten/truncated, and
 * the response will never end and no error will be reported (browser stalled, video loadeddata will never trigger).
 * The size obtained by fstat of the same fd is naturally consistent with the bytes read subsequently.
 *
 * Supports single segment Range: the video will be filled in by pressing `Range: bytes=N-` in the middle, and the
 * player will play the whole segment as the second half of the video, and ended will be advanced to the wrong position
 * (the action is cut off).
 */
export function sendFile(req: IncomingMessage, res: ServerResponse, file: string, contentType: string): void {
  const stream = createReadStream(file);
  stream.once('open', (fd) => {
    if (res.destroyed || res.writableEnded) {
      stream.destroy(); // The client gave up before starting the stream.
      return;
    }
    let totalBytes: number;
    try {
      totalBytes = fstatSync(fd).size;
    } catch {
      // In extreme cases, fstat cannot get it: the length will not be sent, and it will be given to Node for chunked cleanup (the length is naturally the same, but it is not declared)
      res.writeHead(200, { 'content-type': contentType, 'cache-control': 'public, max-age=3600' });
      stream.pipe(res);
      return;
    }
    const decision = parseRange(req.headers.range, totalBytes);
    if (decision === 'unsatisfiable') {
      stream.destroy();
      res.writeHead(416, {
        'content-type': contentType,
        'content-range': `bytes */${totalBytes}`,
        'accept-ranges': 'bytes',
        'cache-control': 'public, max-age=3600',
      });
      res.end();
      return;
    }
    if (decision !== null) {
      // Hit interval: createReadStream cannot start from the middle, so press start/end to restart; the length is calculated by the total length of fstat, which is consistent with the slice
      stream.destroy();
      const ranged = createReadStream(file, { start: decision.start, end: decision.end });
      res.writeHead(206, {
        'content-type': contentType,
        'content-length': decision.end - decision.start + 1,
        'content-range': `bytes ${decision.start}-${decision.end}/${totalBytes}`,
        'accept-ranges': 'bytes',
        'cache-control': 'public, max-age=3600',
      });
      ranged.pipe(res);
      ranged.on('error', () => res.destroy());
      res.on('close', () => ranged.destroy());
      return;
    }
    res.writeHead(200, {
      'content-type': contentType,
      'content-length': totalBytes,
      'accept-ranges': 'bytes',
      'cache-control': 'public, max-age=3600',
    });
    stream.pipe(res);
  });
  // Read failure (file deleted/permissions/occupied): Disconnect directly so that the client can see the failure immediately instead of waiting indefinitely.
  stream.on('error', () => res.destroy());
  // The client disconnects early (happens frequently when switching animations quickly) → Stop reading, don’t read the entire file
  res.on('close', () => stream.destroy());
}

/** Send JSON response (headers optional: such as no-cache trigger count) */
export function sendJson(
  res: ServerResponse,
  status: number,
  obj: unknown,
  headers: Record<string, string> = {},
): void {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

/** Send plain text response (explicit error text such as asset 404/400) */
export function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}

/** Response to a single service route (WebServer register shares the same contract with the desktop Helper pipe; each consumer persists to disk) */
export type RouteResult =
  | { kind: 'json'; status: number; obj: unknown; headers?: Record<string, string> }
  | { kind: 'text'; status: number; body: string }
  | { kind: 'file'; file: string; contentType: string }
  /** No response required: caller has been disconnected during pending waiting (see the waiting branch of / playback) - the consumer cleanup directly without writing */
  | { kind: 'none' };

/** Upper limit of request body (bytes): The write endpoint only accepts JSON configuration and instructions. 1 MiB is enough. If the limit is exceeded, 413 will be sent directly. */
export const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Collect request body (text).
 *
 * Upper limit and disconnection processing: Promise must be allowed to land when the client is disconnected halfway,
 * otherwise the processor will always hang and the memory will only increase but not decrease.
 *
 * @param req - Request object.
 * @returns request body text.
 * When @throws { Error } exceeds {@link MAX_BODY_BYTES} , it takes `code: 'body-too-large'` ; when the connection is
 * disconnected early, it takes `code: 'client-aborted'` .
 */
export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve2, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    /**
     * Landing once: 'close' will also be triggered after normal response, and the second landing will be rejected by
     * the flag bit. No listening - the request object is recycled along with the connection. Instead, listening
     * requires the caller to provide a complete on/off pair (test stubs usually only have on).
     */
    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      finish();
    };
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        settle(() => reject(Object.assign(new Error('request body too large'), { code: 'body-too-large' })));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void => settle(() => resolve2(Buffer.concat(chunks).toString('utf8')));
    const onError = (error: Error): void => settle(() => reject(error));
    const onAborted = (): void =>
      settle(() => reject(Object.assign(new Error('client aborted'), { code: 'client-aborted' })));

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('close', onAborted);
    req.on('aborted', onAborted);
  });
}
