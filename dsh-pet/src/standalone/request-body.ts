/**
 * The read boundary of the local HTTP request body: limit size, time limit and number of reads.
 *
 * Responsible for reading the text into the memory at once, and then handing it to the plugin route as a bounded
 * playback stream; JSON is not parsed, and authentication is not performed. This must always be true: the plugin will
 * not be called when the limit is exceeded, timeout or connection exception occurs, and a structured error will be
 * returned directly.
 * @module dsh-pet/src/standalone/request-body
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { rejectRequest } from './request-security.ts';

/** The upper limit of bytes for normal requests. */
export const MAX_REQUEST_BYTES = 1024 * 1024;
/** Set the upper limit of submitted bytes, which is tighter than ordinary requests. */
export const MAX_SETTINGS_BYTES = 16 * 1024;
/** Default time limit for a single read. */
export const BODY_TIMEOUT_MS = 5000;

/** Read the whole file first and then call the plugin: readBody inside the plugin will only consume a bounded playback stream. */
export async function boundedRequest(
  req: IncomingMessage,
  res: ServerResponse,
  limit: number,
  timeoutMs = BODY_TIMEOUT_MS,
): Promise<IncomingMessage | undefined> {
  const length = req.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > limit)) {
    rejectRequest(res, 413, 'Request body too large');
    return undefined;
  }
  const chunks: Buffer[] = [];
  const body = await new Promise<Buffer | undefined>((resolve) => {
    let size = 0;
    const finish = (status?: number): void => {
      clearTimeout(timer);
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('aborted', onError);
      if (status !== undefined) {
        // Pause the original request first and then return an error to avoid continuing to read the text that the peer is still sending.
        req.pause();
        if (!res.writableEnded && !res.destroyed)
          rejectRequest(
            res,
            status,
            status === 408 ? 'Request body read timed out' : 'Invalid or oversized request body',
          );
        resolve(undefined);
      } else resolve(Buffer.concat(chunks));
    };
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > limit) finish(413);
      else chunks.push(Buffer.from(chunk));
    };
    const onEnd = (): void => finish();
    const onError = (): void => finish(400);
    const timer = setTimeout(() => finish(408), timeoutMs);
    timer.unref();
    req.on('data', onData);
    req.once('end', onEnd);
    req.once('error', onError);
    req.once('aborted', onError);
  });
  if (body === undefined) return undefined;
  return Object.assign(Readable.from([body]), {
    method: req.method,
    url: req.url,
    headers: req.headers,
    rawHeaders: req.rawHeaders,
    socket: req.socket,
    httpVersion: req.httpVersion,
  }) as IncomingMessage;
}
