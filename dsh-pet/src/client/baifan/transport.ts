/**
 * The "freeloader" transport layer: adjust the interface of dsh-pet, wait for the playback request receipt, and read
 * the live content on the page.
 *
 * Business failure is always HTTP 200 + `ok: false` , so it is not thrown here; it is only thrown when the network
 * layer fails (disconnected/abort). Each request has a timeout and is hung on the performance's own AbortSignal - at
 * the end, the request that is hanging in the middle is cut off. Otherwise, a freeze will make running forever true.
 * Clicking the menu again will only return "It is already eating", and the lock is still hung in the host.
 * @module dsh-pet/src/client/baifan/transport
 */
import { CFG, ROUTE } from './constants.ts';

/** The final state of the playback request receipt. */
export interface PlaybackEnd {
  /** Final state: Normal playback completed/playback failed/rejected. */
  status: 'ended' | 'failed' | 'cancelled' | 'timeout' | 'gone';
  /** Reason for failure (when status is failed). */
  reason?: string;
}

/** Live readings within the page (subset of `petApi7340`). */
interface PoseApi {
  /** Read the normalized center point and orientation of a pet. */
  pose?: (petId: string) => { x: number; y: number; facing: 'left' | 'right' } | null;
  /** Read the playback progress of the current playback request. */
  progress?: (petId: string) => {
    playbackId: string | null;
    currentTime: number;
    duration: number;
    paused: boolean;
    /** The asset address of the current playback request (in the form of url, it is that address). */
    anim?: string;
  } | null;
}

/**
 * Build the transport layer.
 *
 * @param ctx - client context; only used to obtain the read-only service `petApi7340` .
 * @returns interface calling and reading method; `attach` is used to hang the cancellation signal of this show.
 */
export function createTransport(ctx: { get: (name: string) => unknown }) {
  /** The cancellation signal of this show; at the end of the show, it is changed from attach ( null ) to null and abort. */
  let scene: AbortController | null = null;

  /** Read-only service in the page; the old version dsh-pet does not have it, and the click "There are no pets on this page" is called. */
  function api(): PoseApi | undefined {
    return ctx.get('petApi7340') as PoseApi | undefined;
  }

  /**
   * Adjust the interface once.
   *
   * @param method - HTTP method.
   * @param path - Path containing query string.
   * @param body - If yes, press JSON.
   * @param signal - Cancel signal covering the performance signal (generally not used).
   * @returns The parsed response body; `ok: false` when parsing fails.
   */
  async function call(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.headers = { 'content-type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const controller = new AbortController();
    const forward = (): void => controller.abort();
    const effective = signal ?? scene?.signal;
    if (effective !== undefined) {
      if (effective.aborted) controller.abort();
      else effective.addEventListener('abort', forward, { once: true });
    }
    const timer = window.setTimeout(() => controller.abort(), CFG.httpTimeoutMs);
    init.signal = controller.signal;
    try {
      const res = await fetch(ROUTE + path, init);
      try {
        return (await res.json()) as Record<string, unknown>;
      } catch {
        return { ok: false, reason: 'bad-response' };
      }
    } finally {
      window.clearTimeout(timer);
      if (effective !== undefined) effective.removeEventListener('abort', forward);
    }
  }

  /** Read live (zero requests for the same page); return null when service cannot be obtained or there is no such pet. */
  function pose(petId: string): { x: number; y: number; facing: 'left' | 'right' } | null {
    const read = api()?.pose;
    if (typeof read !== 'function') return null;
    try {
      return read.call(api(), petId);
    } catch {
      return null;
    }
  }

  /** Read the current playback progress; return null when the service in the page is missing. */
  function progress(petId: string): {
    playbackId: string | null;
    currentTime: number;
    duration: number;
    paused: boolean;
    anim?: string;
  } | null {
    const read = api()?.progress;
    if (typeof read !== 'function') return null;
    try {
      return read.call(api(), petId);
    } catch {
      return null;
    }
  }

  /**
   * Wait for a playback request to reach the final state.
   *
   * `POST /anim` and ok only represent acceptance: the asset has not been obtained, the decoding failed, it has been
   * rejected by a new playback request, and it has been locked. It may not have finished playing at all. The real end
   * is only known by the receipt reported by the renderer, so there are three final states such as GET /playback / {
   * id }; the upper limit of a single timeout is 10 seconds, and a layer of loops is used to extend the total budget.
   *
   * @param id - playback request number; null means that this playback request was not accepted at all.
   * @returns final state.
   */
  async function waitPlayback(id: string | null): Promise<PlaybackEnd> {
    if (id === null) return { status: 'gone' };
    const deadline = performance.now() + CFG.waitBudgetMs;
    for (;;) {
      const left = deadline - performance.now();
      if (left <= 0) return { status: 'timeout' };
      let r: Record<string, unknown>;
      try {
        r = await call(
          'GET',
          '/playback/' +
            encodeURIComponent(id) +
            '?wait=ended,failed,cancelled&timeout=' +
            Math.min(10000, Math.round(left)),
        );
      } catch {
        return { status: 'gone' };
      }
      // The record expires (cleared after 60 seconds) and returns { error : ' unknown playback ' }
      if (r.error !== undefined) return { status: 'gone' };
      if (r.status === 'ended' || r.status === 'failed' || r.status === 'cancelled') {
        return { status: r.status, reason: typeof r.reason === 'string' ? r.reason : undefined };
      }
    }
  }

  return {
    /** Change the cancellation signal of this show; pass null to indicate the end (and abort to the old one). */
    attach: (next: AbortController | null): void => {
      scene?.abort();
      scene = next;
    },
    call,
    pose,
    progress,
    waitPlayback,
  };
}

/** The public side of the transport layer. */
export type Transport = ReturnType<typeof createTransport>;
